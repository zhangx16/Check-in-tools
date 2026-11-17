module.exports = function createService(context) {
  const { isAlreadyCheckedInMessage } = context;
  function emptyStatusCounts() {
    return {
      success: 0,
      already: 0,
      failed: 0,
      skipped: 0,
      unknown: 0,
      partial: 0,
      pending: 0,
    };
  }
  function deriveWebsiteItemStatus(account) {
    const checkin = account.lastCheckin || null;
    const status = account.lastStatus || null;

    if (checkin) {
      if (account.provider === "workbuddy" && checkin.ok === false)
        return "failed";
      if (checkin.skipped) return "skipped";
      if (
        checkin.already === true ||
        isAlreadyCheckedInMessage(checkin.message)
      )
        return "already";
      if (checkin.ok === true) return "success";
      if (checkin.ok === false) return "failed";
    }

    if (status) {
      if (status.todaySigned === true) return "already";
      if (
        status.ok === true &&
        /已签到|already|signed/i.test(String(status.message || ""))
      ) {
        return "already";
      }
      if (status.ok === false) return "failed";
      if (status.ok === true && !account.lastCheckinAt) return "unknown";
    }

    if (!account.lastCheckinAt && !account.lastStatusAt) {
      return "pending";
    }
    return "unknown";
  }
  function accountStatusFromTelegramAcc(acc, bot) {
    if (acc?.skipped) return "skipped";
    if (acc?.already) return "already";
    if (acc?.ok === true) return "success";
    if (acc?.ok === false) return "failed";
    if (bot?.status === "skipped") return "skipped";
    if (bot?.status === "success" || bot?.ok === true) return "success";
    if (
      bot?.ok === false ||
      bot?.status === "failed" ||
      bot?.status === "error"
    )
      return "failed";
    return "unknown";
  }
  function aggregateProjectStatus(statuses) {
    if (!statuses.length) return "unknown";
    if (statuses.some((s) => s === "failed")) return "failed";
    if (statuses.every((s) => s === "success" || s === "already")) {
      return statuses.every((s) => s === "already") ? "already" : "success";
    }
    if (statuses.every((s) => s === "skipped")) return "skipped";
    if (
      statuses.some((s) => s === "skipped") &&
      !statuses.some((s) => s === "failed")
    ) {
      if (statuses.some((s) => s === "success" || s === "already"))
        return "partial";
      return "skipped";
    }
    if (statuses.some((s) => s === "pending")) return "pending";
    return "unknown";
  }

  return {
    emptyStatusCounts,
    deriveWebsiteItemStatus,
    accountStatusFromTelegramAcc,
    aggregateProjectStatus,
  };
};

module.exports.STATUSES = Object.freeze([
  "success",
  "already",
  "failed",
  "skipped",
  "pending",
  "unknown",
  "partial",
]);
