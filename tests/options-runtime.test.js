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

test('AI and transcription selectors reveal and save only their chosen paths',async()=>{
 const nodes=new Map(),requests=[],store={dyd_settings:{aiApiKey:'old-deepseek-key',volcApiKey:'speech-key'}};
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,hidden:false});return nodes.get(id);};
 const context=vm.createContext({confirm:()=>false,document:{getElementById:get},chrome:{storage:{local:{get:async key=>key?{[key]:store[key]}:{...store},set:async value=>Object.assign(store,value),remove:async()=>{}}},runtime:{sendMessage:async message=>{requests.push(message);return {success:true,protocol:'whole-resource-3',resourceId:'volc.seedasr.auc',busy:false};}}}});
 for(const file of ['settings.js','options.js'])await vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
 assert.equal(get('aiProvider').value,'deepseek');assert.equal(get('aiKey').value,'old-deepseek-key');assert.equal(get('arkSettings').hidden,true);assert.equal(get('volcSettings').hidden,false);
 get('aiProvider').value='ark';get('arkKey').value='company-ark-key';get('aiProvider').onchange();
 assert.equal(get('deepseekSettings').hidden,true);assert.equal(get('arkSettings').hidden,false);
 await get('settingsForm').onsubmit({preventDefault(){}});
 assert.equal(store.dyd_settings.aiProvider,'ark');assert.equal(store.dyd_settings.arkApiKey,'company-ark-key');assert.equal(store.dyd_settings.aiApiKey,'old-deepseek-key');assert.equal(store.dyd_settings.volcApiKey,'speech-key');assert.deepEqual(requests.map(m=>m.action),['runtimeCheck','runtimeCheck']);
});
