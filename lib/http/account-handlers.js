const { updateAccounts } = require("../accounts");
const { AppError } = require("./errors");
// Shared write behavior for legacy Cookie routes and v1 routes. DTOs stay in HTTP adapters.
function createAccountHandlers({ readAccounts, writeAccounts, normalizeAccountInput, normalizeAccountMobileUpdate, validateAccount }) {
  function validate(account) { const error = validateAccount(account); if (error) throw new AppError(400, "INVALID_ACCOUNT", error); }
  function createAccount(body) {
    const account = normalizeAccountInput(body); validate(account);
    updateAccounts(accounts => [account, ...accounts]); return account;
  }
  function updateAccount(body, current) {
    let account;
    updateAccounts(accounts => {
      const latest=accounts.find(item=>item.id===current.id);
      if(!latest)throw new AppError(404,"NOT_FOUND","账号不存在");
      account=normalizeAccountMobileUpdate(body,latest);validate(account);
      return accounts.map(item=>item.id===account.id?account:item);
    });
    return account;
  }
  function deleteAccount(id) {
    return updateAccounts(accounts => accounts.filter(item => item.id !== id));
  }
  return { createAccount, updateAccount, deleteAccount };
}
module.exports = { createAccountHandlers };
