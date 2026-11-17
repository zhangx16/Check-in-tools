#!/usr/bin/env node
const { loadLocalEnv } = require('../lib/common');
loadLocalEnv();
const { readProviderAccounts, updateProviderAccounts } = require('../lib/accounts');
const workbuddy = require('../lib/providers/workbuddy');
const { runWithRetries, runDailyJob } = require('../lib/daily');
const { buildCompactFailureAlert } = require('../lib/checkin-report');
async function main() {
  const originals = new Map(readProviderAccounts('workbuddy').map(a => [a.id, a]));
  await runDailyJob({
    title: 'WorkBuddy 每日签到',
    accounts: [...originals.values()].filter(a => a.enabled !== false),
    writeAccounts: updated => {
      const byId = new Map(updated.map(a => [a.id, a]));
      updateProviderAccounts('workbuddy', current => current.map(a => {
        const result = byId.get(a.id), original = originals.get(a.id);
        return result && result.lastCheckin?.code !== 'BUSY' && JSON.stringify(a.workbuddySession) === JSON.stringify(original?.workbuddySession)
          ? workbuddy.mergeRun(a, result) : a;
      }));
    },
    runOne: a => runWithRetries('workbuddy-checkin', a, workbuddy.runAccountCheckin,
      { shouldRetry: (c, n, max) => !c.ok && c.retryable === true && n < max }),
    buildFailureAlert: buildCompactFailureAlert
  });
}
if (require.main === module) main().catch(() => { console.error('WorkBuddy 每日任务执行失败'); process.exitCode = 1; });
module.exports = { main };
