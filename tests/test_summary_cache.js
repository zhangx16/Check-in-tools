const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {MemoryCache}=require("../lib/cache/memory"),{createIconCache}=require("../lib/icons/cache");
const {startServer,credentials}=require("./http-helper.cjs");
test("TTL cache isolates caller mutations and expires",()=>{let now=0;const cache=new MemoryCache({now:()=>now,ttlMs:30});cache.set('a',{x:1});cache.get('a').x=9;assert.equal(cache.get('a').x,1);now=30;assert.equal(cache.get('a'),undefined);});
test("icon miss returns immediately, fetches once in the background, then uses disk",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'checkin-icons-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let calls=0;
 const get=createIconCache(root,'site-icons',async key=>{calls++;fs.writeFileSync(path.join(root,key+'.png'),'image');fs.writeFileSync(path.join(root,key+'.meta.json'),JSON.stringify({fetchedAt:Date.now()}));},700000,{enabled:true});
 assert.equal(get('fixture'),null);assert.equal(get('fixture'),null);assert.equal(calls,0);
 await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(get('fixture'),'/site-icons/fixture.png');assert.equal(calls,1);
});
test("offline dashboard stays fast across fifty requests and invalidates on account changes",async t=>{
 const app=await startServer(t,{"accounts.json":[{id:'one',name:'one',cookie:'fixture',lastCheckin:{ok:true,message:'ok'}}]});
 const auth={token:credentials.APP_API_TOKEN};assert.equal((await app.request('/api/v1/dashboard',auth)).status,200);
 const times=[];for(let i=0;i<50;i++){const start=performance.now();const res=await app.request('/api/v1/dashboard',auth);assert.equal(res.status,200);assert.equal(res.body.projects[0].avatarURL,null);times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);t.diagnostic('dashboard p95 = '+times[47].toFixed(2)+' ms');assert.ok(times[47]<50);
 await app.request('/api/v1/accounts/one',{...auth,method:'PUT',body:{name:'changed'}});
 assert.equal((await app.request('/api/v1/summary',auth)).body.items[0].accountName,'changed');
});
