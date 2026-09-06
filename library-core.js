/* Content-only adapter shared by the two reading libraries. Never persist settings. */
var READING_LIBRARY = (() => {
  const text = v => typeof v === 'string' ? v : '';
  const list = v => Array.isArray(v) ? v : [];
  const seconds = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
  const time = v => {v=Math.floor(seconds(v));return Math.floor(v/60)+':'+String(v%60).padStart(2,'0');};
  const validId = (id,c) => typeof id==='string' && new RegExp(c.idPattern).test(id);
  const url = (id,c,t=0) => c.videoBase+encodeURIComponent(id)+(t?c.timeParam+Math.floor(seconds(t)):'');
  const filename = v => (text(v).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,' ').replace(/[. ]+$/g,'').trim().slice(0,60)||'未命名资料').replace(/^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i,'资料-$1');
  function normalize(id,raw,notes,c,previous) {
    if(!validId(id,c))return null;
    raw=raw&&typeof raw==='object'?raw:null;
    const own=list(notes).filter(n=>n?.videoId===id);
    const title=text(raw?.videoTitleZh)||text(raw?.title)||text(raw?.videoTitle)||text(previous?.title)||text(own[0]?.videoTitle)||'未命名视频';
    const names=raw?.speakerNames||{};
    const rows=raw?list(raw.transcript).filter(r=>text(r?.text)).map(r=>({
      start:seconds(r.start),text:r.text,
      speakerName:text(r.speakerName)||text(names[r.speaker])||(/^s\d+$/.test(r.speaker)?'说话人 '+r.speaker.slice(1):'')
    })):list(previous?.transcript);
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
      transcript:rows,translations,overview,
      notes:own.map(n=>({id:text(n.id),text:text(n.text)||text(n.rawText),start:seconds(n.seconds??n.timestampSeconds),speakerName:text(n.speakerName),createdAt:Number(n.createdAt)||0,
        segments:list(n.segments).map(s=>({start:seconds(s.start),text:text(s.text),speakerName:text(s.speakerName)||text(names[s.speaker])||(/^s\d+$/.test(s.speaker)?'说话人 '+s.speaker.slice(1):'')}))})),
      sourceUrl:url(id,c)};
  }
  function collect(data,previous,c){
    const old=new Map(list(previous).map(x=>[x.id,x])),ids=new Set(old.keys()),notes=list(data[c.notesKey]);
    for(const key of Object.keys(data))if(key.startsWith('digest_')&&validId(key.slice(7),c))ids.add(key.slice(7));
    for(const n of notes)if(n&&validId(n.videoId,c))ids.add(n.videoId);
    return [...ids].map(id=>normalize(id,data['digest_'+id],notes,c,old.get(id))).filter(Boolean);
  }
  function documents(r,c){
    const header='# '+r.title+'\n\n'+(r.author?'作者：'+r.author+'\n\n':'')+'来源：'+url(r.id,c)+'\n\n';
    const lines=rows=>rows.map(x=>'['+time(x.start)+']'+(x.speakerName?' '+x.speakerName:'')+'\n'+x.text).join('\n\n');
    const docs=[];
    if(r.transcript.length)docs.push({name:'逐字稿',text:header+'## 原文\n\n'+lines(r.transcript)+'\n'});
    if(r.translations.length)docs.push({name:'中文译文（已完成部分）',text:header+'仅包含此前已翻译并保存的段落；未重新翻译，不保证覆盖全文。\n\n'+lines(r.translations)+'\n'});
    if(r.overview.chapters.length||r.overview.keyQuotes.length)docs.push({name:'内容概览',text:header+
      r.overview.chapters.map(x=>'## ['+time(x.start)+'] '+x.title+'\n\n'+x.summary).join('\n\n')+
      '\n\n'+r.overview.keyQuotes.map(x=>'['+time(x.start)+'] '+x.text).join('\n\n')+'\n'});
    if(r.notes.length)docs.push({name:'我的笔记',text:header+r.notes.map(n=>n.segments?.length?lines(n.segments):lines([n])).join('\n\n')+'\n'});
    return docs;
  }
  return {text,list,seconds,time,filename,validId,url,normalize,collect,documents};
})();
if(typeof module!=='undefined')module.exports=READING_LIBRARY;
