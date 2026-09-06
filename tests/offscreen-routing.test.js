const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');

test('new audio runtime rejects stale worker start messages before downloading any media',()=>{
 let listener,reply;const ctx=vm.createContext({
  chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn}}},
  fetch:()=>assert.fail('must not download'),setInterval:()=>assert.fail('must not run')
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../offscreen.mjs'),'utf8').replace(/^import .*;\n/gm,''),ctx);
 const sender={id:'test',url:'chrome-extension://test/background.js'};
 for(const fields of [{},{resourceId:'volc.seedasr.auc'},{protocol:'whole-resource-2',resourceId:'volc.seedasr.auc'},{protocol:'whole-resource-3',resourceId:'bad'}]){
  listener({target:'audio',action:'audioStart',...fields},sender,r=>reply=r);
  assert.equal(reply.success,false);assert.match(reply.error,/未开始转写/);
 }
 listener({target:'audio',action:'audioState'},sender,r=>reply=r);
 assert.equal(reply.protocol,'whole-resource-3');assert.equal(reply.active,null);
});

test('whole audio submit sends the service frozen in the durable checkpoint to the real transport',async()=>{
 for(const resourceId of ['volc.bigasr.auc','volc.seedasr.auc']){
  const messages=[],requests=[];
  const ctx=vm.createContext({URL,Blob,Uint8Array,btoa,AbortSignal,console,
   setInterval:()=>1,clearInterval:()=>{},
   wholeAudio:async()=>({offset:0,duration:60,buffer:new Blob([new Uint8Array([1,2,3])])}),
   fetch:async(url,options)=>{
    if(url.startsWith('https://v3.douyinvod.com/'))return {ok:true,headers:{get:()=>null},body:{getReader:()=>({})}};
    requests.push({url,options});return {ok:true,headers:{get:()=> '20000000'}};
   },
   chrome:{runtime:{onMessage:{addListener:()=>{}},sendMessage:async m=>{
    messages.push(m);
    if(m.action==='audioWholePrepared'){assert.equal(m.resourceId,resourceId);return {success:true,resourceId};}
    return {success:true};
   }}}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../volc.js'),'utf8'),ctx);
  const source=fs.readFileSync(path.join(__dirname,'../offscreen.mjs'),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,ctx);
  await ctx.run({videoId:'123',runId:'frozen-task',whole:true,resourceId,apiKey:'test-only',mediaUrl:'https://v3.douyinvod.com/audio'});
  assert.equal(requests.length,1);assert.ok(requests[0].url.endsWith('/submit'));
  assert.equal(requests[0].options.headers['X-Api-Resource-Id'],resourceId);
  assert.equal(requests[0].options.headers['X-Api-Request-Id'],'frozen-task');
  assert.equal(JSON.parse(await requests[0].options.body.text()).request.enable_speaker_info,true);
  assert.equal(messages.at(-1).action,'audioWholeSubmitted');assert.equal(messages.at(-1).submissionAccepted,true);
 }
});
test('a missing checkpoint service fails before the network and is not reported as an uncertain upload',async()=>{
 const messages=[];let requests=0;
 const ctx=vm.createContext({URL,Blob,Uint8Array,btoa,AbortSignal,console,setInterval:()=>1,clearInterval:()=>{},
  wholeAudio:async()=>({offset:0,duration:50,buffer:new Blob([new Uint8Array([1,2,3])])}),
  fetch:async url=>{if(url.startsWith('https://v3.douyinvod.com/'))return {ok:true,headers:{get:()=>null},body:{getReader:()=>({})}};requests++;throw new Error('unexpected service request');},
  chrome:{runtime:{onMessage:{addListener:()=>{}},sendMessage:async m=>{messages.push(m);return {success:true};}}}
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../volc.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../offscreen.mjs'),'utf8').replace(/^import .*;\n/gm,''),ctx);
 await ctx.run({videoId:'123',runId:'never-sent',whole:true,resourceId:'volc.seedasr.auc',apiKey:'test-only',mediaUrl:'https://v3.douyinvod.com/audio'});
 const result=messages.at(-1);assert.equal(result.action,'audioWholeSubmitted');
 assert.equal(requests,0);assert.equal(result.rejected,true);assert.equal(result.notSubmitted,true);assert.equal(result.uncertain,false);assert.equal(result.submissionAccepted,false);
});
