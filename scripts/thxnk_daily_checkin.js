#!/usr/bin/env node
const { loadLocalEnv } = require('../lib/common');
loadLocalEnv();
const { readProviderAccounts, commitAccountRuns } = require('../lib/accounts');
const thxnk = require('../lib/providers/thxnk');
const { runWithRetries, runDailyJob } = require('../lib/daily');
const { buildCompactFailureAlert } = require('../lib/checkin-report');
async function main() {
  const all = readProviderAccounts('thxnk');
  await runDailyJob({
    title: '练习生的日常每日签到', accounts: all.filter(a => a.enabled !== false),
    writeAccounts: (updated, originals) => {
      const byId = new Map(updated.map(a => [a.id, a]));
      commitAccountRuns('thxnk', updated, originals);
    },
    runOne: a => runWithRetries('thxnk-checkin', a, thxnk.runAccountCheckin,
      { shouldRetry: (c, n, max) => !c.ok && n < max && !/缺少网站用户名或密码|密码|验证|凭据/.test(c.message || '') }),
    buildFailureAlert: buildCompactFailureAlert
  });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
