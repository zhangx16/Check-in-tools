const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{spawn}=require("node:child_process");
test("twenty independent writers retain all additions and execution merges preserve edits/deletions",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"checkin-store-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.cpSync(path.resolve(__dirname,"../lib"),path.join(root,"lib"),{recursive:true});
 const run=code=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,["-e",code],{cwd:root,env:{PATH:process.env.PATH},stdio:["ignore","ignore","pipe"]});let err="";child.stderr.on("data",x=>err+=x);child.on("error",reject);child.on("exit",c=>c?reject(Error(err)):resolve());});
 await Promise.all(Array.from({length:20},(_,i)=>run(`const r=require('./lib/accounts');r.updateAccounts(a=>[...a,{id:'${i}',provider:'glados',name:'fixture'}]);`)));
 const read=()=>JSON.parse(fs.readFileSync(path.join(root,"data/accounts.json")));
 assert.equal(read().length,20);assert.equal(new Set(read().map(a=>a.id)).size,20);
 await run(`const r=require('./lib/accounts');r.updateAccounts(a=>a.filter(x=>x.id!=='0').map(x=>({...x,name:'edited'})));r.commitAccountRuns('glados',[{id:'0',name:'old',lastCheckin:{ok:true}},{id:'1',name:'old',lastCheckin:{ok:true}}]);`);
 assert.equal(read().length,19);assert.equal(read().find(a=>a.id==='1').name,'edited');assert.equal(read().find(a=>a.id==='1').lastCheckin.ok,true);
 assert.equal(fs.statSync(path.join(root,'data/accounts.json')).mode&0o777,0o600);
});
