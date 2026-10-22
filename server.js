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
} = require("./lib/common");

loadLocalEnv();
const embyKeepalive = require("./lib/emby-keepalive");

const {
  readAccounts,
  writeAccounts,
  writeProviderAccounts,
  ensureDataFiles: ensureAccountDataFiles
} = require("./lib/accounts");
const { refreshAccountStatus, runAccountCheckin } = require("./lib/providers");
const { telegramBotApiByToken } = require("./lib/telegram");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 22821);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const DEFAULT_GLADOS_BASE_URL = "https://glados.network";
const DEFAULT_EMBYPULSE_BASE_URL =
  process.env.DEFAULT_EMBYPULSE_BASE_URL || "https://embypulse.example.com";
const DEFAULT_EMBYMB_BASE_URL =
  process.env.DEFAULT_EMBYMB_BASE_URL || "https://embymb.ichinosekotomi.com";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "change-this-password";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";
/** Mobile / App API token (Bearer or X-API-Key). Empty = token auth disabled (cookie session still works). */
const APP_API_TOKEN = String(process.env.APP_API_TOKEN || process.env.CHECKIN_API_TOKEN || "").trim();

const EMBYKEEPER_DIR = path.join(DATA_DIR, "embykeeper");
const EMBYKEEPER_CONFIG_FILE = path.join(EMBYKEEPER_DIR, "config.toml");
const EMBYKEEPER_FORM_FILE = path.join(EMBYKEEPER_DIR, "form.json");
const EMBYKEEPER_RUNTIME_DIR = path.join(EMBYKEEPER_DIR, "runtime");
const TELEGRAM_CHECKIN_RESULTS_FILE = path.join(DATA_DIR, "telegram_bot_checkin_results.json");
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const EMBYKEEPER_VENV_DIR = path.join(__dirname, ".venv-embykeeper");
const EMBYKEEPER_BIN = path.join(EMBYKEEPER_VENV_DIR, "bin", "python");
const EMBYKEEPER_RUNNER = path.join(__dirname, "scripts", "embykeeper_run_once.sh");
const CUSTOM_TG_WORKER = path.join(__dirname, "scripts", "telegram_bot_checkin.py");
const PUBLIC_DIR = path.join(__dirname, "public");
const PROJECT_NAMES_FILE = path.join(DATA_DIR, "project_names.json");
const BOT_AVATAR_DIR = path.join(PUBLIC_DIR, "bot-avatars");
const SITE_ICON_DIR = path.join(PUBLIC_DIR, "site-icons");
const BOT_AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_ICON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_VPSNAT_BASE_URL = process.env.DEFAULT_VPSNAT_BASE_URL || "https://www.vpsnat.com";
const PROVIDER_DEFAULT_BASE = {
  zzcat: "https://user.090911.xyz",
  vpsnat: DEFAULT_VPSNAT_BASE_URL,
  glados: DEFAULT_GLADOS_BASE_URL,
  embypulse: DEFAULT_EMBYPULSE_BASE_URL,
  embymb: DEFAULT_EMBYMB_BASE_URL
};
const PROVIDER_LABELS = {
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

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
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
  return ["embypulse", "embymb", "vpsnat"].includes(provider);
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
    phone: String(item?.phone || "").trim(),
    apiId: String(item?.apiId || item?.api_id || "").trim(),
    apiHash: String(item?.apiHash || item?.api_hash || "").trim(),
    session: String(item?.session || "").trim(),
    enabled: item?.enabled !== false,
    checkiner: item?.checkiner !== false
  })).filter((item) => item.phone);

  const botTemplatesRaw = Array.isArray(source.botTemplates) ? source.botTemplates : defaults.botTemplates;
  const botTemplates = botTemplatesRaw.map((item) => ({
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
    telegramAccounts: telegramAccounts.length ? telegramAccounts : defaults.telegramAccounts,
    botTemplates,
    globalCheckiner: {
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
      cwd: __dirname,
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

function toPublicAccount(account) {
  const provider = String(account.provider || "glados").trim().toLowerCase() || "glados";
  return {
    id: account.id,
    provider,
    providerLabel: providerLabel(provider),
    name: account.name,
    baseUrl: account.baseUrl,
    notes: account.notes || "",
    createdAt: account.createdAt || "",
    updatedAt: account.updatedAt || "",
    authPreview: isPasswordProvider(provider)
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
    cookie: account.cookie || "",
    username: account.username || "",
    password: account.password || "",
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
  const form = JSON.parse(fs.readFileSync(EMBYKEEPER_FORM_FILE, "utf8"));
  const key = String(botUsername).replace(/^@/, "").toLowerCase();
  const before = (form.botTemplates || []).length;
  form.botTemplates = (form.botTemplates || []).filter(
    (b) => String(b.botUsername || "").replace(/^@/, "").toLowerCase() !== key
  );
  if (form.botTemplates.length === before) {
    return { ok: false, error: "Bot 不存在" };
  }
  const config = renderEmbykeeperConfigFromForm(normalizeEmbykeeperForm(form));
  writeEmbykeeperForm(form);
  writeEmbykeeperConfig(config);

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
  const baseFallback = provider === "zzcat" ? PROVIDER_DEFAULT_BASE.zzcat : provider === "vpsnat" ? DEFAULT_VPSNAT_BASE_URL : provider === "embypulse"
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

  try {
    new URL(account.baseUrl);
  } catch (error) {
    return "站点地址格式不正确";
  }

  return "";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(message);
}
function signSession(username) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(username).digest("hex");
}

function isHttpsRequest(req) {
  return req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies.glados_user === ADMIN_USER && cookies.glados_token === signSession(ADMIN_USER);
}

function authCookieParts(req, maxAge) {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (isHttpsRequest(req)) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function setAuthCookies(req, res) {
  const cookieParts = authCookieParts(req, 60 * 60 * 24 * 30);
  res.setHeader("Set-Cookie", [
    `glados_user=${encodeURIComponent(ADMIN_USER)}; ${cookieParts}`,
    `glados_token=${signSession(ADMIN_USER)}; ${cookieParts}`
  ]);
}

function clearAuthCookies(req, res) {
  const cookieParts = authCookieParts(req, 0);
  res.setHeader("Set-Cookie", [
    `glados_user=; ${cookieParts}`,
    `glados_token=; ${cookieParts}`
  ]);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 3 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });

    req.on("error", reject);
  });
}

function serveStatic(req, res, url) {
  const pathname = url.pathname;
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
  });
  fs.createReadStream(filePath).pipe(res);
}

function requireAuth(req, res, url) {
  if (isAuthenticated(req)) {
    return true;
  }

  sendJson(res, 401, { error: "Unauthorized" });
  return false;
}

function extractAppToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  const bearer = /^Bearer\s+(\S+)/i.exec(auth);
  if (bearer) {
    return bearer[1].trim();
  }
  return String(req.headers["x-api-key"] || "").trim();
}

function safeEqualString(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (!left.length || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function isAppTokenAuthorized(req) {
  if (!APP_API_TOKEN) {
    return false;
  }
  return safeEqualString(extractAppToken(req), APP_API_TOKEN);
}

/** Cookie session (web panel) or Bearer / X-API-Key (mobile app). */
function requireAppOrSessionAuth(req, res) {
  if (isAuthenticated(req) || isAppTokenAuthorized(req)) {
    return true;
  }
  sendJson(res, 401, {
    error: "Unauthorized",
    hint: APP_API_TOKEN
      ? "Provide Authorization: Bearer <APP_API_TOKEN> or X-API-Key"
      : "APP_API_TOKEN is not configured; use web session login"
  });
  return false;
}

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
    kind: "website",
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
      kind: "website",
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
  const processedList = await runConcurrent(selected, worker, concurrency);
  const updatedById = new Map();
  const results = [];

  for (const processed of processedList) {
    updatedById.set(processed.account.id, processed.account);
    results.push(processed.summary);
  }

  const nextAccounts = accounts.map((item) => updatedById.get(item.id) || item);
  return {
    accounts: nextAccounts,
    results
  };
}

function getExportData(accounts) {
  return {
    exportedAt: formatDateTime(),
    accounts: accounts.map((account) => ({
      id: account.id,
      provider: account.provider || "glados",
      name: account.name,
      baseUrl: account.baseUrl,
      cookie: account.cookie,
      username: account.username || "",
      password: account.password || "",
      insecureTls: Boolean(account.insecureTls),
      notes: account.notes || ""
    }))
  };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || "GET";

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, host: HOST, port: PORT, now: formatDateTime() });
    return;
  }

  if (method === "POST" && pathname === "/api/login") {
    const body = await readRequestBody(req);
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      sendJson(res, 401, { error: "用户名或密码错误" });
      return;
    }

    setAuthCookies(req, res);
    sendJson(res, 200, { ok: true, username: ADMIN_USER });
    return;
  }

  if (method === "POST" && pathname === "/api/logout") {
    clearAuthCookies(req, res);
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/api/session") {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    sendJson(res, 200, { ok: true, username: ADMIN_USER });
    return;
  }

  // Mobile / PersonalToolbox read API — Bearer APP_API_TOKEN or web session cookie.
  if (pathname.startsWith("/api/v1/")) {
    if (!requireAppOrSessionAuth(req, res)) {
      return;
    }

    if (pathname === "/api/v1/emby/keepalive" || pathname.startsWith("/api/v1/emby/keepalive/")) {
      try {
        if (method === "GET" && pathname === "/api/v1/emby/keepalive") {
          sendJson(res, 200, { accounts: embyKeepalive.list(), generatedAt: new Date().toISOString() });
          return;
        }
        if (method === "POST" && pathname === "/api/v1/emby/keepalive") {
          sendJson(res, 201, { account: embyKeepalive.create(await readRequestBody(req)) });
          return;
        }
        const match = pathname.match(/^\/api\/v1\/emby\/keepalive\/([a-zA-Z0-9_-]+)(?:\/(run|test))?$/);
        if (match) {
          const [,id,action] = match;
          if (method === "POST" && action === "run") { sendJson(res,202,embyKeepalive.launch(id)); return; }
          if (method === "POST" && action === "test") { sendJson(res,200,await embyKeepalive.test(id)); return; }
          if (method === "PUT" && !action) { sendJson(res,200,{ account:embyKeepalive.edit(id,await readRequestBody(req)) }); return; }
          if (method === "DELETE" && !action) { embyKeepalive.remove(id); sendJson(res,200,{ok:true}); return; }
        }
        sendJson(res,404,{error:"Not Found"});
      } catch(error) { sendJson(res,error.status || 400,{error:error.message || "Emby 保活操作失败"}); }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/summary") {
      sendJson(res, 200, await buildMobileSummary(req));
      return;
    }

    if (method === "GET" && pathname === "/api/v1/telegram/catalog") {
      const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "templates/telegram_bot_catalog.json"), "utf8"));
      const existing = new Set(readEmbykeeperForm().botTemplates.map(b => b.botUsername.replace(/^@/, "").toLowerCase()));
      sendJson(res, 200, { ...catalog, bots: catalog.bots.map(b => ({ ...b, configured: existing.has(b.botUsername.toLowerCase()) })) });
      return;
    }

    if (method === "POST" && pathname === "/api/v1/telegram/catalog") {
      const body = await readRequestBody(req);
      const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "templates/telegram_bot_catalog.json"), "utf8"));
      const profile = catalog.bots.find(b => b.id === body.id);
      if (!profile || !profile.available) {
        sendJson(res, 400, { error: "此 Bot 需要专用流程，目前尚未独立适配" });
        return;
      }
      const form = JSON.parse(fs.readFileSync(EMBYKEEPER_FORM_FILE, "utf8"));
      if (form.botTemplates.some(b => b.botUsername.replace(/^@/, "").toLowerCase() === profile.botUsername.toLowerCase())) {
        sendJson(res, 409, { error: "该机器人已添加" });
        return;
      }
      const { id, available, upstreamDefault, reason, ...bot } = profile;
      form.botTemplates.push({ ...bot, targetPhones: [] });
      writeEmbykeeperForm(form);
      sendJson(res, 201, { ok: true, botUsername: bot.botUsername });
      return;
    }

    if (method === "GET" && pathname === "/api/v1/dashboard") {
      const summary = await buildMobileSummary(req);
      // Keep dashboard aggregates explicit when only some accounts completed.
      for (const project of summary.projects) {
        const statuses = (project.accounts || []).map(a => a.status);
        if (statuses.includes("skipped") && statuses.some(s => s === "success" || s === "already") && !statuses.includes("failed")) {
          project.status = "partial";
        }
        if (project.status === "pending") project.status = "unknown";
      }
      const form = readEmbykeeperForm();
      const configuredBots = new Set((form.botTemplates || []).map(b => String(b.botUsername || "").replace(/^@/, "").toLowerCase()));
      // A worker already in flight can finish after deletion; hide orphaned results.
      summary.projects = summary.projects.filter(p => p.kind !== "telegram_bot" || configuredBots.has(String(p.botUsername || "").toLowerCase()));
      const existing = new Set(summary.projects.filter(p => p.botUsername).map(p => p.botUsername.toLowerCase()));
      for (const bot of form.botTemplates || []) {
        const username = String(bot.botUsername || "").replace(/^@/, "").trim();
        if (!username || existing.has(username.toLowerCase())) continue;
        existing.add(username.toLowerCase());
        const targets = bot.targetPhones || bot.target_phones || [];
        const accounts = (form.telegramAccounts || [])
          .filter(a => a.enabled !== false && a.checkiner !== false && (!targets.length || targets.includes(a.phone)))
          .map(a => ({ accountName: a.phone, phone: a.phone, status: "unknown", checkedAt: "", message: "暂无签到记录" }));
        summary.projects.push({ id: `tg:${username}`, kind: "telegram_bot", title: bot.name || username,
          subtitle: `@${username}`, botUsername: username, status: "unknown", accountCount: accounts.length,
          checkedAt: "", accounts });
      }
      sendJson(res, 200, { projects: applyProjectNames(summary.projects), generatedAt: new Date().toISOString() });
      return;
    }

    const dashboardProjectMatch = pathname.match(/^\/api\/v1\/dashboard\/projects\/([^/]+)$/);
    if (method === "PATCH" && dashboardProjectMatch) {
      const projectId = decodeURIComponent(dashboardProjectMatch[1]);
      const body = await readRequestBody(req);
      if (typeof body.name !== "string" || [...body.name.trim()].length > 60 || /[\x00-\x1f\x7f]/.test(body.name)) {
        sendJson(res, 400, { error: "名称须为不超过 60 字的单行文本，留空恢复默认" });
        return;
      }
      let defaultTitle;
      if (projectId.startsWith("web:")) {
        const provider = projectId.slice(4);
        if (Object.hasOwn(PROVIDER_DEFAULT_BASE, provider) && readAccounts().some(a => a.provider === provider)) defaultTitle = providerLabel(provider);
      } else if (projectId.startsWith("tg:")) {
        const bot = readEmbykeeperForm().botTemplates.find(b => String(b.botUsername || "").replace(/^@/, "").toLowerCase() === projectId.slice(3).toLowerCase());
        if (bot) defaultTitle = bot.name || bot.botUsername;
      }
      if (!defaultTitle) {
        sendJson(res, 404, { error: "项目不存在" });
        return;
      }
      const name = body.name.trim();
      setProjectName(projectId, name);
      sendJson(res, 200, { ok: true, id: projectId, title: name || defaultTitle, defaultTitle });
      return;
    }
    if (method === "DELETE" && dashboardProjectMatch) {
      const projectId = decodeURIComponent(dashboardProjectMatch[1]);
      if (projectId.startsWith("tg:")) {
        const result = deleteMobileTelegramBot(projectId.slice(3));
        sendJson(res, result.ok ? 200 : 404, result);
      } else if (projectId.startsWith("web:")) {
        const provider = projectId.slice(4);
        if (!Object.hasOwn(PROVIDER_DEFAULT_BASE, provider) || !readAccounts().some(a => a.provider === provider)) {
          sendJson(res, 404, { error: "项目不存在" });
          return;
        }
        writeProviderAccounts(provider, []);
        setProjectName(projectId, "");
        sendJson(res, 200, { ok: true, deletedId: projectId });
      } else {
        sendJson(res, 404, { error: "项目不存在" });
      }
      return;
    }

    if (method === "GET" && pathname === "/api/v1/health") {
      sendJson(res, 200, {
        ok: true,
        now: formatDateTime(),
        appTokenConfigured: Boolean(APP_API_TOKEN),
        auth: isAppTokenAuthorized(req) ? "token" : "session"
      });
      return;
    }

    // --- Mobile account management (website check-in tasks) ---
    if (method === "GET" && pathname === "/api/v1/accounts") {
      sendJson(res, 200, {
        accounts: readAccounts().map((a) => toMobileAccountDetail(a))
      });
      return;
    }

    if (method === "POST" && pathname === "/api/v1/accounts") {
      const body = await readRequestBody(req);
      const nextAccount = normalizeAccountInput(body);
      const error = validateAccount(nextAccount);
      if (error) {
        sendJson(res, 400, { error });
        return;
      }
      const accounts = readAccounts();
      accounts.unshift(nextAccount);
      writeAccounts(accounts);
      sendJson(res, 201, { account: toMobileAccountDetail(nextAccount) });
      return;
    }

    const v1AccountMatch = pathname.match(/^\/api\/v1\/accounts\/([^/]+)$/);
    if (v1AccountMatch) {
      const accountId = decodeURIComponent(v1AccountMatch[1]);
      const accounts = readAccounts();
      const account = findAccountOrNull(accounts, accountId);
      if (!account) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }

      if (method === "GET") {
        sendJson(res, 200, { account: toMobileAccountDetail(account) });
        return;
      }

      if (method === "PUT") {
        const body = await readRequestBody(req);
        const nextAccount = normalizeAccountMobileUpdate(body, account);
        const error = validateAccount(nextAccount);
        if (error) {
          sendJson(res, 400, { error });
          return;
        }
        const nextAccounts = accounts.map((item) => (item.id === accountId ? nextAccount : item));
        writeAccounts(nextAccounts);
        sendJson(res, 200, { account: toMobileAccountDetail(nextAccount) });
        return;
      }

      if (method === "DELETE") {
        const nextAccounts = accounts.filter((item) => item.id !== accountId);
        writeAccounts(nextAccounts);
        sendJson(res, 200, { ok: true, deletedId: accountId });
        return;
      }
    }

    // --- Mobile Telegram bot / phone management (embykeeper form) ---
    if (method === "GET" && pathname === "/api/v1/telegram/bots") {
      sendJson(res, 200, listMobileTelegramBots());
      return;
    }

    const v1TgBotMatch = pathname.match(/^\/api\/v1\/telegram\/bots\/([^/]+)$/);
    if (v1TgBotMatch) {
      const botUsername = decodeURIComponent(v1TgBotMatch[1]).replace(/^@/, "");
      if (method === "PUT") {
        const body = await readRequestBody(req);
        const result = updateMobileTelegramBot(botUsername, body || {});
        if (!result.ok) {
          sendJson(res, 404, { error: result.error });
          return;
        }
        sendJson(res, 200, result);
        return;
      }
      if (method === "DELETE") {
        const result = deleteMobileTelegramBot(botUsername);
        if (!result.ok) {
          sendJson(res, 404, { error: result.error });
          return;
        }
        sendJson(res, 200, result);
        return;
      }
    }

    const v1TgPhoneMatch = pathname.match(/^\/api\/v1\/telegram\/phones\/([^/]+)$/);
    if (v1TgPhoneMatch && method === "DELETE") {
      const phone = decodeURIComponent(v1TgPhoneMatch[1]);
      const result = deleteMobileTelegramPhone(phone);
      if (!result.ok) {
        sendJson(res, 404, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    // DELETE one phone from one bot only (multi-account project).
    const v1TgBotPhoneMatch = pathname.match(
      /^\/api\/v1\/telegram\/bots\/([^/]+)\/phones\/([^/]+)$/
    );
    if (v1TgBotPhoneMatch && method === "DELETE") {
      const botUsername = decodeURIComponent(v1TgBotPhoneMatch[1]).replace(/^@/, "");
      const phone = decodeURIComponent(v1TgBotPhoneMatch[2]);
      const result = removePhoneFromTelegramBot(botUsername, phone);
      if (!result.ok) {
        sendJson(res, 404, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    // Mobile: run check-in for one website account.
    const v1CheckinMatch = pathname.match(/^\/api\/v1\/accounts\/([^/]+)\/checkin$/);
    if (v1CheckinMatch && method === "POST") {
      const accountId = decodeURIComponent(v1CheckinMatch[1]);
      const accounts = readAccounts();
      const account = findAccountOrNull(accounts, accountId);
      if (!account) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }
      const processed = await runAccountCheckin(account);
      const nextAccounts = accounts.map((item) => (item.id === accountId ? processed.account : item));
      writeAccounts(nextAccounts);
      sendJson(res, 200, {
        ok: Boolean(processed.summary?.checkin?.ok ?? processed.account?.lastCheckin?.ok),
        result: processed.summary,
        account: toMobileAccountDetail(processed.account)
      });
      return;
    }

    // Mobile: run check-in for all accounts of a website provider (e.g. glados).
    if (method === "POST" && pathname === "/api/v1/checkin/run") {
      const body = await readRequestBody(req);
      const provider = String(body?.provider || "").trim().toLowerCase();
      const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
      let accounts = readAccounts();
      let selected = accounts;
      if (ids.length) {
        const set = new Set(ids);
        selected = accounts.filter((a) => set.has(a.id));
      } else if (provider) {
        selected = accounts.filter((a) => (a.provider || "glados") === provider);
      }
      if (!selected.length) {
        sendJson(res, 400, { error: "没有可签到的账号" });
        return;
      }
      const processed = await runBatch(accounts, selected.map((item) => item.id), runAccountCheckin);
      accounts = processed.accounts;
      const results = processed.results.map((summary) => ({
        id: summary.id,
        name: summary.name,
        ok: Boolean(summary?.checkin?.ok),
        message: summary?.checkin?.message || ""
      }));
      writeAccounts(accounts);
      sendJson(res, 200, {
        ok: results.every((r) => r.ok),
        results,
        successCount: results.filter((r) => r.ok).length,
        total: results.length
      });
      return;
    }

    sendJson(res, 404, { error: "Not Found", path: pathname });
    return;
  }

  if (!requireAuth(req, res, url)) {
    return;
  }

  if (method === "GET" && pathname === "/api/embykeeper/status") {
    sendJson(res, 200, { status: getEmbykeeperStatus() });
    return;
  }

  if (method === "GET" && pathname === "/api/embykeeper/config") {
    sendJson(res, 200, {
      status: getEmbykeeperStatus(),
      config: readEmbykeeperConfig()
    });
    return;
  }

  if (method === "GET" && pathname === "/api/embykeeper/form") {
    sendJson(res, 200, {
      status: getEmbykeeperStatus(),
      form: readEmbykeeperForm(),
      checkinResults: readTelegramCheckinResults()
    });
    return;
  }

  if (method === "PUT" && pathname === "/api/embykeeper/config") {
    const body = await readRequestBody(req);
    writeEmbykeeperConfig(body?.config ?? "");
    sendJson(res, 200, {
      ok: true,
      status: getEmbykeeperStatus()
    });
    return;
  }

  if (method === "PUT" && pathname === "/api/embykeeper/form") {
    const body = await readRequestBody(req);
    const form = normalizeEmbykeeperForm(body?.form || {});
    writeEmbykeeperForm(form);
    writeEmbykeeperConfig(renderEmbykeeperConfigFromForm(form));
    sendJson(res, 200, {
      ok: true,
      status: getEmbykeeperStatus(),
      form,
      config: readEmbykeeperConfig()
    });
    return;
  }

  if (method === "POST" && pathname === "/api/embykeeper/run") {
    const result = await runEmbykeeperOnce();
    sendJson(res, result.ok ? 200 : 500, {
      ok: result.ok,
      output: result.output,
      error: result.error,
      status: getEmbykeeperStatus(),
      checkinResults: readTelegramCheckinResults()
    });
    return;
  }

  if (method === "GET" && pathname === "/api/accounts") {
    sendJson(res, 200, { accounts: readAccounts().map(toPublicAccount) });
    return;
  }

  if (method === "GET" && pathname === "/api/accounts/export") {
    const payload = getExportData(readAccounts());
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="checkin-accounts-${Date.now()}.json"`,
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }

  if (method === "POST" && pathname === "/api/accounts") {
    const body = await readRequestBody(req);
    const nextAccount = normalizeAccountInput(body);
    const error = validateAccount(nextAccount);

    if (error) {
      sendJson(res, 400, { error });
      return;
    }

    const accounts = readAccounts();
    accounts.unshift(nextAccount);
    writeAccounts(accounts);
    sendJson(res, 201, { account: toPublicAccount(nextAccount) });
    return;
  }

  if (method === "POST" && pathname === "/api/accounts/import") {
    const body = await readRequestBody(req);
    const incoming = Array.isArray(body?.accounts)
      ? body.accounts
      : Array.isArray(body)
        ? body
        : [];

    if (!incoming.length) {
      sendJson(res, 400, { error: "缺少可导入的 accounts 数组" });
      return;
    }

    const imported = incoming
      .map((item) => normalizeAccountInput(item))
      .filter((item) => !validateAccount(item));

    if (!imported.length) {
      sendJson(res, 400, { error: "没有可导入的有效账号" });
      return;
    }

    const accounts = [...imported, ...readAccounts()];
    writeAccounts(accounts);
    sendJson(res, 201, { accounts: imported.map(toPublicAccount) });
    return;
  }

  if (method === "POST" && pathname === "/api/accounts/batch-delete") {
    const body = await readRequestBody(req);
    const ids = Array.isArray(body?.ids) ? body.ids : [];

    if (!ids.length) {
      sendJson(res, 400, { error: "ids 不能为空" });
      return;
    }

    const idSet = new Set(ids);
    const accounts = readAccounts();
    const nextAccounts = accounts.filter((item) => !idSet.has(item.id));
    writeAccounts(nextAccounts);
    sendJson(res, 200, { deletedIds: ids, accounts: nextAccounts.map(toPublicAccount) });
    return;
  }

  if (method === "POST" && pathname === "/api/status/refresh") {
    const body = await readRequestBody(req);
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const accounts = readAccounts();
    const processed = await runBatch(accounts, ids, refreshAccountStatus);
    writeAccounts(processed.accounts);
    sendJson(res, 200, {
      results: processed.results,
      accounts: processed.accounts.map(toPublicAccount)
    });
    return;
  }

  if (method === "POST" && pathname === "/api/checkin/run") {
    const body = await readRequestBody(req);
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const accounts = readAccounts();
    const processed = await runBatch(accounts, ids, runAccountCheckin);
    writeAccounts(processed.accounts);
    sendJson(res, 200, {
      results: processed.results,
      accounts: processed.accounts.map(toPublicAccount)
    });
    return;
  }

  const detailMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (detailMatch) {
    const accountId = detailMatch[1];
    const accounts = readAccounts();
    const account = findAccountOrNull(accounts, accountId);

    if (!account) {
      sendJson(res, 404, { error: "账号不存在" });
      return;
    }

    if (method === "GET") {
      sendJson(res, 200, { account: toPublicAccountDetail(account) });
      return;
    }

    if (method === "PUT") {
      const body = await readRequestBody(req);
      const nextAccount = normalizeAccountInput(body, account);
      const error = validateAccount(nextAccount);

      if (error) {
        sendJson(res, 400, { error });
        return;
      }

      const nextAccounts = accounts.map((item) => (item.id === accountId ? nextAccount : item));
      writeAccounts(nextAccounts);
      sendJson(res, 200, { account: toPublicAccount(nextAccount) });
      return;
    }

    if (method === "DELETE") {
      const nextAccounts = accounts.filter((item) => item.id !== accountId);
      writeAccounts(nextAccounts);
      sendJson(res, 200, { deletedId: accountId, accounts: nextAccounts.map(toPublicAccount) });
      return;
    }
  }

  const statusMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/status\/refresh$/);
  if (method === "POST" && statusMatch) {
    const accountId = statusMatch[1];
    const accounts = readAccounts();
    const account = findAccountOrNull(accounts, accountId);

    if (!account) {
      sendJson(res, 404, { error: "账号不存在" });
      return;
    }

    const processed = await refreshAccountStatus(account);
    const nextAccounts = accounts.map((item) => (item.id === accountId ? processed.account : item));
    writeAccounts(nextAccounts);
    sendJson(res, 200, { result: processed.summary, account: toPublicAccount(processed.account) });
    return;
  }

  const checkinMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/checkin$/);
  if (method === "POST" && checkinMatch) {
    const accountId = checkinMatch[1];
    const accounts = readAccounts();
    const account = findAccountOrNull(accounts, accountId);

    if (!account) {
      sendJson(res, 404, { error: "账号不存在" });
      return;
    }

    const processed = await runAccountCheckin(account);
    const nextAccounts = accounts.map((item) => (item.id === accountId ? processed.account : item));
    writeAccounts(nextAccounts);
    sendJson(res, 200, { result: processed.summary, account: toPublicAccount(processed.account) });
    return;
  }

  sendJson(res, 404, { error: "接口不存在" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
      res.writeHead(302, { Location: "/dashboard/", "Cache-Control": "no-store" });
      res.end();
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") &&
        /^\/dashboard\/(?:index\.html|dashboard-runtime\.js|dashboard-patches\.css|emby-keepalive\.js|reference-\d+\.css)?$/.test(url.pathname)) {
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
    sendJson(res, 500, { error: error.message || "服务器内部错误" });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    ensureDataFiles();
    console.log(`Checkin API listening on http://${HOST}:${PORT}`);
  });
}

module.exports = {
  runAccountCheckin,
  refreshAccountStatus,
  readAccounts,
  writeAccounts
};
