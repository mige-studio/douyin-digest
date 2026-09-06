/* Read only the current public detail page; never calls a third-party API. */
(() => {
  if (globalThis.__dydMounted) return;
  globalThis.__dydMounted = true;
  let currentId = '', host, metadataCache = null, lastMetadataCheck=0, initialSeek=null, previousSource='', lastKnownSource='', awaitingSourceChange=false;
  let runtimeInvalidated=false;
  function extensionMessage(message){
    if(runtimeInvalidated)return Promise.resolve(null);
    try{return Promise.resolve(chrome.runtime.sendMessage(message)).catch(()=>null);}
    catch{runtimeInvalidated=true;return Promise.resolve(null);}
  }
  function player() {
    if (!DYD.videoId(location.href)) return null;
    const list=[...document.querySelectorAll('video')].map(v=>({v,r:v.getBoundingClientRect()}))
      .filter(({v,r})=>r.width>100&&r.height>100&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&getComputedStyle(v).visibility!=='hidden')
      .sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height || Number(!b.v.paused)-Number(!a.v.paused));
    const v=list[0]?.v || null;
    const source=v?.currentSrc||v?.src||'';
    if(awaitingSourceChange){if(!source||source===previousSource)return null;awaitingSourceChange=false;}
    if(DYD.videoId(location.href)===currentId)lastKnownSource=source;
    return v;
  }
  let liveMetadata=null;
  document.addEventListener('dyd-player-data',event=>{
    try{if(typeof event.detail!=='string'||event.detail.length>24000)return;
      const d=JSON.parse(event.detail);if(!d||d.videoId!==currentId)return;
      liveMetadata={title:String(d.title||'').slice(0,1000),channelName:String(d.channelName||'').slice(0,300),description:String(d.description||'').slice(0,4000),duration:Number(d.duration)||0,mediaUrl:DYD.mediaUrl(d.mediaUrl||'')};
    }catch{}
  });
  function embedded() {
    document.dispatchEvent(new Event('dyd-read-player'));
    if(liveMetadata)return liveMetadata;
    if(metadataCache || Date.now()-lastMetadataCheck<2000) return metadataCache;
    lastMetadataCheck=Date.now();
    for(const script of document.querySelectorAll('script#RENDER_DATA,script#__NEXT_DATA__,script[type="application/json"]')) {
      const raw=script.textContent || ''; if(raw.length>5000000) continue;
      try { const item=DYD.findVideo(JSON.parse(raw.trim().startsWith('%')?decodeURIComponent(raw):raw),currentId);
        if(item) {metadataCache=DYD.metadata(item);return metadataCache;}
      } catch {}
    }
    return null;
  }
  function info() {
    const v=player(), data=embedded();
    const meta=name=>document.querySelector(`meta[property="${name}"]`)?.content || '';
    const title=data?.title || (meta('og:title') || document.title).replace(/\s*[-|]\s*抖音.*$/,'').trim();
    // Author is optional: never guess from recommendation links.
    return {videoId:currentId,title,channelName:data?.channelName||'',description:data?.description||'',
      duration:Number.isFinite(v?.duration)?v.duration:data?.duration||0,
      mediaUrl:data?.mediaUrl||DYD.mediaUrl(v?.currentSrc||v?.src||'')||'',ready:!!v};
  }
  function captions() {
    const v=player(); if(!v) return [];
    const tracks=[...(v.textTracks||[])].filter(t=>['subtitles','captions'].includes(t.kind));
    tracks.sort((a,b)=>Number(/^zh/i.test(b.language))-Number(/^zh/i.test(a.language)));
    for(const t of tracks) {
      if(t.mode==='disabled') t.mode='hidden';
      const rows=DYD.normalize([...(t.cues||[])].map(c=>({text:c.text,start:c.startTime,duration:c.endTime-c.startTime})));
      if(rows.length) return rows;
    }
    return [];
  }
  function mount() {
    if(host?.isConnected) return;
    host=document.createElement('div');host.id='douyin-digest-entry';
    const shadow=host.attachShadow({mode:'closed'});
    const style=document.createElement('style');style.textContent=':host{position:fixed;z-index:2147483646;pointer-events:none}button{position:absolute;pointer-events:auto;background:#c8674f;color:#fff;border:0;border-radius:24px;padding:10px 18px;box-shadow:0 3px 12px #35201430;font:600 14px system-ui;cursor:pointer;white-space:nowrap}button:hover{background:#b25742}button:focus-visible{outline:3px solid #fff;outline-offset:2px}.read{right:var(--read-right,0);top:var(--read-top,calc(100% + 58px))}.note{right:16px;top:16px}button:disabled{opacity:.75}';
    const button=document.createElement('button');button.className='read';button.textContent='▶ 抖音精读';button.title='打开抖音精读：逐字稿、内容概览和笔记';
    button.onclick=async()=>{const result=await extensionMessage({action:'openSidePanel'});if(!result?.success)button.textContent=runtimeInvalidated?'刷新页面后打开':'请再点一次打开';};
    const note=document.createElement('button');note.className='note';note.textContent='✎ 记笔记';note.title='保存刚才听到的内容与时间点';
    note.onclick=async()=>{
      if(note.disabled)return;note.disabled=true;note.textContent='保存中…';
      const result=await extensionMessage({action:'captureMoment'});note.textContent=result?.success?'✓ 已保存':runtimeInvalidated?'请刷新页面':result?.error||'保存失败';
      setTimeout(()=>{note.disabled=false;note.textContent='✎ 记笔记';},2400);
    };
    shadow.append(style,button,note);document.documentElement.append(host);
  }
  function positionEntry() {
    if(!host)return;
    const v=player(),r=v?.getBoundingClientRect();
    if(!r){host.style.display='none';return;}
    const inside=new URL(location.href).searchParams.has('modal_id')||r.bottom+110>innerHeight;
    host.style.setProperty('--read-top',inside?'16px':'calc(100% + 58px)');
    host.style.setProperty('--read-right',inside?'132px':'0');
    Object.assign(host.style,{display:'block',left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});
  }
  function reconcile() {
    const id=DYD.videoId(location.href);
    if(id!==currentId) {
      // Keep the source observed before navigation: the DOM may already contain the new video.
      previousSource=lastKnownSource;
      awaitingSourceChange=!!currentId&&!!id&&!!previousSource;
      currentId=id;if(!id)lastKnownSource='';metadataCache=null;liveMetadata=null;lastMetadataCheck=0;
      const value=new URL(location.href).searchParams.get('dyd_t');
      initialSeek=value!==null&&Number.isFinite(Number(value))?Math.max(0,Number(value)):null;
      void extensionMessage({action:'videoChanged',videoId:id});
    }
    if(id) {mount();positionEntry();} else {host?.remove();host=null;}
    const v=player();
    if(initialSeek!==null&&v?.readyState>=1&&Number.isFinite(v.duration)) {v.currentTime=Math.min(initialSeek,v.duration);initialSeek=null;}
  }
  chrome.runtime.onMessage.addListener((m,sender,respond)=>{
    reconcile();
    if(m.expectedVideoId && m.expectedVideoId!==currentId) {respond({success:false,error:'视频已切换，请等待侧栏更新。'});return;}
    if(!currentId) {respond({success:false,error:'请打开单条公开抖音视频详情页。'});return;}
    if(m.action==='getVideoInfo') respond({success:true,...info()});
    if(m.action==='getSources') respond({success:true,...info(),transcript:captions()});
    if(m.action==='getPlayback') {const v=player();respond({success:!!v,videoId:currentId,currentTime:v?.currentTime||0,paused:v?.paused??true});}
    if(m.action==='seek') {
      const v=player(),seconds=Number(m.seconds);
      if(!v||!Number.isFinite(seconds)||seconds<0||!Number.isFinite(v.duration)) {respond({success:false,error:'播放器尚未准备好，请先播放视频。'});return;}
      v.currentTime=Math.min(seconds,v.duration);respond({success:true});
    }
  });
  setInterval(reconcile,650);window.addEventListener('popstate',reconcile);window.addEventListener('scroll',positionEntry,true);window.addEventListener('resize',positionEntry);reconcile();
})();
