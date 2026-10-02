(async()=>{
 let port,serial=0;const pending=new Map();
 const started=new Promise(resolve=>window.addEventListener('message',event=>{if(event.data?.type==='connect'&&event.ports[0]){port=event.ports[0];port.onmessage=({data})=>{const row=pending.get(data.id);if(!row)return;pending.delete(data.id);data.error?row.reject(new Error(data.error)):row.resolve({bytes:new Uint8Array(data.bytes),mime:data.mime});};resolve();}},{once:true}));
 parent.postMessage({type:'fixture-ready'},'*');await started;
 const send=(type,data,transfers=[])=>port.postMessage({type,...data},transfers);
 try{
  const m=window.codecMedia,c=window.codecCore;
  // The candidate manifest intentionally supplies both UMD and ESM variants.
  // This also exercises configureMediaRuntime's compatibility contract when
  // the product has separate default classic/module WASM manifests.
  m.configureMediaRuntime({wasmURL:'/runtime/ffmpeg/ffmpeg-core.wasm.json'});
  m.configureBrowserRuntime((path,signal)=>new Promise((resolve,reject)=>{
   if(signal?.aborted){reject(new DOMException('aborted','AbortError'));return;}
   const id=++serial;const aborted=()=>{pending.delete(id);reject(new DOMException('aborted','AbortError'));};
   pending.set(id,{resolve:file=>{signal?.removeEventListener('abort',aborted);resolve(file);},reject:error=>{signal?.removeEventListener('abort',aborted);reject(error);}});
   signal?.addEventListener('abort',aborted,{once:true});send('runtime',{id,path});
  }));
  const checked=(condition,message)=>{if(!condition)throw new Error(message);};
  const output=async(filename,blob)=>{const bytes=await blob.arrayBuffer(),id=++serial;await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});send('output',{id,filename,bytes,mime:blob.type},[bytes]);});};
  const runtimeInventory=[];
  const collectInventory=async ff=>{
   const required={codecs:['h264','vp9','opus','png','aac','mp3','flac','pcm_s16le'],encoders:['libx264','libvpx-vp9','libopus','aac','libmp3lame','flac','pcm_s16le'],decoders:['h264','vp9','opus','png','aac','mp3','flac','pcm_s16le'],formats:['wav','flac','mp3','mp4','mov','webm','image2'],filters:['amix','afade','volume','atempo','loudnorm']};
   for(const name of ['version','codecs','encoders','decoders','formats','filters']){
    const logs=[],callback=event=>logs.push({type:event.type,message:event.message});let exitCode;
    ff.on('log',callback);try{exitCode=await ff.exec(name==='version'?['-version']:['-hide_banner','-'+name]);}finally{ff.off('log',callback);}
    const text=logs.map(event=>event.message).join('\n')+'\n',lines=text.split(/\r?\n/);
    const marker=name==='version'?/ffmpeg version/i:name==='formats'?/File formats:/i:new RegExp(name+':','i');
    const pattern=name==='formats'?/^\s*([D ][E ])\s+([a-z0-9_,\-]+)\s+(.+)$/:name==='filters'?/^\s*([TSC.]{3})\s+([a-z0-9_\-]+)\s+(\S+->\S+)\s+(.+)$/:/^\s*([A-Z.]{6})\s+([a-z0-9_\-]+)\s+(.+)$/;
    const entries=name==='version'?[]:lines.map(line=>{const match=line.match(pattern);return match?{flags:match[1],name:match[2],detail:match.slice(3).join(' ')}:null;}).filter(Boolean);
    const names=new Set(entries.flatMap(entry=>entry.name.split(',')));
    const listingValidated=marker.test(text)&&(name==='version'||entries.length>0),missingRequired=(required[name]??[]).filter(feature=>!names.has(feature));
    const textFile='core-'+name+'.txt';runtimeInventory.push({command:'-'+name,exitCode,listingValidated,nonzeroExitAcceptedWithValidatedListing:exitCode!==0&&listingValidated,missingRequired,textFile,entries,logs});
    await output(textFile,new Blob([text],{type:'text/plain'}));
    checked(listingValidated,'Core -'+name+' inventory missing despite exit '+exitCode);
    checked(!missingRequired.length,'Core -'+name+' inventory missing required feature: '+missingRequired.join(', '));
   }
  };
  const rate=48000,music=Float32Array.from({length:rate*2},(_,i)=>Math.sin(i/rate*2*Math.PI*330)*.15),voice=Float32Array.from({length:rate},(_,i)=>i<rate*.6?Math.sin(i/rate*2*Math.PI*440)*.2:0);
  const wav=m.encodeWav([music,music],rate),speech=m.encodeWav([voice,voice],rate);await output('synthetic-source.wav',wav);
  const fixture=await m.withFFmpeg(async ff=>{
   await collectInventory(ff);
   await ff.writeFile('source.wav',new Uint8Array(await wav.arrayBuffer()));
   const code=await ff.exec(['-f','lavfi','-i','testsrc2=size=160x90:rate=30','-i','source.wav','-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart','fixture.mp4']);checked(code===0,'Own x264/AAC fixture encode failed');
   const probeLogs=[],probeLogger=event=>probeLogs.push(event);ff.on('log',probeLogger);
   let probeExitCode;try{probeExitCode=await ff.ffprobe(['-v','error','-show_streams','-of','json','-o','probe.json','fixture.mp4']);}finally{ff.off('log',probeLogger);}
   const probe=JSON.parse(new TextDecoder().decode(await ff.readFile('probe.json'))),video=probe.streams.find(stream=>stream.codec_type==='video'),audio=probe.streams.find(stream=>stream.codec_type==='audio');
   checked(video?.codec_name==='h264'&&video.width===160&&video.height===90&&audio?.codec_name==='aac'&&Number(audio.sample_rate)===rate&&audio.channels===2,'Candidate WASM ffprobe metadata differs from encoded fixture');
   // The pinned binding discards _ffprobe's C return value. Its Module.ret
   // stays -1 even when ffprobe.c returns success and writes correct JSON.
   checked(probeExitCode===0||probeExitCode===-1,'Unexpected candidate WASM ffprobe return: '+probeExitCode);
   await output('wasm-ffprobe-call.json',new Blob([JSON.stringify({returnedValue:probeExitCode,validatedMetadata:true,upstreamBindingDiscardsCFunctionReturn:probeExitCode===-1,logs:probeLogs},null,2)+'\n'],{type:'application/json'}));
   await output('wasm-ffprobe.json',new Blob([JSON.stringify(probe,null,2)+'\n'],{type:'application/json'}));
   return new Blob([new Uint8Array(await ff.readFile('fixture.mp4'))],{type:'video/mp4'});
  });await output('core-inventory.json',new Blob([JSON.stringify({source:'actual candidate Core through withFFmpeg log callback',commands:runtimeInventory},null,2)+'\n'],{type:'application/json'}));await output('own-x264-aac.mp4',fixture);
  const pngCanvas=document.createElement('canvas');pngCanvas.width=160;pngCanvas.height=90;const pngContext=pngCanvas.getContext('2d');pngContext.fillStyle='#e02020';pngContext.fillRect(0,0,80,90);pngContext.fillStyle='#20a040';pngContext.fillRect(80,0,80,90);
  const png=await new Promise(resolve=>pngCanvas.toBlob(resolve,'image/png'));checked(png,'Synthetic PNG encode failed');
  const webmImport=await m.withFFmpeg(async ff=>{
   let stage='controlled-webm-input-read';const logs=[],logger=event=>logs.push(event);ff.on('log',logger);
   try{
   const input=await m.readRuntimeFile('/runtime/fixtures/input-vp9-opus.webm');const webm=new Blob([new Uint8Array(input.bytes)],{type:'video/webm'});
   await ff.writeFile('fixture.webm',new Uint8Array(input.bytes));
   stage='webm-import-to-h264-aac';
   checked(await ff.exec(['-i','fixture.webm','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart','imported.mp4'])===0,'Imported VP9/Opus WebM to H264/AAC failed');
   const mp4=new Blob([new Uint8Array(await ff.readFile('imported.mp4'))],{type:'video/mp4'});
   stage='png-image2-to-h264';
   await ff.writeFile('source.png',new Uint8Array(await png.arrayBuffer()));
   checked(await ff.exec(['-f','image2','-loop','1','-framerate','30','-i','source.png','-t','2','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','png-image2.mp4'])===0,'Own PNG/image2 to libx264 MP4 failed');
   return {webm,mp4,pngMp4:new Blob([new Uint8Array(await ff.readFile('png-image2.mp4'))],{type:'video/mp4'})};
   }catch(error){await output('webm-failure.json',new Blob([JSON.stringify({stage,error:String(error),logs},null,2)+'\n'],{type:'application/json'}));throw error;}finally{ff.off('log',logger);}
  });await output('input-vp9-opus.webm',webmImport.webm);await output('imported-webm-h264-aac.mp4',webmImport.mp4);await output('own-png-image2.mp4',webmImport.pngMp4);
  const audioExports={};for(const format of ['mp3','m4a','flac']){audioExports[format]=await m.transcodeBlob(wav,format);await output('transcoded.'+format,audioExports[format]);}
  for(const format of ['mp4','mov'])await output('transcoded.'+format,await m.transcodeBlob(fixture,format));
  const timeline=c.createTimeline({fps:30,format:{id:'codec-test',width:160,height:90},durationFrames:60});
  timeline.tracks[0].clips.push({id:'source-video',assetId:'video',start:0,duration:60,in:6,speed:1.25,gainDb:-4,fadeInFrames:6,fadeOutFrames:6,includeSourceAudio:true});
  timeline.tracks[3].clips.push({id:'speech',assetId:'speech',start:15,duration:30,in:0,speed:1,gainDb:-3,fadeInFrames:3,fadeOutFrames:3});
  timeline.tracks[4].duck={byTrackId:'A1',db:-12,mode:'signal'};timeline.tracks[4].clips.push({id:'music',assetId:'music',start:0,duration:60,in:0,speed:1});
  const assets={video:{id:'video',kind:'video',url:URL.createObjectURL(fixture)},music:{id:'music',kind:'audio',url:URL.createObjectURL(wav)},speech:{id:'speech',kind:'audio',url:URL.createObjectURL(speech)}};
  const mixed=await m.mixTimelineAudio(timeline,assets,{normalizeLufs:-16});await output('source-speed-fades-duck-normalized.wav',mixed);
  const loudness=await m.measureLoudness(mixed,-16);checked(loudness.integratedLufs!==null&&Math.abs(loudness.integratedLufs+16)<.8,'Measured normalization target failed');
  timeline.tracks[0].clips[0].includeSourceAudio=false;
  const duckMix=await m.mixTimelineAudio(timeline,assets,{normalizeLufs:-16});await output('signal-duck.wav',duckMix);
  const decoded=await m.decodeAudio(duckMix),pcm=decoded.getChannelData(0);
  const magnitude=(from,to,freq)=>{let re=0,im=0;for(let i=Math.floor(from*rate);i<Math.floor(to*rate);i++){re+=pcm[i]*Math.cos(i/rate*Math.PI*2*freq);im+=pcm[i]*Math.sin(i/rate*Math.PI*2*freq);}return Math.hypot(re,im)/Math.floor((to-from)*rate);};
  const initial=magnitude(.15,.35,330),ducked=magnitude(.8,1,330),released=magnitude(1.8,1.95,330);checked(20*Math.log10(ducked/initial)<-5&&released>ducked*1.5,'Signal duck/release behavior failed');
  const silent=await m.withFFmpeg(async ff=>{await ff.writeFile('source.mp4',new Uint8Array(await fixture.arrayBuffer()));checked(await ff.exec(['-i','source.mp4','-an','-c:v','copy','silent.mp4'])===0,'Silent fixture failed');return new Blob([new Uint8Array(await ff.readFile('silent.mp4'))],{type:'video/mp4'});});
  const silentTimeline=c.createTimeline({fps:30,durationFrames:30});silentTimeline.tracks[0].clips.push({id:'silent',assetId:'silent',start:0,duration:30,in:0,speed:1,includeSourceAudio:true});
  const silence=await m.mixTimelineAudio(silentTimeline,{silent:{id:'silent',kind:'video',url:URL.createObjectURL(silent)}});checked(Math.max(...(await m.decodeAudio(silence)).getChannelData(0))===0,'Video without audio stream repair failed');
  send('corrupt-next-part',{});let corruptError='';try{await m.loadWasmRuntime(new URL('/runtime/ffmpeg/ffmpeg-core.wasm.json',document.baseURI));}catch(error){corruptError=String(error);}checked(corruptError.includes('SHA-256'),'Changed chunk was not rejected before execute');
  const controller=new AbortController();let encodeTime=0,cancelled=false;
  try{await m.withFFmpeg(async ff=>{ff.on('progress',event=>{if(event.time>0&&!controller.signal.aborted){encodeTime=event.time;controller.abort();}});await ff.exec(['-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-t','60','-an','-c:v','libx264','-preset','medium','abort.mp4']);},controller.signal);}catch(error){cancelled=error.name==='AbortError';}
  checked(cancelled&&encodeTime>0,'Abort did not occur after real encoding progress');
  const recovered=await m.transcodeBlob(wav,'flac');await output('after-abort.flac',recovered);
  const runtimeLosslessDecode=await m.withFFmpeg(async ff=>{
   const results=[];let reference;
   for(const [name,blob]of [['source',wav],['transcoded',audioExports.flac],['after-abort',recovered]]){
    await ff.writeFile(name+'.input',new Uint8Array(await blob.arrayBuffer()));
    checked(await ff.exec(['-i',name+'.input','-map','0:a:0','-c:a','pcm_s16le','-f','s16le',name+'.pcm'])===0,'Core lossless PCM decode failed '+name);
    const bytes=await ff.readFile(name+'.pcm');checked(bytes instanceof Uint8Array&&bytes.length===rate*2*2*2,'Core lossless PCM frame/channel bytes failed '+name);
    if(name==='source')reference=bytes;else checked(bytes.every((value,index)=>value===reference[index]),'Core FLAC decoded PCM differs from synthetic-source.wav '+name);
    results.push({name,pcmBytes:bytes.length,frames:bytes.length/4,channels:2,sampleRate:rate,equalsSyntheticSource:name!=='source'});
   }
   const reimported=[];
   for(const format of ['mp3','m4a','flac']){
    await ff.writeFile('reimport-'+format+'.input',new Uint8Array(await audioExports[format].arrayBuffer()));
    checked(await ff.exec(['-i','reimport-'+format+'.input','-map','0:a:0','-c:a','pcm_s16le','reimport-'+format+'.wav'])===0,'Forced Core '+format+' demux/decode to WAV failed');
    const bytes=await ff.readFile('reimport-'+format+'.wav');checked(bytes instanceof Uint8Array,'Forced Core import is not binary '+format);
    const filename='reimported-'+format+'.wav';await output(filename,new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));reimported.push({sourceFormat:format,filename,forcedWithFFmpeg:true});
   }
   return {lossless:results,reimported};
  });
  let parentAccess=false;try{void parent.document;parentAccess=true;}catch{}
  send('complete',{checks:{origin:location.origin,parentAccess,strictNoUnsafeEval:true,classicBlobWorker:true,normalization:loudness,signalDuck:{initial,ducked,released,duckDb:20*Math.log10(ducked/initial)},silentVideoAudio:true,corruptedChunkRejected:corruptError,cancelledAfterActualEncodeTimeUs:encodeTime,recoveryFlac:true,vp9OpusWebmImportedToH264Aac:true,webmInputEncodedByNativeFfmpeg:true,ownCoreVp9EncodeAccepted:false,pngImage2ToH264:true,syntheticPngBytes:png.size,runtimeLosslessDecode,runtimeInventory:runtimeInventory.map(({command,exitCode,listingValidated,nonzeroExitAcceptedWithValidatedListing,textFile,entries})=>({command,exitCode,listingValidated,nonzeroExitAcceptedWithValidatedListing,textFile,entryCount:entries.length})),realNativeHostAcceptanceClaimed:false}});
 }catch(error){send('error',{error:String(error),stack:error.stack});}
})();
