#!/usr/bin/env python3
"""Regenerate an offline, allowlisted, masked snapshot from this checkout."""
import json,re
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]; DATA=ROOT/'data'; OUT=Path(__file__).parent

def read(p,default):
 try:return json.loads(p.read_text())
 except (OSError,ValueError):return default

def mask(s):return re.sub(r'\+?\d{7,}',lambda m:'···'+m[0][-4:],str(s or ''))
def message(s):
 # Never copy raw payloads, login records, URLs, or credential fields into a draft.
 lines=[line for line in str(s or '').splitlines() if not re.search(r'password|cookie|token|密码|https?://',line,re.I)]
 return mask('\n'.join(lines))[:400]
def status(a):return 'skipped' if a.get('skipped') else ('already' if a.get('already') else 'success') if a.get('ok') else 'failed'
def aggregate(accounts):
 ss=[a['status'] for a in accounts]
 return 'failed' if 'failed' in ss else 'partial' if 'skipped' in ss and any(s in ['success','already'] for s in ss) else 'skipped' if ss and all(s=='skipped' for s in ss) else 'success' if 'success' in ss else 'already' if 'already' in ss else 'unknown'
projects=[]
for provider,title,filename in [('zzcat','这只猫用户中心','zzcat_accounts.json'),('glados','GLaDOS','accounts.json'),('embypulse','EmbyPulse','embypulse_accounts.json'),('embymb','EmbyMB','embymb_accounts.json'),('vpsnat','VPSNAT 纳泰云','vpsnat_accounts.json')]:
 accounts=[]
 for i,a in enumerate(read(DATA/filename,[])):
  r=a.get('lastCheckin') or {};accounts.append(dict(accountName=f'账号 {i+1}',status=status(r) if r else 'unknown',message=message(r.get('message','暂无签到记录')),checkedAt=a.get('lastCheckinAt','')))
 if accounts:projects.append(dict(id='web:'+provider,kind='website',title=title,subtitle=f'{len(accounts)} 个账号',status=aggregate(accounts),checkedAt=max(a['checkedAt'] for a in accounts),accounts=accounts))
form=read(DATA/'embykeeper/form.json',{});results=read(DATA/'telegram_bot_checkin_results.json',{}).get('bots',{});results={k.lower():v for k,v in results.items()}
for bot in form.get('botTemplates',[]):
 u=bot['botUsername'];r=results.get(u.lower(),{});targets=bot.get('targetPhones',[]);accounts=[]
 for i,a in enumerate(r.get('accounts',[])):
  if targets and a.get('phone') not in targets:continue
  accounts.append(dict(accountName=mask(a.get('phone') or f'账号 {i+1}'),status=status(a),message=message(a.get('message','')),checkedAt=a.get('checkedAt',r.get('checkedAt',''))))
 projects.append(dict(id='tg:'+u,kind='telegram_bot',title=bot.get('name') or u,subtitle='@'+u,botUsername=u,status=aggregate(accounts),checkedAt=r.get('checkedAt',''),accounts=accounts))
names=read(DATA/'project_names.json',{})
for project in projects:
 project['defaultTitle']=project['title']
 project['title']=names.get(project['id'].lower()) or project['title']
payload=dict(projects=projects,generatedAt=datetime.now(timezone.utc).isoformat())
(OUT/'snapshot.js').write_text('window.CHECKIN_DRAFT = '+json.dumps(payload,ensure_ascii=False)+';\n')
print(f'已生成 {len(projects)} 个项目的脱敏快照')
