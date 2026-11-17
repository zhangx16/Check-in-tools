module.exports = function createRoutes(context) {
const { formatDateTime, readAccounts, writeProviderAccounts, APP_API_TOKEN, isAppTokenAuthorized, sendJson, readRequestBody, PROVIDER_DEFAULT_BASE, providerLabel, setProjectName, applyProjectNames, readEmbykeeperForm, deleteMobileTelegramBot, buildMobileSummary } = context;
return async function route(req,res,url) {
const pathname=url.pathname, method=req.method||"GET";
if (method === "GET" && pathname === "/api/v1/summary") {
      sendJson(res, 200, await buildMobileSummary(req));
      return;
    }
const dashboardProjectMatch = pathname.match(/^\/api\/v1\/dashboard\/projects\/([^/]+)$/);
if (method === "PATCH" && dashboardProjectMatch) {
      const projectId = decodeURIComponent(dashboardProjectMatch[1]);
      const body = await readRequestBody(req);
      if (typeof body.name !== "string" || [...body.name.trim()].length > 60 || /[\x00-\x1f\x7f]/.test(body.name)) {
        sendJson(res, 400, { error: "名称须为不超过 60 字的单行文本，留空恢复默认" });
        return;
      }
      let defaultTitle;
      if (projectId.startsWith("web:")) {
        const provider = projectId.slice(4);
        if (Object.hasOwn(PROVIDER_DEFAULT_BASE, provider) && readAccounts().some(a => a.provider === provider)) defaultTitle = providerLabel(provider);
      } else if (projectId.startsWith("tg:")) {
        const bot = readEmbykeeperForm().botTemplates.find(b => String(b.botUsername || "").replace(/^@/, "").toLowerCase() === projectId.slice(3).toLowerCase());
        if (bot) defaultTitle = bot.name || bot.botUsername;
      }
      if (!defaultTitle) {
        sendJson(res, 404, { error: "项目不存在" });
        return;
      }
      const name = body.name.trim();
      setProjectName(projectId, name);
      sendJson(res, 200, { ok: true, id: projectId, title: name || defaultTitle, defaultTitle });
      return;
    }
if (method === "DELETE" && dashboardProjectMatch) {
      const projectId = decodeURIComponent(dashboardProjectMatch[1]);
      if (projectId.startsWith("tg:")) {
        const result = deleteMobileTelegramBot(projectId.slice(3));
        sendJson(res, result.ok ? 200 : 404, result);
      } else if (projectId.startsWith("web:")) {
        const provider = projectId.slice(4);
        if (!Object.hasOwn(PROVIDER_DEFAULT_BASE, provider) || !readAccounts().some(a => a.provider === provider)) {
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
        auth: isAppTokenAuthorized(req) ? "token" : "session"
      });
      return;
    }
if (method === "GET" && pathname === "/api/v1/dashboard") {
      const summary = await buildMobileSummary(req);
      // Keep dashboard aggregates explicit when only some accounts completed.
      for (const project of summary.projects) {
        const statuses = (project.accounts || []).map(a => a.status);
        if (statuses.includes("skipped") && statuses.some(s => s === "success" || s === "already") && !statuses.includes("failed")) {
          project.status = "partial";
        }
        if (project.status === "pending") project.status = "unknown";
      }
      const form = readEmbykeeperForm();
      const configuredBots = new Set((form.botTemplates || []).map(b => String(b.botUsername || "").replace(/^@/, "").toLowerCase()));
      // A worker already in flight can finish after deletion; hide orphaned results.
      summary.projects = summary.projects.filter(p => p.kind !== "telegram_bot" || configuredBots.has(String(p.botUsername || "").toLowerCase()));
      const existing = new Set(summary.projects.filter(p => p.botUsername).map(p => p.botUsername.toLowerCase()));
      for (const bot of form.botTemplates || []) {
        const username = String(bot.botUsername || "").replace(/^@/, "").trim();
        if (!username || existing.has(username.toLowerCase())) continue;
        existing.add(username.toLowerCase());
        const targets = bot.targetPhones || bot.target_phones || [];
        const accounts = (form.telegramAccounts || [])
          .filter(a => a.enabled !== false && a.checkiner !== false && (!targets.length || targets.includes(a.phone)))
          .map(a => ({ accountName: a.phone, phone: a.phone, status: "unknown", checkedAt: "", message: "暂无签到记录" }));
        summary.projects.push({ id: `tg:${username}`, kind: "telegram_bot", title: bot.name || username,
          subtitle: `@${username}`, botUsername: username, status: "unknown", accountCount: accounts.length,
          checkedAt: "", accounts });
      }
      sendJson(res, 200, { projects: applyProjectNames(summary.projects), generatedAt: new Date().toISOString() });
      return;
    }
};
};
