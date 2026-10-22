const { normalizeBaseUrl, formatDateTime, USER_AGENT, getTimeoutMs } = require("../common");

const getDefaultBaseUrl = () => process.env.DEFAULT_VPSNAT_BASE_URL || "https://www.vpsnat.com";

async function request(account, route, payload, authenticated = true) {
  const base = normalizeBaseUrl(account.baseUrl, getDefaultBaseUrl());
  const response = await fetch(`${base}/api${route}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json", "Content-Type": "application/json",
      "User-Agent": USER_AGENT, Origin: base, Referer: `${base}/entertainment?tab=checkin`,
      ...(authenticated ? { Authorization: `Bearer ${account.token || ""}` } : {})
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(getTimeoutMs())
  });
  let data;
  try { data = await response.json(); } catch { throw new Error(`VPSNAT 返回非 JSON 响应 HTTP ${response.status}`); }
  if (!response.ok || data.error) {
    const error = new Error(data.code === "TURNSTILE_TOKEN_MISSING"
      ? "VPSNAT 登录需要人机验证，请导入浏览器 token 和 refreshToken"
      : data.error || data.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

async function login(account) {
  if (account.token) {
    try { await request(account, "/auth/me"); return; }
    catch (error) { if (error.status !== 401) throw error; }
  }
  let data;
  if (account.refreshToken) {
    // Keep refresh failures visible; a transient failure must not discard the session.
    data = await request(account, "/auth/refresh", { refreshToken: account.refreshToken }, false);
  } else {
    data = await request(account, "/auth/login", { username: account.username, password: account.password }, false);
  }
  if (!data.token) throw new Error("VPSNAT 登录未返回 token");
  account.token = data.token;
  if (data.refreshToken) account.refreshToken = data.refreshToken;
}

async function readStatus(account) {
  const info = await request(account, "/checkin/status");
  const balance = await request(account, "/entertainment/points");
  return {
    ok: true, state: "active", message: info.hasCheckedIn ? "今日已签到" : info.enabled === false ? "签到未开放" : "可签到",
    todaySigned: Boolean(info.hasCheckedIn), points: balance.points ?? null, currency: "积分", plan: "积分",
    raw: { info, balance }
  };
}

async function refreshAccountStatus(account) {
  const next = { ...account };
  let status;
  try { await login(next); status = await readStatus(next); }
  catch (error) { status = { ok: false, state: "error", message: error.message, points: null, currency: "积分" }; }
  const now = formatDateTime();
  Object.assign(next, { lastStatus: status, lastStatusAt: now, updatedAt: now });
  return { account: next, summary: { id: next.id, name: next.name, status } };
}

async function runAccountCheckin(account) {
  const next = { ...account };
  let checkin;
  try {
    await login(next);
    const before = await readStatus(next);
    if (before.todaySigned) {
      checkin = { ok: true, already: true, message: "今日已签到", points: 0, balance: before.points, currency: "积分", todaySigned: true };
      next.lastStatus = before;
    } else {
      if (before.raw.info.enabled === false) throw new Error("VPSNAT 签到未开放");
      if (before.raw.info.requireInstance !== false && !before.raw.info.hasInstances) throw new Error("VPSNAT 签到需要有效实例");
      let payload;
      try { payload = await request(next, "/checkin/checkin", {}); }
      catch (error) {
        // A concurrent check-in or response timeout can still have completed the check-in.
        const status = await readStatus(next);
        if (!status.todaySigned) throw error;
        next.lastStatus = status;
        checkin = { ok: true, already: true, message: "状态确认今日已签到", points: 0, balance: status.points, currency: "积分", todaySigned: true };
      }
      if (payload) {
        const resource = { c: ["CPU", "%"], r: ["内存", "MB"], d: ["磁盘", "MB"], t: ["流量", "GB"] }[payload.codeType];
        checkin = {
          ok: true, already: false, message: `签到成功${resource ? `，${resource[0]} +${payload.codeValue}${resource[1]}` : ""}`,
          points: payload.bonusPoints ?? 0, currency: "积分", todaySigned: true, raw: payload
        };
        // Preserve the successful check-in even if the subsequent status request fails.
        try { next.lastStatus = await readStatus(next); checkin.balance = next.lastStatus.points; }
        catch (error) { next.lastStatus = { ok: false, state: "error", message: error.message, currency: "积分" }; }
      }
    }
  } catch (error) {
    checkin = { ok: false, already: false, message: error.message, code: error.code || null, points: 0, balance: null, currency: "积分" };
    next.lastStatus = { ok: false, state: "error", message: error.message, currency: "积分" };
  }
  const now = formatDateTime();
  Object.assign(next, { lastCheckin: checkin, lastCheckinAt: now, lastStatusAt: now, updatedAt: now });
  return { account: next, summary: { id: next.id, name: next.name, checkin, status: next.lastStatus } };
}

module.exports = { getDefaultBaseUrl, refreshAccountStatus, runAccountCheckin };
