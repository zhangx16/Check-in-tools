module.exports = function createRoutes(context) {
  const {
    telegramJobs,
    PROJECT_ROOT,
    fs,
    path,
    sendJson,
    readRequestBody,
    readEmbykeeperForm,
    listMobileTelegramBots,
    persistEmbykeeperForm,
    updateMobileTelegramBot,
    deleteMobileTelegramBot,
    deleteMobileTelegramPhone,
    removePhoneFromTelegramBot,
  } = context;
  return async function route(req, res, url) {
    const pathname = url.pathname,
      method = req.method || "GET";
    if (pathname === "/api/v1/telegram/jobs" && method === "POST") {
      sendJson(res, 202, telegramJobs.launch());
      return;
    }
    if (pathname === "/api/v1/telegram/jobs" && method === "GET") {
      sendJson(res, 200, telegramJobs.get());
      return;
    }
    if (method === "GET" && pathname === "/api/v1/telegram/catalog") {
      const catalog = JSON.parse(
        fs.readFileSync(
          path.join(PROJECT_ROOT, "templates/telegram_bot_catalog.json"),
          "utf8",
        ),
      );
      const existing = new Set(
        readEmbykeeperForm().botTemplates.map((b) =>
          b.botUsername.replace(/^@/, "").toLowerCase(),
        ),
      );
      sendJson(res, 200, {
        ...catalog,
        bots: catalog.bots.map((b) => ({
          ...b,
          configured: existing.has(b.botUsername.toLowerCase()),
        })),
      });
      return;
    }
    if (method === "POST" && pathname === "/api/v1/telegram/catalog") {
      const body = await readRequestBody(req);
      const catalog = JSON.parse(
        fs.readFileSync(
          path.join(PROJECT_ROOT, "templates/telegram_bot_catalog.json"),
          "utf8",
        ),
      );
      const profile = catalog.bots.find((b) => b.id === body.id);
      if (!profile || !profile.available) {
        sendJson(res, 400, { error: "此 Bot 需要专用流程，目前尚未独立适配" });
        return;
      }
      const form = readEmbykeeperForm();
      if (
        form.botTemplates.some(
          (b) =>
            b.botUsername.replace(/^@/, "").toLowerCase() ===
            profile.botUsername.toLowerCase(),
        )
      ) {
        sendJson(res, 409, { error: "该机器人已添加" });
        return;
      }
      const { id, available, upstreamDefault, reason, ...bot } = profile;
      form.botTemplates.push({ ...bot, targetPhones: [] });
      persistEmbykeeperForm(form);
      sendJson(res, 201, { ok: true, botUsername: bot.botUsername });
      return;
    }
    if (method === "GET" && pathname === "/api/v1/telegram/bots") {
      sendJson(res, 200, listMobileTelegramBots());
      return;
    }
    const v1TgBotMatch = pathname.match(/^\/api\/v1\/telegram\/bots\/([^/]+)$/);
    if (v1TgBotMatch) {
      const botUsername = decodeURIComponent(v1TgBotMatch[1]).replace(/^@/, "");
      if (method === "PUT") {
        const body = await readRequestBody(req);
        const result = updateMobileTelegramBot(botUsername, body || {});
        if (!result.ok) {
          sendJson(res, 404, { error: result.error });
          return;
        }
        sendJson(res, 200, result);
        return;
      }
      if (method === "DELETE") {
        const result = deleteMobileTelegramBot(botUsername);
        if (!result.ok) {
          sendJson(res, 404, { error: result.error });
          return;
        }
        sendJson(res, 200, result);
        return;
      }
    }
    const v1TgPhoneMatch = pathname.match(
      /^\/api\/v1\/telegram\/phones\/([^/]+)$/,
    );
    if (v1TgPhoneMatch && method === "DELETE") {
      const phone = decodeURIComponent(v1TgPhoneMatch[1]);
      const result = deleteMobileTelegramPhone(phone);
      if (!result.ok) {
        sendJson(res, 404, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
      return;
    }
    const v1TgBotPhoneMatch = pathname.match(
      /^\/api\/v1\/telegram\/bots\/([^/]+)\/phones\/([^/]+)$/,
    );
    if (v1TgBotPhoneMatch && method === "DELETE") {
      const botUsername = decodeURIComponent(v1TgBotPhoneMatch[1]).replace(
        /^@/,
        "",
      );
      const phone = decodeURIComponent(v1TgBotPhoneMatch[2]);
      const result = removePhoneFromTelegramBot(botUsername, phone);
      if (!result.ok) {
        sendJson(res, 404, { error: result.error });
        return;
      }
      sendJson(res, 200, result);
      return;
    }
  };
};
