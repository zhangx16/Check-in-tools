# HTTP route inventory before PR1

Generated from the production source baseline c0c06ee. Route matching order is preserved.

```js
const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
if (method === "GET" && pathname === "/api/health") {
if (method === "POST" && pathname === "/api/login") {
if (method === "POST" && pathname === "/api/logout") {
if (method === "GET" && pathname === "/api/session") {
if (pathname.startsWith("/api/v1/")) {
if (pathname === "/api/v1/emby/keepalive" || pathname.startsWith("/api/v1/emby/keepalive/")) {
if (method === "GET" && pathname === "/api/v1/emby/keepalive") {
if (method === "POST" && pathname === "/api/v1/emby/keepalive") {
const match = pathname.match(/^\/api\/v1\/emby\/keepalive\/([a-zA-Z0-9_-]+)(?:\/(run|test))?$/);
if (pathname === '/api/v1/workbuddy/accounts' && method === 'GET') {
if (pathname === '/api/v1/workbuddy/logins' && method === 'POST') {
const wbLoginMatch = pathname.match(/^\/api\/v1\/workbuddy\/logins\/([a-f0-9]{48})$/);
const wbJobMatch = pathname.match(/^\/api\/v1\/workbuddy\/accounts\/([^/]+)\/(run|job)$/);
if (method === "GET" && pathname === "/api/v1/summary") {
if (method === "GET" && pathname === "/api/v1/telegram/catalog") {
if (method === "POST" && pathname === "/api/v1/telegram/catalog") {
if (method === "GET" && pathname === "/api/v1/dashboard") {
const dashboardProjectMatch = pathname.match(/^\/api\/v1\/dashboard\/projects\/([^/]+)$/);
if (method === "GET" && pathname === "/api/v1/health") {
if (method === "GET" && pathname === "/api/v1/accounts") {
if (method === "POST" && pathname === "/api/v1/accounts") {
const v1AccountMatch = pathname.match(/^\/api\/v1\/accounts\/([^/]+)$/);
if (method === "GET" && pathname === "/api/v1/telegram/bots") {
const v1TgBotMatch = pathname.match(/^\/api\/v1\/telegram\/bots\/([^/]+)$/);
const v1TgPhoneMatch = pathname.match(/^\/api\/v1\/telegram\/phones\/([^/]+)$/);
const v1TgBotPhoneMatch = pathname.match(
const v1CheckinMatch = pathname.match(/^\/api\/v1\/accounts\/([^/]+)\/checkin$/);
if (method === "POST" && pathname === "/api/v1/checkin/run") {
if (method === "GET" && pathname === "/api/embykeeper/status") {
if (method === "GET" && pathname === "/api/embykeeper/config") {
if (method === "GET" && pathname === "/api/embykeeper/form") {
if (method === "PUT" && pathname === "/api/embykeeper/config") {
if (method === "PUT" && pathname === "/api/embykeeper/form") {
if (method === "POST" && pathname === "/api/embykeeper/run") {
if (method === "GET" && pathname === "/api/accounts") {
if (method === "GET" && pathname === "/api/accounts/export") {
if (method === "POST" && pathname === "/api/accounts") {
if (method === "POST" && pathname === "/api/accounts/import") {
if (method === "POST" && pathname === "/api/accounts/batch-delete") {
if (method === "POST" && pathname === "/api/status/refresh") {
if (method === "POST" && pathname === "/api/checkin/run") {
const detailMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
const statusMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/status\/refresh$/);
const checkinMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/checkin$/);
if (url.pathname.startsWith("/api/")) {
if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
/^\/dashboard\/(?:index\.html|dashboard-runtime\.js|workbuddy-ui\.js|dashboard-patches\.css|emby-keepalive\.js|reference-\d+\.css)?$/.test(url.pathname)) {
if (url.pathname === "/dashboard/") url.pathname += "index.html";
(url.pathname.startsWith("/bot-avatars/") || url.pathname.startsWith("/site-icons/")) &&
```
