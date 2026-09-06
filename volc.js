/* Volcengine ASR transport. Keys stay in extension settings; no credential logging. */
var DYD_VOLC = (() => {
 const ROOT='https://openspeech.bytedance.com/api/v3/auc/bigmodel/';
 const localReasons={
  configuration:'插件识别版本未正确连接，请重新加载“抖音精读”。',
  credential:'请在设置中填写火山语音 API Key。',
  audio:'准备好的音频为空、过大或不可读取。',
  reading:'准备好的音频读取失败，请重新打开插件后再试。'
 };
 function localError(message,code){const error=new Error(message);error.preflightCode=code;return error;}
 function submitOutcome(error) {
  if(!error)return {rejected:false,uncertain:false,submissionAccepted:true,error:''};
  const httpStatus=Number.isInteger(error.httpStatus)?error.httpStatus:undefined;
  const serviceCode=/^\d{8}$/.test(error.serviceCode||'')?error.serviceCode:undefined;
  const notSubmitted=error.requestNotSent===true;
  const rejected=notSubmitted||!!serviceCode||[400,401,403,404,413,429].includes(httpStatus);
  const reason=notSubmitted&&Object.hasOwn(localReasons,error.preflightCode)?localReasons[error.preflightCode]:'';
  const message=notSubmitted?(reason?`音频提交前检查未通过：${reason}尚未开始上传和识别。`:'音频提交前检查未通过，尚未开始上传和识别。'):httpStatus===413?'音频上传被服务拒绝：请求文件过大（413）。':
   httpStatus===401||httpStatus===403?'火山密钥或语音服务权限不可用，请检查设置。':
   serviceCode?`火山未接受转写（${serviceCode}）。`:
   rejected?`音频上传被服务拒绝（${httpStatus}），尚未开始识别。`:'上传结果尚未确认，正在查询原任务，不会重复提交。';
  return {rejected,uncertain:!rejected,submissionAccepted:false,...(notSubmitted?{notSubmitted:true}:{}),httpStatus,serviceCode,error:message};
 }
 function base64(bytes) {
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
 }
 async function recordingBody(audio,request) {
  const isBlob=typeof Blob!=='undefined'&&audio instanceof Blob;
  const size=isBlob?audio.size:audio?.length;
  if((!isBlob&&!(audio instanceof Uint8Array))||!size||size>450000000)throw localError('整期音频文件过大或不可用，未提交转写。','audio');
  // Multiples of three avoid padding between base64 pieces. A Blob request
  // avoids holding a full binary string AND a second full JSON string in JS.
  const parts=[JSON.stringify({user:{uid:'douyin-digest'},request}).slice(0,-1)+',"audio":{"data":"'];
  for(let i=0;i<size;i+=196608){
   let chunk;
   try{chunk=isBlob?new Uint8Array(await audio.slice(i,i+196608).arrayBuffer()):audio.subarray(i,i+196608);}
   catch{throw localError('准备好的音频读取失败。','reading');}
   parts.push(new Blob([base64(chunk)]));
  }
  parts.push('"}}');return new Blob(parts,{type:'application/json'});
 }
 function rows(data,withWords=false) {
  const utterances=data?.result?.utterances;
  if(!Array.isArray(utterances)||!utterances.length)throw new Error('火山未返回带时间点的逐字稿。');
  if(utterances.length>20000)throw new Error('逐字稿过长，当前版本暂不支持。');
  return utterances.map(r=>{
   if(typeof r.text!=='string'||!r.text.trim()||!Number.isFinite(r.start_time)||!Number.isFinite(r.end_time)||r.start_time<0||r.end_time<=r.start_time||r.end_time>86400000)throw new Error('火山返回的时间点无效，未保存结果。');
   const rawSpeaker=r.additions?.speaker;
   const speaker=typeof rawSpeaker==='number'&&Number.isInteger(rawSpeaker)?String(rawSpeaker):rawSpeaker;
   return {text:r.text,start:r.start_time/1000,duration:(r.end_time-r.start_time)/1000,...(withWords&&Array.isArray(r.words)?{words:r.words.filter(w=>typeof w.text==='string'&&Number.isFinite(w.start_time)&&Number.isFinite(w.end_time)&&w.end_time>w.start_time).map(w=>({text:w.text,start:w.start_time/1000,duration:(w.end_time-w.start_time)/1000}))}:{}),...(typeof speaker==='string'&&/^\d{1,3}$/.test(speaker)?{localSpeaker:speaker}:{})};
  });
 }
 async function request(action,key,job,mediaUrl,fetcher=fetch) {
  let options;
  try {
   if(!['submit','query'].includes(action))throw new Error('无效的转写操作。');
   if(!key)throw localError('请在设置中填写火山语音 API Key。','credential');
   if(!['volc.bigasr.auc','volc.seedasr.auc'].includes(job?.resourceId))throw localError('无效的火山识别服务。','configuration');
   const headers={'Content-Type':'application/json','X-Api-Key':key,'X-Api-Resource-Id':job.resourceId,'X-Api-Request-Id':job.jobId};
   let body={},upload;
   if(action==='submit'){
    headers['X-Api-Sequence']='-1';
    let audio={url:mediaUrl};
    body={user:{uid:'douyin-digest'},audio,request:{model_name:'bigmodel',enable_punc:true,enable_itn:true,show_utterances:true,...(job.whole?{enable_speaker_info:true}:{})}};
    if(job.whole)upload=await recordingBody(mediaUrl,body.request);
   }
   options={method:'POST',headers,body:upload||JSON.stringify(body),signal:AbortSignal.timeout(job.whole&&action==='submit'?600000:25000)};
  } catch(e) {e.requestNotSent=true;throw e;}
  // Once fetch starts, a lost response cannot prove that submission failed.
  const response=await fetcher(ROOT+action,options);
  const code=response.headers.get('X-Api-Status-Code');
  if(!response.ok){const e=new Error(response.status===401||response.status===403?'火山密钥或语音服务权限不可用，请检查设置。':`火山服务暂不可用（${response.status}），请稍后查询。`);e.httpStatus=response.status;throw e;}
  if(code==='20000001'||code==='20000002')return {pending:true};
  if(code!=='20000000'){
   const missing=action==='query'&&code==='45000000'&&/cannot find task/i.test(response.headers.get('X-Api-Message')||'');
   const e=new Error(missing?'火山未找到这次任务，尚未取得转写结果。':code==='20000003'?'火山未识别到人声。':code==='45000151'?'火山无法识别这份音频格式。':code==='45000001'?'火山未接受请求，请检查音频地址与服务配置。':`火山转写未成功（${code||'未返回状态'}）。`);
   e.taskNotFound=missing;
   e.serviceCode=code;throw e;
  }
  if(action==='submit')return {pending:true};
  const text=await response.text();if(text.length>8000000)throw new Error('火山返回结果过大。');
  const data=JSON.parse(text);return {transcript:rows(data),durationMs:data.audio_info?.duration};
 }
 async function flash(key,jobId,bytes,fetcher=fetch,speakers=false) {
  if(!key||!jobId||!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>20000000)throw new Error('音频直传参数不可用。');
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  const response=await fetcher('https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash',{
   method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':key,'X-Api-Resource-Id':'volc.bigasr.auc_turbo','X-Api-Request-Id':jobId},
   body:JSON.stringify({user:{uid:'douyin-digest'},audio:{data:btoa(binary)},request:{model_name:'bigmodel',enable_punc:true,enable_itn:true,show_utterances:true,...(speakers?{enable_speaker_info:true}:{})}}),signal:AbortSignal.timeout(600000)});
  const code=response.headers.get('X-Api-Status-Code');
  if(response.ok&&code==='20000003')return {transcript:[],silent:true};
  if(!response.ok||code!=='20000000'){
   const e=new Error('火山未完成音频转写。');e.httpStatus=response.status;
   if(code&&/^\d{8}$/.test(code))e.serviceCode=code;
   throw e;
  }
  const text=await response.text();if(text.length>8000000)throw new Error('火山返回结果过大。');
  const data=JSON.parse(text);return {transcript:rows(data,speakers),durationMs:data.audio_info?.duration};
 }
 return {rows,request,flash,submitOutcome};
})();
if(typeof module!=='undefined')module.exports=DYD_VOLC;
