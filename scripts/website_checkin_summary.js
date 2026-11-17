#!/usr/bin/env node

const path = require("path");
const { updateJson } = require("../lib/store/json-store");
const { evaluateFailures } = require("../lib/failure-streaks");
const {
  loadLocalEnv,
  formatIso,
  formatBeijing,
  DATA_DIR,
} = require("../lib/common");
loadLocalEnv();

const { readAccounts } = require("../lib/accounts");
const { sendTelegramReport } = require("../lib/telegram");
const { buildCompactReport } = require("../lib/checkin-report");

const PROVIDERS = [
  {
    key: "thxnk",
    label: "练习生的日常",
    defaultBaseUrl: "https://thxnk.cc",
    balanceLabel: "当前余额",
    defaultCurrency: "只因",
  },
  {
    key: "zzcat",
    label: "这只猫用户中心",
    defaultBaseUrl: "https://user.090911.xyz",
    balanceLabel: "当前猫币",
    defaultCurrency: "猫币",
  },
  {
    key: "vpsnat",
    label: "VPSNAT 纳泰云",
    defaultBaseUrl:
      process.env.DEFAULT_VPSNAT_BASE_URL || "https://www.vpsnat.com",
    balanceLabel: "当前积分",
    defaultCurrency: "积分",
  },
  {
    key: "glados",
    label: "GLaDOS",
    defaultBaseUrl: "https://glados.network",
    balanceLabel: "剩余天数",
    defaultCurrency: "Points",
  },
  {
    key: "embypulse",
    label: "EmbyPulse",
    defaultBaseUrl:
      process.env.DEFAULT_EMBYPULSE_BASE_URL || "https://embypulse.example.com",
    balanceLabel: "当前积分",
    defaultCurrency: "积分",
  },
  {
    key: "embymb",
    label: "EmbyMB",
    defaultBaseUrl:
      process.env.DEFAULT_EMBYMB_BASE_URL ||
      "https://embymb.ichinosekotomi.com",
    balanceLabel: "当前余额",
    defaultCurrency: "积分",
  },
];

function readWebsiteAccounts() {
  const byKey = new Map(PROVIDERS.map((provider) => [provider.key, provider]));
  return readAccounts()
    .filter((account) => byKey.has(account.provider || "glados"))
    .map((account) => {
      const provider =
        byKey.get(account.provider || "glados") || byKey.get("glados");
      return {
        ...account,
        provider: provider.key,
        providerLabel: provider.label,
        providerConfig: provider,
        baseUrl: account.baseUrl || provider.defaultBaseUrl,
      };
    });
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatAmount(value) {
  const number = numberOrNull(value);
  if (number == null) return "--";
  if (Number.isInteger(number)) return String(number);
  return String(Number(number.toFixed(4)));
}

function dateFromIso(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function latestGladosCheckinDate(account) {
  const detail = account.lastCheckin?.raw?.list?.[0]?.detail;
  return typeof detail === "string" && /^\d{4}-\d{2}-\d{2}$/.test(detail)
    ? detail
    : "";
}

function getCheckinDate(account) {
  const status = account.lastStatus || {};
  const checkin = account.lastCheckin || {};
  return (
    status.lastCheckinDate ||
    status.lastSignInDate ||
    checkin.checkinDate ||
    checkin.lastSignInDate ||
    latestGladosCheckinDate(account) ||
    dateFromIso(account.lastCheckinAt) ||
    "--"
  );
}

function getCurrency(account) {
  const config = account.providerConfig || {};
  const status = account.lastStatus || {};
  const checkin = account.lastCheckin || {};
  return status.currency || checkin.currency || config.defaultCurrency || "";
}

function getRewardText(account) {
  const checkin = account.lastCheckin || {};
  const currency = getCurrency(account);

  if (account.provider === "embypulse") {
    return `${formatAmount(checkin.reward ?? checkin.points)} ${currency || "积分"}`;
  }

  if (account.provider === "embymb") {
    return `${formatAmount(checkin.points)} ${currency || "积分"}`;
  }

  return `${formatAmount(checkin.points)} ${currency || "Points"}`;
}

function getCheckinLabel(account) {
  const checkin = account.lastCheckin;
  if (!checkin) return "未执行";

  if (checkin.ok) {
    if (checkin.already) {
      return `今日已签 · ${checkin.message || "今天已经签到过了"}`;
    }
    return `签到成功 · +${getRewardText(account)}`;
  }

  return `签到失败 · ${checkin.message || "未知错误"}`;
}

function getStatusLine(account) {
  const status = account.lastStatus || {};
  if (!status || Object.keys(status).length === 0) return "未获取状态";
  return `${status.state || (status.ok ? "active" : "unknown")} · ${status.message || ""}`.trim();
}

function getBalanceLine(account) {
  const status = account.lastStatus || {};
  const checkin = account.lastCheckin || {};
  const config = account.providerConfig || {};
  const currency = getCurrency(account);

  if (account.provider === "glados") {
    const leftDays =
      status.leftDays != null ? formatAmount(status.leftDays) : "--";
    const vip = status.vip ?? "--";
    return `${config.balanceLabel}: ${leftDays} | VIP: ${vip}`;
  }

  const balance =
    status.points ?? checkin.balance ?? checkin.currentPoints ?? "--";
  return `${config.balanceLabel}: ${balance} ${currency}`.trim();
}

function summarize(items) {
  return {
    total: items.length,
    success: items.filter(
      (item) => item.lastCheckin?.ok && !item.lastCheckin?.already,
    ).length,
    already: items.filter((item) => item.lastCheckin?.already).length,
    failed: items.filter((item) => !item.lastCheckin?.ok).length,
    active: items.filter(
      (item) =>
        item.lastStatus?.state === "active" || item.lastStatus?.ok === true,
    ).length,
  };
}

function buildReport(accounts, sentAt) {
  const summary = summarize(accounts);
  const providerGroups = PROVIDERS.map((provider) => ({
    provider,
    accounts: accounts.filter((account) => account.provider === provider.key),
  })).filter((group) => group.accounts.length > 0);

  const lines = [
    "网站每日签到汇总",
    `北京时间: ${formatBeijing(sentAt)}`,
    `UTC: ${formatIso(sentAt)}`,
    `网站数: ${providerGroups.length}`,
    `账号总数: ${summary.total}`,
    `签到成功: ${summary.success}`,
    `今日已签: ${summary.already}`,
    `签到失败: ${summary.failed}`,
    `状态正常: ${summary.active}`,
    "",
  ];

  for (const group of providerGroups) {
    const groupSummary = summarize(group.accounts);
    lines.push(
      `${group.provider.label}: ${groupSummary.total} 个账号，成功 ${groupSummary.success}，已签 ${groupSummary.already}，失败 ${groupSummary.failed}`,
    );

    for (const account of group.accounts) {
      lines.push(
        `- ${account.name || account.username || account.id || group.provider.label}`,
      );
      lines.push(`  站点: ${account.baseUrl || group.provider.defaultBaseUrl}`);
      lines.push(`  签到: ${getCheckinLabel(account)}`);
      lines.push(`  状态: ${getStatusLine(account)}`);
      lines.push(`  ${getBalanceLine(account)}`);
      lines.push(`  最近签到日: ${getCheckinDate(account)}`);
      lines.push(
        `  最后更新时间: ${account.updatedAt || account.lastStatusAt || account.lastCheckinAt || "--"}`,
      );
    }

    lines.push("");
  }

  if (!providerGroups.length) {
    lines.push("没有网站签到账号记录。");
  }

  return lines.join("\n").trim();
}

async function main() {
  const sentAt = new Date();
  const accounts = readWebsiteAccounts();
  const report = buildCompactReport(accounts, sentAt, "网站签到汇总");
  console.log(report);

  try {
    const chatId = await sendTelegramReport(report);
    console.log("[website-checkin-summary] telegram delivered");
    const stateFile = path.join(DATA_DIR, "failure_streaks.json");
    let alerts = [];
    updateJson(
      stateFile,
      (previous) => {
        const evaluated = evaluateFailures(previous, accounts, {
          threshold: Number(process.env.FAILURE_ALERT_DAYS || 3),
        });
        alerts = evaluated.alerts;
        return evaluated.next;
      },
      { fallback: {} },
    );
    if (alerts.length) {
      await sendTelegramReport(
        [
          "网站签到连续失败告警",
          ...alerts.map(
            (a) =>
              `${a.name} (${a.provider}) 已连续 ${a.days} 天失败，请在面板查看原因`,
          ),
        ].join("\n"),
      );
      updateJson(
        stateFile,
        (current) => {
          for (const alert of alerts)
            if (current[alert.key]) current[alert.key].alertedOn = alert.date;
          return current;
        },
        { fallback: {} },
      );
    }
  } catch (error) {
    console.error("[website-checkin-summary] telegram delivery failed");
    process.exitCode = 1;
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error("[website-checkin-summary] fatal error");
    process.exitCode = 1;
  });

module.exports = { main, readWebsiteAccounts };
