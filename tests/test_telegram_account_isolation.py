import asyncio
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

scripts = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location("checkin_worker", scripts / "telegram_bot_checkin.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class AccountIsolationTest(unittest.TestCase):
    def test_expired_session_does_not_cancel_other_accounts_or_lose_results(self):
        accounts = [{"phone": phone, "enabled": True, "checkiner": True} for phone in ("bad", "good")]
        bots = [{"botUsername": "test_bot", "name": "Test", "targetPhones": []}]
        completed = []
        AuthKeyUnregistered = type("AuthKeyUnregistered", (Exception,), {})

        async def run_account(account, *args):
            if account["phone"] == "bad":
                raise AuthKeyUnregistered()
            await asyncio.sleep(0.01)
            completed.append("good")
            return {"phone": "good", "ok": True, "bots": [{**bots[0], "ok": True}]}

        with patch.object(worker, "load_form", return_value=(accounts, bots)), \
             patch.object(worker, "load_session_strings", return_value={}), \
             patch.object(worker, "load_skip_cache", return_value={}), \
             patch.object(worker, "run_account", side_effect=run_account), \
             patch.object(worker, "save_skip_cache"), \
             patch.object(worker, "save_checkin_results") as save, \
             patch.dict(worker.os.environ, {"CHECKIN_BOT_USERNAMES": ""}):
            self.assertEqual(asyncio.run(worker.main()), 1)
        self.assertEqual(completed, ["good"])
        results = save.call_args.args[0]
        self.assertEqual(len(results), 2)
        self.assertIn("请重新登录", results[0]["bots"][0]["message"])
        self.assertTrue(results[1]["ok"])


if __name__ == "__main__":
    unittest.main()
