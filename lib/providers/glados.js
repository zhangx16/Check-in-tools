const {
  normalizeBaseUrl,
  gladosUserAgent,
  cloneData,
  formatDateTime,
  isAlreadyCheckedInMessage
} = require("../common");

const DEFAULT_GLADOS_BASE_URL = "https://glados.network";

function getTimeoutMs() {
  return Number(process.env.REQUEST_TIMEOUT_MS || 20000);
}

function shouldRetryCheckin(checkin, attemptNumber, maxAttempts) {
  if (attemptNumber >= maxAttempts || checkin?.ok) return false;
  // An authorization rejection can be transient even when status also rejects
  // the session. Let the bounded daily retry policy confirm it before giving up.
  return checkin?.code !== 4;
}

async function gladosApiRequest(account, method, routePath, payload, userAgent) {
  const baseUrl = normalizeBaseUrl(account.baseUrl, DEFAULT_GLADOS_BASE_URL);
  const host = new URL(baseUrl).hostname;
  const url = new URL(`/api/${routePath.replace(/^\/+/, "")}`, `${baseUrl}/`);
  const headers = {
    Accept: "application/json, text/plain, */*",
    Cookie: account.cookie,
    Origin: baseUrl,
    Referer: `${baseUrl}/console/checkin`,
    "User-Agent": userAgent || account.userAgent || gladosUserAgent(account.loginDevice)
  };

  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(getTimeoutMs())
  };

  if (payload !== undefined) {
    headers["Content-Type"] = "application/json;charset=UTF-8";
    options.body = JSON.stringify(payload ?? { token: host });
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`请求失败: ${error.message}`);
  }

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error(`接口返回不是 JSON: ${raw.slice(0, 180)}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${data.message || raw.slice(0, 180)}`);
  }

  return data;
}

function summarizeStatusPayload(payload) {
  const code = Number(payload?.code ?? -999);

  if (code === 0) {
    const data = payload?.data || {};
    return {
      ok: true,
      code,
      state: "active",
      message: payload?.message || "状态正常",
      leftDays: data.leftDays ?? null,
      vip: data.vip ?? null,
      level: data.level ?? null,
      plan: data.plan ?? null,
      raw: cloneData(payload)
    };
  }

  if (code === -100) {
    return {
      ok: false,
      code,
      state: "unpaid",
      message: payload?.message || "待激活或未付费",
      gift: payload?.from || "",
      boarding: payload?.boarding || "",
      raw: cloneData(payload)
    };
  }

  if (code === -101) {
    return {
      ok: false,
      code,
      state: "expired",
      message: payload?.message || "套餐已过期",
      raw: cloneData(payload)
    };
  }

  if (code === -2) {
    return {
      ok: false,
      code,
      state: "unauthorized",
      message: payload?.message || "Cookie 失效或无权限",
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    code,
    state: "error",
    message: payload?.message || "状态获取失败",
    raw: cloneData(payload)
  };
}

function summarizeCheckinPayload(payload) {
  const code = Number(payload?.code ?? -999);
  const message = String(payload?.message || "");

  if (code === 0) {
    return {
      ok: true,
      already: false,
      code,
      message: message || "签到成功",
      points: payload?.points ?? null,
      raw: cloneData(payload)
    };
  }

  if (isAlreadyCheckedInMessage(message)) {
    return {
      ok: true,
      already: true,
      code,
      message: message || "今天可能已经签过了",
      points: payload?.points ?? null,
      raw: cloneData(payload)
    };
  }

  if (code === -2) {
    return {
      ok: false,
      already: false,
      code,
      message: "Cookie 失效或无权限",
      points: payload?.points ?? null,
      raw: cloneData(payload)
    };
  }

  if (code === 4 && payload?.reason === "device-mismatch") {
    return {
      ok: false,
      already: false,
      code,
      reason: payload.reason,
      loginDevice: payload.loginDevice || null,
      currentDevice: payload.currentDevice || null,
      message: message || "签到设备与登录设备不一致",
      points: payload?.points ?? null,
      raw: cloneData(payload)
    };
  }

  return {
    ok: false,
    already: false,
    code,
    message: message || "签到失败",
    points: payload?.points ?? null,
    raw: cloneData(payload)
  };
}

async function refreshAccountStatus(account) {
  const now = formatDateTime();
  let nextAccount = { ...account };
  let result;

  try {
    const payload = await gladosApiRequest(account, "GET", "user/status");
    result = summarizeStatusPayload(payload);
  } catch (error) {
    result = {
      ok: false,
      code: null,
      state: "error",
      message: error.message,
      raw: null
    };
  }

  nextAccount = {
    ...nextAccount,
    lastStatusAt: now,
    lastStatus: result,
    updatedAt: now
  };

  return {
    account: nextAccount,
    summary: {
      id: nextAccount.id,
      name: nextAccount.name,
      status: result
    }
  };
}

async function runAccountCheckin(account) {
  const now = formatDateTime();
  let nextAccount = { ...account };
  let checkin;

  try {
    const host = new URL(normalizeBaseUrl(account.baseUrl, DEFAULT_GLADOS_BASE_URL)).hostname;
    let userAgent = account.userAgent || gladosUserAgent(account.loginDevice);
    let payload = await gladosApiRequest(account, "POST", "user/checkin", { token: host }, userAgent);

    // Confirm whether an authorization rejection really means the session expired.
    // A valid status response allows one more check-in attempt and daily retries.
    let sessionVerified = false;
    if (Number(payload?.code) === -2) {
      const statusPayload = await gladosApiRequest(account, "GET", "user/status", undefined, userAgent);
      if (Number(statusPayload?.code) === 0) {
        sessionVerified = true;
        payload = await gladosApiRequest(account, "POST", "user/checkin", { token: host }, userAgent);
      }
    }

    if (Number(payload?.code) === 4 && payload?.reason === "device-mismatch") {
      const matchedAgent = gladosUserAgent(payload.loginDevice);
      if (matchedAgent !== userAgent) {
        payload = await gladosApiRequest(account, "POST", "user/checkin", { token: host }, matchedAgent);
        userAgent = matchedAgent;
      }
    }

    checkin = summarizeCheckinPayload(payload);
    if (checkin.code === -2 && sessionVerified) {
      checkin.retryable = true;
      checkin.message = "登录有效，但签到接口暂时拒绝授权，请稍后重试";
    }
    checkin.userAgent = userAgent;
    if (payload?.loginDevice) {
      checkin.loginDevice = payload.loginDevice;
    }
  } catch (error) {
    checkin = {
      ok: false,
      already: false,
      code: null,
      message: error.message,
      points: null,
      raw: null
    };
  }

  nextAccount = {
    ...nextAccount,
    lastCheckinAt: now,
    lastCheckin: checkin,
    updatedAt: now
  };
  if (checkin.userAgent) {
    nextAccount.userAgent = checkin.userAgent;
  }
  if (checkin.loginDevice) {
    nextAccount.loginDevice = checkin.loginDevice;
  }

  if (checkin.ok) {
    const refreshed = await refreshAccountStatus(nextAccount);
    nextAccount = refreshed.account;
  } else if (checkin.code === -2 && !checkin.retryable) {
    nextAccount.lastStatusAt = now;
    nextAccount.lastStatus = {
      ok: false,
      code: -2,
      state: "unauthorized",
      message: "Cookie 失效或无权限",
      raw: null
    };
  }

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
  shouldRetryCheckin,
  DEFAULT_GLADOS_BASE_URL,
  gladosApiRequest,
  summarizeStatusPayload,
  summarizeCheckinPayload,
  refreshAccountStatus,
  runAccountCheckin
};
