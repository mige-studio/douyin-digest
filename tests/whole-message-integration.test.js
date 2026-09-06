const test=require('node:test');
const assert=require('node:assert/strict');
const {createWholeMessageHarness,encodedRecording}=require('./helpers/whole-message-harness.cjs');
const videoId='7632145100964957449';
const raw={audio_info:{duration:30000},result:{utterances:[
 {start_time:1000,end_time:3500,text:'你认为接下来会发生什么？',additions:{speaker:'2'}},
 {start_time:4000,end_time:9000,text:'我认为我们会看到新的变化。',additions:{speaker:'1'}},
 {start_time:10000,end_time:11500,text:'能举一个例子吗？',additions:{speaker:'2'}},
 {start_time:12000,end_time:18000,text:'比如模型能够完成更多实际工作。',additions:{speaker:'1'}}
]}};
const response=(code,body={})=>new Response(JSON.stringify(body),{status:200,headers:{'X-Api-Status-Code':code}});

test('whole generation crosses both real message listeners, submits the frozen version, and exposes parsed speakers through UI cache',async()=>{
 for(const resourceId of ['volc.bigasr.auc','volc.seedasr.auc']){
  const mediaBytes=new Uint8Array([79,103,103,83,1,2,3,4]);
  let queryCount=0,releaseSubmit,submission;
  const uploadGate=new Promise(resolve=>releaseSubmit=resolve);
  const old={videoId,duration:30,transcript:[{text:'保留的旧稿',start:1,duration:2,speaker:'s1'}],transcriptRevision:'old-revision',speakerNames:{s1:'旧姓名'}};
  const notes=[{id:'old-note',videoId,text:'历史原话',seconds:1,speaker:'s1',speakerName:'旧姓名',transcriptRevision:'old-revision'}];
  const h=await createWholeMessageHarness({videoId,duration:30,mediaBytes,resourceId,wholeAudio:encodedRecording(30),store:{[`digest_${videoId}`]:old,dyd_notes:notes},
   fetcher:async(url,request,{store})=>{
    assert.equal(request.headers['X-Api-Resource-Id'],resourceId);
    assert.equal(request.headers['X-Api-Request-Id'],store[`job_${videoId}`].jobId);
    if(url.endsWith('/submit')){
     assert.equal(store[`job_${videoId}`].provider,'volc');
     assert.equal(store[`job_${videoId}`].resourceId,resourceId);
     assert.ok(store[`job_${videoId}`].submitStarted);
     submission=JSON.parse(await request.body.text());
     await uploadGate;return response('20000000');
    }
    assert.ok(url.endsWith('/query'));queryCount++;
    return queryCount===1?response('20000002'):response('20000000',raw);
   }});
  const started=await h.ui('generate',{replace:true});assert.equal(started.success,true);assert.equal(started.pending,true);
  // The page obtains its old readable cache while offscreen prepares/uploads.
  assert.deepEqual((await h.ui('cache')).cache.transcript,old.transcript);
  assert.deepEqual(h.store.dyd_notes,notes);
  const frozenId=h.job().jobId;
  h.store.dyd_settings.volcResourceId=resourceId==='volc.bigasr.auc'?'volc.seedasr.auc':'volc.bigasr.auc';
  releaseSubmit();await h.waitForAudio();
  assert.equal(h.job().submissionAccepted,true);assert.equal(h.job().submitFinished,true);
  assert.equal(submission.request.enable_speaker_info,true);
  assert.deepEqual(Buffer.from(submission.audio.data,'base64'),Buffer.from(mediaBytes));
  assert.equal((await h.ui('poll',{force:true})).pending,true);
  assert.deepEqual((await h.ui('cache')).cache.transcript,old.transcript);
  const completed=await h.ui('poll',{force:true});assert.equal(completed.success,true);
  const cache=(await h.ui('cache')).cache;
  assert.deepEqual(cache.transcript.map(row=>row.speaker),['s1','s2','s1','s2']);
  assert.deepEqual(cache.transcript.map(row=>row.text),raw.result.utterances.map(row=>row.text));
  assert.equal(cache.transcript[1].start,4);assert.equal(cache.transcript[1].duration,5);
  assert.equal(cache.transcriptRevision,frozenId);assert.deepEqual(cache.speakerNames,{});
  assert.deepEqual(h.store.dyd_notes,notes);assert.equal(h.job(),undefined);
  assert.deepEqual(h.messages.filter(m=>m.origin==='offscreen').map(m=>m.action),['audioPreflight','audioProgress','audioWholePrepared','audioWholeSubmitted']);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/submit')).length,1);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/query')).length,2);
  assert.ok(h.requests.every(r=>!('X-Api-Key'in r.headers)));
  assert.ok(!JSON.stringify(h.messages).includes('test-only'));
  assert.equal((await h.ui('generate')).transcript.length,4);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/submit')).length,1);
 }
});

test('missing checkpoint version at the real background reply bridge fails before ASR and preserves old data',async()=>{
 const old={transcript:[{text:'不能丢掉的旧稿',start:0,duration:2,speaker:'s1'}],transcriptRevision:'old'},notes=[{id:'keep',text:'不能丢掉的笔记'}];
 let removed=false;
 const h=await createWholeMessageHarness({duration:30,mediaBytes:new Uint8Array([1,2,3]),wholeAudio:encodedRecording(30),store:{[`digest_${videoId}`]:old,dyd_notes:notes},
  transformSource:(file,source)=>{
   if(file!=='background.js')return source;
   // Recreate only the historical loss in the outgoing bridge. The production
   // audioWholePrepared handler still computes and persists the real version.
   // Leave the free preflight intact to exercise the checkpoint defense too.
   const patched=source.replace(',...(result.resourceId?{resourceId:result.resourceId}:{})',()=>{removed=true;return ",...(m.action==='audioPreflight'&&result.resourceId?{resourceId:result.resourceId}:{})";});
   return patched;
  },
  fetcher:async()=>assert.fail('Missing checkpoint version must never reach an ASR endpoint')});
 assert.equal((await h.ui('generate',{replace:true})).success,true);
 await h.waitForAudio();
 assert.equal(removed,true,'Mutation must remove the actual outgoing resource field');
 assert.equal(h.job().status,'failed');
 assert.match(h.job().error,/提交前检查/);
 assert.equal(h.job().submissionAccepted,false);
 assert.equal(h.job().notSubmitted,true);
 assert.equal(h.requests.filter(r=>r.url.includes('openspeech')).length,0);
 assert.deepEqual((await h.ui('cache')).cache.transcript,old.transcript);
 assert.deepEqual(h.store.dyd_notes,notes);
 const failed=h.messages.find(m=>m.action==='audioWholeSubmitted');
 assert.equal(failed.notSubmitted,true);assert.equal(failed.rejected,true);assert.equal(failed.uncertain,false);
 assert.equal((await h.ui('poll',{force:true})).failed,true);
 assert.equal(h.requests.filter(r=>r.url.includes('openspeech')).length,0);
});

test('runtime readiness checks both real message directions without media, ASR, credentials or job mutation',async()=>{
 for(const resourceId of ['volc.bigasr.auc','volc.seedasr.auc']){
  const h=await createWholeMessageHarness({resourceId,store:{[`job_${videoId}`]:{jobId:'existing',resourceId:'volc.bigasr.auc',status:'running'},dyd_notes:[{text:'保留笔记'}]},fetcher:async()=>assert.fail('readiness must not use the network')});
  const before=JSON.stringify(h.store),ready=await h.ui('runtimeCheck');
  assert.equal(ready.success,true);assert.equal(ready.protocol,'whole-resource-3');assert.equal(ready.resourceId,resourceId);
  assert.equal(JSON.stringify(h.store),before);assert.equal(h.requests.length,0);
  assert.deepEqual(h.messages.map(m=>m.action),['audioState','audioPreflight']);
  assert.ok(h.messages.every(m=>!('apiKey'in m)&&!('mediaUrl'in m)));
 }
});

test('old runtime protocols and a broken resource reply fail readiness before downloading or creating a job',async()=>{
 for(const fault of ['old-offscreen','old-background','missing-resource','wrong-resource']){
  const h=await createWholeMessageHarness({duration:30,mediaBytes:new Uint8Array([1,2,3]),wholeAudio:encodedRecording(30),store:{dyd_notes:[{text:'保留笔记'}]},
   transformSource:(file,source)=>{
    if(fault==='old-offscreen'&&file==='offscreen.mjs')return source.replaceAll('whole-resource-3','whole-resource-2');
    if(fault==='old-background'&&['background.js','audio-jobs.js'].includes(file))return source.replaceAll('whole-resource-3','whole-resource-2');
    if(file==='background.js'&&fault==='missing-resource')return source.replace(',...(result.resourceId?{resourceId:result.resourceId}:{})','');
    if(file==='background.js'&&fault==='wrong-resource')return source.replace(',...(result.resourceId?{resourceId:result.resourceId}:{})',",...(result.resourceId?{resourceId:'volc.bigasr.auc'}:{})");
    return source;
   },fetcher:async()=>assert.fail('broken preflight must not use the network')});
  const before=JSON.stringify(h.store),ready=await h.ui('runtimeCheck');
  assert.equal(ready.success,false,fault);assert.match(ready.error,/未开始转写/);
  const start=await h.ui('generate');assert.equal(start.success,false,fault);assert.match(start.error,/未开始转写/);
  assert.equal(h.requests.length,0,fault);assert.equal(h.job(),undefined,fault);assert.equal(JSON.stringify(h.store),before,fault);
  assert.ok(!h.messages.some(m=>m.action==='audioStart'),fault);
 }
});
