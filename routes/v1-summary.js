module.exports = function createRoutes(context) {
  const {
    buildDashboard,
    formatDateTime,
    readAccounts,
    writeProviderAccounts,
    APP_API_TOKEN,
    isAppTokenAuthorized,
    sendJson,
    readRequestBody,
    PROVIDER_DEFAULT_BASE,
    providerLabel,
    setProjectName,
    applyProjectNames,
    readEmbykeeperForm,
    deleteMobileTelegramBot,
    buildMobileSummary,
  } = context;
  return async function route(req, res, url) {
    const pathname = url.pathname,
      method = req.method || "GET";
    if (method === "GET" && pathname === "/api/v1/summary") {
      sendJson(res, 200, await buildMobileSummary(req));
      return;
    }
    const dashboardProjectMatch = pathname.match(
      /^\/api\/v1\/dashboard\/projects\/([^/]+)$/,
    );
    if (method === "PATCH" && dashboardProjectMatch) {
      const projectId = decodeURIComponent(dashboardProjectMatch[1]);
      const body = await readRequestBody(req);
      if (
        typeof body.name !== "string" ||
        [...body.name.trim()].length > 60 ||
        /[\x00-\x1f\x7f]/.test(body.name)
      ) {
        sendJson(res, 400, {
          error: "名称须为不超过 60 字的单行文本，留空恢复默认",
        });
        return;
      }
      let defaultTitle;
      if (projectId.startsWith("web:")) {
        const provider = projectId.slice(4);
        if (
          Object.hasOwn(PROVIDER_DEFAULT_BASE, provider) &&
          readAccounts().some((a) => a.provider === provider)
        )
          defaultTitle = providerLabel(provider);
      } else if (projectId.startsWith("tg:")) {
        const bot = readEmbykeeperForm().botTemplates.find(
          (b) =>
            String(b.botUsername || "")
              .replace(/^@/, "")
              .toLowerCase() === projectId.slice(3).toLowerCase(),
        );
        if (bot) defaultTitle = bot.name || bot.botUsername;
      }
      if (!defaultTitle) {
        sendJson(res, 404, { error: "项目不存在" });
        return;
      }
      const name = body.name.trim();
      setProjectName(projectId, name);
      sendJson(res, 200, {
        ok: true,
        id: projectId,
        title: name || defaultTitle,
        defaultTitle,
      });
      return;
    }
    if (method === "DELETE" && dashboardProjectMatch) {
      const projectId = decodeURIComponent(dashboardProjectMatch[1]);
      if (projectId.startsWith("tg:")) {
        const result = deleteMobileTelegramBot(projectId.slice(3));
        sendJson(res, result.ok ? 200 : 404, result);
      } else if (projectId.startsWith("web:")) {
        const provider = projectId.slice(4);
        if (
          !Object.hasOwn(PROVIDER_DEFAULT_BASE, provider) ||
          !readAccounts().some((a) => a.provider === provider)
        ) {
          sendJson(res, 404, { error: "项目不存在" });
          return;
        }
        writeProviderAccounts(provider, []);
        setProjectName(projectId, "");
        sendJson(res, 200, { ok: true, deletedId: projectId });
      } else {
        sendJson(res, 404, { error: "项目不存在" });
      }
      return;
    }
    if (method === "GET" && pathname === "/api/v1/health") {
      sendJson(res, 200, {
        ok: true,
        now: formatDateTime(),
        appTokenConfigured: Boolean(APP_API_TOKEN),
        auth: isAppTokenAuthorized(req) ? "token" : "session",
      });
      return;
    }
    if (method === "GET" && pathname === "/api/v1/dashboard") {
      sendJson(res, 200, await buildDashboard(req));
      return;
    }
  };
};
