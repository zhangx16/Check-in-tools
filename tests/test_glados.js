const assert = require("node:assert/strict");
const { runAccountCheckin, shouldRetryCheckin } = require("../lib/providers/glados");
const { runWithRetries } = require("../lib/daily");

async function runCase(payloads, retry = false) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push([url.pathname, options.method]);
    assert.ok(payloads.length, "unexpected request");
    return { ok: true, text: async () => JSON.stringify(payloads.shift()) };
  };
  try {
    const account = { id: "test", name: "test", cookie: "test=value" };
    const result = retry
      ? { account: await runWithRetries("test-glados", account, runAccountCheckin,
          { shouldRetry: shouldRetryCheckin, maxAttempts: 3, retryDelayMs: 0 }) }
      : await runAccountCheckin(account);
    assert.equal(payloads.length, 0);
    return { result, calls };
  } finally {
    global.fetch = originalFetch;
  }
}

(async () => {
  const recovered = await runCase([{ code: -2 }, { code: 0 }, { code: 0 }, { code: 0 }]);
  assert.equal(recovered.result.summary.checkin.ok, true);
  assert.equal(recovered.calls.length, 4);
  const temporary = await runCase([{ code: -2 }, { code: 0 }, { code: -2 }]);
  assert.equal(temporary.result.summary.checkin.retryable, true);
  assert.notEqual(temporary.result.account.lastStatus?.state, "unauthorized");
  const expired = await runCase([{ code: -2 }, { code: -2 }]);
  assert.equal(expired.result.summary.checkin.retryable, undefined);
  assert.equal(expired.result.account.lastStatus.state, "unauthorized");
  const retried = await runCase([{ code: -2 }, { code: -2 }, { code: 0, points: 7 }, { code: 0 }], true);
  assert.equal(retried.result.account.lastCheckin.ok, true);
  assert.equal(retried.result.account.lastCheckin.attemptCount, 2);
  const exhausted = await runCase(Array.from({ length: 6 }, () => ({ code: -2 })), true);
  assert.equal(exhausted.result.account.lastCheckin.ok, false);
  assert.equal(exhausted.result.account.lastCheckin.attemptCount, 3);
  assert.equal(shouldRetryCheckin({ code: 4 }, 1, 3), false);
  console.log("GLaDOS authorization recovery tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
