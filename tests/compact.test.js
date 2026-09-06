const test=require('node:test'),assert=require('node:assert/strict');
test('Ogg packet boundaries, end granule and checksum are preserved',async()=>{
 const {oggPage}=await import('../audio-compact.mjs');
 const packets=[new Uint8Array(255).fill(3),new Uint8Array(80).fill(5)];
 const page=oggPage(packets,30000,864000312,4),view=new DataView(page.buffer);
 assert.equal(new TextDecoder().decode(page.subarray(0,4)),'OggS');assert.equal(page[5],4);
 assert.equal(view.getBigUint64(6,true),864000312n);assert.equal(view.getUint32(18,true),30000);
 assert.deepEqual([...page.subarray(27,30)],[255,0,80]);assert.equal(page.length,365);
 const saved=view.getUint32(22,true);view.setUint32(22,0,true);let crc=0;
 for(const b of page){crc^=b<<24;for(let i=0;i<8;i++)crc=(crc<<1)^((crc&0x80000000)?0x04c11db7:0);}
 assert.equal(crc>>>0,saved);assert.throws(()=>oggPage([new Uint8Array(255*256)],0,0),/过大/);
});
