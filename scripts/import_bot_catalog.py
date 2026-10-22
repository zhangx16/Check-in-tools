#!/usr/bin/env python3
"""Add independent profiles only for Telegram bots the account already chats with."""
import asyncio
import json
from pathlib import Path
from telegram_bot_checkin import Client, FORM_FILE, API_ID, API_HASH, load_form, load_session_strings, find_session_string
ROOT=Path(__file__).resolve().parents[1]

async def main():
    accounts,_=load_form();sessions=load_session_strings()
    catalog=json.loads((ROOT/'templates/telegram_bot_catalog.json').read_text())['bots']
    existing=json.loads(FORM_FILE.read_text());keys={b['botUsername'].lstrip('@').lower() for b in existing['botTemplates']}
    targets={}
    for index,a in enumerate(accounts):
        if not a['enabled'] or not a['checkiner']:continue
        session=find_session_string(a['phone'],sessions)
        if not session:continue
        client=Client(a['phone'],api_id=int(a['apiId'] or API_ID),api_hash=a['apiHash'] or API_HASH,session_string=session,in_memory=True,no_updates=True)
        try:
            await client.start()
            async for dialog in client.get_dialogs():
                username=(dialog.chat.username or '').lower()
                if username:targets.setdefault(username,[]).append(a['phone'])
            print('账号',index+1,'已有会话扫描完成',flush=True)
        except Exception as e:print('账号',index+1,'扫描失败',type(e).__name__,flush=True)
        finally:
            if client.is_connected:await client.stop()
    existing=json.loads(FORM_FILE.read_text())
    keys={b['botUsername'].lstrip('@').lower() for b in existing['botTemplates']}
    added=[]
    # Prefer current implementations if aliases share the same username.
    for row in sorted(catalog,key=lambda r:not r['upstreamDefault']):
        key=row['botUsername'].lower()
        if not row['available'] or key in keys or key not in targets:continue
        profile={k:v for k,v in row.items() if k not in {'id','available','upstreamDefault','reason'}}
        profile['targetPhones']=targets[key]
        existing['botTemplates'].append(profile);keys.add(key);added.append(profile['botUsername'])
    temp=FORM_FILE.with_suffix('.import.tmp');temp.write_text(json.dumps(existing,ensure_ascii=False,indent=2)+'\n');temp.chmod(0o600);temp.replace(FORM_FILE)
    print('新增',len(added),'个 Bot:',', '.join(added),flush=True)
    (ROOT/'data/catalog_import_result.json').write_text(json.dumps({'added':added},ensure_ascii=False))

if __name__=='__main__':asyncio.run(main())
