"""Complete GLaDOS nonce/proof/Turnstile check-in through the configured proxy."""
import hashlib
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlparse
from curl_cffi.requests.exceptions import RequestException
from telegram_cf_checkin import PeakSolver, response_json


def checkin(account, data_dir, solver=None):
    base = str(account.get('baseUrl') or 'https://glados.network').rstrip('/')
    parsed = urlparse(base)
    if parsed.scheme != 'https' or parsed.netloc != 'glados.network' or parsed.path:
        raise RuntimeError('GLaDOS CF 适配仅允许 https://glados.network')
    cookie = account.get('cookie')
    if not cookie:
        raise RuntimeError('缺少 GLaDOS Cookie')
    solver = solver or PeakSolver(data_dir)
    ua = account.get('userAgent') or 'Mozilla/5.0'
    headers = {'Cookie': cookie, 'User-Agent': ua, 'Origin': base,
               'Referer': base + '/console/checkin', 'Accept': 'application/json'}
    with solver.session() as session:
        started = time.monotonic()
        response = session.get(base + '/api/user/checkin/challenge', headers=headers,
                               timeout=25, allow_redirects=False)
        challenge = response_json(response)
        if response.status_code != 200:
            raise RuntimeError(f'GLaDOS challenge HTTP {response.status_code}')
        if challenge.get('code') != 0:
            return challenge
        nonce = challenge.get('nonce')
        if not isinstance(nonce, str) or not nonce:
            raise RuntimeError('GLaDOS challenge 缺少 nonce')
        ttl = challenge.get('ttl')
        if not isinstance(ttl, (int, float)) or ttl <= 0:
            raise RuntimeError('GLaDOS challenge 有效期无效')
        payload = {'token': parsed.hostname, 'nonce': nonce,
                   'proof': hashlib.sha256((nonce + '.glados-observe-v1').encode()).hexdigest(),
                   'tsState': 'off'}
        sitekey = challenge.get('turnstile')
        if sitekey:
            payload['turnstile'] = solver.solve(base + '/console/checkin', sitekey, 'checkin', nonce)
            payload['tsState'] = 'ok'
        remaining = 2.5 - (time.monotonic() - started)
        if remaining > 0:
            time.sleep(remaining)
        if (time.monotonic() - started) * 1000 >= ttl - 1000:
            raise RuntimeError('GLaDOS challenge 已临近过期，未提交签到')
        response = session.post(base + '/api/user/checkin', json=payload,
                                headers=headers, timeout=25, allow_redirects=False)
        result = response_json(response)
        if response.status_code != 200:
            raise RuntimeError(f'GLaDOS 签到 HTTP {response.status_code}')
        return result


def main():
    try:
        account = json.load(sys.stdin)
        result = checkin(account, Path(__file__).resolve().parents[1] / 'data')
        print(json.dumps({'payload': result}, ensure_ascii=False))
    except RequestException:
        print(json.dumps({'error': 'GLaDOS 验证连接失败或超时，请核对代理和网站中的实际签到结果'}))
    except Exception as error:
        # Errors from Peak already redact its key and proxy credentials.
        print(json.dumps({'error': str(error)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
