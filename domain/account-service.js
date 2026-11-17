module.exports = function createService(context) {
  const {
    crypto,
    formatDateTime,
    normalizeBaseUrl,
    workbuddy,
    readProviderAccounts,
    DEFAULT_GLADOS_BASE_URL,
    DEFAULT_EMBYPULSE_BASE_URL,
    DEFAULT_EMBYMB_BASE_URL,
    DEFAULT_VPSNAT_BASE_URL,
    PROVIDER_DEFAULT_BASE,
  } = context;
  function isPasswordProvider(provider) {
    return ["thxnk", "embypulse", "embymb", "vpsnat"].includes(provider);
  }
  function normalizeProvider(value) {
    const key = String(value || "glados")
      .trim()
      .toLowerCase();
    if (!Object.hasOwn(PROVIDER_DEFAULT_BASE, key))
      throw Object.assign(Error("未知 provider"), {
        status: 400,
        code: "UNKNOWN_PROVIDER",
      });
    return key;
  }
  function normalizeAccountInput(body = {}, current = {}) {
    const provider = normalizeProvider(
      body.provider ?? current.provider ?? "glados",
    );
    const name = String(body.name ?? current.name ?? "").trim();
    const cookie = String(body.cookie ?? current.cookie ?? "").trim();
    const username = String(body.username ?? current.username ?? "").trim();
    const password = String(body.password ?? current.password ?? "").trim();
    const insecureTls = Boolean(
      body.insecureTls ?? current.insecureTls ?? false,
    );
    const baseFallback =
      provider === "workbuddy"
        ? workbuddy.DEFAULT_BASE_URL
        : provider === "thxnk"
          ? PROVIDER_DEFAULT_BASE.thxnk
          : provider === "zzcat"
            ? PROVIDER_DEFAULT_BASE.zzcat
            : provider === "vpsnat"
              ? DEFAULT_VPSNAT_BASE_URL
              : provider === "embypulse"
                ? DEFAULT_EMBYPULSE_BASE_URL
                : provider === "embymb"
                  ? DEFAULT_EMBYMB_BASE_URL
                  : DEFAULT_GLADOS_BASE_URL;

    return {
      ...current,
      id: current.id || crypto.randomUUID(),
      provider,
      name,
      baseUrl: normalizeBaseUrl(
        body.baseUrl ?? current.baseUrl ?? baseFallback,
        baseFallback,
      ),
      ...(provider === "workbuddy"
        ? {
            enabled:
              body.enabled === undefined
                ? current.enabled !== false
                : Boolean(body.enabled),
            workbuddySession: (() => {
              const input =
                body.workbuddySession ??
                body.session ??
                current.workbuddySession;
              if (!input) return null;
              try {
                return workbuddy.normalizeSession(input);
              } catch {
                return null;
              }
            })(),
          }
        : {}),
      ...(provider === "vpsnat"
        ? {
            token: String(body.token ?? current.token ?? "").trim(),
            refreshToken: String(
              body.refreshToken ?? current.refreshToken ?? "",
            ).trim(),
          }
        : {}),
      cookie: ["glados", "zzcat"].includes(provider) ? cookie : "",
      username: isPasswordProvider(provider) ? username : "",
      password: isPasswordProvider(provider) ? password : "",
      insecureTls: isPasswordProvider(provider) ? insecureTls : false,
      notes: String(body.notes ?? current.notes ?? "").trim(),
      createdAt: current.createdAt || formatDateTime(),
      updatedAt: formatDateTime(),
      lastStatusAt: current.lastStatusAt || "",
      lastStatus: current.lastStatus || null,
      lastCheckinAt: current.lastCheckinAt || "",
      lastCheckin: current.lastCheckin || null,
    };
  }
  function normalizeAccountMobileUpdate(body = {}, current = {}) {
    const merged = {
      ...body,
      password:
        body.password === undefined ||
        body.password === null ||
        String(body.password) === ""
          ? current.password
          : body.password,
      cookie:
        body.cookie === undefined || body.cookie === null
          ? current.cookie
          : body.cookie,
    };
    return normalizeAccountInput(merged, current);
  }
  function validateAccount(account) {
    if (String(account.notes || "").length > 4000)
      return "备注不能超过 4000 字";
    const fingerprint = (value) =>
      crypto
        .createHmac("sha256", context.SESSION_SECRET)
        .update(String(value))
        .digest("hex");
    if (
      account.provider !== "workbuddy" &&
      readProviderAccounts(account.provider).some(
        (a) =>
          a.id !== account.id &&
          ((account.username &&
            String(a.username || "").trim() === account.username) ||
            (account.cookie &&
              a.cookie &&
              fingerprint(a.cookie) === fingerprint(account.cookie))),
      )
    )
      return "该站点账号已存在，请更新现有账号";
    if (!account.name) {
      return "账号名称不能为空";
    }

    if (account.provider === "workbuddy") {
      const invalid = workbuddy.validateAccount(account);
      if (invalid) return invalid;
      const uid = workbuddy.normalizeSession(account.workbuddySession).account
        .uid;
      const duplicate = readProviderAccounts("workbuddy").some((a) => {
        try {
          return (
            a.id !== account.id &&
            workbuddy.normalizeSession(a.workbuddySession).account.uid === uid
          );
        } catch {
          return false;
        }
      });
      return duplicate ? "该 WorkBuddy 账号已添加，请更新现有账号的凭据" : "";
    }

    if (isPasswordProvider(account.provider)) {
      if (!account.username) {
        return "用户名不能为空";
      }
      if (!account.password) {
        return "密码不能为空";
      }
    } else if (!account.cookie) {
      return "Cookie 不能为空";
    }

    if (
      account.provider === "zzcat" &&
      (/[\r\n]/.test(account.cookie) ||
        !/(?:^|;\s*)qp_session=[^;\s]+(?:;|$)/.test(account.cookie))
    ) {
      return "请输入包含 qp_session=会话值 的 Cookie";
    }

    try {
      new URL(account.baseUrl);
    } catch (error) {
      return "站点地址格式不正确";
    }

    return "";
  }

  const { createAccount, updateAccount, deleteAccount } =
    require("../lib/http/account-handlers").createAccountHandlers({
      normalizeAccountInput,
      normalizeAccountMobileUpdate,
      validateAccount,
    });
  return {
    createAccount,
    updateAccount,
    deleteAccount,
    isPasswordProvider,
    normalizeProvider,
    normalizeAccountInput,
    normalizeAccountMobileUpdate,
    validateAccount,
  };
};
