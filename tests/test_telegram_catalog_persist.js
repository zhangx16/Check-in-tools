const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {startServer,credentials}=require("./http-helper.cjs");
test("catalog addition persists TOML and preserves extensions through update/delete",async t=>{
 const app=await startServer(t,{"embykeeper/form.json":{telegramAccounts:[{phone:"+10000000000",apiId:"12345",apiHash:"fixture",session:"fixture-session"}],botTemplates:[{botUsername:"KeepBot",commands:["/start"],buttonSequence:["签到"],custom:{keep:true}}],custom:{keep:true}}});
 const token=credentials.APP_API_TOKEN;const catalog=await app.request("/api/v1/telegram/catalog",{token});
 assert.equal(catalog.status,200,JSON.stringify(catalog.body));const bot=catalog.body.bots.find(x=>x.available&&!x.configured);assert.ok(bot);
 assert.equal((await app.request("/api/v1/telegram/catalog",{token,method:"POST",body:{id:bot.id}})).status,201);
 assert.ok(fs.readFileSync(path.join(app.data,"embykeeper/config.toml"),"utf8").includes(bot.botUsername));
 assert.equal((await app.request("/api/v1/telegram/bots/KeepBot",{token,method:"PUT",body:{name:"renamed"}})).status,200);
 assert.equal((await app.request("/api/v1/telegram/bots/"+bot.botUsername,{token,method:"DELETE"})).status,200);
 const form=JSON.parse(fs.readFileSync(path.join(app.data,"embykeeper/form.json")));assert.deepEqual(form.custom,{keep:true});assert.deepEqual(form.botTemplates[0].buttonSequence,["签到"]);assert.deepEqual(form.botTemplates[0].custom,{keep:true});
});
