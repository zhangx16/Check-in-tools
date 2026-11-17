module.exports = function createRoutes(context) {
const { updateAccounts, mergeExecution, createAccount, updateAccount, deleteAccount, workbuddyJobs, readAccounts, writeAccounts, runAccountCheckin, sendJson, readRequestBody, toMobileAccountDetail, normalizeAccountMobileUpdate, normalizeAccountInput, validateAccount, findAccountOrNull, runBatch } = context;
return async function route(req,res,url) {
const pathname=url.pathname, method=req.method||"GET";
if (method === "GET" && pathname === "/api/v1/accounts") {
      sendJson(res, 200, {
        accounts: readAccounts().map((a) => toMobileAccountDetail(a))
      });
      return;
    }
if (method === "POST" && pathname === "/api/v1/accounts") {
      const body = await readRequestBody(req);
      const nextAccount = createAccount(body);
      sendJson(res, 201, { account: toMobileAccountDetail(nextAccount) });
      return;
    }
const v1AccountMatch = pathname.match(/^\/api\/v1\/accounts\/([^/]+)$/);
if (v1AccountMatch) {
      const accountId = decodeURIComponent(v1AccountMatch[1]);
      const accounts = readAccounts();
      const account = findAccountOrNull(accounts, accountId);
      if (!account) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }

      if (method === "GET") {
        sendJson(res, 200, { account: toMobileAccountDetail(account) });
        return;
      }

      if (method === "PUT") {
        const body = await readRequestBody(req);
        const nextAccount = updateAccount(body, account);
        sendJson(res, 200, { account: toMobileAccountDetail(nextAccount) });
        return;
      }

      if (method === "DELETE") {
        const nextAccounts = deleteAccount(accountId);
        sendJson(res, 200, { ok: true, deletedId: accountId });
        return;
      }
    }
const v1CheckinMatch = pathname.match(/^\/api\/v1\/accounts\/([^/]+)\/checkin$/);
if (method === "POST" && pathname === "/api/v1/checkin/run") {
      const body = await readRequestBody(req);
      const provider = String(body?.provider || "").trim().toLowerCase();
      const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
      let accounts = readAccounts();
      let selected = accounts;
      if (ids.length) {
        const set = new Set(ids);
        selected = accounts.filter((a) => set.has(a.id));
      } else if (provider) {
        selected = accounts.filter((a) => (a.provider || "glados") === provider);
      }
      if (!selected.length) {
        sendJson(res, 400, { error: "没有可签到的账号" });
        return;
      }
      const processed = await runBatch(accounts, selected.map((item) => item.id), runAccountCheckin);
      accounts = processed.accounts;
      const results = processed.results.map((summary) => ({
        id: summary.id,
        name: summary.name,
        ok: Boolean(summary?.checkin?.ok),
        message: summary?.checkin?.message || ""
      }));
      // runBatch already committed execution fields.
      sendJson(res, 200, {
        ok: results.every((r) => r.ok),
        results,
        successCount: results.filter((r) => r.ok).length,
        total: results.length
      });
      return;
    }
if (v1CheckinMatch && method === "POST") {
      const accountId = decodeURIComponent(v1CheckinMatch[1]);
      const accounts = readAccounts();
      const account = findAccountOrNull(accounts, accountId);
      if (!account) {
        sendJson(res, 404, { error: "账号不存在" });
        return;
      }
      if (account.provider === "workbuddy") { sendJson(res, 202, workbuddyJobs.launch(accountId, "auto")); return; }
    const processed = await runAccountCheckin(account);
      const nextAccounts = updateAccounts(current => current.map(item => item.id === accountId ? mergeExecution(item, processed.account, account) : item));
      sendJson(res, 200, {
        ok: Boolean(processed.summary?.checkin?.ok ?? processed.account?.lastCheckin?.ok),
        result: processed.summary,
        account: toMobileAccountDetail(processed.account)
      });
      return;
    }
};
};
