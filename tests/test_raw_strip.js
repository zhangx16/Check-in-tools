const test=require("node:test"),assert=require("node:assert/strict");
const {serializeAccountForStorage}=require("../lib/accounts");
test("raw stripping preserves summary values without mutating the provider result",()=>{
 const old=process.env.CHECKIN_STORE_RAW;delete process.env.CHECKIN_STORE_RAW;
 try{const account={id:'one',lastCheckin:{ok:true,message:'ok',raw:{data:{current_streak:3,current_points:100,daily_points:2,leftDays:'7',large:'x'.repeat(50000)}}}};
 const saved=serializeAccountForStorage(account);assert.equal(saved.lastCheckin.raw,undefined);assert.equal(saved.lastCheckin.currentStreak,3);assert.equal(saved.lastCheckin.balance,100);assert.equal(saved.lastCheckin.points,2);assert.equal(saved.lastCheckin.leftDays,'7');assert.ok(account.lastCheckin.raw);
 process.env.CHECKIN_STORE_RAW='1';assert.equal(serializeAccountForStorage(account).lastCheckin.raw.data.large.length,50000);
 }finally{if(old===undefined)delete process.env.CHECKIN_STORE_RAW;else process.env.CHECKIN_STORE_RAW=old;}
});
