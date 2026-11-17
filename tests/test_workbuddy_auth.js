const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'wb-refresh-'));
process.env.WORKBUDDY_ACCOUNTS_FILE = path.join(dir,'accounts.json');
const wb = require('../lib/providers/workbuddy');
const auth = require('../lib/workbuddy-auth');
const accounts = require('../lib/accounts');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const jwt = seconds => 'e30.'+Buffer.from(JSON.stringify({exp:Date.now()/1000+seconds})).toString('base64url')+'.sig';
const session = (seconds = -60) => ({auth:{accessToken:jwt(seconds),refreshToken:'refresh-secret',domain:'www.codebuddy.cn',endpoint:wb.DEFAULT_BASE_URL},account:{uid:'wb-refresh-test-'+process.pid}});
const row = () => ({id:'test',name:'test',workbuddySession:wb.normalizeSession(session())});
function mockFetch(fn) {const old=global.fetch;global.fetch=fn;return ()=>{global.fetch=old;};}

test('import preserves complete refresh credentials and rejects encrypted refresh tokens',()=>{
 const value=wb.normalizeSession({...session(),auth:{...session().auth,expiresAt:Date.now(),refreshExpiresAt:Date.now()+1000000}});
 assert.equal(value.auth.refreshToken,'refresh-secret');assert.equal(typeof value.auth.expiresAt,'number');
 assert.equal(wb.normalizeSession({accessToken:'a',refreshToken:'r',uid:'u'}).auth.refreshToken,'r');
 for(const refreshToken of ['bad\nvalue','enc:secret',{}]) assert.throws(()=>wb.normalizeSession({...session(),auth:{...session().auth,refreshToken}}));
});
test('proactive refresh binds fixed endpoint, rotates and saves before execution',async()=>{
 const a=row();accounts.writeProviderAccounts('workbuddy',[a]);const token=jwt(3600);
 const restore=mockFetch(async(url,options)=>{
  assert.equal(url,'https://copilot.tencent.com/v2/plugin/auth/token/refresh');
  assert.equal(options.redirect,'error');assert.equal(options.headers['X-Refresh-Token'],'refresh-secret');
  assert.equal(options.headers['X-User-Id'],a.workbuddySession.account.uid);
  return {ok:true,status:200,json:async()=>({code:0,data:{accessToken:token,refreshToken:'rotated-refresh',expiresIn:3600,refreshExpiresIn:86400}})};
 });
 try{
  const result=await auth.prepare(a);assert.equal(result.auth.accessToken,token);
  assert.equal(accounts.readProviderAccounts('workbuddy')[0].workbuddySession.auth.refreshToken,'rotated-refresh');
  assert.deepEqual(a.workbuddySession,result);
  assert.equal(fs.statSync(process.env.WORKBUDDY_ACCOUNTS_FILE).mode&0o777,0o600);
  assert.equal(fs.readdirSync(dir).filter(x=>x.endsWith('.tmp')).length,0);
 }finally{restore();}
});
test('healthy token avoids refresh; forced refresh supports opaque-token 401 recovery',async()=>{
 const a={...row(),workbuddySession:wb.normalizeSession(session(172800))};accounts.writeProviderAccounts('workbuddy',[a]);let calls=0;
 const restore=mockFetch(async()=>{calls++;return {ok:true,status:200,json:async()=>({code:0,data:{accessToken:jwt(7200),refreshToken:'new-refresh'}})};});
 try{await auth.prepare(a);assert.equal(calls,0);await auth.prepare(a,true);assert.equal(calls,1);}finally{restore();}
});
test('refresh rejection does not modify stored credentials or expose upstream secrets',async()=>{
 const a=row();accounts.writeProviderAccounts('workbuddy',[a]);const before=fs.readFileSync(process.env.WORKBUDDY_ACCOUNTS_FILE,'utf8');
 const restore=mockFetch(async()=>({ok:false,status:401,json:async()=>({code:1,message:'refresh-secret'})}));
 try{await assert.rejects(auth.prepare(a),e=>e.authCode==='AUTH_ERROR'&&!e.message.includes('refresh-secret'));
 assert.equal(fs.readFileSync(process.env.WORKBUDDY_ACCOUNTS_FILE,'utf8'),before);}finally{restore();}
});
test('manual credential edits during refresh win over rotated results',async()=>{
 const a=row();accounts.writeProviderAccounts('workbuddy',[a]);
 const edited={...a,workbuddySession:wb.normalizeSession(session(9000))};
 const restore=mockFetch(async()=>{accounts.writeProviderAccounts('workbuddy',[edited]);return {ok:true,status:200,json:async()=>({code:0,data:{accessToken:jwt(3600),refreshToken:'rotated'}})};});
 try{await assert.rejects(auth.prepare(a),/未覆盖/);assert.deepEqual(accounts.readProviderAccounts('workbuddy')[0].workbuddySession,edited.workbuddySession);}finally{restore();}
});
test('expired credential without refresh token gives actionable error before network',async()=>{
 const a=row();delete a.workbuddySession.auth.refreshToken;
 const restore=mockFetch(()=>{throw Error('network must not be called');});
 try{await assert.rejects(auth.prepare(a),/缺少 refreshToken/);}finally{restore();}
});
test('concurrent refresh of one account returns BUSY rather than reusing rotating token',async()=>{
 const a=row();accounts.writeProviderAccounts('workbuddy',[a]);let release;const wait=new Promise(r=>release=r);
 const restore=mockFetch(async()=>{await wait;return {ok:true,status:200,json:async()=>({code:0,data:{accessToken:jwt(3600),refreshToken:'new-refresh'}})};});
 try{const first=auth.prepare(a);await assert.rejects(auth.prepare(structuredClone(a)),e=>e.authCode==='BUSY');release();await first;}finally{restore();}
});
