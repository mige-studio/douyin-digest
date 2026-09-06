const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');

async function checkReply(reply){
 const nodes=new Map(),requests=[];
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false});return nodes.get(id);};
 const context=vm.createContext({document:{getElementById:get},chrome:{storage:{local:{get:async()=>({})}},runtime:{sendMessage:async message=>{requests.push(message);return reply;}}}});
 for(const file of ['settings.js','options.js'])await vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
 return {status:get('runtimeStatus').textContent,requests};
}
test('settings does not certify old-but-connected workers as having the current repair',async()=>{
 for(const protocol of ['whole-resource-2',undefined]){
  const result=await checkReply({success:true,protocol,resourceId:'volc.seedasr.auc',busy:false});
  assert.match(result.status,/本次修复尚未加载/);assert.doesNotMatch(result.status,/本次修复已加载/);
  assert.deepEqual(result.requests.map(m=>m.action),['runtimeCheck']);
 }
 const current=await checkReply({success:true,protocol:'whole-resource-3',resourceId:'volc.seedasr.auc',busy:false});
 assert.equal(current.status,'本次修复已加载：录音识别 2.0，当前空闲。');
});
