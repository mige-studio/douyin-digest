const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const id='7494934930196155667',other='7339830617644829991';
// A DOM contract simulation, not browser or visual acceptance.
class Node {
 constructor(tag='div',text=''){this.tagName=tag;this.style={};this.children=[];this.parentElement=null;this.dataset={};this.value='';this.checked=false;this.scrollTop=0;this.nodeType=1;this._text=text;this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,v)=>v?this.classes.add(x):this.classes.delete(x)};}
 set className(v){this.classes=new Set(v.split(' '));}get className(){return [...this.classes].join(' ');}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}
 replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
 matches(s){if(s.startsWith('#'))return this.id===s.slice(1);const m=s.match(/^(\w+)?(?:\[data-(\w+)="([^"\]]+)"\])$/);if(m)return (!m[1]||this.tagName===m[1])&&String(this.dataset[m[2]])===m[3];if(s==='[data-tab]')return !!this.dataset.tab;const parts=s.split('.');return (!parts[0]||parts[0]===this.tagName)&&parts.slice(1).every(c=>this.classes.has(c));}
 querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}
 closest(s){return this.matches(s)?this:this.parentElement?.closest(s);}
 setAttribute(k,v){this[k]=v;}addEventListener(){}scrollIntoView(){this.scrolled=true;}close(){this.open=false;}showModal(){this.open=true;}
 click(){return this.onclick?.();}
}
async function harness(){
 const ids={};for(const m of fs.readFileSync(path.join(__dirname,'../sidepanel.html'),'utf8').matchAll(/id="([^"]+)"/g)){ids[m[1]]=new Node();ids[m[1]].id=m[1];}
 for(const name of ['transcript','overview','notes'])ids[name].className='panel';
 const nav=['transcript','overview','notes'].map(name=>{const n=new Node('button');n.dataset.tab=name;return n;});
 let active=id,selection=null;const sent=[],saved=[];const cached={title:'中文样本',channelName:'作者',transcript:[{text:'中文中文 <img src=x>',start:0,duration:5},{text:'后一句',start:5,duration:5}],source:'页面字幕',scrollTop:240};
 const doc={createRange(){return {selectNodeContents(n){this.node=n;},toString(){return this.node.textContent;}};},addEventListener(){},getElementById:n=>ids[n],createElement:t=>new Node(t),createTextNode:t=>new Node('#text',t),querySelectorAll:s=>[...Object.values(ids),...nav].flatMap(n=>[...(n.matches(s)?[n]:[]),...n.querySelectorAll(s)]),querySelector:s=>doc.querySelectorAll(s)[0]||null};
 const ctx=vm.createContext({console,URL,Blob,Range:{START_TO_START:0,END_TO_END:2},document:doc,window:{innerWidth:500,innerHeight:700,addEventListener(){},getSelection:()=>selection},navigator:{clipboard:{writeText:async()=>{}}},confirm:()=>true,setTimeout:()=>1,clearTimeout(){},setInterval(){},chrome:{runtime:{onMessage:{addListener(){}},openOptionsPage(){},sendMessage:async m=>{sent.push(m);switch(m.action){case'cache':return {success:true,cache:m.videoId===id?cached:{title:'第二个视频',transcript:[{text:'另一条',start:0}],scrollTop:30}};case'page':return {success:true,title:m.videoId===id?'中文样本':'第二个视频',currentTime:6};case'notes':return {success:true,notes:saved};case'saveNote':{const note={id:'note-1',videoId:m.videoId,text:m.text,seconds:m.seconds,createdAt:1};saved.push(note);return{success:true,note};}case'view':return{success:true};default:return {success:true};}}},tabs:{query:async()=>[{id:1,url:`https://www.douyin.com/video/${active}`}],onActivated:{addListener(){}},onUpdated:{addListener(){}},create:async()=>{}}}});
 for(const file of ['core.js','sidepanel.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
 await new Promise(resolve=>setImmediate(resolve));
 return{ctx,ids,sent,saved,doc,setActive:v=>active=v,setSelection:v=>selection=v};
}
test('sidepanel opens cached Chinese transcript and restores reading position without an API request',async()=>{
 const h=await harness();assert.equal(h.ids.videoTitle.textContent,'中文样本');assert.equal(h.ids.speakers.hidden,true);assert.equal(h.ids.contentArea.scrollTop,240);assert.equal(h.ids.transcriptList.querySelectorAll('.entry').length,2);assert.ok(!h.sent.some(m=>m.action==='generate'||m.action==='analyze'));
});
test('search highlights all matches and next/previous never seek playback',async()=>{
 const h=await harness();h.ids.search.value='中文';h.ctx.updateSearch();assert.equal(h.ids.searchCount.textContent,'1/2');h.ids.next.click();assert.equal(h.ids.searchCount.textContent,'2/2');assert.ok(!h.sent.some(m=>m.command==='seek'));
});
test('transcript markup is inert text, not executable HTML',async()=>{const h=await harness();assert.ok(h.ids.transcriptList.textContent.includes('<img src=x>'));assert.equal(h.ids.transcriptList.querySelectorAll('img').length,0);});
test('selected exact text produces a timestamped note and refreshes saved notes',async()=>{
 const h=await harness(),text=h.ids.transcriptList.querySelectorAll('.text')[1];h.setSelection({rangeCount:1,isCollapsed:false,getRangeAt:()=>({startContainer:text,endContainer:text,intersectsNode:n=>n===text,compareBoundaryPoints:()=>0,getBoundingClientRect:()=>({left:100,width:200,top:220,bottom:245})}),toString:()=>'后一句'});
 h.ctx.captureSelection();await h.ids.noteSelection.click();assert.equal(h.saved[0].text,'后一句');assert.equal(h.saved[0].seconds,5);assert.match(h.ids.status.textContent,/已保存/);
});
test('switching videos replaces content and does not inherit old reading position',async()=>{
 const h=await harness();h.setActive(other);await h.ctx.checkContext();assert.equal(h.ids.videoTitle.textContent,'第二个视频');assert.equal(h.ids.contentArea.scrollTop,30);assert.ok(!h.ids.transcriptList.textContent.includes('中文中文'));
});
test('new detail page retries when content script is not yet ready',async()=>{
 const h=await harness(),send=h.ctx.chrome.runtime.sendMessage;let fail=true;
 h.ctx.chrome.runtime.sendMessage=async m=>m.action==='page'&&fail?{success:false,error:'not ready'}:send(m);
 h.setActive(other);await h.ctx.checkContext();assert.match(h.ids.status.textContent,/自动读取/);
 fail=false;vm.runInContext('contextRetryAt=1',h.ctx);await h.ctx.checkContext();
 assert.equal(h.ids.videoTitle.textContent,'第二个视频');assert.match(h.ids.status.textContent,/恢复/);
});
test('focusing another Chrome window does not replace the reading window video',async()=>{
 const h=await harness();h.ctx.chrome.tabs.query=async options=>options.currentWindow?[{id:1,url:`https://www.douyin.com/video/${id}`}]:[{id:2,url:'https://example.org/another-window'}];
 await h.ctx.checkContext();assert.equal(h.ids.videoTitle.textContent,'中文样本');assert.ok(h.ids.transcriptList.textContent.includes('中文中文'));
});
test('speaker labels and saved names appear in reading and exports without changing searchable quote text',async()=>{
 const h=await harness();vm.runInContext("rows=[{text:'保留原句',start:60,duration:5,speaker:'s1'},{text:'无法分开的插话',start:65,duration:5,speaker:'unknown'}];speakerNames={s1:'张小珺'};renderTranscript();",h.ctx);
 assert.equal(h.ids.transcriptList.querySelectorAll('.speaker-label')[0].textContent,'张小珺');
 assert.equal(h.ids.transcriptList.querySelectorAll('.text')[0].textContent,'保留原句');
 h.ids.speakers.click();assert.equal(h.ids.identifySpeakers.hidden,true);assert.equal(h.ids.repairSpeakers.hidden,true);assert.equal(h.ids.saveSpeakerNames.hidden,false);
 assert.match(h.ctx.transcriptExport(),/张小珺：保留原句/);assert.match(h.ctx.transcriptExport(),/说话人待确认：无法分开的插话/);
 h.ids.search.value='张小珺';h.ctx.updateSearch();assert.equal(h.ids.searchCount.textContent,'0/0');
});
test('progress shows audio duration and elapsed time, hides subtitle recheck only while working',async()=>{
 const h=await harness();
 h.ctx.renderProgress({pending:true,progressDetail:{processedSeconds:300,totalSeconds:600,percent:50,elapsedSeconds:75}});
 assert.equal(h.ids.progressInfo.hidden,false);assert.equal(h.ids.transcriptionProgress.value,50);assert.match(h.ids.progressLabel.textContent,/5:00 \/ 10:00（50%） · 已等待 1:15/);assert.equal(h.ids.read.hidden,true);
 h.ctx.renderProgress({pending:true,uncertain:true,progressDetail:{processedSeconds:300,totalSeconds:0,percent:null,elapsedSeconds:90}});
 assert.equal(h.ids.transcriptionProgress.hidden,true);assert.equal(h.ids.read.hidden,false);assert.match(h.ids.progressLabel.textContent,/已暂停/);
 h.ctx.renderProgress();assert.equal(h.ids.progressInfo.hidden,true);assert.equal(h.ids.read.hidden,false);
});

test('clicking transcript words seeks like YouTube but a drag selection does not seek',async()=>{
 const h=await harness(),entry=h.ids.transcriptList.querySelectorAll('.entry')[1],text=entry.querySelectorAll('.text')[0];
 await entry.onclick({target:text});assert.equal(h.sent.filter(m=>m.command==='seek').at(-1).seconds,5);
 const before=h.sent.length;h.setSelection({rangeCount:1,isCollapsed:false});let prevented=false;
 entry.onclick({target:text,preventDefault:()=>prevented=true});assert.equal(h.sent.length,before);assert.equal(prevented,true);
});
test('selection toolbar stays beside selected words within the viewport and quote cards split copy actions',async()=>{
 const h=await harness(),text=h.ids.transcriptList.querySelectorAll('.text')[1];
 h.setSelection({rangeCount:1,isCollapsed:false,getRangeAt:()=>({startContainer:text,endContainer:text,intersectsNode:n=>n===text,compareBoundaryPoints:()=>0,getBoundingClientRect:()=>({left:450,width:60,top:660,bottom:680})}),toString:()=>'后一句'});
 h.ctx.captureSelection();assert.equal(h.ids.selectionBar.hidden,false);assert.equal(h.ids.selectionBar.style.left,'238px');assert.equal(h.ids.selectionBar.style.top,'614px');
 await h.ids.noteSelection.click();assert.equal(h.ids.selectionBar.hidden,true);assert.equal(h.saved[0].text,'后一句');
 let copied;h.ctx.navigator.clipboard.writeText=async value=>copied=value;
 const actions=h.ids.noteList.querySelectorAll('.note-actions')[0].children;
 await actions[0].click();assert.equal(copied,'后一句');await actions[1].click();assert.match(copied,/dyd_t=5$/);
 await actions[2].click();assert.equal(h.sent.filter(m=>m.command==='seek').at(-1).seconds,5);
 assert.ok(h.ids.noteList.querySelectorAll('.note-time').length);
});

test('overview uses mother chapter cards and separate quote actions with real timestamps',async()=>{
 const h=await harness();
 vm.runInContext("analysis={chapters:[{title:'自然主题',summary:'简明摘要',timestampSeconds:5}],keyQuotes:[{quote:'后一句',timestampSeconds:5}]};renderAnalysis();",h.ctx);
 assert.equal(h.ids.analyze.hidden,true);assert.equal(h.ids.overviewHint.hidden,true);
 const chapter=h.ids.chapters.querySelectorAll('.chapter-item')[0];
 assert.equal(chapter.querySelectorAll('.chapter-timestamp')[0].textContent,'0:05');
 assert.equal(chapter.querySelectorAll('.chapter-summary')[0].textContent,'简明摘要');
 chapter.onclick({target:chapter});await Promise.resolve();assert.equal(h.sent.filter(m=>m.command==='seek').at(-1).seconds,5);
 let copied;h.ctx.navigator.clipboard.writeText=async value=>copied=value;
 const quote=h.ids.quotes.querySelectorAll('.quote-item')[0],actions=quote.querySelectorAll('.quote-actions')[0].children;
 const before=h.sent.filter(m=>m.command==='seek').length;
 await actions[1].click();quote.onclick({target:actions[1]});assert.equal(copied,'后一句');assert.equal(h.sent.filter(m=>m.command==='seek').length,before);
 await actions[0].click();assert.equal(h.saved.at(-1).text,'后一句');assert.equal(h.saved.at(-1).seconds,5);
});
test('overview prompt preserves mother coverage, quote count and evidence anchoring',()=>{
 const prompt=fs.readFileSync(path.join(__dirname,'../prompts/analysis.md'),'utf8');
 for(const rule of ['COVER THE ENTIRE VIDEO','{lateThreshold}','3-5 条带时间戳的关键观点','Unique or contrarian insights','Keep the speaker\'s voice and word choices intact','sourceIndex','sourceText'])assert.ok(prompt.includes(rule),rule);
});
test('polished quote is located by its exact source excerpt while preserving display wording',async()=>{
 const h=await harness();
 const result=h.ctx.DYD.anchorAnalysis({chapters:[],keyQuotes:[{quote:'Kimi 的模型进步了。',sourceText:'kimi的模型进步了',timestampSeconds:999}],keyMoments:[]},[{text:'kimi的模型进步了',start:0,duration:5}]);
 assert.equal(result.keyQuotes.length,1);assert.equal(result.keyQuotes[0].timestampSeconds,0);assert.equal(result.keyQuotes[0].quote,'Kimi 的模型进步了。');
});

test('whole recording progress describes the real phase without inventing a recognition percentage',async()=>{
 const h=await harness();
 h.ctx.renderProgress({pending:true,progressDetail:{whole:true,phase:'download',downloadBytes:1048576,totalDownloadBytes:2097152,totalSeconds:600,percent:null,elapsedSeconds:20}});
 assert.match(h.ids.progressLabel.textContent,/已读取 1.0 MB \/ 2.0 MB/);assert.equal(h.ids.transcriptionProgress.hidden,true);
 h.ctx.renderProgress({pending:true,progressDetail:{whole:true,phase:'recognize',totalSeconds:600,percent:null,elapsedSeconds:70}});
 assert.match(h.ids.progressLabel.textContent,/同时识别文字与说话人/);assert.doesNotMatch(h.ids.progressLabel.textContent,/已转写 0:00|%/);
});

test('definitive failure without a saved transcript stops waiting and offers the correct recovery actions',async()=>{
 for(const notSubmitted of [true,false]){
  const h=await harness(),send=h.ctx.chrome.runtime.sendMessage;let scheduled=0,cleared=0;
  vm.runInContext('rows=[];renderTranscript();',h.ctx);
  h.ctx.setTimeout=()=>{scheduled++;return 1;};h.ctx.clearTimeout=()=>{cleared++;};
  h.ctx.chrome.runtime.sendMessage=async m=>m.action==='poll'?{success:true,pending:true,failed:true,notSubmitted,error:'本次处理未完成，请检查音频。',progressDetail:{whole:true,phase:'failed',totalSeconds:30,elapsedSeconds:2}}:send(m);
  await h.ctx.poll();
  assert.equal(h.ids.checkJob.hidden,notSubmitted);
  assert.equal(h.ids.retryJob.hidden,false);
  assert.equal(h.ids.generationHint.textContent,'本次处理未完成，请检查音频。');
  assert.match(h.ids.status.textContent,/已停止自动处理/);
  assert.doesNotMatch(h.ids.generationHint.textContent,/暂时未能连接/);
  assert.equal(scheduled,0);assert.equal(cleared,1);
  assert.ok(!h.ids.transcriptList.textContent.includes('后一句'));
 }
});
test('a failed replacement never covers a saved transcript with a global failure banner',async()=>{
 const h=await harness(),send=h.ctx.chrome.runtime.sendMessage;let scheduled=0;
 h.ctx.setTimeout=()=>{scheduled++;return 1;};
 h.ctx.chrome.runtime.sendMessage=async m=>m.action==='poll'?{success:true,pending:true,failed:true,error:'火山未找到这次任务，尚未取得转写结果。',progressDetail:{whole:true,phase:'failed',totalSeconds:30,elapsedSeconds:2}}:send(m);
 await h.ctx.poll();
 assert.equal(h.ids.generation.hidden,true);assert.match(h.ids.status.textContent,/全文已完成/);assert.match(h.ids.status.textContent,/未影响/);assert.equal(h.ids.status.classes.has('error'),false);assert.ok(h.ids.transcriptList.textContent.includes('后一句'));assert.equal(scheduled,0);
});
