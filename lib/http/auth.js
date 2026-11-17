const crypto = require("crypto");
const { parseCookies } = require("../common");
const { sendJson } = require("./respond");
const { AppError } = require("./errors");
const SESSION_SECONDS = 30 * 24 * 60 * 60;
function isHttpsRequest(req) {
  return Boolean(req.socket.encrypted) || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}
function safeEqualString(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
function createAuth(config, { now = Date.now } = {}) {
  const attempts = new Map(); const windowMs = 10 * 60 * 1000;
  const ipOf = req => req.socket.remoteAddress || "unknown";
  function signSession(user) {
    const issuedAt = Math.floor(now() / 1000), exp = issuedAt + SESSION_SECONDS;
    const payload = Buffer.from(JSON.stringify({ user, issuedAt, exp })).toString("base64url");
    return payload + "." + crypto.createHmac("sha256", config.SESSION_SECRET).update(payload).digest("base64url");
  }
  function isAuthenticated(req) {
    try {
      const cookies = parseCookies(req.headers.cookie || "");
      const [payload, sig, extra] = String(cookies.glados_token || "").split(".");
      if (!payload || !sig || extra) return false;
      const expected = crypto.createHmac("sha256", config.SESSION_SECRET).update(payload).digest("base64url");
      if (!safeEqualString(expected, sig)) return false;
      const token = JSON.parse(Buffer.from(payload, "base64url").toString());
      const time = Math.floor(now() / 1000);
      return cookies.glados_user === config.ADMIN_USER && token.user === config.ADMIN_USER &&
        Number.isSafeInteger(token.issuedAt) && Number.isSafeInteger(token.exp) &&
        token.issuedAt <= time && token.exp > time && token.exp - token.issuedAt === SESSION_SECONDS;
    } catch { return false; }
  }
  function cookieParts(req, maxAge) {
    const secure = req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
    return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }
  function setAuthCookies(req, res) {
    const parts = cookieParts(req, SESSION_SECONDS);
    res.setHeader("Set-Cookie", [`glados_user=${encodeURIComponent(config.ADMIN_USER)}; ${parts}`, `glados_token=${signSession(config.ADMIN_USER)}; ${parts}`]);
  }
  function clearAuthCookies(req, res) {
    const parts = cookieParts(req, 0);
    res.setHeader("Set-Cookie", [`glados_user=; ${parts}`, `glados_token=; ${parts}`]);
  }
  function isAppTokenAuthorized(req) {
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || "").trim());
    const token = bearer ? bearer[1] : String(req.headers["x-api-key"] || "").trim();
    return [config.APP_API_TOKEN, config.APP_API_TOKEN_SECONDARY].some(value => value && safeEqualString(token, value));
  }
  function requireAuth(req, res) {
    if (isAuthenticated(req)) return true;
    sendJson(res, 401, { error: "Unauthorized" }); return false;
  }
  function requireAppOrSessionAuth(req, res) {
    if (isAuthenticated(req) || isAppTokenAuthorized(req)) return true;
    sendJson(res, 401, { error: "Unauthorized" }); return false;
  }
  function checkLogin(req, username, password) {
    const time = now(), ip = ipOf(req);
    for (const [key, entry] of attempts) if (entry.until <= time) attempts.delete(key);
    const entry = attempts.get(ip) || { count: 0, until: time + windowMs };
    if (entry.count >= 5) throw new AppError(429, "LOGIN_RATE_LIMIT", "登录失败次数过多，请稍后重试");
    if (!safeEqualString(username, config.ADMIN_USER) || !safeEqualString(password, config.ADMIN_PASS)) {
      entry.count++; attempts.set(ip, entry); return false;
    }
    return true;
  }
  return { signSession, isAuthenticated, setAuthCookies, clearAuthCookies, isAppTokenAuthorized, requireAuth, requireAppOrSessionAuth, checkLogin };
}
module.exports = { createAuth, safeEqualString, isHttpsRequest };
