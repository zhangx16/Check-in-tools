const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR } = require('./common');
const { readProviderAccounts, writeProviderAccounts } = require('./accounts');
const { normalizeSession } = require('./providers/workbuddy');
const ENDPOINT = 'https://copilot.tencent.com/v2/plugin/auth/token/refresh';
const error = (authCode, safeMessage) => Object.assign(new Error(safeMessage), { authCode, safeMessage });
function expiry(auth, refresh = false) {
  const token = refresh ? auth.refreshToken : auth.accessToken;
  try {
    const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).exp;
    if (Number.isFinite(exp)) return exp * 1000;
  } catch {}
  const v = auth[refresh ? 'refreshExpiresAt' : 'expiresAt'];
  return typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : typeof v === 'string' ? Date.parse(v) : NaN;
}
async function refresh(session) {
  if (!session.auth.refreshToken) throw error('AUTH_ERROR', '登录已到期且缺少 refreshToken，请重新登录并导入完整凭据');
  if (expiry(session.auth, true) <= Date.now()) throw error('AUTH_ERROR', '刷新令牌已过期，请重新登录并导入完整凭据');
  let response, body;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
        'Authorization': 'Bearer ' + session.auth.accessToken,
        'X-Refresh-Token': session.auth.refreshToken, 'X-Auth-Refresh-Source': 'plugin',
        'X-User-Id': session.account.uid, 'X-Domain': session.auth.domain || 'www.codebuddy.cn',
        'X-Product': 'SaaS', 'X-Requested-With': 'XMLHttpRequest',
        'X-Request-ID': crypto.randomUUID().replaceAll('-', ''), 'User-Agent': 'WorkBuddy' }, body: '{}' });
    body = await response.json();
  } catch { throw error('AUTH_ERROR', '令牌刷新请求失败或结果未知，请核对登录状态后重新导入凭据'); }
  if (!response.ok || body.code !== 0) throw error('AUTH_ERROR', `令牌刷新被拒绝（HTTP ${response.status}），请重新登录并导入完整凭据`);
  const data = body.data;
  if (!data || typeof data.accessToken !== 'string' || typeof data.refreshToken !== 'string' || !data.refreshToken) throw error('AUTH_ERROR', '刷新响应缺少完整令牌对，请重新登录');
  const next = normalizeSession({ ...session, auth: { ...session.auth, accessToken: data.accessToken, refreshToken: data.refreshToken } });
  if (Number.isFinite(data.expiresIn) && data.expiresIn > 0) next.auth.expiresAt = Date.now() + data.expiresIn * 1000;
  if (Number.isFinite(data.refreshExpiresIn) && data.refreshExpiresIn > 0) next.auth.refreshExpiresAt = Date.now() + data.refreshExpiresIn * 1000;
  if (expiry(next.auth) <= Date.now()) throw error('AUTH_ERROR', '刷新后令牌仍已过期，请重新登录');
  return next;
}
function lock(uid) {
  const dir = path.join(DATA_DIR, 'workbuddy-refresh-locks', crypto.createHash('sha256').update(uid).digest('hex'));
  fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  try { fs.mkdirSync(dir, { mode: 0o700 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try {
      const pid = Number(fs.readFileSync(path.join(dir, 'owner'), 'utf8'));
      process.kill(pid, 0);
    } catch (ownerError) {
      if (ownerError.code === 'ESRCH' || (ownerError.code === 'ENOENT' && Date.now() - fs.statSync(dir).mtimeMs > 60000)) {
        fs.rmSync(dir, { recursive: true });
        return lock(uid);
      }
    }
    throw error('BUSY', '该账号正在刷新登录态，请稍后重试');
  }
  fs.writeFileSync(path.join(dir, 'owner'), String(process.pid), { mode: 0o600 });
  return () => fs.rmSync(dir, { recursive: true, force: true });
}
async function prepare(account, force = false) {
  let session = normalizeSession(account.workbuddySession);
  // The scheduled job runs once a day: rotate before the next run can miss expiry.
  const window = Date.now() + 24 * 60 * 60000 + 5 * 60000;
  const refreshExpiry = expiry(session.auth, true);
  const due = expiry(session.auth) <= window || (refreshExpiry > Date.now() && refreshExpiry <= window);
  if (!force && !due) return session;
  if (!session.auth.refreshToken) {
    if (expiry(session.auth) <= Date.now()) throw error('AUTH_ERROR', '登录令牌已过期且缺少 refreshToken，请重新登录并导入完整凭据');
    return session;
  }
  const release = lock(session.account.uid);
  try {
    const before = JSON.stringify(account.workbuddySession);
    const current = readProviderAccounts('workbuddy').find(a => a.id === account.id);
    if (!current || JSON.stringify(current.workbuddySession) !== before) throw error('AUTH_ERROR', '账号或登录凭据已变更，请重新执行');
    session = await refresh(session);
    const latest = readProviderAccounts('workbuddy');
    const saved = latest.find(a => a.id === account.id);
    if (!saved || JSON.stringify(saved.workbuddySession) !== before) throw error('AUTH_ERROR', '刷新期间登录凭据被修改，未覆盖新凭据，请重新执行');
    writeProviderAccounts('workbuddy', latest.map(a => a.id === account.id ? { ...a, workbuddySession: session } : a));
    // Callers compare this same execution snapshot before merging results.
    // Updating it here distinguishes our persisted rotation from manual edits.
    account.workbuddySession = session;
    return session;
  } finally { release(); }
}
module.exports = { prepare, refresh, expiry };
