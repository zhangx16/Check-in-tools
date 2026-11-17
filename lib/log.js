const fs = require("fs");
const path = require("path");
// Accept only these operational fields; callers cannot accidentally serialize credentials.
function log(level, msg, fields = {}) {
  const record = { ts: new Date().toISOString(), level, msg };
  for (const key of ["reqId", "durationMs", "method", "status", "code"])
    if (fields[key] !== undefined) record[key] = fields[key];
  process.stdout.write(JSON.stringify(record) + "\n");
}
function audit(file, fields) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const record = { ts: new Date().toISOString() };
  for (const key of ["actor", "ip", "action", "targetId", "ok"])
    record[key] = fields[key];
  fs.appendFileSync(file, JSON.stringify(record) + "\n", { mode: 0o600 });
}
module.exports = { log, audit };
