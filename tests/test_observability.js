const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  { spawnSync } = require("node:child_process");
const { startServer, credentials } = require("./http-helper.cjs");
test("healthz checks storage, tolerates optional absent Python, and metrics require auth", async (t) => {
  const app = await startServer(t, {}, { METRICS_ENABLED: "1" });
  const healthy = await app.request("/api/healthz");
  assert.equal(healthy.status, 200);
  assert.equal(healthy.body.telegram.ready, false);
  assert.equal(healthy.body.data.readable, true);
  assert.equal((await app.request("/metrics")).status, 401);
  const metrics = await app.request("/metrics", {
    token: credentials.APP_API_TOKEN,
  });
  assert.equal(metrics.status, 200);
  assert.match(metrics.body, /checkin_process_rss_bytes/);
  assert.match(metrics.body, /checkin_accounts/);
  assert.equal(metrics.body.includes(credentials.APP_API_TOKEN), false);
  fs.writeFileSync(path.join(app.data, "accounts.json"), "{broken");
  const broken = await app.request("/api/healthz");
  assert.equal(broken.status, 503);
  assert.equal(broken.body.data.readable, false);
  fs.writeFileSync(path.join(app.data, "accounts.json"), "[]");
  assert.equal((await app.request("/api/healthz")).status, 200);
});
test("runner dry-run lists configured enabled providers without executing or modifying data", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkin-runner-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "accounts.json"),
    JSON.stringify([{ id: "one", enabled: true }]),
  );
  fs.writeFileSync(
    path.join(root, "workbuddy_accounts.json"),
    JSON.stringify([{ id: "disabled", enabled: false }]),
  );
  const before = fs.readFileSync(path.join(root, "accounts.json"), "utf8");
  const result = spawnSync(
    process.execPath,
    ["scripts/checkin_runner.js", "--dry-run"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: { PATH: process.env.PATH, CHECKIN_DATA_DIR: root },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).providers, ["glados"]);
  assert.equal(
    fs.readFileSync(path.join(root, "accounts.json"), "utf8"),
    before,
  );
  assert.deepEqual(fs.readdirSync(root).sort(), [
    "accounts.json",
    "workbuddy_accounts.json",
  ]);
});
