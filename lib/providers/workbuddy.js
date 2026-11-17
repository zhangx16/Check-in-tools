const path = require('node:path');
const { spawn } = require('node:child_process');
const { DATA_DIR, formatDateTime } = require('../common');
const DEFAULT_BASE_URL = 'https://copilot.tencent.com';
const BRIDGE = path.resolve(__dirname, '../../scripts/workbuddy_bridge.py');
const permanent = new Set(['AUTH_REJECTED', 'AUTH_FORBIDDEN', 'FORBIDDEN', 'AUTH_ERROR', 'NO_AUTH', 'BUSY']);

function normalizeSession(value) {
  let x = typeof value === 'string' ? JSON.parse(value) : value;
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error('请提供登录凭据 JSON');
  if (!x.auth) x = { auth: { accessToken: x.accessToken, refreshToken: x.refreshToken, expiresAt: x.expiresAt, refreshExpiresAt: x.refreshExpiresAt, domain: x.domain, endpoint: x.endpoint }, account: { uid: x.uid, enterpriseId: x.enterpriseId } };
  const auth = x.auth || {}, account = x.account || {};
  if (typeof auth.accessToken !== 'string' || !/^[A-Za-z0-9._~+/-]{1,32768}=*$/.test(auth.accessToken) || auth.accessToken.length > 32768 || /^(?:enc:|encrypted:)/i.test(auth.accessToken)) throw Error('需要明文 accessToken，请使用 CodeBuddy CLI 登录凭据');
  for (const [key, v] of Object.entries({ uid: account.uid, enterpriseId: account.enterpriseId || '', domain: auth.domain || '' })) {
    if (typeof v !== 'string' || (v && !/^[\x21-\x7e]{1,2048}$/.test(v)) || (key === 'uid' && !v)) throw Error('凭据 uid / enterpriseId / domain 格式不正确');
  }
  if (auth.endpoint && auth.endpoint.replace(/\/$/, '') !== DEFAULT_BASE_URL) throw Error('仅支持官方 WorkBuddy 服务地址');
  const extra = {};
  if (auth.refreshToken != null && auth.refreshToken !== '') {
    if (typeof auth.refreshToken !== 'string' || !/^[A-Za-z0-9._~+/-]{1,32768}=*$/.test(auth.refreshToken) || /^(?:enc:|encrypted:)/i.test(auth.refreshToken)) throw Error('refreshToken 必须是有效的明文刷新令牌');
    extra.refreshToken = auth.refreshToken;
  }
  for (const key of ['expiresAt', 'refreshExpiresAt']) {
    if (auth[key] != null) {
      if (!['number', 'string'].includes(typeof auth[key]) || !Number.isFinite(typeof auth[key] === 'number' ? auth[key] : Date.parse(auth[key]))) throw Error('令牌有效期格式不正确');
      extra[key] = auth[key];
    }
  }
  return { auth: { accessToken: auth.accessToken, ...extra, domain: auth.domain || '', endpoint: DEFAULT_BASE_URL }, account: { uid: account.uid, enterpriseId: account.enterpriseId || '' } };
}
function validateAccount(account) {
  try { normalizeSession(account.workbuddySession); return ''; }
  catch (e) { return e instanceof SyntaxError ? '登录凭据不是有效 JSON' : e.message; }
}
function invoke(session, action) {
  return new Promise(resolve => {
    const budget = Math.max(30, Math.min(540, Number(process.env.WORKBUDDY_BUDGET_SECONDS) || 420));
    const child = spawn(process.env.WORKBUDDY_PYTHON || '/usr/bin/python3', [BRIDGE, action], {
      env: { ...process.env, WORKBUDDY_BUDGET_SECONDS: String(budget), WORKBUDDY_LOCK_DIR: path.join(DATA_DIR, 'workbuddy-locks') },
      stdio: ['pipe', 'pipe', 'ignore']
    });
    let output = '', timedOut = false, overflow = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, (budget + 20) * 1000);
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(session));
    child.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 65536) { overflow = true; child.kill('SIGKILL'); }
    });
    child.on('error', () => { clearTimeout(timer); resolve({ exitCode: 1, out: { result: 'ENV_ERROR', report: '无法启动 Python 3 签到脚本' } }); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return resolve({ exitCode: 1, out: { result: 'TIMEOUT', report: 'WorkBuddy 执行超时，请稍后重试' } });
      try {
        if (overflow) throw Error();
        const out = JSON.parse(output);
        if (!out || typeof out.result !== 'string') throw Error();
        // Upstream reports are useful, but no credential may be retained in results.
        for (const key of ['report', 'growth']) if (typeof out[key] === 'string') {
          for (const token of [session.auth.accessToken, session.auth.refreshToken].filter(Boolean)) out[key] = out[key].split(token).join('[已隐藏]');
          out[key] = out[key].slice(0, 2500);
        }
        resolve({ exitCode: code, out });
      } catch { resolve({ exitCode: 1, out: { result: 'ERROR', report: '签到脚本未返回有效结果' } }); }
    });
  });
}
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
function mapResult(account, action, { exitCode, out }) {
  const next = { ...account }, at = formatDateTime();
  const signed = ['ALREADY', 'CLAIMED'].includes(out.result) || out.today_checked_in === true;
  const ok = exitCode === 0 && !out.needs_attention && ['ALREADY', 'CLAIMED', 'INACTIVE', 'STATUS'].includes(out.result);
  const partial = !ok && signed;
  const message = [out.report, out.growth && !String(out.report).includes(out.growth) ? out.growth : ''].filter(Boolean).join('；') || '未获得签到结果';
  const status = { ok, state: ok ? (out.active === false || out.result === 'INACTIVE' ? 'inactive' : 'active') : partial ? 'partial' : 'error',
    code: out.result, message, tasks: Array.isArray(out.tasks) ? out.tasks : [], todaySigned: signed, points: number(out.total_credits), currentStreak: number(out.streak_days), currency: '积分',
    ...(signed ? { lastSignInDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) } : {}) };
  next.lastStatus = status; next.lastStatusAt = next.updatedAt = at;
  if (action === 'auto') {
    next.lastCheckin = { ok, code: out.result, already: ok && out.result === 'ALREADY', partial,
      skipped: ok && out.result === 'INACTIVE', message, todaySigned: signed, currentStreak: status.currentStreak,
      points: out.growth_credits !== undefined ? (number(out.credits_gained) || 0) : (out.result === 'CLAIMED' ? number(out.credit) || 0 : 0) + (number(out.credits_gained) || 0),
      tasks: status.tasks,
      balance: status.points, currency: '积分', retryable: !permanent.has(out.result) && !partial,
      growth: out.growth || '', growthCode: out.growth_result || '', ...(status.lastSignInDate ? { lastSignInDate: status.lastSignInDate } : {}) };
    next.lastCheckinAt = at;
  }
  return { account: next, summary: { id: next.id, name: next.name, status: next.lastStatus, ...(action === 'auto' ? { checkin: next.lastCheckin } : {}) } };
}
async function run(account, action) {
  let value;
  try {
    const auth = require('../workbuddy-auth');
    let session = await auth.prepare(account);
    value = await invoke(session, action);
    if (value.out.result === 'AUTH_REJECTED' && session.auth.refreshToken) {
      session = await auth.prepare(account, true);
      value = await invoke(session, action);
    }
  }
  catch (error) { value = { exitCode: 1, out: { result: error.authCode || 'AUTH_ERROR', report: error.safeMessage || '缺少有效 WorkBuddy 凭据，请重新导入' } }; }
  return mapResult(account, action, value);
}
// Persist only run fields so in-flight work cannot restore deleted accounts or overwrite edited credentials.
function mergeRun(current, processed) {
  const next = { ...current };
  for (const key of ['lastCheckin', 'lastCheckinAt', 'lastStatus', 'lastStatusAt']) if (processed[key] !== undefined) next[key] = processed[key];
  next.updatedAt = formatDateTime();
  return next;
}
module.exports = { DEFAULT_BASE_URL, normalizeSession, validateAccount, invoke, mapResult, mergeRun,
  refreshAccountStatus: account => run(account, 'status'), runAccountCheckin: account => run(account, 'auto') };
