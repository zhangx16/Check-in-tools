"use strict";
function readConfig(env = process.env, { validate = true } = {}) {
  const config = {
    HOST: env.HOST || "127.0.0.1",
    PORT: Number(env.PORT || 22821),
    REQUEST_TIMEOUT_MS: Number(env.REQUEST_TIMEOUT_MS || 20000),
    ADMIN_USER: env.ADMIN_USER || "admin",
    ADMIN_PASS: env.ADMIN_PASS || "",
    SESSION_SECRET: env.SESSION_SECRET || "",
    APP_API_TOKEN: String(
      env.APP_API_TOKEN || env.CHECKIN_API_TOKEN || "",
    ).trim(),
    APP_API_TOKEN_SECONDARY: String(env.APP_API_TOKEN_SECONDARY || "").trim(),
  };
  if (validate) {
    if (
      !Number.isInteger(config.PORT) ||
      config.PORT < 0 ||
      config.PORT > 65535
    )
      throw Error("PORT must be an integer between 0 and 65535");
    if (
      !Number.isFinite(config.REQUEST_TIMEOUT_MS) ||
      config.REQUEST_TIMEOUT_MS < 1
    )
      throw Error("REQUEST_TIMEOUT_MS must be positive");
    for (const key of [
      "ADMIN_PASS",
      "SESSION_SECRET",
      "APP_API_TOKEN",
      "APP_API_TOKEN_SECONDARY",
    ]) {
      const value = config[key];
      if (key.startsWith("APP_") && !value) continue;
      if (
        value.length < 16 ||
        value.startsWith("change-this-") ||
        value.startsWith("replace-with-")
      ) {
        throw new Error(
          `${key} must contain at least 16 characters and must not use a default value`,
        );
      }
    }
  }
  return Object.freeze(config);
}
module.exports = { readConfig };
