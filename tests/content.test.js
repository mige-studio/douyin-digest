const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const id='7494934930196155667',other='7339830617644829991';
function harness(){
 let listener;const videos=[{src:'https://v3.douyinvod.com/main',currentSrc:'https://v3.douyinvod.com/main',duration:90,currentTime:3,paused:true,readyState:4,textTracks:[],getBoundingClientRect:()=>({width:400,height:600,bottom:700,right:500,top:100,left:100})},
 {src:'https://v3.douyinvod.com/recommendation',duration:20,currentTime:0,paused:false,readyState:4,textTracks:[],getBoundingClientRect:()=>({width:120,height:130,bottom:300,right:600,top:170,left:480})}];
 const nodes=[];const node=()=>{const n={style:{setProperty(){}},isConnected:true,attachShadow:()=>({append(){}}),append(){},remove(){this.isConnected=false;}};nodes.push(n);return n;};
 const location={href:`https://www.douyin.com/video/${id}`};const messages=[];
 const ctx=vm.createContext({URL,Event,console,location,document:{addEventListener(){},dispatchEvent(){},title:'公开视频 - 抖音',querySelectorAll:s=>s==='video'?videos:[],querySelector:()=>null,createElement:node,documentElement:{append(){}}},innerWidth:1200,innerHeight:900,getComputedStyle:()=>({visibility:'visible'}),setInterval:()=>{},window:{addEventListener(){}},chrome:{runtime:{onMessage:{addListener:fn=>listener=fn},sendMessage:async m=>{messages.push(m);}}}});
 for(const file of ['core.js','content.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
 return {ctx,videos,location,messages,nodes,call:(action,data={})=>{let result;listener({action,...data},{},r=>result=r);return result;}};
}
test('largest visible detail player wins over playing recommendation preview',()=>{const h=harness();assert.equal(h.call('getPlayback').currentTime,3);});
test('seek only changes current player, bounds it to video duration',()=>{const h=harness();assert.equal(h.call('seek',{seconds:900,expectedVideoId:id}).success,true);assert.equal(h.videos[0].currentTime,90);assert.equal(h.videos[1].currentTime,0);});
test('late seek cannot affect video after SPA navigation',()=>{const h=harness();h.location.href=`https://www.douyin.com/video/${other}`;assert.equal(h.call('seek',{seconds:12,expectedVideoId:id}).success,false);assert.equal(h.videos[0].currentTime,3);});
test('old player source is withheld during route transition',()=>{
 const h=harness();h.location.href=`https://www.douyin.com/video/${other}`;assert.equal(h.call('getVideoInfo',{expectedVideoId:other}).ready,false);
 h.videos[0].currentSrc='https://v3.douyinvod.com/new';assert.equal(h.call('getVideoInfo',{expectedVideoId:other}).ready,true);
});
test('Chinese native tracks expose timestamped cues without changing visible captions',()=>{
 const h=harness();const track={kind:'captions',language:'zh-CN',mode:'disabled',cues:[{text:'逐字稿内容',startTime:1.25,endTime:2.5}]};h.videos[0].textTracks=[track];
 const r=h.call('getSources');assert.equal(r.transcript[0].start,1.25);assert.equal(r.transcript[0].text,'逐字稿内容');assert.equal(track.mode,'hidden');
});
test('timestamp links seek once when metadata is ready',()=>{const h=harness();h.location.href=`https://www.douyin.com/video/${other}?dyd_t=22`;h.call('getVideoInfo');h.videos[0].currentSrc='https://v3.douyinvod.com/new';h.call('getVideoInfo');assert.equal(h.videos[0].currentTime,22);});
test('non-detail routes stop supplying player content',()=>{const h=harness();h.location.href='https://www.douyin.com/';assert.equal(h.call('getSources').success,false);});
test('reloading the extension does not leave an old page repeatedly throwing context errors',()=>{
 const h=harness();h.ctx.chrome.runtime.sendMessage=()=>{throw new Error('Extension context invalidated.');};
 h.location.href=`https://www.douyin.com/video/${other}`;
 assert.doesNotThrow(()=>h.call('getSources',{expectedVideoId:other}));
});

test('new source already loaded before SPA reconciliation does not hide the entry indefinitely',()=>{
 const h=harness();h.videos[0].currentSrc='https://v3.douyinvod.com/already-new';
 h.location.href=`https://www.douyin.com/user/author/search/query?modal_id=${other}&type=general`;
 const r=h.call('getSources',{expectedVideoId:other});assert.equal(r.ready,true);assert.equal(r.videoId,other);
 assert.equal(h.nodes.find(n=>n.id==='douyin-digest-entry').style.display,'block');
 assert.equal(h.call('seek',{seconds:22,expectedVideoId:other}).success,true);
});
test('closing and reopening a search modal restores the entry even with the same media source',()=>{
 const h=harness();h.location.href='https://www.douyin.com/search/query';h.call('getSources');
 h.location.href=`https://www.douyin.com/search/query?modal_id=${id}`;
 assert.equal(h.call('getSources',{expectedVideoId:id}).ready,true);
 assert.equal(h.nodes.filter(n=>n.id==='douyin-digest-entry').at(-1).style.display,'block');
});
