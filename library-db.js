/* Private library, separate from temporary reading caches. No credentials. */
var READING_DB = (() => {
  let opened;
  function open(){
    if(!opened)opened=new Promise((resolve,reject)=>{
      const q=indexedDB.open('reading-library-v1',1);
      q.onupgradeneeded=()=>{q.result.createObjectStore('items',{keyPath:'id'});q.result.createObjectStore('meta');};
      q.onsuccess=()=>{q.result.onversionchange=()=>{q.result.close();opened=null;};resolve(q.result);};
      q.onerror=()=>{opened=null;reject(q.error);};
      q.onblocked=()=>{opened=null;reject(new Error('请关闭其他资料页后重试。'));};
    });
    return opened;
  }
  async function request(store,mode,operation){
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,mode),q=operation(tx.objectStore(store));let value;
      q.onsuccess=()=>{value=q.result;};tx.oncomplete=()=>resolve(value);
      tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('资料保存中断。'));
    });
  }
  const all=()=>request('items','readonly',s=>s.getAll());
  const get=key=>request('meta','readonly',s=>s.get(key));
  const set=(key,value)=>request('meta','readwrite',s=>s.put(value,key));
  async function clear(){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(['items','meta'],'readwrite'),meta=tx.objectStore('meta'),q=meta.get('epoch');q.onsuccess=()=>{tx.objectStore('items').clear();meta.clear();meta.put((q.result||0)+1,'epoch');};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  async function putFresh(record,capturedAt,epoch){
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction(['items','meta'],'readwrite'),s=tx.objectStore('items'),check=tx.objectStore('meta').get('epoch');
      check.onsuccess=()=>{if(epoch!==undefined&&(check.result||0)!==epoch)return;const q=s.get(record.id);
        q.onsuccess=()=>{if(!q.result||Number(q.result.capturedAt)<=capturedAt)s.put({...record,capturedAt});};};
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('资料保存中断。'));
    });
  }
  let queue=Promise.resolve();
  function capture(storage,c,changes={}){
    const epochAtRequest=get('epoch').then(value=>({value}),error=>({error}));
    const run=queue.then(async()=>{
      const state=await epochAtRequest;if(state.error)throw state.error;
      const epoch=state.value||0,data=await storage.get(null),capturedAt=Date.now(),previous=await all();
      for(const [key,change] of Object.entries(changes))if(key.startsWith('digest_')&&!data[key])data[key]=change.newValue||change.oldValue;
      const records=READING_LIBRARY.collect(data,previous,c);
      const old=new Map(previous.map(r=>[r.id,r]));
      for(const r of records){const {capturedAt:ignored,...content}=old.get(r.id)||{};if(JSON.stringify(r)!==JSON.stringify(content))await putFresh(r,capturedAt,epoch);}
      return records;
    });
    queue=run.catch(()=>{});return run;
  }
  return {all,get,set,putFresh,capture,clear};
})();
if(typeof module!=='undefined')module.exports=READING_DB;
