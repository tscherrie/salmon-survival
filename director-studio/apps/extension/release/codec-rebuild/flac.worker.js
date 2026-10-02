let module;
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'init') {
      module = await self.createFlacModule();
      self.postMessage({type:'ready'});
      return;
    }
    const f = (name, args) => module.cwrap(name,'number',args);
    const init=f('init_encoder',['number','number','number']);
    const input=f('get_encode_input_ptr',['number','number']);
    const send=f('send_samples',['number','number']);
    const output=f('get_output_data',['number']);
    const count=f('get_frame_count',['number']);
    const size=f('get_frame_size',['number','number']);
    const finish=f('finish_encoder',['number']);
    const headerData=f('get_header_data',['number']);
    const headerSize=f('get_header_size',['number']);
    const ctx=init(2,48000,24);
    if (!ctx) throw new Error('Encoder init failed');
    const header=module.HEAPU8.slice(headerData(ctx),headerData(ctx)+headerSize(ctx));
    const samples=new Int32Array(data.frames*2);
    for(let i=0;i<data.frames;i++) {
      samples[i*2]=Math.round(Math.sin(i*2*Math.PI*440/48000)*0.7*8388607)*256;
      samples[i*2+1]=Math.round(Math.sin(i*2*Math.PI*880/48000)*0.4*8388607)*256;
    }
    const chunks=[header];
    function collect() {
      let total=0; for(let i=0;i<count(ctx);i++)total+=size(ctx,i);
      if(total)chunks.push(module.HEAPU8.slice(output(ctx),output(ctx)+total));
    }
    let encodedChunks=0;
    for(let offset=0;offset<data.frames;offset+=4096) {
      const frames=Math.min(4096,data.frames-offset),ptr=input(ctx,frames*2*4);
      new Int32Array(module.HEAPU8.buffer,ptr,frames*2).set(samples.subarray(offset*2,(offset+frames)*2));
      if(send(ctx,frames)!==0)throw new Error('Encode failed');
      collect();encodedChunks++;
      self.postMessage({type:'progress',encodedChunks});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(finish(ctx)!==0)throw new Error('Flush failed');
    collect();
    const bytes=new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.length,0));
    let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    self.postMessage({type:'complete',bytes:bytes.buffer,pcm:samples.buffer,encodedChunks},[bytes.buffer,samples.buffer]);
  } catch(error) {self.postMessage({type:'error',error:String(error?.stack??error)});}
};
