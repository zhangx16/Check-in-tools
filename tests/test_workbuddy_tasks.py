import json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from workbuddy_tasks import TaskTracker
class Engine:
 @staticmethod
 def dig(body,key):return body.get('data',body).get(key)
 @staticmethod
 def _api_success(code,body):return 200<=code<300 and body.get('code',0)==0
 @staticmethod
 def _is_tier_locked(code,body):return code==403 and body.get('msg')=='locked'
 @staticmethod
 def _is_no_chance(msg):return msg=='no chances'
 @staticmethod
 def _budget_left():return 60
class TrackerTest(unittest.TestCase):
 def setUp(self):self.tracker=TaskTracker(Engine(),{'auth':{'accessToken':'private-access','refreshToken':'private-refresh'}})
 def observe(self,path,code=200,data=None,method='GET'):
  self.tracker.observe(method,'https://copilot.tencent.com'+path,code,{'code':0,'data':data or {}})
 def test_all_features_are_present_and_unchecked_is_not_success(self):
  rows=self.tracker.snapshot();self.assertEqual(len(rows),8);self.assertTrue(all(r['status']=='pending' for r in rows))
 def test_travel_claim_and_depart_records_both_actions(self):
  self.observe('/v2/activity/growth/buddy/travel/status',data={'state':'arrived'})
  self.observe('/v2/activity/growth/buddy/travel/claim',data={'reward_credit':6},method='POST')
  self.observe('/v2/activity/growth/buddy/travel/depart',data={'location':{'name':'咖啡馆'},'duration_hours':4},method='POST')
  travel=self.tracker.rows['travel'];self.assertEqual(travel['status'],'success');self.assertEqual(len(travel['actions']),3)
  self.assertIn('+6',travel['actions'][1]['message'])
 def test_claimed_subtasks_and_secrets_are_sanitized(self):
  self.observe('/v2/activity/growth/tasks',data={'tasks':[{'task_code':'t1','title':'private-access task','accept_status':'completed'}]})
  self.observe('/v2/activity/growth/tasks/t1/claim',method='POST')
  rows=self.tracker.snapshot();task=next(r for r in rows if r['id']=='tasks');self.assertEqual(task['items'][0]['status'],'claimed');self.assertNotIn('private-access',json.dumps(rows))
 def test_passive_queries_do_not_hide_errors(self):
  self.observe('/v2/activity/growth/tasks/t1/claim',code=500,method='POST')
  self.observe('/v2/activity/growth/tasks',data={'tasks':[]});self.assertEqual(self.tracker.rows['tasks']['status'],'failed')
 def test_locked_tier_is_waiting_not_auth_failure(self):
  self.tracker.observe('POST','https://copilot.tencent.com/v2/activity/growth/redeem',403,{'msg':'locked'})
  self.assertEqual(self.tracker.rows['redeem']['status'],'waiting')
 def test_read_only_snapshot_never_posts(self):
  engine=Engine();calls=[];engine.get=lambda url,headers:(calls.append(url) or (200,{'code':0,'data':{}}))
  tracker=TaskTracker(engine,{});tracker.install();tracker.read_growth({},'https://copilot.tencent.com');tracker.restore();self.assertEqual(len(calls),7)
if __name__=='__main__':unittest.main()
