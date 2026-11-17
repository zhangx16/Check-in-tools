const {atomicWrite}=require("./json-store");
const {withLock}=require("./file-lock");
function persistPair(formFile,configFile,form,render){
 return withLock(formFile+".lock",()=>{const config=render(form);atomicWrite(configFile,config);atomicWrite(formFile,form);return form;});
}
module.exports={persistPair};
