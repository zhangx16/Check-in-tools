"""Turnstile check-in adapters using the explicitly configured Peak solver.

Peak documentation: https://peak.fo/docs . No Telegram initData or signed
verification URL is transmitted to Peak; only page origin/path and widget data.
"""
import json
import re
import secrets
import time
import urllib.error
import urllib.request
from functools import wraps
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse, quote

from curl_cffi import requests
from curl_cffi.requests.exceptions import RequestException

PEAK_ORIGIN = 'https://api.peak.fo'
ALLOWED_HOSTS = {'embyguard.com', 'verify.xghub.de', 'liminal-embyboss.liminalnet.us', 'glados.network'}


def origin_for(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in ALLOWED_HOSTS or parsed.port not in (None, 443) or parsed.username:
        raise RuntimeError('不支持的签到验证域名')
    return f'https://{parsed.hostname}'


def config(data_dir):
    try:
        value = json.loads((Path(data_dir) / 'peak_solver.json').read_text())
    except (OSError, ValueError):
        raise RuntimeError('请先在 data/peak_solver.json 配置 Peak apiKey') from None
    if not isinstance(value, dict) or not isinstance(value.get('apiKey'), str) or not value['apiKey'].startswith('pk_'):
        raise RuntimeError('Peak apiKey 配置无效')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class PeakSolver:
    def __init__(self, data_dir):
        self.config = config(data_dir)

    def redact(self, text):
        for key in ('apiKey', 'proxy'):
            if self.config.get(key):
                text = text.replace(self.config[key], '[redacted]')
        return re.sub(r'https?://[^\s]+', '[URL]', text)[:240]

    def call(self, path, body=None):
        request = urllib.request.Request(
            PEAK_ORIGIN + path, data=json.dumps(body).encode() if body is not None else None,
            headers={'X-API-Key': self.config['apiKey'], 'Content-Type': 'application/json',
                     'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0'},
            method='POST' if body is not None else 'GET')
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=75) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read()).get('error', '')
            except (ValueError, AttributeError):
                detail = ''
            raise RuntimeError(f'Peak API HTTP {error.code}：{self.redact(str(detail))}') from None
        except (OSError, ValueError):
            raise RuntimeError('Peak API 请求失败或未返回 JSON') from None
        if not isinstance(payload, dict) or payload.get('success') is not True:
            detail = payload.get('error', '响应格式异常') if isinstance(payload, dict) else '响应格式异常'
            raise RuntimeError('Peak 识别失败：' + self.redact(str(detail)))
        data = payload.get('data')
        if not isinstance(data, dict):
            raise RuntimeError('Peak API 返回数据格式异常')
        return data

    def solve(self, url, sitekey, action='', cdata=''):
        origin_for(url)
        if not isinstance(sitekey, str) or not sitekey.strip():
            raise RuntimeError('缺少 Turnstile sitekey')
        # Peak requires a trailing slash; omit all signed query/fragment data.
        page = urlparse(url)
        clean_url = f'{origin_for(url)}{page.path.rstrip("/")}/'
        proxy = self.config.get('proxy')
        payload = {'task_type': 'turnstiletask' if proxy else 'TurnstileTaskProxyLess',
                   'url': clean_url, 'sitekey': sitekey}
        if proxy:
            payload['proxy'] = proxy
        if action:
            payload['action'] = action
        if cdata:
            payload['cdata'] = cdata
        result = self.call('/solve', payload)
        token = result.get('token')
        if not isinstance(token, str) or not token.strip():
            raise RuntimeError('Peak 未返回有效 Turnstile token')
        return token

    def session(self):
        kwargs = {'impersonate': 'chrome'}
        if self.config.get('proxy'):
            kwargs['proxy'] = self.config['proxy']
        return requests.Session(**kwargs)


class WidgetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.widget = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('data-sitekey'):
            self.widget = {'sitekey': attrs['data-sitekey'], 'action': attrs.get('data-action', ''),
                           'cdata': attrs.get('data-cdata', '')}


def widget_from_html(html):
    parser = WidgetParser()
    parser.feed(html)
    if parser.widget:
        return parser.widget
    sitekey = re.search(r"sitekey\s*:\s*['\"]([^'\"]+)['\"]", html)
    if not sitekey:
        raise RuntimeError('验证页面未找到 Turnstile 配置')
    return {'sitekey': sitekey.group(1), 'action': '', 'cdata': ''}


def response_json(response):
    try:
        payload = response.json()
    except ValueError:
        raise RuntimeError(f'签到网站未返回 JSON（HTTP {response.status_code}），可能被浏览器验证拦截') from None
    if not isinstance(payload, dict):
        raise RuntimeError('签到网站返回格式异常')
    return payload


def safe_transport(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except RequestException:
            # Transport errors can include proxy credentials or signed URLs.
            raise RuntimeError('签到网站连接失败或超时，请核对代理和 Bot 中的实际结果') from None
    return wrapped


@safe_transport
def post_moonkk(webapp_url, init_data, data_dir):
    origin = origin_for(webapp_url)
    if origin != 'https://embyguard.com':
        raise RuntimeError('月饼验证域名不匹配')
    solver = PeakSolver(data_dir)
    server = (parse_qs(urlparse(webapp_url).query).get('server') or ['server-1'])[0]
    base = f'{origin}/api/v1/servers/{quote(server, safe="")}/telegram/checkin'
    with solver.session() as session:
        headers = {'Origin': origin, 'Referer': webapp_url}
        initial = session.post(base, json={'init_data': init_data}, headers=headers, timeout=25)
        payload = response_json(initial)
        if initial.status_code >= 400:
            raise RuntimeError(f'月饼签到请求失败（HTTP {initial.status_code}）')
        data = payload.get('data') if isinstance(payload.get('data'), dict) else payload
        if data.get('status') != 'verification_required':
            return payload
        if not all(isinstance(data.get(k), str) and data[k] for k in ('challenge', 'site_key', 'action', 'cdata')):
            raise RuntimeError('月饼人机验证配置不完整')
        token = solver.solve(webapp_url, data['site_key'], data['action'], data['cdata'])
        complete = session.post(base + '/' + quote(data['challenge'], safe=''),
                                json={'init_data': init_data, 'turnstile_token': token}, headers=headers, timeout=25)
        payload = response_json(complete)
        if complete.status_code >= 400:
            raise RuntimeError(f'月饼验证提交失败（HTTP {complete.status_code}），请在 Bot 核对结果')
        return payload


@safe_transport
def post_liminal(webapp_url, init_data, data_dir):
    origin = origin_for(webapp_url)
    if origin != 'https://liminal-embyboss.liminalnet.us':
        raise RuntimeError('Liminal 验证域名不匹配')
    solver = PeakSolver(data_dir)
    started = time.time()
    user_data = json.loads((parse_qs(init_data).get('user') or ['{}'])[0])
    user_id = user_data.get('id')
    if not isinstance(user_id, int):
        raise RuntimeError('小程序授权缺少用户 ID')
    with solver.session() as session:
        page = session.get(webapp_url, timeout=25)
        if page.status_code != 200:
            raise RuntimeError(f'Liminal 验证页加载失败（HTTP {page.status_code}）')
        if re.search(r"recaptchaSiteKey\s*=\s*['\"][^'\"]+['\"]", page.text):
            raise RuntimeError('Liminal 额外启用了 reCAPTCHA，目前仅适配 Turnstile')
        widget = widget_from_html(page.text)
        token = solver.solve(webapp_url, **widget)
        elapsed = time.time() - started
        if elapsed < 1.1:
            time.sleep(1.1 - elapsed)
        body = {'user_id': user_id, 'turnstile_token': token, 'webapp_data': init_data,
                'timestamp': int(time.time()), 'nonce': secrets.token_hex(13),
                'interactions': 1, 'session_duration': int((time.time()-started)*1000),
                'page_load_time': int(started*1000)}
        query = parse_qs(urlparse(webapp_url).query)
        for field in ('chat_id', 'message_id'):
            if query.get(field):
                body[field] = int(query[field][0])
        response = session.post(origin + '/checkin/verify', json=body,
                                headers={'Origin': origin, 'Referer': webapp_url,
                                         'X-Requested-With': 'XMLHttpRequest'}, timeout=25)
        payload = response_json(response)
        if response.status_code == 409:
            return {'ok': True, 'already': True, 'skipped': False, 'message': '今日已签到'}
        message = str(payload.get('message') or payload.get('detail') or '')
        if response.status_code == 200 and '签到成功' in message:
            return {'ok': True, 'already': False, 'skipped': False,
                    'message': message + ('，' + str(payload['reward']) if payload.get('reward') is not None else '')}
        return {'ok': False, 'already': False, 'skipped': False,
                'message': f'Liminal 签到未确认（HTTP {response.status_code}）：{message[:200]}'}


@safe_transport
def verify_xg(webapp_url, data_dir):
    origin = origin_for(webapp_url)
    if origin != 'https://verify.xghub.de':
        raise RuntimeError('西瓜验证域名不匹配')
    query = parse_qs(urlparse(webapp_url).query)
    state = (query.get('state') or [''])[0]
    bot = (query.get('return_bot') or [''])[0]
    if not state or bot.lower() != 'xgfree_bot':
        raise RuntimeError('西瓜验证链接无效')
    solver = PeakSolver(data_dir)
    with solver.session() as session:
        page = session.get(webapp_url, timeout=25)
        if page.status_code != 200:
            raise RuntimeError(f'西瓜验证页加载失败（HTTP {page.status_code}），请重新打开签到')
        token = solver.solve(webapp_url, **widget_from_html(page.text))
        response = session.post(origin + '/register-code/verify',
                                json={'token': token, 'state': state, 'return_bot': bot},
                                headers={'Origin': origin, 'Referer': webapp_url}, timeout=25)
        payload = response_json(response)
        if response.status_code != 200 or payload.get('ok') is not True:
            raise RuntimeError('西瓜安全验证未通过')
        parsed = urlparse(str(payload.get('return_url') or ''))
        if parsed.scheme != 'https' or parsed.netloc != 't.me' or parsed.path.lower() != '/xgfree_bot':
            raise RuntimeError('西瓜验证未返回有效的 Bot 链接')
        start = (parse_qs(parsed.query).get('start') or [''])[0]
        if not start or not re.fullmatch(r'[A-Za-z0-9_-]{1,512}', start):
            raise RuntimeError('西瓜验证返回参数无效')
        return start
