const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { createTelegramJobs } = require("../lib/telegram-jobs");
test("Telegram launch returns immediately, coalesces requests and persists a credential-free result", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-jobs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let complete;
  const jobs = createTelegramJobs({
    dataDir: root,
    run: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  const job = jobs.launch();
  assert.equal(job.state, "queued");
  assert.equal(jobs.launch().id, job.id);
  await new Promise((r) => setImmediate(r));
  assert.equal(jobs.get().state, "running");
  complete({ ok: true, output: "private-fixture-output" });
  await new Promise((r) => setImmediate(r));
  assert.equal(jobs.get().state, "completed");
  assert.equal(
    fs
      .readFileSync(path.join(root, "embykeeper/job.json"), "utf8")
      .includes("private-fixture-output"),
    false,
  );
  fs.writeFileSync(
    path.join(root, "embykeeper/job.json"),
    JSON.stringify({ id: "old", state: "running" }),
  );
  assert.equal(
    createTelegramJobs({ dataDir: root, run: () => {} }).get().state,
    "interrupted",
  );
});
