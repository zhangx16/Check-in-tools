module.exports = function createRoutes(context) {
const { createAccount, updateAccount, deleteAccount, path, DATA_DIR, workbuddyJobs, readAccounts, writeAccounts, refreshAccountStatus, runAccountCheckin, ADMIN_USER, isAuthenticated, sendJson, readRequestBody, audit, toPublicAccount, toPublicAccountDetail, normalizeAccountMobileUpdate, normalizeAccountInput, validateAccount, findAccountOrNull, runBatch, getExportData } = context;
return async function route(req,res,url) {
const pathname=url.pathname, method=req.method||"GET";
if (method === "GET" && pathname === "/api/accounts") {
    sendJson(res, 200, { accounts: readAccounts().map(toPublicAccount) });
    return;
  }
if (method === "GET" && pathname === "/api/accounts/export") {
    const includeSecrets = url.searchParams.get("includeSecrets") === "1";
    if (includeSecrets && !isAuthenticated(req)) { sendJson(res, 403, { error: "Session required" }); return; }
    if (includeSecrets) audit(path.join(DATA_DIR, "audit.log.jsonl"), { actor: ADMIN_USER, ip: req.socket.remoteAddress, action: "export.secrets", targetId: "accounts", ok: true });
    const payload = getExportData(readAccounts(), includeSecrets);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="checkin-accounts-${Date.now()}.json"`,
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }
if (method === "POST" && pathname === "/api/accounts") {
    const body = await readRequestBody(req);
    const nextAccount = createAccount(body);
    sendJson(res, 201, { account: toPublicAccount(nextAccount) });
    return;
  }
if (method === "POST" && pathname === "/api/accounts/import") {
    const body = await readRequestBody(req);
    const incoming = Array.isArray(body?.accounts)
      ? body.accounts
      : Array.isArray(body)
        ? body
        : [];

    if (!incoming.length) {
      sendJson(res, 400, { error: "缺少可导入的 accounts 数组" });
      return;
    }

    const imported = incoming
      .map((item) => normalizeAccountInput(item))
      .filter((item) => !validateAccount(item));

    if (!imported.length) {
      sendJson(res, 400, { error: "没有可导入的有效账号" });
      return;
    }

    const accounts = [...imported, ...readAccounts()];
    writeAccounts(accounts);
    sendJson(res, 201, { accounts: imported.map(toPublicAccount) });
    return;
  }
if (method === "POST" && pathname === "/api/accounts/batch-delete") {
    const body = await readRequestBody(req);
    const ids = Array.isArray(body?.ids) ? body.ids : [];

    if (!ids.length) {
      sendJson(res, 400, { error: "ids 不能为空" });
      return;
    }

    const idSet = new Set(ids);
    const accounts = readAccounts();
    const nextAccounts = accounts.filter((item) => !idSet.has(item.id));
    writeAccounts(nextAccounts);
    sendJson(res, 200, { deletedIds: ids, accounts: nextAccounts.map(toPublicAccount) });
    return;
  }
if (method === "POST" && pathname === "/api/status/refresh") {
    const body = await readRequestBody(req);
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const accounts = readAccounts();
    const processed = await runBatch(accounts, ids, refreshAccountStatus);
    writeAccounts(processed.accounts);
    sendJson(res, 200, {
      results: processed.results,
      accounts: processed.accounts.map(toPublicAccount)
    });
    return;
  }
if (method === "POST" && pathname === "/api/checkin/run") {
    const body = await readRequestBody(req);
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const accounts = readAccounts();
    const processed = await runBatch(accounts, ids, runAccountCheckin);
    writeAccounts(processed.accounts);
    sendJson(res, 200, {
      results: processed.results,
      accounts: processed.accounts.map(toPublicAccount)
    });
    return;
  }
const detailMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
if (detailMatch) {
    const accountId = detailMatch[1];
    const accounts = readAccounts();
    const account = findAccountOrNull(accounts, accountId);

    if (!account) {
      sendJson(res, 404, { error: "账号不存在" });
      return;
    }

    if (method === "GET") {
      sendJson(res, 200, { account: toPublicAccountDetail(account) });
      return;
    }

    if (method === "PUT") {
      const body = await readRequestBody(req);
      const nextAccount = updateAccount(body, account);
      sendJson(res, 200, { account: toPublicAccount(nextAccount) });
      return;
    }

    if (method === "DELETE") {
      const nextAccounts = deleteAccount(accountId);
      sendJson(res, 200, { deletedId: accountId, accounts: nextAccounts.map(toPublicAccount) });
      return;
    }
  }
const statusMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/status\/refresh$/);
if (method === "POST" && statusMatch) {
    const accountId = statusMatch[1];
    const accounts = readAccounts();
    const account = findAccountOrNull(accounts, accountId);

    if (!account) {
      sendJson(res, 404, { error: "账号不存在" });
      return;
    }

    if (account.provider === "workbuddy") { sendJson(res, 202, workbuddyJobs.launch(accountId, "status")); return; }
    const processed = await refreshAccountStatus(account);
    const nextAccounts = readAccounts().map((item) => (item.id === accountId ? processed.account : item));
    writeAccounts(nextAccounts);
    sendJson(res, 200, { result: processed.summary, account: toPublicAccount(processed.account) });
    return;
  }
const checkinMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/checkin$/);
if (method === "POST" && checkinMatch) {
    const accountId = checkinMatch[1];
    const accounts = readAccounts();
    const account = findAccountOrNull(accounts, accountId);

    if (!account) {
      sendJson(res, 404, { error: "账号不存在" });
      return;
    }

    if (account.provider === "workbuddy") { sendJson(res, 202, workbuddyJobs.launch(accountId, "auto")); return; }
    const processed = await runAccountCheckin(account);
    const nextAccounts = readAccounts().map((item) => (item.id === accountId ? processed.account : item));
    writeAccounts(nextAccounts);
    sendJson(res, 200, { result: processed.summary, account: toPublicAccount(processed.account) });
    return;
  }
};
};
