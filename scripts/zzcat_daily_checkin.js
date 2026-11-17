#!/usr/bin/env node
const { loadLocalEnv } = require('../lib/common');
loadLocalEnv();
const { readProviderAccounts, commitAccountRuns } = require('../lib/accounts');
const zzcat = require('../lib/providers/zzcat');
const { runWithRetries, runDailyJob } = require('../lib/daily');
const { buildCompactFailureAlert } = require('../lib/checkin-report');
async function main() {
  const all = readProviderAccounts('zzcat');
  await runDailyJob({
    title: '这只猫每日签到', accounts: all.filter(a => a.enabled !== false),
    writeAccounts: (updated, originals) => {
      const byId = new Map(updated.map(a => [a.id, a]));
      commitAccountRuns('zzcat', updated, originals);
    },
    runOne: a => runWithRetries('zzcat-checkin', a, zzcat.runAccountCheckin,
      { shouldRetry: (c, n, max) => !c.ok && n < max && !/会话已失效|缺少.*Cookie/.test(c.message || '') }),
    buildFailureAlert: buildCompactFailureAlert
  });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
