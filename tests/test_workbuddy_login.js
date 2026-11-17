const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wb-login-'));process.env.WORKBUDDY_ACCOUNTS_FILE=path.join(dir,'accounts.json');
const store=require('../lib/accounts');const wb=require('../lib/providers/workbuddy');const login=require('../lib/workbuddy-login');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const token=uid=>'e30.'+Buffer.from(JSON.stringify({sub:uid,exp:Date.now()/1000+3600})).toString('base64url')+'.signature';
function mock(handler){const old=global.fetch;global.fetch=handler;return()=>global.fetch=old;}
const state=()=>({ok:true,status:200,json:async()=>({code:0,data:{state:'upstream-state',authUrl:'https://copilot.tencent.com/login?state=upstream-state'}})});
const auth=uid=>({ok:true,status:200,json:async()=>({code:0,data:{accessToken:token(uid),refreshToken:'private-refresh',expiresIn:3600}})});
test('browser login saves token pair server-side, exposes no credentials and preserves other accounts',async()=>{
 store.writeProviderAccounts('workbuddy',[{id:'old',name:'old',workbuddySession:wb.normalizeSession({accessToken:'old-token',uid:'old-user'})}]);let called;
 const restore=mock(async url=>url.includes('/auth/state')?state():auth('new-user'));
 try{const s=await login.create({name:'新账号'},id=>called=id);assert.equal(s.state,'waiting');await login.poll(s.id);const done=login.get(s.id);assert.equal(done.state,'completed');assert.equal(called,done.accountId);
 const rows=store.readProviderAccounts('workbuddy');assert.equal(rows.length,2);assert.equal(rows[0].workbuddySession.auth.accessToken,'old-token');assert.equal(rows[1].workbuddySession.auth.refreshToken,'private-refresh');
 assert.ok(!JSON.stringify(done).includes('private-refresh'));assert.ok(!JSON.stringify(done).includes(token('new-user')));assert.equal(done.authUrl,undefined);
 }finally{restore();}
});
test('duplicate UID is rejected without replacing existing credentials',async()=>{
 const before=fs.readFileSync(process.env.WORKBUDDY_ACCOUNTS_FILE,'utf8');const restore=mock(async url=>url.includes('/auth/state')?state():auth('new-user'));
 try{const s=await login.create({name:'重复账号'});await login.poll(s.id);assert.equal(login.get(s.id).state,'failed');assert.equal(fs.readFileSync(process.env.WORKBUDDY_ACCOUNTS_FILE,'utf8'),before);}finally{restore();}
});
test('reauthorization verifies the original UID',async()=>{
 const before=fs.readFileSync(process.env.WORKBUDDY_ACCOUNTS_FILE,'utf8');const restore=mock(async url=>url.includes('/auth/state')?state():auth('wrong-user'));
 try{const s=await login.create({name:'old',accountId:'old'});await login.poll(s.id);assert.match(login.get(s.id).message,/身份.*不一致/);assert.equal(fs.readFileSync(process.env.WORKBUDDY_ACCOUNTS_FILE,'utf8'),before);}finally{restore();}
});
test('cancelled pending login cannot save a late token reply',async()=>{
 let release;const wait=new Promise(r=>release=r);const restore=mock(async url=>{if(url.includes('/auth/state'))return state();await wait;return auth('cancelled-user');});
 try{const s=await login.create({name:'取消'});const before=fs.readFileSync(process.env.WORKBUDDY_ACCOUNTS_FILE,'utf8');const pending=login.poll(s.id);login.cancel(s.id);release();await pending;assert.equal(login.get(s.id).state,'cancelled');assert.equal(fs.readFileSync(process.env.WORKBUDDY_ACCOUNTS_FILE,'utf8'),before);}finally{restore();}
});
test('authorization links are restricted to official HTTPS hosts',async()=>{
 const restore=mock(async()=>({ok:true,json:async()=>({code:0,data:{state:'s',authUrl:'https://evil.example/login'}})}));
 try{await assert.rejects(login.create({name:'x'}),/地址无效/);}finally{restore();}
});
