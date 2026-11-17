const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const credentials = { ADMIN_USER: "tester", ADMIN_PASS: "isolated-test-password", SESSION_SECRET: "isolated-test-session-secret", APP_API_TOKEN: "isolated-test-bearer-token" };
async function startServer(t, seed = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "checkin-http-"));
 const project = path.resolve(__dirname, "..");
 for (const name of ["lib", "routes", "templates", "public"]) fs.cpSync(path.join(project,name),path.join(root,name),{recursive:true});
 fs.copyFileSync(path.join(project,"server.js"),path.join(root,"server.js"));
 const data = path.join(root,"data"); fs.mkdirSync(path.join(data,"embykeeper"),{recursive:true});
 for (const [file,value] of Object.entries(seed)) fs.writeFileSync(path.join(data,file),JSON.stringify(value));
 // Port zero is bound by the child and reported via IPC, avoiding reserve/rebind races.
 fs.writeFileSync(path.join(root,"test-start.cjs"), `const server=require('./server').createServer();server.listen(0,'127.0.0.1',()=>process.send(server.address().port));`);
 const child=spawn(process.execPath,["test-start.cjs"],{cwd:root,env:{PATH:process.env.PATH,...credentials},stdio:["ignore","ignore","pipe","ipc"]});
 let stderr="";child.stderr.on("data",x=>stderr+=x);
 const port=await Promise.race([once(child,"message").then(x=>x[0]),once(child,"exit").then(()=>{throw Error("Server exited: "+stderr);})]);
 t.after(async()=>{child.kill();await once(child,"exit");fs.rmSync(root,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${port}`;
 async function request(route,{method="GET",body,cookie,token,raw}={}) {
  const res=await fetch(origin+route,{method,headers:{...(body!==undefined||raw!==undefined?{"Content-Type":"application/json"}:{}),...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:raw!==undefined?raw:body!==undefined?JSON.stringify(body):undefined});
  const text=await res.text();let value;try{value=JSON.parse(text)}catch{value=text}
  return {status:res.status,body:value,headers:res.headers};
 }
 async function login(){const res=await request("/api/login",{method:"POST",body:{username:credentials.ADMIN_USER,password:credentials.ADMIN_PASS}});if(res.status!==200)throw Error("login failed");return res.headers.getSetCookie().map(x=>x.split(";")[0]).join("; ");}
 return {root,data,origin,request,login,credentials};
}
module.exports={startServer,credentials};
