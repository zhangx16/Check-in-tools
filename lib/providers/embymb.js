const {
  normalizeBaseUrl,
  cloneData,
  formatDateTime,
  USER_AGENT,
  buildCookieHeaderFromSetCookie,
  withInsecureTls,
  getTimeoutMs
} = require("../common");

function getDefaultBaseUrl() {
  return process.env.DEFAULT_EMBYMB_BASE_URL || "https://embymb.ichinosekotomi.com";
}

async function embymbLogin(account) {
  return withInsecureTls(account?.insecureTls, async () => {
    const baseUrl = normalizeBaseUrl(account.baseUrl, getDefaultBaseUrl());
    const loginUrl = new URL("/api/v1/auth/login", `${baseUrl}/`);
    const useEmail = String(account.username || "").includes("@");
    const credentials = useEmail
      ? { email: account.username, username: "", password: account.password }
      : { username: account.username, password: account.password };
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        Origin: baseUrl,
        Referer: `${baseUrl}/login`
      },
      body: JSON.stringify(credentials),
      signal: AbortSignal.timeout(getTimeoutMs())
    });

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { success: false, message: raw.slice(0, 180) };
    }

    if (!response.ok || data?.success !== true) {
      throw new Error(data?.message || `登录失败 HTTP ${response.status}`);
    }

    const cookie = buildCookieHeaderFromSetCookie(response.headers);
    if (!cookie) {
      throw new Error("登录成功但未获得会话 Cookie");
    }

    return {
      baseUrl,
      cookie,
      insecureTls: Boolean(account?.insecureTls)
    };
  });
}

async function embymbApiRequest(session, method, routePath, payload) {
  return withInsecureTls(session?.insecureTls, async () => {
    const url = new URL(routePath.replace(/^\//, ""), `${session.baseUrl}/`);
    const headers = {
      Accept: "application/json, text/plain, */*",
      Cookie: session.cookie,
      Origin: session.baseUrl,
      Referer: `${session.baseUrl}/dashboard`,
      "User-Agent": USER_AGENT
    };

    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(getTimeoutMs())
    });

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { success: false, message: raw.slice(0, 180) };
    }

    if (!response.ok) {
      throw new Error(data?.message || `HTTP ${response.status}`);
    }

    return data;
  });
}

async function embymbSigninMe(session) {
  return embymbApiRequest(session, "GET", "/api/v1/signin/me");
}

async function embymbSigninConfig(session) {
  return embymbApiRequest(session, "GET", "/api/v1/signin/config");
}

function isEmbymbAlreadySigned(payload, infoPayload) {
  const message = String(payload?.message || "");
  return Boolean(infoPayload?.data?.today_signed) || payload?.success === true && (
    message.includes("已签到") ||
    message.includes("已经签到") ||
    message.includes("今日已签到") ||
    message.toLowerCase().includes("already")
  );
}

function summarizeEmbymbStatusPayload(infoPayload, configPayload) {
  if (infoPayload?.success === true) {
    const data = infoPayload?.data || {};
    const config = configPayload?.data || {};
    const todaySigned = Boolean(data.today_signed);
    const currentPoints = Number(data.current_points ?? 0);
    const currentStreak = Number(data.current_streak ?? 0);
    const longestStreak = Number(data.longest_streak ?? 0);
    const dailyMin = Number(config.daily_min ?? data.daily_min ?? 0);
    const dailyMax = Number(config.daily_max ?? data.daily_max ?? 0);
    const currency = data.currency_name || config.currency_name || "积分";

    return {
      ok: true,
      code: 0,
      state: "active",
      message: todaySigned ? "今日已签到" : "可签到",
      leftDays: null,
      vip: null,
      level: null,
      plan: currency,
      currency,
      points: currentPoints,
      currentStreak,
      longestStreak,
      todaySigned,
      lastSignInDate: data.last_signin_date || "",
      totalPoints: Number(data.total_points ?? 0),
      dailyMin,
      dailyMax,
      bonusTable: Array.isArray(config.bonus_table) ? config.bonus_table : [],
      raw: cloneData({ infoPayload, configPayload })
    };
  }

  return {
    ok: false,
    code: null,
    state: "error",
    message: infoPayload?.message || "签到状态获取失败",
    leftDays: null,
    vip: null,
    level: null,
    plan: "EmbyMB",
    currency: infoPayload?.data?.currency_name || configPayload?.data?.currency_name || "积分",
    points: null,
    currentStreak: null,
    longestStreak: null,
    todaySigned: false,
    lastSignInDate: "",
    totalPoints: null,
    dailyMin: Number(configPayload?.data?.daily_min ?? 0),
    dailyMax: Number(configPayload?.data?.daily_max ?? 0),
    bonusTable: Array.isArray(configPayload?.data?.bonus_table) ? configPayload.data.bonus_table : [],
    raw: cloneData({ infoPayload, configPayload })
  };
}

function summarizeEmbymbCheckinPayload(payload, infoPayload) {
  const data = payload?.data || {};
  const message = String(payload?.message || "");
  const currentPoints = Number(data.current_points ?? infoPayload?.data?.current_points ?? 0);
  const dailyPoints = Number(data.daily_points ?? data.bonus_points ?? 0);
  const currency = data.currency_name || infoPayload?.data?.currency_name || "积分";
  const lastSignInDate = data.last_signin_date || infoPayload?.data?.last_signin_date || "";
  const already = Boolean(data.created === false) || isEmbymbAlreadySigned(payload, infoPayload);

  if (payload?.success === true) {
    return {
      ok: true,
      already,
      code: 0,
      message: message || (already ? "今天已经签到过了" : "签到成功"),
      points: dailyPoints,
      balance: currentPoints,
      currency,
      currentPoints,
      lastSignInDate,
      todaySigned: true,
      raw: cloneData(payload)
    };
  }

  if (already) {
    return {
      ok: true,
      already: true,
      code: 0,
      message: message || "今天已经签到过了",
      points: 0,
      balance: currentPoints,
      currency,
      currentPoints,
      lastSignInDate,
      todaySigned: true,
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    already: false,
    code: payload?.code ?? null,
    message: message || "签到失败",
    points: 0,
    balance: currentPoints,
    currency,
    currentPoints,
    lastSignInDate,
    todaySigned: Boolean(infoPayload?.data?.today_signed),
    raw: cloneData(payload)
  };
}

function reconcileEmbymbCheckinWithStatus(checkin, status) {
  if (checkin?.ok || !status?.todaySigned) {
    return checkin;
  }

  const balance = status.points != null
    ? Number(status.points)
    : checkin?.balance ?? checkin?.currentPoints ?? null;

  return {
    ...checkin,
    ok: true,
    already: true,
    code: checkin?.code ?? 0,
    message: status.message || "状态刷新确认今日已签到",
    points: 0,
    balance,
    currentPoints: balance,
    currency: status.currency || checkin?.currency || "积分",
    lastSignInDate: status.lastSignInDate || checkin?.lastSignInDate || "",
    todaySigned: true,
    reconciledAfterStatusRefresh: true
  };
}

async function refreshAccountStatus(account) {
  const now = formatDateTime();
  let status;

  try {
    const session = await embymbLogin(account);
    const infoPayload = await embymbSigninMe(session);
    const configPayload = await embymbSigninConfig(session);
    status = summarizeEmbymbStatusPayload(infoPayload, configPayload);
  } catch (error) {
    status = {
      ok: false,
      code: null,
      state: "error",
      message: error.message,
      leftDays: null,
      vip: null,
      level: null,
      plan: "EmbyMB",
      currency: "积分",
      points: null,
      currentStreak: null,
      longestStreak: null,
      todaySigned: false,
      lastSignInDate: "",
      totalPoints: null,
      dailyMin: null,
      dailyMax: null,
      bonusTable: [],
      raw: null
    };
  }

  const nextAccount = {
    ...account,
    lastStatusAt: now,
    lastStatus: status,
    updatedAt: now
  };

  return {
    account: nextAccount,
    summary: {
      id: nextAccount.id,
      name: nextAccount.name,
      status
    }
  };
}

async function runAccountCheckin(account) {
  const now = formatDateTime();
  let nextAccount = { ...account };
  let checkin;

  try {
    const session = await embymbLogin(account);
    const infoPayload = await embymbSigninMe(session);

    if (Boolean(infoPayload?.data?.today_signed)) {
      checkin = summarizeEmbymbCheckinPayload({
        success: true,
        message: "今日已签到",
        data: {
          created: false,
          current_points: infoPayload?.data?.current_points,
          daily_points: 0,
          currency_name: infoPayload?.data?.currency_name,
          last_signin_date: infoPayload?.data?.last_signin_date,
          total_points: infoPayload?.data?.total_points
        }
      }, infoPayload);
    } else {
      const payload = await embymbApiRequest(session, "POST", "/api/v1/signin");
      checkin = summarizeEmbymbCheckinPayload(payload, infoPayload);
    }
  } catch (error) {
    checkin = {
      ok: false,
      already: false,
      code: null,
      message: error.message,
      points: 0,
      balance: null,
      currency: "积分",
      currentPoints: null,
      lastSignInDate: "",
      todaySigned: false,
      raw: null
    };
  }

  nextAccount = {
    ...nextAccount,
    lastCheckinAt: now,
    lastCheckin: checkin,
    updatedAt: now
  };

  nextAccount = (await refreshAccountStatus(nextAccount)).account;
  checkin = reconcileEmbymbCheckinWithStatus(nextAccount.lastCheckin, nextAccount.lastStatus);
  nextAccount.lastCheckin = checkin;

  return {
    account: nextAccount,
    summary: {
      id: nextAccount.id,
      name: nextAccount.name,
      checkin,
      status: nextAccount.lastStatus || null
    }
  };
}

module.exports = {
  getDefaultBaseUrl,
  embymbLogin,
  embymbApiRequest,
  embymbSigninMe,
  embymbSigninConfig,
  isEmbymbAlreadySigned,
  summarizeEmbymbStatusPayload,
  summarizeEmbymbCheckinPayload,
  reconcileEmbymbCheckinWithStatus,
  refreshAccountStatus,
  runAccountCheckin
};
