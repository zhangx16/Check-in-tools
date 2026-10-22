"""Local image CAPTCHA recognition; no remote auth or OCR service."""
import asyncio
import re
_ENGINE = None


def recognize(image, lengths):
    global _ENGINE
    if _ENGINE is None:
        import ddddocr
        _ENGINE = ddddocr.DdddOcr(show_ad=False)
    answer = _ENGINE.classification(image)
    answer = re.sub(r'\s+', '', str(answer or ''))
    allowed = [lengths] if isinstance(lengths, int) else lengths
    if not answer or not answer.isascii() or not answer.isalnum():
        return None
    if allowed and len(answer) not in allowed:
        return None
    return answer


async def answer_captcha(client, message, bot):
    if not bot.get('useCaptcha') or not getattr(message, 'photo', None):
        return False
    caption = message.caption or ''
    pattern = bot.get('captchaPattern')
    if pattern:
        if not re.search(pattern, caption):return False
    elif not any(word in caption for word in ['验证码','驗證碼','captcha','CAPTCHA']):
        return False
    media = await client.download_media(message, in_memory=True)
    answer = await asyncio.to_thread(recognize, media.getvalue(), bot.get('captchaLengths') or [])
    if not answer:
        return False
    await client.send_message(bot['botUsername'], answer)
    return True
