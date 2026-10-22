const {
  normalizeBaseUrl,
  cloneData,
  formatDateTime,
  isAlreadyCheckedInMessage,
  USER_AGENT,
  buildCookieHeaderFromSetCookie,
  calculateDaysUntil,
  withInsecureTls,
  getTimeoutMs
} = require("../common");

function getDefaultBaseUrl() {
  return process.env.DEFAULT_EMBYPULSE_BASE_URL || "https://embypulse.example.com";
}

async function embypulseLogin(account) {
  return withInsecureTls(account?.insecureTls, async () => {
    const baseUrl = normalizeBaseUrl(account.baseUrl, getDefaultBaseUrl());
    const loginUrl = new URL("/api/requests/auth", `${baseUrl}/`);
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({
        username: account.username,
        password: account.password
      }),
      signal: AbortSignal.timeout(getTimeoutMs())
    });

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { status: "error", message: raw.slice(0, 180) };
    }

    if (!response.ok || data?.status !== "success") {
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

async function embypulseApiRequest(session, method, routePath, payload) {
  return withInsecureTls(session?.insecureTls, async () => {
    const url = new URL(routePath.replace(/^\//, ""), `${session.baseUrl}/`);
    const headers = {
      Accept: "application/json",
      Cookie: session.cookie,
      Origin: session.baseUrl,
      Referer: `${session.baseUrl}/`,
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
      data = { status: "error", message: raw.slice(0, 180) };
    }

    if (!response.ok) {
      throw new Error(data?.message || `HTTP ${response.status}`);
    }

    return data;
  });
}

async function embypulseCheckSession(session) {
  return embypulseApiRequest(session, "GET", "/api/requests/check");
}

function summarizeEmbypulseStatusPayload(payload, sessionPayload) {
  if (payload?.status === "success") {
    return {
      ok: true,
      code: 0,
      state: "active",
      message: payload?.data?.has_checked_in ? "今日已签到" : "可签到",
      leftDays: calculateDaysUntil(sessionPayload?.user?.expire_date),
      vip: null,
      level: null,
      plan: "EmbyPulse",
      points: Number(payload?.data?.points ?? 0),
      expireDate: sessionPayload?.user?.expire_date || "",
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    code: null,
    state: "error",
    message: payload?.message || "积分状态获取失败",
    leftDays: calculateDaysUntil(sessionPayload?.user?.expire_date),
    vip: null,
    level: null,
    plan: "EmbyPulse",
    points: null,
    expireDate: sessionPayload?.user?.expire_date || "",
    raw: cloneData(payload)
  };
}

function summarizeEmbypulseCheckinPayload(payload, infoPayload) {
  const message = String(payload?.message || "");

  if (payload?.status === "success") {
    return {
      ok: true,
      already: false,
      code: 0,
      message: message || "签到成功",
      points: Number(payload?.reward ?? 0),
      reward: Number(payload?.reward ?? 0),
      balance: Number(payload?.balance ?? infoPayload?.data?.points ?? 0),
      raw: cloneData(payload)
    };
  }

  if (isAlreadyCheckedInMessage(message)) {
    return {
      ok: true,
      already: true,
      code: 0,
      message: message || "今天已经签到过了",
      points: 0,
      reward: 0,
      balance: Number(infoPayload?.data?.points ?? 0),
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    already: false,
    code: null,
    message: message || "签到失败",
    points: 0,
    reward: 0,
    balance: Number(infoPayload?.data?.points ?? 0),
    raw: cloneData(payload)
  };
}

async function refreshAccountStatus(account) {
  const now = formatDateTime();
  let status;

  try {
    const session = await embypulseLogin(account);
    const sessionPayload = await embypulseCheckSession(session);
    const payload = await embypulseApiRequest(session, "GET", "/api/user/points/info");
    status = summarizeEmbypulseStatusPayload(payload, sessionPayload);
  } catch (error) {
    status = {
      ok: false,
      code: null,
      state: "error",
      message: error.message,
      points: null,
      expireDate: "",
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
    const session = await embypulseLogin(account);
    const infoPayload = await embypulseApiRequest(session, "GET", "/api/user/points/info");

    if (Boolean(infoPayload?.data?.has_checked_in)) {
      checkin = summarizeEmbypulseCheckinPayload({
        status: "error",
        message: "今天已经签到过了，明天再来吧！"
      }, infoPayload);
    } else {
      const payload = await embypulseApiRequest(session, "POST", "/api/user/points/checkin");
      checkin = summarizeEmbypulseCheckinPayload(payload, infoPayload);
    }
  } catch (error) {
    checkin = {
      ok: false,
      already: false,
      code: null,
      message: error.message,
      points: 0,
      reward: 0,
      balance: null,
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
  embypulseLogin,
  embypulseApiRequest,
  embypulseCheckSession,
  summarizeEmbypulseStatusPayload,
  summarizeEmbypulseCheckinPayload,
  refreshAccountStatus,
  runAccountCheckin
};
