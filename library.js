/* Reading and explicit file export only. No service requests. */
(async()=>{
  const C=READING_CONFIG,L=READING_LIBRARY,D=READING_DB,$=id=>document.getElementById(id);
  let records=[],selected='',folder=null,busy=false,limit=50,exportsById={},loadToken=0;
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const status=t=>{$('status').textContent=t;};
  function folderLabel(){ $('folderName').textContent=folder?'保存位置：'+folder.name+' / '+C.label+' / 视频标题（'+(busy?'正在保存':'点击保存后写入')+'）':'尚未选择文件夹 · 资料目前保存在这个浏览器中'; }
  function buttons(){for(const id of ['chooseFolder','refresh','saveAll'])$(id).disabled=busy||(id==='saveAll'&&!records.length);document.querySelectorAll('[data-save]').forEach(b=>b.disabled=busy);folderLabel();}
  async function choose(){
    if(!window.showDirectoryPicker)throw new Error('此浏览器不能选择文件夹，请使用当前Chrome，或在单篇资料中点击“下载一份”。');
    const picked=await window.showDirectoryPicker({id:'reading-library',mode:'readwrite',startIn:'documents'});
    await D.set('folder',picked);folder=picked;folderLabel();status('文件夹已记住。点击“保存全部资料”或单篇“保存到本机”后，才会生成文件。');
  }
  async function permission(){
    if(!folder)await choose();
    const opts={mode:'readwrite'};
    if(await folder.queryPermission(opts)!=='granted'&&await folder.requestPermission(opts)!=='granted')throw new Error('尚未获得写入许可；没有保存文件。可以重新选择资料文件夹。');
  }
  function failure(e){if(e?.name==='AbortError')status('已取消，原资料和文件没有改动。');else status(L.text(e?.message)||'操作未完成，请重试。');}
  async function save(items){
    if(busy||!items.length)return;
    busy=true;buttons();let completed=0;
    try{
      await permission();
      const run=()=>READING_FILES.save(folder,items,C,async result=>{
        completed++;exportsById[result.id]={...result,rootName:folder.name,rootHandle:folder,savedAt:Date.now()};
        await D.set('exports',exportsById);status('已保存 '+completed+' / '+items.length+' 篇…');
      });
      const result=navigator.locks?await navigator.locks.request('reading-library-export',run):await run();
      status('已保存 '+result.saved.length+' 篇，新增 '+result.written+' 个文件。位置：'+folder.name+' / '+C.label+' / 视频标题。');renderDetail();
    }catch(e){failure(e);if(completed)status($('status').textContent+'\n已有 '+completed+' 篇保存完成；可再次保存，内容相同不会重复生成。');}
    finally{busy=false;buttons();}
  }
  function download(r,doc){
    const blob=new Blob([doc.text],{type:'text/markdown;charset=utf-8'}),href=URL.createObjectURL(blob),a=node('a');
    a.href=href;a.download=L.filename(r.title)+'-'+doc.name+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
    status('已交给Chrome下载，位置由浏览器下载设置决定；这不是保存到所选资料文件夹。');
  }
  function renderDetail(){
    const host=$('detail');host.replaceChildren();const r=records.find(x=>x.id===selected);
    if(!r){host.append(node('p','选择左侧视频，在这里阅读资料。','empty'));return;}
    host.append(node('h2',r.title),node('p',r.author||C.label,'muted'));
    const actions=node('div',undefined,'actions'),link=node('a','打开原视频');link.href=L.url(r.id,C);link.target='_blank';link.rel='noopener noreferrer';
    const saveButton=node('button','保存到本机','primary');saveButton.dataset.save='true';saveButton.disabled=busy;saveButton.onclick=()=>save([r]);actions.append(saveButton,link);host.append(actions);
    const tabs=node('div',undefined,'tabs'),body=node('pre'),down=node('button','下载一份（浏览器下载）');
    const latest=exportsById[r.id];
    if(latest){host.append(node('p','上次保存：'+latest.rootName+' / '+latest.folder+' · '+new Date(latest.savedAt).toLocaleString('zh-CN'),'saved-path'));
      if(latest.rootHandle){const fileList=node('details'),summary=node('summary','查看已保存的本机文件');fileList.append(summary);
        for(const filename of latest.files){const b=node('button',filename);b.onclick=async()=>{try{
          const handle=latest.rootHandle,opts={mode:'read'};
          if(await handle.queryPermission(opts)!=='granted'&&await handle.requestPermission(opts)!=='granted')throw new Error('尚未获得读取许可，请重新选择资料文件夹。');
          let dir=handle;for(const part of latest.folder.split('/'))dir=await dir.getDirectoryHandle(part);
          const file=await (await dir.getFileHandle(filename)).getFile();if(file.size>20*1024*1024)throw new Error('文件较大，请在本机打开阅读。');
          const content=await file.text();body.textContent=content;for(const tab of tabs.children)tab.setAttribute('aria-pressed','false');
          down.disabled=true;status('正在查看本机文件：'+filename+'，不是浏览器缓存。');
        }catch(e){status('本机文件暂时无法读取，可能已移动或需要重新授权。原资料仍可阅读。');}};fileList.append(b);}host.append(fileList);}}
    const docs=L.documents(r,C);if(!docs.length){host.append(node('p','浏览器中没有正文，可查看上次保存的本机文件。','empty'),body);return;}
    let active=docs[0];const show=d=>{active=d;const end=d.text.indexOf('\n\n',d.text.indexOf('来源：'));body.textContent=d.text.slice(end+2).replace(/^## 原文\n\n/,'').replace(/^#{1,3} /gm,'');down.disabled=false;for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.textContent===d.name));};
    for(const d of docs){const b=node('button',d.name);b.onclick=()=>show(d);tabs.append(b);}
    down.onclick=()=>download(r,active);host.append(tabs,body,down);show(active);
  }
  function renderList(){
    const query=$('search').value.trim().toLocaleLowerCase(),found=records.filter(r=>(r.title+' '+r.author).toLocaleLowerCase().includes(query));
    if(!found.some(r=>r.id===selected)){selected=found[0]?.id||'';renderDetail();}
    $('count').textContent=found.length+' 篇';$('list').replaceChildren();
    for(const r of found.slice(0,limit)){
      const b=node('button',undefined,'item');b.setAttribute('aria-pressed',String(selected===r.id));b.append(node('h3',r.title));
      b.append(node('p',(r.author||C.label)+(r.updatedAt?' · '+new Date(r.updatedAt).toLocaleDateString('zh-CN'):'日期未知'),'muted'));
      b.append(node('p',[r.transcript.length?'逐字稿':'',r.translations.length?'中文译文':'',r.overview.chapters.length||r.overview.keyQuotes.length?'概览':'',r.notes.length?r.notes.length+' 条笔记':''].filter(Boolean).join(' · '),'muted'));
      b.onclick=()=>{selected=r.id;renderList();renderDetail();};$('list').append(b);
    }
    if(!found.length)$('list').append(node('p',query?'没有找到匹配资料。':'还没有资料。正常精读视频或保存笔记后，再回来查看。','empty'));
    $('more').hidden=found.length<=limit;
  }
  async function refresh(){
    const token=++loadToken;
    try{
      await D.capture(chrome.storage.local,C);
      const result=await D.all(),savedFolder=await D.get('folder'),savedExports=await D.get('exports');if(token!==loadToken)return;
      folder=savedFolder||null;exportsById=savedExports||{};
      records=result.sort((a,b)=>b.updatedAt-a.updatedAt);if(!records.some(r=>r.id===selected))selected=records[0]?.id||'';
      renderList();renderDetail();buttons();
    }catch(e){status('资料读取或归档未完成；原来的逐字稿和笔记没有改动。请重试。');}
  }
  document.title=C.label+'精读 · 我的资料';$('platform').textContent=C.label+'精读';
  $('chooseFolder').onclick=()=>choose().catch(failure);$('saveAll').onclick=()=>save(records.slice());
  $('refresh').onclick=()=>{status('正在读取已有资料…');refresh().then(()=>{if($('status').textContent==='正在读取已有资料…')status('列表已更新。');});};
  $('search').oninput=()=>{limit=50;renderList();};$('more').onclick=()=>{limit+=50;renderList();};
  try{folder=await D.get('folder')||null;exportsById=await D.get('exports')||{};}catch{status('保存位置未能恢复，请重新选择资料文件夹。');}
  folderLabel();await refresh();
  let timer;chrome.storage.onChanged?.addListener((changes,area)=>{
    if(area==='local'&&Object.keys(changes).some(k=>k.startsWith('digest_')||k===C.notesKey)){clearTimeout(timer);timer=setTimeout(()=>refresh(),300);}
  });
})();
