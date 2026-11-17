// Official browser authorization. Access/refresh tokens never leave server storage.
const crypto = require('node:crypto');
const wb = require('./providers/workbuddy');
const { readProviderAccounts, writeProviderAccounts, updateProviderAccounts } = require('./accounts');
const BASE = 'https://copilot.tencent.com';
const sessions = new Map();
const headers = {'Content-Type':'application/json','Accept':'application/json','X-No-Authorization':'true',
  'X-No-User-Id':'true','X-No-Enterprise-Id':'true','X-No-Department-Info':'true',
  'X-Product':'SaaS','X-Requested-With':'XMLHttpRequest','X-Domain':BASE,'User-Agent':'CLI/2.63.2 CodeBuddy/2.63.2'};
function view(s){return {id:s.id,state:s.state,message:s.message,expiresAt:new Date(s.deadline).toISOString(),
  ...(s.state==='waiting'?{authUrl:s.authUrl}:{}),...(s.accountId?{accountId:s.accountId}:{})};}
function finish(s,state,message){clearTimeout(s.timer);s.state=state;s.message=message;delete s.upstreamState;delete s.authUrl;
 s.timer=setTimeout(()=>sessions.delete(s.id),10*60000);s.timer.unref?.();}
function schedule(s){s.timer=setTimeout(()=>poll(s.id),5000);s.timer.unref?.();}
async function create(body={},onSaved){
 const name=String(body.name||'').trim();if(!name||name.length>80)throw Object.assign(Error('请填写不超过 80 字的账号名称'),{status:400});
 if([...sessions.values()].filter(s=>s.state==='waiting').length>=5)throw Object.assign(Error('已有多个授权任务，请先完成或取消'),{status:429});
 let expectedUid;
 if(body.accountId){const a=readProviderAccounts('workbuddy').find(a=>a.id===body.accountId);if(!a)throw Object.assign(Error('账号不存在'),{status:404});expectedUid=wb.normalizeSession(a.workbuddySession).account.uid;}
 let response,data;
 try{response=await fetch(BASE+'/v2/plugin/auth/state?platform=CLI',{method:'POST',redirect:'error',headers,body:'{}',signal:AbortSignal.timeout(20000)});data=await response.json();}
 catch{throw Object.assign(Error('无法连接官方授权服务，请稍后重试'),{status:502});}
 if(!response.ok||data.code!==0||typeof data.data?.state!=='string'||!data.data.state)throw Object.assign(Error('官方授权服务未返回有效会话'),{status:502});
 let url;try{url=new URL(data.data.authUrl);}catch{}
 if(!url||url.protocol!=='https:'||url.username||url.password||!['copilot.tencent.com','www.codebuddy.cn','codebuddy.cn'].includes(url.hostname)||url.port)throw Object.assign(Error('官方授权地址无效'),{status:502});
 const s={id:crypto.randomBytes(24).toString('hex'),name,accountId:body.accountId||null,expectedUid,
  state:'waiting',message:'请打开官方授权页，登录需要添加的账号。',authUrl:url.href,upstreamState:data.data.state,deadline:Date.now()+5*60000,onSaved};
 sessions.set(s.id,s);schedule(s);return view(s);
}
function get(id){const s=sessions.get(id);if(!s)throw Object.assign(Error('授权会话已失效，请重新开始'),{status:404});if(s.state==='waiting'&&Date.now()>=s.deadline)finish(s,'expired','授权已超时，请重新开始');return view(s);}
function cancel(id){const s=sessions.get(id);if(!s)throw Object.assign(Error('授权会话不存在'),{status:404});if(s.state==='waiting')finish(s,'cancelled','授权已取消');return view(s);}
async function poll(id){
 const s=sessions.get(id);if(!s||s.state!=='waiting'||s.polling)return;
 if(Date.now()>=s.deadline){finish(s,'expired','授权已超时，请重新开始');return;}
 s.polling=true;
 try{
  const response=await fetch(BASE+'/v2/plugin/auth/token?state='+encodeURIComponent(s.upstreamState),{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(s.state!=='waiting')return;
  if(!response.ok){s.message='官方授权服务暂未响应，正在等待…';return;}
  if(data.code===11217)return;
  if(data.code!==0){finish(s,'failed','官方授权未通过，请重新登录授权');return;}
  s.received=true;const token=data.data||{};let claims;
  try{claims=JSON.parse(Buffer.from(token.accessToken.split('.')[1],'base64url'));}catch{throw Error('官方凭据格式异常');}
  if(typeof claims.sub!=='string'||!claims.sub)throw Error('官方凭据缺少账号身份');
  if(!token.refreshToken)throw Error('官方未返回刷新令牌，请重新授权');
  const session=wb.normalizeSession({auth:{accessToken:token.accessToken,refreshToken:token.refreshToken,domain:token.domain||'www.codebuddy.cn',endpoint:BASE},account:{uid:claims.sub,enterpriseId:''}});
  if(Number.isFinite(token.expiresIn)&&token.expiresIn>0)session.auth.expiresAt=Date.now()+token.expiresIn*1000;
  if(Number.isFinite(token.refreshExpiresIn)&&token.refreshExpiresIn>0)session.auth.refreshExpiresAt=Date.now()+token.refreshExpiresIn*1000;
  updateProviderAccounts('workbuddy', accounts=>{
  const same=accounts.find(a=>{try{return wb.normalizeSession(a.workbuddySession).account.uid===claims.sub;}catch{return false;}});
  const at=new Date().toISOString();let saved;
  if(s.accountId){saved=accounts.find(a=>a.id===s.accountId);if(!saved)throw Error('原账号已删除，未保存授权');
   if(claims.sub!==s.expectedUid||wb.normalizeSession(saved.workbuddySession).account.uid!==s.expectedUid)throw Error('登录身份与原账号不一致，未覆盖已有凭据');
   return accounts.map(a=>a.id===s.accountId?{...a,name:s.name,workbuddySession:session,updatedAt:at}:a);
  }else{
   if(same)throw Error('该账号已存在，请使用其“重新授权”，未重复添加');
   saved={id:crypto.randomUUID(),name:s.name,provider:'workbuddy',baseUrl:BASE,enabled:true,workbuddySession:session,createdAt:at,updatedAt:at,notes:''};
   s.accountId=saved.id;return [...accounts,saved];
  }
  });
  finish(s,'completed','授权成功，凭据已保存在服务器，自动签到与续期已就绪');
  try{s.onSaved?.(s.accountId);}catch{}
 }catch(e){if(s.state==='waiting'){
   // Known local messages contain no upstream body, tokens, or auth headers.
   const safe=['官方凭据格式异常','官方凭据缺少账号身份','官方未返回刷新令牌，请重新授权','原账号已删除，未保存授权','登录身份与原账号不一致，未覆盖已有凭据','该账号已存在，请使用其“重新授权”，未重复添加'];
   if(safe.includes(e.message))finish(s,'failed',e.message);else if(s.received)finish(s,'failed','凭据保存失败，请重新授权');else s.message='授权查询暂时失败，正在重试…';
  }}finally{s.polling=false;if(s.state==='waiting')schedule(s);}
}
module.exports={create,get,cancel,poll};
