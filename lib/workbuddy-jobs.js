const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR, formatDateTime } = require('./common');
const { readProviderAccounts, writeProviderAccounts } = require('./accounts');
const workbuddy = require('./providers/workbuddy');
const running = new Map();
const dir = path.join(DATA_DIR, 'workbuddy-jobs');
const file = id => path.join(dir, crypto.createHash('sha256').update(id).digest('hex') + '.json');
function save(job) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = file(job.accountId), temp = target + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(job), { mode: 0o600 });
  fs.renameSync(temp, target);
}
function find(id) { return readProviderAccounts('workbuddy').find(a => a.id === id); }
function get(id) {
  if (!find(id)) throw Object.assign(Error('账号不存在'), { status: 404 });
  if (!fs.existsSync(file(id))) return { accountId: id, state: 'idle' };
  const job = JSON.parse(fs.readFileSync(file(id), 'utf8'));
  if (job.state === 'running' && !running.has(id)) return { ...job, state: 'interrupted', message: '服务已重启，请重新执行签到' };
  return job;
}
function launch(id, action = 'auto') {
  const account = find(id);
  if (!account) throw Object.assign(Error('账号不存在'), { status: 404 });
  if (!['auto', 'status'].includes(action)) throw Object.assign(Error('不支持的任务类型'), { status: 400 });
  if (running.has(id)) return running.get(id);
  const job = { accountId: id, action, state: 'running', startedAt: formatDateTime(), message: '正在后台执行，可稍后查看结果' };
  running.set(id, job); save(job);
  // Return HTTP 202 before doing potentially long-running growth-center work.
  Promise.resolve().then(async () => {
    try {
      const processed = await (action === 'status' ? workbuddy.refreshAccountStatus(account) : workbuddy.runAccountCheckin(account));
      const result = action === 'status' ? processed.account.lastStatus : processed.account.lastCheckin;
      const current = readProviderAccounts('workbuddy');
      const currentAccount = current.find(a => a.id === id);
      const unchanged = currentAccount && JSON.stringify(currentAccount.workbuddySession) === JSON.stringify(account.workbuddySession);
      if (unchanged && result.code !== 'BUSY') writeProviderAccounts('workbuddy', current.map(a => a.id === id ? workbuddy.mergeRun(a, processed.account) : a));
      Object.assign(job, { state: result.ok ? 'completed' : 'failed', message: unchanged ? result.message : '账号或凭据已变更，本次结果未写入', result });
    } catch { Object.assign(job, { state: 'failed', message: '后台任务执行失败，请重试' }); }
    finally { job.finishedAt = formatDateTime(); save(job); running.delete(id); }
  });
  return job;
}
module.exports = { launch, get };
