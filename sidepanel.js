function displayTitle(text){return String(text||'抖音视频').split(/[\r\n]|\s+(?=[\u4e00-\u9fff]{6})/)[0].slice(0,100);}
/* Chinese-only reading controller. Async results are scoped to the captured video. */
const $=id=>document.getElementById(id);
let context=null, epoch=0, rows=[],analysis=null,notes=[],selected=null,activeTab='transcript',
    matches=[],matchIndex=-1,lastActive=-1,viewTimer=null,pollTimer=null,lastContextKey='',contextBusy=false,playBusy=false;
let speakerNames={},transcriptRevision='legacy',speakerDialogRevision='legacy';
const pending=new Set();
let contextRetryAt=0,contextAttempts=0;
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
async function send(action,data={},ctx=context){
  const result=await chrome.runtime.sendMessage({action,tabId:ctx?.tabId,videoId:ctx?.videoId,...data});
  if(!result?.success)throw new Error(result?.message||result?.error||'操作没有完成，请重试。');
  return result;
}
function scoped(ctx){return context?.videoId===ctx?.videoId&&context?.tabId===ctx?.tabId;}
async function run(button,fn){
  if(pending.has(button))return;const generation=epoch;pending.add(button);$(button).disabled=true;
  try{await fn();}catch(e){if(generation===epoch)status(e.message,true);}
  finally{pending.delete(button);$(button).disabled=false;}
}
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function button(text,fn,className){const node=el('button',text,className);node.type='button';node.onclick=fn;return node;}
function stamp(seconds,fn){return button(DYD.time(seconds),fn,'stamp');}
async function seek(seconds,ctx=context){try{await send('page',{command:'seek',seconds},ctx);}catch(e){if(scoped(ctx))status(e.message,true);}}
async function checkContext(){
  if(contextBusy)return;contextBusy=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const id=DYD.videoId(tab?.url);
    const key=id?`${tab.id}:${id}`:'';
    if(key===lastContextKey&&(!contextRetryAt||Date.now()<contextRetryAt))return;
    if(key!==lastContextKey)contextAttempts=0;
    contextRetryAt=0;contextAttempts++;
    saveView();lastContextKey=key;epoch++;context=id?{tabId:tab.id,videoId:id}:null;
    clearTimeout(pollTimer);speakerNames={};$('speakerDialog').close();rows=[];analysis=null;selected=null;lastActive=-1;transcriptScroll=0;
    $('selectionBar').hidden=true;$('generation').hidden=true;renderProgress();$('videoTitle').textContent=id?'正在识别视频…':'准备开始精读';
    $('videoAuthor').textContent='';$('source').textContent='';$('search').value='';$('contentArea').scrollTop=0;
    $('explanation').close();renderTranscript();renderAnalysis();await refreshNotes();
    if(!context){status('请在抖音打开要读的节目，支持搜索结果、作者主页弹层和视频详情页。');return;}
    const ctx={...context},cacheResult=await send('cache',{},ctx);if(!scoped(ctx))return;
    if(cacheResult.cache){const c=cacheResult.cache;transcriptRevision=c.transcriptRevision||'legacy';speakerNames=c.speakerNames||{};rows=c.transcript||[];analysis=c.analysis||null;$('videoTitle').textContent=displayTitle(c.title);$('videoAuthor').textContent=c.channelName||'';$('source').textContent=c.source||'';renderTranscript();renderAnalysis();transcriptScroll=c.scrollTop||0;if(activeTab==='transcript')$('contentArea').scrollTop=transcriptScroll;}
    try{
      const info=await send('page',{command:'getVideoInfo'},ctx);if(!scoped(ctx))return;
      $('videoTitle').textContent=displayTitle(info.title);$('videoAuthor').textContent=info.channelName||'';
      if(rows.length){status('全文已完成，已恢复逐字稿与阅读位置。');if(cacheResult.pending||cacheResult.speakersPending)await poll(ctx);return;}
      await readSources(ctx);
    }catch(e){if(scoped(ctx)){
      if(contextAttempts<5){contextRetryAt=Date.now()+1500;status('视频正在加载，稍后自动读取…');}
      else status(e.message,true);
    }}
  }catch(e){status('暂时无法读取当前标签页，请重新打开侧栏。',true);}
  finally{contextBusy=false;}
}
async function readSources(ctx=context){
  if(!ctx)throw new Error('请先打开单条公开抖音视频详情页。');
  status('正在读取页面字幕…');const result=await send('sources',{},ctx);if(!scoped(ctx))return;
  if(result.info){$('videoTitle').textContent=displayTitle(result.info.title);$('videoAuthor').textContent=result.info.channelName||'';}
  if(result.transcript){await loadTranscriptResult(result,ctx);return;}
  $('generation').hidden=false;$('generate').hidden=false;$('checkJob').hidden=true;$('retryJob').hidden=true;
  const provider=await send('provider',{},ctx);if(!scoped(ctx))return;
  $('generationHint').textContent=provider.provider==='volc'?(provider.configured?'用火山生成带时间点的逐字稿，按音频时长计费；成功后重复打开直接使用本地结果。':'请先在设置中填写火山语音 API Key，再生成逐字稿。'):'使用 Supadata 转写，可能消耗额度；音频能否读取仍需实际确认。';
  status(rows.length?'保留已缓存逐字稿；页面暂未找到新字幕。':'未取得逐字稿。你可以尝试语音转写。');
  await poll(ctx,false);
}
async function loadTranscriptResult(result,ctx){
  if(!scoped(ctx))return;
  if(result.info){$('videoTitle').textContent=displayTitle(result.info.title);$('videoAuthor').textContent=result.info.channelName||'';}
  rows=result.transcript;transcriptRevision=result.transcriptRevision||transcriptRevision;speakerNames=result.speakerNames||speakerNames;analysis=null;$('generation').hidden=true;renderProgress();$('source').textContent=result.source||'逐字稿';
  renderTranscript();renderAnalysis();status(`全文已完成，共 ${rows.length} 段原话。`);
  if(activeTab==='overview')await analyze(ctx);
}
async function poll(ctx=context,repeat=true,force=false){
  if(!ctx)return;let result;try{result=await send('poll',{force},ctx);}catch(e){if(scoped(ctx)){$('generation').hidden=false;$('generate').hidden=true;$('checkJob').hidden=false;$('retryJob').hidden=true;$('generationHint').textContent='暂时未能连接，稍后自动查询原任务，不会重新提交。';clearTimeout(pollTimer);pollTimer=setTimeout(()=>poll(ctx,true).catch(()=>{}),15000);status(e.message,true);}return;}if(!scoped(ctx))return;
  renderProgress(result);
  if(result.transcript){await loadTranscriptResult(result,ctx);return;}
  if(!result.pending){$('generate').hidden=false;$('checkJob').hidden=true;$('retryJob').hidden=true;return;}
  $('generation').hidden=false;$('generate').hidden=true;$('checkJob').hidden=false;
  if(!result.failed&&!result.uncertain&&!result.timedOut)status('正在生成逐字稿，完成后会自动显示。');
  $('retryJob').hidden=!(result.failed||result.uncertain||result.timedOut);
  if(result.failed){clearTimeout(pollTimer);$('checkJob').hidden=!!result.notSubmitted||!result.progressDetail?.whole;$('generationHint').textContent=result.error|| (result.mediaForbidden?'转写服务返回音频访问被拒绝，因此尚未生成逐字稿。任务已保留，建议先解决音频来源，避免重复提交消耗额度。':'本次转写未成功，服务未返回逐字稿。任务记录已保留，未自动重新提交。');status('转写未成功，已停止自动处理。',true);return;}
  $('generationHint').textContent=result.uncertain?'上次提交结果不确定。为避免重复计费，已停止自动重试。可先检查服务用量，再决定是否重新提交。':result.timedOut?'转写已等待超过 20 分钟。可稍后查询，或确认后重新提交。':'正在生成逐字稿。可以继续观看；关闭侧栏后任务信息仍会保留。';
  if(result.throttled){$('generationHint').textContent='服务暂时限制查询频率。已保留转写任务，约一分钟后自动查询，无需重新提交。';status('转写任务已保留，等待服务允许查询。');}
  if(result.progress&&!result.uncertain&&!result.timedOut)$('generationHint').textContent=result.progress;
  if(!result.uncertain&&!result.timedOut){clearTimeout(pollTimer);pollTimer=setTimeout(()=>poll(ctx,true).catch(e=>{if(scoped(ctx))status(e.message,true);}),Math.max(10000,result.retryAfter||0));}
}
function renderProgress(result={}){
 const working=!!result.pending&&!result.failed&&!result.uncertain&&!result.timedOut;
 $('read').hidden=working;
 const p=result.progressDetail;$('progressInfo').hidden=!result.pending||!p;
 if(!result.pending||!p)return;
 const known=Number.isFinite(p.percent);$('transcriptionProgress').hidden=!known;
 if(known)$('transcriptionProgress').value=Math.max(0,Math.min(99,p.percent));
 if(p.whole){
  const phase=result.failed?'本次处理未完成':p.phase==='prepare'?`正在准备上传音频 · 已处理 ${DYD.time(p.preparedSeconds||0)}`:p.phase==='query'?'正在核实上传结果':p.phase==='download'?`已读取 ${((p.downloadBytes||0)/1048576).toFixed(1)} MB${p.totalDownloadBytes>0?` / ${(p.totalDownloadBytes/1048576).toFixed(1)} MB`:''}`:p.phase==='upload'?'正在上传完整音轨':'正在同时识别文字与说话人';
  $('progressLabel').textContent=`${phase}${p.totalSeconds>0?` · 音频 ${DYD.time(p.totalSeconds)}`:''} · 已等待 ${DYD.time(p.elapsedSeconds)}${working?'':' · 已暂停'}`;
  return;
 }
 const total=p.totalSeconds>0?` / ${DYD.time(p.totalSeconds)}`:'';
 $('progressLabel').textContent=`已转写 ${DYD.time(p.processedSeconds)}${total}${known?`（${p.percent}%）`:''} · 已等待 ${DYD.time(p.elapsedSeconds)}${working?'':' · 已暂停'}`;
}
function renderTranscript(){
  const list=$('transcriptList');list.replaceChildren();$('transcriptTools').hidden=!rows.length;$('speakers').hidden=!rows.some(r=>/^s\d+$/.test(r.speaker));
  if(!rows.length){list.append(el('p','逐字稿会显示在这里。','empty'));updateSearch();return;}
  rows.forEach((r,i)=>{const node=el('div',undefined,'entry');node.dataset.index=i;node.dataset.start=r.start;node.onclick=e=>{if(e.target?.closest('button'))return;const selection=window.getSelection();if(selection?.rangeCount&&!selection.isCollapsed){e.preventDefault();return;}void seek(r.start);};
    const body=el('div',undefined,'utterance');if(r.speaker)body.append(el('small',speakerLabel(r.speaker),'speaker-label'));body.append(el('span',r.text,'text'));node.append(stamp(r.start,()=>seek(r.start)),body);list.append(node);});
  updateSearch();
}
function updateSearch(){
  matches=DYD.matches(rows,$('search').value);matchIndex=matches.length?0:-1;
  const byRow=new Map();matches.forEach((m,i)=>{if(!byRow.has(m.index))byRow.set(m.index,[]);byRow.get(m.index).push({...m,match:i});});
  $('transcriptList').querySelectorAll('.text').forEach((node,i)=>{
    node.replaceChildren();let from=0;for(const m of byRow.get(i)||[]){node.append(document.createTextNode(rows[i].text.slice(from,m.offset)));const mark=el('mark',rows[i].text.slice(m.offset,m.offset+m.length));mark.dataset.match=m.match;node.append(mark);from=m.offset+m.length;}node.append(document.createTextNode(rows[i].text.slice(from)));
  });highlightMatch(false);
}
function highlightMatch(scroll=true){
  $('searchCount').textContent=$('search').value.trim()?`${matches.length?matchIndex+1:0}/${matches.length}`:'';
  $('prev').disabled=$('next').disabled=!matches.length;
  document.querySelectorAll('mark.current-match').forEach(n=>n.classList.remove('current-match'));
  const current=document.querySelector(`mark[data-match="${matchIndex}"]`);current?.classList.add('current-match');
  if(scroll&&current){$('follow').checked=false;current.scrollIntoView({block:'center'});}
}
function renderAnalysis(){
  $('chapters').replaceChildren();$('quotes').replaceChildren();
  $('analyze').hidden=!!analysis;$('overviewHint').hidden=!!analysis;
  if(!analysis){$('chapters').append(el('p','取得逐字稿后，即可生成内容概览。','muted'));return;}
  const bindPlayback=(node,seconds)=>{node.tabIndex=0;node.setAttribute('role','button');node.onclick=e=>{if(e?.target?.closest('button'))return;void seek(seconds);};node.onkeydown=e=>{if(e.target!==node)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();void seek(seconds);}};};
  for(const c of analysis.chapters||[]){
    const node=el('article',undefined,'chapter-item'),content=el('div',undefined,'chapter-content');
    content.append(el('span',c.title,'chapter-title'),el('span',c.summary,'chapter-summary'));
    node.append(el('span',DYD.time(c.timestampSeconds),'chapter-timestamp'),content);bindPlayback(node,c.timestampSeconds);$('chapters').append(node);
  }
  for(const q of [...(analysis.keyQuotes||[])].sort((a,b)=>a.timestampSeconds-b.timestampSeconds)){
    const node=el('article',undefined,'quote-item'),meta=el('div',undefined,'quote-meta'),actions=el('div',undefined,'quote-actions');
    actions.append(button('📝 存笔记',()=>saveSelected(q.quote,q.timestampSeconds),'quote-save-note-btn'),button('⧉ 复制',()=>navigator.clipboard.writeText(q.quote),'quote-copy-btn'));
    meta.append(el('span',DYD.time(q.timestampSeconds),'quote-timestamp'),actions);
    node.append(el('p',q.quote,'quote-text'),meta);bindPlayback(node,q.timestampSeconds);$('quotes').append(node);
  }
  if(!analysis.chapters?.length)$('chapters').append(el('p','这段内容没有提取到可靠的章节。','muted'));
  if(!analysis.keyQuotes?.length)$('quotes').append(el('p','这段内容没有提取到可靠的关键观点。','muted'));
}
async function analyze(ctx=context){
  if(!ctx||!rows.length)throw new Error('请先取得逐字稿。');
  status('正在整理章节和关键观点…');const result=await send('analyze',{},ctx);if(!scoped(ctx))return;
  analysis=result.analysis;renderAnalysis();status('内容概览已保存，下次打开直接读取。');
}
async function refreshNotes(){const result=await send('notes',{},null);notes=result.notes;renderNotes();}
function visibleNotes(){return $('allNotes').checked?notes:notes.filter(n=>n.videoId===context?.videoId);}
function renderNotes(){
 $('notesThis').setAttribute('aria-pressed',String(!$('allNotes').checked));$('notesAll').setAttribute('aria-pressed',String($('allNotes').checked));
 $('noteList').replaceChildren();
 for(const n of visibleNotes()){
  const play=async()=>{if(n.videoId===context?.videoId)await seek(n.seconds);else await chrome.tabs.create({url:DYD.link(n.videoId,n.seconds)});};
  const node=el('article',undefined,'note'),heading=el('div',undefined,'note-heading');
  heading.append(button(DYD.time(n.seconds),play,'note-time'));
  if($('allNotes').checked)heading.append(el('small',displayTitle(n.videoTitle)));
  const people=[...new Set(n.segments?.map(s=>s.speakerName).filter(Boolean)||[])];
  if(n.speakerName||people.length)heading.append(el('small',n.speakerName||people.join(' / ')));
  node.append(heading,el('p',n.text,'note-text'));
  const bar=el('div',undefined,'note-actions');
  bar.append(button('⧉ 复制文字',()=>copy(n.text)),button('🔗 复制时间链接',()=>copy(DYD.link(n.videoId,n.seconds))),button('▶ 播放',play));
  const remove=button('删除',async()=>{if(!confirm('删除这条笔记？'))return;try{await send('deleteNote',{noteId:n.id},null);await refreshNotes();status('笔记已删除。');}catch(e){status(e.message,true);}},'note-delete');remove.setAttribute('aria-label','删除笔记');
  bar.append(remove);node.append(bar);$('noteList').append(node);
 }
 if(!visibleNotes().length)$('noteList').append(el('p','还没有保存笔记。选中逐字稿后点击“记笔记”，或点击视频画面上的“记笔记”，即可保存原话与时间点。','empty'));
}
async function saveSelected(text,seconds,ctx=context,quote=true,segments){
  if(!ctx)return;const result=await send('saveNote',{text,seconds,quote,segments,videoTitle:$('videoTitle').textContent},ctx);
  await refreshNotes();if(scoped(ctx))status(`已保存 ${DYD.time(result.note.seconds)} 的笔记。`);
}
function saveView(){
  clearTimeout(viewTimer);if(context&&rows.length&&activeTab==='transcript')void send('view',{scrollTop:$('contentArea').scrollTop},{...context}).catch(()=>{});
}
async function playback(force=false){
  if(!context||!rows.length||playBusy)return;playBusy=true;const ctx={...context};
  try{
    const result=await send('page',{command:'getPlayback'},ctx);if(!scoped(ctx))return;
    const index=DYD.activeIndex(rows,result.currentTime);
    document.querySelectorAll('.entry.active').forEach(n=>n.classList.remove('active'));
    const node=document.querySelector(`.entry[data-index="${index}"]`);node?.classList.add('active');
    if(activeTab==='transcript'&&node&&!selected&&(force||($('follow').checked&&index!==lastActive)))node.scrollIntoView({block:'center'});
    lastActive=index;
  }catch(e){if(force&&scoped(ctx))status(e.message,true);}finally{playBusy=false;}
}
async function copy(text){try{await navigator.clipboard.writeText(text);status('已复制。');}catch{status('复制失败，请使用导出。',true);}}
function exportText(text,suffix){const blob=new Blob([text],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=`抖音精读-${context?.videoId||'全部'}-${suffix}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function documentHeader(){return `# ${$('videoTitle').textContent}\n\n${context?DYD.canonical(context.videoId):''}\n\n`;}
function transcriptExport(){return documentHeader()+rows.map(r=>`[${DYD.time(r.start)}](${DYD.link(context.videoId,r.start)}) ${r.speaker?speakerLabel(r.speaker)+'：':''}${r.text}`).join('\n\n');}
function hideSelection(){ $('selectionBar').hidden=true;selected=null; }
function captureSelection(){
 const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed){hideSelection();return;}
 const range=selection.getRangeAt(0),start=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement,end=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
 if(!start?.closest('#transcriptList')||!end?.closest('#transcriptList')){hideSelection();return;}
 const entry=start.closest('.entry');if(!entry){hideSelection();return;}
 // Intersect only the original-text spans: timestamps and speaker badges are not quote text.
 const segments=[];
 for(const span of $('transcriptList').querySelectorAll('.text'))if(range.intersectsNode(span)){
  const part=document.createRange();part.selectNodeContents(span);
  if(range.compareBoundaryPoints(Range.START_TO_START,part)>0)part.setStart(range.startContainer,range.startOffset);
  if(range.compareBoundaryPoints(Range.END_TO_END,part)<0)part.setEnd(range.endContainer,range.endOffset);
  const text=part.toString().trim();if(text)segments.push({start:Number(span.closest('.entry').dataset.start),text});
 }
 const text=segments.map(s=>s.text).join('\n');if(!text){hideSelection();return;}
 selected={text,segments,seconds:segments[0].start,ctx:{...context}};
 const rect=range.getBoundingClientRect(),bar=$('selectionBar'),width=Math.min(250,window.innerWidth-24);
 bar.style.width=`${width}px`;bar.style.left=`${Math.max(12,Math.min(rect.left+rect.width/2-width/2,window.innerWidth-width-12))}px`;
 bar.style.top=`${Math.max(8,rect.bottom+52<window.innerHeight?rect.bottom+8:rect.top-46)}px`;bar.hidden=false;
}
function speakerLabel(id){return speakerNames[id]||(/^s\d+$/.test(id)?`说话人 ${id.slice(1)}`:'说话人待确认');}
$('speakers').onclick=()=>{
  speakerDialogRevision=transcriptRevision;
  const ids=[...new Set(rows.map(r=>r.speaker).filter(id=>/^s\d+$/.test(id)))];$('speakerFields').replaceChildren();
  $('speakerHint').textContent='可为已有说话人填写姓名，保存立即生效，无需重新转写。请回听确认；不确定的段落保留待确认。';
  for(const id of ids){const field=el('label',`说话人 ${id.slice(1)}`,'speaker-field'),input=el('input');input.dataset.speaker=id;input.value=speakerNames[id]||'';input.placeholder='填写姓名（可留空）';input.maxLength=30;field.append(input);$('speakerFields').append(field);}
  $('repairSpeakers').hidden=true;$('identifySpeakers').hidden=true;$('saveSpeakerNames').hidden=!ids.length;$('speakerDialog').showModal();
};
$('closeSpeakers').onclick=()=>$('speakerDialog').close();
$('identifySpeakers').onclick=()=>run('identifySpeakers',async()=>{
  const ctx={...context};$('speakerDialog').close();status('正在自动区分整期说话人，原逐字稿可以继续阅读。');
  const result=await send('identifySpeakers',{},ctx);if(!scoped(ctx))return;if(result.transcript)await loadTranscriptResult(result,ctx);else await poll(ctx);
});
$('repairSpeakers').onclick=()=>run('repairSpeakers',async()=>{const ctx={...context};$('speakerDialog').close();const result=await send('repairSpeakers',{},ctx);if(scoped(ctx)){if(result.transcript)await loadTranscriptResult(result,ctx);else await poll(ctx);}});
$('saveSpeakerNames').onclick=()=>run('saveSpeakerNames',async()=>{
  const ctx={...context},names={};$('speakerFields').querySelectorAll('input').forEach(input=>names[input.dataset.speaker]=input.value);
  const result=await send('speakerNames',{names,transcriptRevision:speakerDialogRevision},ctx);if(!scoped(ctx))return;speakerNames=result.speakerNames;renderTranscript();await refreshNotes();$('speakerDialog').close();status('姓名已更新，对应逐字稿、笔记和导出同步生效。');
});
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
$('retranscribe').onclick=()=>run('retranscribe',async()=>{
 if(!confirm('重新转写整场音频并区分说话人，会按时长再次计费。成功后更新逐字稿，已有笔记保留。继续？'))return;
 const ctx={...context};$('transcriptTools').open=false;status('正在准备整场转写，原稿与笔记继续保留。');
 await send('retranscribe',{},ctx);if(scoped(ctx))await poll(ctx);
});
$('read').onclick=()=>run('read',()=>readSources());
$('generate').onclick=()=>run('generate',async()=>{const ctx={...context};status('正在提交转写，可能需要几分钟…');let result;try{result=await send('generate',{},ctx);}catch(e){if(scoped(ctx)){await poll(ctx,false);status(e.message,true);}return;}if(!scoped(ctx))return;if(result.transcript)await loadTranscriptResult(result,ctx);else await poll(ctx);});
$('checkJob').onclick=()=>run('checkJob',()=>poll(context,true,true));
$('retryJob').onclick=()=>run('retryJob',async()=>{if(!confirm('上次转写可能已计费，重新提交可能再次计费。继续？'))return;const ctx={...context};const reset=await send('resetJob',{},ctx);const result=await send(reset.replace?'retranscribe':reset.speakers?'resumeSpeakers':'generate',{},ctx);if(result.transcript)await loadTranscriptResult(result,ctx);else await poll(ctx);});
$('analyze').onclick=()=>run('analyze',()=>analyze());
$('search').oninput=updateSearch;
$('prev').onclick=()=>{if(matches.length){matchIndex=(matchIndex-1+matches.length)%matches.length;highlightMatch();}};
$('next').onclick=()=>{if(matches.length){matchIndex=(matchIndex+1)%matches.length;highlightMatch();}};
$('search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$(e.shiftKey?'prev':'next').click();}};
$('current').onclick=()=>{switchTab('transcript');void playback(true);};
$('follow').onchange=()=>{if($('follow').checked)void playback(true);};
$('contentArea').addEventListener('wheel',()=>{$('follow').checked=false;},{passive:true});
$('contentArea').addEventListener('touchmove',()=>{$('follow').checked=false;},{passive:true});
$('contentArea').addEventListener('scroll',()=>{hideSelection();clearTimeout(viewTimer);viewTimer=setTimeout(saveView,250);});
$('transcriptList').addEventListener('mouseup',captureSelection);
$('transcriptList').addEventListener('keyup',captureSelection);
$('selectionBar').addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();});
$('selectionBar').addEventListener('mouseup',e=>e.stopPropagation());
document.addEventListener('mousedown',e=>{if(!e.target?.closest('#selectionBar'))hideSelection();});
window.addEventListener('resize',hideSelection);
$('noteSelection').onclick=()=>run('noteSelection',async()=>{const s=selected;if(s&&scoped(s.ctx)){await saveSelected(s.text,s.seconds,s.ctx,true,s.segments);if(selected===s)hideSelection();}});
$('explain').onclick=()=>run('explain',async()=>{
  const s=selected;if(!s||!scoped(s.ctx))return;hideSelection();$('explanationText').textContent='正在解释…';$('explanation').showModal();
  try{const result=await send('explain',{text:s.text,seconds:s.seconds},s.ctx);if(scoped(s.ctx))$('explanationText').textContent=result.explanation;}
  catch(e){if(scoped(s.ctx))$('explanationText').textContent=e.message;}
});
$('closeExplanation').onclick=()=>$('explanation').close();
$('addNote').onclick=()=>run('addNote',async()=>{const ctx={...context};const result=await send('page',{command:'getPlayback'},ctx);await saveSelected($('noteText').value,result.currentTime,ctx,false);if(scoped(ctx))$('noteText').value='';});
$('allNotes').onchange=renderNotes;
$('notesThis').onclick=()=>{$('allNotes').checked=false;renderNotes();};
$('notesAll').onclick=()=>{$('allNotes').checked=true;renderNotes();};
$('copy').onclick=()=>{if(!rows.length)return status('请先取得逐字稿。',true);void copy(transcriptExport());};
$('export').onclick=()=>{if(rows.length)exportText(transcriptExport(),'逐字稿');else status('请先取得逐字稿。',true);};
$('exportOverview').onclick=()=>{
  if(!analysis)return status('请先生成内容概览。',true);
  exportText(documentHeader()+'## 内容章节\n\n'+(analysis.chapters||[]).map(c=>`### [${DYD.time(c.timestampSeconds)}](${DYD.link(context.videoId,c.timestampSeconds)}) ${c.title}\n\n${c.summary}`).join('\n\n')+'\n\n## 关键观点\n\n'+(analysis.keyQuotes||[]).map(q=>`[${DYD.time(q.timestampSeconds)}](${DYD.link(context.videoId,q.timestampSeconds)}) ${q.quote}`).join('\n\n'),'概览');
};
function notesExport(){return '# 抖音精读笔记\n\n'+visibleNotes().map(n=>`## ${n.videoTitle}\n\n`+(n.segments?.length?n.segments.map(s=>`[${DYD.time(s.start)}](${DYD.link(n.videoId,s.start)})${s.speakerName?' · '+s.speakerName:''}\n\n${s.text}`).join('\n\n'):`[${DYD.time(n.seconds)}](${DYD.link(n.videoId,n.seconds)})${n.speakerName?' · '+n.speakerName:''}\n\n${n.text}`)).join('\n\n');}
$('exportNotes').onclick=()=>exportText(notesExport(),'笔记');
let transcriptScroll=0;
function switchTab(name){
  hideSelection();
  if(activeTab==='transcript'){transcriptScroll=$('contentArea').scrollTop;saveView();}
  activeTab=name;document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===name)));
  document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!==name);$('contentArea').scrollTop=name==='transcript'?transcriptScroll:0;
  if(name==='overview'&&rows.length&&!analysis)void run('analyze',()=>analyze());
  if(name==='notes')void refreshNotes().catch(e=>status(e.message,true));
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
window.addEventListener('pagehide',saveView);
chrome.tabs.onActivated.addListener(()=>void checkContext());chrome.tabs.onUpdated.addListener(()=>void checkContext());
chrome.runtime.onMessage.addListener(m=>{if(m.action==='notesChanged')void refreshNotes().catch(()=>{});if(m.action==='readingJobChanged'&&m.videoId===context?.videoId)void poll(context).catch(()=>{});});
setInterval(()=>void checkContext(),1000);setInterval(()=>void playback(),700);void checkContext();
