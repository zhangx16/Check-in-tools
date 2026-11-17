module.exports = function createService(context) {
  const {
    formatDateTime,
    cookiePreview,
    workbuddy,
    PROVIDER_LABELS,
    isPasswordProvider,
  } = context;
  function providerLabel(provider) {
    return PROVIDER_LABELS[provider] || provider || "未知";
  }
  function workbuddyAuthInfo(account) {
    try {
      const session = workbuddy.normalizeSession(account.workbuddySession);
      const { expiry } = require("../workbuddy-auth");
      const access = expiry(session.auth),
        refresh = expiry(session.auth, true);
      return {
        hasRefreshToken: Boolean(session.auth.refreshToken),
        expiresAt: Number.isFinite(access)
          ? new Date(access).toISOString()
          : null,
        refreshExpiresAt: Number.isFinite(refresh)
          ? new Date(refresh).toISOString()
          : null,
        expired: Number.isFinite(access) && access <= Date.now(),
        refreshExpired: Number.isFinite(refresh) && refresh <= Date.now(),
      };
    } catch {
      return { hasRefreshToken: false, expired: true, refreshExpired: false };
    }
  }
  function toPublicAccount(account) {
    const provider =
      String(account.provider || "glados")
        .trim()
        .toLowerCase() || "glados";
    return {
      id: account.id,
      provider,
      providerLabel: providerLabel(provider),
      name: account.name,
      ...(provider === "workbuddy"
        ? {
            enabled: account.enabled !== false,
            workbuddyAuth: workbuddyAuthInfo(account),
          }
        : {}),
      baseUrl: account.baseUrl,
      notes: account.notes || "",
      createdAt: account.createdAt || "",
      updatedAt: account.updatedAt || "",
      authPreview:
        provider === "workbuddy"
          ? account.workbuddySession
            ? "WorkBuddy 凭据已保存"
            : "未保存凭据"
          : isPasswordProvider(provider)
            ? `账号: ${account.username || "未保存"}`
            : `Cookie: ${cookiePreview(account.cookie) || "未保存"}`,
      lastStatusAt: account.lastStatusAt || "",
      lastStatus: account.lastStatus || null,
      lastCheckinAt: account.lastCheckinAt || "",
      lastCheckin: account.lastCheckin || null,
    };
  }
  function toPublicAccountDetail(account) {
    const provider =
      String(account.provider || "glados")
        .trim()
        .toLowerCase() || "glados";
    return {
      ...toPublicAccount(account),
      ...(provider === "workbuddy"
        ? { hasWorkbuddySession: Boolean(account.workbuddySession) }
        : {}),
      cookie: account.cookie || "",
      username: account.username || "",
      hasPassword: Boolean(account.password),
      insecureTls: Boolean(account.insecureTls),
      provider,
    };
  }
  function toMobileAccountDetail(account) {
    const publicAccount = toPublicAccount(account);
    const provider = publicAccount.provider;
    return {
      ...publicAccount,
      ...(provider === "workbuddy"
        ? { hasWorkbuddySession: Boolean(account.workbuddySession) }
        : {}),
      baseUrl: account.baseUrl || "",
      cookie: provider === "glados" ? account.cookie || "" : "",
      username: isPasswordProvider(provider) ? account.username || "" : "",
      hasPassword: Boolean(account.password),
      hasCookie: Boolean(account.cookie),
      insecureTls: Boolean(account.insecureTls),
      notes: account.notes || "",
    };
  }
  function getExportData(accounts, includeSecrets = false) {
    return {
      exportedAt: formatDateTime(),
      accounts: accounts.map((account) => ({
        id: account.id,
        provider: account.provider || "glados",
        name: account.name,
        baseUrl: account.baseUrl,
        ...(includeSecrets
          ? { cookie: account.cookie || "", password: account.password || "" }
          : {}),
        username: account.username || "",
        insecureTls: Boolean(account.insecureTls),
        notes: account.notes || "",
      })),
    };
  }

  return {
    providerLabel,
    workbuddyAuthInfo,
    toPublicAccount,
    toPublicAccountDetail,
    toMobileAccountDetail,
    getExportData,
  };
};
