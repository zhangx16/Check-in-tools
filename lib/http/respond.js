const { AppError } = require("./errors");
function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}
function sendText(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(message);
}
function readRequestBody(req, limit = req.url?.split("?")[0] === "/api/accounts/import" ? 1024 * 1024 : 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0; let failed = false;
    req.on("data", chunk => {
      bytes += chunk.length;
      if (failed) return;
      if (bytes > limit) { failed = true; chunks.length = 0; reject(new AppError(413, "BODY_TOO_LARGE", "请求体过大")); return; }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      if (failed) return;
      try { resolve(bytes ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(new AppError(400, "INVALID_JSON", "请求体不是合法 JSON")); }
    });
    req.on("aborted", () => reject(new AppError(400, "ABORTED", "请求已取消")));
    req.on("error", reject);
  });
}
module.exports = { sendJson, sendText, readRequestBody };
