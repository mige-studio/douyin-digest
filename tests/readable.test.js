const test=require('node:test'),assert=require('node:assert/strict'),DYD=require('../core.js');
test('Chinese token stream becomes searchable reading passages without losing words or timing',()=>{
 const words=['你有','没有 发','现 麦','当 劳','旁 边','必 有','肯 德','基 耐'];
 const rows=words.map((text,i)=>({text,start:i*.4,duration:1.5})),merged=DYD.readable(rows);
 assert.equal(merged.length,1);assert.equal(merged[0].text,'你有没有发现麦当劳旁边必有肯德基耐');
 assert.equal(merged[0].start,0);assert.equal(merged[0].duration,4.300000000000001);assert.equal(DYD.matches(merged,'麦当劳').length,1);
 assert.equal(DYD.readable(merged),merged);
});
test('grouping respects long silence and normal sentence subtitles',()=>{
 const rows=Array.from({length:10},(_,i)=>({text:'原话',start:i<5?i*.2:20+i*.2,duration:.2}));
 assert.equal(DYD.readable(rows).length,2);
 const sentences=[{text:'这是完整的字幕句子。',start:0,duration:4}];assert.equal(DYD.readable(sentences),sentences);
});
test('analysis anchors approximate times and only keeps quotes found in the transcript',()=>{
 const rows=[{text:'第一段内容',start:0,duration:8},{text:'高尔夫球表面',start:89.4,duration:8},{text:'凹凸不平',start:97.6,duration:8}];
 const a=DYD.anchorAnalysis({chapters:[{title:'球',sourceText:'高尔夫球表面',timestampSeconds:29},{title:'错',timestampSeconds:500}],keyQuotes:[{quote:'高尔夫球表面，凹凸不平。',timestampSeconds:90},{quote:'不存在的结论',timestampSeconds:90}],keyMoments:[90]},rows);
 assert.equal(a.chapters.length,1);assert.equal(a.chapters[0].timestampSeconds,89);assert.equal(a.keyQuotes.length,1);assert.equal(a.keyQuotes[0].timestampSeconds,89);
});
