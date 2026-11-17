const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const wb = require('../lib/providers/workbuddy');
const root = path.resolve(__dirname, '..');
const session = token => ({ auth: { accessToken: token }, account: { uid: 'test-user' } });

test('WorkBuddy accepts standard and legacy credentials, rejects device encryption and foreign endpoints', () => {
  assert.equal(wb.normalizeSession(JSON.stringify(session('secret'))).account.uid, 'test-user');
  assert.equal(wb.normalizeSession({ accessToken: 'secret', uid: 'legacy' }).account.uid, 'legacy');
  for (const value of [{ auth: { accessToken: { $wbEncrypted: 1 } }, account: { uid: 'x' } },
    { ...session('secret'), auth: { accessToken: 'secret', endpoint: 'https://other.example' } }, session('bad\ntoken'), session('')]) {
    assert.throws(() => wb.normalizeSession(value));
  }
});
test('WorkBuddy preserves reward semantics and does not conceal partial growth failure', () => {
  const map = (out, exitCode = 0, action = 'auto') => wb.mapResult({ id: 'one', name: '测试' }, action, { out, exitCode }).account;
  const claimed = map({ result: 'CLAIMED', credit: 100, credits_gained: 20, total_credits: 2200, streak_days: 22, report: '领取成功' });
  assert.equal(claimed.lastCheckin.points, 120); assert.equal(claimed.lastCheckin.ok, true);
  assert.equal(claimed.lastStatus.points, 2200); assert.equal(claimed.lastStatus.currentStreak, 22);
  const combined = map({ result: 'CLAIMED', credit: 100, growth_credits: 20, credits_gained: 120, report: '新版合计口径' });
  assert.equal(combined.lastCheckin.points, 120);
  assert.equal(map({ result: 'ALREADY', report: '今日已签到' }).lastCheckin.already, true);
  const partial = map({ result: 'ALREADY', report: '今日已签到', growth: '成长中心失败', needs_attention: true }, 1);
  assert.equal(partial.lastCheckin.ok, false); assert.equal(partial.lastCheckin.already, false);
  assert.equal(partial.lastCheckin.partial, true); assert.equal(partial.lastCheckin.retryable, false);
  assert.match(partial.lastCheckin.message, /成长中心失败/);
  assert.equal(map({ result: 'INACTIVE', report: '非活动期', active: false }).lastCheckin.skipped, true);
  for (const code of ['AUTH_REJECTED', 'FORBIDDEN', 'BUSY']) {
    const a = map({ result: code, report: code }, 1);
    assert.equal(a.lastCheckin.ok, false); assert.equal(a.lastCheckin.retryable, false);
  }
  assert.equal(map({ result: 'NETWORK', report: '网络失败' }, 1).lastCheckin.retryable, true);
  const status = map({ result: 'STATUS', report: '今日已签到', today_checked_in: true }, 0, 'status');
  assert.equal(status.lastCheckin, undefined); assert.equal(status.lastStatus.todaySigned, true);
});
test('merging execution records retains edited credentials and account metadata', () => {
  const current = { id: 'one', name: 'new name', workbuddySession: session('new-token') };
  const merged = wb.mergeRun(current, { id: 'one', name: 'old name', workbuddySession: session('old-token'), lastCheckin: { ok: true } });
  assert.equal(merged.name, 'new name'); assert.equal(merged.workbuddySession.auth.accessToken, 'new-token');
  assert.equal(merged.lastCheckin.ok, true);
});
async function tempProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbuddy-test-'));
  for (const folder of ['lib', 'routes', 'scripts', 'templates']) fs.cpSync(path.join(root, folder), path.join(dir, folder), { recursive: true });
  fs.copyFileSync(path.join(root, 'server.js'), path.join(dir, 'server.js'));
  fs.mkdirSync(path.join(dir,'public/dashboard'),{recursive:true});
  for(const name of ['index.html','workbuddy-ui.js']) fs.copyFileSync(path.join(root,'public/dashboard',name),path.join(dir,'public/dashboard',name));
  fs.mkdirSync(path.join(dir, 'vendor/workbuddy-auto-signin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vendor/workbuddy-auto-signin/signin.py'), `
import time
DEFAULT_ENDPOINT = 'https://copilot.tencent.com'
class AuthError(Exception): pass
def _start_budget(action): pass
def _validate_session(s): pass
def _token_format(token): return 'plaintext'
def build_headers(s): return s
def run_daily(s, endpoint):
 time.sleep(.4)
 return 0, {'result':'CLAIMED','credit':100,'report':'ok '+s['auth']['accessToken'],'claim_body':s}, False
`);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('real Python adapter locks per uid across processes and excludes raw response bodies', async t => {
  const dir = await tempProject(t);
  function launch() {
    const child = spawn('/usr/bin/python3', [path.join(dir, 'scripts/workbuddy_bridge.py'), 'auto'], { env: { ...process.env, WORKBUDDY_LOCK_DIR: path.join(dir, 'locks') } });
    let stdout = ''; child.stdout.on('data', c => stdout += c); child.stdin.end(JSON.stringify(session('private-token')));
    return { child, done: once(child, 'close').then(() => JSON.parse(stdout)) };
  }
  const first = launch();
  for (let i=0;i<100 && !fs.existsSync(path.join(dir,'locks'));i++) await new Promise(r=>setTimeout(r,5));
  const second = launch();
  const [a,b] = await Promise.all([first.done, second.done]);
  assert.deepEqual([a.result,b.result].sort(), ['BUSY','CLAIMED']);
  assert.equal(a.claim_body, undefined); assert.equal(b.claim_body, undefined);
});
test('subprocess adapter redacts secrets and fails invalid output and missing runtime safely', async t => {
  const dir = await tempProject(t);
  const local = require(path.join(dir, 'lib/providers/workbuddy.js'));
  const value = await local.invoke(local.normalizeSession(session('private-token')), 'auto');
  assert.equal(value.exitCode, 0); assert.ok(!JSON.stringify(value.out).includes('private-token'));
  fs.writeFileSync(path.join(dir,'scripts/workbuddy_bridge.py'), 'print("not-json")');
  assert.equal((await local.invoke(local.normalizeSession(session('private-token')), 'auto')).out.result, 'ERROR');
  const old=process.env.WORKBUDDY_PYTHON;process.env.WORKBUDDY_PYTHON='/no-such-python';
  try { assert.equal((await local.invoke(local.normalizeSession(session('private-token')), 'auto')).out.result, 'ENV_ERROR'); }
  finally { if(old===undefined)delete process.env.WORKBUDDY_PYTHON;else process.env.WORKBUDDY_PYTHON=old; }
});
test('subprocess timeout terminates the worker and reports a retryable failure', async t => {
  const dir = await tempProject(t);
  fs.writeFileSync(path.join(dir,'scripts/workbuddy_bridge.py'), 'import time\ntime.sleep(1000)');
  const local = require(path.join(dir, 'lib/providers/workbuddy.js'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = local.invoke(local.normalizeSession(session('private-token')), 'auto');
  t.mock.timers.tick(600000);
  const result = await pending;
  assert.equal(result.out.result, 'TIMEOUT');
  assert.equal(result.exitCode, 1);
  t.mock.timers.reset();
});
test('authenticated account API protects tokens; background jobs are prompt, survive edits and do not restore deletions', async t => {
  const dir = await tempProject(t);
  // Deterministic offline process; no upstream API or Telegram traffic.
  fs.writeFileSync(path.join(dir,'scripts/workbuddy_bridge.py'), `import time,json,sys\ns=json.load(sys.stdin)\ntime.sleep(.25)\nprint(json.dumps({'result':'ALREADY','report':'今日已签过'}))\n`);
  const socket = net.createServer(); socket.listen(32000+Math.floor(Math.random()*20000),'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
  const child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ADMIN_PASS:'test-password-long-enough',SESSION_SECRET:'test-session-secret-long-enough',APP_API_TOKEN:'test-api-token-long-enough',WORKBUDDY_ACCOUNTS_FILE:path.join(dir,'data/workbuddy_accounts.json')},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'close')}});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,20))}assert.ok(ready);
  const request=async(route,method='GET',body,auth=true)=>{
    const r=await fetch(`http://127.0.0.1:${port}/api/v1`+route,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test-api-token-long-enough'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};
  };
  const asset=await fetch(`http://127.0.0.1:${port}/dashboard/workbuddy-ui.js?v=test`);
  assert.equal(asset.status,200);assert.match(await asset.text(),/window.workbuddyUI/);
  const page=await fetch(`http://127.0.0.1:${port}/dashboard/`);
  assert.equal(page.status,200);assert.match(await page.text(),/workbuddy-ui.js\?v=/);
  const loginSession=session('private-token');loginSession.auth.refreshToken='private-refresh';
  const added=await request('/accounts','POST',{provider:'workbuddy',name:'one',workbuddySession:loginSession});
  assert.equal(added.status,201);const id=added.body.account.id;
  assert.equal(added.body.account.workbuddyAuth.hasRefreshToken,true);assert.ok(!JSON.stringify(added.body).includes('private-refresh'));
  assert.equal((await request('/accounts','POST',{provider:'workbuddy',name:'duplicate',workbuddySession:loginSession})).status,400);
  assert.equal(added.body.account.hasWorkbuddySession,true);assert.ok(!JSON.stringify(added.body).includes('private-token'));
  assert.equal((await request('/workbuddy/accounts/'+id+'/run','POST',{},false)).status,401);
  const before=Date.now(),job=await request('/workbuddy/accounts/'+id+'/run','POST',{});
  assert.equal(job.status,202);assert.ok(Date.now()-before<200);
  assert.equal((await request('/workbuddy/accounts/'+id+'/run','POST',{})).body.startedAt,job.body.startedAt);
  const update=await request('/accounts/'+id,'PUT',{name:'edited'});assert.equal(update.status,200);
  let record;for(let i=0;i<100;i++){record=(await request('/workbuddy/accounts/'+id+'/job')).body;if(record.state!=='running')break;await new Promise(r=>setTimeout(r,20))}
  assert.equal(record.state,'completed');
  const stored=JSON.parse(fs.readFileSync(path.join(dir,'data/workbuddy_accounts.json')))[0];
  assert.equal(stored.name,'edited');assert.equal(stored.lastCheckin.already,true);assert.equal(fs.statSync(path.join(dir,'data/workbuddy_accounts.json')).mode&0o777,0o600);
  assert.equal((await request('/accounts/'+id,'PUT',{workbuddySession:session('bad\ntoken')})).status,400);
  await request('/workbuddy/accounts/'+id+'/run','POST',{});
  await request('/accounts/'+id,'DELETE');await new Promise(r=>setTimeout(r,500));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'data/workbuddy_accounts.json'))),[]);
  const other=session('another-token');other.account.uid='another-user';
  const multi=await request('/accounts','POST',{provider:'workbuddy',name:'second',workbuddySession:other});
  assert.equal(multi.status,201);
  assert.equal((await request('/accounts/'+multi.body.account.id,'PUT',{enabled:false})).body.account.enabled,false);
});

test('401 recovery persists rotated pair before retry and preserves execution merge snapshot', async t => {
  const dir = await tempProject(t);
  fs.writeFileSync(path.join(dir,'scripts/workbuddy_bridge.py'), `import json,sys
s=json.load(sys.stdin)
old=s['auth']['accessToken']=='old-access'
print(json.dumps({'result':'AUTH_REJECTED' if old else 'ALREADY','report':'rejected' if old else '今日已签到'}))
sys.exit(1 if old else 0)
`);
  const oldFile=process.env.WORKBUDDY_ACCOUNTS_FILE;
  const oldFetch=global.fetch;
  process.env.WORKBUDDY_ACCOUNTS_FILE=path.join(dir,'data/accounts-auth.json');
  try {
    const store=require(path.join(dir,'lib/accounts'));
    const local=require(path.join(dir,'lib/providers/workbuddy'));
    const account={id:'refresh',name:'refresh',workbuddySession:local.normalizeSession({auth:{accessToken:'old-access',refreshToken:'old-refresh'},account:{uid:'refresh-test'}})};
    store.writeProviderAccounts('workbuddy',[account]);let refreshes=0;
    global.fetch=async()=>{refreshes++;return {ok:true,status:200,json:async()=>({code:0,data:{accessToken:'new-access',refreshToken:'new-refresh'}})};};
    const processed=await local.runAccountCheckin(account);
    assert.equal(refreshes,1);assert.equal(processed.account.lastCheckin.ok,true);
    const saved=store.readProviderAccounts('workbuddy')[0];
    assert.equal(saved.workbuddySession.auth.refreshToken,'new-refresh');
    assert.deepEqual(saved.workbuddySession,account.workbuddySession);
    const result=local.mergeRun(saved,processed.account);
    assert.equal(result.workbuddySession.auth.accessToken,'new-access');
    assert.ok(!JSON.stringify(result.lastCheckin).includes('refresh'));
  } finally {
    global.fetch=oldFetch;
    if(oldFile===undefined)delete process.env.WORKBUDDY_ACCOUNTS_FILE;else process.env.WORKBUDDY_ACCOUNTS_FILE=oldFile;
  }
});
