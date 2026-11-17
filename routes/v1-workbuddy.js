module.exports = function createRoutes(context) {
  const {
    workbuddyJobs,
    workbuddyLogin,
    readProviderAccounts,
    sendJson,
    readRequestBody,
    toPublicAccount,
  } = context;
  return async function route(req, res, url) {
    const pathname = url.pathname,
      method = req.method || "GET";
    if (pathname === "/api/v1/workbuddy/accounts" && method === "GET") {
      sendJson(res, 200, {
        accounts: readProviderAccounts("workbuddy").map(toPublicAccount),
      });
      return;
    }
    if (pathname === "/api/v1/workbuddy/logins" && method === "POST") {
      try {
        sendJson(
          res,
          201,
          await workbuddyLogin.create(await readRequestBody(req), (id) =>
            workbuddyJobs.launch(id, "auto"),
          ),
        );
      } catch (error) {
        sendJson(res, error.status || 400, { error: error.message });
      }
      return;
    }
    const wbLoginMatch = pathname.match(
      /^\/api\/v1\/workbuddy\/logins\/([a-f0-9]{48})$/,
    );
    if (wbLoginMatch && ["GET", "DELETE"].includes(method)) {
      try {
        sendJson(
          res,
          200,
          method === "DELETE"
            ? workbuddyLogin.cancel(wbLoginMatch[1])
            : workbuddyLogin.get(wbLoginMatch[1]),
        );
      } catch (error) {
        sendJson(res, error.status || 400, { error: error.message });
      }
      return;
    }
    const wbJobMatch = pathname.match(
      /^\/api\/v1\/workbuddy\/accounts\/([^/]+)\/(run|job)$/,
    );
    if (wbJobMatch) {
      try {
        const id = decodeURIComponent(wbJobMatch[1]);
        if (method === "POST" && wbJobMatch[2] === "run") {
          const body = await readRequestBody(req);
          sendJson(res, 202, workbuddyJobs.launch(id, body?.action || "auto"));
          return;
        }
        if (method === "GET" && wbJobMatch[2] === "job") {
          sendJson(res, 200, workbuddyJobs.get(id));
          return;
        }
        sendJson(res, 405, { error: "不支持的请求方式" });
      } catch (error) {
        sendJson(res, error.status || 400, { error: error.message });
      }
      return;
    }
  };
};
