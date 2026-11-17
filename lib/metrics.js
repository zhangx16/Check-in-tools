let summaryLatencyMs = 0;
function observeSummary(ms) {
  summaryLatencyMs = Math.max(0, Number(ms) || 0);
}
function renderMetrics(accounts, botCount) {
  const lines = [
    "checkin_process_rss_bytes " + process.memoryUsage().rss,
    "checkin_summary_latency_ms " + summaryLatencyMs.toFixed(3),
    "checkin_accounts " + accounts.length,
    "checkin_tg_bots " + botCount,
  ];
  const latest = new Map();
  for (const account of accounts) {
    if (account.lastCheckin?.ok !== true) continue;
    const timestamp = Date.parse(account.lastCheckinAt) / 1000;
    if (!Number.isFinite(timestamp)) continue;
    const provider = String(account.provider || "glados");
    latest.set(provider, Math.max(timestamp, latest.get(provider) || 0));
  }
  for (const [provider, timestamp] of latest)
    lines.push(
      `checkin_last_success_timestamp{provider=${JSON.stringify(provider)}} ${timestamp}`,
    );
  return lines.join("\n") + "\n";
}
module.exports = { observeSummary, renderMetrics };
