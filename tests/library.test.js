const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),ctx=vm.createContext({module:{exports:{}},console});
for(const file of ['library-config.js','library-core.js','library-files.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
const L=ctx.READING_LIBRARY,C=ctx.READING_CONFIG,F=ctx.READING_FILES,id=C.label==='抖音'?'7674938832084569401':'abcDEF12345';
const json=x=>JSON.parse(JSON.stringify(x));
function record(){return L.normalize(id,{title:'采访 / 原话',transcript:[{start:10,text:'你好',speaker:'s1'}],speakerNames:{s1:'主持人'},analysis:{chapters:[{title:'开场',summary:'介绍',timestampSeconds:10}]}},[{id:'n1',videoId:id,text:'我的原话',seconds:12}],C);}
test('library adapts title, time, speaker, notes and overview without mutating sources',()=>{const r=record();assert.equal(r.transcript[0].speakerName,'主持人');assert.equal(r.notes[0].start,12);assert.equal(r.overview.chapters[0].start,10);assert.equal(r.id,id);});
test('library filters settings, keys, jobs and signed media URLs',()=>{const all={secret:'PRIVATE_VALUE',job_foo:{apiKey:'PRIVATE_VALUE'},[C.notesKey]:[],['digest_'+id]:{title:'标题',apiKey:'PRIVATE_VALUE',mediaUrl:'SIGNED_MEDIA',transcript:[{text:'正文',start:0,apiKey:'PRIVATE_VALUE'}]}};const saved=JSON.stringify(L.collect(all,[],C));assert.ok(!saved.includes('PRIVATE_VALUE'));assert.ok(!saved.includes('SIGNED_MEDIA'));assert.ok(saved.includes('正文'));});
test('library retains archived full text after reading cache eviction',()=>{const r=record(),next=L.collect({[C.notesKey]:[]},[r],C)[0];assert.equal(next.transcript[0].text,'你好');assert.equal(next.notes.length,0);});
test('library includes notes-only videos and rejects invalid or missing IDs',()=>{const a=L.collect({[C.notesKey]:[{videoId:id,text:'旧笔记',videoTitle:'旧视频'},{text:'无归属'}]},[],C);assert.equal(a.length,1);assert.equal(a[0].title,'旧视频');for(const bad of [undefined,null,'../escape','x?bad'])assert.equal(L.validId(bad,C),false);});
test('library exports only existing content, not generated placeholder text',()=>{const docs=L.documents(record(),C);assert.deepEqual(json(docs.map(x=>x.name)),['逐字稿','内容概览','我的笔记']);assert.match(docs[0].text,/主持人/);assert.match(docs[0].text,/\[0:10\]/);assert.match(docs[2].text,/我的原话/);});
test('library safely names local folders',()=>{for(const s of ['../a/b','a:b*?','.', 'CON','x\u0000y']){const name=L.filename(s);assert.ok(name.length);assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/.test(name));assert.ok(!/[. ]$/.test(name));}});
test('library sorts cached translations by segment order and excludes unrelated caches',()=>{const r=L.normalize(id,{paragraphCache:{[id+':zh:semantic:segment-3-10000']:'后句',[id+':zh:semantic:segment-1-0']:'前句','foreign:zh:semantic:segment-0-0':'无关'}},[],C);assert.equal(r.translations[0].text,'前句');assert.equal(r.translations[1].start,10);assert.equal(r.translations.length,2);assert.match(L.documents(r,C)[0].text,/不保证覆盖全文/);});
function dir(){const entries=new Map(),children=new Map();return {entries,children,async getDirectoryHandle(n){if(!children.has(n))children.set(n,dir());return children.get(n);},async getFileHandle(n,o={}){if(!entries.has(n)&&!o.create)throw Object.assign(new Error(),{name:'NotFoundError'});if(!entries.has(n))entries.set(n,'');return {getFile:async()=>({text:async()=>entries.get(n)}),createWritable:async()=>{let pending;return {write:async t=>{pending=t;},close:async()=>{entries.set(n,pending);},abort:async()=>{}};}};}};}
test('local saving reuses identical files and preserves edited copies',async()=>{const d=dir();const a=await F.writeUnique(d,'逐字稿','原稿');assert.equal(a.written,true);assert.equal((await F.writeUnique(d,'逐字稿','原稿')).written,false);const b=await F.writeUnique(d,'逐字稿','新稿');assert.equal(b.name,'逐字稿（2）.md');assert.equal(d.entries.get('逐字稿.md'),'原稿');assert.equal(d.entries.size,2);});
test('local saving writes platform/title folders and can be repeated safely',async()=>{const d=dir(),r=record();const first=await F.save(d,[r],C),second=await F.save(d,[r],C);assert.equal(first.saved.length,1);assert.equal(first.written,3);assert.equal(second.written,0);assert.ok(d.children.has(C.label));assert.match(first.saved[0].folder,new RegExp(id));});
test('local saving does not disguise permission or disk errors as success',async()=>{const d={getFileHandle:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}};await assert.rejects(F.writeUnique(d,'逐字稿','x'),/denied/);});
test('unknown voices and named voices remain distinguishable with source links and revision',()=>{
 const r=L.normalize(id,{title:'长访谈',transcriptRevision:'whole-new',source:'火山语音转写',transcript:[
  {start:1,text:'问题',speaker:'s1'},{start:3601,text:'后半段无法对齐',speaker:'u12_0'},{start:7201,text:'未返回编号',speaker:'unknown'},
  {start:8000,text:'第三组待命名',speaker:'s3'}],speakerNames:{s1:'主持人',s3:'待确认'}},[],C);
 assert.deepEqual(json(r.transcript.map(x=>x.speaker)),['s1','u12_0','unknown','s3']);
 const out=L.documents(r,C)[0].text;
 assert.match(out,/归属待确认 3 段/);assert.match(out,/声音 u12_0/);assert.match(out,/whole-new/);assert.ok(out.includes(L.url(id,C,3601)));
 assert.equal(r.transcript[1].speakerName,'说话人待确认');assert.equal(r.transcript[3].speakerStatus,'unconfirmed');
});
test('old exported names cannot recreate missing voice IDs and pending labels remain explicit',()=>{
 const r=L.normalize(id,{transcript:[{text:'原导出只有姓名',start:1,speakerName:'嘉宾'},{text:'原导出待确认',start:2,speakerName:'说话人待确认'}]},[],C);
 assert.equal(r.transcript[0].speaker,'');assert.equal(r.transcript[1].speakerStatus,'unconfirmed');
 assert.match(L.documents(r,C)[0].text,/未保留声音编号 2 段/);
});
test('new voice names never label a quote from an older transcript; personal notes stay personal',()=>{
 const r=L.normalize(id,{transcriptRevision:'new',speakerNames:{s1:'新分组姓名'}},[
  {videoId:id,text:'旧原话',seconds:12,speaker:'s1',transcriptRevision:'old'},
  {videoId:id,text:'我的判断',seconds:20,kind:'personal',transcriptRevision:'old'}],C);
 assert.equal(r.notes[0].speakerName,'说话人 1');assert.equal(r.notes[1].kind,'personal');
 const out=L.documents(r,C)[0].text;assert.match(out,/笔记来源版本：old/);assert.match(out,/个人笔记/);assert.ok(!out.includes('新分组姓名'));
});
test('recognition evidence exports counts and policy but excludes unapproved data',()=>{
 const r=L.normalize(id,{transcript:[{start:0,text:'正文',speaker:'s1'}],recognition:{method:'whole-recording',jobId:'one-run',resourceId:'volc.seedasr.auc',audioDuration:9258,returnedDuration:9258,
  speakerOptions:{ssd_version:'200',ssd_mode:1,apiKey:'PRIVATE_VALUE'},voiceMapping:[{serviceVoice:'0',speaker:'s1'}],windows:[{start:7200,segments:10,missing:3,voices:{0:7}}],apiKey:'PRIVATE_VALUE',mediaUrl:'SIGNED_URL'}},[],C);
 const out=L.documents(r,C)[0].text;assert.match(out,/长音频模式：1/);assert.match(out,/服务未返回编号 3 段/);assert.match(out,/s1 对应服务编号 0/);
 assert.ok(!JSON.stringify(r).includes('PRIVATE_VALUE'));assert.ok(!JSON.stringify(r).includes('SIGNED_URL'));
});
test('a file that fails readback is not reported as saved',async()=>{
 const d={getFileHandle:async(n,o)=>{if(!o?.create)throw Object.assign(new Error(),{name:'NotFoundError'});return {getFile:async()=>({text:async()=>''}),createWritable:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}})};}};
 await assert.rejects(F.writeUnique(d,'逐字稿','正文'),/核对未通过/);
});
test('entry points and release list include the actual library page',()=>{for(const name of ['options.html','sidepanel.html'])assert.match(fs.readFileSync(path.join(root,name),'utf8'),/href="library.html"/);for(const name of ['library.html','library-core.js','library-db.js','library-files.js','library-config.js','library-background.js','library.js','library.css'])assert.ok(fs.existsSync(path.join(root,name)));assert.match(fs.readFileSync(path.join(root,'background.js'),'utf8'),/importScripts\('library-config.js'/);});
