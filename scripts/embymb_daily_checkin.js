#!/usr/bin/env node

const { loadLocalEnv, formatIso, formatBeijing } = require("../lib/common");
loadLocalEnv();

const { readProviderAccounts, commitAccountRuns } = require("../lib/accounts");
const embymb = require("../lib/providers/embymb");
const { runWithRetries, runDailyJob, getDailyConfig } = require("../lib/daily");

const DEFAULT_BASE_URL = process.env.DEFAULT_EMBYMB_BASE_URL || "https://embymb.ichinosekotomi.com";

function buildReport(results, sentAt) {
  const cfg = getDailyConfig();
  const success = results.filter((item) => item.lastCheckin?.ok && !item.lastCheckin?.already).length;
  const already = results.filter((item) => item.lastCheckin?.already).length;
  const failed = results.filter((item) => !item.lastCheckin?.ok).length;
  const active = results.filter((item) => item.lastStatus?.state === "active").length;

  const lines = [
    "EmbyMB 每日签到报告",
    `北京时间: ${formatBeijing(sentAt)}`,
    `UTC: ${formatIso(sentAt)}`,
    `账号总数: ${results.length}`,
    `签到成功: ${success}`,
    `今日已签: ${already}`,
    `签到失败: ${failed}`,
    `当前状态正常: ${active}`,
    `失败重试: 最多 ${cfg.maxAttempts} 次，间隔 ${cfg.retryDelayMs} ms`,
    ""
  ];

  results.forEach((account, index) => {
    const checkin = account.lastCheckin;
    const status = account.lastStatus;
    const checkinLabel = !checkin
      ? "未执行"
      : checkin.ok
        ? checkin.already
          ? `已签过 | ${checkin.message}`
          : `成功 | ${checkin.message}`
        : `失败 | ${checkin.message}`;
    const statusLabel = status
      ? `${status.state || "unknown"} | ${status.message || ""}`.trim()
      : "未获取状态";

    lines.push(`${index + 1}. ${account.name}`);
    lines.push(`签到: ${checkinLabel}`);
    lines.push(`尝试次数: ${checkin?.attemptCount ?? 0}/${checkin?.maxAttempts ?? cfg.maxAttempts}`);
    lines.push(`状态: ${statusLabel}`);
    lines.push(`积分: ${status?.points ?? checkin?.balance ?? "--"} ${status?.currency || checkin?.currency || "积分"}`);
    lines.push(`最近签到日: ${status?.lastSignInDate || checkin?.lastSignInDate || "--"}`);
    lines.push(`站点: ${account.baseUrl || DEFAULT_BASE_URL}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

function buildFailureAlert(results, sentAt) {
  const cfg = getDailyConfig();
  const failedAccounts = results.filter((item) => !item.lastCheckin?.ok);
  if (!failedAccounts.length) return "";

  const lines = [
    "EmbyMB 签到失败告警",
    `北京时间: ${formatBeijing(sentAt)}`,
    `失败账号: ${failedAccounts.length}/${results.length}`,
    `已启用重试: 最多 ${cfg.maxAttempts} 次，间隔 ${cfg.retryDelayMs} ms`,
    ""
  ];

  failedAccounts.forEach((account, index) => {
    const checkin = account.lastCheckin;
    const status = account.lastStatus;
    lines.push(`${index + 1}. ${account.name}`);
    lines.push(`最终错误: ${checkin?.message || "未知错误"}`);
    lines.push(`尝试次数: ${checkin?.attemptCount ?? 0}/${checkin?.maxAttempts ?? cfg.maxAttempts}`);
    lines.push(`状态: ${status?.state ?? "unknown"} | ${status?.message || "未获取状态"}`);
    if (Array.isArray(checkin?.attempts) && checkin.attempts.length > 0) {
      const attemptText = checkin.attempts.map((item) => `#${item.attempt}:${item.message}`).join(" | ");
      lines.push(`重试轨迹: ${attemptText}`);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}

async function main() {
  await runDailyJob({
    title: "EmbyMB 每日签到报告",
    accounts: readProviderAccounts("embymb"),
    writeAccounts: (accounts, originals) => commitAccountRuns("embymb", accounts, originals),
    runOne: (account) => runWithRetries("embymb-checkin", account, (item) => embymb.runAccountCheckin(item)),
    buildReport,
    buildFailureAlert
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
