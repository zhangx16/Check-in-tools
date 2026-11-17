module.exports = function createRoutes(context) {
  const {
    formatDateTime,
    HOST,
    PORT,
    ADMIN_USER,
    isAuthenticated,
    setAuthCookies,
    clearAuthCookies,
    checkLogin,
    sendJson,
    readRequestBody,
  } = context;
  return async function route(req, res, url) {
    const pathname = url.pathname,
      method = req.method || "GET";
    if (method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        host: HOST,
        port: PORT,
        now: formatDateTime(),
      });
      return;
    }
    if (method === "POST" && pathname === "/api/login") {
      const body = await readRequestBody(req);
      const username = String(body?.username || "").trim();
      const password = String(body?.password || "");

      if (!checkLogin(req, username, password)) {
        sendJson(res, 401, { error: "用户名或密码错误" });
        return;
      }

      setAuthCookies(req, res);
      sendJson(res, 200, { ok: true, username: ADMIN_USER });
      return;
    }
    if (method === "POST" && pathname === "/api/logout") {
      clearAuthCookies(req, res);
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (method === "GET" && pathname === "/api/session") {
      if (!isAuthenticated(req)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      sendJson(res, 200, { ok: true, username: ADMIN_USER });
      return;
    }
  };
};
