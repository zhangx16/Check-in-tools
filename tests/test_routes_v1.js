const test = require("node:test"),
  assert = require("node:assert/strict");
const { startServer, credentials } = require("./http-helper.cjs");
test("real HTTP CRUD and summary/dashboard agree on partial and hide deleted bots", async (t) => {
  const app = await startServer(t, {
    "embykeeper/form.json": {
      telegramAccounts: [{ phone: "+10000000001" }, { phone: "+10000000002" }],
      botTemplates: [{ botUsername: "FixtureBot", commands: ["/sign"] }],
    },
    "telegram_bot_checkin_results.json": {
      bots: {
        FixtureBot: {
          botUsername: "FixtureBot",
          name: "Fixture",
          accounts: [
            { phone: "+10000000001", ok: true, message: "success" },
            { phone: "+10000000002", skipped: true, message: "skipped" },
          ],
        },
        OrphanBot: { accounts: [{ phone: "+10000000001", ok: true }] },
      },
    },
  });
  const cookie = await app.login(),
    token = credentials.APP_API_TOKEN;
  const auth = { token };
  const add = await app.request("/api/v1/accounts", {
    ...auth,
    method: "POST",
    body: {
      provider: "embymb",
      name: "first",
      username: "fixture",
      password: "fixture-password",
    },
  });
  assert.equal(add.status, 201);
  const id = add.body.account.id;
  assert.equal(
    (
      await app.request("/api/accounts", {
        cookie,
        method: "POST",
        body: {
          provider: "embymb",
          name: "duplicate",
          username: "fixture",
          password: "fixture-password",
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (await app.request("/api/v1/accounts/" + id, auth)).body.account
      .hasPassword,
    true,
  );
  assert.equal(
    (
      await app.request("/api/v1/accounts/" + id, {
        ...auth,
        method: "PUT",
        body: { name: "renamed", password: "" },
      })
    ).status,
    200,
  );
  const summary = (await app.request("/api/v1/summary", auth)).body,
    dashboard = (await app.request("/api/v1/dashboard", auth)).body;
  assert.deepEqual(summary.projects, dashboard.projects);
  assert.equal(
    summary.projects.find((p) => p.id === "tg:FixtureBot").status,
    "partial",
  );
  assert.equal(
    summary.projects.some((p) => p.id === "tg:OrphanBot"),
    false,
  );
  assert.equal(
    (
      await app.request("/api/v1/dashboard/projects/tg%3AFixtureBot", {
        ...auth,
        method: "PATCH",
        body: { name: "renamed bot" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await app.request(
        "/api/v1/telegram/bots/FixtureBot/phones/%2B10000000002",
        { ...auth, method: "DELETE" },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await app.request("/api/v1/telegram/phones/%2B10000000002", {
        ...auth,
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await app.request("/api/v1/telegram/bots/FixtureBot", {
        ...auth,
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.equal(
    (await app.request("/api/v1/dashboard", auth)).body.projects.some(
      (p) => p.kind === "telegram_bot",
    ),
    false,
  );
  assert.equal(
    (await app.request("/api/v1/accounts/" + id, { ...auth, method: "DELETE" }))
      .status,
    200,
  );
  assert.equal((await app.request("/api/v1/accounts/" + id, auth)).status, 404);
  assert.equal(
    (await app.request("/api/v1/accounts", auth)).body.accounts.length,
    0,
  );
});
test("batch orchestration queues WorkBuddy with job metadata and merges other results under lock", async () => {
  let saved = [
    { id: "g", provider: "glados", name: "edited" },
    { id: "w", provider: "workbuddy" },
  ];
  const { runBatch } = require("../domain/checkin-service")({
    runConcurrent: require("../lib/common").runConcurrent,
    workbuddyJobs: { launch: (id) => ({ accountId: id, state: "running" }) },
    updateAccounts: (fn) => (saved = fn(saved)),
    mergeExecution: require("../lib/accounts").mergeExecution,
    refreshAccountStatus: () => {},
  });
  const result = await runBatch(
    [
      { id: "g", provider: "glados", name: "old" },
      { id: "w", provider: "workbuddy" },
    ],
    [],
    async (account) => ({
      account: { ...account, lastCheckin: { ok: true } },
      summary: { id: account.id, checkin: { ok: true } },
    }),
  );
  assert.equal(saved[0].name, "edited");
  assert.equal(saved[0].lastCheckin.ok, true);
  const queued = result.results.find((x) => x.id === "w");
  assert.equal(queued.queued, true);
  assert.equal(queued.job.state, "running");
  assert.equal(queued.checkin, undefined);
});
