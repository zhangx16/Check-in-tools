const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
function createHealth({
  dataDir,
  providerFiles,
  readAccounts,
  getTelegramStatus,
  minFreeBytes = 10 * 1024 * 1024,
}) {
  return () => {
    let writable = false,
      readable = false,
      freeBytes = null,
      accounts = [];
    const probe = path.join(dataDir, ".health-" + crypto.randomUUID());
    try {
      fs.writeFileSync(probe, "", { flag: "wx", mode: 0o600 });
      fs.unlinkSync(probe);
      writable = true;
    } catch {}
    try {
      for (const file of Object.values(providerFiles)) {
        if (
          fs.existsSync(file) &&
          !Array.isArray(JSON.parse(fs.readFileSync(file, "utf8")))
        )
          throw Error("invalid");
      }
      accounts = readAccounts();
      readable = true;
    } catch {}
    try {
      const stat = fs.statfsSync(dataDir);
      freeBytes = stat.bavail * stat.bsize;
    } catch {}
    let telegram = { ready: false, installed: false };
    try {
      const status = getTelegramStatus();
      telegram = {
        installed: status.installed,
        ready: Boolean(
          status.installed &&
            status.customWorkerExists &&
            status.sessionStringCount,
        ),
        sessionCount: status.sessionStringCount,
      };
    } catch {}
    const providers = {};
    for (const account of accounts) {
      const p = account.provider || "glados";
      const date = account.lastCheckinAt || "";
      if (!providers[p] || date > providers[p]) providers[p] = date;
    }
    const diskOk = freeBytes === null || freeBytes >= minFreeBytes;
    return {
      ok: writable && readable && diskOk,
      data: { writable, readable, freeBytes },
      providers,
      telegram,
    };
  };
}
module.exports = { createHealth };
