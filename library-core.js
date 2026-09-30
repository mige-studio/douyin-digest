/* Content-only adapter shared by the two reading libraries. Never persist settings. */
var READING_LIBRARY = (() => {
  const text = v => typeof v === 'string' ? v : '';
  const list = v => Array.isArray(v) ? v : [];
  const seconds = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
  const time = v => {v=Math.floor(seconds(v));return Math.floor(v/60)+':'+String(v%60).padStart(2,'0');};
  const validId = (id,c) => typeof id==='string' && new RegExp(c.idPattern).test(id);
  const url = (id,c,t=0) => c.videoBase+encodeURIComponent(id)+(t?c.timeParam+Math.floor(seconds(t)):'');
  const filename = v => (text(v).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,' ').replace(/[. ]+$/g,'').trim().slice(0,60)||'未命名资料').replace(/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i,'资料-$1');
  const voice = v => /^(s\d{1,3}|u\d{1,3}_\d{1,3}|unknown)$/.test(text(v)) ? v : '';
  function attribution(r,names={}){
    const speaker=voice(r.speaker),grouped=/^s\d+$/.test(speaker);
    const speakerName=text(r.speakerName)||(grouped?text(names[speaker]):'')||
      (grouped?'说话人 '+speaker.slice(1):speaker?'说话人待确认':'');
    return {speaker,speakerName,speakerStatus:/待确认|未确认/.test(speakerName)||speaker&&!grouped?'unconfirmed':!speaker?'unavailable':'grouped'};
  }
  function recognition(raw){
    if(raw?.method!=='whole-recording')return null;
    const opts=raw.speakerOptions;
    return {method:'whole-recording',jobId:/^[\w-]{1,200}$/.test(text(raw.jobId))?raw.jobId:'',
      resourceId:['volc.bigasr.auc','volc.seedasr.auc'].includes(raw.resourceId)?raw.resourceId:'',
      audioDuration:seconds(raw.audioDuration),returnedDuration:seconds(raw.returnedDuration),
      speakerOptions:opts?.ssd_version==='200'&&[0,1].includes(opts.ssd_mode)?{ssd_version:'200',ssd_mode:opts.ssd_mode}:null,
      voiceMapping:list(raw.voiceMapping).filter(x=>/^\d{1,3}$/.test(text(x.serviceVoice))&&voice(x.speaker)).map(x=>({serviceVoice:x.serviceVoice,speaker:x.speaker})),
      windows:list(raw.windows).map(x=>({start:seconds(x.start),segments:seconds(x.segments),missing:seconds(x.missing),unresolved:seconds(x.unresolved),unsupported:seconds(x.unsupported),
        voices:Object.fromEntries(Object.entries(x.voices||{}).filter(([k,v])=>/^\d{1,3}$/.test(k)&&Number.isInteger(v)&&v>=0))}))};
  }
  function normalize(id,raw,notes,c,previous) {
    if(!validId(id,c))return null;
    raw=raw&&typeof raw==='object'?raw:null;
    const own=list(notes).filter(n=>n?.videoId===id);
    const title=text(raw?.videoTitleZh)||text(raw?.title)||text(raw?.videoTitle)||text(previous?.title)||text(own[0]?.videoTitle)||'未命名视频';
    const names=raw?.speakerNames||{};
    const rows=raw?list(raw.transcript).filter(r=>text(r?.text)).map(r=>({
      start:seconds(r.start),duration:seconds(r.duration),text:r.text,...attribution(r,names)
    })):list(previous?.transcript).map(r=>({...r,...attribution(r)}));
    const translations=raw?Object.entries(raw.paragraphCache||{}).flatMap(([k,v])=>{
      const m=k.startsWith(id+':zh:semantic:')&&k.match(/:segment-(\d+)-(\d+)$/);
      return m&&text(v)?[{index:Number(m[1]),start:Number(m[2])/1000,text:v}]:[];
    }).sort((a,b)=>a.index-b.index):list(previous?.translations);
    const a=raw?raw.analysis:previous?.overview;
    const overview={
      chapters:list(a?.chapters).map(x=>({title:text(x.title),summary:text(x.summary),start:seconds(x.start??x.timestampSeconds)})),
      keyQuotes:list(a?.keyQuotes).map(x=>({text:text(x.text)||text(x.quote),start:seconds(x.start??x.timestampSeconds)}))
    };
    return {id,title,author:text(raw?.channelName)||text(previous?.author)||text(own[0]?.channelName),
      updatedAt:Math.max(Number(raw?.updatedAt||raw?.timestamp)||0,Number(previous?.updatedAt)||0,...own.map(n=>Number(n.createdAt)||0)),
      transcript:rows,translations,overview,duration:seconds(raw?.duration??previous?.duration),
      transcriptRevision:text(raw?.transcriptRevision)||text(previous?.transcriptRevision)||'legacy',
      source:text(raw?.source)||text(previous?.source),recognition:raw?recognition(raw.recognition):recognition(previous?.recognition),
      notes:own.map(n=>{
        const revision=text(n.transcriptRevision)||'legacy';
        const noteNames=revision===(text(raw?.transcriptRevision)||'legacy')?names:{};
        return {id:text(n.id),text:text(n.text)||text(n.rawText),start:seconds(n.seconds??n.timestampSeconds),...attribution(n,noteNames),createdAt:Number(n.createdAt)||0,
          transcriptRevision:revision,kind:n.kind==='personal'?'personal':n.kind==='quote'||list(n.segments).length||n.speaker?'quote':'unspecified',
          segments:list(n.segments).map(s=>({start:seconds(s.start),duration:seconds(s.duration),text:text(s.text),...attribution(s,noteNames)}))};
      }),
      sourceUrl:url(id,c)};
  }
  function collect(data,previous,c){
    const old=new Map(list(previous).map(x=>[x.id,x])),ids=new Set(old.keys()),notes=list(data[c.notesKey]);
    for(const key of Object.keys(data))if(key.startsWith('digest_')&&validId(key.slice(7),c))ids.add(key.slice(7));
    for(const n of notes)if(n&&validId(n.videoId,c))ids.add(n.videoId);
    return [...ids].map(id=>normalize(id,data['digest_'+id],notes,c,old.get(id))).filter(Boolean);
  }
  function documents(r,c){
    const header='# '+r.title+'\n\n'+(r.author?'作者：'+r.author+'\n\n':'')+'来源：'+url(r.id,c)+'\n\n'+
      (r.duration?'节目时长：'+time(r.duration)+'\n\n':'')+'逐字稿版本：'+(r.transcriptRevision||'legacy')+'\n\n'+(r.source?'获取方式：'+r.source+'\n\n':'');
    const lines=rows=>rows.map(x=>'['+time(x.start)+']('+url(r.id,c,x.start)+')'+
      (x.speakerName?' '+x.speakerName:'')+(x.speaker?' · 声音 '+x.speaker:'')+
      (x.speakerStatus==='unconfirmed'?' · 归属待确认':'')+'\n'+x.text).join('\n\n');
    const docs=[];
    if(r.transcript.length){
      const pending=r.transcript.filter(x=>x.speakerStatus==='unconfirmed').length;
      const missing=r.transcript.filter(x=>!x.speaker).length;
      const warning='共 '+r.transcript.length+' 段原话；归属待确认 '+pending+' 段；未保留声音编号 '+missing+' 段。姓名为本期填写或原资料保留的映射，不代表逐段听辨通过。待确认内容不得归给具体人物。\n\n';
      const a=r.recognition;
      const evidence=a?'\n\n## 识别出处\n\n整期一次识别；任务：'+a.jobId+'；服务：'+a.resourceId+'；音轨 '+time(a.audioDuration)+'；返回音频 '+time(a.returnedDuration)+'。\n\n'+
        (a.speakerOptions?'分人版本：'+a.speakerOptions.ssd_version+'；长音频模式：'+a.speakerOptions.ssd_mode+'。':'原任务未记录分人参数，不能据此推断使用了哪种模式。')+'\n\n'+
        a.voiceMapping.map(x=>'声音 '+x.speaker+' 对应服务编号 '+x.serviceVoice).join('\n')+'\n\n'+
        a.windows.map(x=>'['+time(x.start)+'] '+x.segments+' 段；服务未返回编号 '+x.missing+' 段；服务返回未归属标记 '+x.unresolved+' 段；编号格式不支持 '+x.unsupported+' 段；服务声音分布 '+JSON.stringify(x.voices)).join('\n')+'\n':'\n\n识别出处未记录：本资料不能单独证明音轨已重新识别或跨段声音已对齐。\n';
      docs.push({name:'逐字稿',text:header+warning+'## 原文\n\n'+lines(r.transcript)+'\n'+evidence});
    }
    if(r.translations.length)docs.push({name:'中文译文（已完成部分）',text:header+'仅包含此前已翻译并保存的段落；未重新翻译，不保证覆盖全文。\n\n'+lines(r.translations)+'\n'});
    if(r.overview.chapters.length||r.overview.keyQuotes.length)docs.push({name:'内容概览',text:header+
      r.overview.chapters.map(x=>'## ['+time(x.start)+'] '+x.title+'\n\n'+x.summary).join('\n\n')+
      '\n\n'+r.overview.keyQuotes.map(x=>'['+time(x.start)+'] '+x.text).join('\n\n')+'\n'});
    if(r.notes.length)docs.push({name:'我的笔记',text:header+r.notes.map(n=>
      '## '+(n.kind==='personal'?'个人笔记':n.kind==='quote'?'原话摘录':'既有笔记（类型未记录）')+'\n\n'+
      '笔记来源版本：'+(n.transcriptRevision||'legacy')+'\n\n'+(n.segments?.length?lines(n.segments):lines([n]))).join('\n\n')+'\n'});
    return docs;
  }
  return {text,list,seconds,time,filename,validId,url,normalize,collect,documents};
})();
if(typeof module!=='undefined')module.exports=READING_LIBRARY;
