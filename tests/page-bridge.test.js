const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const id='7494934930196155667';
function read(item,search=''){
  const listeners={};let result;
  const parent={__reactFiber$test:{memoizedProps:{awemeInfo:item}}};
  const video={parentElement:parent,getBoundingClientRect:()=>({width:600,height:400})};
  const document={querySelectorAll:()=>[video],addEventListener:(n,f)=>listeners[n]=f,dispatchEvent:e=>result=JSON.parse(e.detail)};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../page-bridge.js'),'utf8'),{document,location:{search,pathname:'/video/'+id,origin:'https://www.douyin.com'},URL,URLSearchParams,CustomEvent:class{constructor(n,o){this.detail=o.detail;}}});
  listeners['dyd-read-player']();return result;
}
test('public React player metadata reads src objects and prefers audio',()=>{
 const result=read({awemeId:id,desc:'真实标题',authorInfo:{nickname:'作者'},video:{duration:261248,playAddr:[{src:'https://v3.douyinvod.com/video'}],bitRateAudioList:[{urlList:[{src:'https://v3.douyinvod.com/audio'}]}]}});
 assert.equal(result.videoId,id);assert.equal(result.mediaUrl,'https://v3.douyinvod.com/audio');assert.equal(result.duration,261.248);
});
test('another video and unapproved media origins are never returned',()=>{
 assert.equal(read({awemeId:'7339830617644829991',video:{}}),null);
 assert.equal(read({awemeId:id,video:{playAddr:[{src:'https://douyinvod.com.evil.test/x'}]}}).mediaUrl,'');
});

test('modal metadata uses active modal ID instead of underlying route',()=>{assert.equal(read({awemeId:id,video:{}},'?modal_id='+id).videoId,id);assert.equal(read({awemeId:id,video:{}},'?modal_id=7680875713884458282'),null);});
