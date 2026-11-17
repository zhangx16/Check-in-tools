const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const store=require('./emby-keepalive-store');
const player=require('./emby-keepalive-player');
function safeMessage(error){
  if(error.name==='AbortError'||error.name==='TimeoutError')return '保活任务超时或已停止';
  return String(error.message||'保活执行失败').replace(/(https?:\/\/)[^\s]+/g,'[服务器地址]').slice(0,300);
}
async function run(id,{lease,playerImpl=player.play,signal}={}) {
  const token=lease||store.claim(id);store.own(id,token);
  let account;
  try {
    account=store.read().find(a=>a.id===id);if(!account)throw store.error('Emby 保活账号不存在',404);
    const min=account.watchMinSeconds??account.watchSeconds, max=account.watchMaxSeconds??account.watchSeconds;
    const targetSeconds=crypto.randomInt(min,max+1);
    store.update(id,a=>({...a,lastAttemptAt:new Date().toISOString(),activeProgress:{watchedSeconds:0,bytes:0,targetSeconds}}));
    const result=await playerImpl({...account,watchSeconds:targetSeconds},{signal,onProgress:async progress=>store.update(id,a=>({...a,activeProgress:{...progress,targetSeconds},...(progress.playbackCursor?{playbackCursor:progress.playbackCursor}:{})}))});
    result.targetSeconds=targetSeconds;
    if(result.ok!==true||result.verified!==true||result.watchedSeconds<targetSeconds)throw new Error('服务器未确认播放结果');
    const now=new Date().toISOString();
    store.update(id,a=>({...a,...(result.playbackCursor?{playbackCursor:result.playbackCursor}:{}),lastWatchAt:now,lastWatchSeconds:result.watchedSeconds,totalWatchSeconds:(a.totalWatchSeconds||0)+result.watchedSeconds,lastResult:{...result,checkedAt:now},activeProgress:null,updatedAt:now}));
    return result;
  } catch(error) {
    if(account){const now=new Date().toISOString();store.update(id,a=>({...a,lastResult:{ok:false,message:safeMessage(error),checkedAt:now,watchedSeconds:a.activeProgress?.watchedSeconds||0,verified:false},activeProgress:null,updatedAt:now}));}
    return {ok:false,message:safeMessage(error)};
  } finally {store.release(id,token)}
}
function launch(id){
  if(!store.read().some(a=>a.id===id))throw store.error('Emby 保活账号不存在',404);
  const token=store.claim(id);
  try{
    const child=spawn(process.execPath,[path.join(__dirname,'../scripts/emby_keepalive.js'),'--account',id,'--lease',token],{cwd:path.join(__dirname,'..'),env:process.env,stdio:'ignore',detached:true});
    child.once('error',()=>store.release(id,token));
    child.once('exit',()=>store.release(id,token));
    child.unref();return {ok:true,id,running:true};
  }catch(e){store.release(id,token);throw e}
}
function list(){return store.read().map(a=>({...store.publicAccount(a),activeProgress:store.lock(a.id)?a.activeProgress||null:null}))}
function create(body){const account=store.normalize(body);store.transaction(accounts=>accounts.push(account));return store.publicAccount(account)}
function edit(id,body){if(store.lock(id))throw store.error('正在保活，请等待当前任务完成后修改',409);return store.publicAccount(store.update(id,a=>store.normalize(body,a)))}
function remove(id){if(store.lock(id))throw store.error('正在保活，请等待当前任务完成后删除',409);store.transaction(accounts=>{const index=accounts.findIndex(a=>a.id===id);if(index<0)throw store.error('账号不存在',404);accounts.splice(index,1)})}
async function test(id){const account=store.read().find(a=>a.id===id);if(!account)throw store.error('账号不存在',404);return player.testConnection(account)}
async function runDue({signal}={}){for(const a of store.read()){if(a.enabled!==false&&!store.lock(a.id)&&Date.parse(store.nextDue(a))<=Date.now()){try{if(signal?.aborted)break;const result=await run(a.id,{signal});console.log(`Emby ${a.id}: ${result.ok?'成功':'失败'} · ${result.message}`)}catch(e){if(e.status!==409)throw e}}}}
module.exports={run,launch,list,create,edit,remove,test,runDue};
