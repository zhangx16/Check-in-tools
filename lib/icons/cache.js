const fs = require("fs"),
  path = require("path");
const queue = [];
let running = 0;
function drain() {
  while (running < 4 && queue.length) {
    const task = queue.shift();
    running++;
    Promise.resolve()
      .then(task)
      .catch(() => {})
      .finally(() => {
        running--;
        drain();
      });
  }
}
function createIconCache(
  dir,
  prefix,
  fetchIcon,
  ttlMs,
  { enabled = process.env.ICON_FETCH_ENABLED !== "0", now = Date.now } = {},
) {
  const pending = new Set(),
    attempts = new Map();
  return (name, ...args) => {
    const key = String(name || "")
      .trim()
      .replace(/^@/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!key) return null;
    let found = null,
      fresh = false;
    try {
      const file = fs
        .readdirSync(dir)
        .find(
          (f) =>
            f.startsWith(key + ".") &&
            !f.endsWith(".meta.json") &&
            !f.endsWith(".tmp"),
        );
      if (file) {
        found = `/${prefix}/${file}`;
        const meta = JSON.parse(
          fs.readFileSync(path.join(dir, key + ".meta.json"), "utf8"),
        );
        fresh = now() - Number(meta.fetchedAt) < ttlMs;
      }
    } catch {}
    if (
      enabled &&
      !fresh &&
      !pending.has(key) &&
      now() - (attempts.get(key) || 0) > 30000
    ) {
      pending.add(key);
      attempts.set(key, now());
      // Run on a later event-loop turn, after the response has been sent.
      setImmediate(() => {
        queue.push(async () => {
          try {
            await fetchIcon(name, ...args);
          } finally {
            pending.delete(key);
          }
        });
        drain();
      });
    }
    return found;
  };
}
module.exports = { createIconCache };
