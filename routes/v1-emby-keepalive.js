module.exports = function createRoutes(context) {
const { embyKeepalive, sendJson, readRequestBody } = context;
return async function route(req,res,url) {
const pathname=url.pathname, method=req.method||"GET";
if (pathname === "/api/v1/emby/keepalive" || pathname.startsWith("/api/v1/emby/keepalive/")) {
      try {
        if (method === "GET" && pathname === "/api/v1/emby/keepalive") {
          sendJson(res, 200, { accounts: embyKeepalive.list(), generatedAt: new Date().toISOString() });
          return;
        }
        if (method === "POST" && pathname === "/api/v1/emby/keepalive") {
          sendJson(res, 201, { account: embyKeepalive.create(await readRequestBody(req)) });
          return;
        }
        const match = pathname.match(/^\/api\/v1\/emby\/keepalive\/([a-zA-Z0-9_-]+)(?:\/(run|test))?$/);
        if (match) {
          const [,id,action] = match;
          if (method === "POST" && action === "run") { sendJson(res,202,embyKeepalive.launch(id)); return; }
          if (method === "POST" && action === "test") { sendJson(res,200,await embyKeepalive.test(id)); return; }
          if (method === "PUT" && !action) { sendJson(res,200,{ account:embyKeepalive.edit(id,await readRequestBody(req)) }); return; }
          if (method === "DELETE" && !action) { embyKeepalive.remove(id); sendJson(res,200,{ok:true}); return; }
        }
        sendJson(res,404,{error:"Not Found"});
      } catch(error) { sendJson(res,error.status || 400,{error:error.message || "Emby 保活操作失败"}); }
      return;
    }
};
};
