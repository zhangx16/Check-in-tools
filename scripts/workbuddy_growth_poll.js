#!/usr/bin/env node
// Hourly idempotent reward check. No Telegram notification for routine polls.
const { loadLocalEnv } = require('../lib/common');loadLocalEnv();
const { readProviderAccounts, writeProviderAccounts } = require('../lib/accounts');
const wb = require('../lib/providers/workbuddy');
async function main(){
 let failed=false;
 for(const original of readProviderAccounts('workbuddy').filter(a=>a.enabled!==false)){
  const processed=await wb.runAccountCheckin(original);
  const latest=readProviderAccounts('workbuddy');
  const current=latest.find(a=>a.id===original.id);
  if(current&&processed.account.lastCheckin.code!=='BUSY'&&JSON.stringify(current.workbuddySession)===JSON.stringify(original.workbuddySession)){
   writeProviderAccounts('workbuddy',latest.map(a=>a.id===original.id?wb.mergeRun(a,processed.account):a));
  }
  const result=processed.account.lastCheckin;
  console.log(JSON.stringify({account:original.name,ok:result.ok,message:result.message}));
  if(!result.ok&&result.code!=='BUSY')failed=true;
 }
 if(failed)process.exitCode=1;
}
if(require.main===module)main().catch(()=>{console.error('WorkBuddy 成长任务轮询失败');process.exitCode=1});
module.exports={main};
