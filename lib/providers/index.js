const workbuddy = require("./workbuddy");
const thxnk = require("./thxnk");
const glados = require("./glados");
const embypulse = require("./embypulse");
const embymb = require("./embymb");
const vpsnat = require("./vpsnat");
const zzcat = require("./zzcat");

const PROVIDERS = {
  workbuddy,
  thxnk,
  zzcat,
  glados,
  embypulse,
  embymb,
  vpsnat
};

function providerKey(account) {
  return String(account?.provider || "glados").trim().toLowerCase() || "glados";
}

function getProvider(accountOrKey) {
  const key = typeof accountOrKey === "string" ? accountOrKey : providerKey(accountOrKey);
  return PROVIDERS[key] || PROVIDERS.glados;
}

function refreshAccountStatus(account) {
  return getProvider(account).refreshAccountStatus(account);
}

function runAccountCheckin(account) {
  return getProvider(account).runAccountCheckin(account);
}

module.exports = {
  workbuddy,
  thxnk,
  zzcat,
  PROVIDERS,
  providerKey,
  getProvider,
  refreshAccountStatus,
  runAccountCheckin,
  glados,
  embypulse,
  embymb,
  vpsnat
};
