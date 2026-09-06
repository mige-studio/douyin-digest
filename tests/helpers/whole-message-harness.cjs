/* Isolated Chrome-message integration harness. No network is used unless the
 * caller explicitly supplies fetcher. Production workers and ASR transport run
 * unchanged; only Chrome, page/media access and optional codecs are supplied. */
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'../..');

async function createWholeMessageHarness(options={}){
 const videoId=options.videoId||'7632145100964957449',tabId=1,extensionId='whole-message-test';
 const extensionUrl=file=>`chrome-extension://${extensionId}/${file}`;
 const mediaUrl=options.mediaUrl||'https://v3.douyinvod.com/integration-audio';
 const store=structuredClone(options.store||{}),messages=[],requests=[],runs=[];
 store.dyd_settings={transcriptionProvider:'volc',volcResourceId:options.resourceId||'volc.seedasr.auc',volcApiKey:options.apiKey||'test-only',...store.dyd_settings};
 let backgroundListener,offscreenListener;
 const importModule=file=>import(pathToFileURL(path.join(root,file)).href);
 const [chunks,compact,speakers]=await Promise.all([importModule('audio-chunks.mjs'),importModule('audio-compact.mjs'),importModule('speaker-audio.mjs')]);
 const event=()=>({addListener:()=>{}});
 const local={
  setAccessLevel:async()=>{},
  get:async keys=>keys===null?structuredClone(store):Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(store[key])])),
  set:async values=>{Object.assign(store,structuredClone(values));},
  remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete store[key];}
 };
 function dispatch(listener,message,sender){
  return new Promise((resolve,reject)=>{
   let replied=false,timer;
   const respond=value=>{replied=true;clearTimeout(timer);resolve(structuredClone(value));};
   try{
    const deferred=listener(structuredClone(message),sender,respond);
    if(deferred!==true&&!replied)resolve(undefined);
    else if(!replied)timer=setTimeout(()=>reject(new Error(`No runtime response: ${message.action}`)),5000);
   }catch(error){reject(error);}
  });
 }
 function recordMessage(origin,message){
  const safe=structuredClone(message);
  if(safe.apiKey)safe.apiKey='[redacted]';
  if(safe.mediaUrl)safe.mediaUrl=new URL(safe.mediaUrl).origin+'/[media]';
  messages.push({origin,...safe});
 }
 const runtime=origin=>({
  id:extensionId,getURL:extensionUrl,
  getContexts:async()=>[{contextType:'OFFSCREEN_DOCUMENT',documentUrl:extensionUrl('offscreen.html')}],
  onInstalled:event(),onStartup:event(),
  onMessage:{addListener:listener=>{if(origin==='background')backgroundListener=listener;else offscreenListener=listener;}},
  sendMessage:async message=>{
   recordMessage(origin,message);
   return origin==='background'
    ?dispatch(offscreenListener,message,{id:extensionId,url:extensionUrl('background.js')})
    :dispatch(backgroundListener,message,{id:extensionId,url:extensionUrl('offscreen.html')});
  }
 });
 const fetchFor=origin=>async(url,request={})=>{
  const target=String(url),headers={...request.headers};delete headers['X-Api-Key'];
  requests.push({origin,url:target,method:request.method||'GET',headers,body:request.body});
  if(options.mediaBytes!==undefined&&new URL(target).hostname.endsWith('.douyinvod.com'))
   return new Response(options.mediaBytes,{status:200,headers:{'Content-Length':String(options.mediaBytes.byteLength)}});
  if(!options.fetcher)throw new Error('Network is disabled in the whole-message harness. Supply an explicit fetcher.');
  return options.fetcher(target,request,{origin,store});
 };
 const globals=origin=>({URL,URLSearchParams,Blob,Response,Headers,Uint8Array,Float32Array,ArrayBuffer,DataView,
  btoa,AbortController,AbortSignal,TextEncoder,TextDecoder,crypto:webcrypto,console,setTimeout,clearTimeout,
  fetch:fetchFor(origin)});
 const background=vm.createContext({...globals('background'),chrome:{
  runtime:runtime('background'),storage:{local},
  sidePanel:{setOptions:async()=>{},open:async()=>{},setPanelBehavior:()=>{}},action:{onClicked:event()},
  offscreen:{createDocument:async()=>{}},declarativeNetRequest:{updateSessionRules:async()=>{}},
  tabs:{get:async()=>({id:tabId,url:`https://www.douyin.com/video/${videoId}`}),query:async()=>[],onUpdated:event(),onActivated:event(),
   sendMessage:async(_tabId,message)=>({success:true,ready:true,videoId,title:'双人短对话',channelName:'测试作者',duration:options.duration||30,mediaUrl,transcript:[],
    ...(typeof options.getSources==='function'?await options.getSources({tabId:_tabId,message,store}):options.getSources||{})})}
 }});
 const source=file=>{
  const original=fs.readFileSync(path.join(root,file),'utf8');
  return options.transformSource?options.transformSource(file,original):original;
 };
 background.importScripts=(...files)=>{for(const file of files)vm.runInContext(source(file),background,{filename:file});};
 background.importScripts('background.js');
 const offscreen=vm.createContext({...globals('offscreen'),...chunks,...compact,...speakers,
  ...(options.wholeAudio?{wholeAudio:options.wholeAudio}:{}),
  ...(options.compactRecording?{compactRecording:options.compactRecording}:{}),
  setInterval:()=>1,clearInterval:()=>{},chrome:{runtime:runtime('offscreen')},
  __track:promise=>{runs.push(promise);return promise;}
 });
 vm.runInContext(source('volc.js'),offscreen,{filename:'volc.js'});
 // ES module imports are supplied above; run and both message listeners are the
 // production definitions. Track completion without bypassing audioStart.
 vm.runInContext(source('offscreen.mjs').replace(/^import .*;\n/gm,'')+'\nconst originalRun=run;run=m=>__track(originalRun(m));',offscreen,{filename:'offscreen.mjs'});
 return {
  videoId,store,messages,requests,
  job:()=>structuredClone(store[`job_${videoId}`]),
  ui:(action,data={})=>dispatch(backgroundListener,{action,videoId,tabId,...data},{id:extensionId,url:extensionUrl('sidepanel.html'),tab:{id:9,url:extensionUrl('sidepanel.html')}}),
  waitForAudio:async()=>{let completed=0;while(completed<runs.length){const pending=runs.slice(completed);completed=runs.length;await Promise.all(pending);}}
 };
}

// For callers holding an already encoded short recording (WAV/Ogg). This is an
// explicit media-container boundary, not production MP4 demux/Chrome encoding.
function encodedRecording(duration){
 return async stream=>{const buffers=[];for await(const bytes of stream)buffers.push(bytes);return {offset:0,duration,buffer:new Blob(buffers)};};
}
module.exports={createWholeMessageHarness,encodedRecording};
