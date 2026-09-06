const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const id='7494934930196155667', other='7339830617644829991';
test('reading cache is read-only for every video and never imports sample uploads',async()=>{
 const h=harness();
 for(const videoId of [id,other,'7680875713884458282']){
  h.store['digest_'+videoId]={transcript:[{text:'已保存的原文',start:9,duration:2}],analysisRevision:4};
  h.store['job_'+videoId]={status:'running',enrichSpeakers:true};
 }
 h.store['volc_upload_interview-part-00.mp3']={status:'success',rows:[]};
 h.store.dyd_notes=[{text:'保留的笔记'}];
 const before=JSON.stringify(h.store);
 for(const videoId of [id,other,'7680875713884458282']){
  const result=await h.call('cache',{videoId});
  assert.equal(result.cache.transcript[0].text,'已保存的原文');assert.equal(result.speakersPending,true);
 }
 assert.equal(JSON.stringify(h.store),before);assert.equal(h.requests.length,0);
});
test('embedded note action uses actual playback and exposes no saved text or paid API',async()=>{
 const h=harness();h.ctx.chrome.runtime.sendMessage=async()=>{};h.setPage({currentTime:12});
 h.store['digest_'+id]={transcript:[{text:'缓存中的真实原话',start:8,duration:8}]};
 const response=await new Promise(resolve=>h.listeners.message({action:'captureMoment',seconds:999,text:'forged'},{id:'test-id',tab:{id:1,url:`https://www.douyin.com/video/${id}`}},resolve));
 assert.equal(response.success,true);assert.equal(response.note,undefined);assert.equal(h.store.dyd_notes[0].seconds,9);assert.equal(h.store.dyd_notes[0].text,'缓存中的真实原话');assert.equal(h.requests.length,0);
});
test('explicit submission rejection does not leave an uncertain paid job',async()=>{
 for(const status of [400,401,403,404,429]){
  const h=harness();h.store.dyd_settings={supadataApiKey:'test-placeholder',transcriptionProvider:'supadata'};
  h.ctx.fetch=async()=>({ok:false,status});await assert.rejects(h.call('generate'));
  assert.equal(h.store['job_'+id],undefined);
 }
});
test('query throttling preserves job and waits before querying again',async()=>{
 const h=harness();h.store.dyd_settings={supadataApiKey:'test-placeholder',transcriptionProvider:'supadata'};h.store['job_'+id]={startedAt:Date.now(),status:'running',jobId:'job-1',info:{videoId:id}};
 let requests=0;h.ctx.fetch=async()=>{requests++;return {ok:false,status:429};};
 assert.equal((await h.call('poll')).throttled,true);assert.equal(h.store['job_'+id].jobId,'job-1');
 assert.equal((await h.call('poll')).throttled,true);assert.equal(requests,1);
});
function harness(){
 const store={},listeners={},requests=[];let page={success:true,videoId:id,title:'公开样本',channelName:'作者',ready:true,duration:50,mediaUrl:'https://v3.douyinvod.com/media?signed=private',transcript:[]};
 const event=name=>({addListener:fn=>{listeners[name]=fn;}});
 const chrome={storage:{local:{setAccessLevel:async()=>{},get:async keys=>keys===null?structuredClone(store):Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(store[k])])),set:async values=>{await Promise.resolve();Object.assign(store,structuredClone(values));},remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete store[k];}}},sidePanel:{setOptions:async()=>{},open:async()=>{},setPanelBehavior:()=>{}},action:{onClicked:event('click')},tabs:{get:async()=>({url:`https://www.douyin.com/video/${id}`}),query:async()=>[],sendMessage:async()=>structuredClone(page),onUpdated:event('update'),onActivated:event('active')},runtime:{id:'test-id',getURL:p=>'chrome-extension://test-id/'+p,onMessage:event('message'),onInstalled:event('install'),onStartup:event('startup')}};
 const ctx=vm.createContext({chrome,URL,URLSearchParams,console,AbortController,AbortSignal,TextEncoder,TextDecoder,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,fetch:async(url,opts)=>{requests.push({url,opts});return {ok:true,status:200,text:async()=>JSON.stringify({content:[{text:'真实测试数据',offset:1000,duration:1000}]})};}});
 ctx.importScripts=(...files)=>{for(const f of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx,{filename:f});};ctx.importScripts('background.js');
 return {store,ctx,requests,listeners,setPage:v=>page={...page,...v},call:(action,data={})=>ctx.handle({action,videoId:id,tabId:1,...data})};
}
test('switching away from a video disables the panel and retires an old global instance',async()=>{
 const h=harness(),calls=[];
 h.ctx.chrome.sidePanel.close=async options=>{calls.push(['close',{...options}]);if(options.tabId)throw new Error('global panel');};
 h.ctx.chrome.sidePanel.setOptions=async options=>calls.push(['options',{...options}]);
 h.ctx.chrome.tabs.get=async()=>({url:'https://example.com/',windowId:2});
 await h.listeners.active({tabId:8,windowId:2});
 assert.deepEqual(calls,[['close',{tabId:8}],['close',{windowId:2}],['options',{tabId:8,path:'sidepanel.html',enabled:false}]]);
});
test('same-tab navigation and closing an author video modal both remove panel availability',async()=>{
 const h=harness(),calls=[];h.ctx.chrome.sidePanel.setOptions=async options=>calls.push({...options});
 h.listeners.update(4,{status:'loading'},{url:`https://www.douyin.com/video/${id}`,pendingUrl:'https://example.com/'});
 h.listeners.update(4,{status:'complete'},{url:'https://example.com/'});
 h.listeners.update(5,{url:'https://www.douyin.com/user/author'},{windowId:1});
 await Promise.resolve();assert.equal(calls.length,3);assert.ok(calls.every(x=>x.enabled===false));
});
test('toolbar and embedded clicks open only a specific video tab; author grids cannot open a panel',async()=>{
 const h=harness(),opens=[],options=[];
 h.ctx.chrome.sidePanel.open=async value=>opens.push({...value});h.ctx.chrome.sidePanel.setOptions=async value=>options.push({...value});
 await h.listeners.click({id:7,url:`https://www.douyin.com/user/author?modal_id=${id}`});
 await h.listeners.click({id:8,url:'https://www.douyin.com/user/author'});
 const result=await new Promise(resolve=>h.listeners.message({action:'openSidePanel'},{id:'test-id',tab:{id:9,url:`https://www.douyin.com/video/${id}`}},resolve));
 assert.equal(result.success,true);assert.deepEqual(opens,[{tabId:7},{tabId:9}]);assert.deepEqual(options.map(x=>x.enabled),[true,false,true]);
});
test('startup restores availability only to video tabs without reopening any panel',async()=>{
 const h=harness(),calls=[];h.ctx.chrome.tabs.query=async()=>[{id:1,url:`https://www.douyin.com/video/${id}`},{id:2,url:'https://example.com/'},{id:3,url:'https://www.douyin.com/user/author'}];
 h.ctx.chrome.sidePanel.setOptions=async options=>calls.push({...options});h.ctx.chrome.sidePanel.open=async()=>assert.fail('must not open automatically');
 await h.listeners.startup();assert.deepEqual(calls.map(x=>[x.tabId,x.enabled]),[[1,true],[2,false],[3,false]]);
});
test('failed transcription remains visible on reopen without another service request',async()=>{
 const h=harness();h.store.dyd_settings={supadataApiKey:'test-placeholder',transcriptionProvider:'supadata'};
 h.store['job_'+id]={startedAt:Date.now(),status:'running',jobId:'job-1',info:{videoId:id}};
 let requests=0;h.ctx.fetch=async()=>{requests++;return {ok:true,status:200,text:async()=>JSON.stringify({status:'failed'})};};
 assert.equal((await h.call('poll')).failed,true);
 assert.equal((await h.call('poll')).failed,true);
 assert.equal(h.store['job_'+id].status,'failed');assert.equal(requests,1);
 await h.call('generate');assert.equal(requests,1);
});
test('native captions do not request paid transcription and signed URLs are not cached',async()=>{
 const h=harness();h.setPage({transcript:[{text:'你好',start:0,duration:2}]});const result=await h.call('sources');assert.equal(result.transcript[0].text,'你好');assert.equal(h.requests.length,0);assert.ok(!JSON.stringify(h.store).includes('signed='));
});
test('no subtitle stays empty, never substituting title or metadata',async()=>{const h=harness();const r=await h.call('sources');assert.equal(r.needsGeneration,true);assert.equal(r.transcript,undefined);assert.equal(h.store['digest_'+id],undefined);});
test('service generation uses a public media URL and milliseconds are converted',async()=>{
 const h=harness();h.store.dyd_settings={supadataApiKey:'test-placeholder',transcriptionProvider:'supadata'};const r=await h.call('generate');assert.equal(r.transcript[0].start,1);
 const url=new URL(h.requests[0].url);assert.equal(url.searchParams.get('mode'),'generate');assert.equal(url.searchParams.get('lang'),'zh');assert.equal(url.searchParams.get('url'),'https://v3.douyinvod.com/media?signed=private');assert.ok(!JSON.stringify(h.store).includes('signed='));
});
test('concurrent clicks submit only one paid generation',async()=>{const h=harness();h.store.dyd_settings={supadataApiKey:'test-placeholder',transcriptionProvider:'supadata'};await Promise.all([h.call('generate'),h.call('generate')]);assert.equal(h.requests.length,1);});
test('queued job is persisted and reused, survives later poll',async()=>{
 const h=harness();h.store.dyd_settings={supadataApiKey:'test-placeholder',transcriptionProvider:'supadata'};
 h.ctx.fetch=async()=>({ok:true,text:async()=>JSON.stringify({jobId:'job-1'})});await h.call('generate');assert.equal(h.store['job_'+id].jobId,'job-1');
 h.ctx.fetch=async()=>{throw new Error('must not resubmit');};assert.equal((await h.call('generate')).pending,true);
 h.ctx.fetch=async()=>({ok:true,text:async()=>JSON.stringify({status:'completed',content:[{text:'结果',offset:2500,duration:1000}]})});
 assert.equal((await h.call('poll')).transcript[0].start,2.5);assert.equal(h.store['job_'+id],undefined);
});
test('uncertain network result blocks automatic polling resubmission',async()=>{
 const h=harness();h.store.dyd_settings={supadataApiKey:'test-placeholder',transcriptionProvider:'supadata'};h.ctx.fetch=async()=>{throw new Error('network lost');};await assert.rejects(h.call('generate'));
 assert.equal(h.store['job_'+id].status,'uncertain');assert.equal((await h.call('poll')).uncertain,true);
});
test('a timed out job can be queried explicitly without submitting again',async()=>{
 const h=harness();h.store.dyd_settings={supadataApiKey:'test-placeholder',transcriptionProvider:'supadata'};h.store['job_'+id]={startedAt:1,status:'running',jobId:'job-1',info:{videoId:id}};
 assert.equal((await h.call('poll')).timedOut,true);assert.equal(h.requests.length,0);
 assert.ok((await h.call('poll',{force:true})).transcript);assert.equal(h.requests.length,1);
});
test('concurrent notes persist without overwriting each other; exact selection needs no AI',async()=>{
 const h=harness();await Promise.all([h.call('saveNote',{text:'第一条',seconds:1}),h.call('saveNote',{text:'第二条',seconds:2})]);
 const notes=(await h.call('notes')).notes;assert.equal(notes.length,2);assert.equal(new Set(notes.map(n=>n.id)).size,2);assert.equal(h.requests.length,0);
 await h.call('deleteNote',{noteId:notes[0].id});assert.equal((await h.call('notes')).notes.length,1);
});
test('cache eviction preserves notes and retains only ten videos',async()=>{
 const h=harness();h.store.dyd_notes=[{id:'saved'}];for(let i=0;i<12;i++)await h.ctx.cacheSet(String(BigInt(id)+BigInt(i)),{transcript:[],scrollTop:i});
 assert.equal(Object.keys(h.store).filter(k=>k.startsWith('digest_')).length,10);assert.equal(h.store.dyd_notes.length,1);
});
test('outdated tab requests cannot seek or read another video',async()=>{const h=harness();await assert.rejects(h.call('page',{videoId:other,command:'seek',seconds:10}),/视频已切换/);});
test('page sender cannot invoke notes, keys or paid APIs',()=>{
 const h=harness();let replied=false;assert.equal(h.listeners.message({action:'generate',videoId:id},{id:'test-id',tab:{id:1,url:`https://www.douyin.com/video/${id}`}},()=>replied=true),false);assert.equal(replied,false);assert.equal(h.requests.length,0);
});
test('AI output validation drops fabricated out-of-range timestamps and extra fields',()=>{
 const h=harness(),r=h.ctx.validateAndFixTimestamps({chapters:[{title:'有效',summary:'说明',timestampSeconds:1},{title:'错',timestampSeconds:999}],keyQuotes:[{quote:'原话',timestampSeconds:2,translation:'多余字段'}]},50);
 assert.equal(r.chapters.length,1);assert.equal(r.keyQuotes[0].translation,undefined);
});
test('reading positions are persisted per video',async()=>{const h=harness();await h.call('view',{scrollTop:345});assert.equal((await h.call('cache')).cache.scrollTop,345);assert.equal(await h.ctx.cacheGet(other),null);});
test('Volc submission keeps UUID through uncertain response and recovers by query without rebilling',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'placeholder-only',transcriptionProvider:'volc'};
 h.ctx.startVolc=h.ctx.startVolcLegacy;
 let submissions=0;h.ctx.fetch=async()=>{submissions++;throw new Error('network interrupted');};
 await assert.rejects(h.call('generate'));const job=h.store['job_'+id];assert.equal(job.provider,'volc');assert.equal(job.status,'uncertain');assert.ok(job.jobId);
 await h.call('generate');assert.equal(submissions,1);
 h.ctx.fetch=async(url,options)=>{assert.match(url,/\/query$/);assert.equal(options.headers['X-Api-Request-Id'],job.jobId);assert.equal(options.body,'{}');return {ok:true,headers:{get:()=> '20000000'},text:async()=>JSON.stringify({result:{utterances:[{start_time:280,end_time:1760,text:'真实分句'}]}})};};
 const result=await h.call('poll');assert.equal(result.transcript[0].start,.28);assert.equal(result.transcript[0].duration,1.48);assert.equal(h.store['job_'+id],undefined);assert.ok(!JSON.stringify(h.store['digest_'+id]).includes('signed='));
 await h.call('generate');assert.equal(submissions,1);
});
test('Volc normal submit and pending query preserve original provider after settings change',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'placeholder-only'};h.ctx.startVolc=h.ctx.startVolcLegacy;let count=0;
 h.ctx.fetch=async(url,options)=>{count++;assert.equal(options.headers['X-Api-Resource-Id'],'volc.bigasr.auc');if(url.endsWith('/submit'))assert.equal(JSON.parse(options.body).request.show_utterances,true);return {ok:true,headers:{get:()=>url.endsWith('/submit')?'20000000':'20000002'}};};
 await Promise.all([h.call('generate'),h.call('generate')]);assert.equal(count,1);
 h.store.dyd_settings.transcriptionProvider='supadata';assert.equal((await h.call('poll')).pending,true);assert.equal(count,2);assert.ok(!JSON.stringify(h.store['job_'+id]).includes('signed='));
});
test('Volc cannot submit without user-entered key or usable audio, and rejects malformed timestamps',async()=>{
 const h=harness();await assert.rejects(h.call('generate'),/火山/);assert.equal(h.requests.length,0);
 h.store.dyd_settings={volcApiKey:'placeholder-only'};h.setPage({mediaUrl:''});await assert.rejects(h.call('generate'),/音频地址/);assert.equal(h.requests.length,0);
 for(const r of [{start_time:-1,end_time:10,text:'错'},{start_time:100,end_time:10,text:'错'},{start_time:0,end_time:10,text:''}])assert.throws(()=>h.ctx.DYD_VOLC.rows({result:{utterances:[r]}}));
});
test('file upload persists checkpoint before paid request and reuses successful chunks',async()=>{
 const h=harness(),runId='upload-run';h.store['job_'+id]={provider:'volc-upload',jobId:runId,status:'running',info:{videoId:id,duration:600}};
 const message=(action,extra={})=>h.ctx.audioMessage({action,videoId:id,runId,...extra});
 const first=await message('audioBeforeUpload',{index:0,offset:0,duration:300});assert.ok(first.jobId);
 await assert.rejects(message('audioBeforeUpload',{index:0,offset:0,duration:300}),/结果不确定/);
 await message('audioPartDone',{index:0,rows:[{text:'保留',start:1,duration:2}]});
 const reused=await message('audioBeforeUpload',{index:0,offset:0,duration:300});assert.equal(reused.rows[0].text,'保留');assert.equal(reused.jobId,undefined);
 await assert.rejects(message('audioBeforeUpload',{index:0,offset:1,duration:300}),/之前不同/);
 await assert.rejects(message('audioComplete'),/音频长度/);
 await message('audioBeforeUpload',{index:1,offset:300,duration:300});await message('audioPartDone',{index:1,rows:[{text:'后半',start:2,duration:3}]});
 const result=await message('audioComplete');assert.equal(result.rows[1].start,302);assert.equal(h.requests.length,0);
});
test('offscreen job callbacks reject stale run IDs and web pages cannot forge completion',async()=>{
 const h=harness();h.store['job_'+id]={provider:'volc-upload',jobId:'current'};
 await assert.rejects(h.ctx.audioMessage({action:'audioComplete',videoId:id,runId:'old'}),/任务已变更/);
 let replied=false;assert.equal(h.listeners.message({target:'background',action:'audioComplete',videoId:id,runId:'current'},{id:'test-id',tab:{id:1,url:`https://www.douyin.com/video/${id}`}},()=>replied=true),false);assert.equal(replied,false);
});
test('closed side panel does not cancel file upload and stalled worker cannot trigger automatic billing',async()=>{
 const h=harness();h.store['job_'+id]={provider:'volc-upload',jobId:'current',status:'running',startedAt:1,heartbeatAt:1,completed:2};
 assert.equal((await h.call('poll')).uncertain,true);assert.equal((await h.call('generate')).pending,true);assert.equal(h.requests.length,0);
});
test('new Volc generation starts one offscreen upload with scoped referrer and no persisted credentials',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'placeholder-only'};let starts=0,rules;
 h.ctx.chrome.runtime.getContexts=async()=>[];h.ctx.chrome.offscreen={createDocument:async args=>assert.equal(args.reasons[0],'BLOBS')};
 h.ctx.chrome.declarativeNetRequest={updateSessionRules:async value=>rules=value};
 h.ctx.chrome.runtime.sendMessage=async m=>{if(m.action==='audioState')return {success:true,protocol:'whole-resource-3',resourceId:m.resourceId,active:null};assert.equal(m.target,'audio');assert.equal(m.apiKey,'placeholder-only');assert.equal(m.speakers,false);starts++;return {success:true};};
 await Promise.all([h.call('generate'),h.call('generate')]);assert.equal(starts,1);assert.equal(h.store['job_'+id].provider,'volc-upload');
 assert.deepEqual(Array.from(rules.addRules[0].condition.initiatorDomains),['test-id']);assert.equal(rules.addRules[0].condition.urlFilter,'||douyinvod.com/');
 assert.ok(!JSON.stringify(h.store['job_'+id]).includes('placeholder-only'));assert.ok(!JSON.stringify(h.store['job_'+id]).includes('signed='));
});
test('a completed offscreen job appears on the next poll without reopening the side panel',async()=>{
 const h=harness();h.store['digest_'+id]={videoId:id,transcript:[{text:'自动完成',start:1,duration:2}],source:'火山语音转写'};
 const result=await h.call('poll');assert.equal(result.transcript[0].text,'自动完成');assert.equal(h.requests.length,0);
});
test('speaker enrichment polls its own job while keeping the readable original and old audio checkpoints',async()=>{
 const h=harness();h.store['digest_'+id]={transcript:[{text:'原文',start:0,duration:5}],analysis:{chapters:[]},analysisRevision:4};
 h.store['audio_parts_'+id]=[{status:'success',rows:[{text:'原结果'}]}];
 h.store['job_'+id]={provider:'volc-upload',speakers:true,status:'running',jobId:'speaker-run',startedAt:Date.now(),heartbeatAt:Date.now(),completed:0,info:{videoId:id,duration:300}};
 assert.equal((await h.call('poll')).pending,true);assert.equal((await h.call('cache')).speakersPending,true);
 const checkpoint=await h.ctx.audioMessage({action:'audioBeforeUpload',videoId:id,runId:'speaker-run',index:0,offset:0,duration:300});assert.ok(checkpoint.jobId);
 await h.ctx.audioMessage({action:'audioPartDone',videoId:id,runId:'speaker-run',index:0,rows:[{text:'新识别文字',start:0,duration:5,speaker:'s1'}]});
 const result=await new Promise(resolve=>h.listeners.message({target:'background',action:'audioComplete',videoId:id,runId:'speaker-run'},{id:'test-id',url:'chrome-extension://test-id/offscreen.html'},resolve));
 assert.equal(result.success,true);assert.equal(h.store['digest_'+id].transcript[0].text,'原文');assert.equal(h.store['digest_'+id].transcript[0].speaker,'s1');assert.ok(h.store['digest_'+id].analysis);assert.equal(h.store['audio_parts_'+id][0].rows[0].text,'原结果');assert.equal(h.store['job_'+id],undefined);
});
test('speaker names are scoped to real speaker IDs and do not rewrite quotes',async()=>{
 const h=harness();h.store['digest_'+id]={transcript:[{text:'原话',start:0,duration:5,speaker:'s1'}]};
 await h.call('speakerNames',{names:{s1:'主持人',s2:'未出现的人',unknown:'乱猜'}});
 assert.deepEqual(h.store['digest_'+id].speakerNames,{s1:'主持人'});assert.equal(h.store['digest_'+id].transcript[0].text,'原话');
});
test('saved exact quotes retain speaker attribution while personal comments remain the user own words',async()=>{
 const h=harness();h.store['digest_'+id]={transcript:[{text:'原话不可更改',start:0,duration:5,speaker:'s1'}],speakerNames:{s1:'主持人'}};
 const quote=await h.call('saveNote',{text:'原话不可更改',seconds:1,quote:true});assert.equal(quote.note.text,'原话不可更改');assert.equal(quote.note.speakerName,'主持人');
 const own=await h.call('saveNote',{text:'原话不可更改',seconds:1,quote:false});assert.equal(own.note.speaker,undefined);
});

test('retired speaker processing cannot trigger another paid run',async()=>{
 const h=harness();
 for(const action of ['identifySpeakers','resumeSpeakers','repairSpeakers'])await assert.rejects(h.call(action),/暂未开放/);
 assert.equal(h.requests.length,0);assert.equal(h.store['job_'+id],undefined);
});
test('audio progress counts only completed audio and never reports pending work as 100 percent',async()=>{
 const h=harness();h.store['job_'+id]={provider:'volc-upload',status:'running',startedAt:Date.now()-120000,heartbeatAt:Date.now(),stage:'upload',info:{duration:600}};
 h.store['audio_parts_'+id]=[{status:'success',duration:300},{status:'submitting',duration:300}];
 const r=await h.call('poll');assert.equal(r.progressDetail.processedSeconds,300);assert.equal(r.progressDetail.totalSeconds,600);assert.equal(r.progressDetail.percent,50);assert.equal(r.progressDetail.completedParts,1);assert.ok(r.progressDetail.elapsedSeconds>=120);assert.equal(h.requests.length,0);
 h.store['audio_parts_'+id][1].status='success';assert.equal((await h.call('poll')).progressDetail.percent,99);
 h.store['job_'+id].info={};assert.equal((await h.call('poll')).progressDetail.percent,null);
});

test('whole recording checkpoint is durable before upload and does not consume old chunk results',async()=>{
 const h=harness(),runId='whole-run';h.store['job_'+id]={provider:'volc-upload',whole:true,jobId:runId,status:'running',info:{videoId:id,duration:600}};
 h.store['audio_parts_'+id]=[{status:'success',rows:[{text:'旧分段'}]}];const before=JSON.stringify(h.store['audio_parts_'+id]);
 await h.ctx.audioMessage({action:'audioWholePrepared',videoId:id,runId,offset:-.04,duration:600.04,bytes:80000});
 const job=h.store['job_'+id];assert.equal(job.provider,'volc');assert.equal(job.resourceId,'volc.bigasr.auc');assert.equal(job.jobId,runId);assert.equal(job.submitFinished,false);
 await assert.rejects(h.ctx.audioMessage({action:'audioWholePrepared',videoId:id,runId,offset:0,duration:600,bytes:80000}));
 await h.ctx.audioMessage({action:'audioWholeSubmitted',videoId:id,runId,uncertain:true});
 assert.equal(h.store['job_'+id].submitFinished,true);assert.equal(h.store['job_'+id].status,'uncertain');assert.equal(JSON.stringify(h.store['audio_parts_'+id]),before);
});
test('normal whole recording freezes selected service through download, submit checkpoint and resumed query',async()=>{
 for(const resourceId of ['volc.bigasr.auc','volc.seedasr.auc']){
  const h=harness();h.store.dyd_settings={volcApiKey:'test-only',volcResourceId:resourceId};
  h.ctx.chrome.runtime.getContexts=async()=>[{}];
  h.ctx.chrome.declarativeNetRequest={updateSessionRules:async()=>{}};
  let start;
  h.ctx.chrome.runtime.sendMessage=async m=>{
   if(m.action==='audioState')return {success:true,protocol:'whole-resource-3',resourceId:m.resourceId,active:null};
   start=m;
   assert.equal(h.store['job_'+id].resourceId,resourceId);
   assert.equal(h.store['job_'+id].jobId,m.runId);
   return {success:true};
  };
  await h.call('generate');assert.equal(start.resourceId,resourceId);assert.equal(start.whole,true);
  h.store.dyd_settings.volcResourceId=resourceId==='volc.bigasr.auc'?'volc.seedasr.auc':'volc.bigasr.auc';
  const message={action:'audioWholePrepared',videoId:id,runId:start.runId,resourceId,offset:0,duration:50,bytes:80000};
  await assert.rejects(h.ctx.audioMessage({...message,resourceId:h.store.dyd_settings.volcResourceId}),/不一致/);
  assert.equal(h.store['job_'+id].submitStarted,undefined);
  const checkpoint=await h.ctx.audioMessage(message);assert.equal(checkpoint.resourceId,resourceId);
  await h.ctx.audioMessage({action:'audioWholeSubmitted',videoId:id,runId:start.runId,uncertain:true});
  const resumed=harness();Object.assign(resumed.store,structuredClone(h.store));
  resumed.ctx.fetch=async(url,opts)=>{
   assert.ok(url.endsWith('/query'));assert.equal(opts.headers['X-Api-Resource-Id'],resourceId);
   assert.equal(opts.headers['X-Api-Request-Id'],start.runId);
   return {ok:true,headers:{get:()=> '20000002'}};
  };
  assert.equal((await resumed.call('poll')).pending,true);
  assert.equal(resumed.store['job_'+id].resourceId,resourceId);
 }
});
test('real offscreen message reply preserves the service frozen before upload',async()=>{
 for(const resourceId of ['volc.bigasr.auc','volc.seedasr.auc']){
  const h=harness(),runId='actual-message-checkpoint';
  h.store['job_'+id]={provider:'volc-upload',whole:true,jobId:runId,resourceId,info:{videoId:id,duration:50}};
  const reply=await new Promise(resolve=>h.listeners.message({target:'background',action:'audioWholePrepared',videoId:id,runId,resourceId,offset:0,duration:50,bytes:80000},{id:'test-id',url:'chrome-extension://test-id/offscreen.html'},resolve));
  assert.equal(reply.success,true);assert.equal(reply.resourceId,resourceId);
  assert.equal(h.store['job_'+id].resourceId,resourceId);assert.equal(h.requests.length,0);
 }
});
test('runtime preflight checks the running audio module without ASR, a job or secrets',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'private-test',volcResourceId:'volc.seedasr.auc'};
 h.ctx.chrome.runtime.getContexts=async()=>[{}];
 h.ctx.chrome.runtime.sendMessage=async m=>{assert.equal(m.action,'audioState');return {success:true,protocol:'whole-resource-3',resourceId:m.resourceId,active:null};};
 const before=JSON.stringify(h.store),result=await h.call('runtimeCheck');
 assert.equal(result.protocol,'whole-resource-3');assert.equal(result.resourceId,'volc.seedasr.auc');assert.equal(result.busy,false);
 assert.equal(JSON.stringify(h.store),before);assert.equal(h.requests.length,0);assert.ok(!JSON.stringify(result).includes('private-test'));
});
test('runtime preflight responds through the real message listener from an extension UI tab',async()=>{
 for(const path of ['options.html','sidepanel.html?video=1']){
  const h=harness();h.store.dyd_settings={volcApiKey:'private-test',volcResourceId:'volc.seedasr.auc'};
  h.ctx.chrome.runtime.getContexts=async()=>[{}];
  h.ctx.chrome.runtime.sendMessage=async m=>({success:true,protocol:'whole-resource-3',resourceId:m.resourceId,active:null});
  const before=JSON.stringify(h.store),url=h.ctx.chrome.runtime.getURL(path);
  const result=await new Promise(resolve=>{
   assert.equal(h.listeners.message({action:'runtimeCheck'},{id:'test-id',url,tab:{id:7,url}},resolve),true);
  });
  assert.equal(result.success,true);assert.equal(result.resourceId,'volc.seedasr.auc');
  assert.equal(result.protocol,'whole-resource-3');assert.equal(result.busy,false);
  assert.equal(JSON.stringify(h.store),before);assert.equal(h.requests.length,0);
  assert.ok(!JSON.stringify(result).includes('private-test'));
 }
});
test('runtime preflight accepts the browser-owned UI tab URL when sender URL is absent',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'private-test',volcResourceId:'volc.seedasr.auc'};
 h.ctx.chrome.runtime.getContexts=async()=>[{}];
 h.ctx.chrome.runtime.sendMessage=async m=>({success:true,protocol:'whole-resource-3',resourceId:m.resourceId,active:null});
 const url=h.ctx.chrome.runtime.getURL('options.html');
 const result=await new Promise(resolve=>{
  assert.equal(h.listeners.message({action:'runtimeCheck'},{id:'test-id',tab:{id:7,url}},resolve),true);
 });
 assert.equal(result.success,true);assert.equal(result.resourceId,'volc.seedasr.auc');
 assert.equal(result.protocol,'whole-resource-3');assert.equal(result.busy,false);
 assert.equal(h.requests.length,0);assert.ok(!JSON.stringify(result).includes('private-test'));
});
test('ordinary page tabs cannot impersonate the extension UI by tab URL or similar paths',()=>{
 for(const url of ['https://www.douyin.com/options.html','chrome-extension://other/options.html','chrome-extension://test-id/options.html/extra','chrome-extension://test-id/verification/volc-upload.html']){
  const h=harness();let replied=false;
  assert.equal(h.listeners.message({action:'runtimeCheck'},{id:'test-id',url,tab:{id:7,url:'chrome-extension://test-id/options.html'}},()=>replied=true),false);
  assert.equal(replied,false);assert.equal(h.requests.length,0);
 }
});
test('old audio runtime is rejected before creating or submitting a paid task',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'test-only',volcResourceId:'volc.seedasr.auc'};
 h.ctx.chrome.runtime.getContexts=async()=>[{}];
 h.ctx.chrome.runtime.sendMessage=async m=>{assert.equal(m.action,'audioState');return {success:true,active:null};};
 await assert.rejects(h.call('generate'),/更新尚未生效/);
 assert.equal(h.store['job_'+id],undefined);assert.equal(h.requests.length,0);
});
test('whole recording resumes a timed-out submit and maps one speaker across the hour boundary',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'test-only'};
 h.store['job_'+id]={provider:'volc',whole:true,submitFinished:true,jobId:'whole-2',resourceId:'volc.bigasr.auc',status:'uncertain',startedAt:Date.now()-3600000,audioDuration:4000,audioOffset:0,info:{videoId:id,duration:4000}};
 h.store.dyd_notes=[{text:'已选中的原话'}];
 h.ctx.fetch=async(url,opts)=>{
  assert.ok(url.endsWith('/query'));assert.equal(opts.headers['X-Api-Request-Id'],'whole-2');
  return {ok:true,headers:{get:()=> '20000000'},text:async()=>JSON.stringify({audio_info:{duration:4000000},result:{utterances:[
   {text:'开头的原话。',start_time:100,end_time:2000,additions:{speaker:'2'}},
   {text:'另一个人。',start_time:2500,end_time:4500,additions:{speaker:'1'}},
   {text:'一小时后的同一个人。',start_time:3600000,end_time:3602000,additions:{speaker:'2'}}]}})};
 };
 const result=await h.call('poll');assert.equal(result.transcript[0].speaker,'s1');assert.equal(result.transcript[1].speaker,'s2');assert.equal(result.transcript[2].speaker,'s1');
 assert.equal(h.store['digest_'+id].speakerRevision,1);assert.equal(h.store['job_'+id],undefined);assert.equal(h.store.dyd_notes[0].text,'已选中的原话');
});
test('a rejected whole upload stores its reason and explicit recheck only queries the original UUID',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'test-only'};
 h.store['job_'+id]={provider:'volc',whole:true,jobId:'rejected-original',resourceId:'volc.bigasr.auc',status:'submitting',submitStarted:1,startedAt:Date.now(),audioDuration:600};
 await h.ctx.audioMessage({action:'audioWholeSubmitted',videoId:id,runId:'rejected-original',rejected:true,httpStatus:413,error:'请求文件过大（413）。'});
 assert.equal(h.store['job_'+id].httpStatus,413);assert.equal(h.store['job_'+id].stage,'failed');
 h.ctx.fetch=async()=>assert.fail('failed job does not silently retry');
 const stopped=await h.call('poll');assert.equal(stopped.failed,true);assert.equal(stopped.progressDetail.phase,'failed');
 h.ctx.fetch=async(url,opts)=>{assert.match(url,/\/query$/);assert.equal(opts.headers['X-Api-Request-Id'],'rejected-original');return {ok:true,headers:{get:()=> '20000002'}};};
 const checked=await h.call('poll',{force:true});assert.equal(checked.pending,true);assert.equal(h.store['job_'+id].status,'running');
});
test('local pre-submit failure preserves old content and cannot query an unsent task',async()=>{
 const h=harness();h.store['digest_'+id]={transcript:[{text:'旧稿',start:0,duration:2}]};h.store.dyd_notes=[{text:'旧笔记'}];
 h.store['job_'+id]={provider:'volc',whole:true,jobId:'never-sent',resourceId:'volc.seedasr.auc',status:'submitting',submitStarted:1,startedAt:Date.now(),audioDuration:50};
 await h.ctx.audioMessage({action:'audioWholeSubmitted',videoId:id,runId:'never-sent',rejected:true,notSubmitted:true,error:'音频提交前检查未通过，尚未开始上传和识别。'});
 h.ctx.fetch=async()=>assert.fail('no query for a request that never started');
 for(const force of [false,true]){const result=await h.call('poll',{force});assert.equal(result.failed,true);assert.equal(result.notSubmitted,true);}
 assert.equal(h.store['job_'+id].notSubmitted,true);assert.equal(h.store['job_'+id].status,'failed');
 assert.equal(h.store['digest_'+id].transcript[0].text,'旧稿');assert.equal(h.store.dyd_notes[0].text,'旧笔记');
});
test('late success, pending or failure from a reset query cannot overwrite the new job or old content',async()=>{
 for(const finish of ['success','pending','not-found']){
  const h=harness(),key='job_'+id;h.store.dyd_settings={volcApiKey:'test-only',volcResourceId:'volc.seedasr.auc'};
  h.store['digest_'+id]={transcript:[{text:'保留的稿件',start:0,duration:2}]};h.store.dyd_notes=[{text:'保留的笔记'}];
  h.store[key]={provider:'volc',whole:true,submitFinished:true,jobId:'old-failed',resourceId:'volc.seedasr.auc',status:'failed',startedAt:Date.now(),audioDuration:50,audioOffset:0,info:{videoId:id,duration:50}};
  let resolveFetch,started;const fetchEntered=new Promise(resolve=>started=resolve);
  h.ctx.fetch=()=>{started();return new Promise(resolve=>resolveFetch=resolve);};
  const oldQuery=h.call('poll',{force:true});await fetchEntered;
  await h.call('resetJob');
  h.ctx.chrome.runtime.getContexts=async()=>[{}];h.ctx.chrome.declarativeNetRequest={updateSessionRules:async()=>{}};
  h.ctx.chrome.runtime.sendMessage=async m=>m.action==='audioState'?{success:true,protocol:'whole-resource-3',resourceId:m.resourceId,active:null}:{success:true};
  await h.call('retranscribe');const newJob=structuredClone(h.store[key]);assert.notEqual(newJob.jobId,'old-failed');
  resolveFetch({ok:true,status:200,headers:{get:k=>k==='X-Api-Status-Code'?({success:'20000000',pending:'20000002','not-found':'45000000'}[finish]):k==='X-Api-Message'?'cannot find task':null},text:async()=>JSON.stringify({audio_info:{duration:50000},result:{utterances:[{text:'不应覆盖的迟到结果',start_time:0,end_time:1000,additions:{speaker:'1'}}]}})});
  const reply=await oldQuery;assert.equal(reply.stale,true);assert.equal(reply.transcript,undefined);
  assert.deepEqual(h.store[key],newJob);assert.equal(h.store['digest_'+id].transcript[0].text,'保留的稿件');assert.equal(h.store.dyd_notes[0].text,'保留的笔记');
 }
});
test('whole recording does not query an active upload or publish incomplete audio',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'test-only'};
 const job={provider:'volc',whole:true,submitFinished:false,jobId:'whole-3',resourceId:'volc.bigasr.auc',status:'submitting',startedAt:Date.now(),heartbeatAt:Date.now(),audioDuration:600,audioOffset:0,info:{videoId:id,duration:600}};
 h.store['job_'+id]=job;h.ctx.fetch=async()=>assert.fail('upload still in progress');
 assert.equal((await h.call('poll')).pending,true);
 h.store['job_'+id]={...job,submitFinished:true};
 h.ctx.fetch=async()=>({ok:true,headers:{get:()=> '20000000'},text:async()=>JSON.stringify({audio_info:{duration:300000},result:{utterances:[{text:'只返回半段',start_time:0,end_time:1000,additions:{speaker:'1'}}]}})});
 const result=await h.call('poll');assert.equal(result.failed,true);assert.match(result.error,/长度/);assert.equal(result.progressDetail.phase,'failed');
 assert.equal(h.store['digest_'+id],undefined);assert.equal(h.store['job_'+id].status,'failed');
});
test('a definitive missing task is returned as failed immediately without a transient network hint',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'test-only'};
 h.store['digest_'+id]={transcript:[{text:'保留原稿',start:0,duration:2}]};h.store.dyd_notes=[{text:'保留笔记'}];
 h.store['job_'+id]={provider:'volc',whole:true,submitFinished:true,jobId:'missing-original',resourceId:'volc.seedasr.auc',status:'uncertain',startedAt:Date.now(),audioDuration:50,audioOffset:0,info:{videoId:id,duration:50}};
 let queries=0;h.ctx.fetch=async()=>{queries++;return {ok:true,status:200,headers:{get:k=>k==='X-Api-Status-Code'?'45000000':'cannot find task'}};};
 const first=await h.call('poll');assert.equal(first.failed,true);assert.match(first.error,/未找到/);assert.equal(first.progressDetail.phase,'failed');
 const second=await h.call('poll');assert.equal(second.failed,true);assert.equal(queries,1);
 assert.equal(h.store['digest_'+id].transcript[0].text,'保留原稿');assert.equal(h.store.dyd_notes[0].text,'保留笔记');
});

test('renaming updates saved quotes and multi-person excerpts without changing original words',async()=>{
 const h=harness();h.store['digest_'+id]={transcriptRevision:'r1',transcript:[{text:'第一位的原话。',start:0,duration:5,speaker:'s1'},{text:'第二位的回答。',start:5,duration:5,speaker:'s2'}]};
 const q=await h.call('saveNote',{seconds:0,text:'第一位的原话。\n第二位的回答。',quote:true,segments:[{start:0,text:'第一位的原话。'},{start:5,text:'第二位的回答。'}]});
 assert.equal(q.note.speaker,undefined);assert.equal(q.note.segments.length,2);
 h.store.dyd_notes.push({videoId:other,speaker:'s1',speakerName:'别的视频',text:'不变'});
 h.store.dyd_notes.push({videoId:id,transcriptRevision:'older',speaker:'s1',speakerName:'旧身份',text:'历史笔记'});
 await h.call('speakerNames',{names:{s1:'主持人',s2:'嘉宾'}});
 assert.equal(h.store.dyd_notes[0].text,'第一位的原话。\n第二位的回答。');assert.equal(h.store.dyd_notes[0].segments[1].speakerName,'嘉宾');
 assert.equal(h.store.dyd_notes[1].speakerName,'别的视频');assert.equal(h.store.dyd_notes[2].speakerName,'旧身份');
 await h.call('speakerNames',{names:{s1:'新姓名'}});assert.equal(h.store.dyd_notes[0].segments[0].speakerName,'新姓名');assert.equal(h.store.dyd_notes[0].segments[1].speakerName,'说话人 2');
});
test('retranscription does not return old cache while the whole upload is pending',async()=>{
 const h=harness();h.store['digest_'+id]={transcript:[{text:'原稿',start:0,duration:10}]};
 h.store['job_'+id]={provider:'volc-upload',whole:true,replace:true,jobId:'running-whole',heartbeatAt:Date.now(),startedAt:Date.now(),info:{duration:600}};
 assert.equal((await h.call('cache')).pending,true);const result=await h.call('poll');assert.equal(result.pending,true);assert.equal(result.transcript,undefined);
 assert.equal((await h.call('retranscribe')).jobId,'running-whole');assert.equal(h.store['digest_'+id].transcript[0].text,'原稿');
});
test('temporary whole-query network loss retains original job and automatically retries query',async()=>{
 const h=harness();h.store.dyd_settings={volcApiKey:'test-only'};h.store['job_'+id]={provider:'volc',whole:true,submitFinished:true,jobId:'original',resourceId:'volc.bigasr.auc',startedAt:Date.now(),audioDuration:600,info:{}};
 h.ctx.fetch=async()=>{throw new TypeError('network');};const result=await h.call('poll');assert.equal(result.pending,true);assert.ok(result.retryAfter>=10000);assert.equal(h.store['job_'+id].jobId,'original');
});
test('names require an explicit self-introduction and corroborating metadata, not title order',async()=>{
 const h=harness();const rows=[{speaker:'s1',text:'大家好，我是张小珺。'},{speaker:'s2',text:'今天讨论创业。'}];
 assert.deepEqual({...h.ctx.inferredNames(rows,{title:'杨植麟与张小珺访谈'})},{s1:'张小珺'});
 assert.deepEqual({...h.ctx.inferredNames(rows,{title:'访谈'})},{});
 rows.push({speaker:'s2',text:'我是张小珺。'});assert.deepEqual({...h.ctx.inferredNames(rows,{title:'张小珺访谈'})},{});
});
test('a replacement transcript never inherits names from differently numbered old speakers',async()=>{
 const h=harness();h.store['digest_'+id]={transcriptRevision:'old',speakerNames:{s1:'旧人物'},transcript:[{text:'旧稿',start:0,speaker:'s1'}]};
 const result=await h.ctx.acceptTranscript(id,[{text:'新稿',start:0,duration:3,speaker:'s1'}],{videoId:id},'火山语音转写','new');
 assert.deepEqual({...result.speakerNames},{});assert.equal(h.store['digest_'+id].transcriptRevision,'new');
});
