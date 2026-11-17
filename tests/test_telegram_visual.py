import asyncio
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import telegram_visual as visual
import telegram_bot_checkin as worker


class VisualTest(unittest.IsolatedAsyncioTestCase):
    def message(self, seconds=0):
        return NS(id=20, date=datetime.now(timezone.utc)-timedelta(seconds=seconds),
                  chat=NS(id=2), photo=NS(file_id='photo'),
                  reply_markup=NS(inline_keyboard=[[
                      NS(text='📱 手机', callback_data='checkin-phone'),
                      NS(text='路由器', callback_data='checkin-router')]]))

    async def test_opt_in_and_daily_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            self.assertFalse(visual.visual_enabled(root))
            (root/'telegram_visual.json').write_text('{"enabled": "true"}')
            self.assertFalse(visual.visual_enabled(root))
            (root/'telegram_visual.json').write_text('{"enabled": true}')
            self.assertTrue(visual.visual_enabled(root))
            self.assertTrue(visual.claim_attempt(root, '+123'))
            self.assertFalse(visual.claim_attempt(root, '+123'))
            self.assertTrue(visual.claim_attempt(root, '+456'))
        self.assertTrue(worker.is_account_status_reason('远端图片识别尚未授权启用，未发起签到'))

    async def test_reply_must_match_command_and_be_new(self):
        command='/visual instance 手机/路由器'
        class Client:
            send_photo=AsyncMock(return_value=NS(id=10))
            async def get_chat_history(self,*args,**kwargs):
                yield NS(id=11,outgoing=False,text='not TOML')
                yield NS(id=9,outgoing=False,text=f'command = "{command}"\nstatus = "ok"\nanswer = "旧答案"')
                yield NS(id=12,outgoing=False,text='command = "other"\nstatus = "ok"\nanswer = "other"')
                yield NS(id=13,outgoing=False,text=f'command = "{command}"\nstatus = "ok"\nanswer = "手机"')
        result=await visual.request(Client(),command,photo='photo')
        self.assertEqual(result['answer'],'手机')

    async def test_exact_candidate_click(self):
        client=NS(request_callback_answer=AsyncMock())
        with patch.object(visual,'request',new=AsyncMock(return_value={'answer':'手机'})) as request:
            await visual.answer_challenge(client,self.message())
        self.assertIn('手机/路由器',request.call_args.args[1])
        client.request_callback_answer.assert_awaited_once_with(2,20,callback_data='checkin-phone',timeout=3)

    async def test_unknown_answer_never_clicks(self):
        client=NS(request_callback_answer=AsyncMock())
        with patch.object(visual,'request',new=AsyncMock(return_value={'answer':'手机或路由器'})):
            with self.assertRaisesRegex(RuntimeError,'不点击按钮'):
                await visual.answer_challenge(client,self.message())
        client.request_callback_answer.assert_not_called()

    async def test_expired_challenge_never_sends_photo(self):
        with patch.object(visual,'request',new=AsyncMock()) as request:
            with self.assertRaisesRegex(RuntimeError,'已过期'):
                await visual.answer_challenge(NS(),self.message(seconds=31))
        request.assert_not_called()

    async def test_service_rejection(self):
        class Client:
            send_message=AsyncMock(return_value=NS(id=10))
            async def get_chat_history(self,*args,**kwargs):
                yield NS(id=11,outgoing=False,text='command = "auth"\nstatus = "error"\nerrmsg = "权限不足"')
        with self.assertRaisesRegex(RuntimeError,'权限不足'):
            await visual.request(Client(),'auth')

    async def test_authorization_failure_does_not_start_checkin(self):
        profile={'botUsername':'EmbyPublicBot','requireExistingChat':True}
        class Client:
            send_message=AsyncMock()
            async def get_chat_history(self,*args,**kwargs):yield NS(id=1)
        client=Client()
        with patch.object(worker,'visual_enabled',return_value=True), patch.object(worker,'authorize_visual',new=AsyncMock(side_effect=RuntimeError('权限不足'))):
            result=await worker.run_single_bot(client,profile)
        self.assertFalse(result['ok'])
        self.assertIn('未发起签到',result['message'])
        client.send_message.assert_not_called()


if __name__=='__main__':unittest.main()
