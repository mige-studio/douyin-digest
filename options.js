(async()=>{
  const ai=document.getElementById('aiKey'),asr=document.getElementById('asrKey'),status=document.getElementById('saved'),volc=document.getElementById('volcKey'),provider=document.getElementById('provider'),resource=document.getElementById('volcResource'),runtimeButton=document.getElementById('runtimeCheck'),runtimeStatus=document.getElementById('runtimeStatus');
  async function checkRuntime(){
    runtimeButton.disabled=true;runtimeStatus.textContent='正在检查插件后台…';
    try{
      const result=await chrome.runtime.sendMessage({action:'runtimeCheck'});
      if(!result?.success)throw new Error(result?.error||'插件后台未回应。');
      if(result.protocol!=='whole-resource-3'){runtimeStatus.textContent='本次修复尚未加载，请重新加载“抖音精读”后再检查。';return;}
      if(result.resourceId!=='volc.seedasr.auc'){runtimeStatus.textContent='插件后台已连通，但当前不是录音识别 2.0。请选择 2.0 并保存设置。';return;}
      runtimeStatus.textContent=result.busy?'本次修复已加载：录音识别 2.0，另一个节目正在处理。':'本次修复已加载：录音识别 2.0，当前空闲。';
    }catch{runtimeStatus.textContent='插件后台尚未连通。请在扩展程序页重新加载“抖音精读”，再回来检查。';}
    finally{runtimeButton.disabled=false;}
  }
  try{const result=await chrome.storage.local.get(DYD_SETTINGS.STORAGE_KEY),s=DYD_SETTINGS.normalize(result[DYD_SETTINGS.STORAGE_KEY]);ai.value=s.aiApiKey;asr.value=s.supadataApiKey;volc.value=s.volcApiKey;provider.value=s.transcriptionProvider;resource.value=s.volcResourceId;}
  catch{status.textContent='读取设置失败，请重新打开设置页。';}
  document.getElementById('settingsForm').onsubmit=async e=>{
    e.preventDefault();try{
      const settings=DYD_SETTINGS.normalize({aiApiKey:ai.value,supadataApiKey:asr.value,volcApiKey:volc.value,transcriptionProvider:provider.value,volcResourceId:resource.value});
      await chrome.storage.local.set({[DYD_SETTINGS.STORAGE_KEY]:settings});
      const stored=(await chrome.storage.local.get(DYD_SETTINGS.STORAGE_KEY))[DYD_SETTINGS.STORAGE_KEY];
      const saved=stored?.aiApiKey===settings.aiApiKey&&stored?.supadataApiKey===settings.supadataApiKey&&stored?.volcApiKey===settings.volcApiKey&&stored?.transcriptionProvider===settings.transcriptionProvider&&stored?.volcResourceId===settings.volcResourceId;
      status.textContent=saved?'设置已保存。':'保存未确认，请重试。';if(saved)await checkRuntime();
    }catch{status.textContent='保存失败，请重试。';}
  };
  document.getElementById('clearCache').onclick=async()=>{
    if(!confirm('清除本地逐字稿和概览缓存？笔记、密钥和正在转写的任务会保留。'))return;
    try{const all=await chrome.storage.local.get(null);await chrome.storage.local.remove(Object.keys(all).filter(k=>k.startsWith('digest_')));status.textContent='缓存已清除。请关闭再打开精读侧栏。';}
    catch{status.textContent='清除失败，请重试。';}
  };
  runtimeButton.onclick=checkRuntime;
  await checkRuntime();
})();
