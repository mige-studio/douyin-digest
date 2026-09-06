/* References are excerpts of this video, held in memory only, never a voice identity database. */
const RATE=16000, MAX=10;
const known=id=>/^s\d+$/.test(id||'');
export function prepareAudio(pcm,anchors){
 let length=anchors.length?RATE:0;const refs=[];
 for(const a of anchors){refs.push({id:a.id,start:length/RATE,duration:a.pcm.length/RATE});length+=a.pcm.length+RATE;}
 const audio=new Float32Array(length+pcm.length);for(let i=0;i<anchors.length;i++)audio.set(anchors[i].pcm,Math.round(refs[i].start*RATE));audio.set(pcm,length);
 return {audio,refs,prefix:length/RATE};
}
const overlap=(a,b)=>Math.max(0,Math.min(a.start+a.duration,b.start+b.duration)-Math.max(a.start,b.start));
export function alignSpeakers(raw,plan,index,anchors){
 const mapping=new Map(),used=new Set();let reliable=true;
 for(const ref of plan.refs){
  const votes=new Map();for(const r of raw){if(!r.localSpeaker)continue;const n=overlap(r,ref);if(n)votes.set(r.localSpeaker,(votes.get(r.localSpeaker)||0)+n);}
  const ranked=[...votes].sort((a,b)=>b[1]-a[1]),winner=ranked[0];
  if(!winner||winner[1]<ref.duration*.65||ranked[1]?.[1]>ref.duration*.15||used.has(winner[0])){reliable=false;continue;}
  mapping.set(winner[0],ref.id);used.add(winner[0]);
 }
 // If references collide, do not guess which old person an unmatched voice belongs to.
 if(!reliable)mapping.clear();
 const main=raw.flatMap(r=>{
  if(r.start+r.duration<=plan.prefix)return [];
  if(r.start>=plan.prefix-.08)return [r];
  // A sentence may bridge the silence after a reference; retain its real words only.
  const words=(r.words||[]).filter(w=>w.start>=plan.prefix-.04);
  if(!words.length)throw new Error('分段句子跨越参照音频，无法可靠还原时间点，已停止。');
  const text=words.reduce((s,w)=>s+(/[a-z0-9]$/i.test(s)&&/^[a-z0-9]/i.test(w.text)?' ':'')+w.text,'');
  return [{...r,text,localSpeaker:undefined,start:words[0].start,duration:words.at(-1).start+words.at(-1).duration-words[0].start}];
 });
 let next=(anchors.seen||anchors.map(a=>a.id)).reduce((n,id)=>Math.max(n,Number(id.slice(1))||0),0)+1;
 for(const r of main)if(r.localSpeaker&&!mapping.has(r.localSpeaker)){
  const isolated=main.some(x=>x.localSpeaker===r.localSpeaker&&x.duration>=3&&!main.some(y=>x!==y&&y.localSpeaker!==x.localSpeaker&&overlap(x,y)>.05));
  const allKnownAnchored=(anchors.seen||[]).every(id=>anchors.some(a=>a.id===id));
  mapping.set(r.localSpeaker,reliable&&isolated&&allKnownAnchored&&next<=MAX?`s${next++}`:`u${index}_${r.localSpeaker}`);
 }
 return main.map(({words,...r})=>({...r,start:Math.max(0,r.start-plan.prefix),speaker:r.localSpeaker?mapping.get(r.localSpeaker):'unknown'}));
}
export function collectAnchors(rows,pcm,anchors){
 anchors.seen=[...new Set([...(anchors.seen||[]),...rows.map(r=>r.speaker).filter(known)])];
 for(const id of new Set(rows.map(r=>r.speaker))){
  if(!known(id)||anchors.some(a=>a.id===id)||anchors.length>=MAX)continue;
  const candidates=rows.filter(r=>r.speaker===id&&r.duration>=3&&r.start+r.duration<=pcm.length/RATE+.01&&
    !rows.some(x=>x!==r&&x.speaker!==id&&overlap(r,x)>.05)).sort((a,b)=>b.duration-a.duration);
  const r=candidates[0];if(!r)continue;
  const start=r.start+.15,end=Math.min(r.start+r.duration-.15,start+8);
  if(end-start>=2.5)anchors.push({id,pcm:pcm.slice(Math.round(start*RATE),Math.round(end*RATE))});
 }
}
