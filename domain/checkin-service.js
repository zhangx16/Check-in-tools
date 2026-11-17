module.exports = function createService(context) {
  const {
    runConcurrent,
    workbuddyJobs,
    updateAccounts,
    mergeExecution,
    refreshAccountStatus,
  } = context;
  async function runOne(account, worker) {
    if (account.provider === "workbuddy")
      return {
        queued: true,
        job: workbuddyJobs.launch(
          account.id,
          worker === refreshAccountStatus ? "status" : "auto",
        ),
      };
    const processed = await worker(account);
    const latest = updateAccounts((current) =>
      current.map((item) =>
        item.id === account.id
          ? mergeExecution(item, processed.account, account)
          : item,
      ),
    );
    return {
      ...processed,
      account:
        latest.find((item) => item.id === account.id) || processed.account,
    };
  }
  function findAccountOrNull(accounts, id) {
    return accounts.find((item) => item.id === id) || null;
  }
  async function runBatch(accounts, ids, worker) {
    const idSet = ids?.length ? new Set(ids) : null;
    const selected = idSet
      ? accounts.filter((item) => idSet.has(item.id))
      : accounts.slice();

    if (!selected.length) {
      return {
        accounts,
        results: [],
      };
    }

    const concurrency = Math.max(
      1,
      Number(process.env.CHECKIN_CONCURRENCY || 4),
    );
    const processedList = await runConcurrent(
      selected,
      (account) => {
        if (account.provider !== "workbuddy") return worker(account);
        const job = workbuddyJobs.launch(
          account.id,
          worker === refreshAccountStatus ? "status" : "auto",
        );
        return {
          account,
          summary: {
            id: account.id,
            name: account.name,
            queued: true,
            job,
            message: "WorkBuddy 已转入后台执行，请查看任务结果",
          },
        };
      },
      concurrency,
    );
    const updatedById = new Map();
    const results = [];

    for (const processed of processedList) {
      if (processed.account.provider !== "workbuddy")
        updatedById.set(processed.account.id, processed.account);
      results.push(processed.summary);
    }

    const nextAccounts = updateAccounts((current) =>
      current.map((item) =>
        updatedById.has(item.id)
          ? mergeExecution(
              item,
              updatedById.get(item.id),
              selected.find((a) => a.id === item.id),
            )
          : item,
      ),
    );
    return {
      accounts: nextAccounts,
      results,
    };
  }

  return { runOne, findAccountOrNull, runBatch };
};
