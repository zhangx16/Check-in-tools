const fs=require("fs"), path=require("path"), crypto=require("crypto");
const held=new Map();
function acquireLock(target,{timeoutMs=5000,staleMs=30000}={}) {
 const lock=path.resolve(target), existing=held.get(lock);
 if(existing){existing.depth++;return ()=>release(lock,existing);}
 fs.mkdirSync(path.dirname(lock),{recursive:true,mode:0o700});
 const deadline=Date.now()+timeoutMs;
 while(true){
  try {
   fs.mkdirSync(lock,{mode:0o700});
   const owner={pid:process.pid,token:crypto.randomUUID(),depth:1};
   try {fs.writeFileSync(path.join(lock,"owner.json"),JSON.stringify(owner),{mode:0o600});}
   catch(error){fs.rmSync(lock,{recursive:true,force:true});throw error;}
   held.set(lock,owner);return ()=>release(lock,owner);
  }catch(error){
   if(error.code!=="EEXIST")throw error;
   try {
    const ownerFile=path.join(lock,"owner.json");
    if(fs.existsSync(ownerFile)){
     const owner=JSON.parse(fs.readFileSync(ownerFile,"utf8"));
     try {process.kill(owner.pid,0);}catch(e){if(e.code==="ESRCH"){fs.rmSync(lock,{recursive:true,force:true});continue;}}
    }else if(Date.now()-fs.statSync(lock).mtimeMs>staleMs){fs.rmSync(lock,{recursive:true,force:true});continue;}
   }catch(e){if(e.code==="ENOENT")continue;}
   if(Date.now()>=deadline)throw Object.assign(Error("数据正在写入，请稍后重试"),{status:409,code:"STORE_BUSY"});
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
  }
 }
}
function release(lock,owner){
 if(held.get(lock)!==owner)return;
 if(--owner.depth)return;
 held.delete(lock);
 try {const saved=JSON.parse(fs.readFileSync(path.join(lock,"owner.json"),"utf8"));if(saved.token===owner.token)fs.rmSync(lock,{recursive:true,force:true});}catch(e){if(e.code!=="ENOENT")throw e;}
}
function withLock(target,fn,options){const release=acquireLock(target,options);try{return fn();}finally{release();}}
module.exports={acquireLock,withLock};
