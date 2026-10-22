import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch,AsyncMock
from types import SimpleNamespace
from datetime import datetime,timedelta,timezone

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import telegram_bot_checkin as worker
import telegram_captcha as captcha

class CatalogTest(unittest.TestCase):
    def test_no_embykeeper_runtime_dependency(self):
        self.assertIsNone(importlib.util.find_spec('embykeeper'))
        self.assertEqual(worker.Client.__module__.split('.')[0],'pyrogram')

    def test_catalog_capabilities_are_explicit(self):
        rows=json.loads((ROOT/'templates/telegram_bot_catalog.json').read_text())['bots']
        self.assertEqual(len(rows),122)
        self.assertEqual(sum(r['available'] for r in rows),85)
        self.assertTrue(all(r['commands'] and r['botUsername'] for r in rows))
        self.assertTrue(all(r['reason'] for r in rows if not r['available']))
        self.assertTrue(all(r['requireExistingChat'] for r in rows))
        self.assertTrue(all(not r['isChat'] for r in rows))

    def test_ocr_rejects_invalid_answer_and_enforces_length(self):
        class Engine:
            def classification(self,image):return 'ab12'
        with patch.object(captcha,'_ENGINE',Engine()):
            self.assertEqual(captcha.recognize(b'image',[4]),'ab12')
            self.assertIsNone(captcha.recognize(b'image',[5]))
        class Invalid:
            def classification(self,image):return '请登录'
        with patch.object(captcha,'_ENGINE',Invalid()):
            self.assertIsNone(captcha.recognize(b'image',[]))

    def test_no_history_does_not_start_bot(self):
        class Client:
            send_message=AsyncMock()
            async def get_chat_history(self,*args,**kw):
                if False:yield None
        client=Client()
        result=asyncio.run(worker.run_single_bot(client,{'botUsername':'test','requireExistingChat':True}))
        self.assertTrue(result['skipped']);client.send_message.assert_not_called()

    def test_edited_result_is_recognized_using_edit_time(self):
        now=datetime.now(timezone.utc)
        message=SimpleNamespace(id=1,date=now-timedelta(days=1),edit_date=now,text='签到成功 +10',caption=None,
                                outgoing=False,reply_markup=None,photo=None)
        class Client:
            phone_number='test'
            send_message=AsyncMock(return_value=SimpleNamespace(id=2))
            async def get_chat_history(self,*args,**kw):yield message
        profile=next(r for r in json.loads((ROOT/'templates/telegram_bot_catalog.json').read_text())['bots'] if r['available'])
        bot={**profile,'buttonSequence':[],'targetPhones':[]}
        with patch.object(worker.asyncio,'sleep',new=AsyncMock()):
            result=asyncio.run(worker.run_single_bot(Client(),bot))
        self.assertTrue(result['ok'])
        self.assertFalse(result['skipped'])

if __name__=='__main__':unittest.main()
