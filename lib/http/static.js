const fs = require("fs");
const path = require("path");
const { sendText } = require("./respond");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};
function createStatic(PUBLIC_DIR) {
  function serveStatic(req, res, url) {
    const pathname = url.pathname;
    const safePath = path
      .normalize(decodeURIComponent(pathname))
      .replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (
      filePath !== PUBLIC_DIR &&
      !filePath.startsWith(PUBLIC_DIR + path.sep)
    ) {
      sendText(res, 403, "Forbidden");
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      sendText(res, 404, "Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300",
    });
    fs.createReadStream(filePath).pipe(res);
  }
  return serveStatic;
}
module.exports = { createStatic };
