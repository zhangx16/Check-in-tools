const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http");
const data = fs.mkdtempSync(
  path.join(os.tmpdir(), "checkin-routes-inprocess-"),
);
Object.assign(process.env, {
  CHECKIN_DATA_DIR: data,
  ADMIN_USER: "fixture",
  ADMIN_PASS: "fixture-admin-password",
  SESSION_SECRET: "fixture-session-secret",
  APP_API_TOKEN: "fixture-bearer-token",
  ICON_FETCH_ENABLED: "0",
});
const jobs = require("../lib/workbuddy-jobs"),
  keepalive = require("../lib/emby-keepalive");
jobs.launch = (id) => ({ accountId: id, state: "running" });
jobs.get = (id) => ({ accountId: id, state: "running" });
keepalive.launch = (id) => ({ accountId: id, state: "running" });
keepalive.test = async () => ({ ok: true });
const providers = require("../lib/providers");
providers.runAccountCheckin = async (account) => ({
  account: {
    ...account,
    lastCheckin: { ok: true, message: "fixture success" },
    lastCheckinAt: new Date().toISOString(),
  },
  summary: { id: account.id, checkin: { ok: true } },
});
providers.refreshAccountStatus = async (account) => ({
  account: {
    ...account,
    lastStatus: { ok: true, todaySigned: true },
    lastStatusAt: new Date().toISOString(),
  },
  summary: { id: account.id, status: { ok: true } },
});
const loginFlow = require("../lib/workbuddy-login");
loginFlow.create = async () => ({ state: "waiting" });
loginFlow.get = () => ({ state: "waiting" });
loginFlow.cancel = () => ({ state: "cancelled" });
const { createServer } = require("../server");
test("in-process HTTP contract exercises both route families against temporary data", async (t) => {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(data, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(route, method = "GET", body, auth = "token") {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        origin + route,
        {
          method,
          headers: {
            ...(auth === "token"
              ? { Authorization: "Bearer fixture-bearer-token" }
              : auth
                ? { Cookie: auth }
                : {}),
            ...(payload ? { "Content-Type": "application/json" } : {}),
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (x) => (raw += x));
          res.on("end", () => {
            let body;
            try {
              body = JSON.parse(raw);
            } catch {
              body = raw;
            }
            resolve({ status: res.statusCode, body, headers: res.headers });
          });
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  }
  const login = await request(
    "/api/login",
    "POST",
    { username: "fixture", password: "fixture-admin-password" },
    "",
  );
  assert.equal(login.status, 200);
  const cookie = login.headers["set-cookie"]
    .map((x) => x.split(";")[0])
    .join("; ");
  const web = (route, method, body) => request(route, method, body, cookie);
  assert.equal((await web("/api/session")).status, 200);
  for (const route of [
    "/api/accounts",
    "/api/v1/accounts",
    "/api/v1/health",
    "/api/health",
    "/api/v1/summary",
    "/api/v1/dashboard",
    "/api/v1/telegram/bots",
    "/api/v1/telegram/catalog",
    "/api/v1/workbuddy/accounts",
    "/api/embykeeper/status",
    "/api/embykeeper/form",
    "/api/embykeeper/config",
  ])
    assert.equal((await web(route)).status, 200, route);
  const first = await web("/api/accounts", "POST", {
    provider: "glados",
    name: "legacy",
    cookie: "fixture-one",
  });
  assert.equal(first.status, 201);
  const id = first.body.account.id;
  assert.equal(
    (await web("/api/v1/summary")).body.items[0].accountName,
    "legacy",
  );
  for (const route of [
    "/api/accounts/" + id + "/status/refresh",
    "/api/accounts/" + id + "/checkin",
    "/api/v1/accounts/" + id + "/checkin",
  ])
    assert.equal((await web(route, "POST", {})).status, 200);
  for (const route of [
    "/api/checkin/run",
    "/api/status/refresh",
    "/api/v1/checkin/run",
  ])
    assert.equal((await web(route, "POST", { ids: [id] })).status, 200);
  assert.equal((await web("/api/v1/dashboard")).status, 200);
  assert.equal((await web("/api/accounts/" + id)).status, 200);
  assert.equal(
    (await web("/api/accounts/" + id, "PUT", { name: "edited" })).status,
    200,
  );
  assert.equal((await web("/api/accounts/export")).status, 200);
  assert.equal(
    (await web("/api/accounts/export?includeSecrets=1")).status,
    200,
  );
  const second = await request("/api/v1/accounts", "POST", {
    provider: "embymb",
    name: "mobile",
    username: "fixture",
    password: "fixture-password",
  });
  assert.equal(second.status, 201);
  assert.equal(
    (await request("/api/v1/accounts/" + second.body.account.id)).status,
    200,
  );
  assert.equal(
    (
      await request("/api/v1/accounts/" + second.body.account.id, "PUT", {
        name: "updated",
        password: "",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/v1/accounts/" + second.body.account.id, "DELETE"))
      .status,
    200,
  );
  for (const route of ["/api/accounts/missing", "/api/v1/accounts/missing"])
    assert.equal((await web(route)).status, 404);
  assert.equal((await web("/api/accounts/import", "POST", {})).status, 400);
  assert.equal(
    (
      await web("/api/accounts/import", "POST", {
        accounts: [{ name: "imported", cookie: "fixture-import" }],
      })
    ).status,
    201,
  );
  assert.equal(
    (await web("/api/accounts/batch-delete", "POST", { ids: [] })).status,
    400,
  );
  assert.equal(
    (await web("/api/accounts/batch-delete", "POST", { ids: [id] })).status,
    200,
  );
  assert.equal(
    (await request("/api/v1/workbuddy/logins", "POST", { name: "fixture" }))
      .status,
    201,
  );
  assert.equal(
    (await request("/api/v1/workbuddy/logins/" + "a".repeat(48))).status,
    200,
  );
  assert.equal(
    (await request("/api/v1/workbuddy/logins/" + "a".repeat(48), "DELETE"))
      .status,
    200,
  );
  const wbSession = {
    auth: {
      accessToken: "fixture-access",
      refreshToken: "fixture-refresh",
      domain: "www.codebuddy.cn",
      endpoint: "https://copilot.tencent.com",
    },
    account: { uid: "fixture-uid" },
  };
  const wb = await request("/api/v1/accounts", "POST", {
    provider: "workbuddy",
    name: "WB",
    workbuddySession: wbSession,
  });
  assert.equal(wb.status, 201);
  const wid = wb.body.account.id;
  assert.equal(
    (await request("/api/v1/workbuddy/accounts/" + wid + "/run", "POST", {}))
      .status,
    202,
  );
  assert.equal(
    (await request("/api/v1/workbuddy/accounts/" + wid + "/job")).status,
    200,
  );
  assert.equal(
    (await request("/api/v1/accounts/" + wid + "/checkin", "POST", {})).status,
    202,
  );
  assert.equal(
    (await web("/api/accounts/" + wid + "/checkin", "POST", {})).status,
    202,
  );
  assert.equal(
    (await web("/api/accounts/" + wid + "/status/refresh", "POST", {})).status,
    202,
  );
  for (const route of [
    "/api/checkin/run",
    "/api/status/refresh",
    "/api/v1/checkin/run",
  ])
    assert.equal((await web(route, "POST", { ids: [wid] })).status, 202);
  const form = {
    telegramAccounts: [{ phone: "+10000000001", session: "fixture-session" }],
    botTemplates: [
      {
        botUsername: "FixtureBot",
        commands: ["/start"],
        buttonSequence: ["签到"],
      },
    ],
  };
  assert.equal(
    (await web("/api/embykeeper/form", "PUT", { form })).status,
    200,
  );
  fs.writeFileSync(
    path.join(data, "telegram_bot_checkin_results.json"),
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      bots: {
        FixtureBot: {
          accounts: [
            { phone: "+10000000001", ok: true, message: "fixture success" },
            { phone: "+10000000002", skipped: true },
          ],
        },
        EmptyBot: { ok: true, message: "fixture empty" },
        OrphanBot: { accounts: [{ phone: "+10000000001", ok: true }] },
      },
    }),
  );
  const withEmpty = {
    ...form,
    botTemplates: [
      ...form.botTemplates,
      { botUsername: "EmptyBot", commands: ["/sign"] },
      {
        botUsername: "FilteredBot",
        targetPhones: ["+10000000001"],
        commands: ["/sign"],
      },
    ],
  };
  assert.equal(
    (await web("/api/embykeeper/form", "PUT", { form: withEmpty })).status,
    200,
  );
  const summary = await request("/api/v1/summary");
  assert.equal(
    summary.body.projects.find((p) => p.id === "tg:FixtureBot").status,
    "partial",
  );
  const config = await web("/api/embykeeper/config");
  assert.equal(
    (await web("/api/embykeeper/config", "PUT", { config: config.body.config }))
      .status,
    200,
  );
  assert.equal((await web("/api/embykeeper/run", "POST", {})).status, 202);
  assert.equal(
    (
      await request(
        "/api/v1/telegram/bots/FixtureBot/phones/%2B10000000002",
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/v1/telegram/bots/missing", "PUT", {})).status,
    404,
  );
  assert.equal(
    (await request("/api/v1/telegram/bots/missing", "DELETE")).status,
    404,
  );
  assert.equal(
    (await request("/api/v1/telegram/phones/missing", "DELETE")).status,
    404,
  );
  assert.equal(
    (await request("/api/v1/telegram/bots/missing/phones/missing", "DELETE"))
      .status,
    404,
  );

  assert.equal(
    (
      await request("/api/v1/telegram/bots/FixtureBot", "PUT", {
        name: "renamed",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/v1/dashboard/projects/tg%3AFixtureBot", "PATCH", {
        name: "renamed",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/v1/dashboard/projects/tg%3AFixtureBot", "DELETE"))
      .status,
    200,
  );
  assert.equal(
    (await request("/api/v1/telegram/phones/%2B10000000001", "DELETE")).status,
    200,
  );
  const catalog = (await request("/api/v1/telegram/catalog")).body;
  const available = catalog.bots.find((x) => x.available);
  assert.equal(
    (await request("/api/v1/telegram/catalog", "POST", { id: "missing" }))
      .status,
    400,
  );
  assert.equal(
    (
      await request("/api/v1/dashboard/projects/web%3Amissing", "PATCH", {
        name: "test",
      })
    ).status,
    404,
  );
  assert.equal(
    (await request("/api/v1/dashboard/projects/web%3Amissing", "DELETE"))
      .status,
    404,
  );
  assert.equal(
    (
      await request("/api/v1/dashboard/projects/web%3Aworkbuddy", "PATCH", {
        name: "name",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/v1/dashboard/projects/web%3Aworkbuddy", "DELETE"))
      .status,
    200,
  );
  assert.equal(
    (await request("/api/v1/telegram/catalog", "POST", { id: available.id }))
      .status,
    201,
  );
  assert.equal(
    (await request("/api/v1/telegram/catalog", "POST", { id: available.id }))
      .status,
    409,
  );
  const e = await request("/api/v1/emby/keepalive", "POST", {
    name: "fixture",
    serverUrl: "https://example.test",
    username: "fixture",
    password: "fixture-password",
    intervalDays: 7,
    watchSeconds: 30,
  });
  assert.equal(e.status, 201);
  const eid = e.body.account.id;
  assert.equal((await request("/api/v1/emby/keepalive")).status, 200);
  assert.equal(
    (
      await request("/api/v1/emby/keepalive/" + eid, "PUT", {
        password: "",
        name: "edited",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/v1/emby/keepalive/" + eid + "/test", "POST", {}))
      .status,
    200,
  );
  assert.equal(
    (await request("/api/v1/emby/keepalive/" + eid + "/run", "POST", {}))
      .status,
    202,
  );
  assert.equal(
    (await request("/api/v1/emby/keepalive/" + eid, "DELETE")).status,
    200,
  );
  assert.equal((await web("/api/accounts/" + wid, "DELETE")).status, 404);
  assert.equal((await web("/api/logout", "POST", {})).status, 204);
  assert.equal(
    (await request("/api/nonexistent", "GET", undefined, "")).status,
    401,
  );
  assert.equal((await request("/api/v1/nonexistent")).status, 404);
});
