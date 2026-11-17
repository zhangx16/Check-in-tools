"""Sign in through Ccbot's Telegram-authorized mini app."""
import http.cookiejar
import json
import urllib.error
import urllib.request
from urllib.parse import urlparse

ORIGIN = 'https://ccbot.wybcs.work'
USER_AGENT = ('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36')


def find_checkin_url(message):
    for row in (getattr(message.reply_markup, 'inline_keyboard', None) or []):
        for button in row:
            app = getattr(button, 'web_app', None)
            url = str(getattr(app, 'url', '') or '')
            parsed = urlparse(url)
            if (parsed.scheme == 'https' and parsed.netloc == 'ccbot.wybcs.work'
                    and ('签到' in str(button.text) or 'tab=checkin' in parsed.query)):
                return url
    return ''


def request_json(opener, path, body=None):
    request = urllib.request.Request(
        ORIGIN + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                 'Origin': ORIGIN, 'Referer': ORIGIN + '/?tab=checkin',
                 'User-Agent': USER_AGENT},
        method='POST' if body is not None else 'GET')
    try:
        with opener.open(request, timeout=20) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read())
            message = str(payload.get('msg') or payload.get('message') or '')
        except (ValueError, AttributeError):
            message = ''
        raise RuntimeError(message or f'Ccbot 小程序请求失败（HTTP {error.code}）') from error
    except ValueError as error:
        raise RuntimeError('Ccbot 小程序未返回 JSON') from error
    if not isinstance(result, dict):
        raise RuntimeError('Ccbot 小程序返回格式异常')
    return result


def status_result(profile, already, message):
    parts = [message]
    if isinstance(profile.get('iv'), (int, float)):
        parts.append(f"当前余额 {profile['iv']} {profile.get('money') or 'cc币'}")
    return {'ok': True, 'already': already, 'skipped': False, 'message': '，'.join(parts)}


def read_profile(opener):
    profile = request_json(opener, '/api/me')
    if profile.get('registered') is False:
        raise RuntimeError('Ccbot 账号未注册或未绑定，请先在新机器人完成绑定')
    profile = profile.get('user') if isinstance(profile.get('user'), dict) else profile
    if type(profile.get('canCheckin')) is not bool:
        raise RuntimeError('Ccbot 小程序未返回明确的签到状态')
    return profile


def checkin_miniapp(init_data, opener=None):
    if not init_data:
        raise RuntimeError('缺少 Ccbot 小程序 Telegram 授权')
    if opener is None:
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    auth = request_json(opener, '/api/auth/tg', {'initData': init_data})
    if auth.get('ok') is False:
        raise RuntimeError(str(auth.get('msg') or auth.get('message') or 'Ccbot 小程序登录失败'))
    profile = read_profile(opener)
    if not profile['canCheckin']:
        return status_result(profile, True, '今日已签到')
    try:
        action = request_json(opener, '/api/action', {'action': 'checkin'})
    except Exception:
        # A lost response must be checked against the server before retrying tomorrow.
        after = read_profile(opener)
        if not after['canCheckin']:
            return status_result(after, True, '状态确认今日已签到')
        raise
    after = read_profile(opener)
    if not after['canCheckin']:
        return status_result(after, action.get('ok') is not True,
                             str(action.get('msg') or '签到成功'))
    raise RuntimeError(str(action.get('msg') or '签到请求未被服务器确认'))
