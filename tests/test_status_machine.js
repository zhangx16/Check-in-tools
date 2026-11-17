const test = require("node:test"),
  assert = require("node:assert/strict");
const factory = require("../domain/status"),
  { isAlreadyCheckedInMessage } = require("../lib/common");
const status = factory({ isAlreadyCheckedInMessage });
test("project aggregation has a single partial state without changing individual check-in judgments", () => {
  for (const [states, expected] of [
    [[], "unknown"],
    [["success", "already"], "success"],
    [["already", "already"], "already"],
    [["skipped"], "skipped"],
    [["success", "skipped"], "partial"],
    [["failed", "success"], "failed"],
    [["pending", "unknown"], "pending"],
    [["unknown"], "unknown"],
  ])
    assert.equal(status.aggregateProjectStatus(states), expected);
  assert.equal(status.emptyStatusCounts().partial, 0);
  assert.equal(factory.STATUSES.length, 7);
  for (const [checkin, expected] of [
    [{ ok: true }, "success"],
    [{ ok: true, already: true }, "already"],
    [{ ok: false, skipped: true }, "skipped"],
    [{ ok: false }, "failed"],
  ])
    assert.equal(
      status.deriveWebsiteItemStatus({ lastCheckin: checkin }),
      expected,
    );
  assert.equal(
    status.deriveWebsiteItemStatus({
      provider: "workbuddy",
      lastCheckin: { ok: false, skipped: true },
    }),
    "failed",
  );
  assert.equal(
    status.deriveWebsiteItemStatus({ lastStatus: { todaySigned: true } }),
    "already",
  );
  assert.equal(status.deriveWebsiteItemStatus({}), "pending");
  assert.equal(
    status.deriveWebsiteItemStatus({ lastStatus: { ok: false } }),
    "failed",
  );
  assert.equal(
    status.deriveWebsiteItemStatus({ lastStatus: { ok: true, message: "ok" } }),
    "unknown",
  );
  for (const [account, bot, expected] of [
    [{ skipped: true }, {}, "skipped"],
    [{ already: true }, {}, "already"],
    [{ ok: true }, {}, "success"],
    [{ ok: false }, {}, "failed"],
    [{}, { status: "success" }, "success"],
    [{}, { status: "skipped" }, "skipped"],
    [{}, { status: "error" }, "failed"],
    [{}, {}, "unknown"],
  ])
    assert.equal(status.accountStatusFromTelegramAcc(account, bot), expected);
});
