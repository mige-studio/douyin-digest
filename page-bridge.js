/* Public player metadata bridge. MAIN world has NO extension API or secrets. */
(() => {
  function current() {
    const modal=new URLSearchParams(location.search||'').getAll('modal_id');
    const id=modal.length?(modal.length===1&&/^\d{15,22}$/.test(modal[0])?modal[0]:''):location.pathname.match(/^\/video\/(\d{15,22})\/?$/)?.[1];
    if(!id)return null;
    const videos=[...document.querySelectorAll('video')].filter(v=>{const r=v.getBoundingClientRect();return r.width>100&&r.height>100;});
    for(const video of videos) {
      let node=video;
      for(let depth=0;node&&depth<6;depth++,node=node.parentElement) {
        const key=Object.getOwnPropertyNames(node).find(k=>k.startsWith('__reactFiber$'));
        let fiber=key?node[key]:null;
        for(let i=0;fiber&&i<18;i++,fiber=fiber.return) {
          const item=fiber.memoizedProps?.awemeInfo;
          if(String(item?.awemeId||item?.aweme_id||'')!==id)continue;
          const data=item.video||{};
          const candidates=[...(data.bitRateAudioList||[]).flatMap(x=>x.urlList||[]),...(Array.isArray(data.playAddr)?data.playAddr:[])];
          const media=candidates.map(x=>typeof x==='string'?x:x?.src).find(u=>{
            try{const p=new URL(u,location.origin);return p.protocol==='https:'&&p.hostname.endsWith('.douyinvod.com');}catch{return false;}
          })||'';
          const stats=item.statistics||item.stats||{};
          const count=(...keys)=>{for(const key of keys)if(stats[key]!==undefined&&stats[key]!==null&&stats[key]!==''){const value=Number(stats[key]);if(Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER)return Math.floor(value);}return null;};
          const engagement={likes:count('diggCount','digg_count','likeCount','like_count'),comments:count('commentCount','comment_count'),favorites:count('collectCount','collect_count','favoriteCount','favorite_count'),shares:count('shareCount','share_count')};
          return {videoId:id,title:String(item.desc||'').slice(0,1000),channelName:String(item.authorInfo?.nickname||'').slice(0,300),description:String(item.desc||'').slice(0,4000),duration:Number(data.duration||0)/1000,mediaUrl:media,...(Object.values(engagement).some(Number.isFinite)?{engagement}:{})};
        }
      }
    }
    return null;
  }
  document.addEventListener('dyd-read-player',()=>{
    try {document.dispatchEvent(new CustomEvent('dyd-player-data',{detail:JSON.stringify(current())}));}catch{}
  });
})();
