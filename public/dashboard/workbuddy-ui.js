(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const draft = Boolean(window.CHECKIN_DRAFT);
const main = document.querySelector('main > .workspace-content');
const page = document.createElement('section');
page.id = 'workbuddy-page';page.className = 'workspace-content';page.hidden = true;page.dataset.node = 'workbuddy/module';
page.innerHTML = `<section class="page-title"><div><h1>WorkBuddy</h1><p class="muted">独立管理多个账号的每日签到、成长中心和登录续期。</p></div><div class="workbuddy-toolbar"><button class="button" data-wb-refresh>刷新记录</button><button class="button primary" data-add-workbuddy>添加账号</button></div></section>
<section class="metrics" aria-label="WorkBuddy 账号统计">${[['total','账号总数','每个账号独立执行任务'],['signed','今日已签到','按北京时间统计'],['attention','需要关注','查看异常与登录状态'],['renew','自动续期','已保存有效刷新令牌']].map(([id,label,note])=>`<div data-slot="card" class="emby-stat"><span class="muted">${label}</span><strong id="wb-${id}">0</strong><span class="muted">${note}</span></div>`).join('')}</section>
<section class="overview-panel workbuddy-schedule"><div><h2>每日自动执行</h2><p class="muted">北京时间 00:05 每日签到 · 每小时 20 分检查成长任务 · 各账号独立执行</p></div><span class="badge">到期前自动续期</span></section>
<section class="projects" data-node="workbuddy/accounts"><div class="projects-heading"><div><h2>账号列表</h2><p class="muted">点击“添加账号”并完成官方登录授权，无需安装 CLI 或复制凭据。</p></div></div><div class="workbuddy-toolbar"><label class="search"><input id="wb-search" type="search" aria-label="搜索 WorkBuddy 账号" placeholder="搜索账号名称…"></label><select id="wb-filter" aria-label="筛选 WorkBuddy 账号"><option value="all">全部账号</option><option value="signed">今日已签到</option><option value="attention">需要关注</option><option value="paused">定时已暂停</option></select></div><p id="wb-feedback" role="status" aria-live="polite"></p><div id="wb-accounts"></div></section>`;
main.insertAdjacentElement('afterend', page);
let accounts = [], jobs = {}, visible = false, timer, loading = false, generation = 0;
const day = value => {try{return new Date(value).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})}catch{return ''}};
const today = () => day(new Date());
const date = value => value && Number.isFinite(+new Date(value)) ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}) : '尚无记录';
const signed = a => Boolean(a.lastStatus?.todaySigned || a.lastCheckin?.todaySigned || a.lastCheckin?.already) && (a.lastStatus?.lastSignInDate === today() || a.lastCheckin?.lastSignInDate === today() || day(a.lastCheckinAt) === today());
const needsAttention = a => a.workbuddyAuth?.refreshExpired || (a.workbuddyAuth?.expired && !a.workbuddyAuth?.hasRefreshToken) || a.lastStatus?.ok === false || a.lastCheckin?.ok === false;
async function request(url, method='GET', body) {
  const r = await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
  const data = await r.json();if(!r.ok) throw Error(data.error || 'WorkBuddy 操作失败');return data;
}
const taskLabels={success:'已完成',already:'已签到',waiting:'等待条件',pending:'待处理',failed:'未完成',observed:'已查询'};
function taskTable(account){
 const tasks=account.lastStatus?.tasks?.length?account.lastStatus.tasks:account.lastCheckin?.tasks||[];
 return `<section class="workbuddy-tasks" aria-label="任务明细"><h3>任务明细</h3>${tasks.length?`<div class="workbuddy-task-list">${tasks.map(t=>`<div class="workbuddy-task"><div><strong>${esc(t.name)}</strong><span class="badge">${esc(taskLabels[t.status]||'待检查')}</span></div><p>${esc(t.message)}</p>${t.items?.length?`<details><summary>查看 ${t.items.length} 项成长任务</summary><ul>${t.items.map(i=>`<li>${esc(i.name)} · ${esc(({not_accepted:'待接单',accepted:'已接单',in_progress:'进行中',completed:'待领奖',claimed:'已领奖'})[i.status]||i.status)}${i.locked?' · 未解锁':''}</li>`).join('')}</ul></details>`:''}${t.actions?.length>1?`<details><summary>本轮操作记录</summary><ul>${t.actions.map(a=>`<li>${esc(a.message)}</li>`).join('')}</ul></details>`:''}</div>`).join('')}</div>`:'<p class="muted">点击“查询任务”查看各项状态，或点击“全部执行”领取当前符合条件的奖励。</p>'}</section>`;
}
function render() {
  for(const [key,value] of Object.entries({total:accounts.length,signed:accounts.filter(signed).length,attention:accounts.filter(needsAttention).length,renew:accounts.filter(a=>a.workbuddyAuth?.hasRefreshToken&&!a.workbuddyAuth?.refreshExpired).length}))$('#wb-'+key).textContent=value;
  $('#nav-workbuddy').textContent=accounts.length;
  const query=$('#wb-search').value.toLowerCase(),filter=$('#wb-filter').value;
  const filtered=accounts.filter(a=>(a.name||'').toLowerCase().includes(query)&&(filter==='all'||(filter==='signed'?signed(a):filter==='attention'?needsAttention(a):a.enabled===false)));
  $('#wb-accounts').innerHTML=filtered.map(a=>{
    const running=jobs[a.id]?.state==='running',auth=a.workbuddyAuth||{},status=a.lastStatus||{},check=a.lastCheckin||{};
    const label=running?'正在执行':needsAttention(a)?'需要关注':signed(a)?'今日已签到':a.lastCheckinAt?'历史记录':'暂无记录';
    const renewal=auth.refreshExpired?'刷新令牌已到期':auth.hasRefreshToken?(auth.expired?'待自动续期':'自动续期已启用'):'需补充刷新令牌';
    return `<article class="emby-account workbuddy-account" data-node="workbuddy/account" data-account-id="${esc(a.id)}"><header><div><h2>${esc(a.name)}</h2><p class="muted">${a.enabled===false?'定时已暂停':'每日签到 + 每小时成长检查'} · ${esc(renewal)}</p></div><span class="badge">${label}</span></header><dl class="emby-facts"><div><dt>累计签到积分</dt><dd>${esc(status.points??check.balance??'—')}</dd></div><div><dt>连续签到</dt><dd>${status.currentStreak??check.currentStreak??'—'} 天</dd></div><div><dt>访问令牌有效期</dt><dd>${esc(auth.expiresAt?date(auth.expiresAt):'未知')}</dd></div><div><dt>最近执行 · 北京时间</dt><dd>${esc(date(a.lastCheckinAt||a.lastStatusAt))}</dd></div></dl><div class="emby-result"><p>${esc(jobs[a.id]?.state==='running'?jobs[a.id].message:check.message||status.message||'保存账号后，可先查询状态确认登录有效。')}</p></div>${taskTable(a)}<div class="emby-actions"><button class="button primary" data-wb-action="auto" data-id="${esc(a.id)}" ${running?'disabled':''}>${running?'执行中…':'全部执行'}</button><button class="button" data-wb-action="status" data-id="${esc(a.id)}" ${running?'disabled':''}>查询任务</button><button class="button" data-wb-edit="${esc(a.id)}">重新授权</button><button class="button" data-wb-toggle="${esc(a.id)}">${a.enabled===false?'启用定时':'暂停定时'}</button><button class="button danger" data-wb-delete="${esc(a.id)}" ${running?'disabled':''}>删除账号</button></div></article>`;
  }).join('') || `<div class="empty"><h3>${accounts.length?'没有匹配的账号':'尚未添加 WorkBuddy 账号'}</h3><p class="muted">${accounts.length?'试试其他名称或筛选条件。':'点击“添加账号”，导入第一个账号的登录凭据。'}</p></div>`;
}
async function load() {
  if(loading)return;loading=true;$('#wb-feedback').textContent='正在读取账号记录…';
  try {
    if(draft){accounts=(window.CHECKIN_DRAFT.projects||[]).filter(p=>p.provider==='workbuddy').flatMap(p=>(p.accounts||[]).map(a=>({id:a.id,name:a.accountName||a.name,lastCheckin:{ok:a.ok,todaySigned:a.todaySigned,message:a.message},lastCheckinAt:a.checkedAt,lastStatus:{points:a.balance,currentStreak:a.streak}})));}
    else {const data=await request('/api/v1/workbuddy/accounts');accounts=(data.accounts||[]).filter(a=>a.provider==='workbuddy');
      const values=await Promise.all(accounts.map(a=>request('/api/v1/workbuddy/accounts/'+encodeURIComponent(a.id)+'/job').catch(()=>({state:'idle'}))));
      jobs=Object.fromEntries(accounts.map((a,i)=>[a.id,values[i]]));}
    render();$('#wb-feedback').textContent='';
  }catch(e){$('#wb-feedback').textContent=e.message}
  finally{loading=false;schedule();}
}
function schedule(){clearTimeout(timer);if(visible&&Object.values(jobs).some(j=>j.state==='running'))timer=setTimeout(load,2500)}
function form(account) {
  return `<form class="emby-form workbuddy-form" data-account-id="${esc(account?.id||'')}"><label>账号名称<input name="name" value="${esc(account?.name||'')}" maxlength="80" required placeholder="例如：主账号 / 备用账号"></label><p>点击下方按钮生成官方登录链接，在官方页面完成登录授权后，服务器会自动保存凭据、同步账号，并执行首轮签到与成长任务。</p><p class="muted">${account?'重新授权时必须登录原账号，服务器会核对身份。':'每个账号独立保存凭据，同一账号不会重复添加。'}无需安装 CLI 或复制令牌；刷新令牌有效时会自动续期。</p><p class="workbuddy-result" role="status" aria-live="polite"></p><div class="detail-actions"><button type="button" class="button" data-wb-cancel>取消</button><button type="submit" value="authorize" class="button primary">${account?'官方登录并更新':'官方登录并添加'}</button></div><details class="workbuddy-manual"><summary>高级：手动导入已有凭据</summary><label>完整登录凭据 JSON<textarea name="session" rows="6" autocomplete="off" spellcheck="false" placeholder="包含 auth.accessToken、auth.refreshToken 和 account.uid 的完整凭据"></textarea></label><p class="muted">此入口仅用于导入已有登录文件。留空可仅修改已有账号名称。</p><button type="submit" value="import" class="button">保存导入凭据</button></details></form>`;
}
let loginTimer;
async function watchLogin(f,id,token){
 try{
  const data=await request('/api/v1/workbuddy/logins/'+id);
  if(token!==generation||!f.isConnected||!$('#details').open)return;
  const out=f.querySelector('.workbuddy-result');
  if(data.state==='completed'){
   delete f.dataset.loginId;$('#details').close();await load();await window.checkinUI.load();return;
  }
  if(data.state==='waiting'){loginTimer=setTimeout(()=>watchLogin(f,id,token),2000);return;}
  delete f.dataset.loginId;out.textContent=data.message;f.elements.name.readOnly=false;f.querySelectorAll('button').forEach(b=>b.disabled=false);
 }catch(error){if(f.isConnected)f.querySelector('.workbuddy-result').textContent=error.message;}
}
$('#details').addEventListener('close',()=>{
 clearTimeout(loginTimer);generation++;
 const f=$('#detail-content .workbuddy-form');if(f?.dataset.loginId){const id=f.dataset.loginId;delete f.dataset.loginId;request('/api/v1/workbuddy/logins/'+id,'DELETE').catch(()=>{});}
});

function edit(account) {
  generation++;$('#detail-title').textContent=account?'更新 WorkBuddy 账号':'添加 WorkBuddy 账号';$('#detail-kind').textContent='WorkBuddy';$('#detail-content').innerHTML=form(account);if(!$('#details').open)$('#details').showModal();$('#detail-content input').focus();
}
async function launch(id,action){if(draft){$('#wb-feedback').textContent='设计预览不发起实际签到';return}try{jobs[id]={state:'running',message:'正在启动后台任务…'};render();jobs[id]=await request('/api/v1/workbuddy/accounts/'+encodeURIComponent(id)+'/run','POST',{action});render();schedule();}catch(e){jobs[id]={state:'failed'};render();$('#wb-feedback').textContent=e.message}}
page.addEventListener('input',e=>{if(e.target.id==='wb-search')render()});page.addEventListener('change',e=>{if(e.target.id==='wb-filter')render()});
page.addEventListener('click',async e=>{
  if(e.target.closest('[data-add-workbuddy]'))return edit(null);
  if(e.target.closest('[data-wb-refresh]'))return load();
  const action=e.target.closest('[data-wb-action]');if(action)return launch(action.dataset.id,action.dataset.wbAction);
  const editButton=e.target.closest('[data-wb-edit]');if(editButton)return edit(accounts.find(a=>a.id===editButton.dataset.wbEdit));
  const toggle=e.target.closest('[data-wb-toggle]');if(toggle&&!draft){toggle.disabled=true;try{const a=accounts.find(a=>a.id===toggle.dataset.wbToggle);await request('/api/v1/accounts/'+encodeURIComponent(a.id),'PUT',{enabled:a.enabled===false});await load();}catch(error){$('#wb-feedback').textContent=error.message;toggle.disabled=false}return;}
  const remove=e.target.closest('[data-wb-delete]');if(remove){const a=accounts.find(a=>a.id===remove.dataset.wbDelete);$('#detail-title').textContent='删除 WorkBuddy 账号';$('#detail-kind').textContent='WorkBuddy';$('#detail-content').innerHTML=`<div class="delete-confirm"><h3>确认删除「${esc(a.name)}」？</h3><p>将删除该账号的本地凭据和签到记录，并停止自动签到。其他账号不受影响。</p><p class="workbuddy-result" role="alert"></p><div class="detail-actions"><button class="button" data-wb-cancel>取消</button><button class="button danger" data-wb-confirm-delete="${esc(a.id)}">确认删除</button></div></div>`;$('#details').showModal();}
});
$('#detail-content').addEventListener('click',async e=>{
 if(e.target.closest('[data-wb-cancel]')){$('#details').close();return}
 const button=e.target.closest('[data-wb-confirm-delete]');if(!button)return;if(draft)return;
 button.disabled=true;try{await request('/api/v1/accounts/'+encodeURIComponent(button.dataset.wbConfirmDelete),'DELETE');$('#details').close();await load();await window.checkinUI.load();}catch(error){$('#detail-content .workbuddy-result').textContent=error.message;button.disabled=false}
});
$('#detail-content').addEventListener('submit',async e=>{
 const f=e.target;if(!f.matches('.workbuddy-form'))return;e.preventDefault();const out=f.querySelector('.workbuddy-result');if(draft){out.textContent='请在已登录工作台中添加账号';return}
 const id=f.dataset.accountId,name=f.elements.name.value.trim();
 if((e.submitter?.value||'authorize')==='authorize'){
  f.querySelectorAll('button').forEach(b=>b.disabled=true);out.textContent='正在生成官方授权链接…';
  try{
   const data=await request('/api/v1/workbuddy/logins','POST',{name,...(id?{accountId:id}:{})});
   if(!f.isConnected||!$('#details').open){request('/api/v1/workbuddy/logins/'+data.id,'DELETE').catch(()=>{});return;}
   f.dataset.loginId=data.id;f.elements.name.readOnly=true;
   out.textContent=data.message+'（有效期 5 分钟）';
   const open=document.createElement('button');open.type='button';open.className='button primary workbuddy-open-login';open.textContent='打开官方授权页';open.onclick=()=>window.open(data.authUrl,'_blank','noopener,noreferrer');out.append(document.createElement('br'),open);
   watchLogin(f,data.id,++generation);
  }catch(error){out.textContent=error.message;}
  finally{if(f.isConnected)f.querySelectorAll('button').forEach(b=>b.disabled=Boolean(f.dataset.loginId)&&b.type==='submit');}
  return;
 }
 const raw=f.elements.session.value.trim();let session;
 if(raw){try{session=JSON.parse(raw)}catch{out.textContent='登录凭据不是有效 JSON';return}}
 if(!id&&!session){out.textContent='请粘贴完整登录凭据 JSON';return}
 f.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{await request('/api/v1/accounts'+(id?'/'+encodeURIComponent(id):''),id?'PUT':'POST',{provider:'workbuddy',name,...(session?{workbuddySession:session}:{})});f.elements.session.value='';$('#details').close();await load();await window.checkinUI.load();}
 catch(error){out.textContent=error.message;f.querySelectorAll('button').forEach(b=>b.disabled=false)}
});
$('#wb-search').addEventListener('keydown',e=>{if(e.key==='Escape'){e.target.value='';render()}});
window.workbuddyUI={
 show(){window.embyKeepaliveUI?.hide();visible=true;window.checkinUI.state.view='workbuddy';main.hidden=true;page.hidden=false;$('.header-left>span:last-child').textContent='WorkBuddy';document.querySelectorAll('[data-view]').forEach(b=>b.dataset.active=String(b.dataset.view==='workbuddy'));load();},
 hide(){visible=false;clearTimeout(timer);page.hidden=true;main.hidden=false;$('.header-left>span:last-child').textContent='签到总览';},
 mount(){ $('#details').close();this.show(); },refresh:load
};
const project=window.checkinUI.state.projects.find(p=>p.provider==='workbuddy');$('#nav-workbuddy').textContent=project?.accountCount||project?.accounts?.length||'—';
})();
