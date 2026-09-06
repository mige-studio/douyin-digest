var DYD_PARTS=(()=>{
 function merge(parts){
  const rows=[];let previousEnd=0;
  for(const part of parts){
   if(!Number.isFinite(part.offset)||!Number.isFinite(part.duration)||part.duration<=0||part.offset< -1||Math.abs(part.offset-previousEnd)>1)throw new Error('音频分段时间不连续，未保存整期逐字稿。');
   for(const r of part.rows){
    if(typeof r.text!=='string'||!r.text.trim()||!Number.isFinite(r.start)||!Number.isFinite(r.duration)||r.start<0||r.duration<=0||r.start+r.duration>part.duration+1)throw new Error('分段逐字稿时间超出音频范围。');
    const start=Math.max(0,r.start+part.offset),end=Math.max(0,r.start+r.duration+part.offset);
    if(end>start)rows.push({text:r.text,start,duration:end-start,...(typeof r.speaker==='string'?{speaker:r.speaker}:{}),...(typeof r.localSpeaker==='string'?{localSpeaker:r.localSpeaker}:{})});
   }
   previousEnd=part.offset+part.duration;
  }
  if(!rows.length||rows.length>20000)throw new Error('未取得完整、有效的逐字稿。');
  return rows.sort((a,b)=>a.start-b.start);
 }
 const overlap=(a,b)=>Math.max(0,Math.min(a.start+a.duration,b.start+b.duration)-Math.max(a.start,b.start));
 function annotateTranscript(original,identified){
 return original.map(r=>{
  const votes=new Map();let coverage=0;
  for(const s of identified){const n=overlap(r,s);if(n){coverage+=n;votes.set(s.speaker||'unknown',(votes.get(s.speaker||'unknown')||0)+n);}}
  const ranked=[...votes].sort((a,b)=>b[1]-a[1]),best=ranked[0];
  return {...r,speaker:best&&coverage>=r.duration*.6&&best[1]>=coverage*.85?best[0]:'unknown'};
 });
}

 return {merge,annotateTranscript};
})();
globalThis.DYD_PARTS=DYD_PARTS;
if(typeof module!=='undefined')module.exports=DYD_PARTS;
