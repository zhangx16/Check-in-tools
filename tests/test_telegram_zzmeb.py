import asyncio
from datetime import datetime, timezone
from pathlib import Path
import sys
from types import SimpleNamespace as NS
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import telegram_bot_checkin as worker


def message(text, buttons=()):
    return NS(id=1, outgoing=False, date=datetime.now(timezone.utc), edit_date=None,
              text=text, caption=None, reply_markup=NS(inline_keyboard=[[
                  NS(text=label, callback_data='answer:' + label) for label in buttons]]),
              click=AsyncMock(return_value=NS(message='')))


class ZzmebTest(unittest.TestCase):
    def test_arithmetic(self):
        for expression, answer in [('3 + 8', '11'), ('3 − 8', '-5'),
                                   ('7 × 8', '56'), ('18 ÷ 3', '6')]:
            with self.subTest(expression=expression):
                challenge = message('请答题后签到：' + expression + ' = ？', ['1', answer])
                self.assertEqual(worker.zzmeb_arithmetic_answer(challenge)[0], answer)

    def test_observed_zzmeb_challenge_with_option_index_callbacks(self):
        challenge = message('🧮 签到验证\n\n4 − 1 = ?\n\n请选择正确答案，答对后完成签到。', ['0', '4', '7', '3'])
        for index, button in enumerate(challenge.reply_markup.inline_keyboard[0]):
            button.callback_data = f'checkin:challenge-token:{index}'
        self.assertEqual(worker.zzmeb_arithmetic_answer(challenge)[0], '3')

    def test_unsupported_challenges_are_not_guessed(self):
        for text in ['答题：法国的首都？', '签到：3 / 0 = ?', '签到：3 / 2 = ?', '余额 3 + 2 = ?']:
            self.assertIsNone(worker.zzmeb_arithmetic_answer(message(text, ['5'])))
        self.assertIsNone(worker.zzmeb_arithmetic_answer(message('签到：3 + 2 = ?', ['4'])))

    def test_menu_waits_for_answer_confirmation(self):
        for confirmed in (True, False):
            with self.subTest(confirmed=confirmed):
                menu = message('请选择功能', [worker.ZZMEB_SIGNIN_BUTTON])
                challenge = message('请完成下面这道题后签到：3 + 8 = ?', ['11', '9'])
                challenge.id = 2
                success = message('签到成功，获得 10 积分')
                success.id = 3
                class Client:
                    send_message = AsyncMock()
                    async def get_chat_history(self, *args, **kwargs):
                        if menu.click.called:
                            if challenge.click.called and confirmed:
                                yield success
                            yield challenge
                        yield menu
                bot = dict(botUsername='zzmeb_bot', sendInterval=1, textIgnore=[],
                           successKeywords=['签到成功'], checkedKeywords=['今日已签到'], failKeywords=['失败'])
                with patch.object(worker.asyncio, 'sleep', new=AsyncMock()):
                    result = asyncio.run(worker.run_menu_signin_checkin(Client(), bot, worker.ZZMEB_SIGNIN_BUTTON))
                self.assertEqual(result['ok'], confirmed)
                challenge.click.assert_awaited_once_with('11', timeout=5)

    def test_miniapp_requires_explicit_result(self):
        for payload in [{}, {'ok': True}, {'ok': True, 'data': {}},
                        {'ok': False, 'data': {'awardedNow': True}}]:
            self.assertFalse(worker.evaluate_zzmeb_miniapp_payload(payload)['ok'])
        result = worker.evaluate_zzmeb_miniapp_payload({'ok': True, 'data': {'awardedNow': True, 'reward': 10}})
        self.assertTrue(result['ok'])
        self.assertFalse(result['already'])
        self.assertTrue(worker.evaluate_zzmeb_miniapp_payload({'ok': True, 'data': {'awardedNow': False}})['already'])

    def test_invalid_auth_never_posts_checkin(self):
        with patch.object(worker, 'zzmeb_miniapp_request', return_value={} ) as request:
            with self.assertRaises(RuntimeError):
                worker.post_zzmeb_miniapp_checkin('private-init-data')
            self.assertEqual(request.call_count, 1)

    def test_start_menu_webapp_is_opened(self):
        menu = message('请选择功能')
        menu.reply_markup.inline_keyboard = [[NS(text='MINIAPP', web_app=NS(url=worker.ZZMEB_MINIAPP_ORIGIN + '/?tab=checkin'))]]
        class Client:
            send_message = AsyncMock()
            resolve_peer = AsyncMock(return_value=object())
            invoke = AsyncMock(return_value=NS(url=worker.ZZMEB_MINIAPP_ORIGIN + '/#tgWebAppData=test-init'))
            async def get_chat_history(self, *args, **kwargs):
                yield menu
        client = Client()
        with patch.object(worker.asyncio, 'sleep', new=AsyncMock()), \
             patch.object(worker.asyncio, 'to_thread', new=AsyncMock(side_effect=lambda fn, *args: fn(*args))), \
             patch.object(worker, 'as_input_user', return_value=object()), \
             patch.object(worker.raw.functions.messages, 'RequestWebView', return_value='webview') as view, \
             patch.object(worker, 'post_zzmeb_miniapp_checkin', return_value={'ok': True, 'data': {'awardedNow': False}}) as post:
            result = asyncio.run(worker.run_zzmeb_miniapp_checkin(client, {'botUsername': 'zzmeb_bot', 'sendInterval': 1}))
        client.send_message.assert_awaited_once_with('zzmeb_bot', '/start')
        self.assertEqual(view.call_args.kwargs['url'], worker.ZZMEB_MINIAPP_ORIGIN + '/?tab=checkin')
        post.assert_called_once_with('test-init')
        self.assertTrue(result['already'])

    def test_miniapp_still_runs_if_button_path_raises(self):
        with patch.object(worker, 'run_menu_signin_checkin', new=AsyncMock(side_effect=RuntimeError('button failed'))), \
             patch.object(worker, 'run_zzmeb_miniapp_checkin', new=AsyncMock(return_value={'ok': True, 'already': False, 'message': '签到成功'})) as mini:
            result = asyncio.run(worker.run_zzmeb_checkin(object(), {}))
        mini.assert_awaited_once()
        self.assertFalse(result['ok'])
        self.assertTrue(result['miniapp']['ok'])
        self.assertIn('button failed', result['message'])


if __name__ == '__main__':
    unittest.main()
