const path = require('node:path');
const { spawn } = require('node:child_process');

function solveCheckin(account, userAgent) {
  return new Promise((resolve, reject) => {
    const root = path.resolve(__dirname, '..');
    const child = spawn(process.env.GLADOS_CF_PYTHON || path.join(root, '.venv-embykeeper/bin/python'),
      [path.join(root, 'scripts/glados_cf_checkin.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let settled = false;
    const finish = (error, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(payload);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('GLaDOS CF 验证超时，请在网站核对结果'));
    }, 150000);
    child.on('error', () => finish(new Error('无法启动 GLaDOS CF 验证程序')));
    child.stdin.on('error', () => {});
    child.stderr.resume(); // Never expose credentials through process diagnostics.
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) {
        child.kill('SIGKILL');
        finish(new Error('GLaDOS CF 验证响应过大'));
      }
    });
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) return finish(new Error('GLaDOS CF 验证程序执行失败'));
      try {
        const result = JSON.parse(stdout);
        if (result.error) return finish(new Error(result.error));
        if (!result.payload || typeof result.payload !== 'object') throw new Error();
        finish(null, result.payload);
      } catch {
        finish(new Error('GLaDOS CF 验证响应格式异常'));
      }
    });
    child.stdin.end(JSON.stringify({ baseUrl: account.baseUrl, cookie: account.cookie, userAgent }));
  });
}
module.exports = { solveCheckin };
