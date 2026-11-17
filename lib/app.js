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
  isAlreadyCheckedInMessage,
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
  updateAccounts,
  updateProviderAccounts,
  mergeExecution,
  ensureDataFiles: ensureAccountDataFiles,
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
const {
  signSession,
  isAuthenticated,
  setAuthCookies,
  clearAuthCookies,
  isAppTokenAuthorized,
  requireAuth,
  requireAppOrSessionAuth,
  checkLogin,
} = createAuth(config);
const { sendJson, sendText, readRequestBody } = require("./http/respond");
const { log, audit } = require("./log");

const EMBYKEEPER_DIR = path.join(DATA_DIR, "embykeeper");
const EMBYKEEPER_CONFIG_FILE = path.join(EMBYKEEPER_DIR, "config.toml");
const EMBYKEEPER_FORM_FILE = path.join(EMBYKEEPER_DIR, "form.json");
const EMBYKEEPER_RUNTIME_DIR = path.join(EMBYKEEPER_DIR, "runtime");
const TELEGRAM_CHECKIN_RESULTS_FILE = path.join(
  DATA_DIR,
  "telegram_bot_checkin_results.json",
);
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const EMBYKEEPER_VENV_DIR = path.join(PROJECT_ROOT, ".venv-embykeeper");
const EMBYKEEPER_BIN = path.join(EMBYKEEPER_VENV_DIR, "bin", "python");
const EMBYKEEPER_RUNNER = path.join(
  PROJECT_ROOT,
  "scripts",
  "embykeeper_run_once.sh",
);
const CUSTOM_TG_WORKER = path.join(
  PROJECT_ROOT,
  "scripts",
  "telegram_bot_checkin.py",
);
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const PROJECT_NAMES_FILE = path.join(DATA_DIR, "project_names.json");
const BOT_AVATAR_DIR = path.join(PUBLIC_DIR, "bot-avatars");
const SITE_ICON_DIR = path.join(PUBLIC_DIR, "site-icons");
const BOT_AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_ICON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_VPSNAT_BASE_URL =
  process.env.DEFAULT_VPSNAT_BASE_URL || "https://www.vpsnat.com";
const PROVIDER_DEFAULT_BASE = {
  workbuddy: workbuddy.DEFAULT_BASE_URL,
  thxnk: "https://thxnk.cc",
  zzcat: "https://user.090911.xyz",
  vpsnat: DEFAULT_VPSNAT_BASE_URL,
  glados: DEFAULT_GLADOS_BASE_URL,
  embypulse: DEFAULT_EMBYPULSE_BASE_URL,
  embymb: DEFAULT_EMBYMB_BASE_URL,
};
const PROVIDER_LABELS = {
  workbuddy: "WorkBuddy",
  thxnk: "练习生的日常",
  zzcat: "这只猫用户中心",
  vpsnat: "VPSNAT 纳泰云",
  glados: "GLaDOS",
  embypulse: "EmbyPulse",
  embymb: "EmbyMB",
  telegram_bot: "Telegram Bot",
};
const EMBYKEEPER_BUILTIN_CHECKINERS = {
  gymeowfly_bot: "meow",
  LembyPremium_BOT: "lemby",
  JingzheProbot: "jingzhe",
  YounoEmbyAgain_bot: "youno",
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

const serveStatic = require("./http/static").createStatic(PUBLIC_DIR);

const { getSiteIcon } = require("./icons/site-icon")({
  SITE_ICON_DIR,
  USER_AGENT,
  SITE_ICON_TTL_MS,
  PROVIDER_DEFAULT_BASE,
  DEFAULT_GLADOS_BASE_URL,
  normalizeBaseUrl,
});
const { getBotAvatar } = require("./icons/bot-avatar")({
  BOT_AVATAR_DIR,
  BOT_AVATAR_TTL_MS,
  TELEGRAM_BOT_TOKEN,
  telegramBotApiByToken,
  REQUEST_TIMEOUT_MS,
});

const { readProjectNames, setProjectName, applyProjectNames } =
  require("../domain/project-names")({ fs, PROJECT_NAMES_FILE });
const {
  createAccount,
  updateAccount,
  deleteAccount,
  isPasswordProvider,
  normalizeProvider,
  normalizeAccountInput,
  normalizeAccountMobileUpdate,
  validateAccount,
} = require("../domain/account-service")({
  SESSION_SECRET,
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
});
const {
  providerLabel,
  workbuddyAuthInfo,
  toPublicAccount,
  toPublicAccountDetail,
  toMobileAccountDetail,
  getExportData,
} = require("./http/account-dto")({
  formatDateTime,
  cookiePreview,
  workbuddy,
  PROVIDER_LABELS,
  isPasswordProvider,
});
const {
  publicTelegramForm,
  publicTelegramConfig,
  updateTelegramConfig,
  ensureEmbykeeperConfigFile,
  readEmbykeeperConfig,
  writeEmbykeeperConfig,
  defaultTelegramAccountForm,
  defaultBotTemplateForm,
  defaultEmbykeeperForm,
  normalizeStringArray,
  normalizeEmbykeeperForm,
  readEmbykeeperForm,
  readTelegramCheckinResults,
  writeEmbykeeperForm,
  tomlEscape,
  tomlString,
  tomlBoolean,
  tomlArray,
  renderEmbykeeperConfigFromForm,
  getEmbykeeperStatus,
  listMobileTelegramBots,
  persistEmbykeeperForm,
  updateMobileTelegramBot,
  deleteMobileTelegramBot,
  deleteMobileTelegramPhone,
  removePhoneFromTelegramBot,
} = require("../domain/telegram-service")({
  fs,
  path,
  formatDateTime,
  DATA_DIR,
  EMBYKEEPER_CONFIG_FILE,
  EMBYKEEPER_FORM_FILE,
  EMBYKEEPER_RUNTIME_DIR,
  TELEGRAM_CHECKIN_RESULTS_FILE,
  EMBYKEEPER_BIN,
  EMBYKEEPER_RUNNER,
  CUSTOM_TG_WORKER,
  EMBYKEEPER_BUILTIN_CHECKINERS,
  ensureDataFiles,
  setProjectName,
});
const { runEmbykeeperOnce } = require("./telegram-worker")({
  PROJECT_ROOT,
  path,
  spawn,
  EMBYKEEPER_DIR,
  EMBYKEEPER_VENV_DIR,
  CUSTOM_TG_WORKER,
  readEmbykeeperForm,
  getEmbykeeperStatus,
});
const {
  emptyStatusCounts,
  deriveWebsiteItemStatus,
  accountStatusFromTelegramAcc,
  aggregateProjectStatus,
} = require("../domain/status")({ isAlreadyCheckedInMessage });
const {
  buildDashboard,
  mapWebsiteAccountToSummaryItem,
  publicBaseFromRequest,
  mapTelegramResultsToSummaryItems,
  buildSummaryProjects,
  buildMobileSummaryUncached,
  summaryVersion,
  buildMobileSummary,
} = require("../domain/summary-service")({
  fs,
  formatDateTime,
  pickNumber,
  readAccounts,
  HOST,
  PORT,
  APP_API_TOKEN,
  isHttpsRequest,
  EMBYKEEPER_FORM_FILE,
  TELEGRAM_CHECKIN_RESULTS_FILE,
  PROJECT_NAMES_FILE,
  BOT_AVATAR_DIR,
  SITE_ICON_DIR,
  PROVIDER_DEFAULT_BASE,
  providerLabel,
  applyProjectNames,
  readEmbykeeperForm,
  readTelegramCheckinResults,
  getEmbykeeperStatus,
  toPublicAccount,
  emptyStatusCounts,
  deriveWebsiteItemStatus,
  accountStatusFromTelegramAcc,
  aggregateProjectStatus,
  getSiteIcon,
  getBotAvatar,
});
const { runOne, findAccountOrNull, runBatch } =
  require("../domain/checkin-service")({
    runConcurrent,
    workbuddyJobs,
    updateAccounts,
    mergeExecution,
    refreshAccountStatus,
  });
const handleApi = require("./http/router").createRouter({
  publicTelegramForm,
  publicTelegramConfig,
  updateTelegramConfig,
  runOne,
  buildDashboard,
  updateAccounts,
  mergeExecution,
  createAccount,
  updateAccount,
  deleteAccount,
  requireAuth,
  requireAppOrSessionAuth,
  formatDateTime,
  HOST,
  PORT,
  ADMIN_USER,
  isAuthenticated,
  setAuthCookies,
  clearAuthCookies,
  checkLogin,
  sendJson,
  readRequestBody,
  workbuddyJobs,
  readAccounts,
  writeAccounts,
  runAccountCheckin,
  toMobileAccountDetail,
  normalizeAccountMobileUpdate,
  normalizeAccountInput,
  validateAccount,
  findAccountOrNull,
  runBatch,
  embyKeepalive,
  writeProviderAccounts,
  APP_API_TOKEN,
  isAppTokenAuthorized,
  PROVIDER_DEFAULT_BASE,
  providerLabel,
  setProjectName,
  applyProjectNames,
  readEmbykeeperForm,
  deleteMobileTelegramBot,
  buildMobileSummary,
  PROJECT_ROOT,
  fs,
  path,
  listMobileTelegramBots,
  persistEmbykeeperForm,
  updateMobileTelegramBot,
  deleteMobileTelegramPhone,
  removePhoneFromTelegramBot,
  workbuddyLogin,
  readProviderAccounts,
  toPublicAccount,
  DATA_DIR,
  refreshAccountStatus,
  audit,
  toPublicAccountDetail,
  getExportData,
  config,
  readEmbykeeperConfig,
  writeEmbykeeperConfig,
  normalizeEmbykeeperForm,
  readTelegramCheckinResults,
  writeEmbykeeperForm,
  renderEmbykeeperConfigFromForm,
  getEmbykeeperStatus,
  runEmbykeeperOnce,
});

function createServer() {
  readConfig();
  return http.createServer(async (req, res) => {
    const started = performance.now();
    const suppliedId = String(req.headers["x-request-id"] || "");
    const reqId = /^[a-zA-Z0-9_-]{1,64}$/.test(suppliedId)
      ? suppliedId
      : crypto.randomUUID();
    res.setHeader("X-Request-Id", reqId);
    res.on("finish", () => {
      log("info", "http.request", {
        reqId,
        method: req.method,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      });
    });
    try {
      const url = new URL(
        req.url,
        `http://${req.headers.host || `${HOST}:${PORT}`}`,
      );

      if (url.pathname.startsWith("/api/")) {
        if (
          !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
          url.pathname !== "/api/login"
        ) {
          const actor = isAuthenticated(req)
            ? ADMIN_USER
            : isAppTokenAuthorized(req)
              ? "api-token"
              : "anonymous";
          // Use route templates so phone numbers and OAuth state IDs never reach the audit file.
          const targetId = url.pathname.replace(
            /\/[+\d][^/]*|\/[a-f0-9]{32,}/g,
            "/:id",
          );
          const writeHead = res.writeHead;
          let recorded = false;
          res.writeHead = function (status, ...args) {
            if (!recorded) {
              recorded = true;
              audit(path.join(DATA_DIR, "audit.log.jsonl"), {
                actor,
                ip: req.socket.remoteAddress || "unknown",
                action: req.method,
                targetId,
                ok: status < 400,
              });
            }
            return writeHead.call(this, status, ...args);
          };
        }
        await handleApi(req, res, url);
        return;
      }

      if (
        (req.method === "GET" || req.method === "HEAD") &&
        url.pathname === "/"
      ) {
        res.writeHead(302, {
          Location: "/dashboard/",
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }

      if (
        (req.method === "GET" || req.method === "HEAD") &&
        /^\/dashboard\/(?:index\.html|dashboard-runtime\.js|workbuddy-ui\.js|dashboard-patches\.css|emby-keepalive\.js|reference-\d+\.css)?$/.test(
          url.pathname,
        )
      ) {
        if (url.pathname === "/dashboard/") url.pathname += "index.html";
        serveStatic(req, res, url);
        return;
      }

      // Public icons for mobile clients (AsyncImage) — TG bot photos + website favicons/logos.
      if (
        (url.pathname.startsWith("/bot-avatars/") ||
          url.pathname.startsWith("/site-icons/")) &&
        (req.method === "GET" || req.method === "HEAD")
      ) {
        serveStatic(req, res, url);
        return;
      }

      sendJson(res, 404, { error: "Not Found" });
    } catch (error) {
      sendJson(res, error.status || 500, {
        error: error.status ? error.message : "服务器内部错误",
        code: error.code || "INTERNAL_ERROR",
      });
    }
  });
}
function start() {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    ensureDataFiles();
    log("info", "server.listening");
  });
  return server;
}
module.exports = {
  createServer,
  start,
  runAccountCheckin,
  refreshAccountStatus,
  readAccounts,
  writeAccounts,
};
