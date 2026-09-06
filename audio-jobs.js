/* Durable file-upload jobs. This module runs only in the extension service worker. */
async function ensureAudioDocument(){
 return single('audio-document',async()=>{
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
  if(!contexts.length)await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS'],justification:'自动拆分并转换当前节目的音频文件，生成带时间点的逐字稿。'});
 });
}
async function checkAudioRuntime(resourceId){
 if(!['volc.bigasr.auc','volc.seedasr.auc'].includes(resourceId))throw new Error('无效的火山识别服务。');
 await ensureAudioDocument();
 const state=await chrome.runtime.sendMessage({target:'audio',action:'audioState',resourceId});
 if(!state?.success||state.protocol!=='whole-resource-3'||state.resourceId!==resourceId)throw new Error('插件更新尚未生效，请重新加载抖音精读后再试。未开始转写。');
 return state;
}
async function startAudioUpload(m,settings){
 return single('audio-start',async()=>{
  if(!settings.volcApiKey)throw new Error('请先在设置中填写火山语音 API Key。');
  const info=await page(m.tabId,m.videoId,'getSources');
  if(info.transcript?.length&&!m.enrichSpeakers&&!m.replace)return acceptTranscript(m.videoId,info.transcript,info,'页面字幕');
  const media=DYD.mediaUrl(info.mediaUrl);
  if(!info.ready||!media)throw new Error('尚未取得音频地址，请先播放当前节目再重试。');
  if(!new URL(media).hostname.endsWith('.douyinvod.com'))throw new Error('当前音轨来源暂不支持自动读取。');
  const resourceId=settings.volcResourceId;
  const state=await checkAudioRuntime(resourceId);
  // Only this extension's media reads carry the public page referrer. No cookies or login headers.
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[1],addRules:[{id:1,priority:1,
    action:{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:'https://www.douyin.com/'},{header:'Origin',operation:'remove'}]},
    condition:{urlFilter:'||douyinvod.com/',initiatorDomains:[chrome.runtime.id],resourceTypes:['xmlhttprequest'],requestMethods:['get']}}]});
  if(state?.active)throw new Error('另一个节目正在处理，请等它完成。');
  const key=`job_${m.videoId}`,job={provider:'volc-upload',resourceId,status:'running',replace:!!m.replace,jobId:crypto.randomUUID(),startedAt:Date.now(),heartbeatAt:Date.now(),info:publicInfo(info),completed:0,whole:!m.enrichSpeakers,speakers:!!m.enrichSpeakers,enrichSpeakers:!!m.enrichSpeakers};
  await serialized(()=>chrome.storage.local.set({[key]:job}));
  try {
   const response=await chrome.runtime.sendMessage({target:'audio',action:'audioStart',protocol:'whole-resource-3',videoId:m.videoId,runId:job.jobId,resourceId:job.resourceId,mediaUrl:media,apiKey:settings.volcApiKey,speakers:job.speakers,whole:job.whole});
   if(!response?.success)throw new Error(response?.error||'音频处理未能启动。');
  }catch(e){await chrome.storage.local.set({[key]:{...job,status:'failed',error:'音频处理未能启动，请稍后重试。'}});throw e;}
  return {success:true,pending:true};
 });
}
async function pollAudioUpload(m,job){
 const record=await cacheGet(m.videoId);
 if(record?.transcript?.length&&!job.whole&&!(job.enrichSpeakers??job.speakers))return {success:true,transcript:record.transcript,source:record.source,info:publicInfo(record)};
 const stalled=Date.now()-(job.heartbeatAt||job.startedAt)>90000;
 if(job.whole)return {success:true,pending:true,failed:job.status==='failed',uncertain:job.status==='uncertain'||stalled,error:job.error,
  progress:job.stage==='prepare'?'正在准备整场上传音频，随后同时识别文字和说话人。':'正在读取完整音轨，随后同时识别文字和说话人。',
  progressDetail:{whole:true,phase:job.stage==='prepare'?'prepare':'download',preparedSeconds:job.preparedSeconds||0,downloadBytes:job.downloaded||0,totalDownloadBytes:job.totalBytes||0,
   completedParts:0,processedSeconds:0,totalSeconds:Number(job.info?.duration)||0,
   elapsedSeconds:Math.max(0,Math.floor((Date.now()-job.startedAt)/1000)),percent:null}};
 const partKey=`${job.speakers?'speaker':'audio'}_parts_${m.videoId}`;
 const parts=(await chrome.storage.local.get(partKey))[partKey]||[];
 const done=parts.filter(p=>p.status==='success');
 const processedSeconds=done.reduce((sum,p)=>sum+(Number.isFinite(p.duration)?Math.max(0,p.duration):0),0);
 const totalSeconds=Number(job.info?.duration)||0,elapsedSeconds=Math.max(0,Math.floor((Date.now()-job.startedAt)/1000))||0;
 const phase=job.stage==='upload'?'正在转写下一段':job.stage==='decode'?'正在处理音频':'正在读取音频';
 return {success:true,pending:true,failed:job.status==='failed',uncertain:job.status==='uncertain'||stalled,error:job.error,
  progress:`已完成 ${done.length} 段音频，${phase}。可以继续观看。`,
  progressDetail:{completedParts:done.length,processedSeconds,totalSeconds,elapsedSeconds,
   percent:totalSeconds>0?Math.min(99,Math.floor(processedSeconds/totalSeconds*100)):null}};
}
async function audioMessage(m){
 if(m.action==='audioPreflight'){
  if(m.protocol!=='whole-resource-3'||!['volc.bigasr.auc','volc.seedasr.auc'].includes(m.resourceId))throw new Error('插件运行模块不一致，未开始转写。');
  return {success:true,protocol:'whole-resource-3',resourceId:m.resourceId};
 }
 DYD.canonical(m.videoId);
 return serialized(async()=>{
  const key=`job_${m.videoId}`,job=(await chrome.storage.local.get(key))[key];
  const partKey=`${job?.speakers?'speaker':'audio'}_parts_${m.videoId}`,stored=await chrome.storage.local.get(partKey);
  if(!['volc-upload','volc'].includes(job?.provider)||job.jobId!==m.runId||(job.provider==='volc'&&!job.whole))throw new Error('音频任务已变更，已停止提交。');
  const parts=stored[partKey]||[];job.heartbeatAt=Date.now();
  if(m.action==='audioHeartbeat')await chrome.storage.local.set({[key]:job});
  else if(m.action==='audioProgress'){job.stage=m.stage;
   if(job.whole){if(m.stage==='prepare')job.preparedSeconds=Number.isFinite(m.processed)?Math.max(0,m.processed):0;
    else {job.downloaded=Number.isFinite(m.downloaded)?Math.max(0,m.downloaded):0;job.totalBytes=Number.isFinite(m.totalBytes)?Math.max(0,m.totalBytes):0;}}
   await chrome.storage.local.set({[key]:job});}
  else if(m.action==='audioWholePrepared'){
   if(!job.whole||job.provider!=='volc-upload'||job.submitStarted)throw new Error('整期任务已提交，不能重复提交。');
   if(!Number.isFinite(m.offset)||Math.abs(m.offset)>1||!Number.isFinite(m.duration)||m.duration<=0||m.duration>18000||!Number.isInteger(m.bytes)||m.bytes<=0||m.bytes>450000000)throw new Error('整期音轨参数不可用，未提交转写。');
   if(job.info.duration&&Math.abs(m.offset+m.duration-job.info.duration)>2)throw new Error('音轨长度与节目不一致，未提交转写。');
   // Jobs created before resource selection always used 1.0. Keep their identity
   // when recovering; later settings changes must never redirect an existing job.
   const resourceId=job.resourceId||'volc.bigasr.auc';
   if(!['volc.bigasr.auc','volc.seedasr.auc'].includes(resourceId)||m.resourceId&&m.resourceId!==resourceId)throw new Error('音频任务的识别服务不一致，未提交转写。');
   Object.assign(job,{provider:'volc',resourceId,stage:'upload',status:'submitting',submitStarted:Date.now(),submitFinished:false,audioDuration:m.duration,audioOffset:m.offset});
   await chrome.storage.local.set({[key]:job});
   return {success:true,resourceId};
  }else if(m.action==='audioWholeSubmitted'){
   if(!job.whole||!job.submitStarted)throw new Error('整期提交状态不匹配。');
   Object.assign(job,{stage:m.rejected?'failed':m.uncertain?'query':'recognize',submitFinished:true,
    submissionAccepted:m.submissionAccepted===true,notSubmitted:m.notSubmitted===true,status:m.rejected?'failed':m.uncertain?'uncertain':'running',
    httpStatus:Number.isInteger(m.httpStatus)?m.httpStatus:undefined,serviceCode:/^\d{8}$/.test(m.serviceCode||'')?m.serviceCode:undefined,
    error:m.error||'',nextPollAt:Date.now(),submitEndedAt:Date.now()});
   await chrome.storage.local.set({[key]:job});
  }
  else if(m.action==='audioBeforeUpload'){
   if(!Number.isInteger(m.index)||m.index<0||m.index>80||!Number.isFinite(m.offset)||!Number.isFinite(m.duration)||m.duration<=0||m.duration>310)throw new Error('音频分段参数无效。');
   const old=parts[m.index];
   if(old){
    if(Math.abs(old.offset-m.offset)>.001||Math.abs(old.duration-m.duration)>.1)throw new Error('音轨与之前不同，已保留原结果并停止。');
    if(old.status==='success')return {success:true,rows:old.rows};
    throw new Error('分段曾经提交但结果不确定，已停止，避免重复计费。');
   }
   if(m.index!==parts.length)throw new Error('音频分段不连续。');
   const part={offset:m.offset,duration:m.duration,jobId:crypto.randomUUID(),status:'submitting'};parts.push(part);job.stage='upload';
   await chrome.storage.local.set({[key]:job,[partKey]:parts});return {success:true,jobId:part.jobId};
  }else if(m.action==='audioPartDone'){
   const part=parts[m.index];if(!part||part.status!=='submitting')throw new Error('音频分段状态不匹配。');
   // Validate relative timestamps before saving; silent segments are handled explicitly by the service.
   if(!Array.isArray(m.rows))throw new Error('分段文字不可用。');
   if(m.rows.length)DYD_PARTS.merge([{offset:0,duration:part.duration,rows:m.rows}]);
   part.rows=m.rows;part.status='success';job.completed=parts.filter(p=>p.status==='success').length;
   await chrome.storage.local.set({[key]:job,[partKey]:parts});
  }else if(m.action==='audioFailed'){
   job.status=m.uncertain?'uncertain':'failed';job.error=String(m.error||'音频处理未完成。').slice(0,200);
   await chrome.storage.local.set({[key]:job});
  }else if(m.action==='audioComplete'){
   if(!parts.length||parts.some(p=>p.status!=='success'))throw new Error('尚有音频未完成，未保存整期结果。');
   const end=parts.at(-1).offset+parts.at(-1).duration;
   if(job.info.duration&&Math.abs(end-job.info.duration)>2)throw new Error('音频长度与节目不一致，未保存整期结果。');
   // Outside the storage queue: acceptTranscript serializes its own write.
   return {success:true,complete:true,rows:DYD_PARTS.merge(parts),info:job.info,speakers:job.enrichSpeakers??job.speakers};
  }else throw new Error('未知音频操作。');
  return {success:true};
 });
}
