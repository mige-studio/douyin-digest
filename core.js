/* Platform/data boundaries. MIT, see LICENSE. No page HTML is trusted. */
var DYD = (() => {
  function videoId(url) {
    try {
      const u = new URL(url);
      if(u.protocol!=='https:'||u.hostname!=='www.douyin.com'||u.username||u.password)return '';
      const modal=u.searchParams.getAll('modal_id');
      if(modal.length)return modal.length===1&&/^\d{15,22}$/.test(modal[0])?modal[0]:'';
      return u.pathname.match(/^\/video\/(\d{15,22})\/?$/)?.[1]||'';
    } catch { return ''; }
  }
  function canonical(id) {
    if (!/^\d{15,22}$/.test(String(id))) throw new Error('无效的视频编号');
    return `https://www.douyin.com/video/${id}`;
  }
  function link(id, seconds = 0) { return `${canonical(id)}?dyd_t=${Math.max(0, Math.floor(Number(seconds) || 0))}`; }
  function time(n) { n = Math.max(0, Math.floor(Number(n) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }
  function mediaUrl(raw) {
    try {
      const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
      const allowed = ['douyinvod.com', 'douyin.com', 'bytecdn.cn', 'byteimg.com', 'bytedance.com', 'byteicdn.com', 'ibytedtos.com', 'snssdk.com'];
      return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
        allowed.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u.href : '';
    } catch { return ''; }
  }
  function normalize(rows, milliseconds = false) {
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 20000).map(r => {
      const start = Number(milliseconds ? r?.offset : r?.start) / (milliseconds ? 1000 : 1);
      const duration = Number(r?.duration || 0) / (milliseconds ? 1000 : 1);
      const text = typeof r?.text === 'string' ? r.text.replace(/<[^>]*>/g, '').trim().slice(0, 6000) : '';
      return text && Number.isFinite(start) && start >= 0 && start < 86400 && Number.isFinite(duration) && duration >= 0
        ? {text, start, duration: Math.min(duration, 86400),...(typeof r.speaker==='string'&&/^(s\d{1,3}|u\d{1,3}_\d{1,3}|unknown)$/.test(r.speaker)?{speaker:r.speaker}:{})} : null;
    }).filter(Boolean).sort((a,b) => a.start-b.start);
  }
  function transcriptText(rows) { return rows.map(r => `[${time(r.start)}] ${r.text}`).join('\n'); }
  // Some speech services return Chinese tokens, not sentences. Group for reading without rewriting words.
  function readable(rows) {
    if(rows.length<8 || rows.filter(r=>r.text.length<=10&&r.duration<=1.5).length/rows.length<0.6)return rows;
    const out=[];
    for(const row of rows) {
      const text=row.text.replace(/(?<=[\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu,'');
      const prev=out.at(-1);
      if(prev && row.start-prev.start<8 && row.start-(prev.start+prev.duration)<1 && prev.text.length<65 && !/[。！？!?]$/.test(prev.text)) {
        const spacer=/[a-z0-9]$/i.test(prev.text)&&/^[a-z0-9]/i.test(text)?' ':'';
        prev.text+=spacer+text;prev.duration=Math.max(prev.duration,row.start+row.duration-prev.start);
      } else out.push({...row,text});
    }
    return out;
  }
  // Matching the exact ID before reading metadata prevents recommendation cards contaminating the current video.
  function findVideo(root, id) {
    const queue = [root]; const seen = new Set(); let count = 0;
    while (queue.length && count++ < 25000) {
      const x = queue.shift();
      if (!x || typeof x !== 'object' || seen.has(x)) continue;
      seen.add(x);
      if (String(x.aweme_id || x.awemeId || '') === id && x.video) return x;
      for (const v of Object.values(x)) if (v && typeof v === 'object') queue.push(v);
    }
    return null;
  }
  function metadata(item) {
    if (!item) return null;
    const video = item.video || {};
    const candidates = [...(video.play_addr?.url_list || []), ...(video.playAddr?.urlList || []),
      ...(video.bit_rate || []).flatMap(x => x.play_addr?.url_list || [])];
    return {title: String(item.desc || '').slice(0, 1000), channelName: String(item.author?.nickname || '').slice(0, 300),
      description: String(item.desc || '').slice(0, 4000), duration: Number(video.duration || 0)/1000,
      mediaUrl: candidates.map(mediaUrl).find(Boolean) || ''};
  }
  function matches(rows, query) {
    const q = query.trim().toLocaleLowerCase(); if (!q) return [];
    const out = [];
    rows.forEach((r, index) => {
      const t = r.text.toLocaleLowerCase(); let from = 0, offset;
      while ((offset = t.indexOf(q, from)) !== -1) { out.push({index, offset, length:q.length}); from = offset+q.length; }
    });
    return out;
  }
  function activeIndex(rows, seconds) {
    let lo=0, hi=rows.length-1, answer=-1;
    while(lo<=hi) { const mid=(lo+hi)>>1; if(rows[mid].start<=seconds) {answer=mid;lo=mid+1;} else hi=mid-1; }
    return answer;
  }
  function anchorAnalysis(analysis,rows) {
    const anchor=t=>{const i=activeIndex(rows,t+0.999999);return i>=0&&t-Math.floor(rows[i].start)<=10?Math.floor(rows[i].start):null;};
    const compact=s=>String(s).replace(/[\s\p{P}]/gu,'');
    const texts=rows.map(r=>compact(r.text)),full=texts.join('');
    const locate=phrase=>{
      const text=compact(phrase||''),offset=text.length>=6?full.indexOf(text):-1;if(offset<0)return null;
      let size=0,i=0;while(i<texts.length-1&&size+texts[i].length<=offset)size+=texts[i++].length;
      return Math.floor(rows[i].start);
    };
    const chapters=analysis.chapters.flatMap(c=>{
      let t=locate(c.sourceText);
      if(t===null&&Number.isInteger(c.sourceIndex)&&rows[c.sourceIndex])t=Math.floor(rows[c.sourceIndex].start);
      return t===null?[]:[{...c,timestampSeconds:t,timestamp:time(t)}];
    }).sort((a,b)=>a.timestampSeconds-b.timestampSeconds);
    const keyQuotes=analysis.keyQuotes.flatMap(q=>{
      const t=locate(q.sourceText)??locate(q.quote);return t===null?[]:[{...q,timestampSeconds:t,timestamp:time(t)}];
    });
    return {...analysis,chapters,keyQuotes,keyMoments:analysis.keyMoments.map(anchor).filter(t=>t!==null)};
  }
  return {videoId,canonical,link,time,mediaUrl,normalize,readable,transcriptText,findVideo,metadata,matches,activeIndex,anchorAnalysis};
})();
if (typeof module !== 'undefined') module.exports = DYD;
