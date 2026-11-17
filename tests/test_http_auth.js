const test=require("node:test"),assert=require("node:assert/strict");
const {startServer,credentials}=require("./http-helper.cjs");
const {readConfig}=require("../lib/config");
const {createAuth}=require("../lib/http/auth");
test("default and short secrets refuse startup",()=>{
 for(const env of [{},{...credentials,ADMIN_PASS:"change-this-password"},{...credentials,SESSION_SECRET:"short"},{...credentials,APP_API_TOKEN:"short"}]) assert.throws(()=>readConfig(env));
 assert.equal(readConfig(credentials).ADMIN_USER,"tester");
});
test("signed sessions expire and reject tampering and old tokens",()=>{
 let now=100000000;const auth=createAuth(credentials,{now:()=>now});
 const token=auth.signSession("tester");const req=t=>({headers:{cookie:`glados_user=tester; glados_token=${t}`}});
 assert.equal(auth.isAuthenticated(req(token)),true);assert.equal(auth.isAuthenticated(req(token+"x")),false);
 assert.equal(auth.isAuthenticated(req("old-hmac-token")),false);now+=30*24*3600*1000;
 assert.equal(auth.isAuthenticated(req(token)),false);
});
test("HTTP auth, redacted details/exports, preserved password and body limits",async t=>{
 const app=await startServer(t,{"embymb_accounts.json":[{id:"e1",name:"Example",username:"sample",password:"fixture-password",baseUrl:"https://example.test"}]});
 const cookie=await app.login();
 for(const auth of [{cookie},{token:credentials.APP_API_TOKEN}]) assert.equal((await app.request("/api/v1/health",auth)).status,200);
 assert.equal((await app.request("/api/v1/health")).status,401);
 const detail=await app.request("/api/accounts/e1",{cookie});assert.equal(detail.body.account.hasPassword,true);assert.equal("password"in detail.body.account,false);
 const update=await app.request("/api/accounts/e1",{cookie,method:"PUT",body:{name:"Renamed",password:""}});assert.equal(update.status,200);
 const fs=require("node:fs"),path=require("node:path");assert.equal(JSON.parse(fs.readFileSync(path.join(app.data,"embymb_accounts.json")))[0].password,"fixture-password");
 const exported=await app.request("/api/accounts/export",{cookie});assert.equal("password"in exported.body.accounts[0],false);assert.equal("cookie"in exported.body.accounts[0],false);
 const secrets=await app.request("/api/accounts/export?includeSecrets=1",{cookie});assert.equal(secrets.body.accounts[0].password,"fixture-password");
 assert.equal((await app.request("/api/accounts",{cookie,method:"POST",raw:"x".repeat(262145)})).status,413);
 assert.equal((await app.request("/api/accounts",{cookie,method:"POST",raw:"{"})).status,400);
 assert.equal((await app.request("/api/health")).status,200);assert.equal((await app.request("/dashboard/")).status,200);
});
test("five failures block later attempts; successful login keeps the failure window",async t=>{
 const app=await startServer(t);assert.equal((await app.request("/api/v1/dashboard",{token:credentials.APP_API_TOKEN})).status,200);const bad=()=>app.request("/api/login",{method:"POST",body:{username:"tester",password:"wrong"}});
 assert.equal((await bad()).status,401);await app.login();
 for(let i=0;i<4;i++)assert.equal((await bad()).status,401);
 assert.equal((await bad()).status,429);
 assert.equal((await app.request("/api/login",{method:"POST",body:{username:"tester",password:credentials.ADMIN_PASS}})).status,429);
});
