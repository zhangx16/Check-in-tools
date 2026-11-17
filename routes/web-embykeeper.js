module.exports = function createRoutes(context) {
const { config, sendJson, readRequestBody, readEmbykeeperConfig, writeEmbykeeperConfig, normalizeEmbykeeperForm, readEmbykeeperForm, readTelegramCheckinResults, writeEmbykeeperForm, renderEmbykeeperConfigFromForm, getEmbykeeperStatus, runEmbykeeperOnce } = context;
return async function route(req,res,url) {
const pathname=url.pathname, method=req.method||"GET";
if (method === "GET" && pathname === "/api/embykeeper/status") {
    sendJson(res, 200, { status: getEmbykeeperStatus() });
    return;
  }
if (method === "GET" && pathname === "/api/embykeeper/config") {
    sendJson(res, 200, {
      status: getEmbykeeperStatus(),
      config: readEmbykeeperConfig()
    });
    return;
  }
if (method === "GET" && pathname === "/api/embykeeper/form") {
    sendJson(res, 200, {
      status: getEmbykeeperStatus(),
      form: readEmbykeeperForm(),
      checkinResults: readTelegramCheckinResults()
    });
    return;
  }
if (method === "PUT" && pathname === "/api/embykeeper/config") {
    const body = await readRequestBody(req);
    writeEmbykeeperConfig(body?.config ?? "");
    sendJson(res, 200, {
      ok: true,
      status: getEmbykeeperStatus()
    });
    return;
  }
if (method === "PUT" && pathname === "/api/embykeeper/form") {
    const body = await readRequestBody(req);
    const form = normalizeEmbykeeperForm(body?.form || {});
    writeEmbykeeperForm(form);
    writeEmbykeeperConfig(renderEmbykeeperConfigFromForm(form));
    sendJson(res, 200, {
      ok: true,
      status: getEmbykeeperStatus(),
      form,
      config: readEmbykeeperConfig()
    });
    return;
  }
if (method === "POST" && pathname === "/api/embykeeper/run") {
    const result = await runEmbykeeperOnce();
    sendJson(res, result.ok ? 200 : 500, {
      ok: result.ok,
      output: result.output,
      error: result.error,
      status: getEmbykeeperStatus(),
      checkinResults: readTelegramCheckinResults()
    });
    return;
  }
};
};
