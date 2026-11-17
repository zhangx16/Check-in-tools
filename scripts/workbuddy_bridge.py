#!/usr/bin/env python3
"""Run the pinned upstream core with stdin credentials and a process-wide uid lock."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor/workbuddy-auto-signin'))
import signin
from workbuddy_tasks import TaskTracker


def execute_core(session, action, tracker):
    signin._start_budget(action)
    signin._validate_session(session)
    if signin._token_format(session['auth']['accessToken']) != 'plaintext':
        return 1, {'result': 'AUTH_ERROR', 'report': 'Linux 服务需要明文登录凭据，请重新导入 CodeBuddy CLI 登录态'}
    # This deployment supports only the official WorkBuddy endpoint.
    if session['auth'].get('endpoint', signin.DEFAULT_ENDPOINT).rstrip('/') != signin.DEFAULT_ENDPOINT:
        return 1, {'result': 'AUTH_ERROR', 'report': '仅支持官方 WorkBuddy 服务地址'}
    headers = signin.build_headers(session)
    if action == 'auto':
        code, out, _ = signin.run_daily(headers, signin.DEFAULT_ENDPOINT)
        return code, out
    code, body = signin.post(signin.DEFAULT_ENDPOINT + '/v2/billing/meter/checkin-activity-status', headers, retry=True)
    if code in (401, 403):
        return 1, signin._auth_failure(code)
    if not 200 <= code < 300:
        return 1, {'result': 'NETWORK' if code == signin.CODE_NO_NETWORK else 'TIMEOUT' if code == signin.CODE_BUDGET_OUT else 'ERROR', 'report': '状态查询失败，请稍后重试'}
    active = signin.dig(body, 'active')
    signed = signin.dig(body, 'today_checked_in') in (True, 1)
    if active is not False and not isinstance(signin.dig(body, 'today_checked_in'), (bool, int)):
        return 1, {'result': 'ERROR', 'report': '状态接口返回的数据不完整'}
    tracker.read_growth(headers, signin.DEFAULT_ENDPOINT)
    return 0, {'result': 'STATUS', 'report': '签到活动未开启' if active is False else '今日已签到' if signed else '今日待签到',
               'active': active, 'today_checked_in': signed,
               'total_credits': signin.dig(body, 'total_credits'), 'streak_days': signin.dig(body, 'streak_days')}


def execute(session, action):
    tracker = TaskTracker(signin, session)
    tracker.install()
    try:
        code, out = execute_core(session, action, tracker)
        out['tasks'] = tracker.snapshot()
        return code, out
    finally:
        tracker.restore()


def main():
    os.umask(0o077)
    session = json.loads(sys.stdin.buffer.read(131073))
    action = sys.argv[1]
    if action not in ('status', 'auto'):
        raise ValueError('invalid action')
    signin._validate_session(session)
    lockdir = Path(os.environ['WORKBUDDY_LOCK_DIR'])
    lockdir.mkdir(parents=True, exist_ok=True, mode=0o700)
    lockname = hashlib.sha256(session['account']['uid'].encode()).hexdigest() + '.lock'
    with (lockdir / lockname).open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 1, {'result': 'BUSY', 'report': '该账号正在执行其他 WorkBuddy 任务，请稍后查看结果'}
        return execute(session, action)


if __name__ == '__main__':
    try:
        code, out = main()
    except signin.AuthError as error:
        code, out = 1, error.output()
    except Exception:
        code, out = 1, {'result': 'ERROR', 'report': 'WorkBuddy 脚本运行异常，请检查运行环境'}
    # Do not expose raw response bodies, headers, or credentials from upstream.
    allowed = ('result', 'report', 'credit', 'credits_gained', 'today_credit', 'total_credits',
               'streak_days', 'growth', 'growth_result', 'active', 'today_checked_in', 'needs_attention', 'growth_credits', 'tasks')
    result = {k: out[k] for k in allowed if k in out}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(code)
