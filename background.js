importScripts('core.js','settings.js','ai.js','volc.js','transcript-parts.js','audio-jobs.js');
importScripts('library-config.js','library-core.js','library-db.js','library-background.js');
const inFlight = new Map();
let storageQueue=Promise.resolve();
function serialized(fn) {const next=storageQueue.then(fn,fn);storageQueue=next.catch(()=>{});return next;}
function single(key,fn) {if(inFlight.has(key)) return inFlight.get(key);const p=Promise.resolve().then(fn).finally(()=>inFlight.delete(key));inFlight.set(key,p);return p;}
async function reconcileTab(tabId,url,windowId) {
  if(!Number.isInteger(tabId))return;
  const enabled=!!DYD.videoId(url);
  if(!enabled&&typeof chrome.sidePanel.close==='function') {
    // Retire a previously opened global instance as well as a tab-specific one.
    try {await chrome.sidePanel.close({tabId});}
    catch {if(Number.isInteger(windowId))await chrome.sidePanel.close({windowId}).catch(()=>{});}
  }
  await chrome.sidePanel.setOptions({tabId,path:'sidepanel.html',enabled}).catch(()=>{});
}
function openVideoPanel(tab) {
  if(!DYD.videoId(tab.url))return reconcileTab(tab.id,tab.url,tab.windowId);
  // Issue both calls in the click handler, preserving Chrome's user gesture.
  chrome.sidePanel.setOptions({tabId:tab.id,path:'sidepanel.html',enabled:true}).catch(()=>{});
  const opening=chrome.sidePanel.open({tabId:tab.id});
  // This path is reached only from the user's toolbar/embedded reading click, never navigation.
  opening.then(()=>startGeneration({videoId:DYD.videoId(tab.url),tabId:tab.id})).then(
    ()=>chrome.runtime.sendMessage?.({action:'readingJobChanged',videoId:DYD.videoId(tab.url)}).catch(()=>{}),
    ()=>{});
  return opening;
}
chrome.sidePanel.setOptions({enabled:false}).catch(()=>{});
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false});
chrome.action.onClicked.addListener(tab=>openVideoPanel(tab).catch(()=>{}));
chrome.tabs.onUpdated.addListener((id,change,tab)=>{
  if(change.url||['loading','complete'].includes(change.status))void reconcileTab(id,change.url||tab.pendingUrl||tab.url,tab.windowId);
});
chrome.tabs.onActivated.addListener(({tabId,windowId})=>chrome.tabs.get(tabId).then(t=>reconcileTab(tabId,t.pendingUrl||t.url,windowId)).catch(()=>{}));
function initializePanels(){return chrome.tabs.query({}).then(tabs=>Promise.all(tabs.map(t=>reconcileTab(t.id,t.pendingUrl||t.url,t.windowId)))).catch(()=>{});}
chrome.runtime.onInstalled.addListener(initializePanels);
chrome.runtime.onStartup.addListener(initializePanels);
void initializePanels();
async function page(tabId,id,action,extra={}) {
  const tab=await chrome.tabs.get(tabId);
  if(DYD.videoId(tab.url)!==id)throw new Error('视频已切换，请等待侧栏更新。');
  let result;
  try {result=await chrome.tabs.sendMessage(tabId,{action,expectedVideoId:id,...extra});}
  catch {throw new Error('请刷新抖音页面，再打开精读。');}
  if(!result?.success)throw new Error(result?.error||'页面还未准备好，请先播放视频。');
  return result;
}
async function cacheGet(id) {
  const record=(await chrome.storage.local.get(`digest_${id}`))[`digest_${id}`]||null;
  if(record?.source==='语音转写'&&record.transcript)record.transcript=DYD.readable(record.transcript);
  if(record&&record.analysisRevision!==4)record.analysis=null;
  return record;
}
async function cacheSet(id,patch) {
  return serialized(()=>writeCache(id,patch));
}
// Caller owns storageQueue when combining a cache write with a job checkpoint.
async function writeCache(id,patch) {
  const old=await cacheGet(id);
  const record={...old,...patch,updatedAt:Date.now()};
  // Only bounded reading data is persisted, never signed media URLs.
  delete record.mediaUrl;
  const all=await chrome.storage.local.get(null);
  const keys=Object.keys(all).filter(k=>k.startsWith('digest_')&&k!==`digest_${id}`).sort((a,b)=>(all[b].updatedAt||0)-(all[a].updatedAt||0));
  if(keys.length>9)await chrome.storage.local.remove(keys.slice(9));
  await chrome.storage.local.set({[`digest_${id}`]:record});
  return record;
}
function publicInfo(info) {return {videoId:info.videoId,title:String(info.title||'').slice(0,1000),channelName:String(info.channelName||'').slice(0,300),description:String(info.description||'').slice(0,4000),duration:Number(info.duration)||0};}
function inferredNames(rows,info) {
  // Only explicit self-introduction corroborated by this video's metadata. Never infer identity from speaking order.
  const metadata=[info.title,info.channelName,info.description].join(' '),candidates=new Map();
  for(const r of rows)if(/^s\d+$/.test(r.speaker))for(const m of r.text.matchAll(/(?:^|[，。！？：、\s])(?:大家好[，\s]*)?我(?:是|叫)([\u4e00-\u9fff]{2,4})(?=[，。！？、\s]|$)/g)){
    if(metadata.includes(m[1])){if(!candidates.has(r.speaker))candidates.set(r.speaker,new Set());candidates.get(r.speaker).add(m[1]);}
  }
  const names={};for(const [id,set] of candidates)if(set.size===1){const name=[...set][0];if([...candidates.values()].filter(s=>s.has(name)).length===1)names[id]=name;}
  return names;
}
function namedNote(note,names) {
  const label=id=>names[id]||(/^s\d+$/.test(id)?`说话人 ${id.slice(1)}`:'说话人待确认');
  const segments=note.segments?.map(s=>({...s,...(s.speaker?{speakerName:label(s.speaker)}:{})}));
  return {...note,...(note.speaker?{speakerName:label(note.speaker)}:{}),...(segments?{segments}:{})};
}
async function acceptTranscript(id,rows,info,source,revision) {
  return serialized(()=>writeTranscript(id,rows,info,source,revision));
}
async function writeTranscript(id,rows,info,source,revision) {
  const normalized=DYD.normalize(rows),transcript=source==='语音转写'?DYD.readable(normalized):normalized;
  if(!transcript.length)throw new Error('没有取得带时间点的逐字稿。请确认视频有人声，或稍后重试。');
  const size=new TextEncoder().encode(JSON.stringify(transcript)).length;
  if(size>1500000)throw new Error('逐字稿过长，当前版本暂不支持。');
  const old=await cacheGet(id);
  const unchanged=JSON.stringify(old?.transcript)===JSON.stringify(transcript);
  const transcriptRevision=unchanged?(old?.transcriptRevision||'legacy'):(revision||crypto.randomUUID());
  const speakerNames=unchanged?(old?.speakerNames||{}):inferredNames(transcript,info);
  await writeCache(id,{...publicInfo(info),transcript,source,transcriptRevision,speakerNames,speakerRevision:transcript.some(r=>/^s\d+$/.test(r.speaker))?1:0,analysis:unchanged?old?.analysis:null});
  return {success:true,transcript,transcriptRevision,speakerNames,source,info:publicInfo(info)};
}
async function loadSources(m) {
  const info=await page(m.tabId,m.videoId,'getSources');
  if(info.transcript?.length)return acceptTranscript(m.videoId,info.transcript,info,'页面字幕');
  return {success:true,info:publicInfo(info),needsGeneration:true,hasMedia:!!DYD.mediaUrl(info.mediaUrl),ready:info.ready};
}
async function serviceRequest(url,key) {
  const response=await fetch(url,{headers:{'x-api-key':key},signal:AbortSignal.timeout(25000)});
  if(!response.ok) {
    const labels={401:'Supadata 密钥无效，请在设置中检查。',403:'Supadata 账号无访问权限。',429:'转写请求已达到限制，请稍后查询。',400:'转写服务不接受这个视频地址。',404:'转写服务无法取得这个视频。'};
    const e=new Error(labels[response.status]||`转写服务暂时不可用（${response.status}），请稍后重试。`);e.status=response.status;throw e;
  }
  const text=await response.text();if(text.length>2000000)throw new Error('转写结果过大。');
  return JSON.parse(text);
}
async function startGeneration(m) {
  return single(`transcript:${m.videoId}`,async()=>{
    const key=`job_${m.videoId}`;
    const previous=(await chrome.storage.local.get(key))[key];
    const cached=await cacheGet(m.videoId);if(cached?.transcript?.length&&!m.replace)return {success:true,transcript:cached.transcript,transcriptRevision:cached.transcriptRevision||'legacy',speakerNames:cached.speakerNames||{},source:cached.source,info:publicInfo(cached)};
    if(previous?.jobId || ['submitting','uncertain'].includes(previous?.status))return {success:true,pending:true,...previous};
    const settings=await getSettings();if(settings.transcriptionProvider==='volc')return startVolc(m,settings);if(!settings.supadataApiKey)throw new Error('请先在设置中填写 Supadata Key。');
    const info=await page(m.tabId,m.videoId,'getSources');
    if(info.transcript?.length)return acceptTranscript(m.videoId,info.transcript,info,'页面字幕');
    if(!info.ready)throw new Error('请先让视频正常播放，再生成逐字稿。');
    const target=DYD.mediaUrl(info.mediaUrl)||DYD.canonical(m.videoId);
    const u=new URL('https://api.supadata.ai/v1/transcript');
    u.search=new URLSearchParams({url:target,text:'false',lang:'zh',mode:'generate'});
    // Persist before submission. A worker restart must not silently bill a duplicate request.
    const job={status:'submitting',startedAt:Date.now(),info:publicInfo(info)};
    await chrome.storage.local.set({[key]:job});
    let data;
    try {data=await serviceRequest(u.href,settings.supadataApiKey);}
    catch(error) {
      // An uncertain network response may already have created a paid job. Explicit user retry only.
      if([400,401,403,404,429].includes(error.status))await chrome.storage.local.remove(key);
      else await chrome.storage.local.set({[key]:{...job,status:'uncertain'}});
      throw error;
    }
    if(data.jobId) {
      if(!/^[\w-]{1,200}$/.test(data.jobId))throw new Error('服务返回了无效的任务编号。');
      await chrome.storage.local.set({[key]:{...job,status:'running',jobId:data.jobId}});
      return {success:true,pending:true};
    }
    const result=await acceptTranscript(m.videoId,DYD.normalize(data.content,true),info,'语音转写');
    await chrome.storage.local.remove(key);return result;
  });
}
async function pollGeneration(m) {
  return single(`poll:${m.videoId}`,async()=>{
    const key=`job_${m.videoId}`, job=(await chrome.storage.local.get(key))[key];
    if(!job){const cached=await cacheGet(m.videoId);return cached?.transcript?.length?{success:true,transcript:cached.transcript,transcriptRevision:cached.transcriptRevision||'legacy',speakerNames:cached.speakerNames||{},source:cached.source,info:publicInfo(cached)}:{success:true,pending:false};}
    if(job.provider==='volc-upload')return pollAudioUpload(m,job);
    if(job.provider==='volc')return pollVolc(m,job);
    if(job.status==='failed')return {success:true,pending:true,failed:true,mediaForbidden:job.errorCode==='forbidden'};
    if(job.status==='uncertain'||!job.jobId)return {success:true,pending:true,uncertain:true};
    if(!m.force && Date.now()-job.startedAt>20*60*1000)return {success:true,pending:true,timedOut:true};
    const settings=await getSettings();if(!settings.supadataApiKey)throw new Error('请先在设置中填写 Supadata Key。');
    if(job.nextPollAt>Date.now())return {success:true,pending:true,throttled:true,retryAfter:job.nextPollAt-Date.now()};
    let data;
    try{data=await serviceRequest(`https://api.supadata.ai/v1/transcript/${encodeURIComponent(job.jobId)}`,settings.supadataApiKey);}
    catch(error){
      if(error.status!==429)throw error;
      await chrome.storage.local.set({[key]:{...job,nextPollAt:Date.now()+60000}});
      return {success:true,pending:true,throttled:true,retryAfter:60000};
    }
    if(data.status==='failed'||data.status==='error'||data.error) {
      const mediaForbidden=data.error?.error==='forbidden';
      await chrome.storage.local.set({[key]:{...job,status:'failed',errorCode:mediaForbidden?'forbidden':'unknown'}});
      return {success:true,pending:true,failed:true,mediaForbidden};
    }
    if(Array.isArray(data.content)) {
      const result=await acceptTranscript(m.videoId,DYD.normalize(data.content,true),job.info,'语音转写');
      await chrome.storage.local.remove(key);return result;
    }
    return {success:true,pending:true};
  });
}
async function startVolc(m,settings) {
  return startAudioUpload(m,settings);
}
async function startVolcLegacy(m,settings) {
  if(!settings.volcApiKey)throw new Error('请先在设置中填写火山语音 API Key。');
  const info=await page(m.tabId,m.videoId,'getSources');
  if(info.transcript?.length)return acceptTranscript(m.videoId,info.transcript,info,'页面字幕');
  const media=DYD.mediaUrl(info.mediaUrl);
  if(!info.ready||!media)throw new Error('尚未取得音频地址，请先播放当前节目再重试。');
  const key=`job_${m.videoId}`,job={provider:'volc',resourceId:settings.volcResourceId,jobId:crypto.randomUUID(),status:'submitting',startedAt:Date.now(),info:publicInfo(info)};
  await chrome.storage.local.set({[key]:job});
  try {
    await DYD_VOLC.request('submit',settings.volcApiKey,job,media);
    await chrome.storage.local.set({[key]:{...job,status:'running'}});
  } catch(e) {
    // Keep the same UUID after uncertain submission. Query, never silently resubmit.
    await chrome.storage.local.set({[key]:{...job,status:e.serviceCode||[400,401,403].includes(e.httpStatus)?'failed':'uncertain'}});
    throw e;
  }
  return {success:true,pending:true};
}
async function pollVolc(m,job) {
  const progress=job.whole?{progress:job.submitFinished?'整期音频已提交，正在同时识别文字、时间和说话人。':'正在上传整期音轨。',progressDetail:{whole:true,phase:job.submitFinished?'recognize':'upload',completedParts:0,processedSeconds:0,totalSeconds:job.audioDuration||0,elapsedSeconds:Math.max(0,Math.floor((Date.now()-job.startedAt)/1000)),percent:null}}:{};
  if(job.whole&&job.stage==='query'){progress.progress='上传结果尚未确认，正在查询原任务，不会重复提交。';progress.progressDetail.phase='query';}
  const failedResult=failedJob=>({success:true,pending:true,failed:true,error:failedJob.error,notSubmitted:!!failedJob.notSubmitted,...progress,...(job.whole?{progressDetail:{...progress.progressDetail,phase:'failed'}}:{})});
  if(job.status==='failed'&&(!m.force||job.notSubmitted))return failedResult(job);
  if(job.whole&&!job.submitFinished&&Date.now()-(job.heartbeatAt||0)<90000)return {success:true,pending:true,...progress};
  if(!job.whole&&!m.force&&Date.now()-job.startedAt>20*60*1000)return {success:true,pending:true,timedOut:true};
  if(!m.force&&job.nextPollAt>Date.now())return {success:true,pending:true,retryAfter:job.nextPollAt-Date.now(),...progress};
  const settings=await getSettings(),key=`job_${m.videoId}`;
  try {
    const data=await DYD_VOLC.request('query',settings.volcApiKey,job);
    if(data.pending)return await serialized(async()=>{
      const current=(await chrome.storage.local.get(key))[key];
      if(current?.jobId!==job.jobId)return {success:true,pending:true,stale:true};
      await chrome.storage.local.set({[key]:{...current,status:'running',...(job.whole?{submitFinished:true,stage:'recognize'}:{}),nextPollAt:Date.now()+10000}});
      return {success:true,pending:true,...progress};
    });
    if(job.whole){
      try {
        if(!Number.isFinite(data.durationMs)||Math.abs(data.durationMs/1000-job.audioDuration)>2)throw new Error('识别音频长度与完整音轨不一致，未保存结果。');
        const ids=new Map();
        data.transcript=DYD_PARTS.merge([{offset:job.audioOffset,duration:job.audioDuration,rows:data.transcript.map(r=>{
          if(r.localSpeaker!==undefined&&!ids.has(r.localSpeaker))ids.set(r.localSpeaker,`s${ids.size+1}`);
          return {...r,speaker:ids.get(r.localSpeaker)||'unknown'};
        })}]);
      }catch(e){e.invalidTranscript=true;throw e;}
    }
    return await serialized(async()=>{
      const current=(await chrome.storage.local.get(key))[key];
      if(current?.jobId!==job.jobId)return {success:true,pending:true,stale:true};
      const result=await writeTranscript(m.videoId,data.transcript,job.info,'火山语音转写',job.jobId);
      await chrome.storage.local.remove(key);return result;
    });
  } catch(e) {
    const current=await serialized(async()=>{
      const current=(await chrome.storage.local.get(key))[key];
      if(current?.jobId!==job.jobId)return null;
      if(e.serviceCode||e.invalidTranscript){
        const failed={...current,status:'failed',error:e.message};
        await chrome.storage.local.set({[key]:failed});return failed;
      }
      return current;
    });
    if(!current)return {success:true,pending:true,stale:true};
    if(e.serviceCode||e.invalidTranscript)return failedResult(current);
    if(![400,401,403,404].includes(e.httpStatus))return {success:true,pending:true,retryAfter:e.httpStatus===429?60000:15000,progress:'连接暂时中断，正在自动查询原任务，不会重新提交。',progressDetail:progress.progressDetail};
    throw e;
  }
}
async function saveNote(m) {
  const cached=await cacheGet(m.videoId);
  const seconds=Math.max(0,Number(m.seconds)||0);
  let text=String(m.text||'').trim();
  if(text.length>20000)throw new Error('这段原话超过两万字，请分成两条笔记保存。');
  if(!text) text=cached?.transcript?.[DYD.activeIndex(cached.transcript,seconds)]?.text||'';
  if(!text)throw new Error('请先取得逐字稿，或输入笔记内容。');
  const sourceRow=cached?.transcript?.[DYD.activeIndex(cached.transcript,seconds)];
  const segments=[];
  if(m.quote&&Array.isArray(m.segments))for(const s of m.segments.slice(0,300)){
    const row=cached?.transcript?.find(r=>r.start===s.start);
    if(!row||typeof s.text!=='string'||!s.text||!row.text.includes(s.text))throw new Error('选段已变化，请重新选择原话。');
    segments.push({start:row.start,duration:row.duration,text:s.text,...(row.speaker?{speaker:row.speaker}:{})});
  }
  if(segments.length)text=segments.map(s=>s.text).join('\n');
  const speaker=segments.length?([...new Set(segments.map(s=>s.speaker))].length===1?segments[0].speaker:null):(m.quote||!m.text)&&sourceRow?.text.includes(text)?sourceRow.speaker:null;
  return serialized(async()=>{
    const notes=(await chrome.storage.local.get('dyd_notes')).dyd_notes||[];
    if(notes.length>=1000)throw new Error('已保存 1000 条笔记，请导出并整理后继续。');
    const note=namedNote({id:crypto.randomUUID(),videoId:m.videoId,videoTitle:cached?.title||m.videoTitle||'抖音视频',text,transcriptRevision:cached?.transcriptRevision||'legacy',...(segments.length?{segments}:{}),
      seconds,...(speaker?{speaker}:{}),timestampedUrl:DYD.link(m.videoId,seconds),createdAt:Date.now()},cached?.speakerNames||{});
    notes.unshift(note);await chrome.storage.local.set({dyd_notes:notes});return {success:true,note};
  });
}
async function handle(m) {
  if(['identifySpeakers','resumeSpeakers','repairSpeakers'].includes(m.action))throw new Error('自动区分说话人暂未开放。已有逐字稿、姓名和笔记可继续使用。');
  if(m.videoId)DYD.canonical(m.videoId);
  switch(m.action) {
    case 'runtimeCheck':{const s=await getSettings(),state=await checkAudioRuntime(s.volcResourceId);return {success:true,protocol:'whole-resource-3',resourceId:state.resourceId,busy:!!state.active};}
    case 'page':return page(m.tabId,m.videoId,m.command,{seconds:m.seconds});
    case 'sources':return loadSources(m);
    case 'provider':{const s=await getSettings();return {success:true,provider:s.transcriptionProvider,configured:!!(s.transcriptionProvider==='volc'?s.volcApiKey:s.supadataApiKey)};}
    case 'resumeSpeakers':
    case 'identifySpeakers':return single(`transcript:${m.videoId}`,async()=>{
      const cached=await cacheGet(m.videoId);if(!cached?.transcript?.length)throw new Error('请先取得逐字稿。');
      if(m.action==='identifySpeakers'&&cached.speakerRevision>=1)return {success:true,transcript:cached.transcript,speakerNames:cached.speakerNames||{}};
      const job=(await chrome.storage.local.get(`job_${m.videoId}`))[`job_${m.videoId}`];
      if(job)return {success:true,pending:true};
      return startAudioUpload({...m,enrichSpeakers:true},await getSettings());
    });
    case 'repairSpeakers':return single(`transcript:${m.videoId}`,async()=>{
      const cached=await cacheGet(m.videoId);if(!cached?.transcript?.length)throw new Error('请先取得逐字稿。');
      if((await chrome.storage.local.get(`job_${m.videoId}`))[`job_${m.videoId}`])return {success:true,pending:true};
      if(cached.speakerRepairRevision===2)throw new Error('已完成本次改善，余下待确认内容请回听核对。');
      const key=`speaker_parts_${m.videoId}`,archive=`speaker_archive_v1_${m.videoId}`,data=await chrome.storage.local.get([key,archive]);
      const parts=data[archive]||data[key]||[],first=parts.findIndex(p=>p.rows?.length&&p.rows.filter(r=>/^s\d+$/.test(r.speaker)).length<p.rows.length*.5);
      if(first<0)throw new Error('没有需要自动补处理的分段。');
      await chrome.storage.local.set({[archive]:parts,[key]:parts.slice(0,first)});
      const result=await startAudioUpload({...m,enrichSpeakers:true},await getSettings());
      await cacheSet(m.videoId,{speakerRepairRevision:2});return result;
    });
    case 'speakerNames':{
      const cached=await cacheGet(m.videoId),ids=new Set((cached?.transcript||[]).map(r=>r.speaker));const names={};
      if(m.transcriptRevision&&(cached?.transcriptRevision||'legacy')!==m.transcriptRevision)throw new Error('逐字稿已更新，请重新打开姓名窗口。');
      for(const [id,name] of Object.entries(m.names||{}))if(ids.has(id)&&/^s\d{1,3}$/.test(id)&&typeof name==='string'&&name.trim())names[id]=name.trim().slice(0,30);
      await cacheSet(m.videoId,{speakerNames:names});
      await serialized(async()=>{
        const notes=(await chrome.storage.local.get('dyd_notes')).dyd_notes||[];
        await chrome.storage.local.set({dyd_notes:notes.map(n=>n.videoId===m.videoId&&(n.transcriptRevision||'legacy')===(cached?.transcriptRevision||'legacy')?namedNote(n,names):n)});
      });return {success:true,speakerNames:names};
    }
    case 'retranscribe':return startGeneration({...m,replace:true});
    case 'generate':return startGeneration(m);
    case 'poll':return pollGeneration(m);
    case 'resetJob':return serialized(async()=>{
      if(inFlight.has(`transcript:${m.videoId}`))throw new Error('正在提交，请等待结果。');
      const key=`job_${m.videoId}`,job=(await chrome.storage.local.get(key))[key];
      if(job?.provider==='volc-upload'||job?.whole){
        let state;try{state=await chrome.runtime.sendMessage({target:'audio',action:'audioState'});}catch{}
        if(state?.active?.videoId===m.videoId)throw new Error('音频仍在处理中，请等待完成。');
        const partKey=`${job.speakers?'speaker':'audio'}_parts_${m.videoId}`,parts=(await chrome.storage.local.get(partKey))[partKey]||[];
        // This action follows the side panel's explicit potentially-billable retry confirmation.
        await chrome.storage.local.set({[partKey]:parts.filter(p=>p.status==='success')});
      }
      await chrome.storage.local.remove(key);return {success:true,replace:!!job?.replace,speakers:!!(job?.enrichSpeakers??job?.speakers)};
    });
    case 'cache':{const job=(await chrome.storage.local.get(`job_${m.videoId}`))[`job_${m.videoId}`];return {success:true,cache:await cacheGet(m.videoId),pending:!!job,speakersPending:!!(job?.enrichSpeakers??job?.speakers)};}
    case 'view':await cacheSet(m.videoId,{scrollTop:Math.max(0,Number(m.scrollTop)||0)});return {success:true};
    case 'analyze':return single(`analysis:${m.videoId}`,async()=>{
      const cached=await cacheGet(m.videoId);if(!cached?.transcript?.length)throw new Error('请先取得逐字稿。');
      if(cached.analysis)return {success:true,analysis:cached.analysis};
      const source=cached.transcript.map((r,i)=>`[${DYD.time(r.start)}] [sourceIndex=${i}] ${r.text}`).join('\n');
      const result=await handleAnalyzeTranscript(source,cached.title,cached.channelName,cached.description,cached.duration);
      if(result.success){
        const analysisCandidate=result.analysis;
        result.analysis=DYD.anchorAnalysis(result.analysis,cached.transcript);
        await cacheSet(m.videoId,{analysis:result.analysis,analysisCandidate,analysisRevision:4});
      }return result;
    });
    case 'explain': {
      const cached=await cacheGet(m.videoId);const index=DYD.activeIndex(cached?.transcript||[],Number(m.seconds)||0);
      const context=(cached?.transcript||[]).slice(Math.max(0,index-3),index+5).map(r=>r.text).join('\n');
      return handleExplainSelection(String(m.text||'').slice(0,6000),context,cached?.title||'');
    }
    case 'saveNote':return saveNote(m);
    case 'notes':return {success:true,notes:(await chrome.storage.local.get('dyd_notes')).dyd_notes||[]};
    case 'deleteNote':return serialized(async()=>{
      const notes=(await chrome.storage.local.get('dyd_notes')).dyd_notes||[];
      await chrome.storage.local.set({dyd_notes:notes.filter(n=>n.id!==m.noteId)});return {success:true};
    });
    default:throw new Error('未知操作');
  }
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return false;
  if(m.target==='audio')return false;
  if(m.target==='background'&&sender.url===chrome.runtime.getURL('offscreen.html')&&!sender.tab){
    audioMessage(m).then(async result=>{
      if(result.complete){
        if(result.speakers){const cached=await cacheGet(m.videoId);if(!cached?.transcript?.length)throw new Error('原逐字稿已不在本机缓存，请重新读取。');
          const transcript=DYD_PARTS.annotateTranscript(cached.transcript,result.rows);
          if(!transcript.some(r=>/^s\d+$/.test(r.speaker)))throw new Error('未能可靠区分说话人，原逐字稿已保留。');
          await cacheSet(m.videoId,{transcript,speakerRevision:1});
        }else await acceptTranscript(m.videoId,result.rows,result.info,'火山语音转写');
        await chrome.storage.local.remove(`job_${m.videoId}`);
      }
      respond({success:true,...(result.rows&&!result.complete?{rows:result.rows}:{}),...(result.jobId?{jobId:result.jobId}:{}),...(result.resourceId?{resourceId:result.resourceId}:{}),...(result.protocol?{protocol:result.protocol}:{})});
    }).catch(e=>respond({success:false,error:e.message}));return true;
  }
  // Extension pages opened in a browser tab also carry sender.tab.
  // Only our two UI documents may use the privileged message handlers.
  // A DevTools-initiated call from an extension tab can omit sender.url even
  // though Chrome still supplies the real tab URL. Prefer the direct sender
  // URL when present; only fall back to the browser-owned tab URL when absent.
  const senderDocumentUrl=sender.url||sender.documentUrl||sender.tab?.url||'';
  const trustedUi=['options.html','sidepanel.html'].some(path=>senderDocumentUrl.split(/[?#]/)[0]===chrome.runtime.getURL(path));
  if(sender.tab&&!trustedUi) {
    // Page actions never expose settings, existing notes or cache, or call paid services.
    if(m.action==='openSidePanel'&&DYD.videoId(sender.tab.url)) {
      openVideoPanel(sender.tab).then(()=>respond({success:true}),()=>respond({success:false}));return true;
    }
    if(m.action==='videoChanged')void reconcileTab(sender.tab.id,sender.tab.url,sender.tab.windowId);
    if(m.action==='captureMoment'&&DYD.videoId(sender.tab.url)) {
      const videoId=DYD.videoId(sender.tab.url),tabId=sender.tab.id;
      single(`capture:${tabId}`,async()=>{
        const playback=await page(tabId,videoId,'getPlayback'),info=await page(tabId,videoId,'getVideoInfo');
        const seconds=Math.max(0,Math.floor(playback.currentTime)-3),cached=await cacheGet(videoId);
        const text=cached?.transcript?.[DYD.activeIndex(cached.transcript,seconds)]?.text||'时间点标记（尚无逐字稿）';
        await saveNote({videoId,videoTitle:info.title,seconds,text,quote:true});
        chrome.runtime.sendMessage({action:'notesChanged',videoId}).catch(()=>{});
        return {success:true};
      }).then(respond,e=>respond({success:false,error:e.message}));return true;
    }
    return false;
  }
  if(!senderDocumentUrl.startsWith(chrome.runtime.getURL('')))return false;
  handle(m).then(respond,e=>respond({success:false,error:e.name==='TimeoutError'?'服务响应超时，请稍后查询任务状态。':e.message||'操作失败，请重试。'}));
  return true;
});
