module.exports = function createService(context) {
  const {
    fs,
    path,
    formatDateTime,
    DATA_DIR,
    EMBYKEEPER_CONFIG_FILE,
    EMBYKEEPER_FORM_FILE,
    EMBYKEEPER_RUNTIME_DIR,
    TELEGRAM_CHECKIN_RESULTS_FILE,
    EMBYKEEPER_BIN,
    EMBYKEEPER_RUNNER,
    CUSTOM_TG_WORKER,
    EMBYKEEPER_BUILTIN_CHECKINERS,
    ensureDataFiles,
    setProjectName,
  } = context;
  function ensureEmbykeeperConfigFile() {
    ensureDataFiles();
    if (!fs.existsSync(EMBYKEEPER_CONFIG_FILE)) {
      fs.writeFileSync(EMBYKEEPER_CONFIG_FILE, "");
    }
  }
  function readEmbykeeperConfig() {
    ensureEmbykeeperConfigFile();
    return fs.readFileSync(EMBYKEEPER_CONFIG_FILE, "utf8");
  }
  function writeEmbykeeperConfig(content) {
    ensureEmbykeeperConfigFile();
    require("../lib/store/json-store").atomicWrite(
      EMBYKEEPER_CONFIG_FILE,
      String(content || ""),
    );
  }
  function defaultTelegramAccountForm() {
    return {
      phone: "",
      apiId: "",
      apiHash: "",
      session: "",
      enabled: true,
      checkiner: true,
    };
  }
  function defaultBotTemplateForm() {
    return {
      botUsername: "",
      name: "",
      commands: ["/checkin"],
      successKeywords: [
        "签到成功",
        "今日已签到",
        "今天已经签到过了",
        "success",
      ],
      checkedKeywords: ["今日已签到", "今天已经签到过了"],
      failKeywords: ["失败", "错误", "error", "invalid"],
      textIgnore: [],
      targetPhones: [],
      sendInterval: 3,
      useCaptcha: true,
      isChat: false,
      waitResponse: true,
    };
  }
  function defaultEmbykeeperForm() {
    return {
      telegramAccounts: [defaultTelegramAccountForm()],
      botTemplates: [defaultBotTemplateForm()],
      globalCheckiner: {
        timeout: 120,
        retries: 4,
        concurrency: 1,
        randomStart: 60,
        intervalDays: "1",
        timeRange: "<11:00AM,11:00PM>",
      },
    };
  }
  function normalizeStringArray(value, fallback = []) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return fallback.slice();
  }
  function normalizeEmbykeeperForm(body = {}) {
    const source = body && typeof body === "object" ? body : {};
    const defaults = defaultEmbykeeperForm();

    const telegramAccountsRaw = Array.isArray(source.telegramAccounts)
      ? source.telegramAccounts
      : defaults.telegramAccounts;
    const telegramAccounts = telegramAccountsRaw
      .map((item) => ({
        ...item,
        phone: String(item?.phone || "").trim(),
        apiId: String(item?.apiId || item?.api_id || "").trim(),
        apiHash: String(item?.apiHash || item?.api_hash || "").trim(),
        session: String(item?.session || "").trim(),
        enabled: item?.enabled !== false,
        checkiner: item?.checkiner !== false,
      }))
      .filter((item) => item.phone);

    const botTemplatesRaw = Array.isArray(source.botTemplates)
      ? source.botTemplates
      : defaults.botTemplates;
    const botTemplates = botTemplatesRaw
      .map((item) => ({
        ...item,
        buttonSequence: normalizeStringArray(
          item?.buttonSequence || item?.button_sequence,
          [],
        ),
        requireExistingChat: Boolean(item?.requireExistingChat),
        captchaLengths: item?.captchaLengths || [],
        captchaPattern: String(item?.captchaPattern || ""),
        source: String(item?.source || ""),
        botUsername: String(
          item?.botUsername || item?.bot_username || "",
        ).trim(),
        name: String(item?.name || "").trim(),
        commands: normalizeStringArray(
          item?.commands || item?.botCheckinCmd || item?.bot_checkin_cmd,
          ["/checkin"],
        ),
        successKeywords: normalizeStringArray(
          item?.successKeywords ||
            item?.botSuccessKeywords ||
            item?.bot_success_keywords,
          defaults.botTemplates[0].successKeywords,
        ),
        checkedKeywords: normalizeStringArray(
          item?.checkedKeywords ||
            item?.botCheckedKeywords ||
            item?.bot_checked_keywords,
          defaults.botTemplates[0].checkedKeywords,
        ),
        failKeywords: normalizeStringArray(
          item?.failKeywords ||
            item?.botFailKeywords ||
            item?.bot_fail_keywords,
          defaults.botTemplates[0].failKeywords,
        ),
        textIgnore: normalizeStringArray(
          item?.textIgnore || item?.botTextIgnore || item?.bot_text_ignore,
          [],
        ),
        targetPhones: normalizeStringArray(
          item?.targetPhones ||
            item?.target_phones ||
            item?.botTargetPhones ||
            item?.bot_target_phones,
          [],
        ),
        sendInterval: Math.max(
          1,
          Number(
            item?.sendInterval ??
              item?.botSendInterval ??
              item?.bot_send_interval ??
              3,
          ) || 3,
        ),
        useCaptcha: item?.useCaptcha !== false,
        isChat: Boolean(item?.isChat),
        waitResponse: item?.waitResponse !== false,
      }))
      .filter((item) => item.botUsername);

    const globalCheckinerSource =
      source.globalCheckiner && typeof source.globalCheckiner === "object"
        ? source.globalCheckiner
        : defaults.globalCheckiner;

    return {
      ...source,
      telegramAccounts: telegramAccounts.length
        ? telegramAccounts
        : defaults.telegramAccounts,
      botTemplates,
      globalCheckiner: {
        ...globalCheckinerSource,
        timeout: Math.max(
          10,
          Number(
            globalCheckinerSource.timeout ?? defaults.globalCheckiner.timeout,
          ) || defaults.globalCheckiner.timeout,
        ),
        retries: Math.max(
          1,
          Number(
            globalCheckinerSource.retries ?? defaults.globalCheckiner.retries,
          ) || defaults.globalCheckiner.retries,
        ),
        concurrency: Math.max(
          1,
          Number(
            globalCheckinerSource.concurrency ??
              defaults.globalCheckiner.concurrency,
          ) || defaults.globalCheckiner.concurrency,
        ),
        randomStart: Math.max(
          0,
          Number(
            globalCheckinerSource.randomStart ??
              defaults.globalCheckiner.randomStart,
          ) || defaults.globalCheckiner.randomStart,
        ),
        intervalDays:
          String(
            globalCheckinerSource.intervalDays ??
              defaults.globalCheckiner.intervalDays,
          ).trim() || defaults.globalCheckiner.intervalDays,
        timeRange:
          String(
            globalCheckinerSource.timeRange ??
              defaults.globalCheckiner.timeRange,
          ).trim() || defaults.globalCheckiner.timeRange,
      },
    };
  }
  function readEmbykeeperForm() {
    ensureDataFiles();
    if (!fs.existsSync(EMBYKEEPER_FORM_FILE)) {
      return defaultEmbykeeperForm();
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(EMBYKEEPER_FORM_FILE, "utf8"));
      return normalizeEmbykeeperForm(parsed);
    } catch {
      return defaultEmbykeeperForm();
    }
  }
  function readTelegramCheckinResults() {
    ensureDataFiles();
    try {
      const parsed = JSON.parse(
        fs.readFileSync(TELEGRAM_CHECKIN_RESULTS_FILE, "utf8"),
      );
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  function writeEmbykeeperForm(form) {
    ensureDataFiles();
    fs.writeFileSync(EMBYKEEPER_FORM_FILE, JSON.stringify(form, null, 2));
  }
  function tomlEscape(value) {
    return String(value ?? "")
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"');
  }
  function tomlString(value) {
    return `"${tomlEscape(value)}"`;
  }
  function tomlBoolean(value) {
    return value ? "true" : "false";
  }
  function tomlArray(values = []) {
    return `[${values.map((item) => tomlString(item)).join(", ")}]`;
  }
  function renderEmbykeeperConfigFromForm(formInput) {
    const form = normalizeEmbykeeperForm(formInput);
    const checkinerNames = form.botTemplates.map((item) => {
      const builtin = EMBYKEEPER_BUILTIN_CHECKINERS[item.botUsername];
      return builtin || `templ_b<${item.botUsername}>`;
    });
    const lines = [
      "# emby-keeper Telegram bot check-in config",
      "# Generated by checkin panel",
      "",
    ];

    lines.push("[site]");
    lines.push(`checkiner = ${tomlArray(checkinerNames)}`);
    lines.push("");

    lines.push("[checkiner]");
    lines.push(`time_range = ${tomlString(form.globalCheckiner.timeRange)}`);
    lines.push(
      `interval_days = ${tomlString(form.globalCheckiner.intervalDays)}`,
    );
    lines.push(`timeout = ${form.globalCheckiner.timeout}`);
    lines.push(`retries = ${form.globalCheckiner.retries}`);
    lines.push(`concurrency = ${form.globalCheckiner.concurrency}`);
    lines.push(`random_start = ${form.globalCheckiner.randomStart}`);
    lines.push("");

    for (const account of form.telegramAccounts) {
      lines.push("[[telegram.account]]");
      lines.push(`phone = ${tomlString(account.phone)}`);
      lines.push(`checkiner = ${tomlBoolean(account.checkiner)}`);
      lines.push(`enabled = ${tomlBoolean(account.enabled)}`);
      if (account.apiId) lines.push(`api_id = ${tomlString(account.apiId)}`);
      if (account.apiHash)
        lines.push(`api_hash = ${tomlString(account.apiHash)}`);
      if (account.session)
        lines.push(`session = ${tomlString(account.session)}`);
      lines.push("");
    }

    for (const bot of form.botTemplates) {
      const builtin = EMBYKEEPER_BUILTIN_CHECKINERS[bot.botUsername];
      const key = builtin || `templ_b<${bot.botUsername}>`;
      lines.push(`[checkiner.${tomlString(key)}]`);
      if (bot.name) lines.push(`name = ${tomlString(bot.name)}`);
      lines.push(`bot_checkin_cmd = ${tomlArray(bot.commands)}`);
      lines.push(`bot_send_interval = ${bot.sendInterval}`);
      lines.push(`bot_use_captcha = ${tomlBoolean(bot.useCaptcha)}`);
      lines.push(`bot_success_keywords = ${tomlArray(bot.successKeywords)}`);
      lines.push(`bot_checked_keywords = ${tomlArray(bot.checkedKeywords)}`);
      lines.push(`bot_fail_keywords = ${tomlArray(bot.failKeywords)}`);
      if (bot.textIgnore.length)
        lines.push(`bot_text_ignore = ${tomlArray(bot.textIgnore)}`);
      lines.push(`is_chat = ${tomlBoolean(bot.isChat)}`);
      lines.push(`wait_response = ${tomlBoolean(bot.waitResponse)}`);
      lines.push("");
    }

    return lines.join("\n").trim() + "\n";
  }
  function getEmbykeeperStatus() {
    ensureDataFiles();
    const runtimeFiles = fs.existsSync(EMBYKEEPER_RUNTIME_DIR)
      ? fs.readdirSync(EMBYKEEPER_RUNTIME_DIR)
      : [];
    const sessionFiles = runtimeFiles.filter((name) => !name.startsWith("."));
    const cache = (() => {
      try {
        return JSON.parse(
          fs.readFileSync(
            path.join(EMBYKEEPER_RUNTIME_DIR, "cache.json"),
            "utf8",
          ),
        );
      } catch {
        return {};
      }
    })();
    const sessionStrings = cache?.telegram?.session_str || {};
    const sessionStringCount = Object.keys(sessionStrings).length;

    return {
      installed: fs.existsSync(EMBYKEEPER_BIN),
      runnerExists: fs.existsSync(EMBYKEEPER_RUNNER),
      customWorkerExists: fs.existsSync(CUSTOM_TG_WORKER),
      configExists: fs.existsSync(EMBYKEEPER_CONFIG_FILE),
      runtimeDirExists: fs.existsSync(EMBYKEEPER_RUNTIME_DIR),
      sessionFiles,
      sessionStringCount,
      binaryPath: EMBYKEEPER_BIN,
      configPath: EMBYKEEPER_CONFIG_FILE,
      runtimeDir: EMBYKEEPER_RUNTIME_DIR,
      runnerPath: CUSTOM_TG_WORKER,
      firstRunHint: EMBYKEEPER_RUNNER,
    };
  }
  function listMobileTelegramBots() {
    const form = readEmbykeeperForm();
    const results = readTelegramCheckinResults();
    const bots = (form.botTemplates || []).map((bot) => {
      const username = String(bot.botUsername || "").replace(/^@/, "");
      const result =
        results?.bots?.[username] || results?.bots?.[bot.botUsername] || null;
      return {
        botUsername: username,
        name: bot.name || username,
        commands: bot.commands || [],
        successKeywords: bot.successKeywords || [],
        checkedKeywords: bot.checkedKeywords || [],
        failKeywords: bot.failKeywords || [],
        sendInterval: bot.sendInterval,
        useCaptcha: bot.useCaptcha,
        isChat: bot.isChat,
        waitResponse: bot.waitResponse,
        targetPhones: bot.targetPhones || [],
        lastStatus: result
          ? {
              ok: result.ok,
              status: result.status,
              message: result.message,
              checkedAt: result.checkedAt,
            }
          : null,
      };
    });
    return {
      bots,
      phones: (form.telegramAccounts || []).map((a) => ({
        phone: a.phone,
        enabled: a.enabled !== false,
        checkiner: a.checkiner !== false,
      })),
    };
  }
  function persistEmbykeeperForm(form) {
    const normalized = normalizeEmbykeeperForm(form);
    const previous = new Map(
      readEmbykeeperForm().telegramAccounts.map((a) => [a.phone, a]),
    );
    normalized.telegramAccounts = normalized.telegramAccounts.map((a) => {
      const { clearSession, ...rest } = a;
      return {
        ...rest,
        session: clearSession
          ? ""
          : a.session || previous.get(a.phone)?.session || "",
      };
    });
    require("../lib/store/telegram-repo").persistPair(
      EMBYKEEPER_FORM_FILE,
      EMBYKEEPER_CONFIG_FILE,
      normalized,
      renderEmbykeeperConfigFromForm,
    );
    return normalized;
  }
  function updateMobileTelegramBot(botUsername, body = {}) {
    const form = readEmbykeeperForm();
    const idx = (form.botTemplates || []).findIndex(
      (b) => String(b.botUsername || "").replace(/^@/, "") === botUsername,
    );
    if (idx < 0) {
      return { ok: false, error: "Bot 不存在" };
    }
    const current = form.botTemplates[idx];
    form.botTemplates[idx] = {
      ...current,
      name:
        body.name !== undefined ? String(body.name || "").trim() : current.name,
      botUsername:
        body.botUsername !== undefined
          ? String(body.botUsername || "")
              .trim()
              .replace(/^@/, "")
          : current.botUsername,
      commands:
        body.commands !== undefined
          ? normalizeStringArray(body.commands, current.commands)
          : current.commands,
      successKeywords:
        body.successKeywords !== undefined
          ? normalizeStringArray(body.successKeywords, current.successKeywords)
          : current.successKeywords,
      checkedKeywords:
        body.checkedKeywords !== undefined
          ? normalizeStringArray(body.checkedKeywords, current.checkedKeywords)
          : current.checkedKeywords,
      failKeywords:
        body.failKeywords !== undefined
          ? normalizeStringArray(body.failKeywords, current.failKeywords)
          : current.failKeywords,
      sendInterval:
        body.sendInterval !== undefined
          ? Math.max(1, Number(body.sendInterval) || current.sendInterval || 3)
          : current.sendInterval,
      useCaptcha:
        body.useCaptcha !== undefined
          ? Boolean(body.useCaptcha)
          : current.useCaptcha,
      isChat: body.isChat !== undefined ? Boolean(body.isChat) : current.isChat,
      waitResponse:
        body.waitResponse !== undefined
          ? Boolean(body.waitResponse)
          : current.waitResponse,
      targetPhones:
        body.targetPhones !== undefined
          ? normalizeStringArray(body.targetPhones, current.targetPhones || [])
          : current.targetPhones || [],
    };
    if (!form.botTemplates[idx].botUsername) {
      return { ok: false, error: "Bot 用户名不能为空" };
    }
    const saved = persistEmbykeeperForm(form);
    return {
      ok: true,
      bot: listMobileTelegramBots().bots.find(
        (b) => b.botUsername === form.botTemplates[idx].botUsername,
      ),
      form: publicTelegramForm(saved),
    };
  }
  function deleteMobileTelegramBot(botUsername) {
    // Preserve worker-specific fields (for example buttonSequence) on other bots.
    const form = readEmbykeeperForm();
    const key = String(botUsername).replace(/^@/, "").toLowerCase();
    const before = (form.botTemplates || []).length;
    form.botTemplates = (form.botTemplates || []).filter(
      (b) =>
        String(b.botUsername || "")
          .replace(/^@/, "")
          .toLowerCase() !== key,
    );
    if (form.botTemplates.length === before) {
      return { ok: false, error: "Bot 不存在" };
    }
    persistEmbykeeperForm(form);

    // Drop results for this bot so summary refreshes cleanly.
    try {
      const results = readTelegramCheckinResults();
      if (results?.bots) {
        for (const username of Object.keys(results.bots)) {
          if (username.replace(/^@/, "").toLowerCase() === key)
            delete results.bots[username];
        }
        fs.writeFileSync(
          TELEGRAM_CHECKIN_RESULTS_FILE,
          JSON.stringify(results, null, 2),
        );
      }
    } catch {
      // ignore
    }
    const skipPath = path.join(DATA_DIR, "telegram_bot_checkin_skip.json");
    if (fs.existsSync(skipPath)) {
      const cache = JSON.parse(fs.readFileSync(skipPath, "utf8"));
      for (const bots of Object.values(cache)) {
        for (const username of Object.keys(bots || {})) {
          if (username.replace(/^@/, "").toLowerCase() === key)
            delete bots[username];
        }
      }
      fs.writeFileSync(skipPath, JSON.stringify(cache, null, 2));
    }
    setProjectName(`tg:${botUsername}`, "");
    return { ok: true, deletedBotUsername: botUsername };
  }
  function deleteMobileTelegramPhone(phone) {
    const form = readEmbykeeperForm();
    const before = (form.telegramAccounts || []).length;
    form.telegramAccounts = (form.telegramAccounts || []).filter(
      (a) => a.phone !== phone,
    );
    if (form.telegramAccounts.length === before) {
      return { ok: false, error: "手机号不存在" };
    }
    if (!form.telegramAccounts.length) {
      form.telegramAccounts = defaultEmbykeeperForm().telegramAccounts;
    }
    persistEmbykeeperForm(form);
    return { ok: true, deletedPhone: phone };
  }
  function removePhoneFromTelegramBot(botUsername, phone) {
    const user = String(botUsername || "").replace(/^@/, "");
    const form = readEmbykeeperForm();
    const idx = (form.botTemplates || []).findIndex(
      (b) => String(b.botUsername || "").replace(/^@/, "") === user,
    );
    if (idx < 0) {
      return { ok: false, error: "Bot 不存在" };
    }
    const bot = form.botTemplates[idx];
    const allPhones = (form.telegramAccounts || [])
      .filter((a) => a.enabled !== false && a.checkiner !== false)
      .map((a) => a.phone)
      .filter(Boolean);
    let targets = Array.isArray(bot.targetPhones)
      ? bot.targetPhones.filter(Boolean)
      : [];
    if (!targets.length) {
      targets = allPhones.slice();
    }
    const nextTargets = targets.filter((p) => p !== phone);
    if (nextTargets.length === targets.length) {
      // Phone might only appear in results; still allow cleaning results.
    }
    // If only one phone remains and it equals all remaining accounts, can leave empty (= all remaining).
    form.botTemplates[idx] = {
      ...bot,
      targetPhones: nextTargets,
    };
    persistEmbykeeperForm(form);

    // Strip this phone from bot results so summary drops the row immediately.
    try {
      const results = readTelegramCheckinResults();
      const key = user;
      const entry = results?.bots?.[key] || results?.bots?.[bot.botUsername];
      if (entry && Array.isArray(entry.accounts)) {
        entry.accounts = entry.accounts.filter(
          (a) => String(a?.phone || "") !== phone,
        );
        results.bots[key] = entry;
        results.updatedAt = formatDateTime();
        fs.writeFileSync(
          TELEGRAM_CHECKIN_RESULTS_FILE,
          JSON.stringify(results, null, 2),
        );
      }
    } catch {
      // ignore
    }
    return {
      ok: true,
      botUsername: user,
      removedPhone: phone,
      targetPhones: nextTargets,
    };
  }

  function publicTelegramForm(form = readEmbykeeperForm()) {
    return {
      ...form,
      telegramAccounts: form.telegramAccounts.map(({ session, ...a }) => ({
        ...a,
        hasSession: Boolean(session),
      })),
    };
  }
  function sessionValues(config) {
    const values = [];
    // Generated TOML uses quoted strings; handle both multiline TOML string forms too.
    const pattern =
      /(\bsession\s*=\s*)("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'[^']*')/g;
    const redacted = String(config).replace(pattern, (_, prefix, value) => {
      const i = values.push(value) - 1;
      return prefix + '"__CHECKIN_SESSION_' + i + '__"';
    });
    return { redacted, values };
  }
  function publicTelegramConfig() {
    return sessionValues(readEmbykeeperConfig()).redacted;
  }
  function updateTelegramConfig(input) {
    const { values } = sessionValues(readEmbykeeperConfig());
    const restored = String(input).replace(
      /"__CHECKIN_SESSION_(\d+)__"/g,
      (_, i) => {
        if (values[Number(i)] === undefined)
          throw Object.assign(Error("配置中的会话占位符无效"), { status: 400 });
        return values[Number(i)];
      },
    );
    writeEmbykeeperConfig(restored);
  }

  return {
    publicTelegramForm,
    publicTelegramConfig,
    updateTelegramConfig,
    ensureEmbykeeperConfigFile,
    readEmbykeeperConfig,
    writeEmbykeeperConfig,
    defaultTelegramAccountForm,
    defaultBotTemplateForm,
    defaultEmbykeeperForm,
    normalizeStringArray,
    normalizeEmbykeeperForm,
    readEmbykeeperForm,
    readTelegramCheckinResults,
    writeEmbykeeperForm,
    tomlEscape,
    tomlString,
    tomlBoolean,
    tomlArray,
    renderEmbykeeperConfigFromForm,
    getEmbykeeperStatus,
    listMobileTelegramBots,
    persistEmbykeeperForm,
    updateMobileTelegramBot,
    deleteMobileTelegramBot,
    deleteMobileTelegramPhone,
    removePhoneFromTelegramBot,
  };
};
