"""Optional Embykeeper visual-service protocol, without its runtime dependency.

Protocol reference: embykeeper/telegram/link.py and checkiner/terminus.py.
Only requests explicitly enabled in data/telegram_visual.json are sent remotely.
"""
import asyncio
import json
import os
import socket
import tomllib
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

AUTH_BOT = 'embykeeper_auth_bot'
INSTANCE = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'glados-checkin-web:' + socket.gethostname()))


def visual_enabled(data_dir):
    try:
        config = json.loads((Path(data_dir) / 'telegram_visual.json').read_text())
    except (OSError, ValueError):
        return False
    return isinstance(config, dict) and config.get('enabled') is True


def clean_option(text):
    return ''.join(c for c in str(text) if not c.isspace()
                   and unicodedata.category(c)[0] not in {'S', 'M', 'C'})


def claim_attempt(data_dir, phone):
    directory = Path(data_dir) / 'telegram_visual_attempts'
    directory.mkdir(parents=True, exist_ok=True)
    day = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    filename = directory / f"{''.join(c for c in phone if c.isdigit())}-{day}.json"
    try:
        fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return False
    with os.fdopen(fd, 'w') as handle:
        json.dump({'startedAt': datetime.now(timezone.utc).isoformat()}, handle)
    return True


async def request(client, command, photo=None, timeout=15):
    """Match the echoed command, ignoring unrelated history and partial replies."""
    async def exchange():
        if photo:
            sent = await client.send_photo(AUTH_BOT, photo, caption=command, parse_mode=None)
        else:
            sent = await client.send_message(AUTH_BOT, command, parse_mode=None)
        while True:
            async for message in client.get_chat_history(AUTH_BOT, limit=10):
                if message.outgoing or message.id <= sent.id:
                    continue
                try:
                    response = tomllib.loads(message.text or '')
                except (tomllib.TOMLDecodeError, TypeError):
                    continue
                if response.get('command') != command:
                    continue
                if response.get('status') == 'error':
                    raise RuntimeError('视觉服务拒绝请求：' + str(response.get('errmsg') or '未知原因'))
                if response.get('status') == 'ok':
                    return response
            await asyncio.sleep(0.5)
    return await asyncio.wait_for(exchange(), timeout=timeout)


async def authorize(client):
    await request(client, f'/auth visual {INSTANCE}')


async def answer_challenge(client, message):
    keyboard = getattr(message.reply_markup, 'inline_keyboard', None) or []
    buttons = [b for row in keyboard for b in row
               if getattr(b, 'callback_data', None)]
    options = [clean_option(b.text) for b in buttons]
    if len(options) < 2 or not all(options) or len(set(options)) != len(options):
        raise RuntimeError('图片验证码候选项无效')
    if any('/' in option or '\n' in option for option in options):
        raise RuntimeError('图片验证码候选项格式不支持')
    # The Bot allows only 30 seconds, including transmission and button click.
    age = max(0, (datetime.now(timezone.utc) - message.date.replace(tzinfo=timezone.utc)).total_seconds())
    remaining = 27 - age
    if remaining <= 2:
        raise RuntimeError('图片验证码已过期，不提交答案或重复签到')
    async def solve_and_click():
        response = await request(client, f"/visual {INSTANCE} {'/'.join(options)}",
                                 photo=message.photo.file_id, timeout=min(18, remaining - 2))
        answer = response.get('answer')
        if not isinstance(answer, str) or answer not in options:
            raise RuntimeError('视觉服务未返回候选项中的答案，不点击按钮')
        button = buttons[options.index(answer)]
        await client.request_callback_answer(message.chat.id, message.id,
                                             callback_data=button.callback_data, timeout=3)
    await asyncio.wait_for(solve_and_click(), timeout=remaining)
