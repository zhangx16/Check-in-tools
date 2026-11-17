const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const held = new Map();
// Linux flock locks the open file description shared with our short-lived helper.
// Keeping the parent fd open retains the kernel lock; process death releases it.
function acquireLock(target, { timeoutMs = 5000 } = {}) {
  const file = path.resolve(target) + ".flock";
  const existing = held.get(file);
  if (existing) {
    existing.depth++;
    return releaser(file, existing);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, "a+", 0o600);
  const args = [
    "--exclusive",
    ...(timeoutMs ? ["--timeout", String(timeoutMs / 1000)] : ["--nonblock"]),
    "3",
  ];
  const result = spawnSync("flock", args, {
    stdio: ["ignore", "ignore", "pipe", fd],
    timeout: timeoutMs + 1000,
  });
  if (result.status !== 0 || result.error) {
    fs.closeSync(fd);
    throw Object.assign(
      Error(
        result.error
          ? "flock 不可用，请安装 util-linux"
          : "数据正在写入，请稍后重试",
      ),
      {
        status: result.error ? 503 : 409,
        code: result.error ? "LOCK_UNAVAILABLE" : "STORE_BUSY",
      },
    );
  }
  const owner = { fd, depth: 1 };
  held.set(file, owner);
  return releaser(file, owner);
}
function releaser(file, owner) {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (--owner.depth === 0) {
      held.delete(file);
      fs.closeSync(owner.fd);
    }
  };
  release.fd = owner.fd;
  return release;
}
function withLock(target, fn, options) {
  const release = acquireLock(target, options);
  try {
    return fn();
  } finally {
    release();
  }
}
module.exports = { acquireLock, withLock };
