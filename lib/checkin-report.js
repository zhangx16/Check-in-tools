const { formatBeijing } = require("./common");

const LABELS = { glados: "GLaDOS", embypulse: "EmbyPulse", embymb: "EmbyMB", vpsnat: "VPSNAT", zzcat: "这只猫用户中心" };

function compactText(value, limit = 100) {
  const text = String(value || "未知错误").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function amount(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? String(Number(number.toFixed(2))) : null;
}

function accountLine(account) {
  const checkin = account.lastCheckin;
  const name = account.name || account.username || account.id || "账号";
  if (!checkin?.ok) return `❌ ${name}｜${compactText(checkin?.message || "未执行")}`;
  const status = account.lastStatus || {};
  const details = [checkin.already ? "已签" : "成功"];
  const reward = amount(checkin.reward ?? checkin.points);
  if (!checkin.already && reward != null) details.push(`+${reward} ${checkin.currency || status.currency || (account.provider === "glados" ? "分" : "积分")}`);
  if (account.provider === "glados") {
    const days = amount(status.leftDays);
    if (days != null) details.push(`剩余 ${days} 天`);
  } else {
    const balance = amount(status.points ?? checkin.balance ?? checkin.currentPoints);
    if (balance != null) details.push(`余额 ${balance}`);
  }
  if (status.ok === false) details.push(`状态异常：${compactText(status.message)}`);
  return `✅ ${name}｜${details.join(" · ")}`;
}

function buildCompactReport(accounts, sentAt, title = "每日签到") {
  const success = accounts.filter(a => a.lastCheckin?.ok && !a.lastCheckin?.already).length;
  const already = accounts.filter(a => a.lastCheckin?.ok && a.lastCheckin?.already).length;
  const failed = accounts.length - success - already;
  const lines = [ `${title}｜${formatBeijing(sentAt)}`, `成功 ${success} · 已签 ${already} · 失败 ${failed}` ];
  const providers = [...new Set(accounts.map(a => a.provider || "glados"))];
  for (const provider of providers) {
    lines.push("", LABELS[provider] || provider);
    lines.push(...accounts.filter(a => (a.provider || "glados") === provider).map(a => accountLine({ ...a, provider })));
  }
  if (!accounts.length) lines.push("暂无签到账号");
  return lines.join("\n");
}

function buildCompactFailureAlert(accounts, sentAt) {
  const failed = accounts.filter(a => !a.lastCheckin?.ok);
  if (!failed.length) return "";
  return [`签到异常｜${formatBeijing(sentAt)}`, ...failed.map(a => `${LABELS[a.provider] || a.provider || "GLaDOS"} · ${accountLine(a)}`)].join("\n");
}

module.exports = { buildCompactReport, buildCompactFailureAlert };
