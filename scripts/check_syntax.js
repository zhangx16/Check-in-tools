const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x => x.isDirectory() ? files(path.join(dir,x.name)) : /\.(?:js|cjs)$/.test(x.name) ? [path.join(dir,x.name)] : []); }
for (const file of ["server.js", ...["lib","routes","scripts"].flatMap(files)]) {
 const result=spawnSync(process.execPath,["--check",file],{stdio:"inherit"}); if(result.status!==0)process.exit(result.status||1);
}
