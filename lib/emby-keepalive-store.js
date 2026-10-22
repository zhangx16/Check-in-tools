const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR } = require('./common');
const FILE = path.resolve(process.env.EMBY_KEEPALIVE_FILE || path.join(DATA_DIR, 'emby_keepalive_accounts.json'));
const LOCKS = path.join(path.dirname(FILE), 'emby_keepalive_locks');
function read() {
  if (!fs.existsSync(FILE)) return [];
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!Array.isArray(data)) throw new Error('Emby 保活配置格式错误');
  return data;
}
function write(accounts) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(accounts, null, 2)+'\n', { mode:0o600 });
  fs.renameSync(temp, FILE);
}
function transaction(fn) {
  fs.mkdirSync(path.dirname(FILE),{recursive:true});
  const guard=FILE+'.lock';let acquired=false;
  for(let attempt=0;attempt<200;attempt++) {
    try{fs.writeFileSync(guard,String(process.pid),{flag:'wx',mode:0o600});acquired=true;break}
    catch(e){if(e.code!=='EEXIST')throw e;
      try{const pid=Number(fs.readFileSync(guard,'utf8'));if(pid)process.kill(pid,0)}catch(err){if(err.code==='ESRCH')try{fs.unlinkSync(guard)}catch{}}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
    }
  }
  if(!acquired)throw error('保活配置正在更新，请重试',409);
  try{const accounts=read();const result=fn(accounts);write(accounts);return result}finally{fs.unlinkSync(guard)}
}
function update(id, fn) {
  return transaction(accounts=>{const index=accounts.findIndex(a=>a.id===id);
  if(index<0) throw new Error('Emby 保活账号不存在');
  accounts[index]=fn(accounts[index]);return accounts[index];});
}
function error(message,status=400){const e=new Error(message);e.status=status;return e}
function normalize(body,current={}) {
  const name=String(body.name??current.name??'').trim();
  const raw=String(body.serverUrl??current.serverUrl??'').trim();
  let url;try{url=new URL(raw.includes('://')?raw:`https://${raw}`)}catch{throw error('请填写有效的 Emby 地址')}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw error('Emby 地址仅支持 HTTP/HTTPS，不可包含凭据、查询或片段');
  if(!url.hostname)throw error('缺少服务器地址');
  if(body.port!==undefined&&String(body.port).trim()){
    const port=Number(body.port);if(!Number.isInteger(port)||port<1||port>65535)throw error('端口须在 1–65535 之间');url.port=String(port);
  }else if(body.port==='')url.port='';
  const username=String(body.username??current.username??'').trim();
  const password=body.password?String(body.password):current.password;
  const intervalDays=Number(body.intervalDays??current.intervalDays??7);
  const watchMinSeconds=Number(body.watchMinSeconds??body.watchSeconds??current.watchMinSeconds??current.watchSeconds??300);
  const watchMaxSeconds=Number(body.watchMaxSeconds??body.watchSeconds??current.watchMaxSeconds??current.watchSeconds??1000);
  const watchSeconds=watchMinSeconds;
  const notes=String(body.notes??current.notes??'').trim();
  const clientName=String(body.clientName??current.clientName??'SenPlayer').trim();
  const deviceName=String(body.deviceName??current.deviceName??'iPhone').trim();
  const clientVersion=String(body.clientVersion??current.clientVersion??'1.0').trim();
  if([clientName,deviceName,clientVersion].some(v=>!v||v.length>80||/[\x00-\x1f\x7f"\\]/.test(v)))throw error('客户端与设备名称须为不超过 80 字的普通文本');
  if(!name||name.length>80)throw error('请填写不超过 80 字的账号名称');
  if(!username||!password)throw error('请填写 Emby 账号和密码');
  if(!Number.isInteger(intervalDays)||intervalDays<1||intervalDays>365)throw error('保活间隔须为 1–365 天');
  if(!Number.isInteger(watchMinSeconds)||!Number.isInteger(watchMaxSeconds)||watchMinSeconds<30||watchMaxSeconds>7200||watchMinSeconds>watchMaxSeconds)throw error('观看时长范围须在 30–7200 秒之间，最短不可大于最长');
  if(notes.length>2000)throw error('备注不可超过 2000 字');
  const now=new Date().toISOString();
  return {...current,id:current.id||crypto.randomUUID(),deviceId:current.deviceId||crypto.randomUUID(),name,
    serverUrl:url.href.replace(/\/+$/,''),username,password,intervalDays,watchSeconds,watchMinSeconds,watchMaxSeconds,notes,clientName,deviceName,clientVersion,
    enabled:body.enabled===undefined?current.enabled!==false:body.enabled===true,createdAt:current.createdAt||now,updatedAt:now};
}
function lockPath(id){if(!/^[a-zA-Z0-9_-]+$/.test(id))throw error('无效账号 ID');return path.join(LOCKS,id+'.json')}
function lock(id){
  const file=lockPath(id);if(!fs.existsSync(file))return null;
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  try{process.kill(data.pid,0);return data}catch(e){if(e.code!=='ESRCH')return data;fs.unlinkSync(file);return null}
}
function claim(id){
  if(lock(id))throw error('此账号正在保活，请勿重复执行',409);
  fs.mkdirSync(LOCKS,{recursive:true});const token=crypto.randomUUID();
  try{fs.writeFileSync(lockPath(id),JSON.stringify({token,pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600})}
  catch(e){if(e.code==='EEXIST')throw error('此账号正在保活',409);throw e}
  return token;
}
function own(id,token){const data=lock(id);if(!data||data.token!==token)throw error('保活任务锁已失效',409);fs.writeFileSync(lockPath(id),JSON.stringify({...data,pid:process.pid}),{mode:0o600})}
function release(id,token){const file=lockPath(id);if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).token===token)fs.unlinkSync(file)}
function nextDue(a){
  if(a.enabled===false)return null;
  if(a.lastResult?.ok===false&&a.lastAttemptAt)return new Date(Date.parse(a.lastAttemptAt)+3600000).toISOString();
  return a.lastWatchAt?new Date(Date.parse(a.lastWatchAt)+a.intervalDays*86400000).toISOString():a.createdAt;
}
function publicAccount(a){const active=lock(a.id);return {id:a.id,name:a.name,serverUrl:a.serverUrl,username:a.username,
  clientName:a.clientName||'SenPlayer',deviceName:a.deviceName||'iPhone',clientVersion:a.clientVersion||'1.0',hasPassword:Boolean(a.password),enabled:a.enabled!==false,intervalDays:a.intervalDays,watchSeconds:a.watchSeconds,watchMinSeconds:a.watchMinSeconds??a.watchSeconds,watchMaxSeconds:a.watchMaxSeconds??a.watchSeconds,notes:a.notes||'',
  lastWatchAt:a.lastWatchAt||null,lastAttemptAt:a.lastAttemptAt||null,lastWatchSeconds:a.lastWatchSeconds||0,totalWatchSeconds:a.totalWatchSeconds||0,
  lastResult:a.lastResult||null,nextRunAt:nextDue(a),running:Boolean(active),runningSince:active?.startedAt||null,createdAt:a.createdAt};}
module.exports={FILE,read,write,transaction,update,normalize,publicAccount,claim,own,release,lock,nextDue,error};
