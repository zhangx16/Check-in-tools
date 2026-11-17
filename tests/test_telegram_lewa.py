import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import telegram_bot_checkin as worker


class LewaCheckinTest(unittest.TestCase):
    def run_menu(self, label, confirmed=True, stale=False):
        bot = {'botUsername': 'Lewa_user_bot', 'sendInterval': 1,
               'textIgnore': [], 'failKeywords': ['失败']}
        now = datetime.now(timezone.utc)
        menu = SimpleNamespace(
            id=1, outgoing=False, date=now-timedelta(days=1) if stale else now,
            edit_date=None, text='请选择你需要的服务', caption=None,
            reply_markup=SimpleNamespace(inline_keyboard=[[
                SimpleNamespace(text=label, callback_data='ub_menu_checkin'),
                SimpleNamespace(text='🏪 积分商城', callback_data='ub_menu_shop')]]))
        result = SimpleNamespace(id=2, outgoing=False, date=now, edit_date=None,
                                 text='🎉 签到成功！获得 113 积分', caption=None, reply_markup=None)
        menu.click = AsyncMock(return_value=SimpleNamespace(message=''))

        class Client:
            send_message = AsyncMock()
            async def get_chat_history(self, *args, **kwargs):
                if menu.click.called and confirmed:
                    yield result
                yield menu

        with patch.object(worker.asyncio, 'sleep', new=AsyncMock()):
            outcome = asyncio.run(worker.run_menu_signin_checkin(
                Client(), bot, worker.MENU_SIGNIN_BUTTONS['lewa_user_bot']))
        menu.click.assert_awaited_once_with(label, timeout=30)
        return outcome

    def test_current_button_and_confirmed_reply(self):
        self.assertTrue(self.run_menu('✅ 每日签到')['ok'])

    def test_changed_emoji_and_reused_menu(self):
        self.assertTrue(self.run_menu('📅 每日签到', stale=True)['ok'])

    def test_button_click_without_confirmation_is_failure(self):
        result = self.run_menu('✅ 每日签到', confirmed=False)
        self.assertFalse(result['ok'])
        self.assertIn('未收到签到成功回复', result['message'])


if __name__ == '__main__':
    unittest.main()
