const{test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const{once}=require('node:events');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'emby-keepalive-'));
process.env.EMBY_KEEPALIVE_FILE=path.join(tmp,'accounts.json');
const store=require('../lib/emby-keepalive-store');
const keep=require('../lib/emby-keepalive');
const player=require('../lib/emby-keepalive-player');
const input={name:'测试站',serverUrl:'http://127.0.0.1',port:'8096',username:'user',password:'private-password',intervalDays:7,watchSeconds:30,notes:'30 天内观看一次'};

test('keepalive stores credentials locally and validates rules without exposing passwords',()=>{
 const a=keep.create(input);assert.equal(a.serverUrl,'http://127.0.0.1:8096');assert.equal(a.hasPassword,true);
 assert.ok(!JSON.stringify(a).includes('private-password'));assert.equal(a.password,undefined);
 keep.edit(a.id,{name:'新名字',password:'',notes:'每 7 天一次'});assert.equal(store.read()[0].password,'private-password');
 assert.throws(()=>keep.edit(a.id,{watchSeconds:0}),/观看时长/);
 assert.throws(()=>keep.edit(a.id,{intervalDays:0}),/保活间隔/);
 assert.throws(()=>keep.create({...input,serverUrl:'https://user:secret@example.com'}),/凭据/);
 assert.equal(fs.statSync(store.FILE).mode&0o777,0o600);
 const lease=store.claim(a.id);assert.throws(()=>store.claim(a.id),/正在保活/);
 assert.throws(()=>keep.remove(a.id),/正在保活/);assert.throws(()=>keep.edit(a.id,{name:'busy'}),/正在保活/);
 store.release(a.id,lease);keep.remove(a.id);assert.equal(store.read().length,0);
});
test('verified playback advances schedule; failure preserves previous successful watch time',async()=>{
 const a=keep.create(input);
 const result=await keep.run(a.id,{playerImpl:async()=>({ok:true,verified:true,watchedSeconds:30,bytes:1024,message:'verified'})});
 assert.equal(result.ok,true);const before=store.read()[0];assert.equal(before.totalWatchSeconds,30);
 assert.equal(Date.parse(store.nextDue(before))-Date.parse(before.lastWatchAt),7*86400000);
 await keep.run(a.id,{playerImpl:async()=>{throw new Error('stream failed')}});
 const after=store.read()[0];assert.equal(after.lastWatchAt,before.lastWatchAt);assert.equal(after.totalWatchSeconds,30);assert.equal(after.lastResult.ok,false);
 assert.equal(Date.parse(store.nextDue(after))-Date.parse(after.lastAttemptAt),3600000);assert.equal(store.lock(a.id),null);
 keep.edit(a.id,{enabled:false});assert.equal(store.nextDue(store.read()[0]),null);keep.remove(a.id);
});
test('playback cursor survives partial failures and resets when changing server',async()=>{
 const a=keep.create(input);const cursor={itemId:'video',mediaSourceId:'source',positionTicks:300000000,byteOffset:2048,itemName:'视频'};
 await keep.run(a.id,{playerImpl:async(account,{onProgress})=>{
  await onProgress({watchedSeconds:10,playbackCursor:cursor});throw new Error('network lost');
 }});
 assert.deepEqual(store.read().find(x=>x.id===a.id).playbackCursor,cursor);
 assert.equal(keep.list().find(x=>x.id===a.id).lastWatchSeconds,0);
 await keep.run(a.id,{playerImpl:async account=>{
  assert.deepEqual(account.playbackCursor,cursor);
  return {ok:true,verified:true,watchedSeconds:30,playbackCursor:{...cursor,positionTicks:600000000},message:'ok'};
 }});
 assert.equal(keep.list().find(x=>x.id===a.id).playbackCursor.positionTicks,600000000);
 keep.edit(a.id,{name:'renamed'});assert.ok(keep.list().find(x=>x.id===a.id).playbackCursor);
 keep.edit(a.id,{serverUrl:'https://other.example',port:''});assert.equal(keep.list().find(x=>x.id===a.id).playbackCursor,null);
 keep.remove(a.id);
});
test('random watch duration is selected once per run within the configured bounds',async()=>{
 const a=keep.create({...input,watchMinSeconds:300,watchMaxSeconds:1000});const selected=[];
 for(let i=0;i<5;i++){await keep.run(a.id,{playerImpl:async account=>{selected.push(account.watchSeconds);return {ok:true,verified:true,watchedSeconds:account.watchSeconds,bytes:100,message:'verified'}}})}
 assert.ok(selected.every(n=>Number.isInteger(n)&&n>=300&&n<=1000));
 assert.equal(store.read()[0].lastResult.targetSeconds,selected.at(-1));
 assert.equal(store.read()[0].watchMinSeconds,300);assert.equal(store.read()[0].watchMaxSeconds,1000);
 assert.throws(()=>keep.edit(a.id,{watchMinSeconds:1000,watchMaxSeconds:300}),/观看时长/);
 keep.remove(a.id);
});
test('ambiguous player outcome is never a successful keepalive',async()=>{
 const a=keep.create(input);const result=await keep.run(a.id,{playerImpl:async()=>({ok:true,verified:false,watchedSeconds:30})});
 assert.equal(result.ok,false);assert.equal(store.read()[0].lastWatchAt,undefined);keep.remove(a.id);
});

test('startup requests retry transient timeouts while playback reports are never duplicated',async()=>{
 let calls=0;
 const c=player.createClient(store.normalize(input),async()=>{
  if(++calls===1)throw new DOMException('timeout','TimeoutError');
  return new Response(JSON.stringify({AccessToken:'test',User:{Id:'u1'}}));
 });
 await c.login();assert.equal(calls,2);
 let reports=0;
 const failing=player.createClient(store.normalize(input),async()=>{reports++;throw new DOMException('timeout','TimeoutError')});
 await assert.rejects(failing.request('Sessions/Playing',{method:'POST',body:{}}),/开始播放上报超时/);
 assert.equal(reports,1);
 const controller=new AbortController();controller.abort();
 await assert.rejects(failing.login(controller.signal),/已取消/);
});

test('incorrect resumed byte range fails without claiming a successful watch',async()=>{
 const offsets=[];let stopped=false;
 const fetchImpl=async(url,options)=>{
  const pathname=new URL(url).pathname;
  const json=data=>new Response(JSON.stringify(data));
  if(pathname.endsWith('AuthenticateByName'))return json({AccessToken:'token',User:{Id:'u'}});
  if(pathname==='/Users/u/Items')return json({Items:[{Id:'v'}]});
  if(pathname.endsWith('PlaybackInfo'))return json({PlaySessionId:'p',MediaSources:[{Id:'m',SupportsDirectPlay:true}]});
  if(pathname.includes('/Videos/')){
   const offset=Number(options.headers.Range.match(/bytes=(\d+)-/)[1]);offsets.push(offset);
   if(offset)return new Response('wrong-range',{status:206,headers:{'Content-Range':'bytes 0-99/100'}});
   return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(32));setTimeout(()=>controller.error(new Error('connection reset')),5)}}),{status:206});
  }
  if(pathname.endsWith('/Stopped'))stopped=true;
  return new Response(null,{status:204});
 };
 await assert.rejects(player.play(store.normalize(input),{fetchImpl,sleep:()=>new Promise(resolve=>setTimeout(resolve,2))}),/不支持准确的断点续传/);
 assert.deepEqual(offsets,[0,32]);assert.equal(stopped,true);
});

test('30 second playback resumes interrupted CDN streams without leaking credentials',{timeout:80000},async()=>{
 const events=[];let playedAt=null,streamBytes=0,mode='ok';const streams=new Set();const offsets=[];
 const mediaServer=http.createServer((req,res)=>{
  assert.equal(req.headers['x-emby-token'],undefined);assert.equal(req.headers['x-emby-authorization'],undefined);
  const offset=Number(req.headers.range.match(/bytes=(\d+)-/)[1]);offsets.push(offset);
  res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':`bytes ${offset}-99999999/100000000`});res.write(Buffer.alloc(8192));
  if(offsets.length===1)setTimeout(()=>res.destroy(),1000);
  const timer=setInterval(()=>{streamBytes+=8192;res.write(Buffer.alloc(8192))},200);streams.add(timer);res.on('close',()=>{clearInterval(timer);streams.delete(timer)});
 });
 mediaServer.listen(0,'127.0.0.1');await once(mediaServer,'listening');
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');let body='';for await(const b of req)body+=b;
  const json=body?JSON.parse(body):{};
  const send=d=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(d))};
  if(url.pathname==='/Users/AuthenticateByName'){assert.equal(json.Pw,'private-password');send({AccessToken:'test-access',User:{Id:'u1'}});return}
  assert.equal(req.headers['x-emby-token'],'test-access');
  if(url.pathname==='/Users/u1/Items'){send({Items:[{Id:'v1',Name:'测试视频'}]});return}
  if(url.pathname==='/Items/v1/PlaybackInfo'){send({PlaySessionId:'play1',MediaSources:[{Id:'m1',SupportsDirectPlay:true}]});return}
  if(url.pathname==='/Videos/v1/stream'){
   res.writeHead(302,{Location:`http://127.0.0.1:${mediaServer.address().port}/signed-media`});res.end();return;
  }
  if(url.pathname.startsWith('/Sessions/Playing')){
   events.push({path:url.pathname,position:json.PositionTicks});
   if(url.pathname.endsWith('/Stopped'))playedAt=new Date().toISOString();res.writeHead(204);res.end();return;
  }
  if(url.pathname==='/Users/u1/Items/v1'){send({Id:'v1',Name:'测试视频',RunTimeTicks:36000000000,UserData:{LastPlayedDate:mode==='stale'?'2020-01-01T00:00:00Z':playedAt}});return}
  res.writeHead(404);res.end();
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const account={...store.normalize(input),serverUrl:`http://127.0.0.1:${server.address().port}`};
 try{
  const connection=await player.testConnection(account);assert.equal(connection.hasMedia,true);
  const progress=[];const start=Date.now();
  const result=await player.play(account,{onProgress:async p=>progress.push(p.watchedSeconds)});
  assert.ok(Date.now()-start>=30000);assert.equal(result.ok,true);assert.equal(result.verified,true);assert.equal(result.watchedSeconds,30);
  assert.ok(streamBytes>0);assert.ok(result.bytes>0);assert.ok(progress.length>=3);
  assert.equal(result.reconnects,1);assert.equal(offsets[0],0);assert.ok(offsets[1]>0);
  assert.equal(events[0].path,'/Sessions/Playing');assert.equal(events.at(-1).path,'/Sessions/Playing/Stopped');assert.equal(events.at(-1).position,300000000);
  assert.equal(result.playbackCursor.positionTicks,300000000);
  const eventCount=events.length;
  const resumed=await player.play({...account,playbackCursor:result.playbackCursor});
  assert.equal(events[eventCount].position,300000000);
  assert.equal(resumed.startPositionTicks,300000000);
  assert.equal(resumed.endPositionTicks,600000000);
  assert.equal(resumed.watchedSeconds,30);
  assert.equal(events.at(-1).position,600000000);
  assert.ok(offsets.includes(result.playbackCursor.byteOffset));
  const controller=new AbortController();setTimeout(()=>controller.abort(),50);
  await assert.rejects(player.play(account,{signal:controller.signal}));
  assert.equal(events.at(-1).path,'/Sessions/Playing/Stopped');
 }finally{for(const timer of streams)clearInterval(timer);server.closeAllConnections();mediaServer.closeAllConnections();await new Promise(r=>server.close(r));await new Promise(r=>mediaServer.close(r));fs.rmSync(tmp,{recursive:true,force:true})}
});
