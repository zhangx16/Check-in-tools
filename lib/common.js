const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const GLADOS_DEVICE_USER_AGENTS = {
  Windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  Mac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  macOS:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  Linux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  iPhone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  Android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36"
};

function loadLocalEnv() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"(.*)"$/, "$1");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseBoolean(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function formatDateTime(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const formatIso = formatDateTime;

function getTimeoutMs() {
  return Number(process.env.REQUEST_TIMEOUT_MS || 20000);
}

let insecureTlsChain = Promise.resolve();

function withInsecureTls(enabled, fn) {
  if (!enabled) {
    return Promise.resolve().then(fn);
  }

  const run = async () => {
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      return await fn();
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
      }
    }
  };

  const task = insecureTlsChain.then(run, run);
  insecureTlsChain = task.then(() => undefined, () => undefined);
  return task;
}

function formatBeijing(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function beijingDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBaseUrl(value, fallback = "https://glados.network") {
  const raw = String(value || "").trim();
  const candidate = raw || fallback;
  const finalValue = candidate.startsWith("http://") || candidate.startsWith("https://")
    ? candidate
    : `https://${candidate}`;
  return finalValue.replace(/\/+$/, "");
}

function gladosUserAgent(device) {
  const key = String(device || "").trim();
  return GLADOS_DEVICE_USER_AGENTS[key] || GLADOS_DEVICE_USER_AGENTS.Windows;
}

function isAlreadyCheckedInMessage(message) {
  const lowered = String(message || "").toLowerCase();
  return [
    "tomorrow", "already", "checked in", "idempotent",
    "已签到", "已经签到", "今天已经签到过了", "请勿重复签到",
    "重复签到", "明天再来", "重复"
  ].some((marker) => lowered.includes(marker));
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ensureJsonArrayFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
}

function calculateDaysUntil(dateText) {
  const parsed = new Date(dateText);
  if (Number.isNaN(parsed.getTime())) return null;
  const diff = parsed.getTime() - Date.now();
  return (diff / (1000 * 60 * 60 * 24)).toFixed(2);
}

function pickNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatMinorAmount(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "--";
  return (amount / 100).toFixed(2);
}

// --- Cookie utilities ---

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf("=");
      if (index === -1) return acc;
      const key = part.slice(0, index);
      const value = decodeURIComponent(part.slice(index + 1));
      acc[key] = value;
      return acc;
    }, {});
}

function parseSetCookieLines(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = headers.get("set-cookie");
  if (!raw) return [];
  return raw.split(/,(?=[^;,=\s]+=[^;,]+)/g).map((item) => item.trim()).filter(Boolean);
}

function buildCookieHeaderFromSetCookie(headers) {
  return parseSetCookieLines(headers)
    .map((line) => line.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookieHeaders(...cookieHeaders) {
  const cookies = new Map();
  for (const header of cookieHeaders) {
    for (const part of String(header || "").split(";")) {
      const item = part.trim();
      if (!item) continue;
      const index = item.indexOf("=");
      if (index <= 0) continue;
      cookies.set(item.slice(0, index), item.slice(index + 1));
    }
  }
  return Array.from(cookies.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function cookieValue(cookieHeader, name) {
  const prefix = `${name}=`;
  const found = String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!found) return "";
  try {
    return decodeURIComponent(found.slice(prefix.length));
  } catch {
    return found.slice(prefix.length);
  }
}

function cookiePreview(cookie) {
  const trimmed = String(cookie || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 10)}...${trimmed.slice(-8)}`;
}

// --- Child process helper ---

const { spawn } = require("child_process");

function runCommandCapture(command, args, stdin = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });

    if (stdin) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

// --- Concurrency helper ---

async function runConcurrent(items, worker, concurrency = 4) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await worker(items[i], i);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(runNext());
  }
  await Promise.all(workers);
  return results;
}

module.exports = {
  PROJECT_ROOT,
  DATA_DIR,
  USER_AGENT,
  GLADOS_DEVICE_USER_AGENTS,
  loadLocalEnv,
  parseBoolean,
  formatDateTime,
  formatIso,
  getTimeoutMs,
  withInsecureTls,
  formatBeijing,
  beijingDateString,
  sleep,
  cloneData,
  normalizeBaseUrl,
  gladosUserAgent,
  isAlreadyCheckedInMessage,
  ensureDataDir,
  readJsonArray,
  ensureJsonArrayFile,
  calculateDaysUntil,
  pickNumber,
  formatMinorAmount,
  parseCookies,
  parseSetCookieLines,
  buildCookieHeaderFromSetCookie,
  mergeCookieHeaders,
  cookieValue,
  cookiePreview,
  runCommandCapture,
  runConcurrent
};
