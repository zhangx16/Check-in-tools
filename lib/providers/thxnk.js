const crypto = require('crypto');
const {
  normalizeBaseUrl, formatDateTime, getTimeoutMs, USER_AGENT,
  buildCookieHeaderFromSetCookie, mergeCookieHeaders
} = require('../common');

const DEFAULT_BASE_URL = 'https://thxnk.cc';
const currencyLabel = currency => currency === 'TOKEN' ? '只因' : currency;
function minorAmount(value) {
  if (!Number.isSafeInteger(value)) throw new Error('网站返回的积分金额格式异常');
  return value / 100;
}
async function request(session, route, method = 'GET', body) {
  const csrf = session.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('next_csrf='))?.slice(10);
  const response = await fetch(new URL(route, `${session.baseUrl}/`), {
    method, redirect: 'error', headers: {
      Accept: 'application/json', 'User-Agent': USER_AGENT,
      Origin: session.baseUrl, Referer: `${session.baseUrl}/dashboard`,
      'X-Requested-With': 'next-portal',
      ...(session.cookie ? { Cookie: session.cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(getTimeoutMs())
  });
  const cookies = buildCookieHeaderFromSetCookie(response.headers);
  if (cookies) session.cookie = mergeCookieHeaders(session.cookie, cookies);
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`网站返回非 JSON 响应（HTTP ${response.status}）`); }
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error?.message || `网站请求失败（HTTP ${response.status}）`);
  }
  if (!payload.data || typeof payload.data !== 'object') throw new Error('网站返回的数据不完整');
  return payload.data;
}
async function login(account) {
  if (!account.username || !account.password) throw new Error('缺少网站用户名或密码');
  const session = { baseUrl: normalizeBaseUrl(account.baseUrl, DEFAULT_BASE_URL), cookie: '' };
  const auth = await request(session, '/api/v1/auth/login', 'POST', {
    account_name: account.username, password: account.password,
    device_id: `glados-checkin-${crypto.createHash('sha256').update(String(account.id || account.username)).digest('hex').slice(0, 24)}`
  });
  if (auth.authenticated !== true || !session.cookie.includes('next_session=')) throw new Error('网站登录未获得有效会话');
  return session;
}
function summarizeStatus(data) {
  if (!data.wallet || !Array.isArray(data.ledger?.items)) throw new Error('网站返回的钱包状态不完整');
  const entries = data.ledger.items.filter(e => e.reference_type === 'finance.checkin' && e.direction === 'credit');
  const latest = entries.map(e => e.reference_id).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) || '';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { ok: true, state: 'active', message: latest === today ? '今日已签到' : '可签到',
    todaySigned: latest === today, points: minorAmount(data.wallet.balance_minor),
    currency: currencyLabel(data.wallet.currency), lastSignInDate: latest, plan: '练习生的日常' };
}
function summarizeCheckin(data) {
  if (typeof data.idempotent !== 'boolean' || !data.checkin?.checkin_date || !data.wallet) throw new Error('网站签到结果不明确');
  return { ok: true, already: data.idempotent, message: data.idempotent ? '今日已签到' : '签到成功',
    points: data.idempotent ? 0 : minorAmount(data.checkin.reward_minor),
    balance: minorAmount(data.wallet.balance_minor), currency: currencyLabel(data.wallet.currency),
    todaySigned: true, lastSignInDate: data.checkin.checkin_date };
}
const failure = error => ({ ok: false, state: 'error', message: error.message, currency: '只因' });
async function refreshAccountStatus(account) {
  const next = { ...account };
  try { next.lastStatus = summarizeStatus(await request(await login(account), '/api/v1/finance/wallet/me?limit=35')); }
  catch (error) { next.lastStatus = failure(error); }
  next.lastStatusAt = next.updatedAt = formatDateTime();
  return { account: next, summary: { id: next.id, name: next.name, status: next.lastStatus } };
}
async function runAccountCheckin(account) {
  const next = { ...account };
  try {
    const session = await login(account);
    // The server deduplicates by business date; use its result instead of skipping by local time.
    const data = await request(session, '/api/v1/finance/checkins', 'POST', {});
    next.lastCheckin = summarizeCheckin(data);
    next.lastStatus = { ok: true, state: 'active', message: '今日已签到', todaySigned: true,
      points: next.lastCheckin.balance, currency: next.lastCheckin.currency,
      lastSignInDate: next.lastCheckin.lastSignInDate, plan: '练习生的日常' };
  } catch (error) {
    next.lastCheckin = { ...failure(error), already: false, points: 0 };
    next.lastStatus = failure(error);
  }
  next.lastCheckinAt = next.lastStatusAt = next.updatedAt = formatDateTime();
  return { account: next, summary: { id: next.id, name: next.name, checkin: next.lastCheckin, status: next.lastStatus } };
}
module.exports = { DEFAULT_BASE_URL, minorAmount, summarizeStatus, summarizeCheckin, refreshAccountStatus, runAccountCheckin };
