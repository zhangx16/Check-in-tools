const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  withInsecureTls,
  runConcurrent,
  isAlreadyCheckedInMessage,
  mergeCookieHeaders,
  formatMinorAmount,
  cloneData
} = require("../lib/common");
const { providerKey, getProvider } = require("../lib/providers");

test("withInsecureTls restores NODE_TLS_REJECT_UNAUTHORIZED", async () => {
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const seen = [];
  await withInsecureTls(true, async () => {
    seen.push(process.env.NODE_TLS_REJECT_UNAUTHORIZED);
  });
  assert.equal(seen[0], "0");
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});

test("withInsecureTls serializes concurrent insecure calls", async () => {
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const order = [];
  await Promise.all([
    withInsecureTls(true, async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("a-end");
    }),
    withInsecureTls(true, async () => {
      order.push("b-start");
      order.push("b-end");
    })
  ]);
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});

test("runConcurrent preserves order", async () => {
  const results = await runConcurrent([1, 2, 3, 4], async (n) => {
    await new Promise((resolve) => setTimeout(resolve, 15 - n * 3));
    return n * 10;
  }, 2);
  assert.deepEqual(results, [10, 20, 30, 40]);
});

test("provider dispatcher falls back to glados", () => {
  assert.equal(providerKey({}), "glados");
  assert.equal(providerKey({ provider: "embymb" }), "embymb");
  assert.equal(getProvider("embypulse").runAccountCheckin.name, "runAccountCheckin");
  assert.throws(() => getProvider({ provider: "unknown" }), /未知 provider/);
});

test("already-checked-in detection covers common messages", () => {
  assert.equal(isAlreadyCheckedInMessage("今天已经签到过了"), true);
  assert.equal(isAlreadyCheckedInMessage("Please try tomorrow"), true);
  assert.equal(isAlreadyCheckedInMessage("ok"), false);
});

test("cookie merge and minor amount helpers", () => {
  assert.equal(mergeCookieHeaders("a=1; b=2", "b=3; c=4"), "a=1; b=3; c=4");
  assert.equal(formatMinorAmount(1234), "12.34");
  assert.deepEqual(cloneData({ a: 1 }), { a: 1 });
});

test("accounts cache returns copies and respects mtime", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "checkin-accounts-"));
  const originalEnv = { ...process.env };
  process.env.WORKBUDDY_ACCOUNTS_FILE = path.join(tmp, "workbuddy.json");
  process.env.THXNK_ACCOUNTS_FILE = path.join(tmp, "thxnk.json");
  process.env.GLADOS_ACCOUNTS_FILE = path.join(tmp, "accounts.json");
  process.env.ZZCAT_ACCOUNTS_FILE = path.join(tmp, "zzcat.json");
  process.env.EMBYPULSE_ACCOUNTS_FILE = path.join(tmp, "embypulse.json");
  process.env.VPSNAT_ACCOUNTS_FILE = path.join(tmp, "vpsnat.json");
  process.env.EMBYMB_ACCOUNTS_FILE = path.join(tmp, "embymb.json");

  const accountsPath = path.join(__dirname, "..", "lib", "accounts.js");
  delete require.cache[require.resolve(accountsPath)];
  const accounts = require(accountsPath);

  accounts.writeProviderAccounts("glados", [{ id: "1", name: "one", cookie: "abc" }]);
  const first = accounts.readAccounts();
  first[0].name = "mutated";
  const second = accounts.readAccounts();
  assert.equal(second[0].name, "one");

  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  delete require.cache[require.resolve(accountsPath)];
});
