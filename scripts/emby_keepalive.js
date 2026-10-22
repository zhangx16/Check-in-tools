#!/usr/bin/env node
require('../lib/common').loadLocalEnv();
const keepalive=require('../lib/emby-keepalive');
const args=process.argv.slice(2);
const value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
const controller=new AbortController();
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>controller.abort());
const id=value('--account');
const job=id?keepalive.run(id,{lease:value('--lease'),signal:controller.signal}):keepalive.runDue({signal:controller.signal});
job.then(result=>{if(id){console.log(result.message);if(!result.ok)process.exitCode=1}}).catch(error=>{console.error(error.message);process.exitCode=1});
