import {audioChunks,pcmWav,mergeParts,wholeAudio} from './audio-chunks.mjs';
import {compactRecording} from './audio-compact.mjs';
import {prepareAudio,alignSpeakers,collectAnchors} from './speaker-audio.mjs';
let active=null;
async function tell(action,data={}) {
  const result=await chrome.runtime.sendMessage({target:'background',action,...data});
  if(!result?.success)throw new Error(result?.error||'无法保存处理进度。');return result;
}
async function run(m) {
  const heartbeat=setInterval(()=>tell('audioHeartbeat',{videoId:m.videoId,runId:m.runId}).catch(()=>{}),20000);
  let stage='download';
  try {
    const u=new URL(m.mediaUrl);
    if(u.protocol!=='https:'||!u.hostname.endsWith('.douyinvod.com')||u.username||u.password||u.port)throw new Error('当前音频来源暂不支持自动读取。');
    const response=await fetch(u.href,{headers:{Range:'bytes=0-'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(4*60*60*1000)});
    if(!response.ok||!response.body)throw new Error(`抖音音频下载失败（${response.status}），请刷新节目后再试。`);
    const reader=response.body.getReader();let downloaded=0,lastProgress=0;
    const totalBytes=Number(response.headers.get('Content-Length'))||0;
    async function* stream(){try{while(true){const r=await reader.read();if(r.done)break;downloaded+=r.value.length;
      if(m.whole&&Date.now()-lastProgress>1500){lastProgress=Date.now();await tell('audioProgress',{videoId:m.videoId,runId:m.runId,stage:'download',downloaded,totalBytes});}
      yield r.value;}}finally{await reader.cancel().catch(()=>{});}}
    if(m.whole){
      let audio=await wholeAudio(stream());
      if(audio.buffer.size>16000000){
        stage='prepare';let notified=0;
        audio=await compactRecording(audio,async(processed,total)=>{if(Date.now()-notified>1500){notified=Date.now();await tell('audioProgress',{videoId:m.videoId,runId:m.runId,stage:'prepare',processed,total});}});
      }
      const checkpoint=await tell('audioWholePrepared',{videoId:m.videoId,runId:m.runId,resourceId:m.resourceId,offset:audio.offset,duration:audio.duration,bytes:audio.buffer.size});
      stage='upload';let rejection;
      try {await DYD_VOLC.request('submit',m.apiKey,{jobId:m.runId,resourceId:checkpoint.resourceId,whole:true},audio.buffer);}
      catch(e){rejection=e;}
      // The same request can succeed after the submit response times out.
      // Persist queryability even on network uncertainty; never submit again.
      await tell('audioWholeSubmitted',{videoId:m.videoId,runId:m.runId,
        ...DYD_VOLC.submitOutcome(rejection)});
      return;
    }
    const parts=[],anchors=[];
    for await(const chunk of audioChunks(stream())){
      stage='decode';await tell('audioProgress',{videoId:m.videoId,runId:m.runId,stage,index:chunk.index});
      const context=new OfflineAudioContext(1,1,16000);
      const audio=await context.decodeAudioData(await chunk.buffer.arrayBuffer());
      if(Math.abs(audio.duration-chunk.duration)>.1)throw new Error('音频解码后的时长不一致，已停止以避免时间轴偏移。');
      const pcm=new Float32Array(audio.length);for(let c=0;c<audio.numberOfChannels;c++){const samples=audio.getChannelData(c);for(let i=0;i<pcm.length;i++)pcm[i]+=samples[i]/audio.numberOfChannels;}
      const plan=m.speakers?prepareAudio(pcm,anchors):{audio:pcm};
      const wav=pcmWav([plan.audio],audio.sampleRate);
      const checkpoint=await tell('audioBeforeUpload',{videoId:m.videoId,runId:m.runId,index:chunk.index,offset:chunk.offset,duration:audio.duration});
      let rows=checkpoint.rows;
      if(!rows){
        stage='upload';
        const result=await DYD_VOLC.flash(m.apiKey,checkpoint.jobId,wav,fetch,!!m.speakers);
        rows=result.transcript;
        if(m.speakers){
          if(rows.length&&!rows.some(r=>r.localSpeaker))throw new Error('火山未返回说话人信息，原逐字稿已保留。');
          rows=alignSpeakers(rows,plan,chunk.index,anchors);
        }
        await tell('audioPartDone',{videoId:m.videoId,runId:m.runId,index:chunk.index,rows});
      }
      if(m.speakers)collectAnchors(rows,pcm,anchors);
      parts.push({offset:chunk.offset,duration:audio.duration,rows});stage='download';
    }
    await tell('audioComplete',{videoId:m.videoId,runId:m.runId,rows:mergeParts(parts)});
  } catch(e) {
    // Never echo a network exception containing the signed URL or credential.
    const safe=e.serviceCode?`火山未完成转写（${e.serviceCode}）。`:e.name==='TimeoutError'?'服务等待超时，已保留进度。':/^(音频|音轨|分段|未取得|没有|当前|无法|抖音|火山)/.test(e.message)?e.message:'处理意外中断，已保留成功部分。';
    await tell('audioFailed',{videoId:m.videoId,runId:m.runId,uncertain:stage==='upload'&&!e.serviceCode,error:safe}).catch(()=>{});
  } finally {clearInterval(heartbeat);active=null;m.apiKey='';m.mediaUrl='';}
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('background.js')||m.target!=='audio')return false;
  if(m.action==='audioState'){
    if(m.resourceId===undefined){respond({success:true,protocol:'whole-resource-3',active});return false;}
    if(!['volc.bigasr.auc','volc.seedasr.auc'].includes(m.resourceId)){respond({success:false,error:'无效的火山识别服务。'});return false;}
    // Exercise the same offscreen-to-background reply bridge used before upload,
    // without audio, credentials, a persisted job or any ASR request.
    tell('audioPreflight',{protocol:'whole-resource-3',resourceId:m.resourceId}).then(result=>{
      if(result.protocol!=='whole-resource-3'||result.resourceId!==m.resourceId)throw new Error('插件运行模块不一致，未开始转写。');
      respond({success:true,protocol:'whole-resource-3',resourceId:result.resourceId,active});
    }).catch(()=>respond({success:false,error:'插件运行模块不一致，请重新加载抖音精读。未开始转写。'}));
    return true;
  }
  if(m.action!=='audioStart')return false;
  if(m.protocol!=='whole-resource-3'||!['volc.bigasr.auc','volc.seedasr.auc'].includes(m.resourceId)){
    respond({success:false,error:'插件更新尚未生效，请重新加载抖音精读后再试。未开始转写。'});return false;
  }
  if(active){respond({success:false,error:'另一个节目正在生成逐字稿，请等它完成。'});return false;}
  active={videoId:m.videoId,runId:m.runId};respond({success:true});void run(m);return false;
});
