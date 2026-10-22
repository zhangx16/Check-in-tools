"""Authorized balance-based renewals for Lewa and OkEmby."""
import asyncio
import fcntl
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path


def buttons(message):
    return [b for row in (getattr(message.reply_markup, "inline_keyboard", None) or []) for b in row]


def text(message):
    return message.text or message.caption or ""


def balance(content, kind):
    pattern = r"你的余额[：:]\s*([\d,]+)\s*积分" if kind == "lewa" else r"(?:当前)?(?:剩余OK币|积分OK币)[：:|｜]\s*([\d,]+)"
    found = re.search(pattern, content)
    return int(found[1].replace(",", "")) if found else None


def affordable_days(coins):
    # The bot charges 60 per seven days, plus 8 per remaining day.
    return (coins // 60) * 7 + min(6, (coins % 60) // 8)


async def latest(client, target, since, previous=None, min_id=None):
    for _ in range(15):
        async for m in client.get_chat_history(target, limit=8):
            if m.outgoing or (m.date and m.date.replace(tzinfo=timezone.utc) < since):
                continue
            if min_id is not None and m.id <= min_id:
                continue
            if previous and m.id == previous.id and text(m) == text(previous):
                continue
            if previous and m.id < previous.id:
                continue
            return m
        await asyncio.sleep(1)
    raise RuntimeError("等待兑换菜单或结果超时")


async def click(client, target, message, label):
    found = [b for b in buttons(message) if label in b.text]
    if len(found) != 1:
        raise RuntimeError(f"未找到唯一的「{label}」按钮")
    answer = ""
    try:
        result = await asyncio.wait_for(message.click(found[0].text, timeout=5), timeout=8)
        answer = str(getattr(result, "message", "") or "")
    except (asyncio.TimeoutError, TimeoutError):
        pass
    return answer


def write_state(path, state):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    os.chmod(temp, 0o600)
    temp.replace(path)


def due(state, now, interval):
    if state.get("status") == "pending":
        return False, "上次兑换已提交但结果待核对，暂停再次兑换"
    stamp = state.get("lastSuccessAt")
    if stamp and now - datetime.fromisoformat(stamp) < timedelta(days=interval):
        return False, f"距离上次续费未满 {interval} 天"
    return True, ""


async def run_renewal(client, bot, data_dir):
    target = bot["botUsername"]
    kind = "lewa" if target.lower() == "lewa_user_bot" else "okemby"
    interval = 1 if kind == "lewa" else 7
    directory = Path(data_dir) / "telegram_renewals"
    directory.mkdir(exist_ok=True, mode=0o700)
    key = re.sub(r"[^a-zA-Z0-9_-]", "", f"{client.phone_number}_{target.lower()}")
    path = directory / f"{key}.json"
    with (directory / f"{key}.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "skipped", "message": "另一任务正在处理续费"}
        state = json.loads(path.read_text()) if path.exists() else {}
        now = datetime.now(timezone.utc)
        ready, reason = due(state, now, interval)
        if not ready:
            return {"status": "pending" if state.get("status") == "pending" else "skipped", "message": reason}
        submitted = False
        try:
            since = now - timedelta(seconds=2)
            sent = await client.send_message(target, "/start")
            menu = await latest(client, target, since, min_id=sent.id)
            if kind == "lewa":
                await click(client, target, menu, "积分商城")
                shop = await latest(client, target, since, menu)
                coins = balance(text(shop), kind)
                if coins is None:
                    raise RuntimeError("无法识别积分商城余额")
                if coins < 3000:
                    return {"status": "insufficient", "balance": coins, "message": f"余额 {coins} 积分，不足 3000，暂不兑换月卡"}
                cards = [b for b in buttons(shop) if re.fullmatch(r"\s*(?:🛒\s*)?月卡\s*[（(]3000\s*积分[）)]", b.text)]
                if len(cards) != 1:
                    raise RuntimeError("无法确认 3000 积分月卡按钮")
                pending = {**state, "status": "pending", "submittedAt": now.isoformat(), "balanceBefore": coins, "item": "月卡", "cost": 3000}
                write_state(path, pending); submitted = True
                answer = await click(client, target, shop, cards[0].text)
                previous = shop
            else:
                if "未注册" in text(menu):
                    return {"status": "skipped", "message": "账号未注册，暂不续费"}
                await click(client, target, menu, "用户功能")
                profile = await latest(client, target, since, menu)
                if "未注册" in text(profile):
                    return {"status": "skipped", "message": "账号未注册，暂不续费"}
                await click(client, target, profile, "兑换商店")
                shop = await latest(client, target, since, profile)
                coins = balance(text(shop), kind)
                if coins is None: raise RuntimeError("无法识别 OK 币余额")
                if coins < 60:
                    return {"status": "insufficient", "balance": coins, "message": f"余额 {coins} OK币，不足 60，暂不续费"}
                await click(client, target, shop, "续期可用天数")
                prompt = await latest(client, target, since, shop)
                content = text(prompt)
                if not re.search(r"每7天需要\s*60\s*OK币", content) or not re.search(r"每1天需要\s*8\s*OK币", content) or "请输入要续期的天数" not in content:
                    await client.send_message(target, "/cancel")
                    raise RuntimeError("续期汇率或输入提示发生变化，取消兑换")
                coins = balance(content, kind)
                if coins is None or coins < 60:
                    await client.send_message(target, "/cancel")
                    raise RuntimeError("提交前余额不足或无法识别")
                days = affordable_days(coins)
                pending = {**state, "status": "pending", "submittedAt": now.isoformat(), "balanceBefore": coins, "days": days}
                write_state(path, pending); submitted = True
                await client.send_message(target, str(days))
                answer = ""; previous = prompt
            try:
                result = await latest(client, target, since, previous)
                response = text(result)
            except RuntimeError:
                response = ""
            content = "\n".join(part for part in [answer, response] if part)
            if not any(marker in content for marker in ["失败", "不足", "取消", "错误"]) and any(marker in content for marker in ["兑换成功", "续期成功", "续费成功", "购买成功", "已成功兑换"]):
                pending.update(status="success", lastSuccessAt=datetime.now(timezone.utc).isoformat(), message=content)
                write_state(path, pending)
                return {"status": "success", "message": content, "balanceBefore": coins, **({"days": days} if kind == "okemby" else {"item": "月卡"})}
            # Keep pending on any uncertain result: never repeat a debit blindly.
            pending["message"] = content or "兑换已提交，未收到明确成功回复，需要核对"
            write_state(path, pending)
            return {"status": "pending", "message": pending["message"]}
        except Exception as error:
            return {"status": "pending" if submitted else "error", "message": str(error)}
