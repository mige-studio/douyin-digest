const test=require('node:test'),assert=require('node:assert/strict');
const volc=require('../volc.js'),parts=require('../transcript-parts.js');
test('speech API requests speaker information explicitly and preserves real speaker zero',async()=>{
 const result=await volc.flash('placeholder','uuid',new Uint8Array([1]),async(url,options)=>{
  assert.equal(JSON.parse(options.body).request.enable_speaker_info,true);
  return {ok:true,headers:{get:()=> '20000000'},text:async()=>JSON.stringify({result:{utterances:[{text:'原话',start_time:200,end_time:1000,additions:{speaker:'0'}}]}})};
 },true);assert.equal(result.transcript[0].localSpeaker,'0');
});
test('reference voices resolve swapped local IDs and strip prepended audio timestamps',async()=>{
 const {prepareAudio,alignSpeakers}=await import('../speaker-audio.mjs');
 const anchors=[{id:'s1',pcm:new Float32Array(4*16000).fill(.1)},{id:'s2',pcm:new Float32Array(4*16000).fill(.2)}];
 const plan=prepareAudio(new Float32Array(20*16000).fill(.3),anchors);
 assert.equal(plan.prefix,11);assert.ok(Math.abs(plan.audio[16000]-.1)<.001);assert.ok(Math.abs(plan.audio[11*16000]-.3)<.001);
 const raw=[{text:'参照甲',start:1,duration:4,localSpeaker:'8'},{text:'参照乙',start:6,duration:4,localSpeaker:'2'},{text:'本段乙',start:12,duration:5,localSpeaker:'2'},{text:'本段甲',start:18,duration:5,localSpeaker:'8'}];
 const rows=alignSpeakers(raw,plan,1,anchors);assert.deepEqual(rows.map(r=>[r.text,r.start,r.speaker]),[['本段乙',1,'s2'],['本段甲',7,'s1']]);
 const merged=parts.merge([{offset:0,duration:300,rows:[{text:'前段',start:1,duration:2,speaker:'s1'}]},{offset:300,duration:20,rows}]);assert.equal(merged[1].start,301);assert.equal(merged[1].speaker,'s2');
});
test('colliding or missing reference voices never guess an established identity',async()=>{
 const {prepareAudio,alignSpeakers}=await import('../speaker-audio.mjs');
 const anchors=[{id:'s1',pcm:new Float32Array(4*16000)},{id:'s2',pcm:new Float32Array(4*16000)}],plan=prepareAudio(new Float32Array(20*16000),anchors);
 const raw=[{start:1,duration:4,localSpeaker:'0'},{start:6,duration:4,localSpeaker:'0'},{text:'无法确定',start:12,duration:5,localSpeaker:'0'}];
 assert.equal(alignSpeakers(raw,plan,1,anchors)[0].speaker,'u1_0');
 const empty=[];empty.seen=['s1'];assert.equal(alignSpeakers([{text:'未知',start:1,duration:4,localSpeaker:'1'}],{prefix:0,refs:[]},1,empty)[0].speaker,'u1_1');
});
test('only isolated spoken excerpts become references; resume reconstructs the same excerpts',async()=>{
 const {collectAnchors}=await import('../speaker-audio.mjs'),pcm=Float32Array.from({length:16000*30},(_,i)=>i/1000000);
 const rows=[{start:1,duration:8,speaker:'s1'},{start:10,duration:8,speaker:'s2'},{start:12,duration:1,speaker:'s1'}],a=[],b=[];
 collectAnchors(rows,pcm,a);collectAnchors(structuredClone(rows),pcm,b);assert.deepEqual(a.map(x=>x.id),['s1']);assert.deepEqual(a,b);assert.deepEqual(a.seen,['s1','s2']);
});
test('speaker enrichment preserves original wording and timestamps and does not attribute mixed utterances',()=>{
 const original=[{text:'原文必须保留',start:0,duration:4},{text:'一句包含两人',start:4,duration:6}];
 const result=parts.annotateTranscript(original,[{start:0,duration:4,speaker:'s1'},{start:4,duration:3,speaker:'s1'},{start:7,duration:3,speaker:'s2'}]);
 assert.deepEqual(result.map(({speaker,...r})=>r),original);assert.equal(result[0].speaker,'s1');assert.equal(result[1].speaker,'unknown');assert.equal(original[0].speaker,undefined);
});
test('a sentence bridging reference and program keeps only real program words',async()=>{
 const {alignSpeakers}=await import('../speaker-audio.mjs');
 const rows=alignSpeakers([{text:'参照正文',start:9,duration:4,localSpeaker:'1',words:[{text:'参照',start:9,duration:1},{text:'正文',start:11.2,duration:1.5}]}],{prefix:11,refs:[]},0,[]);
 assert.equal(rows[0].text,'正文');assert.ok(Math.abs(rows[0].start-.2)<.0001);assert.equal(rows[0].words,undefined);
 assert.throws(()=>alignSpeakers([{text:'混在一起',start:9,duration:4,localSpeaker:'1'}],{prefix:11,refs:[]},0,[]),/无法可靠还原/);
});
test('an unanchored brief third voice does not invalidate two successfully matched voices later',async()=>{
 const {prepareAudio,alignSpeakers}=await import('../speaker-audio.mjs');
 const anchors=[{id:'s1',pcm:new Float32Array(4*16000)},{id:'s2',pcm:new Float32Array(4*16000)}];anchors.seen=['s1','s2','s3'];
 const plan=prepareAudio(new Float32Array(20*16000),anchors);
 const rows=alignSpeakers([{start:1,duration:4,localSpeaker:'2'},{start:6,duration:4,localSpeaker:'1'},{text:'已知人物',start:12,duration:5,localSpeaker:'1'},{text:'短促插话',start:18,duration:.5,localSpeaker:'5'}],plan,8,anchors);
 assert.equal(rows[0].speaker,'s2');assert.equal(rows[1].speaker,'u8_5');
 const first=alignSpeakers([{text:'短促声音',start:0,duration:.7,localSpeaker:'0'}],{prefix:0,refs:[]},0,[]);assert.equal(first[0].speaker,'u0_0');
});
