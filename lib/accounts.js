const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const {
  DATA_DIR,
  ensureDataDir,
  readJsonArray,
  ensureJsonArrayFile,
  loadLocalEnv
} = require("./common");

loadLocalEnv();

const GLADOS_ACCOUNTS_FILE = path.resolve(
  process.env.GLADOS_ACCOUNTS_FILE || path.join(DATA_DIR, "accounts.json")
);
const EMBYPULSE_ACCOUNTS_FILE = path.resolve(
  process.env.EMBYPULSE_ACCOUNTS_FILE || path.join(DATA_DIR, "embypulse_accounts.json")
);
const EMBYMB_ACCOUNTS_FILE = path.resolve(
  process.env.EMBYMB_ACCOUNTS_FILE || path.join(DATA_DIR, "embymb_accounts.json")
);

const VPSNAT_ACCOUNTS_FILE = path.resolve(process.env.VPSNAT_ACCOUNTS_FILE || path.join(DATA_DIR, "vpsnat_accounts.json"));

const PROVIDER_FILES = {
  workbuddy: path.resolve(process.env.WORKBUDDY_ACCOUNTS_FILE || path.join(DATA_DIR, "workbuddy_accounts.json")),
  thxnk: path.resolve(process.env.THXNK_ACCOUNTS_FILE || path.join(DATA_DIR, "thxnk_accounts.json")),
  zzcat: path.resolve(process.env.ZZCAT_ACCOUNTS_FILE || path.join(DATA_DIR, "zzcat_accounts.json")),
  glados: GLADOS_ACCOUNTS_FILE,
  embypulse: EMBYPULSE_ACCOUNTS_FILE,
  embymb: EMBYMB_ACCOUNTS_FILE,
  vpsnat: VPSNAT_ACCOUNTS_FILE
};

const PROVIDER_ORDER = ["workbuddy", "thxnk", "embymb", "embypulse", "glados", "vpsnat", "zzcat"];

let cache = null;

function fileMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
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
  return Object.keys(mtimes).every((filePath) => cache.mtimes[filePath] === mtimes[filePath]);
}

function invalidateAccountsCache() {
  cache = null;
}

function normalizeStoredAccount(account, provider) {
  return {
    ...account,
    provider,
    insecureTls: Boolean(account?.insecureTls)
  };
}

function serializeAccountForStorage(account) {
  const {
    provider,
    providerLabel,
    authPreview,
    ...rest
  } = account || {};
  return rest;
}

function ensureDataFiles() {
  ensureDataDir();
  for (const filePath of Object.values(PROVIDER_FILES)) {
    ensureJsonArrayFile(filePath);
  }
}

function readProviderAccounts(provider) {
  const key = String(provider || "glados").trim().toLowerCase() || "glados";
  const filePath = PROVIDER_FILES[key];
  if (!filePath) return [];
  ensureDataDir();
  ensureJsonArrayFile(filePath);
  return readJsonArray(filePath).map((item) => normalizeStoredAccount(item, key));
}

/** Replace one provider snapshot. Callers must preserve unrelated accounts and credential fields. */
function writeProviderAccounts(provider, accounts) {
  const key = String(provider || "glados").trim().toLowerCase() || "glados";
  const filePath = PROVIDER_FILES[key];
  if (!filePath) {
    throw new Error(`未知 provider: ${provider}`);
  }
  ensureDataDir();
  const payload = (accounts || []).map(serializeAccountForStorage);
  if (key === "workbuddy") {
    const temp = filePath + '.' + crypto.randomUUID() + '.tmp';
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(payload, null, 2));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    try { fs.renameSync(temp, filePath); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  } else fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  invalidateAccountsCache();
}

function readAccounts() {
  ensureDataFiles();
  const mtimes = currentMtimes();
  if (cacheIsFresh(mtimes)) {
    return cache.accounts.map((item) => ({ ...item }));
  }

  const accounts = PROVIDER_ORDER.flatMap((provider) => readProviderAccounts(provider));
  cache = { mtimes, accounts: accounts.map((item) => ({ ...item })) };
  return accounts.map((item) => ({ ...item }));
}

/** Replace all provider snapshots. This PR preserves the legacy JSON format. */
function writeAccounts(accounts) {
  ensureDataFiles();
  for (const provider of Object.keys(PROVIDER_FILES)) {
    const subset = (accounts || [])
      .filter((item) => (item.provider || "glados") === provider)
      .map(serializeAccountForStorage);
    if (provider === "workbuddy") writeProviderAccounts(provider, subset);
    else fs.writeFileSync(PROVIDER_FILES[provider], JSON.stringify(subset, null, 2));
  }
  cache = {
    mtimes: currentMtimes(),
    accounts: (accounts || []).map((item) => ({ ...item }))
  };
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
  readProviderAccounts,
  writeProviderAccounts,
  invalidateAccountsCache
};
