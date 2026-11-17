const test = require("node:test"),
  assert = require("node:assert/strict"),
  { evaluateFailures } = require("../lib/failure-streaks");
test("only three consecutive fresh failure days alert; success, gaps and skipped results reset", () => {
  let state = {};
  const account = { id: "fixture", provider: "glados", name: "fixture" };
  function run(date, result) {
    const at = date + "T04:00:00Z";
    const evaluated = evaluateFailures(
      state,
      [{ ...account, lastCheckinAt: at, lastCheckin: result }],
      { now: new Date(at) },
    );
    state = evaluated.next;
    return evaluated.alerts;
  }
  assert.equal(run("2026-11-14", { ok: false }).length, 0);
  assert.equal(run("2026-11-15", { ok: false }).length, 0);
  assert.equal(run("2026-11-16", { ok: false }).length, 1);
  state["glados:fixture"].alertedOn = "2026-11-16";
  assert.equal(run("2026-11-16", { ok: false }).length, 0);
  assert.equal(run("2026-11-17", { ok: true, already: true }).length, 0);
  assert.equal(state["glados:fixture"].streak, 0);
  assert.equal(run("2026-11-20", { ok: false }).length, 0);
  assert.equal(state["glados:fixture"].streak, 1);
  run("2026-11-21", { ok: false, skipped: true });
  assert.equal(state["glados:fixture"].streak, 0);
  assert.equal(
    evaluateFailures(
      {},
      [
        {
          ...account,
          lastCheckinAt: "2026-11-15T04:00:00Z",
          lastCheckin: { ok: false },
        },
      ],
      { now: new Date("2026-11-20T04:00:00Z") },
    ).alerts.length,
    0,
  );
});
