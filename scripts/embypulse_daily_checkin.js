#!/usr/bin/env node

const { loadLocalEnv, formatIso, formatBeijing } = require("../lib/common");
loadLocalEnv();

const { readProviderAccounts, commitAccountRuns } = require("../lib/accounts");
const embypulse = require("../lib/providers/embypulse");
const { runWithRetries, runDailyJob, getDailyConfig } = require("../lib/daily");

function buildReport(results, sentAt) {
  const success = results.filter((item) => item.lastCheckin?.ok && !item.lastCheckin?.already).length;
  const already = results.filter((item) => item.lastCheckin?.already).length;
  const failed = results.filter((item) => !item.lastCheckin?.ok).length;

  const lines = [
    "EmbyPulse 每日签到报告",
    `北京时间: ${formatBeijing(sentAt)}`,
    `UTC: ${formatIso(sentAt)}`,
    `账号总数: ${results.length}`,
    `签到成功: ${success}`,
    `今日已签: ${already}`,
    `签到失败: ${failed}`,
    ""
  ];

  for (const account of results) {
    const checkin = account.lastCheckin || {};
    const status = account.lastStatus || {};
    const checkinLabel = checkin.ok
      ? (checkin.already ? `今日已签 · ${checkin.message}` : `签到成功 · +${checkin.reward || checkin.points || 0} 积分`)
      : `签到失败 · ${checkin.message || "未知错误"}`;

    lines.push(`- ${account.name}`);
    lines.push(`  站点: ${account.baseUrl}`);
    lines.push(`  签到: ${checkinLabel}`);
    lines.push(`  当前积分: ${status.points ?? checkin.balance ?? "--"}`);
    lines.push(`  最后更新时间: ${account.updatedAt || "--"}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function buildFailureAlert(results, sentAt) {
  const failedAccounts = results.filter((item) => !item.lastCheckin?.ok);
  if (!failedAccounts.length) return "";
  return [
    "EmbyPulse 签到失败告警",
    `北京时间: ${formatBeijing(sentAt)}`,
    ...failedAccounts.map((item) => `- ${item.name}: ${item.lastCheckin?.message || "未知错误"}`)
  ].join("\n");
}

async function main() {
  const accounts = readProviderAccounts("embypulse");
  if (!accounts.length) {
    console.log("[embypulse-checkin] no accounts configured");
    return;
  }

  const cfg = getDailyConfig();
  try {
    await runDailyJob({
      title: "EmbyPulse 每日签到报告",
      accounts,
      writeAccounts: (items, originals) => commitAccountRuns("embypulse", items, originals),
      runOne: (account) => runWithRetries("embypulse-checkin", account, (item) => embypulse.runAccountCheckin(item)),
      buildReport,
      buildFailureAlert: cfg.alertOnFailure ? buildFailureAlert : null
    });
  } catch (error) {
    console.error(`[embypulse-checkin] telegram delivery failed: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
