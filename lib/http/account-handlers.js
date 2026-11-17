const { AppError } = require("./errors");
// Shared write behavior for legacy Cookie routes and v1 routes. DTOs stay in HTTP adapters.
function createAccountHandlers({ readAccounts, writeAccounts, normalizeAccountInput, normalizeAccountMobileUpdate, validateAccount }) {
  function validate(account) { const error = validateAccount(account); if (error) throw new AppError(400, "INVALID_ACCOUNT", error); }
  function createAccount(body) {
    const account = normalizeAccountInput(body); validate(account);
    writeAccounts([account, ...readAccounts()]); return account;
  }
  function updateAccount(body, current) {
    const account = normalizeAccountMobileUpdate(body, current); validate(account);
    writeAccounts(readAccounts().map(item => item.id === account.id ? account : item)); return account;
  }
  function deleteAccount(id) {
    const accounts = readAccounts().filter(item => item.id !== id); writeAccounts(accounts); return accounts;
  }
  return { createAccount, updateAccount, deleteAccount };
}
module.exports = { createAccountHandlers };
