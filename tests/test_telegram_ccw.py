from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import telegram_ccw_checkin as ccw


def profile(can_checkin, balance=463):
    return {'ok': True, 'registered': True,
            'user': {'canCheckin': can_checkin, 'iv': balance, 'money': 'cc币'}}


class CcwCheckinTest(unittest.TestCase):
    def run_with(self, responses):
        with patch.object(ccw, 'request_json', side_effect=responses) as request:
            result = ccw.checkin_miniapp('private-init-data', opener=object())
        self.assertNotIn('private-init-data', str(result))
        return result, request

    def test_today_already_signed_does_not_post_action(self):
        result, request = self.run_with([{'ok': True}, profile(False)])
        self.assertTrue(result['already'])
        self.assertEqual([c.args[1] for c in request.call_args_list], ['/api/auth/tg', '/api/me'])
        self.assertIn('463 cc币', result['message'])

    def test_checkin_requires_server_confirmation(self):
        result, request = self.run_with([{'ok': True}, profile(True),
                                        {'ok': True, 'msg': '签到成功 +10'}, profile(False, 473)])
        self.assertTrue(result['ok'])
        self.assertFalse(result['already'])
        self.assertEqual(request.call_args_list[2].args[2], {'action': 'checkin'})

    def test_lost_response_reconciled_without_second_post(self):
        result, request = self.run_with([{'ok': True}, profile(True),
                                        TimeoutError(), profile(False)])
        self.assertTrue(result['already'])
        self.assertEqual(sum(c.args[1] == '/api/action' for c in request.call_args_list), 1)

    def test_ambiguous_state_does_not_claim_success(self):
        for responses in ([{'ok': False, 'msg': '登录失败'}],
                          [{'ok': True}, {'ok': True, 'user': {}}],
                          [{'ok': True}, profile(True), {'ok': True}, profile(True)]):
            with self.subTest(responses=responses), self.assertRaises(RuntimeError):
                self.run_with(responses)

    def test_unbound_account_has_explicit_registration_error(self):
        with self.assertRaisesRegex(RuntimeError, '未注册或未绑定'):
            self.run_with([{'ok': True}, {'ok': True, 'registered': False}])

    def test_only_expected_signin_webapp_is_accepted(self):
        def message(url):
            return SimpleNamespace(reply_markup=SimpleNamespace(inline_keyboard=[[
                SimpleNamespace(text='🎯 签到', web_app=SimpleNamespace(url=url))]]))
        self.assertEqual(ccw.find_checkin_url(message(ccw.ORIGIN+'/?tab=checkin')),
                         ccw.ORIGIN+'/?tab=checkin')
        self.assertEqual(ccw.find_checkin_url(message('https://example.test/?tab=checkin')), '')


if __name__ == '__main__':
    unittest.main()
