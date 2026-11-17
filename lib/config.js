"use strict";
function readConfig(env = process.env, { validate = true } = {}) {
  const config = {
    ADMIN_USER: env.ADMIN_USER || "admin",
    ADMIN_PASS: env.ADMIN_PASS || "",
    SESSION_SECRET: env.SESSION_SECRET || "",
    APP_API_TOKEN: String(env.APP_API_TOKEN || env.CHECKIN_API_TOKEN || "").trim(),
    APP_API_TOKEN_SECONDARY: String(env.APP_API_TOKEN_SECONDARY || "").trim()
  };
  if (validate) {
    for (const key of ["ADMIN_PASS", "SESSION_SECRET", "APP_API_TOKEN", "APP_API_TOKEN_SECONDARY"]) {
      const value = config[key];
      if ((key.startsWith("APP_") && !value)) continue;
      if (value.length < 16 || value.startsWith("change-this-")) {
        throw new Error(`${key} must contain at least 16 characters and must not use a default value`);
      }
    }
  }
  return Object.freeze(config);
}
module.exports = { readConfig };
