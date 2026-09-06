const test=require('node:test'),assert=require('node:assert/strict');
const parts=require('../transcript-parts.js'),volc=require('../volc.js');
test('submission failures retain the actual HTTP reason and never imply recognition started',()=>{
 const rejected=volc.submitOutcome({httpStatus:413,message:'sensitive network details'});
 assert.equal(rejected.rejected,true);assert.equal(rejected.uncertain,false);assert.equal(rejected.httpStatus,413);
 assert.match(rejected.error,/文件过大/);assert.doesNotMatch(rejected.error,/sensitive|正在识别/);
 const lost=volc.submitOutcome(new Error('lost'));assert.equal(lost.uncertain,true);assert.equal(lost.submissionAccepted,false);
 assert.equal(volc.submitOutcome().submissionAccepted,true);
});
test('local submit validation is marked unsent while a lost fetch response stays uncertain',async()=>{
 let requests=0;
 const fetcher=async()=>{requests++;throw new Error('response lost');};
 for(const [key,job,bytes] of [
  ['test-only',{jobId:'local',whole:true},new Uint8Array([1])],
  ['',{jobId:'local',resourceId:'volc.seedasr.auc',whole:true},new Uint8Array([1])],
  ['test-only',{jobId:'local',resourceId:'volc.seedasr.auc',whole:true},new Uint8Array()]
 ])await assert.rejects(volc.request('submit',key,job,bytes,fetcher),error=>{
  const outcome=volc.submitOutcome(error);
  assert.equal(error.requestNotSent,true);assert.equal(outcome.notSubmitted,true);
  assert.equal(outcome.rejected,true);assert.equal(outcome.uncertain,false);
  assert.match(outcome.error,/尚未开始上传和识别/);return true;
 });
 assert.equal(requests,0);
 await assert.rejects(volc.request('submit','test-only',{jobId:'sent',resourceId:'volc.seedasr.auc',whole:true},new Uint8Array([1]),fetcher),error=>{
  assert.notEqual(error.requestNotSent,true);assert.equal(volc.submitOutcome(error).uncertain,true);return true;
 });
 assert.equal(requests,1);
});
test('pre-submit failures preserve actionable safe reasons without leaking raw exceptions',async()=>{
 const valid={jobId:'short-local-check',resourceId:'volc.seedasr.auc',whole:true};
 class UnreadableBlob extends Blob{slice(){throw new Error('private-source-and-credential');}}
 for(const [key,job,audio,expected] of [
  ['test-only',{...valid,resourceId:undefined},new Blob(['x']),/识别版本未正确连接/],
  ['',valid,new Blob(['x']),/设置中填写火山语音/],
  ['test-only',valid,new Blob(),/音频为空、过大或不可读取/],
  ['test-only',valid,new UnreadableBlob(['x']),/音频读取失败/]
 ])await assert.rejects(volc.request('submit',key,job,audio,async()=>assert.fail('No request allowed')),error=>{
  const result=volc.submitOutcome(error);assert.equal(result.notSubmitted,true);assert.match(result.error,expected);
  assert.doesNotMatch(result.error,/private-source-and-credential/);return true;
 });
 assert.doesNotMatch(volc.submitOutcome({requestNotSent:true,preflightCode:'private-source-and-credential',message:'private-source-and-credential'}).error,/private-source-and-credential/);
});
test('query identifies a missing original task without echoing raw service messages',async()=>{
 await assert.rejects(volc.request('query','test-key',{jobId:'old',resourceId:'volc.bigasr.auc'},undefined,async()=>({
  ok:true,headers:{get:k=>k==='X-Api-Status-Code'?'45000000':'OperatorWrapper Process failed: cannot find task'}
 })),e=>e.taskNotFound&&/未找到这次任务/.test(e.message));
});
test('segment merge uses real source offsets across hour boundaries, and preserves text',()=>{
 const merged=parts.merge([{offset:0,duration:3600.036,rows:[{text:'第一段',start:3598,duration:1}]},{offset:3599.964,duration:3600.036,rows:[{text:'第二段',start:1,duration:2}]},{offset:7200.1869375,duration:2058.192,rows:[{text:'第三段',start:5,duration:3}]}]);
 assert.equal(merged[1].start,3600.964);assert.equal(merged[2].start,7205.1869375);assert.equal(merged[2].text,'第三段');
});
test('incomplete, noncontiguous, and out-of-range transcription is not merged',()=>{
 assert.throws(()=>parts.merge([]));
 assert.throws(()=>parts.merge([{offset:2,duration:1,rows:[{text:'x',start:0,duration:1}]}]));
 assert.throws(()=>parts.merge([{offset:0,duration:1,rows:[{text:'x',start:4,duration:1}]}]));
});
test('WAV encoder downmixes two channels to bounded 16 kHz mono PCM',async()=>{
 const {pcmWav}=await import('../audio-chunks.mjs');const bytes=pcmWav([new Float32Array([1,-1,.5]),new Float32Array([1,1,.5])],16000),v=new DataView(bytes.buffer);
 assert.equal(bytes.length,50);assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint32(24,true),16000);assert.equal(v.getInt16(44,true),32767);assert.equal(v.getInt16(46,true),0);assert.equal(v.getInt16(48,true),16384);
 assert.throws(()=>pcmWav([new Float32Array(16000*601)],16000));
});
test('flash sends file bytes rather than signed URL and retains returned timestamps',async()=>{
 let count=0;const result=await volc.flash('test-only','uuid',new Uint8Array([1,2,3]),async(url,opts)=>{
 count++;assert.match(url,/recognize\/flash$/);assert.equal(opts.headers['X-Api-Resource-Id'],'volc.bigasr.auc_turbo');const body=JSON.parse(opts.body);assert.equal(body.audio.data,'AQID');assert.equal(body.audio.url,undefined);
 return {ok:true,headers:{get:()=> '20000000'},text:async()=>JSON.stringify({audio_info:{duration:4000},result:{utterances:[{text:'真实时间',start_time:240,end_time:1230}]}})};
 });assert.equal(count,1);assert.equal(result.transcript[0].start,.24);
});
test('flash never automatically resubmits on network uncertainty and recognizes silent segments',async()=>{
 let n=0;await assert.rejects(volc.flash('test','id',new Uint8Array([1]),async()=>{n++;throw new Error('lost');}));assert.equal(n,1);
 const r=await volc.flash('test','id',new Uint8Array([1]),async()=>({ok:true,headers:{get:()=> '20000003'}}));assert.equal(r.silent,true);assert.deepEqual(r.transcript,[]);
});

test('whole recording submits bytes once with diarization enabled, retaining the original request ID',async()=>{
 const job={jobId:'whole-1',resourceId:'volc.bigasr.auc',whole:true};let calls=0;
 await assert.rejects(volc.request('submit','test-only',job,new Uint8Array([1,2,3]),async(url,opts)=>{
  calls++;assert.match(url,/\/submit$/);assert.equal(opts.headers['X-Api-Request-Id'],'whole-1');
  const body=JSON.parse(await opts.body.text());assert.deepEqual(body.audio,{data:'AQID'});assert.equal(body.request.enable_speaker_info,true);
  throw new Error('response lost after acceptance');
 }));
 assert.equal(calls,1);
 const result=await volc.request('query','test-only',job,undefined,async(url,opts)=>{
  assert.match(url,/\/query$/);assert.equal(opts.body,'{}');assert.equal(opts.headers['X-Api-Request-Id'],'whole-1');
  return {ok:true,headers:{get:()=> '20000000'},text:async()=>JSON.stringify({audio_info:{duration:120000},result:{utterances:[{text:'保持原话',start_time:100,end_time:1000,additions:{speaker:0}}]}})};
 });
 assert.equal(result.durationMs,120000);assert.equal(result.transcript[0].localSpeaker,'0');
});

test('large recording Blob serializes exact bytes across base64 boundaries without changing ASR flags',async()=>{
 const bytes=Uint8Array.from({length:196608*3+5},(_,i)=>i%251);
 await volc.request('submit','test-key',{jobId:'bounded',whole:true,resourceId:'volc.bigasr.auc'},new Blob([bytes]),async(url,options)=>{
  assert.ok(options.body instanceof Blob);const body=JSON.parse(await options.body.text());
  assert.equal(body.audio.data,Buffer.from(bytes).toString('base64'));assert.equal(body.request.enable_speaker_info,true);
  return {ok:true,headers:{get:()=> '20000000'}};
 });
});

test('whole AAC remux preserves every sample, one continuous timeline and compact fragments',async()=>{
 const {createFile,BoxParser}=await import('../vendor/mp4box/mp4box.all.mjs'),{wholeAudio}=await import('../audio-chunks.mjs');
 const esds=new BoxParser.box.esds();esds.version=0;esds.flags=0;esds.data=Uint8Array.from([3,25,0,1,0,4,17,64,21,0,0,0,0,0,0,0,0,0,0,0,5,2,17,136,6,1,2]);
 const src=createFile(),tid=src.addTrack({type:'mp4a',hdlr:'soun',timescale:48000,samplerate:48000,channel_count:1,description_boxes:[esds]});
 const expected=[];for(let i=0;i<1500;i++){const bytes=Uint8Array.from([i%255,2,3,4]);expected.push([...bytes]);src.addSample(tid,bytes,{duration:1024,dts:i*1024,cts:i*1024,is_sync:true});}
 const input=new Uint8Array(src.getBuffer().buffer);
 const result=await wholeAudio((async function*(){for(let i=0;i<input.length;i+=8192)yield input.subarray(i,i+8192);})());
 assert.equal(result.duration,32);assert.equal(result.offset,0);assert.ok(result.buffer.size<input.length/3);
 const parsed=createFile(),actual=[];let info;
 parsed.onReady=v=>{info=v;parsed.setExtractionOptions(v.audioTracks[0].id,null,{nbSamples:200});parsed.start();};
 parsed.onSamples=(id,user,samples)=>actual.push(...samples.map(s=>({dts:s.dts,cts:s.cts,duration:s.duration,data:[...s.data]})));
 const output=await result.buffer.arrayBuffer();output.fileStart=0;parsed.appendBuffer(output);parsed.flush();
 assert.equal(info.audioTracks.length,1);assert.equal(actual.length,1500);
 actual.forEach((s,i)=>{assert.deepEqual(s.data,expected[i]);assert.equal(s.cts,i*1024);assert.equal(s.dts,i*1024);assert.equal(s.duration,1024);});
});
