module.exports = function createRoutes(context) {
  const {
    telegramJobs,
    publicTelegramForm,
    publicTelegramConfig,
    updateTelegramConfig,
    persistEmbykeeperForm,
    config,
    sendJson,
    readRequestBody,
    readEmbykeeperConfig,
    writeEmbykeeperConfig,
    normalizeEmbykeeperForm,
    readEmbykeeperForm,
    readTelegramCheckinResults,
    writeEmbykeeperForm,
    renderEmbykeeperConfigFromForm,
    getEmbykeeperStatus,
    runEmbykeeperOnce,
  } = context;
  return async function route(req, res, url) {
    const pathname = url.pathname,
      method = req.method || "GET";
    if (method === "GET" && pathname === "/api/embykeeper/status") {
      sendJson(res, 200, { status: getEmbykeeperStatus() });
      return;
    }
    if (method === "GET" && pathname === "/api/embykeeper/config") {
      sendJson(res, 200, {
        status: getEmbykeeperStatus(),
        config: publicTelegramConfig(),
      });
      return;
    }
    if (method === "GET" && pathname === "/api/embykeeper/form") {
      sendJson(res, 200, {
        status: getEmbykeeperStatus(),
        form: publicTelegramForm(),
        checkinResults: readTelegramCheckinResults(),
      });
      return;
    }
    if (method === "PUT" && pathname === "/api/embykeeper/config") {
      const body = await readRequestBody(req);
      updateTelegramConfig(body?.config ?? "");
      sendJson(res, 200, {
        ok: true,
        status: getEmbykeeperStatus(),
      });
      return;
    }
    if (method === "PUT" && pathname === "/api/embykeeper/form") {
      const body = await readRequestBody(req);
      const form = persistEmbykeeperForm(body?.form || {});
      sendJson(res, 200, {
        ok: true,
        status: getEmbykeeperStatus(),
        form: publicTelegramForm(form),
        config: publicTelegramConfig(),
      });
      return;
    }
    if (method === "GET" && pathname === "/api/embykeeper/job") {
      sendJson(res, 200, telegramJobs.get());
      return;
    }
    if (method === "POST" && pathname === "/api/embykeeper/run") {
      sendJson(res, 202, {
        ok: true,
        job: telegramJobs.launch(),
        output: "",
        error: "",
        status: getEmbykeeperStatus(),
        checkinResults: readTelegramCheckinResults(),
      });
      return;
    }
  };
};
