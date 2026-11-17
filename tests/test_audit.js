const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {startServer,credentials}=require("./http-helper.cjs");
test("account deletion appends a credential-free audit record",async t=>{
 const app=await startServer(t,{"accounts.json":[{id:"one",name:"fixture",cookie:"private-fixture-cookie"}]});
 assert.equal((await app.request("/api/v1/accounts/one",{token:credentials.APP_API_TOKEN,method:"DELETE"})).status,200);
 const text=fs.readFileSync(path.join(app.data,"audit.log.jsonl"),"utf8"),record=JSON.parse(text.trim());
 assert.equal(record.action,"DELETE");assert.equal(record.actor,"api-token");assert.equal(record.ok,true);assert.ok(record.ts);assert.equal(text.includes("private-fixture-cookie"),false);assert.equal(text.includes(credentials.APP_API_TOKEN),false);
});
