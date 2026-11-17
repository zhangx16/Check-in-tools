import hashlib,json,sys,unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import glados_cf_checkin as g

class GladosCFTest(unittest.TestCase):
    def fixtures(self,challenge=None):
        session=Mock();session.__enter__=Mock(return_value=session);session.__exit__=Mock(return_value=False)
        session.get.return_value=NS(status_code=200,json=lambda:challenge or {'code':0,'nonce':'nonce','ttl':300000,'turnstile':'sitekey'})
        session.post.return_value=NS(status_code=200,json=lambda:{'code':0,'points':1})
        solver=Mock();solver.session.return_value=session;solver.solve.return_value='solved-token'
        return solver,session

    def test_nonce_bound_token_proof_and_cookie_separation(self):
        solver,session=self.fixtures()
        with patch.object(g.time,'sleep'):
            result=g.checkin({'cookie':'secret-cookie','userAgent':'matching-UA'},'unused',solver)
        self.assertEqual(result['code'],0)
        solver.solve.assert_called_once_with('https://glados.network/console/checkin','sitekey','checkin','nonce')
        body=session.post.call_args.kwargs['json']
        self.assertEqual(body,{'token':'glados.network','nonce':'nonce','proof':hashlib.sha256(b'nonce.glados-observe-v1').hexdigest(),'tsState':'ok','turnstile':'solved-token'})
        self.assertEqual(session.post.call_args.kwargs['headers']['Cookie'],'secret-cookie')
        self.assertEqual(session.get.call_args.kwargs['headers']['User-Agent'],'matching-UA')
        self.assertFalse(session.post.call_args.kwargs['allow_redirects'])

    def test_solver_failure_never_posts(self):
        solver,session=self.fixtures();solver.solve.side_effect=RuntimeError('solver unavailable')
        with self.assertRaisesRegex(RuntimeError,'unavailable'):g.checkin({'cookie':'cookie'},'unused',solver)
        session.post.assert_not_called()

    def test_invalid_session_does_not_solve(self):
        solver,session=self.fixtures({'code':-2})
        self.assertEqual(g.checkin({'cookie':'cookie'},'unused',solver)['code'],-2)
        solver.solve.assert_not_called();session.post.assert_not_called()

    def test_expired_nonce_never_posts(self):
        solver,session=self.fixtures({'code':0,'nonce':'nonce','ttl':4000,'turnstile':'sitekey'})
        with patch.object(g.time,'monotonic',side_effect=[0,5,5]):
            with self.assertRaisesRegex(RuntimeError,'过期'):g.checkin({'cookie':'cookie'},'unused',solver)
        session.post.assert_not_called()

if __name__=='__main__':unittest.main()
