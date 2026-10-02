let codec;
self.onmessage=async({data})=>{
  try {
    if(data.type==='init'){codec=await self.createMp3Module();self.postMessage({type:'ready'});return;}
    const f=(name,args,ret='number')=>codec.cwrap(name,ret,args);
    const init=f('init_lame',['number','number','number']);
    const encode=f('encode_samples',['number','number','number','number','number','number']);
    const flush=f('flush_lame',['number','number','number']);
    const close=f('close_lame',['number'],null);
    const ctx=init(2,48000,192000);if(!ctx)throw new Error('LAME initialization failed');
    const blockSize=4096,outputSize=Math.ceil(1.25*blockSize+7200);
    const inputPtr=codec._malloc(blockSize*2*2),outputPtr=codec._malloc(outputSize);
    if(!inputPtr||!outputPtr)throw new Error('MP3 buffers allocation failed');
    const samples=new Float32Array(data.frames*2);
    const pcm=new Int16Array(data.frames*2);
    for(let i=0;i<data.frames;i++) {
      const t=i/48000,fade=Math.min(1,i/480,(data.frames-1-i)/480);
      pcm[i*2]=Math.round(fade*(0.55*Math.sin(2*Math.PI*(440*t+85*t*t))+0.12*Math.sin(2*Math.PI*1370*t))*32767);
      pcm[i*2+1]=Math.round(fade*(0.4*Math.sin(2*Math.PI*(880*t+130*t*t))+0.1*Math.sin(2*Math.PI*2100*t))*32767);
      samples[i*2]=pcm[i*2]/32768;samples[i*2+1]=pcm[i*2+1]/32768;
    }
    const chunks=[],chunkBytes=[];let sentChunks=0;
    function collect(size) {
      if(size<0)throw new Error('LAME encode failed: '+size);
      if(size){chunks.push(codec.HEAPU8.slice(outputPtr,outputPtr+size));chunkBytes.push(size);}
    }
    for(let offset=0;offset<data.frames;offset+=blockSize) {
      const frames=Math.min(blockSize,data.frames-offset);
      const planar=new Int16Array(codec.HEAPU8.buffer,inputPtr,blockSize*2);
      for(let i=0;i<frames;i++){planar[i]=pcm[(offset+i)*2];planar[blockSize+i]=pcm[(offset+i)*2+1];}
      collect(encode(ctx,inputPtr,inputPtr+blockSize*2,frames,outputPtr,outputSize));sentChunks++;
      if(chunks.length)self.postMessage({type:'progress',encodedChunks:chunks.length,sentChunks,actualOutputBytes:chunks.reduce((sum,chunk)=>sum+chunk.length,0)});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    collect(flush(ctx,outputPtr,outputSize));close(ctx);codec._free(inputPtr);codec._free(outputPtr);
    const bytes=new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.length,0));
    let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    self.postMessage({type:'complete',bytes:bytes.buffer,pcm:samples.buffer,sourceS16:pcm.buffer,encodedChunks:chunks.length,sentChunks,chunkBytes,blockSize},[bytes.buffer,samples.buffer,pcm.buffer]);
  }catch(error){self.postMessage({type:'error',error:String(error?.stack??error)});}
};
