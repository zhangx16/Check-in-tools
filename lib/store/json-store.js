const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const { withLock } = require("./file-lock");
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  try {
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeFileSync(
        fd,
        typeof value === "string" ? value : JSON.stringify(value, null, 2),
      );
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
function updateJson(file, mutate, { fallback = [] } = {}) {
  return withLock(file + ".lock", () => {
    const current = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : fallback;
    const next = mutate(current);
    atomicWrite(file, next);
    return next;
  });
}
module.exports = { atomicWrite, updateJson };
