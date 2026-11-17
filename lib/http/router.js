const { sendJson } = require("./respond");
function createRouter(context) {
  const routes = Object.fromEntries(
    [
      "v1-emby-keepalive",
      "v1-workbuddy",
      "v1-summary",
      "v1-telegram",
      "v1-accounts",
      "session",
      "web-embykeeper",
      "web-accounts",
    ].map((name) => [name, require("../../routes/" + name)(context)]),
  );
  return async (req, res, url) => {
    const p = url.pathname;
    if (
      [
        "/api/health",
        "/api/healthz",
        "/api/login",
        "/api/logout",
        "/api/session",
      ].includes(p)
    )
      return routes.session(req, res, url);
    if (p.startsWith("/api/v1/")) {
      if (!context.requireAppOrSessionAuth(req, res)) return;
      const name = p.startsWith("/api/v1/emby/keepalive")
        ? "v1-emby-keepalive"
        : p.startsWith("/api/v1/workbuddy/")
          ? "v1-workbuddy"
          : p.startsWith("/api/v1/telegram/")
            ? "v1-telegram"
            : /^\/api\/v1\/(summary|dashboard|health)(\/|$)/.test(p)
              ? "v1-summary"
              : "v1-accounts";
      await routes[name](req, res, url);
    } else {
      if (!context.requireAuth(req, res, url)) return;
      await routes[
        p.startsWith("/api/embykeeper/") ? "web-embykeeper" : "web-accounts"
      ](req, res, url);
    }
    if (!res.writableEnded) sendJson(res, 404, { error: "Not Found" });
  };
}
module.exports = { createRouter };
