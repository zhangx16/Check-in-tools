#!/usr/bin/env node
// Import a local CLI auth file without printing credentials or changing account identity.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { normalizeSession } = require('../lib/providers/workbuddy');
const { readProviderAccounts, writeProviderAccounts } = require('../lib/accounts');
try {
  const args = process.argv.slice(2);
  const add = args[0] === '--add';
  if (add ? args.length !== 3 : args.length !== 1) throw Error('更新：node scripts/import_workbuddy_auth.js <凭据文件>；新增：node scripts/import_workbuddy_auth.js --add <账号名称> <凭据文件>');
  const name = add ? args[1].trim() : '';
  if (add && (!name || name.length > 80)) throw Error('账号名称不能为空，且不能超过 80 字');
  const session = normalizeSession(fs.readFileSync(add ? args[2] : args[0], 'utf8'));
  if (!session.auth.refreshToken) throw Error('文件缺少 refreshToken，无法启用自动续期，请重新登录 CodeBuddy CLI');
  const accounts = readProviderAccounts('workbuddy');
  const matches = accounts.filter(a => {
    try { return normalizeSession(a.workbuddySession).account.uid === session.account.uid; } catch { return false; }
  });
  if (add) {
    if (matches.length) throw Error('该 UID 已存在，未新增或覆盖账号；如需更新，请去掉 --add 参数');
    const at = new Date().toISOString();
    writeProviderAccounts('workbuddy', [...accounts, { id: crypto.randomUUID(), name, provider: 'workbuddy',
      baseUrl: 'https://copilot.tencent.com', enabled: true, workbuddySession: session,
      createdAt: at, updatedAt: at, notes: '' }]);
    console.log('新账号已添加并同步工作台，已启用自动签到与续期。其他账号保持原样。');
  } else {
    if (!matches.length) throw Error('未找到匹配账号；新增请使用 --add <账号名称> <凭据文件>');
    writeProviderAccounts('workbuddy', accounts.map(a => matches.some(x => x.id === a.id)
      ? { ...a, workbuddySession: session, updatedAt: new Date().toISOString() } : a));
    console.log(`已更新 ${matches.length} 个匹配账号的登录凭据，已保留刷新令牌；请查询状态后测试签到。`);
  }
} catch (e) { console.error(e instanceof SyntaxError ? '登录凭据文件不是有效 JSON' : e.code ? '无法读取或保存登录凭据文件，请检查路径和权限' : e.message); process.exitCode = 1; }
