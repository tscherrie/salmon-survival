let codec;
self.onmessage = async ({data}) => {
  try {
    if(data.type==='init') {
      codec=await self.createAacModule();
      self.postMessage({type:'ready'});
      return;
    }
    const f=(name,args,ret='number')=>codec.cwrap(name,ret,args);
    const init=f('init_encoder',['number','number','number']);
    const frameSizeFn=f('get_encoder_frame_size',['number']);
    const input=f('get_encode_input_ptr',['number','number']);
    const send=f('send_frame',['number','number']);
    const receive=f('receive_packet',['number']);
    const packetData=f('get_encoded_data',['number']);
    const packetPts=f('get_encoded_pts',['number']);
    const packetDuration=f('get_encoded_duration',['number']);
    const flush=f('flush_encoder_start',['number'],null);
    const close=f('close_encoder',['number'],null);
    const ctx=init(2,48000,192000);
    if(!ctx)throw new Error('AAC encoder initialization failed');
    const frameSize=frameSizeFn(ctx);
    const samples=new Float32Array(data.frames*2);
    for(let i=0;i<data.frames;i++) {
      const t=i/48000;
      const fade=Math.min(1,i/480,(data.frames-1-i)/480);
      samples[i*2]=fade*(0.55*Math.sin(2*Math.PI*(440*t+85*t*t))+0.12*Math.sin(2*Math.PI*1370*t));
      samples[i*2+1]=fade*(0.4*Math.sin(2*Math.PI*(880*t+130*t*t))+0.1*Math.sin(2*Math.PI*2100*t));
    }
    const chunks=[],packets=[];
    function collect() {
      let size;
      while((size=receive(ctx))>0) {
        const ptr=packetData(ctx);
        const payload=codec.HEAPU8.slice(ptr,ptr+size);
        const length=size+7;
        // ADTS: MPEG-4 AAC-LC, 48 kHz, stereo, no CRC, one raw AAC frame.
        chunks.push(new Uint8Array([0xff,0xf1,(1<<6)|(3<<2),(2<<6)|(length>>11),length>>3,((length&7)<<5)|0x1f,0xfc]));
        chunks.push(payload);
        packets.push({bytes:size,pts:Number(packetPts(ctx)),duration:packetDuration(ctx)});
      }
      if(size<0)throw new Error('AAC packet receive failed: '+size);
    }
    let sentFrames=0;
    for(let offset=0;offset<data.frames;offset+=frameSize) {
      const ptr=input(ctx,frameSize*2*4);
      if(!ptr)throw new Error('AAC input allocation failed');
      const block=new Float32Array(codec.HEAPU8.buffer,ptr,frameSize*2);
      block.fill(0);
      block.set(samples.subarray(offset*2,Math.min(data.frames,offset+frameSize)*2));
      const result=send(ctx,BigInt(offset));
      if(result<0)throw new Error('AAC frame send failed: '+result);
      collect();sentFrames++;
      if(packets.length)self.postMessage({type:'progress',encodedChunks:packets.length,sentFrames});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    flush(ctx);collect();close(ctx);
    const bytes=new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.length,0));
    let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    self.postMessage({type:'complete',bytes:bytes.buffer,pcm:samples.buffer,packets,frameSize,sentFrames,encodedChunks:packets.length},[bytes.buffer,samples.buffer]);
  }catch(error){self.postMessage({type:'error',error:String(error?.stack??error)});}
};
