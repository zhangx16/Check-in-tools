module.exports = function createService(context) {
  const {
    fs,
    formatDateTime,
    pickNumber,
    readAccounts,
    HOST,
    PORT,
    APP_API_TOKEN,
    isHttpsRequest,
    EMBYKEEPER_FORM_FILE,
    TELEGRAM_CHECKIN_RESULTS_FILE,
    PROJECT_NAMES_FILE,
    BOT_AVATAR_DIR,
    SITE_ICON_DIR,
    PROVIDER_DEFAULT_BASE,
    providerLabel,
    applyProjectNames,
    readEmbykeeperForm,
    readTelegramCheckinResults,
    getEmbykeeperStatus,
    toPublicAccount,
    emptyStatusCounts,
    deriveWebsiteItemStatus,
    accountStatusFromTelegramAcc,
    aggregateProjectStatus,
    getSiteIcon,
    getBotAvatar,
  } = context;
  function mapWebsiteAccountToSummaryItem(account) {
    const provider =
      String(account.provider || "glados")
        .trim()
        .toLowerCase() || "glados";
    const checkin = account.lastCheckin || {};
    const status = account.lastStatus || {};
    const itemStatus = deriveWebsiteItemStatus(account);
    const streak = pickNumber(
      checkin.raw?.data?.current_streak,
      checkin.currentStreak,
      status.currentStreak,
    );
    const leftDays =
      status.leftDays ??
      checkin.leftDays ??
      checkin.raw?.data?.leftDays ??
      null;
    const pointsDelta = pickNumber(
      checkin.points,
      checkin.raw?.data?.daily_points,
      checkin.raw?.data?.total_today,
    );
    const balance = pickNumber(
      checkin.balance,
      checkin.currentPoints,
      checkin.raw?.data?.current_points,
      checkin.raw?.data?.total_points,
      status.points,
      status.totalPoints,
    );

    return {
      id: String(account.id || ""),
      kind: provider === "workbuddy" ? "workbuddy" : "website",
      provider,
      providerLabel: providerLabel(provider),
      accountName: account.name || "",
      status: itemStatus,
      ok: itemStatus === "success" || itemStatus === "already",
      message: String(checkin.message || status.message || "").trim(),
      checkedAt: account.lastCheckinAt || account.lastStatusAt || "",
      pointsDelta,
      balance,
      currency: String(
        checkin.currency || status.currency || status.plan || "",
      ).trim(),
      streak,
      leftDays:
        leftDays === null || leftDays === undefined ? null : String(leftDays),
      todaySigned: Boolean(
        checkin.already ||
          checkin.todaySigned ||
          status.todaySigned ||
          itemStatus === "already" ||
          itemStatus === "success",
      ),
      notes: account.notes || "",
    };
  }
  function publicBaseFromRequest(req) {
    const host = String(req?.headers?.host || `${HOST}:${PORT}`).trim();
    const proto = isHttpsRequest(req) ? "https" : "http";
    return `${proto}://${host}`;
  }
  function mapTelegramResultsToSummaryItems(results) {
    const items = [];
    const bots =
      results && typeof results === "object" ? results.bots || {} : {};
    const updatedAt = results?.updatedAt || "";
    // Honor per-bot targetPhones from form so removed phones disappear from summary.
    const form = readEmbykeeperForm();
    const targetByBot = new Map();
    for (const tpl of form.botTemplates || []) {
      const key = String(tpl.botUsername || "").replace(/^@/, "");
      const phones = Array.isArray(tpl.targetPhones)
        ? tpl.targetPhones.map((p) => String(p || "").trim()).filter(Boolean)
        : [];
      targetByBot.set(key, phones);
    }
    // Only list bots still configured in form (deleted bot tasks stay gone).
    const configuredBots = new Set(targetByBot.keys());

    for (const [botKey, bot] of Object.entries(bots)) {
      if (!bot || typeof bot !== "object") continue;
      const botUsername = String(bot.botUsername || botKey || "")
        .trim()
        .replace(/^@/, "");
      if (configuredBots.size && !configuredBots.has(botUsername)) {
        continue;
      }
      const botName = String(bot.name || botUsername || botKey).trim();
      let accounts = Array.isArray(bot.accounts) ? bot.accounts : [];
      const allowed = targetByBot.get(botUsername) || [];
      if (allowed.length) {
        accounts = accounts.filter((a) =>
          allowed.includes(String(a?.phone || "").trim()),
        );
      }

      if (!accounts.length) {
        // Bot still configured but no account rows after filter — skip empty project.
        if (allowed.length) continue;
        const status = accountStatusFromTelegramAcc(null, bot);
        items.push({
          id: `tg:${botUsername || botKey}`,
          kind: "telegram_bot",
          provider: "telegram_bot",
          providerLabel: providerLabel("telegram_bot"),
          accountName: botUsername ? `@${botUsername}` : botName,
          botName,
          botUsername,
          status,
          ok: status === "success" || status === "already",
          message: String(bot.message || "").trim(),
          checkedAt: bot.checkedAt || updatedAt || "",
          pointsDelta: null,
          balance: null,
          currency: "",
          streak: null,
          leftDays: null,
          todaySigned: status === "success" || status === "already",
          notes: "",
          phone: "",
        });
        continue;
      }

      for (const acc of accounts) {
        const status = accountStatusFromTelegramAcc(acc, bot);
        const phone = String(acc?.phone || "").trim();
        items.push({
          id: `tg:${botUsername || botKey}:${phone || "default"}`,
          kind: "telegram_bot",
          provider: "telegram_bot",
          providerLabel: providerLabel("telegram_bot"),
          accountName: phone || (botUsername ? `@${botUsername}` : botName),
          botName,
          botUsername,
          status,
          ok: status === "success" || status === "already",
          message: String(acc?.message || bot.message || "").trim(),
          checkedAt: acc?.checkedAt || bot.checkedAt || updatedAt || "",
          pointsDelta: null,
          balance: null,
          currency: "",
          streak: null,
          leftDays: null,
          todaySigned: status === "success" || status === "already",
          notes: "",
          phone,
        });
      }
    }

    return items;
  }
  async function buildSummaryProjects(websiteItems, telegramItems, req) {
    const projects = [];
    const base = publicBaseFromRequest(req);

    // Website: group by provider + site icon (favicon/logo)
    const webByProvider = new Map();
    for (const item of websiteItems) {
      const key = item.provider || "unknown";
      if (!webByProvider.has(key)) webByProvider.set(key, []);
      webByProvider.get(key).push(item);
    }

    // Prefer real baseUrl from stored accounts (icons come from the site itself).
    const baseUrlByProvider = new Map();
    for (const account of readAccounts()) {
      const p =
        String(account.provider || "glados")
          .trim()
          .toLowerCase() || "glados";
      const bu = String(account.baseUrl || "").trim();
      if (bu && !baseUrlByProvider.has(p)) {
        baseUrlByProvider.set(p, bu);
      }
    }

    const webProjects = await Promise.all(
      Array.from(webByProvider.entries()).map(async ([provider, accounts]) => {
        const statuses = accounts.map((a) => a.status);
        const status = aggregateProjectStatus(statuses);
        const counts = emptyStatusCounts();
        for (const s of statuses) {
          const k = counts[s] === undefined ? "unknown" : s;
          counts[k] += 1;
        }
        let checkedAt = "";
        for (const a of accounts) {
          if (a.checkedAt && (!checkedAt || a.checkedAt > checkedAt))
            checkedAt = a.checkedAt;
        }
        const healthy = counts.success + counts.already;
        const siteBase =
          baseUrlByProvider.get(provider) ||
          PROVIDER_DEFAULT_BASE[provider] ||
          "";
        const iconPath = getSiteIcon(provider, siteBase);
        const avatarURL = iconPath ? `${base}${iconPath}` : null;
        return {
          id: `web:${provider}`,
          kind: provider === "workbuddy" ? "workbuddy" : "website",
          provider,
          providerLabel: providerLabel(provider),
          title: providerLabel(provider),
          subtitle: `${accounts.length} 个账号`,
          botUsername: null,
          botName: null,
          avatarURL,
          status,
          ok: status === "success" || status === "already",
          message: `${accounts.length} 账号 · ${healthy} 正常 · ${counts.failed} 失败`,
          checkedAt,
          accountCount: accounts.length,
          counts: {
            total: accounts.length,
            ...counts,
            healthy,
          },
          accounts,
        };
      }),
    );
    projects.push(...webProjects);

    // Telegram: group by botUsername
    const tgByBot = new Map();
    for (const item of telegramItems) {
      const key = String(item.botUsername || item.id || "unknown").replace(
        /^@/,
        "",
      );
      if (!tgByBot.has(key)) tgByBot.set(key, []);
      tgByBot.get(key).push(item);
    }

    // Fetch avatars with limited concurrency
    const botKeys = Array.from(tgByBot.keys());
    const avatarMap = new Map();
    const chunk = 4;
    for (let i = 0; i < botKeys.length; i += chunk) {
      const slice = botKeys.slice(i, i + chunk);
      const results = await Promise.all(
        slice.map(async (username) => {
          const pathOnly = getBotAvatar(username);
          return [username, pathOnly];
        }),
      );
      for (const [username, pathOnly] of results) {
        avatarMap.set(username, pathOnly ? `${base}${pathOnly}` : null);
      }
    }

    for (const [botUsername, accounts] of tgByBot.entries()) {
      const botName = accounts[0]?.botName || botUsername;
      const statuses = accounts.map((a) => a.status);
      const status = aggregateProjectStatus(statuses);
      const counts = emptyStatusCounts();
      for (const s of statuses) {
        const k = counts[s] === undefined ? "unknown" : s;
        counts[k] += 1;
      }
      let checkedAt = "";
      for (const a of accounts) {
        if (a.checkedAt && (!checkedAt || a.checkedAt > checkedAt))
          checkedAt = a.checkedAt;
      }
      const healthy = counts.success + counts.already;
      // Normalize nested account display names to phone / short label
      const nested = accounts.map((a) => ({
        ...a,
        accountName: a.phone || a.accountName || "账号",
      }));
      projects.push({
        id: `tg:${botUsername}`,
        kind: "telegram_bot",
        provider: "telegram_bot",
        providerLabel: providerLabel("telegram_bot"),
        title: botName,
        subtitle: botUsername
          ? `@${botUsername}`
          : providerLabel("telegram_bot"),
        botUsername,
        botName,
        avatarURL: avatarMap.get(botUsername) || null,
        status,
        ok: status === "success" || status === "already",
        message: `${accounts.length} 账号 · ${healthy} 正常 · ${counts.failed} 失败 · ${counts.skipped} 跳过`,
        checkedAt,
        accountCount: accounts.length,
        counts: {
          total: accounts.length,
          ...counts,
          healthy,
        },
        accounts: nested,
      });
    }

    const form = readEmbykeeperForm();
    const configured = new Map(
      form.botTemplates.map((b) => [
        String(b.botUsername || "")
          .replace(/^@/, "")
          .toLowerCase(),
        b,
      ]),
    );
    const visible = projects.filter(
      (p) =>
        p.kind !== "telegram_bot" ||
        configured.has(p.botUsername.toLowerCase()),
    );
    const existing = new Set(
      visible
        .filter((p) => p.botUsername)
        .map((p) => p.botUsername.toLowerCase()),
    );
    for (const [key, bot] of configured) {
      if (!key || existing.has(key)) continue;
      const username = bot.botUsername.replace(/^@/, ""),
        targets = bot.targetPhones || [];
      const accounts = form.telegramAccounts
        .filter(
          (a) =>
            a.enabled !== false &&
            a.checkiner !== false &&
            (!targets.length || targets.includes(a.phone)),
        )
        .map((a) => ({
          accountName: a.phone,
          phone: a.phone,
          status: "unknown",
          checkedAt: "",
          message: "暂无签到记录",
        }));
      visible.push({
        id: `tg:${username}`,
        kind: "telegram_bot",
        provider: "telegram_bot",
        providerLabel: providerLabel("telegram_bot"),
        title: bot.name || username,
        subtitle: `@${username}`,
        botUsername: username,
        status: "unknown",
        accountCount: accounts.length,
        checkedAt: "",
        accounts,
        avatarURL: null,
      });
    }
    return applyProjectNames(visible);
  }
  async function buildMobileSummaryUncached(req) {
    const websiteItems = readAccounts().map((account) =>
      mapWebsiteAccountToSummaryItem(toPublicAccount(account)),
    );
    const telegramResults = readTelegramCheckinResults();
    const telegramItems = mapTelegramResultsToSummaryItems(telegramResults);
    const items = [...websiteItems, ...telegramItems];
    const projects = await buildSummaryProjects(
      websiteItems,
      telegramItems,
      req,
    );

    // Also stamp avatarURL onto flat telegram items for clients that still use items[]
    const avatarByBot = new Map(
      projects
        .filter((p) => p.kind === "telegram_bot")
        .map((p) => [p.botUsername, p.avatarURL]),
    );
    for (const item of items) {
      if (item.kind === "telegram_bot" && item.botUsername) {
        item.avatarURL = avatarByBot.get(item.botUsername) || null;
      } else {
        item.avatarURL = null;
      }
    }

    const counts = emptyStatusCounts();
    for (const item of items) {
      const key = counts[item.status] === undefined ? "unknown" : item.status;
      counts[key] += 1;
    }

    // Provider summary from projects (merged)
    const providerMap = new Map();
    for (const project of projects) {
      const key = project.provider || "unknown";
      if (!providerMap.has(key)) {
        providerMap.set(key, {
          key,
          label: project.providerLabel || providerLabel(key),
          counts: emptyStatusCounts(),
          itemCount: 0,
          projectCount: 0,
          lastCheckedAt: "",
        });
      }
      const group = providerMap.get(key);
      group.projectCount += 1;
      group.itemCount += project.accountCount || project.accounts?.length || 0;
      for (const [sk, sv] of Object.entries(project.counts || {})) {
        if (group.counts[sk] !== undefined && typeof sv === "number") {
          group.counts[sk] += sv;
        }
      }
      if (
        project.checkedAt &&
        (!group.lastCheckedAt || project.checkedAt > group.lastCheckedAt)
      ) {
        group.lastCheckedAt = project.checkedAt;
      }
    }

    let embykeeperStatus = null;
    try {
      embykeeperStatus = getEmbykeeperStatus();
    } catch {
      embykeeperStatus = null;
    }

    return {
      ok: true,
      generatedAt: formatDateTime(),
      source: "glados-checkin-web",
      auth: {
        appTokenConfigured: Boolean(APP_API_TOKEN),
      },
      counts: {
        total: items.length,
        projectTotal: projects.length,
        ...counts,
        healthy: counts.success + counts.already,
      },
      providers: Array.from(providerMap.values()),
      /** Merged check-in projects (preferred for mobile UI). */
      projects,
      /** Flat account-level items (compat). */
      items,
      telegram: {
        updatedAt: telegramResults?.updatedAt || null,
        botCount: telegramResults?.bots
          ? Object.keys(telegramResults.bots).length
          : 0,
      },
      embykeeper: embykeeperStatus
        ? {
            installed: Boolean(embykeeperStatus.installed),
            configPresent: Boolean(
              embykeeperStatus.configExists || embykeeperStatus.configPresent,
            ),
            sessionFiles: Array.isArray(embykeeperStatus.sessionFiles)
              ? embykeeperStatus.sessionFiles.length
              : Number(embykeeperStatus.sessionFiles) || 0,
            sessionStringCount:
              Number(embykeeperStatus.sessionStringCount) || 0,
          }
        : null,
    };
  }
  function summaryVersion() {
    const files = [
      ...Object.values(require("../lib/accounts").PROVIDER_FILES),
      EMBYKEEPER_FORM_FILE,
      TELEGRAM_CHECKIN_RESULTS_FILE,
      PROJECT_NAMES_FILE,
      BOT_AVATAR_DIR,
      SITE_ICON_DIR,
    ];
    return files
      .map((file) => {
        try {
          const stat = fs.statSync(file);
          return stat.mtimeMs + ":" + stat.size + ":" + stat.ino;
        } catch {
          return "missing";
        }
      })
      .join("|");
  }
  async function buildMobileSummary(req) {
    const key = publicBaseFromRequest(req) + "|" + summaryVersion();
    const cached = summaryCache.get(key);
    if (cached) return cached;
    return summaryCache.set(key, await buildMobileSummaryUncached(req));
  }
  const summaryCache = new (require("../lib/cache/memory").MemoryCache)();

  async function buildDashboard(req) {
    const summary = await buildMobileSummary(req);
    return {
      projects: summary.projects,
      generatedAt: new Date().toISOString(),
    };
  }
  return {
    buildDashboard,
    mapWebsiteAccountToSummaryItem,
    publicBaseFromRequest,
    mapTelegramResultsToSummaryItems,
    buildSummaryProjects,
    buildMobileSummaryUncached,
    summaryVersion,
    buildMobileSummary,
  };
};
