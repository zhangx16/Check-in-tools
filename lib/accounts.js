const fs = require("fs");
const { atomicWrite } = require("./store/json-store");
const { withLock } = require("./store/file-lock");
const path = require("path");
const crypto = require("node:crypto");
const {
  DATA_DIR,
  ensureDataDir,
  readJsonArray,
  ensureJsonArrayFile,
  loadLocalEnv,
} = require("./common");

loadLocalEnv();

const GLADOS_ACCOUNTS_FILE = path.resolve(
  process.env.GLADOS_ACCOUNTS_FILE || path.join(DATA_DIR, "accounts.json"),
);
const EMBYPULSE_ACCOUNTS_FILE = path.resolve(
  process.env.EMBYPULSE_ACCOUNTS_FILE ||
    path.join(DATA_DIR, "embypulse_accounts.json"),
);
const EMBYMB_ACCOUNTS_FILE = path.resolve(
  process.env.EMBYMB_ACCOUNTS_FILE ||
    path.join(DATA_DIR, "embymb_accounts.json"),
);

const VPSNAT_ACCOUNTS_FILE = path.resolve(
  process.env.VPSNAT_ACCOUNTS_FILE ||
    path.join(DATA_DIR, "vpsnat_accounts.json"),
);

const PROVIDER_FILES = {
  workbuddy: path.resolve(
    process.env.WORKBUDDY_ACCOUNTS_FILE ||
      path.join(DATA_DIR, "workbuddy_accounts.json"),
  ),
  thxnk: path.resolve(
    process.env.THXNK_ACCOUNTS_FILE ||
      path.join(DATA_DIR, "thxnk_accounts.json"),
  ),
  zzcat: path.resolve(
    process.env.ZZCAT_ACCOUNTS_FILE ||
      path.join(DATA_DIR, "zzcat_accounts.json"),
  ),
  glados: GLADOS_ACCOUNTS_FILE,
  embypulse: EMBYPULSE_ACCOUNTS_FILE,
  embymb: EMBYMB_ACCOUNTS_FILE,
  vpsnat: VPSNAT_ACCOUNTS_FILE,
};

const PROVIDER_ORDER = [
  "workbuddy",
  "thxnk",
  "embymb",
  "embypulse",
  "glados",
  "vpsnat",
  "zzcat",
];

let cache = null;

function fileMtime(filePath) {
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    return `${stat.mtimeNs}:${stat.ino}:${stat.size}`;
  } catch {
    return -1;
  }
}

function currentMtimes() {
  const mtimes = {};
  for (const filePath of Object.values(PROVIDER_FILES)) {
    mtimes[filePath] = fileMtime(filePath);
  }
  return mtimes;
}

function cacheIsFresh(mtimes) {
  if (!cache) return false;
  return Object.keys(mtimes).every(
    (filePath) => cache.mtimes[filePath] === mtimes[filePath],
  );
}

function invalidateAccountsCache() {
  cache = null;
}

function normalizeStoredAccount(account, provider) {
  return {
    ...account,
    provider,
    insecureTls: Boolean(account?.insecureTls),
  };
}

function serializeAccountForStorage(account) {
  const { provider, providerLabel, authPreview, ...rest } = account || {};
  if (process.env.CHECKIN_STORE_RAW !== "1" && rest.lastCheckin?.raw) {
    const checkin = { ...rest.lastCheckin },
      data = checkin.raw?.data || {};
    const firstNumber = (...values) =>
      values.find(
        (v) =>
          v !== undefined &&
          v !== null &&
          v !== "" &&
          Number.isFinite(Number(v)),
      );
    for (const [key, value] of Object.entries({
      currentStreak: firstNumber(data.current_streak, checkin.currentStreak),
      leftDays: data.leftDays,
      checkinDate:
        checkin.checkinDate ||
        (typeof checkin.raw?.list?.[0]?.detail === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(checkin.raw.list[0].detail)
          ? checkin.raw.list[0].detail
          : undefined),
      points: firstNumber(checkin.points, data.daily_points, data.total_today),
      balance: firstNumber(
        checkin.balance,
        checkin.currentPoints,
        data.current_points,
        data.total_points,
      ),
    })) {
      if (value !== undefined && value !== null) checkin[key] = value;
    }
    delete checkin.raw;
    rest.lastCheckin = checkin;
  }
  return rest;
}

function ensureDataFiles() {
  ensureDataDir();
  for (const filePath of Object.values(PROVIDER_FILES)) {
    ensureJsonArrayFile(filePath);
  }
}

function readProviderAccounts(provider) {
  const key =
    String(provider || "glados")
      .trim()
      .toLowerCase() || "glados";
  const filePath = PROVIDER_FILES[key];
  if (!filePath) return [];
  ensureDataDir();
  ensureJsonArrayFile(filePath);
  return readJsonArray(filePath).map((item) =>
    normalizeStoredAccount(item, key),
  );
}

/** Replace one provider snapshot. Callers must preserve unrelated accounts and credential fields. */
function writeProviderAccounts(provider, accounts) {
  const key =
    String(provider || "glados")
      .trim()
      .toLowerCase() || "glados";
  const filePath = PROVIDER_FILES[key];
  if (!filePath) {
    throw new Error(`未知 provider: ${provider}`);
  }
  ensureDataDir();
  const payload = (accounts || []).map(serializeAccountForStorage);
  return withLock(path.join(DATA_DIR, "accounts.lock"), () => {
    atomicWrite(filePath, payload);
    invalidateAccountsCache();
  });
}

function readAccounts() {
  ensureDataFiles();
  const mtimes = currentMtimes();
  if (cacheIsFresh(mtimes)) {
    return cache.accounts.map((item) => ({ ...item }));
  }

  const accounts = PROVIDER_ORDER.flatMap((provider) =>
    readProviderAccounts(provider),
  );
  cache = { mtimes, accounts: accounts.map((item) => ({ ...item })) };
  return accounts.map((item) => ({ ...item }));
}

/** Replace all provider snapshots. This PR preserves the legacy JSON format. */
function writeAccounts(accounts) {
  return withLock(path.join(DATA_DIR, "accounts.lock"), () => {
    ensureDataFiles();
    for (const provider of Object.keys(PROVIDER_FILES))
      writeProviderAccounts(
        provider,
        (accounts || []).filter((a) => (a.provider || "glados") === provider),
      );
    invalidateAccountsCache();
  });
}
/** The callback is synchronous and receives the latest snapshot under the cross-process lock. */
function updateAccounts(mutate) {
  return withLock(path.join(DATA_DIR, "accounts.lock"), () => {
    invalidateAccountsCache();
    const next = mutate(readAccounts());
    writeAccounts(next);
    return next;
  });
}
function updateProviderAccounts(provider, mutate) {
  return withLock(path.join(DATA_DIR, "accounts.lock"), () => {
    const next = mutate(readProviderAccounts(provider));
    writeProviderAccounts(provider, next);
    return next;
  });
}
// Only execution fields are merged: concurrent edits and deletions always survive a worker.
function mergeExecution(current, executed, original) {
  const merged = { ...current };
  for (const key of [
    "lastStatus",
    "lastStatusAt",
    "lastCheckin",
    "lastCheckinAt",
  ])
    if (executed[key] !== undefined) merged[key] = executed[key];
  for (const key of ["cookie", "token", "refreshToken"])
    if (executed[key] && original && current[key] === original[key])
      merged[key] = executed[key];
  return merged;
}
function commitAccountRuns(provider, executed, originals = []) {
  const before = new Map(originals.map((a) => [a.id, a]));
  const byId = new Map(executed.map((a) => [a.id, a]));
  return updateProviderAccounts(provider, (current) =>
    current.map((a) =>
      byId.has(a.id) ? mergeExecution(a, byId.get(a.id), before.get(a.id)) : a,
    ),
  );
}

module.exports = {
  VPSNAT_ACCOUNTS_FILE,
  GLADOS_ACCOUNTS_FILE,
  EMBYPULSE_ACCOUNTS_FILE,
  EMBYMB_ACCOUNTS_FILE,
  PROVIDER_FILES,
  ensureDataFiles,
  normalizeStoredAccount,
  serializeAccountForStorage,
  readAccounts,
  writeAccounts,
  updateAccounts,
  updateProviderAccounts,
  commitAccountRuns,
  mergeExecution,
  readProviderAccounts,
  writeProviderAccounts,
  invalidateAccountsCache,
};
