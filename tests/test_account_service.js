const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { normalizeBaseUrl, formatDateTime } = require("../lib/common"),
  workbuddy = require("../lib/providers/workbuddy");
const { getProvider } = require("../lib/providers");
function service(accounts = []) {
  const defaults = {
    glados: "https://glados.network",
    embymb: "https://example.test",
    embypulse: "https://example.test",
    vpsnat: "https://example.test",
    zzcat: "https://example.test",
    thxnk: "https://example.test",
    workbuddy: workbuddy.DEFAULT_BASE_URL,
  };
  return require("../domain/account-service")({
    crypto,
    formatDateTime,
    normalizeBaseUrl,
    workbuddy,
    SESSION_SECRET: "test-fingerprint-secret",
    readProviderAccounts: (p) => accounts.filter((a) => a.provider === p),
    PROVIDER_DEFAULT_BASE: defaults,
    DEFAULT_GLADOS_BASE_URL: defaults.glados,
    DEFAULT_EMBYMB_BASE_URL: defaults.embymb,
    DEFAULT_EMBYPULSE_BASE_URL: defaults.embypulse,
    DEFAULT_VPSNAT_BASE_URL: defaults.vpsnat,
  });
}
test("provider registry rejects unknown keys and account validation detects duplicate identities", () => {
  const api = service([
    { id: "one", provider: "embymb", username: "sample" },
    { id: "two", provider: "glados", cookie: "fixture-cookie" },
  ]);
  assert.throws(() => api.normalizeProvider("typo"));
  assert.throws(() => getProvider("typo"));
  assert.match(
    api.validateAccount(
      api.normalizeAccountInput({
        provider: "embymb",
        name: "duplicate",
        username: "sample",
        password: "fixture",
      }),
    ),
    /已存在/,
  );
  assert.match(
    api.validateAccount(
      api.normalizeAccountInput({
        provider: "glados",
        name: "duplicate",
        cookie: "fixture-cookie",
      }),
    ),
    /已存在/,
  );
  assert.equal(
    api.validateAccount(
      api.normalizeAccountInput({
        provider: "thxnk",
        name: "separate-provider",
        username: "sample",
        password: "fixture",
      }),
    ),
    "",
  );
  assert.equal(
    api.normalizeAccountMobileUpdate(
      { password: "" },
      {
        id: "one",
        provider: "embymb",
        name: "sample",
        username: "sample",
        password: "preserved",
      },
    ).password,
    "preserved",
  );
  assert.match(
    api.validateAccount(
      api.normalizeAccountInput({
        name: "fixture",
        cookie: "x",
        notes: "x".repeat(4001),
      }),
    ),
    /4000/,
  );
});
