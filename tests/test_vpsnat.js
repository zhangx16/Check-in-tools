const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runAccountCheckin } = require("../lib/providers/vpsnat");

async function mockRequests(t, responses, account = { token: "old", refreshToken: "refresh" }) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    const expected = responses.shift();
    assert.ok(expected, `Unexpected request ${url}`);
    assert.ok(url.endsWith(expected.route), `${url} should end with ${expected.route}`);
    return { ok: (expected.status || 200) < 400, status: expected.status || 200, json: async () => expected.data };
  });
  const result = await runAccountCheckin(account);
  assert.equal(responses.length, 0);
  return { ...result, calls };
}

test("VPSNAT skips an already signed day", async (t) => {
  const result = await mockRequests(t, [
    { route: "/auth/me", data: {} },
    { route: "/checkin/status", data: { hasCheckedIn: true } },
    { route: "/entertainment/points", data: { points: 35 } }
  ]);
  assert.equal(result.account.lastCheckin.already, true);
  assert.equal(result.account.lastCheckin.balance, 35);
  assert.ok(result.calls.every((call) => call.options.method === "GET"));
});

test("VPSNAT refreshes expired tokens and records resource rewards", async (t) => {
  const result = await mockRequests(t, [
    { route: "/auth/me", status: 401, data: { error: "expired" } },
    { route: "/auth/refresh", data: { token: "new", refreshToken: "rotated" } },
    { route: "/checkin/status", data: { hasCheckedIn: false, enabled: true, requireInstance: false } },
    { route: "/entertainment/points", data: { points: 35 } },
    { route: "/checkin/checkin", data: { bonusPoints: 5, codeType: "t", codeValue: 10 } },
    { route: "/checkin/status", data: { hasCheckedIn: true } },
    { route: "/entertainment/points", data: { points: 40 } }
  ]);
  assert.equal(result.account.token, "new");
  assert.equal(result.account.refreshToken, "rotated");
  assert.equal(result.account.lastCheckin.points, 5);
  assert.equal(result.account.lastCheckin.balance, 40);
  assert.match(result.account.lastCheckin.message, /流量 \+10GB/);
  assert.equal(result.calls[4].options.headers.Authorization, "Bearer new");
});

test("VPSNAT exposes Turnstile failure without storing credentials in result", async (t) => {
  const result = await mockRequests(t, [
    { route: "/auth/login", status: 403, data: { error: "Turnstile verification required", code: "TURNSTILE_TOKEN_MISSING" } }
  ], { username: "user", password: "secret" });
  assert.equal(result.account.lastCheckin.ok, false);
  assert.match(result.account.lastCheckin.message, /人机验证/);
  assert.ok(!JSON.stringify(result.summary).includes("secret"));
});

test("VPSNAT keeps successful check-in when status refresh fails", async (t) => {
  const result = await mockRequests(t, [
    { route: "/auth/me", data: {} },
    { route: "/checkin/status", data: { enabled: true, requireInstance: false } },
    { route: "/entertainment/points", data: { points: 0 } },
    { route: "/checkin/checkin", data: { bonusPoints: 5 } },
    { route: "/checkin/status", status: 500, data: { error: "unavailable" } }
  ]);
  assert.equal(result.account.lastCheckin.ok, true);
  assert.equal(result.account.lastStatus.ok, false);
});

test("VPSNAT does not sign when an instance is required", async (t) => {
  const result = await mockRequests(t, [
    { route: "/auth/me", data: {} },
    { route: "/checkin/status", data: { enabled: true, requireInstance: true, hasInstances: false } },
    { route: "/entertainment/points", data: { points: 0 } }
  ]);
  assert.equal(result.account.lastCheckin.ok, false);
  assert.match(result.account.lastCheckin.message, /有效实例/);
});
