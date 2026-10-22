const { normalizeBaseUrl, formatDateTime, getTimeoutMs, USER_AGENT, mergeCookieHeaders } = require('../common');
const DEFAULT_BASE_URL = 'https://user.090911.xyz';
async function request(account, route, method = 'GET') {
  if (!account.cookie) throw new Error('缺少这只猫登录 Cookie，请通过 Telegram 登录网站后更新 qp_session');
  const base = normalizeBaseUrl(account.baseUrl, DEFAULT_BASE_URL);
  const response = await fetch(new URL(route, `${base}/`), {
    method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Cookie: account.cookie,
      Origin: base, Referer: `${base}/`, 'User-Agent': USER_AGENT },
    ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(getTimeoutMs())
  });
  for (const cookie of response.headers?.getSetCookie?.() || []) {
    if (/^qp_session=/.test(cookie)) account.cookie = mergeCookieHeaders(account.cookie, cookie.split(';')[0]);
  }
  if (response.status === 401 || response.status === 403) {
    const error = new Error('这只猫登录会话已失效或无权限，请通过 Telegram 重新登录并更新 qp_session');
    error.unauthorized = true; throw error;
  }
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`这只猫返回非 JSON 响应（HTTP ${response.status}）`); }
  if (!response.ok || payload.ok !== true) throw new Error(payload.message || `这只猫请求失败（HTTP ${response.status}）`);
  return payload;
}
async function readStatus(account) {
  const payload = await request(account, '/api/miniapp/bootstrap/core');
  const profile = payload.data?.profile;
  if (!payload.data?.sessionUser || !profile || typeof profile.checkedInToday !== 'boolean') throw new Error('这只猫返回的用户或签到状态不完整');
  return { ok: true, state: 'active', message: profile.checkedInToday ? '今日已签到' : '可签到',
    todaySigned: profile.checkedInToday, points: profile.score ?? null, currency: '猫币', plan: profile.userLevelLabel || profile.userLevel || '',
    // Keep only display fields; bootstrap also contains private billing and account data.
    accountName: profile.name || '' };
}
function failureStatus(error) { return { ok: false, state: error.unauthorized ? 'unauthorized' : 'error', message: error.message, currency: '猫币' }; }
async function refreshAccountStatus(account) {
  const next = { ...account };
  try { next.lastStatus = await readStatus(next); } catch (error) { next.lastStatus = failureStatus(error); }
  next.lastStatusAt = next.updatedAt = formatDateTime();
  return { account: next, summary: { id: next.id, name: next.name, status: next.lastStatus } };
}
async function runAccountCheckin(account) {
  const next = { ...account }; let checkin;
  try {
    const before = await readStatus(next); next.lastStatus = before;
    if (before.todaySigned) {
      checkin = { ok: true, already: true, message: '今日已签到', points: 0, balance: before.points, currency: '猫币', todaySigned: true };
    } else {
      let payload;
      try { payload = await request(next, '/api/user/checkin', 'POST'); }
      catch (error) {
        // Confirm a timeout or concurrent check-in using the site's current status.
        const after = await readStatus(next); next.lastStatus = after;
        if (!after.todaySigned) throw error;
        checkin = { ok: true, already: true, message: '状态确认今日已签到', points: 0, balance: after.points, currency: '猫币', todaySigned: true };
      }
      if (payload) {
        const data = payload.data || {};
        if (typeof data.awardedNow !== 'boolean') throw new Error('这只猫签到结果不明确，未标记为成功');
        checkin = { ok: true, already: !data.awardedNow, message: payload.message || (data.awardedNow ? '签到成功' : '今日已签到'),
          points: data.awardedNow ? data.reward ?? null : 0, balance: data.newScore ?? null, currency: '猫币', todaySigned: true,
          checkinDate: data.businessDay || '', lastSignInDate: data.businessDay || '' };
        next.lastStatus = { ...before, todaySigned: true, message: '今日已签到', points: data.newScore ?? before.points,
          lastSignInDate: data.businessDay || '' };
      }
    }
  } catch (error) {
    checkin = { ok: false, already: false, message: error.message, points: 0, currency: '猫币' };
    next.lastStatus = failureStatus(error);
  }
  next.lastCheckin = checkin; next.lastCheckinAt = next.lastStatusAt = next.updatedAt = formatDateTime();
  return { account: next, summary: { id: next.id, name: next.name, checkin, status: next.lastStatus } };
}
module.exports = { DEFAULT_BASE_URL, refreshAccountStatus, runAccountCheckin };
