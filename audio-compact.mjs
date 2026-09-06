import {createFile} from './vendor/mp4box/mp4box.all.mjs';

// RFC 3533 / RFC 7845: one continuous Ogg Opus recording, not ASR segments.
const crcTable=Uint32Array.from({length:256},(_,n)=>{let r=n<<24;for(let i=0;i<8;i++)r=(r<<1)^((r&0x80000000)?0x04c11db7:0);return r>>>0;});
export function oggPage(packets,sequence,granule,flags=0,serial=0x44594431){
 const laces=[];for(const p of packets){let n=p.length;while(n>=255){laces.push(255);n-=255;}laces.push(n);}
 if(laces.length>255)throw new Error('音频封装页过大。');
 const out=new Uint8Array(27+laces.length+packets.reduce((n,p)=>n+p.length,0)),v=new DataView(out.buffer);
 out.set([79,103,103,83,0,flags]);v.setBigUint64(6,BigInt(granule),true);v.setUint32(14,serial,true);v.setUint32(18,sequence,true);out[26]=laces.length;out.set(laces,27);
 let at=27+laces.length;for(const p of packets){out.set(p,at);at+=p.length;}
 let crc=0;for(const b of out)crc=(crc<<8)^crcTable[((crc>>>24)^b)&255];v.setUint32(22,crc>>>0,true);return out;
}

export async function compactRecording(audio,onProgress=()=>{}){
 if(!(audio.buffer instanceof Blob)||!Number.isFinite(audio.duration)||audio.duration<=0||audio.duration>18000)throw new Error('音轨参数不支持整场上传。');
 if(typeof AudioEncoder==='undefined'||typeof AudioDecoder==='undefined')throw new Error('当前浏览器不支持长音轨压缩，请升级 Chrome 后重试。');
 const file=createFile(),queue=[],pages=[];let track,decoder,encoder,error,first,last,head,rate,frames=0,count=0,sequence=0,granule=0,outputBytes=0;
 let pending=[];
 function page(packets,g,flags=0){const bytes=oggPage(packets,sequence++,g,flags);outputBytes+=bytes.length;
  if(outputBytes>74000000)throw new Error('压缩后的整场音轨仍超过上传大小，未提交转写。');pages.push(new Blob([bytes]));}
 function output(chunk,metadata){try{
  if(!head){head=new Uint8Array(metadata.decoderConfig?.description||[]);
   if(new TextDecoder().decode(head.subarray(0,8))!=='OpusHead'||head[9]!==1)throw new Error('浏览器未返回完整的音频时间信息。');
   page([head],0,2);const tags=new Uint8Array(16);tags.set(new TextEncoder().encode('OpusTags'));page([tags],0);
  }
  // Keep the final page uncommitted so EOS can trim encoder delay/padding.
  if(chunk.duration!==20000)throw new Error('浏览器返回了不支持的音频帧时长。');
  if(pending.length===100){page(pending.splice(0,50),granule-50*960);}
  const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);pending.push(bytes);
  granule+=Math.round(chunk.duration*48000/1e6);
 }catch(e){error=e;}}
 async function drain(codec,limit){while(codec.state==='configured'&&codec.encodeQueueSize>limit||codec.state==='configured'&&codec.decodeQueueSize>limit){
  if(error)throw error;await new Promise(resolve=>setTimeout(resolve,2));
 }if(error)throw error;}
 file.onError=()=>{error=new Error('无法读取完整音轨。');};
 file.onReady=info=>{
  track=info.audioTracks?.[0];if(!track||!track.codec.startsWith('mp4a.'))throw new Error('长音轨暂不支持此格式。');
  const entry=file.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
  const description=entry.esds?.esd?.findDescriptor(4)?.findDescriptor(5)?.data;
  if(!description)throw new Error('音频编码信息不完整。');
  rate=track.audio.sample_rate;
  encoder=new AudioEncoder({output,error:e=>{error=new Error('浏览器音频压缩失败：'+e.name);}});
  encoder.configure({codec:'opus',sampleRate:rate,numberOfChannels:1,bitrate:32000,bitrateMode:'constant'});
  decoder=new AudioDecoder({error:e=>{error=new Error('浏览器音频解码失败：'+e.name);},output:data=>{try{
   if(data.sampleRate!==rate)throw new Error('音频采样率发生变化，未提交转写。');
   const mono=new Float32Array(data.numberOfFrames),plane=new Float32Array(data.numberOfFrames);
   for(let c=0;c<data.numberOfChannels;c++){data.copyTo(plane,{planeIndex:c,format:'f32-planar'});for(let i=0;i<mono.length;i++)mono[i]+=plane[i]/data.numberOfChannels;}
   const frame=new AudioData({format:'f32-planar',sampleRate:rate,numberOfChannels:1,numberOfFrames:mono.length,timestamp:Math.round(frames*1e6/rate),data:mono});
   try{encoder.encode(frame);frames+=mono.length;}finally{frame.close();}
  }catch(e){error=e;}finally{data.close();}}});
  decoder.configure({codec:track.codec,sampleRate:rate,numberOfChannels:track.audio.channel_count,description});
  file.setExtractionOptions(track.id,null,{nbSamples:128});file.start();
 };
 file.onSamples=(id,user,samples)=>queue.push({id,samples});
 async function consume(){while(queue.length){const {id,samples}=queue.shift();
  for(const s of samples){first??=s.cts;
   if(last&&Math.abs(s.cts-last.cts-last.duration)/track.timescale>.01)throw new Error('音轨时间不连续，未提交转写。');
   decoder.decode(new EncodedAudioChunk({type:'key',timestamp:Math.round((s.cts-first)*1e6/track.timescale),duration:Math.round(s.duration*1e6/track.timescale),data:s.data}));last={cts:s.cts,duration:s.duration};count++;
   if(decoder.decodeQueueSize>64||encoder.encodeQueueSize>64){await drain(decoder,16);await drain(encoder,16);}
  }
  file.releaseUsedSamples(id,samples.at(-1).number+1);await onProgress(Math.min(audio.duration,(last.cts+last.duration-first)/track.timescale),audio.duration);
 }if(error)throw error;}
 try{
  for(let at=0;at<audio.buffer.size;at+=262144){const b=await audio.buffer.slice(at,at+262144).arrayBuffer();b.fileStart=at;file.appendBuffer(b);await consume();}
  file.flush();await consume();
  if(!decoder||!count||count!==file.getTrackSamplesInfo(track.id).length)throw new Error('音轨未处理完整，未提交转写。');
  await decoder.flush();await drain(encoder,0);if(error)throw error;
  if(Math.abs(frames/rate-audio.duration)>.05)throw new Error('压缩前后音频长度不一致，未提交转写。');
  // Flush enough real encoded padding to cover Opus lookahead, then trim it in EOS.
  const tail=new AudioData({format:'f32-planar',sampleRate:rate,numberOfChannels:1,numberOfFrames:Math.ceil(rate*.1),timestamp:Math.round(frames*1e6/rate),data:new Float32Array(Math.ceil(rate*.1))});
  try{encoder.encode(tail);}finally{tail.close();}await encoder.flush();if(error)throw error;
  const preSkip=new DataView(head.buffer,head.byteOffset,head.byteLength).getUint16(10,true),end=Math.round(audio.duration*48000)+preSkip;
  const prior=granule-pending.length*960;
  if(!pending.length||end>granule||end<prior)throw new Error('压缩音轨结束时间不匹配，未提交转写。');
  page(pending,end,4);return {...audio,buffer:new Blob(pages,{type:'audio/ogg'}),encoding:'opus-32k-mono'};
 }finally{file.stop();if(decoder?.state!=='closed')decoder?.close();if(encoder?.state!=='closed')encoder?.close();}
}
