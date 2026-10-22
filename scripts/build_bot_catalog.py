#!/usr/bin/env python3
"""Read public check-in metadata with AST only; never import or execute upstream."""
import argparse
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIELDS = {'name','bot_username','bot_checkin_cmd','bot_use_captcha','bot_captcha_len','bot_checkin_caption_pat','bot_checked_keywords','bot_success_keywords','bot_fail_keywords','bot_account_fail_keywords','bot_text_ignore','chat_name','additional_auth'}

def build(source):
    classes = {}
    for file in sorted(source.glob('*.py')):
        if file.stem.endswith('_old'): continue
        tree = ast.parse(file.read_text())
        ignored = any(isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='__ignore__' for t in n.targets) and isinstance(n.value,ast.Constant) and n.value.value for n in tree.body)
        for node in tree.body:
            if not isinstance(node,ast.ClassDef): continue
            values = {}
            for child in node.body:
                if isinstance(child,ast.Assign):
                    for target in child.targets:
                        if isinstance(target,ast.Name) and target.id in FIELDS:
                            try: values[target.id]=ast.literal_eval(child.value)
                            except (ValueError,TypeError): pass
            classes[node.name] = dict(module=file.stem,values=values,bases=[b.id for b in node.bases if isinstance(b,ast.Name)],custom=any(isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) for n in node.body),ignored=ignored)
    def resolve(name,seen=None):
        seen=set(seen or ())
        if name in seen:return {},False
        seen.add(name);c=classes.get(name)
        if not c:return {},False
        values={};custom=False
        for base in c['bases']:
            v,has=resolve(base,seen);values.update(v)
            if base not in {'BaseBotCheckin','BotCheckin','AnswerBotCheckin','TemplateACheckin','TemplateBCheckin'}:custom |= has
        values.update(c['values'])
        return values,custom or c['custom']
    rows=[]
    for name,c in classes.items():
        module=c['module']
        if module.startswith('_') or module.startswith('test') or module.endswith('_old'):continue
        v,custom=resolve(name);username=v.get('bot_username')
        if not isinstance(username,str) or not username or v.get('chat_name'):continue
        # Only metadata-only command/menu classes are automatically transferable.
        available=not custom and not v.get('additional_auth')
        def strings(value,default):
            if isinstance(value,str):return [value]
            return value if isinstance(value,list) and value else default
        row=dict(id=module,name=v.get('name') or username,botUsername=username,available=available,upstreamDefault=not c['ignored'],
                 reason='' if available else '需要专用交互或外部验证，尚未独立适配',
                 commands=strings(v.get('bot_checkin_cmd'),['/checkin']),
                 successKeywords=strings(v.get('bot_success_keywords'),['签到成功','簽到成功','打卡成功','checkin successful','check-in successful']),
                 checkedKeywords=strings(v.get('bot_checked_keywords'),['今日已签到','今天已经签到','已经签到过','明天再来','already checked','already signed']),
                 failKeywords=strings(v.get('bot_fail_keywords'),['签到失败','错误','error','invalid'])+strings(v.get('bot_account_fail_keywords'),[]),
                 textIgnore=strings(v.get('bot_text_ignore'),[]),useCaptcha=bool(v.get('bot_use_captcha',True)),
                 captchaLengths=v.get('bot_captcha_len') or [],captchaPattern=v.get('bot_checkin_caption_pat') or '',
                 sendInterval=3,waitResponse=True,isChat=False,requireExistingChat=True,source='embykeeper-reference')
        rows.append(row)
    return rows

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);args=parser.parse_args()
    rows=build(args.source)
    output=ROOT/'templates/telegram_bot_catalog.json'
    output.write_text(json.dumps(dict(source='https://github.com/emby-keeper/emby-keeper',referenceVersion='7.6.1',bots=rows),ensure_ascii=False,indent=2)+'\n')
    print('Bot 目录:',len(rows),'可独立通用适配:',sum(r['available'] for r in rows))
