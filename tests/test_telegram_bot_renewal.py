import asyncio
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace as N
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import telegram_bot_renewal as r


class Client:
    phone_number = "+123456"

    def __init__(self, pages, answer=""):
        self.pages = pages
        self.index = -1
        self.answer = answer
        self.sent = []
        self.clicked = []

    async def send_message(self, target, value):
        self.sent.append(value)
        self.index += 1
        return N(id=0)

    async def get_chat_history(self, target, limit):
        content, labels = self.pages[self.index]
        async def click(label, timeout):
            self.clicked.append(label)
            self.index += 1
            return N(message=self.answer)
        yield N(id=self.index + 10, outgoing=False, date=datetime.now(timezone.utc), text=content, caption=None, click=click, reply_markup=N(inline_keyboard=[[N(text=x) for x in labels]]))


class RenewalTests(unittest.IsolatedAsyncioTestCase):
    def test_prices_and_balances(self):
        self.assertEqual(r.balance("💰 你的余额：3,000 积分", "lewa"), 3000)
        self.assertEqual(r.balance("💰 当前剩余OK币：128", "okemby"), 128)
        self.assertIsNone(r.balance("当前余额未知", "okemby"))
        self.assertEqual([r.affordable_days(x) for x in [60, 68, 119, 120, 128]], [7, 8, 13, 14, 15])
        for coins in range(60, 1000):
            days = r.affordable_days(coins)
            self.assertLessEqual((days // 7) * 60 + (days % 7) * 8, coins)

    def test_cooldown_and_pending(self):
        now = datetime.now(timezone.utc)
        self.assertFalse(r.due({"status": "pending"}, now, 7)[0])
        self.assertFalse(r.due({"lastSuccessAt": (now - timedelta(days=6)).isoformat()}, now, 7)[0])
        self.assertTrue(r.due({"lastSuccessAt": (now - timedelta(days=7)).isoformat()}, now, 7)[0])

    async def test_lewa_insufficient_does_not_purchase(self):
        c = Client([("菜单", ["🏪 积分商城"]), ("你的余额：592 积分", ["🛒 月卡 (3000积分)"])])
        with tempfile.TemporaryDirectory() as directory:
            result = await r.run_renewal(c, {"botUsername": "Lewa_user_bot"}, directory)
            self.assertEqual(result["status"], "insufficient")
            self.assertEqual(c.clicked, ["🏪 积分商城"])

    async def test_lewa_success_and_duplicate_prevention(self):
        c = Client([("菜单", ["积分商城"]), ("你的余额：3000 积分", ["🛒 月卡 (3000积分)", "🛒 半月卡 (1500积分)"]), ("兑换成功，到期时间已延长", [])])
        with tempfile.TemporaryDirectory() as directory:
            bot = {"botUsername": "Lewa_user_bot"}
            result = await r.run_renewal(c, bot, directory)
            self.assertEqual(result["status"], "success")
            self.assertEqual(c.clicked[-1], "🛒 月卡 (3000积分)")
            result = await r.run_renewal(c, bot, directory)
            self.assertEqual(result["status"], "skipped")
            self.assertEqual(c.sent, ["/start"])

    async def test_okemby_input_and_weekly_limit(self):
        c = Client([("主菜单", ["用户功能"]), ("状态正常", ["兑换商店"]), ("剩余OK币：128", ["续期可用天数"]), ("当前剩余OK币：128\n每7天需要 60 OK币\n每1天需要 8 OK币\n请输入要续期的天数", []), ("续期成功，增加15天", [])])
        with tempfile.TemporaryDirectory() as directory:
            bot = {"botUsername": "okemby_bot"}
            result = await r.run_renewal(c, bot, directory)
            self.assertEqual(result["status"], "success")
            self.assertEqual(c.sent, ["/start", "15"])
            result = await r.run_renewal(c, bot, directory)
            self.assertEqual(result["status"], "skipped")
            self.assertEqual(c.sent, ["/start", "15"])

    async def test_unknown_result_keeps_pending(self):
        c = Client([("菜单", ["积分商城"]), ("你的余额：3000 积分", ["🛒 月卡 (3000积分)"]), ("请确认兑换", [])])
        with tempfile.TemporaryDirectory() as directory:
            bot = {"botUsername": "Lewa_user_bot"}
            result = await r.run_renewal(c, bot, directory)
            self.assertEqual(result["status"], "pending")
            state = json.loads(next((Path(directory)/"telegram_renewals").glob("*.json")).read_text())
            self.assertEqual(state["status"], "pending")
            result = await r.run_renewal(c, bot, directory)
            self.assertEqual(result["status"], "pending")
            self.assertEqual(c.sent, ["/start"])

    async def test_changed_rate_cancels_without_spending(self):
        c = Client([("主菜单", ["用户功能"]), ("状态正常", ["兑换商店"]), ("剩余OK币：128", ["续期可用天数"]), ("每7天需要 70 OK币\n请输入要续期的天数", [])])
        with tempfile.TemporaryDirectory() as directory:
            result = await r.run_renewal(c, {"botUsername": "okemby_bot"}, directory)
            self.assertEqual(result["status"], "error")
            self.assertEqual(c.sent, ["/start", "/cancel"])
            self.assertFalse(list((Path(directory)/"telegram_renewals").glob("*.json")))


if __name__ == "__main__":
    unittest.main()
