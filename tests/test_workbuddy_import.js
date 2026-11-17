const {test,after}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'wb-import-')),file=path.join(dir,'accounts.json');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
function input(uid,token){const p=path.join(dir,uid+'.json');fs.writeFileSync(p,JSON.stringify({auth:{accessToken:token,refreshToken:'refresh-'+uid},account:{uid}}));return p;}
function run(args){return spawnSync(process.execPath,[path.join(root,'scripts/import_workbuddy_auth.js'),...args],{env:{...process.env,WORKBUDDY_ACCOUNTS_FILE:file},encoding:'utf8'});}
test('CLI fallback adds distinct accounts, rejects duplicate adds and only updates matching UID',()=>{
 const a=input('user-a','secret-a'),b=input('user-b','secret-b');
 const first=run(['--add','主账号',a]);assert.equal(first.status,0);assert.ok(!first.stdout.includes('secret-a'));
 assert.equal(run(['--add','备用账号',b]).status,0);const before=fs.readFileSync(file,'utf8');
 assert.equal(run(['--add','误重复',a]).status,1);assert.equal(fs.readFileSync(file,'utf8'),before);
 input('user-a','rotated-a');assert.equal(run([a]).status,0);
 const rows=JSON.parse(fs.readFileSync(file));assert.equal(rows.length,2);assert.equal(rows[0].name,'主账号');assert.equal(rows[0].workbuddySession.auth.accessToken,'rotated-a');assert.equal(rows[1].workbuddySession.auth.accessToken,'secret-b');
});
