const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {once}=require('node:events');

test('authenticated project deletion preserves unrelated configuration and permits an empty bot list',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'checkin-delete-'));
 const project=path.resolve(__dirname,'..');
 fs.copyFileSync(path.join(project,'server.js'),path.join(root,'server.js'));
 fs.cpSync(path.join(project,'lib'),path.join(root,'lib'),{recursive:true});
 const data=path.join(root,'data');fs.mkdirSync(path.join(data,'embykeeper'),{recursive:true});
 const write=(name,value)=>fs.writeFileSync(path.join(data,name),JSON.stringify(value));
 const read=name=>JSON.parse(fs.readFileSync(path.join(data,name),'utf8'));
 const kept={botUsername:'KeepBot',name:'Keep',commands:['/start'],buttonSequence:['用户配置','每日签到'],extraField:{preserve:true}};
 write('embykeeper/form.json',{telegramAccounts:[{phone:'+12345678901',session:'keep-session'}],botTemplates:[{botUsername:'FooBot',name:'Foo'},kept],globalCheckiner:{},custom:{keep:true}});
 write('telegram_bot_checkin_results.json',{bots:{'@FOOBOT':{accounts:[]},KeepBot:{accounts:[]}}});
 write('telegram_bot_checkin_skip.json',{'+12345678901':{FOOBOT:{reason:'old'},KeepBot:{reason:'keep'}}});
 write('accounts.json',[{id:'g1',name:'g1',cookie:'private'},{id:'g2',name:'g2',cookie:'private'}]);
 write('embymb_accounts.json',[{id:'e1',name:'keep',password:'private'}]);
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(port),ADMIN_USER:'test-admin',ADMIN_PASS:'test-password',APP_API_TOKEN:'',CHECKIN_API_TOKEN:''},stdio:'ignore'});
 const origin=`http://127.0.0.1:${port}`;
 try{
  for(let i=0;i<60;i++){try{await fetch(origin+'/api/session');break}catch{await new Promise(r=>setTimeout(r,50))}}
  const request=(id,cookie)=>fetch(origin+'/api/v1/dashboard/projects/'+encodeURIComponent(id),{method:'DELETE',headers:cookie?{Cookie:cookie}:{}});
  assert.equal((await request('tg:FooBot')).status,401);
  assert.equal(read('embykeeper/form.json').botTemplates.length,2);
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'test-admin',password:'test-password'})});
  assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const rename = (id, name, auth = cookie) => fetch(origin+'/api/v1/dashboard/projects/'+encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Content-Type':'application/json', ...(auth ? { Cookie:auth } : {}) }, body:JSON.stringify({name})
  });
  assert.equal((await rename('tg:FooBot','未授权', '')).status,401);
  const renamed = await rename('tg:FOOBOT',' 我的机器人 ');
  assert.equal(renamed.status,200); assert.equal((await renamed.json()).title,'我的机器人');
  assert.equal(read('project_names.json')['tg:foobot'],'我的机器人');
  assert.equal((await rename('web:glados','我的 GLaDOS')).status,200);
  assert.equal(read('project_names.json')['web:glados'],'我的 GLaDOS');
  assert.equal((await rename('web:glados','a'.repeat(61))).status,400);
  assert.equal((await rename('web:glados','first\nsecond')).status,400);
  assert.equal((await rename('tg:missing','test')).status,404);
  assert.deepEqual(read('embykeeper/form.json').botTemplates[1],kept);
  const reset = await rename('web:glados','');
  assert.equal((await reset.json()).title,'GLaDOS');
  assert.equal(read('project_names.json')['web:glados'],undefined);
  assert.equal((await request('tg:foobot',cookie)).status,200);
  assert.deepEqual(read('embykeeper/form.json').botTemplates,[kept]);
  assert.equal(read('project_names.json')['tg:foobot'],undefined);
  assert.equal(read('embykeeper/form.json').telegramAccounts[0].session,'keep-session');
  assert.deepEqual(read('embykeeper/form.json').custom,{keep:true});
  assert.deepEqual(Object.keys(read('telegram_bot_checkin_results.json').bots),['KeepBot']);
  assert.deepEqual(Object.keys(read('telegram_bot_checkin_skip.json')['+12345678901']),['KeepBot']);
  assert.equal((await request('tg:FooBot',cookie)).status,404);
  assert.equal((await request('web:glados',cookie)).status,200);
  assert.deepEqual(read('accounts.json'),[]);assert.equal(read('embymb_accounts.json').length,1);
  assert.equal((await request('web:unknown',cookie)).status,404);
  assert.equal((await request('tg:KeepBot',cookie)).status,200);
  assert.deepEqual(read('embykeeper/form.json').botTemplates,[]);
  const bots=await (await fetch(origin+'/api/v1/telegram/bots',{headers:{Cookie:cookie}})).json();
  assert.deepEqual(bots.bots,[]);
 }finally{child.kill('SIGTERM');await once(child,'exit');fs.rmSync(root,{recursive:true,force:true})}
});
