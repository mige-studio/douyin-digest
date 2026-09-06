/* Observe saved content only; do not start video, translation, or network jobs. */
(() => {
  if(typeof indexedDB==='undefined'||!chrome.storage?.onChanged)return;
  const sync=changes=>READING_DB.capture(chrome.storage.local,READING_CONFIG,changes).catch(()=>{
    console.warn('我的资料未能归档；原有缓存和笔记未改动，请打开我的资料重试并保存到本机。');
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(changes.reading_library_reset_marker?.oldValue&&!changes.reading_library_reset_marker.newValue)return;
    if(area==='local'&&Object.keys(changes).some(k=>k.startsWith('digest_')||k===READING_CONFIG.notesKey))void sync(changes);
  });
  void sync();
})();
