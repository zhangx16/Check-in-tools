const {
  loadLocalEnv,
  sleep,
  formatDateTime,
  formatBeijing,
  parseBoolean,
  runConcurrent
} = require("./common");
const { sendTelegramReport } = require("./telegram");
const { buildCompactReport, buildCompactFailureAlert } = require("./checkin-report");

loadLocalEnv();

function getDailyConfig() {
  return {
    maxAttempts: Math.max(1, Number(process.env.CHECKIN_MAX_ATTEMPTS || 3)),
    retryDelayMs: Math.max(0, Number(process.env.CHECKIN_RETRY_DELAY_MS || 5000)),
    concurrency: Math.max(1, Number(process.env.CHECKIN_CONCURRENCY || 4)),
    alertOnFailure: parseBoolean(process.env.TELEGRAM_ALERT_ON_FAILURE, true),
    botToken: String(process.env.TELEGRAM_BOT_TOKEN || "").trim()
  };
}

function defaultShouldRetry(checkin, attemptNumber, maxAttempts) {
  if (attemptNumber >= maxAttempts) return false;
  if (checkin?.ok) return false;
  return true;
}

async function runWithRetries(label, account, worker, options = {}) {
  const cfg = getDailyConfig();
  const maxAttempts = options.maxAttempts ?? cfg.maxAttempts;
  const retryDelayMs = options.retryDelayMs ?? cfg.retryDelayMs;
  const shouldRetry = options.shouldRetry || defaultShouldRetry;
  const delayFor = options.delayFor || (() => retryDelayMs);

  const attempts = [];
  let processed = null;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    processed = await worker(account);
    const checkin = processed.account?.lastCheckin || processed.summary?.checkin || {};
    attempts.push({
      attempt: attemptNumber,
      ok: checkin.ok,
      already: checkin.already,
      code: checkin.code,
      points: checkin.points,
      balance: checkin.balance,
      message: checkin.message,
      at: formatDateTime()
    });

    if (!shouldRetry(checkin, attemptNumber, maxAttempts)) {
      break;
    }

    console.warn(
      `[${label}] retry scheduled for ${account.name} (${attemptNumber}/${maxAttempts}) after failure: ${checkin.message}`
    );
    const delayMs = delayFor(attemptNumber);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  const accountOut = processed.account;
  accountOut.lastCheckin = {
    ...(accountOut.lastCheckin || {}),
    attemptCount: attempts.length,
    maxAttempts,
    retryCount: Math.max(0, attempts.length - 1),
    attempts
  };
  return accountOut;
}

async function runDailyJob({
  title,
  accounts,
  writeAccounts,
  runOne,
  buildReport,
  buildFailureAlert,
  emptyMessage
}) {
  const startedAt = new Date();
  const cfg = getDailyConfig();

  if (!accounts.length) {
    const report = [
      title,
      `北京时间: ${formatBeijing(startedAt)}`,
      emptyMessage || "没有可签到的账号记录。"
    ].join("\n");
    if (cfg.botToken) {
      await sendTelegramReport(report);
    }
    console.log(report);
    return;
  }

  const nextAccounts = await runConcurrent(accounts, (account) => runOne(account), cfg.concurrency);
  writeAccounts(nextAccounts);

  const report = buildCompactReport(nextAccounts, startedAt);
  console.log(report);

  if (!cfg.botToken) {
    return;
  }

  try {
    const chatId = await sendTelegramReport(report);
    console.log(`Telegram 已发送到 chat_id=${chatId}`);
  } catch (error) {
    console.error(`Telegram delivery failed: ${error.message}`);
  }

  if (cfg.alertOnFailure && typeof buildFailureAlert === "function") {
    const failureAlert = buildCompactFailureAlert(nextAccounts, startedAt);
    if (failureAlert) {
      try {
        await sendTelegramReport(failureAlert);
        console.log("Telegram 失败告警已发送");
      } catch (error) {
        console.error(`Telegram alert failed: ${error.message}`);
      }
    }
  }
}

module.exports = {
  getDailyConfig,
  runWithRetries,
  runDailyJob,
  formatIso: formatDateTime,
  formatBeijing,
  sendTelegramReport
};
