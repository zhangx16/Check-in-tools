#!/usr/bin/env python3
"""Interactively replace an existing account session without running check-ins."""
import asyncio
import json
import os
import sys
from pyrogram import Client
from telegram_bot_checkin import CACHE_FILE, API_ID, API_HASH, load_form


async def main():
    accounts, _ = load_form()
    account = next(a for a in accounts if a["phone"].endswith(sys.argv[1]))
    phone = account["phone"]
    cache = json.loads(CACHE_FILE.read_text())
    keys = [k for k in cache["telegram"]["session_str"] if k.startswith(phone + "/")]
    if len(keys) != 1:
        raise RuntimeError("Expected exactly one existing session key")
    client = Client(phone, api_id=int(account["apiId"] or API_ID),
                    api_hash=account["apiHash"] or API_HASH,
                    phone_number=phone, in_memory=True)
    try:
        await client.start()
        session = await client.export_session_string()
        cache = json.loads(CACHE_FILE.read_text())
        cache["telegram"]["session_str"][keys[0]] = session
        temporary = CACHE_FILE.with_suffix(".relogin.tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump(cache, handle, ensure_ascii=False, indent=2)
        os.replace(temporary, CACHE_FILE)
        print(f"账号尾号 {sys.argv[1]} 登录成功，会话已保存", flush=True)
    finally:
        if client.is_connected:
            await client.stop()


if __name__ == "__main__":
    asyncio.run(main())
