import json
import sys
import tempfile
import unittest
import asyncio
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch
from unittest.mock import AsyncMock
from urllib.parse import urlencode
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import telegram_cf_checkin as cf
import telegram_bot_checkin as worker

class CFTest(unittest.TestCase):
    def solver(self, directory, proxy=False):
        config={'apiKey':'pk_secret'}
        if proxy:config['proxy']='http://user:secret@proxy.test:39901'
        Path(directory,'peak_solver.json').write_text(json.dumps(config))
        return cf.PeakSolver(directory)

    def test_peak_omits_signed_url_and_preserves_challenge_binding(self):
        with tempfile.TemporaryDirectory() as root:
            solver=self.solver(root)
            solver.call=Mock(return_value={'token':'answer'})
            self.assertEqual(solver.solve('https://verify.xghub.de/register-code?state=secret#tgWebAppData=secret',
                                          'site','checkin','nonce'),'answer')
            args=solver.call.call_args.args
            self.assertEqual(args[0],'/solve')
            self.assertEqual(args[1],{'task_type':'TurnstileTaskProxyLess','url':'https://verify.xghub.de/register-code/',
                                      'sitekey':'site','action':'checkin','cdata':'nonce'})

    def test_proxy_and_error_redaction(self):
        with tempfile.TemporaryDirectory() as root:
            solver=self.solver(root,True);solver.call=Mock(return_value={'token':'answer'})
            solver.solve('https://embyguard.com/telegram/verify','site')
            self.assertEqual(solver.call.call_args.args[1]['task_type'],'turnstiletask')
            self.assertIn('proxy',solver.call.call_args.args[1])
            error=solver.redact('pk_secret http://user:secret@proxy.test:39901')
            self.assertNotIn('pk_secret',error);self.assertNotIn('secret@',error)

    def test_invalid_hosts_and_empty_solution(self):
        for url in ['http://embyguard.com/','https://evil.test/','https://embyguard.com.evil.test/',
                    'https://user:password@embyguard.com/','https://embyguard.com:8080/']:
            with self.assertRaises(RuntimeError):cf.origin_for(url)
        with tempfile.TemporaryDirectory() as root:
            solver=self.solver(root);solver.call=Mock(return_value={})
            with self.assertRaisesRegex(RuntimeError,'有效'):solver.solve('https://embyguard.com/','site')

    def test_widget_extraction(self):
        self.assertEqual(cf.widget_from_html('<div data-sitekey="site" data-action="checkin" data-cdata="nonce"></div>'),
                         {'sitekey':'site','action':'checkin','cdata':'nonce'})
        self.assertEqual(cf.widget_from_html("turnstile.render('#widget',{sitekey: 'site'})")['sitekey'],'site')
        with self.assertRaises(RuntimeError):cf.widget_from_html('<html>blocked</html>')

    def test_moonkk_token_is_posted_to_bound_challenge(self):
        initial={'data':{'status':'verification_required','site_key':'site','action':'checkin','cdata':'nonce','challenge':'challenge'}}
        complete={'data':{'status':'checked_in','reward':4,'wallet_balance':12}}
        session=Mock();session.__enter__=Mock(return_value=session);session.__exit__=Mock(return_value=False)
        session.post.side_effect=[NS(status_code=200,json=lambda:initial),NS(status_code=200,json=lambda:complete)]
        solver=Mock();solver.session.return_value=session;solver.solve.return_value='token'
        with patch.object(cf,'PeakSolver',return_value=solver):
            result=cf.post_moonkk('https://embyguard.com/telegram/verify?server=server-1&mode=checkin','private-init','unused')
        self.assertTrue(worker.evaluate_moonkk_api_payload(result)['ok'])
        self.assertTrue(session.post.call_args.args[0].endswith('/checkin/challenge'))
        self.assertEqual(session.post.call_args.kwargs['json'],{'init_data':'private-init','turnstile_token':'token'})
        solver.solve.assert_called_once_with('https://embyguard.com/telegram/verify?server=server-1&mode=checkin','site','checkin','nonce')

    def test_solver_failure_never_posts_completion(self):
        initial={'data':{'status':'verification_required','site_key':'site','action':'checkin','cdata':'nonce','challenge':'challenge'}}
        session=Mock();session.__enter__=Mock(return_value=session);session.__exit__=Mock(return_value=False)
        session.post.return_value=NS(status_code=200,json=lambda:initial)
        solver=Mock();solver.session.return_value=session;solver.solve.side_effect=RuntimeError('solver down')
        with patch.object(cf,'PeakSolver',return_value=solver):
            with self.assertRaisesRegex(RuntimeError,'solver down'):
                cf.post_moonkk('https://embyguard.com/telegram/verify','private-init','unused')
        self.assertEqual(session.post.call_count,1)

    def test_pending_is_not_reported_as_success(self):
        self.assertFalse(worker.evaluate_moonkk_api_payload({'data':{'status':'pending'}})['ok'])

    def test_liminal_requires_explicit_success_or_409(self):
        for status,payload,ok,already in [(200,{'message':'签到成功','reward':5},True,False),
                                          (409,{'detail':'already'},True,True),
                                          (403,{'detail':'请求异常'},False,False),
                                          (200,{'ok':True},False,False)]:
            session=Mock();session.__enter__=Mock(return_value=session);session.__exit__=Mock(return_value=False)
            session.get.return_value=NS(status_code=200,text='<div data-sitekey="site"></div>')
            session.post.return_value=NS(status_code=status,json=lambda:payload)
            solver=Mock();solver.session.return_value=session;solver.solve.return_value='token'
            init=urlencode({'user':json.dumps({'id':123})})
            with patch.object(cf,'PeakSolver',return_value=solver),patch.object(cf.time,'sleep'):
                result=cf.post_liminal('https://liminal-embyboss.liminalnet.us/checkin/web',init,'unused')
            self.assertEqual(result['ok'],ok);self.assertEqual(result['already'],already)
            self.assertEqual(session.post.call_args.kwargs['json']['webapp_data'],init)

    def test_xg_only_accepts_matching_bot_return_url(self):
        for url,valid in [('https://t.me/XGFree_bot?start=verified-proof',True),
                          ('https://evil.test/XGFree_bot?start=proof',False),
                          ('https://t.me/OtherBot?start=proof',False)]:
            session=Mock();session.__enter__=Mock(return_value=session);session.__exit__=Mock(return_value=False)
            session.get.return_value=NS(status_code=200,text='<div data-sitekey="site" data-action="checkin" data-cdata="nonce"></div>')
            session.post.return_value=NS(status_code=200,json=lambda:{'ok':True,'return_url':url})
            solver=Mock();solver.session.return_value=session;solver.solve.return_value='token'
            with patch.object(cf,'PeakSolver',return_value=solver):
                if valid:
                    self.assertEqual(cf.verify_xg('https://verify.xghub.de/register-code?state=private&return_bot=XGFree_bot','unused'),'verified-proof')
                else:
                    with self.assertRaises(RuntimeError):
                        cf.verify_xg('https://verify.xghub.de/register-code?state=private&return_bot=XGFree_bot','unused')

    def test_paused_bot_never_starts_or_spends(self):
        client=NS(send_message=AsyncMock())
        with patch.object(cf,'config',return_value={'pausedBots':['liminalembybot']}),patch.object(cf,'post_liminal') as checkin:
            result=asyncio.run(worker.run_cf_webapp_checkin(client,{'botUsername':'liminalembybot'}))
        self.assertFalse(result['ok'])
        client.send_message.assert_not_called();checkin.assert_not_called()

if __name__=='__main__':unittest.main()
