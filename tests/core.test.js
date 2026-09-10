const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../core.js'),S=require('../settings.js');
const id='7494934930196155667';
test('only public desktop detail routes are accepted, preserving long IDs as strings',()=>{
 assert.equal(D.videoId(`https://www.douyin.com/video/${id}?foo=bar`),id);
 for(const url of [`https://evil.com/video/${id}`,`https://www.douyin.com.evil.com/video/${id}`,`http://www.douyin.com/video/${id}`,'https://www.douyin.com/user/abc','https://live.douyin.com/123','https://v.douyin.com/abc/'])assert.equal(D.videoId(url),'');
 assert.equal(D.videoId(D.link(id,65)),id);assert.throws(()=>D.canonical('javascript:alert(1)'));
});
test('external media cannot redirect submission to arbitrary URLs',()=>{
 assert.ok(D.mediaUrl('https://v3.douyinvod.com/media?token=opaque'));
 for(const u of ['blob:https://www.douyin.com/1','http://v3.douyinvod.com/a','https://douyinvod.com.evil.com/a','https://user:pass@v3.douyinvod.com/a','https://127.0.0.1/a','https://v3.douyinvod.com:8443/a'])assert.equal(D.mediaUrl(u),'');
});
test('caption normalization rejects invalid timestamps and keeps subsecond precision',()=>{
 assert.deepEqual(D.normalize([{text:'<b>你好</b>',offset:1250,duration:750}],true),[{text:'你好',start:1.25,duration:.75}]);
 assert.equal(D.normalize([{text:'a',start:-1},{text:'b',start:Infinity},{text:'c'},{text:'d',start:2,duration:-1}]).length,0);
 assert.equal(D.transcriptText([{text:'你好',start:65}]),'[1:05] 你好');
});
test('metadata must match current video ID, not recommendation card',()=>{
 const root={recommendations:[{aweme_id:'7339830617644829991',desc:'错视频',video:{}}],current:{aweme_id:id,desc:'正确视频',author:{nickname:'作者'},statistics:{digg_count:2373,comment_count:31,collect_count:1060,share_count:450},video:{duration:5000,play_addr:{url_list:['https://v3.douyinvod.com/a']}}}};
 assert.equal(D.metadata(D.findVideo(root,id)).title,'正确视频');assert.equal(D.metadata(D.findVideo(root,id)).duration,5);
 assert.deepEqual(D.metadata(D.findVideo(root,id)).engagement,{likes:2373,comments:31,favorites:1060,shares:450});
 assert.equal(D.findVideo(root,'7668339746930788179'),null);
});
test('engagement accepts both Douyin field styles and rejects unsafe counts',()=>{
 assert.deepEqual(D.engagement({statistics:{diggCount:'2373',commentCount:31,collectCount:1060,shareCount:450}}),{likes:2373,comments:31,favorites:1060,shares:450});
 assert.equal(D.engagement({statistics:{diggCount:-1,commentCount:'not-a-number'}}),null);
});
test('Chinese search finds every occurrence, including repeated terms',()=>{
 assert.deepEqual(D.matches([{text:'中文中文'},{text:'读中文'}],'中文'),[{index:0,offset:0,length:2},{index:0,offset:2,length:2},{index:1,offset:1,length:2}]);
 assert.deepEqual(D.matches([{text:'abc'}],''),[]);
});
test('playback boundaries return correct transcript segment',()=>{
 const rows=[{start:1},{start:3},{start:8}];assert.equal(D.activeIndex(rows,0),-1);assert.equal(D.activeIndex(rows,3),1);assert.equal(D.activeIndex(rows,99),2);assert.equal(D.activeIndex([],2),-1);
});
test('settings cannot send keys to a changed endpoint',()=>{
 const settings=S.normalize({aiBaseUrl:'https://evil.com',aiModel:'evil',aiApiKey:' value ',supadataApiKey:' test '});
 assert.equal(settings.aiBaseUrl,'https://api.deepseek.com');assert.equal(settings.aiApiKey,'value');assert.equal(S.STORAGE_KEY,'dyd_settings');
});

test('modal video routes preserve active ID and reject ambiguous parameters',()=>{
 for(const route of ['/','/user/abc','/search/program'])assert.equal(D.videoId('https://www.douyin.com'+route+'?modal_id='+id),id);
 assert.equal(D.videoId('https://www.douyin.com/user/abc?modal_id=abc'),'');
 assert.equal(D.videoId('https://www.douyin.com/?modal_id='+id+'&modal_id='+id),'');
});
