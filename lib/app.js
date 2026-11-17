const PROJECT_ROOT = require("path").resolve(__dirname, "..");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const {
  loadLocalEnv,
  formatDateTime,
  sleep,
  DATA_DIR,
  USER_AGENT,
  parseCookies,
  cookiePreview,
  pickNumber,
  runConcurrent,
  normalizeBaseUrl,
  isAlreadyCheckedInMessage
} = require("./common");

loadLocalEnv();
const workbuddy = require("./providers/workbuddy");
const workbuddyJobs = require("./workbuddy-jobs");
const workbuddyLogin = require("./workbuddy-login");
const embyKeepalive = require("./emby-keepalive");

const {
  readAccounts,
  readProviderAccounts,
  writeAccounts,
  writeProviderAccounts,
  ensureDataFiles: ensureAccountDataFiles
} = require("./accounts");
const { refreshAccountStatus, runAccountCheckin } = require("./providers");
const { telegramBotApiByToken } = require("./telegram");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 22821);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEFAULT_GLADOS_BASE_URL = "https://glados.network";
const DEFAULT_EMBYPULSE_BASE_URL =
  process.env.DEFAULT_EMBYPULSE_BASE_URL || "https://embypulse.example.com";
const DEFAULT_EMBYMB_BASE_URL =
  process.env.DEFAULT_EMBYMB_BASE_URL || "https://embymb.ichinosekotomi.com";
const { readConfig } = require("./config");
const config = readConfig(process.env, { validate: false });
const { ADMIN_USER, ADMIN_PASS, SESSION_SECRET, APP_API_TOKEN } = config;
const { createAuth, isHttpsRequest } = require("./http/auth");
const { signSession, isAuthenticated, setAuthCookies, clearAuthCookies, isAppTokenAuthorized,
  requireAuth, requireAppOrSessionAuth, checkLogin } = createAuth(config);
const { sendJson, sendText, readRequestBody } = require("./http/respond");
const { log, audit } = require("./log");

const EMBYKEEPER_DIR = path.join(DATA_DIR, "embykeeper");
const EMBYKEEPER_CONFIG_FILE = path.join(EMBYKEEPER_DIR, "config.toml");
const EMBYKEEPER_FORM_FILE = path.join(EMBYKEEPER_DIR, "form.json");
const EMBYKEEPER_RUNTIME_DIR = path.join(EMBYKEEPER_DIR, "runtime");
const TELEGRAM_CHECKIN_RESULTS_FILE = path.join(DATA_DIR, "telegram_bot_checkin_results.json");
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const EMBYKEEPER_VENV_DIR = path.join(PROJECT_ROOT, ".venv-embykeeper");
const EMBYKEEPER_BIN = path.join(EMBYKEEPER_VENV_DIR, "bin", "python");
const EMBYKEEPER_RUNNER = path.join(PROJECT_ROOT, "scripts", "embykeeper_run_once.sh");
const CUSTOM_TG_WORKER = path.join(PROJECT_ROOT, "scripts", "telegram_bot_checkin.py");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const PROJECT_NAMES_FILE = path.join(DATA_DIR, "project_names.json");
const BOT_AVATAR_DIR = path.join(PUBLIC_DIR, "bot-avatars");
const SITE_ICON_DIR = path.join(PUBLIC_DIR, "site-icons");
const BOT_AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_ICON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_VPSNAT_BASE_URL = process.env.DEFAULT_VPSNAT_BASE_URL || "https://www.vpsnat.com";
const PROVIDER_DEFAULT_BASE = {
  workbuddy: workbuddy.DEFAULT_BASE_URL,
  thxnk: "https://thxnk.cc",
  zzcat: "https://user.090911.xyz",
  vpsnat: DEFAULT_VPSNAT_BASE_URL,
  glados: DEFAULT_GLADOS_BASE_URL,
  embypulse: DEFAULT_EMBYPULSE_BASE_URL,
  embymb: DEFAULT_EMBYMB_BASE_URL
};
const PROVIDER_LABELS = {
  workbuddy: "WorkBuddy",
  thxnk: "练习生的日常",
  zzcat: "这只猫用户中心",
  vpsnat: "VPSNAT 纳泰云",
  glados: "GLaDOS",
  embypulse: "EmbyPulse",
  embymb: "EmbyMB",
  telegram_bot: "Telegram Bot"
};
const EMBYKEEPER_BUILTIN_CHECKINERS = {
  gymeowfly_bot: "meow",
  LembyPremium_BOT: "lemby",
  JingzheProbot: "jingzhe",
  YounoEmbyAgain_bot: "youno"
};



function ensureDataFiles() {
  ensureAccountDataFiles();
  if (!fs.existsSync(EMBYKEEPER_DIR)) {
    fs.mkdirSync(EMBYKEEPER_DIR, { recursive: true });
  }
  if (!fs.existsSync(EMBYKEEPER_RUNTIME_DIR)) {
    fs.mkdirSync(EMBYKEEPER_RUNTIME_DIR, { recursive: true });
  }
}

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider || "未知";
}

function readProjectNames() {
  if (!fs.existsSync(PROJECT_NAMES_FILE)) return {};
  const names = JSON.parse(fs.readFileSync(PROJECT_NAMES_FILE, "utf8"));
  if (!names || typeof names !== "object" || Array.isArray(names)) throw new Error("项目名称配置格式错误");
  return names;
}

function setProjectName(id, name) {
  const names = readProjectNames();
  const key = id.toLowerCase();
  if (name) names[key] = name;
  else delete names[key];
  fs.writeFileSync(`${PROJECT_NAMES_FILE}.tmp`, JSON.stringify(names, null, 2));
  fs.renameSync(`${PROJECT_NAMES_FILE}.tmp`, PROJECT_NAMES_FILE);
}

function applyProjectNames(projects) {
  const names = readProjectNames();
  return projects.map(project => ({ ...project, defaultTitle: project.defaultTitle || project.title,
    title: names[project.id.toLowerCase()] || project.defaultTitle || project.title }));
}

function isPasswordProvider(provider) {
  return ["thxnk", "embypulse", "embymb", "vpsnat"].includes(provider);
}

function ensureEmbykeeperConfigFile() {
  ensureDataFiles();
  if (!fs.existsSync(EMBYKEEPER_CONFIG_FILE)) {
    fs.writeFileSync(EMBYKEEPER_CONFIG_FILE, "");
  }
}

function readEmbykeeperConfig() {
  ensureEmbykeeperConfigFile();
  return fs.readFileSync(EMBYKEEPER_CONFIG_FILE, "utf8");
}

function writeEmbykeeperConfig(content) {
  ensureEmbykeeperConfigFile();
  fs.writeFileSync(EMBYKEEPER_CONFIG_FILE, String(content || ""), "utf8");
}

function defaultTelegramAccountForm() {
  return {
    phone: "",
    apiId: "",
    apiHash: "",
    session: "",
    enabled: true,
    checkiner: true
  };
}

function defaultBotTemplateForm() {
  return {
    botUsername: "",
    name: "",
    commands: ["/checkin"],
    successKeywords: ["签到成功", "今日已签到", "今天已经签到过了", "success"],
    checkedKeywords: ["今日已签到", "今天已经签到过了"],
    failKeywords: ["失败", "错误", "error", "invalid"],
    textIgnore: [],
    targetPhones: [],
    sendInterval: 3,
    useCaptcha: true,
    isChat: false,
    waitResponse: true
  };
}

function defaultEmbykeeperForm() {
  return {
    telegramAccounts: [defaultTelegramAccountForm()],
    botTemplates: [defaultBotTemplateForm()],
    globalCheckiner: {
      timeout: 120,
      retries: 4,
      concurrency: 1,
      randomStart: 60,
      intervalDays: "1",
      timeRange: "<11:00AM,11:00PM>"
    }
  };
}

function normalizeStringArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback.slice();
}

function normalizeEmbykeeperForm(body = {}) {
  const source = body && typeof body === "object" ? body : {};
  const defaults = defaultEmbykeeperForm();

  const telegramAccountsRaw = Array.isArray(source.telegramAccounts) ? source.telegramAccounts : defaults.telegramAccounts;
  const telegramAccounts = telegramAccountsRaw.map((item) => ({
    ...item,
    phone: String(item?.phone || "").trim(),
    apiId: String(item?.apiId || item?.api_id || "").trim(),
    apiHash: String(item?.apiHash || item?.api_hash || "").trim(),
    session: String(item?.session || "").trim(),
    enabled: item?.enabled !== false,
    checkiner: item?.checkiner !== false
  })).filter((item) => item.phone);

  const botTemplatesRaw = Array.isArray(source.botTemplates) ? source.botTemplates : defaults.botTemplates;
  const botTemplates = botTemplatesRaw.map((item) => ({
    ...item,
    buttonSequence: normalizeStringArray(item?.buttonSequence || item?.button_sequence, []),
    requireExistingChat: Boolean(item?.requireExistingChat),
    captchaLengths: item?.captchaLengths || [],
    captchaPattern: String(item?.captchaPattern || ""),
    source: String(item?.source || ""),
    botUsername: String(item?.botUsername || item?.bot_username || "").trim(),
    name: String(item?.name || "").trim(),
    commands: normalizeStringArray(item?.commands || item?.botCheckinCmd || item?.bot_checkin_cmd, ["/checkin"]),
    successKeywords: normalizeStringArray(item?.successKeywords || item?.botSuccessKeywords || item?.bot_success_keywords, defaults.botTemplates[0].successKeywords),
    checkedKeywords: normalizeStringArray(item?.checkedKeywords || item?.botCheckedKeywords || item?.bot_checked_keywords, defaults.botTemplates[0].checkedKeywords),
    failKeywords: normalizeStringArray(item?.failKeywords || item?.botFailKeywords || item?.bot_fail_keywords, defaults.botTemplates[0].failKeywords),
    textIgnore: normalizeStringArray(item?.textIgnore || item?.botTextIgnore || item?.bot_text_ignore, []),
    targetPhones: normalizeStringArray(item?.targetPhones || item?.target_phones || item?.botTargetPhones || item?.bot_target_phones, []),
    sendInterval: Math.max(1, Number(item?.sendInterval ?? item?.botSendInterval ?? item?.bot_send_interval ?? 3) || 3),
    useCaptcha: item?.useCaptcha !== false,
    isChat: Boolean(item?.isChat),
    waitResponse: item?.waitResponse !== false
  })).filter((item) => item.botUsername);

  const globalCheckinerSource = source.globalCheckiner && typeof source.globalCheckiner === "object"
    ? source.globalCheckiner
    : defaults.globalCheckiner;

  return {
    ...source,
    telegramAccounts: telegramAccounts.length ? telegramAccounts : defaults.telegramAccounts,
    botTemplates,
    globalCheckiner: {
      ...globalCheckinerSource,
      timeout: Math.max(10, Number(globalCheckinerSource.timeout ?? defaults.globalCheckiner.timeout) || defaults.globalCheckiner.timeout),
      retries: Math.max(1, Number(globalCheckinerSource.retries ?? defaults.globalCheckiner.retries) || defaults.globalCheckiner.retries),
      concurrency: Math.max(1, Number(globalCheckinerSource.concurrency ?? defaults.globalCheckiner.concurrency) || defaults.globalCheckiner.concurrency),
      randomStart: Math.max(0, Number(globalCheckinerSource.randomStart ?? defaults.globalCheckiner.randomStart) || defaults.globalCheckiner.randomStart),
      intervalDays: String(globalCheckinerSource.intervalDays ?? defaults.globalCheckiner.intervalDays).trim() || defaults.globalCheckiner.intervalDays,
      timeRange: String(globalCheckinerSource.timeRange ?? defaults.globalCheckiner.timeRange).trim() || defaults.globalCheckiner.timeRange
    }
  };
}

function readEmbykeeperForm() {
  ensureDataFiles();
  if (!fs.existsSync(EMBYKEEPER_FORM_FILE)) {
    return defaultEmbykeeperForm();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(EMBYKEEPER_FORM_FILE, "utf8"));
    return normalizeEmbykeeperForm(parsed);
  } catch {
    return defaultEmbykeeperForm();
  }
}

function readTelegramCheckinResults() {
  ensureDataFiles();
  try {
    const parsed = JSON.parse(fs.readFileSync(TELEGRAM_CHECKIN_RESULTS_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeEmbykeeperForm(form) {
  ensureDataFiles();
  fs.writeFileSync(EMBYKEEPER_FORM_FILE, JSON.stringify(form, null, 2));
}

function tomlEscape(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function tomlString(value) {
  return `"${tomlEscape(value)}"`;
}

function tomlBoolean(value) {
  return value ? "true" : "false";
}

function tomlArray(values = []) {
  return `[${values.map((item) => tomlString(item)).join(", ")}]`;
}

function renderEmbykeeperConfigFromForm(formInput) {
  const form = normalizeEmbykeeperForm(formInput);
  const checkinerNames = form.botTemplates.map((item) => {
    const builtin = EMBYKEEPER_BUILTIN_CHECKINERS[item.botUsername];
    return builtin || `templ_b<${item.botUsername}>`;
  });
  const lines = [
    "# emby-keeper Telegram bot check-in config",
    "# Generated by checkin panel",
    ""
  ];

  lines.push("[site]");
  lines.push(`checkiner = ${tomlArray(checkinerNames)}`);
  lines.push("");

  lines.push("[checkiner]");
  lines.push(`time_range = ${tomlString(form.globalCheckiner.timeRange)}`);
  lines.push(`interval_days = ${tomlString(form.globalCheckiner.intervalDays)}`);
  lines.push(`timeout = ${form.globalCheckiner.timeout}`);
  lines.push(`retries = ${form.globalCheckiner.retries}`);
  lines.push(`concurrency = ${form.globalCheckiner.concurrency}`);
  lines.push(`random_start = ${form.globalCheckiner.randomStart}`);
  lines.push("");

  for (const account of form.telegramAccounts) {
    lines.push("[[telegram.account]]");
    lines.push(`phone = ${tomlString(account.phone)}`);
    lines.push(`checkiner = ${tomlBoolean(account.checkiner)}`);
    lines.push(`enabled = ${tomlBoolean(account.enabled)}`);
    if (account.apiId) lines.push(`api_id = ${tomlString(account.apiId)}`);
    if (account.apiHash) lines.push(`api_hash = ${tomlString(account.apiHash)}`);
    if (account.session) lines.push(`session = ${tomlString(account.session)}`);
    lines.push("");
  }

  for (const bot of form.botTemplates) {
    const builtin = EMBYKEEPER_BUILTIN_CHECKINERS[bot.botUsername];
    const key = builtin || `templ_b<${bot.botUsername}>`;
    lines.push(`[checkiner.${tomlString(key)}]`);
    if (bot.name) lines.push(`name = ${tomlString(bot.name)}`);
    lines.push(`bot_checkin_cmd = ${tomlArray(bot.commands)}`);
    lines.push(`bot_send_interval = ${bot.sendInterval}`);
    lines.push(`bot_use_captcha = ${tomlBoolean(bot.useCaptcha)}`);
    lines.push(`bot_success_keywords = ${tomlArray(bot.successKeywords)}`);
    lines.push(`bot_checked_keywords = ${tomlArray(bot.checkedKeywords)}`);
    lines.push(`bot_fail_keywords = ${tomlArray(bot.failKeywords)}`);
    if (bot.textIgnore.length) lines.push(`bot_text_ignore = ${tomlArray(bot.textIgnore)}`);
    lines.push(`is_chat = ${tomlBoolean(bot.isChat)}`);
    lines.push(`wait_response = ${tomlBoolean(bot.waitResponse)}`);
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

function getEmbykeeperStatus() {
  ensureDataFiles();
  const runtimeFiles = fs.existsSync(EMBYKEEPER_RUNTIME_DIR)
    ? fs.readdirSync(EMBYKEEPER_RUNTIME_DIR)
    : [];
  const sessionFiles = runtimeFiles.filter((name) => !name.startsWith("."));
  const cache = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(EMBYKEEPER_RUNTIME_DIR, "cache.json"), "utf8"));
    } catch {
      return {};
    }
  })();
  const sessionStrings = cache?.telegram?.session_str || {};
  const sessionStringCount = Object.keys(sessionStrings).length;

  return {
    installed: fs.existsSync(EMBYKEEPER_BIN),
    runnerExists: fs.existsSync(EMBYKEEPER_RUNNER),
    customWorkerExists: fs.existsSync(CUSTOM_TG_WORKER),
    configExists: fs.existsSync(EMBYKEEPER_CONFIG_FILE),
    runtimeDirExists: fs.existsSync(EMBYKEEPER_RUNTIME_DIR),
    sessionFiles,
    sessionStringCount,
    binaryPath: EMBYKEEPER_BIN,
    configPath: EMBYKEEPER_CONFIG_FILE,
    runtimeDir: EMBYKEEPER_RUNTIME_DIR,
    runnerPath: CUSTOM_TG_WORKER,
    firstRunHint: EMBYKEEPER_RUNNER
  };
}

function runEmbykeeperOnce() {
  return new Promise((resolve) => {
    const status = getEmbykeeperStatus();
    if (!status.customWorkerExists) {
      resolve({ ok: false, output: "", error: "Telegram 自定义签到 worker 不存在" });
      return;
    }
    if (!status.sessionStringCount) {
      resolve({ ok: false, output: "", error: "缺少 Telegram 会话，请先执行首次登录" });
      return;
    }

    const child = spawn(path.join(EMBYKEEPER_VENV_DIR, "bin", "python"), [CUSTOM_TG_WORKER], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        output,
        error: "自定义 Telegram Bot 签到运行超时"
      });
    }, Math.max(90000, Math.min(3600000, readEmbykeeperForm().botTemplates.length * 45000)));

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, output, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        output,
        error: code === 0 ? "" : `emby-keeper exited with code ${code}`
      });
    });
  });
}

function workbuddyAuthInfo(account) {
  try {
    const session = workbuddy.normalizeSession(account.workbuddySession);
    const { expiry } = require('./workbuddy-auth');
    const access = expiry(session.auth), refresh = expiry(session.auth, true);
    return { hasRefreshToken: Boolean(session.auth.refreshToken),
      expiresAt: Number.isFinite(access) ? new Date(access).toISOString() : null,
      refreshExpiresAt: Number.isFinite(refresh) ? new Date(refresh).toISOString() : null,
      expired: Number.isFinite(access) && access <= Date.now(),
      refreshExpired: Number.isFinite(refresh) && refresh <= Date.now() };
  } catch { return { hasRefreshToken: false, expired: true, refreshExpired: false }; }
}

function toPublicAccount(account) {
  const provider = String(account.provider || "glados").trim().toLowerCase() || "glados";
  return {
    id: account.id,
    provider,
    providerLabel: providerLabel(provider),
    name: account.name,
    ...(provider === 'workbuddy' ? { enabled: account.enabled !== false, workbuddyAuth: workbuddyAuthInfo(account) } : {}),
    baseUrl: account.baseUrl,
    notes: account.notes || "",
    createdAt: account.createdAt || "",
    updatedAt: account.updatedAt || "",
    authPreview: provider === "workbuddy" ? (account.workbuddySession ? "WorkBuddy 凭据已保存" : "未保存凭据") : isPasswordProvider(provider)
      ? `账号: ${account.username || "未保存"}`
      : `Cookie: ${cookiePreview(account.cookie) || "未保存"}`,
    lastStatusAt: account.lastStatusAt || "",
    lastStatus: account.lastStatus || null,
    lastCheckinAt: account.lastCheckinAt || "",
    lastCheckin: account.lastCheckin || null
  };
}

function toPublicAccountDetail(account) {
  const provider = String(account.provider || "glados").trim().toLowerCase() || "glados";
  return {
    ...toPublicAccount(account),
    ...(provider === "workbuddy" ? { hasWorkbuddySession: Boolean(account.workbuddySession) } : {}),
    cookie: account.cookie || "",
    username: account.username || "",
    hasPassword: Boolean(account.password),
    insecureTls: Boolean(account.insecureTls),
    provider
  };
}

/** Mobile-safe account detail: never return raw password; cookie returned for edit forms. */
function toMobileAccountDetail(account) {
  const publicAccount = toPublicAccount(account);
  const provider = publicAccount.provider;
  return {
    ...publicAccount,
    ...(provider === "workbuddy" ? { hasWorkbuddySession: Boolean(account.workbuddySession) } : {}),
    baseUrl: account.baseUrl || "",
    cookie: provider === "glados" ? account.cookie || "" : "",
    username: isPasswordProvider(provider) ? account.username || "" : "",
    hasPassword: Boolean(account.password),
    hasCookie: Boolean(account.cookie),
    insecureTls: Boolean(account.insecureTls),
    notes: account.notes || ""
  };
}

/** PUT update: empty password/cookie keeps existing secret. */
function normalizeAccountMobileUpdate(body = {}, current = {}) {
  const merged = {
    ...body,
    password:
      body.password === undefined || body.password === null || String(body.password) === ""
        ? current.password
        : body.password,
    cookie:
      body.cookie === undefined || body.cookie === null
        ? current.cookie
        : body.cookie
  };
  return normalizeAccountInput(merged, current);
}

function listMobileTelegramBots() {
  const form = readEmbykeeperForm();
  const results = readTelegramCheckinResults();
  const bots = (form.botTemplates || []).map((bot) => {
    const username = String(bot.botUsername || "").replace(/^@/, "");
    const result = results?.bots?.[username] || results?.bots?.[bot.botUsername] || null;
    return {
      botUsername: username,
      name: bot.name || username,
      commands: bot.commands || [],
      successKeywords: bot.successKeywords || [],
      checkedKeywords: bot.checkedKeywords || [],
      failKeywords: bot.failKeywords || [],
      sendInterval: bot.sendInterval,
      useCaptcha: bot.useCaptcha,
      isChat: bot.isChat,
      waitResponse: bot.waitResponse,
      targetPhones: bot.targetPhones || [],
      lastStatus: result
        ? {
            ok: result.ok,
            status: result.status,
            message: result.message,
            checkedAt: result.checkedAt
          }
        : null
    };
  });
  return {
    bots,
    phones: (form.telegramAccounts || []).map((a) => ({
      phone: a.phone,
      enabled: a.enabled !== false,
      checkiner: a.checkiner !== false
    }))
  };
}

function persistEmbykeeperForm(form) {
  const normalized = normalizeEmbykeeperForm(form);
  writeEmbykeeperForm(normalized);
  writeEmbykeeperConfig(renderEmbykeeperConfigFromForm(normalized));
  return normalized;
}

function updateMobileTelegramBot(botUsername, body = {}) {
  const form = readEmbykeeperForm();
  const idx = (form.botTemplates || []).findIndex(
    (b) => String(b.botUsername || "").replace(/^@/, "") === botUsername
  );
  if (idx < 0) {
    return { ok: false, error: "Bot 不存在" };
  }
  const current = form.botTemplates[idx];
  form.botTemplates[idx] = {
    ...current,
    name: body.name !== undefined ? String(body.name || "").trim() : current.name,
    botUsername:
      body.botUsername !== undefined
        ? String(body.botUsername || "").trim().replace(/^@/, "")
        : current.botUsername,
    commands: body.commands !== undefined ? normalizeStringArray(body.commands, current.commands) : current.commands,
    successKeywords:
      body.successKeywords !== undefined
        ? normalizeStringArray(body.successKeywords, current.successKeywords)
        : current.successKeywords,
    checkedKeywords:
      body.checkedKeywords !== undefined
        ? normalizeStringArray(body.checkedKeywords, current.checkedKeywords)
        : current.checkedKeywords,
    failKeywords:
      body.failKeywords !== undefined
        ? normalizeStringArray(body.failKeywords, current.failKeywords)
        : current.failKeywords,
    sendInterval:
      body.sendInterval !== undefined
        ? Math.max(1, Number(body.sendInterval) || current.sendInterval || 3)
        : current.sendInterval,
    useCaptcha: body.useCaptcha !== undefined ? Boolean(body.useCaptcha) : current.useCaptcha,
    isChat: body.isChat !== undefined ? Boolean(body.isChat) : current.isChat,
    waitResponse: body.waitResponse !== undefined ? Boolean(body.waitResponse) : current.waitResponse,
    targetPhones:
      body.targetPhones !== undefined
        ? normalizeStringArray(body.targetPhones, current.targetPhones || [])
        : current.targetPhones || []
  };
  if (!form.botTemplates[idx].botUsername) {
    return { ok: false, error: "Bot 用户名不能为空" };
  }
  const saved = persistEmbykeeperForm(form);
  return { ok: true, bot: listMobileTelegramBots().bots.find((b) => b.botUsername === form.botTemplates[idx].botUsername), form: saved };
}

function deleteMobileTelegramBot(botUsername) {
  // Preserve worker-specific fields (for example buttonSequence) on other bots.
  const form = readEmbykeeperForm();
  const key = String(botUsername).replace(/^@/, "").toLowerCase();
  const before = (form.botTemplates || []).length;
  form.botTemplates = (form.botTemplates || []).filter(
    (b) => String(b.botUsername || "").replace(/^@/, "").toLowerCase() !== key
  );
  if (form.botTemplates.length === before) {
    return { ok: false, error: "Bot 不存在" };
  }
  persistEmbykeeperForm(form);

  // Drop results for this bot so summary refreshes cleanly.
  try {
    const results = readTelegramCheckinResults();
    if (results?.bots) {
      for (const username of Object.keys(results.bots)) {
        if (username.replace(/^@/, "").toLowerCase() === key) delete results.bots[username];
      }
      fs.writeFileSync(TELEGRAM_CHECKIN_RESULTS_FILE, JSON.stringify(results, null, 2));
    }
  } catch {
    // ignore
  }
  const skipPath = path.join(DATA_DIR, "telegram_bot_checkin_skip.json");
  if (fs.existsSync(skipPath)) {
    const cache = JSON.parse(fs.readFileSync(skipPath, "utf8"));
    for (const bots of Object.values(cache)) {
      for (const username of Object.keys(bots || {})) {
        if (username.replace(/^@/, "").toLowerCase() === key) delete bots[username];
      }
    }
    fs.writeFileSync(skipPath, JSON.stringify(cache, null, 2));
  }
  setProjectName(`tg:${botUsername}`, "");
  return { ok: true, deletedBotUsername: botUsername };
}

function deleteMobileTelegramPhone(phone) {
  const form = readEmbykeeperForm();
  const before = (form.telegramAccounts || []).length;
  form.telegramAccounts = (form.telegramAccounts || []).filter((a) => a.phone !== phone);
  if (form.telegramAccounts.length === before) {
    return { ok: false, error: "手机号不存在" };
  }
  if (!form.telegramAccounts.length) {
    form.telegramAccounts = defaultEmbykeeperForm().telegramAccounts;
  }
  persistEmbykeeperForm(form);
  return { ok: true, deletedPhone: phone };
}

/**
 * Remove one phone from a single bot's check-in scope (does NOT delete the TG account globally).
 * Empty targetPhones means "all phones"; we materialize the remaining phones into targetPhones.
 */
function removePhoneFromTelegramBot(botUsername, phone) {
  const user = String(botUsername || "").replace(/^@/, "");
  const form = readEmbykeeperForm();
  const idx = (form.botTemplates || []).findIndex(
    (b) => String(b.botUsername || "").replace(/^@/, "") === user
  );
  if (idx < 0) {
    return { ok: false, error: "Bot 不存在" };
  }
  const bot = form.botTemplates[idx];
  const allPhones = (form.telegramAccounts || [])
    .filter((a) => a.enabled !== false && a.checkiner !== false)
    .map((a) => a.phone)
    .filter(Boolean);
  let targets = Array.isArray(bot.targetPhones) ? bot.targetPhones.filter(Boolean) : [];
  if (!targets.length) {
    targets = allPhones.slice();
  }
  const nextTargets = targets.filter((p) => p !== phone);
  if (nextTargets.length === targets.length) {
    // Phone might only appear in results; still allow cleaning results.
  }
  // If only one phone remains and it equals all remaining accounts, can leave empty (= all remaining).
  form.botTemplates[idx] = {
    ...bot,
    targetPhones: nextTargets
  };
  persistEmbykeeperForm(form);

  // Strip this phone from bot results so summary drops the row immediately.
  try {
    const results = readTelegramCheckinResults();
    const key = user;
    const entry = results?.bots?.[key] || results?.bots?.[bot.botUsername];
    if (entry && Array.isArray(entry.accounts)) {
      entry.accounts = entry.accounts.filter((a) => String(a?.phone || "") !== phone);
      results.bots[key] = entry;
      results.updatedAt = formatDateTime();
      fs.writeFileSync(TELEGRAM_CHECKIN_RESULTS_FILE, JSON.stringify(results, null, 2));
    }
  } catch {
    // ignore
  }
  return { ok: true, botUsername: user, removedPhone: phone, targetPhones: nextTargets };
}

function normalizeProvider(value) {
  if (String(value || "").trim().toLowerCase() === "workbuddy") return "workbuddy";
  if (String(value || "").trim().toLowerCase() === "thxnk") return "thxnk";
  if (String(value || "").trim().toLowerCase() === "zzcat") return "zzcat";
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "embypulse") return "embypulse";
  if (raw === "vpsnat") return "vpsnat";
  if (raw === "embymb") return "embymb";
  return "glados";
}

function normalizeAccountInput(body = {}, current = {}) {
  const provider = normalizeProvider(body.provider ?? current.provider ?? "glados");
  const name = String(body.name ?? current.name ?? "").trim();
  const cookie = String(body.cookie ?? current.cookie ?? "").trim();
  const username = String(body.username ?? current.username ?? "").trim();
  const password = String(body.password ?? current.password ?? "").trim();
  const insecureTls = Boolean(body.insecureTls ?? current.insecureTls ?? false);
  const baseFallback = provider === "workbuddy" ? workbuddy.DEFAULT_BASE_URL : provider === "thxnk" ? PROVIDER_DEFAULT_BASE.thxnk : provider === "zzcat" ? PROVIDER_DEFAULT_BASE.zzcat : provider === "vpsnat" ? DEFAULT_VPSNAT_BASE_URL : provider === "embypulse"
    ? DEFAULT_EMBYPULSE_BASE_URL
    : provider === "embymb"
      ? DEFAULT_EMBYMB_BASE_URL
      : DEFAULT_GLADOS_BASE_URL;

  return {
    ...current,
    id: current.id || crypto.randomUUID(),
    provider,
    name,
    baseUrl: normalizeBaseUrl(body.baseUrl ?? current.baseUrl ?? baseFallback, baseFallback),
    ...(provider === "workbuddy" ? { enabled: body.enabled === undefined ? current.enabled !== false : Boolean(body.enabled), workbuddySession: (() => {
      const input = body.workbuddySession ?? body.session ?? current.workbuddySession;
      if (!input) return null;
      try { return workbuddy.normalizeSession(input); }
      catch { return null; }
    })() } : {}),
    ...(provider === "vpsnat" ? { token: String(body.token ?? current.token ?? "").trim(), refreshToken: String(body.refreshToken ?? current.refreshToken ?? "").trim() } : {}),
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
    lastCheckin: current.lastCheckin || null
  };
}

function validateAccount(account) {
  if (!account.name) {
    return "账号名称不能为空";
  }

  if (account.provider === "workbuddy") {
    const invalid = workbuddy.validateAccount(account);
    if (invalid) return invalid;
    const uid = workbuddy.normalizeSession(account.workbuddySession).account.uid;
    const duplicate = readProviderAccounts('workbuddy').some(a => {
      try { return a.id !== account.id && workbuddy.normalizeSession(a.workbuddySession).account.uid === uid; }
      catch { return false; }
    });
    return duplicate ? '该 WorkBuddy 账号已添加，请更新现有账号的凭据' : '';
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

  if (account.provider === "zzcat" &&
      (/[\r\n]/.test(account.cookie) || !/(?:^|;\s*)qp_session=[^;\s]+(?:;|$)/.test(account.cookie))) {
    return "请输入包含 qp_session=会话值 的 Cookie";
  }

  try {
    new URL(account.baseUrl);
  } catch (error) {
    return "站点地址格式不正确";
  }

  return "";
}


















const serveStatic = require("./http/static").createStatic(PUBLIC_DIR);









/** Cookie session (web panel) or Bearer / X-API-Key (mobile app). */


function emptyStatusCounts() {
  return {
    success: 0,
    already: 0,
    failed: 0,
    skipped: 0,
    unknown: 0,
    pending: 0
  };
}

function deriveWebsiteItemStatus(account) {
  const checkin = account.lastCheckin || null;
  const status = account.lastStatus || null;

  if (checkin) {
    if (account.provider === "workbuddy" && checkin.ok === false) return "failed";
    if (checkin.skipped) return "skipped";
    if (checkin.already === true || isAlreadyCheckedInMessage(checkin.message)) return "already";
    if (checkin.ok === true) return "success";
    if (checkin.ok === false) return "failed";
  }

  if (status) {
    if (status.todaySigned === true) return "already";
    if (status.ok === true && /已签到|already|signed/i.test(String(status.message || ""))) {
      return "already";
    }
    if (status.ok === false) return "failed";
    if (status.ok === true && !account.lastCheckinAt) return "unknown";
  }

  if (!account.lastCheckinAt && !account.lastStatusAt) {
    return "pending";
  }
  return "unknown";
}
function mapWebsiteAccountToSummaryItem(account) {
  const provider = String(account.provider || "glados").trim().toLowerCase() || "glados";
  const checkin = account.lastCheckin || {};
  const status = account.lastStatus || {};
  const itemStatus = deriveWebsiteItemStatus(account);
  const streak = pickNumber(
    checkin.raw?.data?.current_streak,
    checkin.currentStreak,
    status.currentStreak
  );
  const leftDays = status.leftDays ?? checkin.raw?.data?.leftDays ?? null;
  const pointsDelta = pickNumber(checkin.points, checkin.raw?.data?.daily_points, checkin.raw?.data?.total_today);
  const balance = pickNumber(
    checkin.balance,
    checkin.currentPoints,
    checkin.raw?.data?.current_points,
    checkin.raw?.data?.total_points,
    status.points,
    status.totalPoints
  );

  return {
    id: String(account.id || ""),
    kind: provider === "workbuddy" ? "workbuddy" : "website",
    provider,
    providerLabel: providerLabel(provider),
    accountName: account.name || "",
    status: itemStatus,
    ok: itemStatus === "success" || itemStatus === "already",
    message: String(checkin.message || status.message || "").trim(),
    checkedAt: account.lastCheckinAt || account.lastStatusAt || "",
    pointsDelta,
    balance,
    currency: String(checkin.currency || status.currency || status.plan || "").trim(),
    streak,
    leftDays: leftDays === null || leftDays === undefined ? null : String(leftDays),
    todaySigned: Boolean(
      checkin.already ||
        checkin.todaySigned ||
        status.todaySigned ||
        itemStatus === "already" ||
        itemStatus === "success"
    ),
    notes: account.notes || ""
  };
}

function ensureBotAvatarDir() {
  if (!fs.existsSync(BOT_AVATAR_DIR)) {
    fs.mkdirSync(BOT_AVATAR_DIR, { recursive: true });
  }
}

function ensureSiteIconDir() {
  if (!fs.existsSync(SITE_ICON_DIR)) {
    fs.mkdirSync(SITE_ICON_DIR, { recursive: true });
  }
}

function detectImageExt(buf, contentType = "") {
  if (buf && buf.length >= 8) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
    if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[8] === 0x57) return "webp";
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return "ico";
  }
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("icon")) return "ico";
  return "bin";
}

function isProbablyHtml(buf) {
  if (!buf || buf.length < 12) return false;
  const head = buf.slice(0, 64).toString("utf8").toLowerCase();
  return head.includes("<!doctype") || head.includes("<html") || head.includes("<head");
}

async function fetchBinary(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    if (!response.ok) return null;
    const buf = Buffer.from(await response.arrayBuffer());
    const ct = response.headers.get("content-type") || "";
    if (isProbablyHtml(buf) || ct.includes("text/html")) return null;
    if (buf.length < 64) return null;
    return { buf, contentType: ct };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverIconUrlsFromHtml(origin) {
  const urls = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let html = "";
    try {
      const response = await fetch(`${origin}/`, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" }
      });
      if (!response.ok) return urls;
      html = await response.text();
    } finally {
      clearTimeout(timer);
    }
    const hrefs = [];
    const re = /<link\b[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
      const tag = m[0];
      if (!/rel\s*=\s*["'][^"']*icon/i.test(tag) && !/rel\s*=\s*["']apple-touch-icon/i.test(tag)) {
        continue;
      }
      const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
      if (hrefMatch?.[1]) hrefs.push(hrefMatch[1]);
    }
    const og = html.match(/property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i)
      || html.match(/content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i);
    if (og?.[1]) hrefs.push(og[1]);

    for (const href of hrefs) {
      try {
        urls.push(new URL(href, `${origin}/`).toString());
      } catch {
        // ignore bad href
      }
    }
  } catch {
    // ignore
  }
  return urls;
}

/**
 * Cache website favicon/logo under public/site-icons/{provider}.{ext}
 * Returns public path like `/site-icons/glados.png` or null.
 */
async function ensureSiteIcon(provider, siteBaseUrl) {
  const key = String(provider || "site").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "site";
  ensureSiteIconDir();

  // Fresh cache?
  try {
    const existing = fs.readdirSync(SITE_ICON_DIR).filter((name) => name.startsWith(`${key}.`) && !name.endsWith(".meta.json"));
    for (const name of existing) {
      const filePath = path.join(SITE_ICON_DIR, name);
      const metaPath = path.join(SITE_ICON_DIR, `${key}.meta.json`);
      if (fs.existsSync(filePath) && fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (meta?.fetchedAt && Date.now() - Number(meta.fetchedAt) < SITE_ICON_TTL_MS) {
          return `/site-icons/${name}`;
        }
      } else if (fs.existsSync(filePath)) {
        // stale without meta still usable as fallback
        return `/site-icons/${name}`;
      }
    }
  } catch {
    // refresh below
  }

  const fallbackBase = PROVIDER_DEFAULT_BASE[key] || DEFAULT_GLADOS_BASE_URL;
  let origin;
  try {
    origin = normalizeBaseUrl(siteBaseUrl || fallbackBase, fallbackBase);
  } catch {
    origin = fallbackBase;
  }
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    host = "";
  }

  // Prefer PNG/JPEG sources first (iOS AsyncImage handles these best).
  const candidates = [
    `${origin}/favicon.png`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/apple-touch-icon-precomposed.png`,
    `${origin}/brand/logo.png`,
    `${origin}/logo.png`,
    `${origin}/static/favicon.png`,
    `${origin}/assets/favicon.png`
  ];
  if (host) {
    candidates.push(
      `https://icon.horse/icon/${host}`,
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
      `https://icons.duckduckgo.com/ip3/${host}.ico`
    );
  }
  candidates.push(
    `${origin}/static/favicon.ico`,
    `${origin}/assets/favicon.ico`,
    `${origin}/favicon.ico`
  );

  // HTML-discovered icons first (higher quality logo/png often).
  const fromHtml = await discoverIconUrlsFromHtml(origin);
  const all = [...fromHtml, ...candidates];

  let icoFallback = null;
  for (const url of all) {
    const got = await fetchBinary(url);
    if (!got) continue;
    // Skip tiny placeholder images (e.g. 1x1).
    if (got.buf.length < 200) continue;
    let ext = detectImageExt(got.buf, got.contentType);
    if (ext === "bin") continue;
    // Prefer non-ICO for mobile; remember ICO as last resort.
    if (ext === "ico") {
      if (!icoFallback) icoFallback = { got, url };
      continue;
    }
    const fileName = `${key}.${ext === "jpeg" ? "jpg" : ext}`;
    const filePath = path.join(SITE_ICON_DIR, fileName);
    try {
      for (const name of fs.readdirSync(SITE_ICON_DIR)) {
        if (name.startsWith(`${key}.`) && !name.endsWith(".meta.json")) {
          fs.unlinkSync(path.join(SITE_ICON_DIR, name));
        }
      }
    } catch {
      // ignore
    }
    fs.writeFileSync(filePath, got.buf);
    fs.writeFileSync(
      path.join(SITE_ICON_DIR, `${key}.meta.json`),
      JSON.stringify({ provider: key, origin, source: url, fetchedAt: Date.now() }, null, 2)
    );
    return `/site-icons/${fileName}`;
  }

  if (icoFallback) {
    const fileName = `${key}.ico`;
    const filePath = path.join(SITE_ICON_DIR, fileName);
    try {
      for (const name of fs.readdirSync(SITE_ICON_DIR)) {
        if (name.startsWith(`${key}.`) && !name.endsWith(".meta.json")) {
          fs.unlinkSync(path.join(SITE_ICON_DIR, name));
        }
      }
    } catch {
      // ignore
    }
    fs.writeFileSync(filePath, icoFallback.got.buf);
    fs.writeFileSync(
      path.join(SITE_ICON_DIR, `${key}.meta.json`),
      JSON.stringify({ provider: key, origin, source: icoFallback.url, fetchedAt: Date.now() }, null, 2)
    );
    return `/site-icons/${fileName}`;
  }
  return null;
}

function publicBaseFromRequest(req) {
  const host = String(req?.headers?.host || `${HOST}:${PORT}`).trim();
  const proto = isHttpsRequest(req) ? "https" : "http";
  return `${proto}://${host}`;
}

async function telegramBotApi(method, params = {}) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN not configured");
  }
  return telegramBotApiByToken(TELEGRAM_BOT_TOKEN, method, params);
}

/**
 * Download + cache a Telegram bot profile photo into public/bot-avatars/{username}.jpg
 * Returns public path `/bot-avatars/{username}.jpg` or null.
 */
async function ensureBotAvatar(username) {
  const user = String(username || "").trim().replace(/^@/, "");
  if (!user || !TELEGRAM_BOT_TOKEN) {
    return null;
  }

  ensureBotAvatarDir();
  const safe = user.replace(/[^a-zA-Z0-9_]/g, "_");
  const filePath = path.join(BOT_AVATAR_DIR, `${safe}.jpg`);
  const metaPath = path.join(BOT_AVATAR_DIR, `${safe}.meta.json`);
  const publicPath = `/bot-avatars/${safe}.jpg`;

  try {
    if (fs.existsSync(filePath) && fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta?.fetchedAt && Date.now() - Number(meta.fetchedAt) < BOT_AVATAR_TTL_MS) {
        return publicPath;
      }
    }
  } catch {
    // refresh below
  }

  try {
    const chat = await telegramBotApi("getChat", { chat_id: `@${user}` });
    const fileId = chat?.photo?.big_file_id || chat?.photo?.small_file_id;
    if (!fileId) {
      return fs.existsSync(filePath) ? publicPath : null;
    }
    const file = await telegramBotApi("getFile", { file_id: fileId });
    const filePathRemote = file?.file_path;
    if (!filePathRemote) {
      return fs.existsSync(filePath) ? publicPath : null;
    }
    const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePathRemote}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, 20000));
    try {
      const response = await fetch(downloadUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`download avatar HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            username: user,
            fetchedAt: Date.now(),
            title: chat?.title || chat?.first_name || user
          },
          null,
          2
        )
      );
      return publicPath;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    // Keep stale cache if present.
    if (fs.existsSync(filePath)) {
      return publicPath;
    }
    return null;
  }
}

function accountStatusFromTelegramAcc(acc, bot) {
  if (acc?.skipped) return "skipped";
  if (acc?.already) return "already";
  if (acc?.ok === true) return "success";
  if (acc?.ok === false) return "failed";
  if (bot?.status === "skipped") return "skipped";
  if (bot?.status === "success" || bot?.ok === true) return "success";
  if (bot?.ok === false || bot?.status === "failed" || bot?.status === "error") return "failed";
  return "unknown";
}

function aggregateProjectStatus(statuses) {
  if (!statuses.length) return "unknown";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.every((s) => s === "success" || s === "already")) {
    return statuses.every((s) => s === "already") ? "already" : "success";
  }
  if (statuses.every((s) => s === "skipped")) return "skipped";
  if (statuses.some((s) => s === "skipped") && !statuses.some((s) => s === "failed")) {
    // mixed success + skip → treat as success with skip note
    if (statuses.some((s) => s === "success" || s === "already")) return "success";
    return "skipped";
  }
  if (statuses.some((s) => s === "pending")) return "pending";
  return "unknown";
}

function mapTelegramResultsToSummaryItems(results) {
  const items = [];
  const bots = results && typeof results === "object" ? results.bots || {} : {};
  const updatedAt = results?.updatedAt || "";
  // Honor per-bot targetPhones from form so removed phones disappear from summary.
  const form = readEmbykeeperForm();
  const targetByBot = new Map();
  for (const tpl of form.botTemplates || []) {
    const key = String(tpl.botUsername || "").replace(/^@/, "");
    const phones = Array.isArray(tpl.targetPhones)
      ? tpl.targetPhones.map((p) => String(p || "").trim()).filter(Boolean)
      : [];
    targetByBot.set(key, phones);
  }
  // Only list bots still configured in form (deleted bot tasks stay gone).
  const configuredBots = new Set(targetByBot.keys());

  for (const [botKey, bot] of Object.entries(bots)) {
    if (!bot || typeof bot !== "object") continue;
    const botUsername = String(bot.botUsername || botKey || "").trim().replace(/^@/, "");
    if (configuredBots.size && !configuredBots.has(botUsername)) {
      continue;
    }
    const botName = String(bot.name || botUsername || botKey).trim();
    let accounts = Array.isArray(bot.accounts) ? bot.accounts : [];
    const allowed = targetByBot.get(botUsername) || [];
    if (allowed.length) {
      accounts = accounts.filter((a) => allowed.includes(String(a?.phone || "").trim()));
    }

    if (!accounts.length) {
      // Bot still configured but no account rows after filter — skip empty project.
      if (allowed.length) continue;
      const status = accountStatusFromTelegramAcc(null, bot);
      items.push({
        id: `tg:${botUsername || botKey}`,
        kind: "telegram_bot",
        provider: "telegram_bot",
        providerLabel: providerLabel("telegram_bot"),
        accountName: botUsername ? `@${botUsername}` : botName,
        botName,
        botUsername,
        status,
        ok: status === "success" || status === "already",
        message: String(bot.message || "").trim(),
        checkedAt: bot.checkedAt || updatedAt || "",
        pointsDelta: null,
        balance: null,
        currency: "",
        streak: null,
        leftDays: null,
        todaySigned: status === "success" || status === "already",
        notes: "",
        phone: ""
      });
      continue;
    }

    for (const acc of accounts) {
      const status = accountStatusFromTelegramAcc(acc, bot);
      const phone = String(acc?.phone || "").trim();
      items.push({
        id: `tg:${botUsername || botKey}:${phone || "default"}`,
        kind: "telegram_bot",
        provider: "telegram_bot",
        providerLabel: providerLabel("telegram_bot"),
        accountName: phone || (botUsername ? `@${botUsername}` : botName),
        botName,
        botUsername,
        status,
        ok: status === "success" || status === "already",
        message: String(acc?.message || bot.message || "").trim(),
        checkedAt: acc?.checkedAt || bot.checkedAt || updatedAt || "",
        pointsDelta: null,
        balance: null,
        currency: "",
        streak: null,
        leftDays: null,
        todaySigned: status === "success" || status === "already",
        notes: "",
        phone
      });
    }
  }

  return items;
}

/**
 * Merge same check-in project across accounts:
 * - website: one project per provider (GLaDOS / EmbyMB / …)
 * - telegram: one project per botUsername (accounts nested)
 */
async function buildSummaryProjects(websiteItems, telegramItems, req) {
  const projects = [];
  const base = publicBaseFromRequest(req);

  // Website: group by provider + site icon (favicon/logo)
  const webByProvider = new Map();
  for (const item of websiteItems) {
    const key = item.provider || "unknown";
    if (!webByProvider.has(key)) webByProvider.set(key, []);
    webByProvider.get(key).push(item);
  }

  // Prefer real baseUrl from stored accounts (icons come from the site itself).
  const baseUrlByProvider = new Map();
  for (const account of readAccounts()) {
    const p = String(account.provider || "glados").trim().toLowerCase() || "glados";
    const bu = String(account.baseUrl || "").trim();
    if (bu && !baseUrlByProvider.has(p)) {
      baseUrlByProvider.set(p, bu);
    }
  }

  const webProjects = await Promise.all(Array.from(webByProvider.entries()).map(async ([provider, accounts]) => {
    const statuses = accounts.map((a) => a.status);
    const status = aggregateProjectStatus(statuses);
    const counts = emptyStatusCounts();
    for (const s of statuses) {
      const k = counts[s] === undefined ? "unknown" : s;
      counts[k] += 1;
    }
    let checkedAt = "";
    for (const a of accounts) {
      if (a.checkedAt && (!checkedAt || a.checkedAt > checkedAt)) checkedAt = a.checkedAt;
    }
    const healthy = counts.success + counts.already;
    const siteBase = baseUrlByProvider.get(provider) || PROVIDER_DEFAULT_BASE[provider] || "";
    const iconPath = await ensureSiteIcon(provider, siteBase);
    const avatarURL = iconPath ? `${base}${iconPath}` : null;
    return {
      id: `web:${provider}`,
      kind: provider === "workbuddy" ? "workbuddy" : "website",
      provider,
      providerLabel: providerLabel(provider),
      title: providerLabel(provider),
      subtitle: `${accounts.length} 个账号`,
      botUsername: null,
      botName: null,
      avatarURL,
      status,
      ok: status === "success" || status === "already",
      message: `${accounts.length} 账号 · ${healthy} 正常 · ${counts.failed} 失败`,
      checkedAt,
      accountCount: accounts.length,
      counts: {
        total: accounts.length,
        ...counts,
        healthy
      },
      accounts
    };
  }));
  projects.push(...webProjects);

  // Telegram: group by botUsername
  const tgByBot = new Map();
  for (const item of telegramItems) {
    const key = String(item.botUsername || item.id || "unknown").replace(/^@/, "");
    if (!tgByBot.has(key)) tgByBot.set(key, []);
    tgByBot.get(key).push(item);
  }

  // Fetch avatars with limited concurrency
  const botKeys = Array.from(tgByBot.keys());
  const avatarMap = new Map();
  const chunk = 4;
  for (let i = 0; i < botKeys.length; i += chunk) {
    const slice = botKeys.slice(i, i + chunk);
    const results = await Promise.all(
      slice.map(async (username) => {
        const pathOnly = await ensureBotAvatar(username);
        return [username, pathOnly];
      })
    );
    for (const [username, pathOnly] of results) {
      avatarMap.set(username, pathOnly ? `${base}${pathOnly}` : null);
    }
  }

  for (const [botUsername, accounts] of tgByBot.entries()) {
    const botName = accounts[0]?.botName || botUsername;
    const statuses = accounts.map((a) => a.status);
    const status = aggregateProjectStatus(statuses);
    const counts = emptyStatusCounts();
    for (const s of statuses) {
      const k = counts[s] === undefined ? "unknown" : s;
      counts[k] += 1;
    }
    let checkedAt = "";
    for (const a of accounts) {
      if (a.checkedAt && (!checkedAt || a.checkedAt > checkedAt)) checkedAt = a.checkedAt;
    }
    const healthy = counts.success + counts.already;
    // Normalize nested account display names to phone / short label
    const nested = accounts.map((a) => ({
      ...a,
      accountName: a.phone || a.accountName || "账号"
    }));
    projects.push({
      id: `tg:${botUsername}`,
      kind: "telegram_bot",
      provider: "telegram_bot",
      providerLabel: providerLabel("telegram_bot"),
      title: botName,
      subtitle: botUsername ? `@${botUsername}` : providerLabel("telegram_bot"),
      botUsername,
      botName,
      avatarURL: avatarMap.get(botUsername) || null,
      status,
      ok: status === "success" || status === "already",
      message: `${accounts.length} 账号 · ${healthy} 正常 · ${counts.failed} 失败 · ${counts.skipped} 跳过`,
      checkedAt,
      accountCount: accounts.length,
      counts: {
        total: accounts.length,
        ...counts,
        healthy
      },
      accounts: nested
    });
  }

  return applyProjectNames(projects);
}

async function buildMobileSummary(req) {
  const websiteItems = readAccounts().map((account) =>
    mapWebsiteAccountToSummaryItem(toPublicAccount(account))
  );
  const telegramResults = readTelegramCheckinResults();
  const telegramItems = mapTelegramResultsToSummaryItems(telegramResults);
  const items = [...websiteItems, ...telegramItems];
  const projects = await buildSummaryProjects(websiteItems, telegramItems, req);

  // Also stamp avatarURL onto flat telegram items for clients that still use items[]
  const avatarByBot = new Map(
    projects
      .filter((p) => p.kind === "telegram_bot")
      .map((p) => [p.botUsername, p.avatarURL])
  );
  for (const item of items) {
    if (item.kind === "telegram_bot" && item.botUsername) {
      item.avatarURL = avatarByBot.get(item.botUsername) || null;
    } else {
      item.avatarURL = null;
    }
  }

  const counts = emptyStatusCounts();
  for (const item of items) {
    const key = counts[item.status] === undefined ? "unknown" : item.status;
    counts[key] += 1;
  }

  // Provider summary from projects (merged)
  const providerMap = new Map();
  for (const project of projects) {
    const key = project.provider || "unknown";
    if (!providerMap.has(key)) {
      providerMap.set(key, {
        key,
        label: project.providerLabel || providerLabel(key),
        counts: emptyStatusCounts(),
        itemCount: 0,
        projectCount: 0,
        lastCheckedAt: ""
      });
    }
    const group = providerMap.get(key);
    group.projectCount += 1;
    group.itemCount += project.accountCount || project.accounts?.length || 0;
    for (const [sk, sv] of Object.entries(project.counts || {})) {
      if (group.counts[sk] !== undefined && typeof sv === "number") {
        group.counts[sk] += sv;
      }
    }
    if (project.checkedAt && (!group.lastCheckedAt || project.checkedAt > group.lastCheckedAt)) {
      group.lastCheckedAt = project.checkedAt;
    }
  }

  let embykeeperStatus = null;
  try {
    embykeeperStatus = getEmbykeeperStatus();
  } catch {
    embykeeperStatus = null;
  }

  return {
    ok: true,
    generatedAt: formatDateTime(),
    source: "glados-checkin-web",
    auth: {
      appTokenConfigured: Boolean(APP_API_TOKEN)
    },
    counts: {
      total: items.length,
      projectTotal: projects.length,
      ...counts,
      healthy: counts.success + counts.already
    },
    providers: Array.from(providerMap.values()),
    /** Merged check-in projects (preferred for mobile UI). */
    projects,
    /** Flat account-level items (compat). */
    items,
    telegram: {
      updatedAt: telegramResults?.updatedAt || null,
      botCount: telegramResults?.bots ? Object.keys(telegramResults.bots).length : 0
    },
    embykeeper: embykeeperStatus
      ? {
          installed: Boolean(embykeeperStatus.installed),
          configPresent: Boolean(embykeeperStatus.configExists || embykeeperStatus.configPresent),
          sessionFiles: Array.isArray(embykeeperStatus.sessionFiles)
            ? embykeeperStatus.sessionFiles.length
            : Number(embykeeperStatus.sessionFiles) || 0,
          sessionStringCount: Number(embykeeperStatus.sessionStringCount) || 0
        }
      : null
  };
}
function findAccountOrNull(accounts, id) {
  return accounts.find((item) => item.id === id) || null;
}

async function runBatch(accounts, ids, worker) {
  const idSet = ids?.length ? new Set(ids) : null;
  const selected = idSet ? accounts.filter((item) => idSet.has(item.id)) : accounts.slice();

  if (!selected.length) {
    return {
      accounts,
      results: []
    };
  }

  const concurrency = Math.max(1, Number(process.env.CHECKIN_CONCURRENCY || 4));
  const processedList = await runConcurrent(selected, account => {
    if (account.provider !== "workbuddy") return worker(account);
    const job = workbuddyJobs.launch(account.id, worker === refreshAccountStatus ? "status" : "auto");
    return { account, summary: { id: account.id, name: account.name, queued: true, job,
      checkin: { ok: false, message: "WorkBuddy 已转入后台执行，请查看任务结果" } } };
  }, concurrency);
  const updatedById = new Map();
  const results = [];

  for (const processed of processedList) {
    if (processed.account.provider !== "workbuddy") updatedById.set(processed.account.id, processed.account);
    results.push(processed.summary);
  }

  const nextAccounts = readAccounts().map((item) => updatedById.get(item.id) || item);
  return {
    accounts: nextAccounts,
    results
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
      ...(includeSecrets ? { cookie: account.cookie || "", password: account.password || "" } : {}),
      username: account.username || "",
      insecureTls: Boolean(account.insecureTls),
      notes: account.notes || ""
    }))
  };
}

const { createAccount, updateAccount, deleteAccount } = require("./http/account-handlers").createAccountHandlers({
  readAccounts, writeAccounts, normalizeAccountInput, normalizeAccountMobileUpdate, validateAccount
});
const handleApi = require("./http/router").createRouter({ createAccount, updateAccount, deleteAccount, requireAuth, requireAppOrSessionAuth, formatDateTime, HOST, PORT, ADMIN_USER, isAuthenticated, setAuthCookies, clearAuthCookies, checkLogin, sendJson, readRequestBody, workbuddyJobs, readAccounts, writeAccounts, runAccountCheckin, toMobileAccountDetail, normalizeAccountMobileUpdate, normalizeAccountInput, validateAccount, findAccountOrNull, runBatch, embyKeepalive, writeProviderAccounts, APP_API_TOKEN, isAppTokenAuthorized, PROVIDER_DEFAULT_BASE, providerLabel, setProjectName, applyProjectNames, readEmbykeeperForm, deleteMobileTelegramBot, buildMobileSummary, PROJECT_ROOT, fs, path, listMobileTelegramBots, persistEmbykeeperForm, updateMobileTelegramBot, deleteMobileTelegramPhone, removePhoneFromTelegramBot, workbuddyLogin, readProviderAccounts, toPublicAccount, DATA_DIR, refreshAccountStatus, audit, toPublicAccountDetail, getExportData, config, readEmbykeeperConfig, writeEmbykeeperConfig, normalizeEmbykeeperForm, readTelegramCheckinResults, writeEmbykeeperForm, renderEmbykeeperConfigFromForm, getEmbykeeperStatus, runEmbykeeperOnce });

function createServer() {
  readConfig();
  return http.createServer(async (req, res) => {
  const started = performance.now();
  const suppliedId = String(req.headers["x-request-id"] || "");
  const reqId = /^[a-zA-Z0-9_-]{1,64}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
  res.setHeader("X-Request-Id", reqId);
  res.on("finish", () => {
    log("info", "http.request", { reqId, method: req.method, status: res.statusCode, durationMs: Math.round(performance.now() - started) });
  });
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && url.pathname !== "/api/login") {
        const actor = isAuthenticated(req) ? ADMIN_USER : isAppTokenAuthorized(req) ? "api-token" : "anonymous";
        // Use route templates so phone numbers and OAuth state IDs never reach the audit file.
        const targetId = url.pathname.replace(/\/[+\d][^/]*|\/[a-f0-9]{32,}/g, "/:id");
        res.once("finish", () => audit(path.join(DATA_DIR, "audit.log.jsonl"), { actor, ip: req.socket.remoteAddress || "unknown", action: req.method, targetId, ok: res.statusCode < 400 }));
      }
      await handleApi(req, res, url);
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
      res.writeHead(302, { Location: "/dashboard/", "Cache-Control": "no-store" });
      res.end();
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") &&
        /^\/dashboard\/(?:index\.html|dashboard-runtime\.js|workbuddy-ui\.js|dashboard-patches\.css|emby-keepalive\.js|reference-\d+\.css)?$/.test(url.pathname)) {
      if (url.pathname === "/dashboard/") url.pathname += "index.html";
      serveStatic(req, res, url);
      return;
    }

    // Public icons for mobile clients (AsyncImage) — TG bot photos + website favicons/logos.
    if (
      (url.pathname.startsWith("/bot-avatars/") || url.pathname.startsWith("/site-icons/")) &&
      (req.method === "GET" || req.method === "HEAD")
    ) {
      serveStatic(req, res, url);
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.status ? error.message : "服务器内部错误", code: error.code || "INTERNAL_ERROR" });
  }
});

}
function start() {
  const server = createServer();
  server.listen(PORT, HOST, () => { ensureDataFiles(); log("info", "server.listening"); });
  return server;
}
module.exports = { createServer, start, runAccountCheckin, refreshAccountStatus, readAccounts, writeAccounts };
