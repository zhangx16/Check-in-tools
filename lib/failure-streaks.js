function day(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
function evaluateFailures(
  previous,
  accounts,
  { now = new Date(), threshold = 3 } = {},
) {
  const today = day(now),
    yesterday = new Date(Date.parse(today) - 86400000)
      .toISOString()
      .slice(0, 10),
    next = { ...previous },
    alerts = [];
  for (const account of accounts) {
    if (day(account.lastCheckinAt) !== today) continue;
    const key = (account.provider || "glados") + ":" + account.id,
      old = previous[key] || {},
      result = account.lastCheckin || {};
    const failed = result.ok === false && !result.skipped && !result.already;
    const streak = !failed
      ? 0
      : old.date === today
        ? old.streak
        : old.date === yesterday
          ? Number(old.streak || 0) + 1
          : 1;
    next[key] = { date: today, streak, alertedOn: old.alertedOn || "" };
    if (streak >= threshold && old.alertedOn !== today)
      alerts.push({
        key,
        id: account.id,
        name: account.name,
        provider: account.provider,
        days: streak,
        date: today,
      });
  }
  return { next, alerts };
}
module.exports = { evaluateFailures, day };
