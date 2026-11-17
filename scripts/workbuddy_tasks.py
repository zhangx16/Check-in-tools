"""Sanitized per-feature observations of the vendored reward engine.

This module observes existing calls; it never fabricates task completion or
adds write requests. Read-only status snapshots use GET endpoints only.
"""
from datetime import datetime, timezone
from urllib.parse import urlparse

FEATURES = [('daily','每日签到'),('travel','Buddy 旅行与礼物'),('tasks','成长任务接单与领奖'),
            ('makeup','断登补签'),('redeem','连登奖励兑换'),('lottery','盲盒抽奖'),('buddy','能量开 Buddy 盲盒'),('energy','成长能量')]

class TaskTracker:
    def __init__(self, engine, session):
        self.engine = engine
        self.secrets = [v for k,v in session.get('auth',{}).items() if k in ('accessToken','refreshToken') and isinstance(v,str)]
        self.rows = {key:dict(id=key,name=name,status='pending',message='本轮尚未检查或未满足前置条件',actions=[]) for key,name in FEATURES}
        self.original = {}
        self.travel = None
        self.claimed = set()

    def text(self, value):
        text = str(value or '')
        for secret in self.secrets:
            if secret:text=text.replace(secret,'[已隐藏]')
        return text[:240]

    def category(self, path):
        if '/billing/meter/' in path:return 'daily'
        if '/activity/growth/' not in path:return None
        path=path.split('/activity/growth/',1)[1]
        for prefix,key in [('buddy/travel','travel'),('tasks','tasks'),('makeup','makeup'),('heatmap','makeup'),('streak','makeup'),('redeem','redeem'),('lottery','lottery'),('buddy/quota','buddy'),('buddy/open','buddy'),('energy','energy')]:
            if path.startswith(prefix):return key
        return None

    def observe(self, method, url, code, body):
        path=urlparse(url).path;key=self.category(path)
        if not key:return
        row=self.rows[key];get=lambda field:self.engine.dig(body,field)
        success=self.engine._api_success(code,body)
        message=self.text(get('msg') or get('message'))
        if not success:
            known=(key=='redeem' and self.engine._is_tier_locked(code,body)) or (key=='lottery' and self.engine._is_no_chance(message)) or (key=='travel' and message.strip().lower()=='no active buddy')
            state='waiting' if known else 'failed';message=message or f'HTTP {code}'
        elif method=='POST' and not path.endswith('checkin-activity-status'):
            state='success'
            if key=='daily':message='每日签到领取已确认'
            elif path.endswith('/travel/claim'):message=f"旅行礼物已领取：+{get('reward_credit') or 0} 积分"
            elif path.endswith('/travel/depart'):
                location=get('location') or {};name=location.get('name','') if isinstance(location,dict) else ''
                message=f"Buddy 已出发：{name}，{get('duration_hours') or (location.get('duration_hours') if isinstance(location,dict) else '') or '—'} 小时后返回";self.travel='traveling'
            elif path.endswith('/tasks/accept'):
                results=get('results') or [];errors=[r for r in results if isinstance(r,dict) and r.get('status')=='error'];state='failed' if errors else 'success';message='部分任务接单失败' if errors else '可接任务已领取'
            elif key=='tasks':
                self.claimed.add(path.split('/tasks/',1)[1].split('/')[0]);message='已完成任务的奖励已领取'
            elif key=='makeup':message='断登补签已完成'
            elif key=='redeem':message=f"连登奖励已兑换：+{get('credit_granted') or 0} 积分"
            elif key=='lottery':message='抽奖已完成：'+self.text(get('prize_name') or get('prize') or '查看成长中心奖品')+('（实物奖需填写收件信息）' if get('need_address') or get('require_address') else '')
            elif key=='buddy':message='能量 Buddy 盲盒已开启'
        else:
            state='waiting'
            if key=='daily':state='already' if get('today_checked_in') in (True,1) else 'pending';message='今日已签到' if state=='already' else '今日待签到'
            elif path.endswith('/travel/status'):
                self.travel=get('state');location=get('location') or {};name=location.get('name','') if isinstance(location,dict) else ''
                message={'idle':'Buddy 待派出','arrived':'旅行已到达，礼物待领取','traveling':'Buddy 旅行中'}.get(self.travel,'旅行状态未知')
                if name:message+='：'+self.text(name)
                if self.travel=='idle' and get('daily_limit_reached'):message='今日旅行名额已用完'
                arrival=get('arrive_at')
                if isinstance(arrival,(int,float)):row['arriveAt']=arrival
            elif key=='tasks':
                tasks=get('tasks') or [];row['items']=[{'name':self.text(t.get('title') or t.get('task_code')),'code':self.text(t.get('task_code')),'status':self.text(t.get('accept_status') or 'unknown'),'locked':bool(t.get('locked'))} for t in tasks[:80] if isinstance(t,dict)]
                message=f'已检查 {len(tasks)} 项成长任务'
            elif key=='makeup':
                cards=get('makeup_cards') or {};balance=cards.get('balance',0) if isinstance(cards,dict) else cards
                message=f'补登卡余额：{balance}；有断登记录且有补登卡时自动处理'
            elif key=='redeem':message='已检查 7 / 14 / 28 天奖励；达到条件时自动兑换'
            elif key=='lottery':message=f"可用抽奖次数：{get('balance') or 0}"
            elif key=='buddy':message='已检查能量开盒额度；旅行空闲且能量足够时开启'
            elif key=='energy':state='observed';message=f"当前成长能量：{get('balance') if get('balance') is not None else '未知'}"
        event={'status':state,'message':self.text(message)}
        row['actions'].append(event);row['actions']=row['actions'][-12:]
        # Later passive checks must not hide an earlier claim or failed operation.
        priorities={'pending':0,'waiting':1,'already':2,'observed':2,'success':3,'failed':4}
        if priorities.get(state,0)>=priorities.get(row['status'],0):row.update(status=state,message=event['message'])
        row['checkedAt']=datetime.now(timezone.utc).isoformat()

    def install(self):
        for name,method in [('get','GET'),('post','POST')]:
            if not hasattr(self.engine,name):continue
            original=getattr(self.engine,name);self.original[name]=original
            def wrapped(url,*args,_original=original,_method=method,**kwargs):
                code,body=_original(url,*args,**kwargs)
                try:self.observe(_method,url,code,body)
                except Exception:pass # Observability must never change reward execution.
                return code,body
            setattr(self.engine,name,wrapped)

    def restore(self):
        for name,original in self.original.items():setattr(self.engine,name,original)

    def snapshot(self):
        if self.travel in ('traveling','arrived') and self.rows['buddy']['status']=='pending':
            self.rows['buddy'].update(status='waiting',message='等待旅行结束并领取礼物后，再检查能量开盒')
        for item in self.rows['tasks'].get('items',[]):
            if item['code'] in self.claimed:item['status']='claimed'
        return list(self.rows.values())

    def read_growth(self, headers, endpoint):
        for path in ['buddy/travel/status','tasks','streak','redeem/summary','lottery/chances','buddy/quota','energy']:
            if self.engine._budget_left()<=0:break
            code,_=self.engine.get(endpoint+'/v2/activity/growth/'+path,headers)
            if code in (401,403):break
