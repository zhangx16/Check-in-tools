(() => {
'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={success:'签到成功',already:'今日已签',failed:'执行失败',skipped:'已跳过',unknown:'暂无记录',partial:'需要关注'};
const state={projects:[],kind:'all',status:'all',query:'',page:1,size:10,view:'all',loading:false};
const draft=Boolean(window.CHECKIN_DRAFT), today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let generatedAt='',toastTimer;
const dateKey=v=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))}catch{return ''}};
const healthy=p=>['success','already'].includes(p.status), attention=p=>['failed','partial','skipped'].includes(p.status);
const masked=v=>String(v||'账号').replace(/\+?\d{7,}/g,m=>'···'+m.slice(-4));
const effectiveStatus=a=>a.status || (a.skipped?'skipped':a.ok?(a.already?'already':'success'):'failed');
const recordLabel=(s,at)=>s==='already'&&at&&dateKey(at)!==today?'当日已签':labels[s]||labels.unknown;
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4000)}
function dateParts(at){if(!at)return '<span class="muted">尚未执行</span>';const d=new Date(at);if(Number.isNaN(+d))return '<span class="muted">时间未知</span>';const date=d.toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit',timeZone:'Asia/Shanghai'});return `<div>${date}<span class="date-note muted"> ${d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'})}</span></div><div class="date-note muted">${dateKey(at)===today?'今天':'历史记录'}</div>`}
function counts(){return{total:state.projects.length,healthy:state.projects.filter(healthy).length,attention:state.projects.filter(attention).length,pending:state.projects.filter(p=>p.status==='unknown').length}}
function filtered(){return state.projects.filter(p=>(state.kind==='all'||p.kind===state.kind)&&(state.status==='all'||(state.status==='healthy'?healthy(p):state.status==='attention'?attention(p):p.status===state.status))&&`${p.title} ${p.subtitle} ${p.botUsername||''}`.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()))}
function render(){const c=counts();for(const [id,n] of Object.entries({projects:c.total,healthy:c.healthy,attention:c.attention,pending:c.pending}))$(`#metric-${id}`).textContent=n;
for(const [id,n]of Object.entries({all:c.total,website:state.projects.filter(p=>p.kind==='website').length,telegram_bot:state.projects.filter(p=>p.kind==='telegram_bot').length,attention:c.attention}))$(`#nav-${id}`).textContent=n;
$('#distribution').innerHTML=`<div class="distribution-bar" aria-label="正常 ${c.healthy}，需要关注 ${c.attention}，暂无记录 ${c.pending}">${[['',c.healthy],['segment-attention',c.attention],['segment-pending',c.pending]].map(([cl,n])=>n?`<span class="${cl}" style="flex:${n}"></span>`:'').join('')}</div><div class="legend"><span><i class="dot"></i>正常 ${c.healthy}</span><span><i class="dot attention"></i>关注 ${c.attention}</span><span><i class="dot pending"></i>暂无记录 ${c.pending}</span></div>`;
const list=filtered(),pages=Math.max(1,Math.ceil(list.length/state.size));state.page=Math.min(state.page,pages);const slice=list.slice((state.page-1)*state.size,state.page*state.size);
$('#result-count').textContent=`${list.length} 个项目`;$('#list-title').textContent=state.view==='attention'?'需要关注':state.kind==='website'?'网站签到':state.kind==='telegram_bot'?'Telegram Bot':'全部项目';
$('#project-rows').innerHTML=slice.map(p=>{const accounts=p.accounts||[],ok=accounts.filter(a=>['success','already'].includes(effectiveStatus(a))).length;return `<tr data-node="projects/row-${esc(p.id)}"><td><div class="project-name"><span class="project-avatar" aria-hidden="true">${esc(p.title.slice(0,2))}</span><div class="project-identity"><button class="project-title" data-detail="${esc(p.id)}">${esc(p.title)}</button><div class="project-subtitle muted">${esc(p.subtitle||p.providerLabel||'')}</div></div></div></td><td><span class="badge status-badge">${healthy(p)?'<span aria-hidden="true">✓</span>':p.status==='unknown'?'<span aria-hidden="true">−</span>':'<span aria-hidden="true">!</span>'}${esc(recordLabel(p.status,p.checkedAt))}</span><div class="status-note muted">${p.status==='unknown'?'等待首次签到记录':attention(p)?'查看账号详情了解原因':'最近执行已确认'}</div></td><td class="account-col"><div>${accounts.length||p.accountCount||0} 个账号</div><div class="status-note muted">${ok} 正常 · ${accounts.length-ok} 待关注</div></td><td>${dateParts(p.checkedAt)}</td><td><button class="icon-button" data-detail="${esc(p.id)}" aria-label="查看 ${esc(p.title)} 详情">›</button></td></tr>`}).join('');
$('#empty').hidden=list.length>0;$('.table-scroll').hidden=list.length===0;$('#page-info').textContent=list.length?`第 ${state.page} / ${pages} 页 · 共 ${list.length} 项`:'0 个项目';$('#prev').disabled=state.page<=1;$('#next').disabled=state.page>=pages;
$$('[data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===state.kind)));$$('[data-view]').forEach(b=>b.dataset.active=String(b.dataset.view===state.view));$('#status-filter').value=state.status;
}
function reset(){Object.assign(state,{kind:'all',status:'all',query:'',page:1,view:'all'});$('#search').value='';render()}
function detail(id){const p=state.projects.find(p=>p.id===id);if(!p)return;$('#detail-title').textContent=p.title;$('#detail-kind').textContent=p.kind==='website'?'网站签到':'Telegram Bot';$('#detail-content').innerHTML=`<p class="muted" style="margin-bottom:16px;font-size:12px">${esc(p.subtitle||'')} · 状态以最近记录为准</p>`+(p.accounts||[]).map((a,i)=>`<section class="account-detail" data-node="project-details/account-${i}"><div class="account-detail-head"><strong>${esc(masked(a.phone||a.accountName||a.name||`账号 ${i+1}`))}</strong><span class="badge">${esc(recordLabel(effectiveStatus(a),a.checkedAt||p.checkedAt))}</span></div><p>${esc(masked(a.message||'暂未产生签到记录'))}</p><p class="muted">${esc(a.checkedAt?new Date(a.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'尚未执行')} · 北京时间</p></section>`).join('');if(!(p.accounts||[]).length)$('#detail-content').innerHTML+='<p>已配置签到，等待首次执行。</p>';$('#detail-content').insertAdjacentHTML('beforeend', `<div class="detail-actions"><button class="button" data-rename-project="${esc(p.id)}">修改名称</button><button class="button danger" data-delete-project="${esc(p.id)}">删除项目</button></div>`);if(!$('#details').open)$('#details').showModal()}
let deleting=false,renaming=false;
async function saveProjectName(id,name){
 if(renaming)return;renaming=true;
 const form=$('#rename-form');form.querySelectorAll('button').forEach(b=>b.disabled=true);$('#close-details').disabled=true;
 try{
  const p=state.projects.find(p=>p.id===id);if(!p)throw Error('项目不存在');
  let data={title:name.trim()||p.defaultTitle||p.title,defaultTitle:p.defaultTitle||p.title};
  if(!draft){const r=await fetch('/api/v1/dashboard/projects/'+encodeURIComponent(id),{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});const result=await r.json();if(!r.ok)throw Error(result.error||'名称保存失败');data=result}
  p.title=data.title;p.defaultTitle=data.defaultTitle;render();if(!draft)await load();detail(id);toast(name.trim()?'项目名称已更新':'已恢复默认名称');
 }catch(error){$('#rename-error').textContent=error.message;form.querySelectorAll('button').forEach(b=>b.disabled=false)}
 finally{renaming=false;$('#close-details').disabled=false}
}
$('#detail-content').addEventListener('submit',e=>{if(e.target.id==='rename-form'){e.preventDefault();saveProjectName(e.target.dataset.projectId,new FormData(e.target).get('name'))}});
$('#detail-content').addEventListener('click',e=>{
 const button=e.target.closest('[data-rename-project]');
 if(button){const p=state.projects.find(p=>p.id===button.dataset.renameProject);if(!p)return;p.defaultTitle=p.defaultTitle||p.title;
 $('#detail-content').innerHTML=`<form id="rename-form" class="rename-form" data-node="project-details/rename" data-project-id="${esc(p.id)}"><label for="project-name">项目显示名称</label><input id="project-name" name="name" maxlength="60" value="${esc(p.title)}" autocomplete="off" aria-describedby="rename-help"><p class="muted" id="rename-help">最多 60 字。留空恢复默认名称；不会修改签到账号或机器人地址。</p><p id="rename-error" role="alert"></p><div class="detail-actions"><button type="button" class="button" data-reset-name="${esc(p.id)}">恢复默认</button><button type="button" class="button" data-cancel-rename="${esc(p.id)}">取消</button><button type="submit" class="button primary">保存名称</button></div></form>`;$('#project-name').focus();$('#project-name').select();return}
 const cancel=e.target.closest('[data-cancel-rename]');if(cancel&&!renaming)detail(cancel.dataset.cancelRename);
 const reset=e.target.closest('[data-reset-name]');if(reset&&!renaming)saveProjectName(reset.dataset.resetName,'');
});
$('#detail-content').addEventListener('click',async e=>{
 const start=e.target.closest('[data-delete-project]');
 if(start){
  const project=state.projects.find(p=>p.id===start.dataset.deleteProject);if(!project)return;
  $('#detail-content').innerHTML=`<div class="delete-confirm" data-node="project-details/delete-confirm"><h3>确认删除「${esc(project.title)}」？</h3><p>${project.kind==='website'?`将删除此网站的全部 ${project.accounts?.length||project.accountCount||0} 个本地签到账号及记录。`:'将移除此机器人的签到配置及记录，其他机器人和 Telegram 登录账号会保留。'}</p><p class="muted">删除后该项目将停止自动签到，此操作无法撤销。</p><p id="delete-error" role="alert"></p><div class="detail-actions"><button class="button" data-cancel-delete="${esc(project.id)}">取消</button><button class="button danger" data-confirm-delete="${esc(project.id)}">确认删除</button></div></div>`;
  $('#detail-content [data-cancel-delete]').focus();return;
 }
 const cancel=e.target.closest('[data-cancel-delete]');if(cancel&&!deleting){detail(cancel.dataset.cancelDelete);return}
 const confirm=e.target.closest('[data-confirm-delete]');if(!confirm||deleting)return;
 deleting=true;const id=confirm.dataset.confirmDelete;
 $('#detail-content').querySelectorAll('button').forEach(b=>b.disabled=true);$('#close-details').disabled=true;confirm.textContent='正在删除…';
 try{
  if(!draft){const r=await fetch('/api/v1/dashboard/projects/'+encodeURIComponent(id),{method:'DELETE',credentials:'same-origin'});const data=await r.json();if(!r.ok)throw Error(data.error||'删除失败，请重试');}
  state.projects=state.projects.filter(p=>p.id!==id);render();$('#details').close();if(!draft)await load();toast(draft?'已从预览中移除，实际配置未修改':'签到项目已删除');
 }catch(err){$('#delete-error').textContent=err.message;$('#detail-content').querySelectorAll('button').forEach(b=>b.disabled=false);confirm.textContent='确认删除'}
 finally{deleting=false;$('#close-details').disabled=false}
});
$('#details').addEventListener('cancel',e=>{if(deleting||renaming)e.preventDefault()});
async function load(){if(state.loading)return;state.loading=true;$('#refresh').disabled=true;try{let payload;if(draft)payload=window.CHECKIN_DRAFT;else{const r=await fetch('/api/v1/dashboard',{credentials:'same-origin',cache:'no-store'});if(r.status===401){if(!$('#login').open)$('#login').showModal();return}if(!r.ok)throw Error('获取签到数据失败，请稍后重试');payload=await r.json()}state.projects=payload.projects||[];generatedAt=payload.generatedAt||new Date().toISOString();$('#snapshot-label').textContent=draft?`本机记录快照 · ${new Date(generatedAt).toLocaleString('zh-CN')} · ${state.projects.length} 个项目`:`所有签到项目，尽在此处。共 ${state.projects.length} 个项目。`;$('#time-note').textContent=`${draft?'快照时间':'数据更新'} ${new Date(generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · 北京时间`;$('#connection').textContent=draft?'设计预览 · 本地快照':'已连接 · 签到总览';$('#profile-note').textContent=draft?'本机快照 · 只读预览':'已验证会话 · 退出登录';render()}catch(e){toast(e.message);$('#connection').textContent='连接失败 · 可重试'}finally{state.loading=false;$('#refresh').disabled=false}}
$('#refresh').onclick=async()=>{await load();if(!$('#login').open)toast(draft?'当前为本地快照，未发起实际签到':'签到状态已刷新')};$('#search').oninput=e=>{state.query=e.target.value;state.page=1;render()};$('#status-filter').onchange=e=>{state.status=e.target.value;state.page=1;render()};$('#reset-filters').onclick=reset;
$$('[data-kind]').forEach(b=>b.onclick=()=>{state.kind=b.dataset.kind;state.view=state.kind;state.page=1;render()});$$('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;state.kind=['website','telegram_bot'].includes(state.view)?state.view:'all';state.status=state.view==='attention'?'attention':'all';state.page=1;closeSidebar();render()});
$('#prev').onclick=()=>{state.page--;render()};$('#next').onclick=()=>{state.page++;render()};$('#project-rows').onclick=e=>{const b=e.target.closest('[data-detail]');if(b)detail(b.dataset.detail)};$('#close-details').onclick=()=>$('#details').close();$('#details').onclick=e=>{if(!deleting&&!renaming&&e.target===$('#details')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}};
function closeSidebar(){document.body.classList.remove('mobile-open');$('#sidebar-backdrop').hidden=true;$('#sidebar-toggle').setAttribute('aria-expanded',String(!document.body.classList.contains('sidebar-collapsed')))}$('#sidebar-backdrop').onclick=closeSidebar;$('#sidebar-toggle').onclick=()=>{if(innerWidth<768){document.body.classList.toggle('mobile-open');$('#sidebar-backdrop').hidden=!document.body.classList.contains('mobile-open');$('#sidebar-toggle').setAttribute('aria-expanded',String(!$('#sidebar-backdrop').hidden))}else{document.body.classList.toggle('sidebar-collapsed');$('#sidebar-toggle').setAttribute('aria-expanded',String(!document.body.classList.contains('sidebar-collapsed')))}};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSidebar()});
let dark=false;try{dark=localStorage.getItem('checkin-theme')==='dark'}catch{}document.documentElement.classList.toggle('dark',dark);$('#theme-toggle').onclick=()=>{const on=document.documentElement.classList.toggle('dark');try{localStorage.setItem('checkin-theme',on?'dark':'light')}catch{}};
$('#login').addEventListener('cancel',e=>e.preventDefault());$('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button[type=submit]');b.disabled=true;$('#login-error').textContent='';try{const form=new FormData(e.target);const r=await fetch('/api/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:form.get('username'),password:form.get('password')})});const data=await r.json();if(!r.ok)throw Error(data.error||'登录失败');$('#login').close();e.target.reset();await load()}catch(err){$('#login-error').textContent=err.message}finally{b.disabled=false}};$('#logout').onclick=async()=>{if(draft){toast('当前为本地设计预览');return}try{const r=await fetch('/api/logout',{method:'POST',credentials:'same-origin'});if(!r.ok)throw Error();state.projects=[];render();$('#login').showModal()}catch{toast('退出失败，请重试')}};
document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(a)e.preventDefault()},true);
window.checkinUI={state,render,reset,detail,load,showEmpty(){state.query='__没有匹配的项目__';$('#search').value=state.query;render()}};
render();load();
})();
