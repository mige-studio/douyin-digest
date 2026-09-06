/* User-selected output only. Never overwrite an existing, different file. */
var READING_FILES = (() => {
  async function writeUnique(dir,name,contents){
    for(let i=1;i<=1000;i++){
      const filename=name+(i===1?'':'（'+i+'）')+'.md';
      let handle;
      try {
        handle=await dir.getFileHandle(filename);
        if(await (await handle.getFile()).text()===contents)return {name:filename,written:false};
        continue;
      }catch(e){if(e.name!=='NotFoundError')throw e;}
      handle=await dir.getFileHandle(filename,{create:true});
      const stream=await handle.createWritable();
      try{await stream.write(contents);await stream.close();}
      catch(e){try{await stream.abort();}catch{}throw e;}
      return {name:filename,written:true};
    }
    throw new Error('同名副本太多，请换一个资料文件夹。');
  }
  async function save(root,records,c,onProgress=()=>{}){
    const platform=await root.getDirectoryHandle(c.label,{create:true});
    const saved=[];let written=0;
    for(const r of records){
      const docs=READING_LIBRARY.documents(r,c);if(!docs.length)continue;
      const folder=READING_LIBRARY.filename(r.title)+' ['+r.id+']';
      const dir=await platform.getDirectoryHandle(folder,{create:true}),files=[];
      for(const d of docs){const f=await writeUnique(dir,d.name,d.text);written+=Number(f.written);files.push(f.name);}
      const result={id:r.id,folder:c.label+'/'+folder,files};saved.push(result);await onProgress(result);
    }
    return {saved,written};
  }
  return {writeUnique,save};
})();
if(typeof module!=='undefined')module.exports=READING_FILES;
