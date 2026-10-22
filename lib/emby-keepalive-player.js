const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
function createClient(account, fetchImpl=fetch) {
  const base=new URL(account.serverUrl.replace(/\/+$/,'')+'/');let token='',userId='';
  const auth=`MediaBrowser Client="${account.clientName||'SenPlayer'}", Device="${account.deviceName||'iPhone'}", DeviceId="${account.deviceId}", Version="${account.clientVersion||'1.0'}"`;
  function url(route,params={}) {
    const u=new URL(route.replace(/^\//,''),base);
    if(u.origin!==base.origin)throw new Error('拒绝向其他域名发送 Emby 凭据');
    for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));return u;
  }
  const headers=()=>({'X-Emby-Authorization':auth,'X-Emby-Client':account.clientName||'SenPlayer','X-Emby-Device-Name':account.deviceName||'iPhone','X-Emby-Device-Id':account.deviceId,'X-Emby-Client-Version':account.clientVersion||'1.0','User-Agent':`${account.clientName||'SenPlayer'}/${account.clientVersion||'1.0'} (iPhone; iOS 18.0)`,...(token?{'X-Emby-Token':token}:{}),Accept:'application/json','Content-Type':'application/json'});
  async function request(route,{method='GET',params={},body,signal}={}) {
    const stage=route.includes('AuthenticateByName')?'登录':route.endsWith('PlaybackInfo')?'获取播放信息':route.includes('Sessions/Playing/Stopped')?'结束播放上报':route.includes('Sessions/Playing/Progress')?'播放进度上报':route.includes('Sessions/Playing')?'开始播放上报':route.endsWith('/Items')?'读取媒体库':'验证观看记录';
    const retryable=method==='GET'||route.endsWith('PlaybackInfo')||route.includes('AuthenticateByName');
    let response;
    for(let attempt=0;attempt<2;attempt++){
      try{response=await fetchImpl(url(route,params),{method,headers:headers(),...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),redirect:'error'});break}
      catch(e){
        if(signal?.aborted)throw new Error('保活任务已取消');
        const timedOut=e.name==='TimeoutError'||e.name==='AbortError';
        if(attempt===0&&retryable&&(timedOut||e.name==='TypeError')){await delay(250,undefined,signal?{signal}:undefined);continue}
        if(timedOut)throw new Error(`${stage}超时（每次等待 30 秒${retryable?'，已重试一次':''}）`);
        throw new Error(`${stage}失败：${e.name==='TypeError'?'网络连接中断':e.message}`);
      }
    }
    if(!response.ok){const e=new Error(response.status===401?'Emby 账号密码错误或登录已失效':response.status===403?'Emby 账号无访问权限':`Emby 接口请求失败（HTTP ${response.status}）`);e.httpStatus=response.status;throw e}
    if(response.status===204)return null;
    const text=await response.text();if(!text)return null;
    try{return JSON.parse(text)}catch{throw new Error('Emby 接口返回格式错误，请检查服务器地址与端口')}
  }
  async function login(signal){const data=await request('Users/AuthenticateByName',{method:'POST',body:{Username:account.username,Pw:account.password},signal});
    if(!data?.AccessToken||!data.User?.Id)throw new Error('Emby 登录未返回有效会话');token=data.AccessToken;userId=data.User.Id;return data.User;}
  return {request,login,url,headers,get userId(){return userId},get token(){return token},base};
}
async function testConnection(account, options={}) {
  const client=createClient(account,options.fetchImpl);await client.login();
  const items=await client.request(`Users/${encodeURIComponent(client.userId)}/Items`,{params:{Recursive:true,IncludeItemTypes:'Movie,Episode',Limit:1,IsVirtualItem:false}});
  return {ok:true,message:items?.Items?.length?'登录正常，可访问媒体库':'登录正常，媒体库暂无可播放视频',hasMedia:Boolean(items?.Items?.length)};
}
async function play(account,{fetchImpl=fetch,sleep=delay,now=()=>performance.now(),wallNow=()=>new Date(),signal,onProgress=async()=>{}}={}) {
  const client=createClient(account,fetchImpl);await client.login(signal);
  const list=await client.request(`Users/${encodeURIComponent(client.userId)}/Items`,{params:{Recursive:true,IncludeItemTypes:'Movie,Episode',IsVirtualItem:false,SortBy:'Random',Limit:50,Fields:'MediaSources,RunTimeTicks,UserData'},signal});
  const candidates=(list?.Items||[]).filter(i=>i.Id&&!i.IsFolder);
  const runtime=i=>Number(i.RunTimeTicks||i.MediaSources?.[0]?.RunTimeTicks||0);
  const item=candidates.find(i=>runtime(i)>account.watchSeconds*10000000)||candidates.find(i=>!runtime(i));
  if(!item)throw new Error('媒体库中没有时长足够的可播放视频');
  const info=await client.request(`Items/${encodeURIComponent(item.Id)}/PlaybackInfo`,{method:'POST',params:{UserId:client.userId,IsPlayback:true,AutoOpenLiveStream:true,StartTimeTicks:0},body:{UserId:client.userId,StartTimeTicks:0,IsPlayback:true,AutoOpenLiveStream:true,EnableDirectPlay:true,EnableDirectStream:true,EnableTranscoding:false},signal});
  const source=(info?.MediaSources||[]).find(s=>s.Id&&(s.SupportsDirectPlay||s.SupportsDirectStream));
  if(!source||!info.PlaySessionId)throw new Error('此媒体未提供可用的直连播放会话（不强制转码）');
  const common={ItemId:item.Id,MediaSourceId:source.Id,PlaySessionId:info.PlaySessionId,PlayMethod:'DirectStream',IsPaused:false,IsMuted:false,CanSeek:true,RepeatMode:'RepeatNone',VolumeLevel:100,PlaybackRate:1,AudioStreamIndex:-1,SubtitleStreamIndex:-1,SubtitleOffset:0,PlaybackStartTimeTicks:Date.now()*10000,PlaylistLength:1,PlaylistIndex:0,NowPlayingQueue:[{Id:item.Id,PlaylistItemId:'playlistItem0'}]};
  const mediaController=new AbortController();const combined=signal?AbortSignal.any([signal,mediaController.signal]):mediaController.signal;
  let bytes=0,streamError=null,streamDone=false,started=false,reader,watched=0,startAt,startedAt,initialBytes;
  let pump,lastByteAt=now();
  let reconnects=0;
  async function openMedia(offset){
    const timeout=new AbortController();
    const timer=setTimeout(()=>timeout.abort(),60000);
    const requestSignal=AbortSignal.any([combined,timeout.signal]);
    let nextReader;
    try{
      let mediaUrl=source.DirectStreamUrl?new URL(source.DirectStreamUrl,client.base):client.url(`Videos/${encodeURIComponent(item.Id)}/stream`,{Static:true,MediaSourceId:source.Id,PlaySessionId:info.PlaySessionId});
      let response;
      for(let redirects=0;redirects<=5;redirects++){
        if(!['http:','https:'].includes(mediaUrl.protocol)||mediaUrl.username||mediaUrl.password)throw new Error('无效的媒体流地址');
        response=await fetchImpl(mediaUrl,{headers:{...(mediaUrl.origin===client.base.origin?client.headers():{}),Range:`bytes=${offset}-`},signal:requestSignal,redirect:'manual'});
        if(![301,302,303,307,308].includes(response.status))break;
        const location=response.headers.get('location');if(response.body)await response.body.cancel().catch(()=>{});
        if(!location||redirects===5)throw new Error('媒体流跳转次数过多或地址无效');
        mediaUrl=new URL(location,mediaUrl);
      }
      if(!response.ok||!response.body)throw new Error(`无法读取 Emby 媒体流（HTTP ${response.status}）`);
      if(offset){
        const range=response.headers.get('content-range');
        if(response.status!==206||!range||!range.startsWith(`bytes ${offset}-`)){
          await response.body.cancel().catch(()=>{});
          throw new Error('媒体源不支持准确的断点续传，未记为保活成功');
        }
      }
      nextReader=response.body.getReader();const first=await nextReader.read();
      if(first.done||!first.value?.length)throw new Error('媒体流没有返回有效数据');
      reader=nextReader;bytes+=first.value.length;lastByteAt=now();
    }catch(error){
      if(nextReader)await nextReader.cancel().catch(()=>{});
      if(timeout.signal.aborted)throw new Error('等待媒体流首字节超时（60 秒）');
      throw error;
    }finally{clearTimeout(timer)}
  }
  try {
    await openMedia(0);initialBytes=bytes;
    // Continue streaming; reconnect by verified byte range without resetting playback position.
    pump=(async()=>{
      while(!combined.aborted){
        try{
          const r=await reader.read();if(r.done){streamDone=true;break}
          bytes+=r.value.length;lastByteAt=now();
          await sleep(Math.max(100,r.value.length/65536*1000),undefined,{signal:combined});
        }catch(error){
          if(combined.aborted)break;
          if(reconnects>=2){streamError=error;break}
          reconnects++;
          await reader.cancel().catch(()=>{});
          try{await sleep(1000,undefined,{signal:combined});await openMedia(bytes)}
          catch(retryError){if(!combined.aborted)streamError=retryError;break}
        }
      }
    })();
    started=true;await client.request('Sessions/Playing',{method:'POST',body:{...common,PositionTicks:0},signal});startAt=now();startedAt=wallNow().toISOString();
    while(watched<account.watchSeconds){
      if(signal?.aborted)throw new Error('保活任务已取消');
      const seconds=Math.min(10,account.watchSeconds-watched);
      await sleep(seconds*1000,undefined,signal?{signal}:undefined);
      watched=Math.min(account.watchSeconds,Math.floor((now()-startAt)/1000));
      if(streamError)throw new Error(`媒体流读取中断，续传失败：${streamError.message||'连接中断'}，未记为保活成功`);
      if(now()-lastByteAt>30000)throw new Error('媒体流超过 30 秒未返回新数据，未记为保活成功');
      if(streamDone&&watched<account.watchSeconds)throw new Error('媒体流提前结束，未完成设定观看时长');
      await client.request('Sessions/Playing/Progress',{method:'POST',body:{...common,EventName:'timeupdate',PositionTicks:watched*10000000},signal});
      await onProgress({watchedSeconds:watched,bytes,reconnects,itemName:item.Name||'未命名视频'});
    }
    if(bytes<=initialBytes)throw new Error('媒体流未持续返回数据，未记为保活成功');
    await client.request('Sessions/Playing/Stopped',{method:'POST',body:{...common,NowPlayingQueue:[],PositionTicks:watched*10000000},signal});started=false;
    const detail=await client.request(`Users/${encodeURIComponent(client.userId)}/Items/${encodeURIComponent(item.Id)}`,{signal});
    const played=Date.parse(detail?.UserData?.LastPlayedDate||'');
    if(!Number.isFinite(played)||played<Date.parse(startedAt)-10000)throw new Error('已完成播放，但服务器未确认最新观看记录；请核对站点规则');
    return {ok:true,message:'播放完成，服务器已确认观看记录',watchedSeconds:watched,bytes,reconnects,itemName:item.Name||'未命名视频',serverLastPlayedAt:detail.UserData.LastPlayedDate,verified:true};
  } catch(error) {
    if(signal?.aborted)throw new Error('保活任务已取消');
    throw error;
  } finally {
    mediaController.abort();if(reader)await reader.cancel().catch(()=>{});if(pump)await pump.catch(()=>{});
    if(started)await client.request('Sessions/Playing/Stopped',{method:'POST',body:{...common,NowPlayingQueue:[],PositionTicks:watched*10000000}}).catch(()=>{});
  }
}
module.exports={createClient,testConnection,play};
