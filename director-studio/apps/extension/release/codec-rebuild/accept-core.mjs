#!/usr/bin/env node
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
if(!process.argv[2]||!process.argv[3])throw new Error('Use accept-core.mjs COMPILED_CORE_DIRECTORY DEPENDENCY_ROOT');
const output=resolve(process.argv[2]),studio=resolve(process.argv[3]),baseline=process.argv[4]==='--baseline',require=createRequire(join(studio,'package.json'));
const {build}=require('esbuild'),{chromium}=require('playwright');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function verifyMediaOutputs(files,{requireWebm=true}={}){
 const expected=[['synthetic-source.wav','pcm_s16le'],['own-x264-aac.mp4','aac','h264'],['transcoded.mp3','mp3'],['transcoded.m4a','aac'],['transcoded.flac','flac'],['transcoded.mp4','aac','h264'],['transcoded.mov','aac','h264'],['source-speed-fades-duck-normalized.wav','pcm_s16le'],['signal-duck.wav','pcm_s16le'],['after-abort.flac','flac']];
 if(requireWebm)expected.push(['input-vp9-opus.webm','opus','vp9'],['imported-webm-h264-aac.mp4','aac','h264'],['own-png-image2.mp4',null,'h264'],['reimported-mp3.wav','pcm_s16le',null,1152],['reimported-m4a.wav','pcm_s16le',null,1024],['reimported-flac.wav','pcm_s16le']);
 const checks=[],decodedPcm=new Map(),expectedFrames=96000,rate=48000,channels=2;
 for(const [filename,audioCodec,videoCodec,importPaddingAllowance]of expected){
  const file=files.find(file=>file.filename===filename);if(!file)throw new Error('Missing accepted media '+filename);
  const probe=spawnSync('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',join(output,filename)],{encoding:'utf8'});
  if(probe.status!==0)throw new Error('ffprobe failed '+filename+': '+probe.stderr);
  file.ffprobe=JSON.parse(probe.stdout);
  const audio=file.ffprobe.streams.find(stream=>stream.codec_type==='audio'),video=file.ffprobe.streams.find(stream=>stream.codec_type==='video');
  if(videoCodec&&(!video||video.codec_name!==videoCodec||video.width!==160||video.height!==90||Number(video.nb_read_frames)!==60||video.avg_frame_rate!=='30/1'||Math.abs(Number(video.duration??file.ffprobe.format.duration)-2)>0.05))throw new Error('Wrong decoded video frames/format/duration '+filename);
  if(!videoCodec&&video)throw new Error('Unexpected video stream '+filename);
  if(!audioCodec){
   if(audio)throw new Error('Unexpected audio in PNG video '+filename);
   const frame=spawnSync('ffmpeg',['-v','error','-i',join(output,filename),'-map','0:v:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-'],{maxBuffer:1024*1024});
   if(frame.status!==0||frame.stderr.length||frame.stdout.length!==160*90*3)throw new Error('PNG video first-frame decode failed '+filename);
   const colors=[[40,45,[224,32,32]],[120,45,[32,160,64]]].map(([x,y,expectedRgb])=>{const offset=(y*160+x)*3,actualRgb=[...frame.stdout.subarray(offset,offset+3)];if(actualRgb.some((value,index)=>Math.abs(value-expectedRgb[index])>16))throw new Error('PNG/image2 decoded colors differ '+filename);return {x,y,expectedRgb,actualRgb};});
   checks.push({filename,videoCodec,decodedVideoFrames:Number(video.nb_read_frames),videoFrameRate:video.avg_frame_rate,width:video.width,height:video.height,firstFrameRgbSha256:hash(frame.stdout),colorSamples:colors});continue;
  }
  if(!audio||audio.codec_name!==audioCodec||Number(audio.sample_rate)!==rate||audio.channels!==channels)throw new Error('Wrong audio codec/rate/channels '+filename);
  const paddingAllowance=importPaddingAllowance??(audioCodec==='aac'?1024:audioCodec==='mp3'?1152:audioCodec==='opus'?960:0);
  const audioDuration=Number(audio.duration??file.ffprobe.format.duration);
  if(!Number.isFinite(audioDuration)||Math.abs(audioDuration-2)>(paddingAllowance?0.05:1/rate))throw new Error('Wrong audio duration '+filename+': '+audioDuration);
  const decoded=spawnSync('ffmpeg',['-v','error','-i',join(output,filename),'-map','0:a:0','-c:a','pcm_f32le','-f','f32le','-'],{maxBuffer:4*1024*1024});
  if(decoded.status!==0||decoded.stderr.length)throw new Error('Native PCM decode failed '+filename+': '+decoded.stderr);
  const pcm=decoded.stdout,frames=pcm.length/(channels*4);
  if(!Number.isSafeInteger(frames)||Math.abs(frames-expectedFrames)>paddingAllowance)throw new Error('Wrong decoded PCM frame count '+filename+': '+frames);
  const channelChecks=[];
  for(let channel=0;channel<channels;channel++){
   let squares=0,peak=0;
   for(let frame=0;frame<frames;frame++){const sample=pcm.readFloatLE((frame*channels+channel)*4);if(!Number.isFinite(sample))throw new Error('Nonfinite decoded PCM '+filename);squares+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
   const rms=Math.sqrt(squares/frames);if(rms<0.0001||peak>1)throw new Error('Empty/clipped decoded audio channel '+filename+': '+channel);
   channelChecks.push({channel,rms,peak});
  }
  decodedPcm.set(filename,pcm);
  checks.push({filename,audioCodec,videoCodec:videoCodec??null,sampleRate:rate,channels,containerAudioDurationSeconds:audioDuration,decodedAudioFrames:frames,decodedAudioDurationSeconds:frames/rate,codecPaddingFrames:frames-expectedFrames,decodedPcmFormat:'f32le',decodedPcmSha256:hash(pcm),channelChecks,...(video?{decodedVideoFrames:Number(video.nb_read_frames),videoFrameRate:video.avg_frame_rate,width:video.width,height:video.height}:{})});
 }
 const source=decodedPcm.get('synthetic-source.wav');
 for(const filename of ['transcoded.flac','after-abort.flac',...(requireWebm?['reimported-flac.wav']:[])]){
  const equals=decodedPcm.get(filename).equals(source);if(!equals)throw new Error('FLAC decoded PCM differs from synthetic-source.wav '+filename);
  checks.find(check=>check.filename===filename).decodedPcmEqualsSyntheticSource=true;
 }
 return {source:'native ffprobe/ffmpeg decoding actual browser-produced files',expectedInputFrames:expectedFrames,expectedSampleRate:rate,expectedChannels:channels,extendedFixturesRequired:requireWebm,files:checks};
}
if(process.argv.includes('--check-saved')){
 const previous=JSON.parse(await readFile(join(output,'browser-acceptance.json'),'utf8'));
 const decodedChecks=verifyMediaOutputs(previous.files,{requireWebm:previous.files.some(file=>file.filename==='input-vp9-opus.webm')});
 const result={passed:true,fixtureValidationOnly:previous.fixtureValidationOnly??false,existingBrowserReportPreserved:true,browserNotRerun:true,runtimeInventoryNotReexecuted:true,decodedChecks};
 await writeFile(join(output,'postflight-checks.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exit(0);
}
const artifacts=join(output,'artifacts/dist'),runtime=new Map();
const put=(path,bytes,mime)=>runtime.set(path,{bytes:Buffer.from(bytes),mime});
const wasm=await readFile(join(artifacts,'umd/ffmpeg-core.wasm')),chunks=[];
for(let offset=0,index=0;offset<wasm.length;offset+=16*1024*1024,index++){
 const bytes=wasm.subarray(offset,offset+16*1024*1024),url='ffmpeg-core.wasm.part'+index;chunks.push({url,bytes:bytes.length,sha256:hash(bytes)});put('/runtime/ffmpeg/'+url,bytes,'application/octet-stream');
}
const manifest={version:1,bytes:wasm.length,sha256:hash(wasm),chunks};put('/runtime/ffmpeg/ffmpeg-core.wasm.json',Buffer.from(JSON.stringify(manifest)),'application/json');
put('/runtime/ffmpeg/ffmpeg-core-classic.js',await readFile(join(artifacts,'umd/ffmpeg-core.js')),'text/javascript');
put('/runtime/ffmpeg/ffmpeg-core.js',await readFile(join(artifacts,'esm/ffmpeg-core.js')),'text/javascript');
put('/runtime/ffmpeg/worker.js',await readFile(join(studio,'../dist/client/runtime/ffmpeg/worker.js')),'text/javascript');
const assetsDirectory=join(output,'candidate-runtime');await mkdir(assetsDirectory,{recursive:true});for(const [path,file]of runtime)await writeFile(join(assetsDirectory,path.split('/').at(-1)),file.bytes);
// A local, synthetic source isolates the offered WebM import path from the
// unoffered VP9 encoder's separately preserved crash diagnostic.
const fixtureArgv=['-v','error','-y','-f','lavfi','-i','testsrc2=size=160x90:rate=30','-f','lavfi','-i','sine=frequency=330:sample_rate=48000:duration=2','-t','2','-ac','2','-c:v','libvpx-vp9','-threads','1','-deadline','realtime','-cpu-used','8','-b:v','200k','-c:a','libopus','-b:a','96k',join(output,'input-vp9-opus.webm')];
const fixtureEncode=spawnSync('ffmpeg',fixtureArgv,{encoding:'utf8'});if(fixtureEncode.status!==0)throw Error('Synthetic native WebM fixture encode failed: '+fixtureEncode.stderr);
const fixtureWebm=await readFile(join(output,'input-vp9-opus.webm'));put('/runtime/fixtures/input-vp9-opus.webm',fixtureWebm,'video/webm');
await writeFile(join(output,'webm-source-fixture.json'),JSON.stringify({source:'local native FFmpeg; synthetic testsrc2 and sine only',ownCoreEncoded:false,argv:fixtureArgv,exitCode:fixtureEncode.status,bytes:fixtureWebm.length,sha256:hash(fixtureWebm)},null,2)+'\n');
const bundle=await build({stdin:{contents:`import * as f from '${studio}/packages/browser-media/src/ffmpeg.ts';import * as a from '${studio}/packages/browser-media/src/audio.ts';import * as r from '${studio}/packages/browser-media/src/runtime.ts';import {decodeAudio,encodeWav} from '${studio}/packages/browser-media/src/media.ts';import * as c from '${studio}/packages/core/src/index.ts';window.codecMedia={...f,...a,...r,decodeAudio,encodeWav};window.codecCore=c;`,resolveDir:studio,sourcefile:'core-candidate.ts'},bundle:true,write:false,format:'iife',platform:'browser',target:'chrome140',define:{'process.env.NODE_ENV':'"production"'}});
const fixture=bundle.outputFiles[0].text+'\n'+await readFile(join(here,'core.child.js'),'utf8');
await writeFile(join(output,'acceptance-fixture.js'),fixture);
const runtimeSourcePaths=['packages/browser-media/src/ffmpeg.ts','packages/browser-media/src/audio.ts','packages/browser-media/src/runtime.ts','packages/browser-media/src/media.ts','packages/browser-media/src/classic-ffmpeg.ts','packages/core/src/index.ts'];
const runtimeSources=[];for(const path of runtimeSourcePaths){const bytes=await readFile(join(studio,path));runtimeSources.push({path,bytes:bytes.length,sha256:hash(bytes)});}
const dependencyLock=await readFile(join(studio,'package-lock.json'));
const runtimeUnderTest={sourcePathBase:'director-studio',fixtureBundleFilename:'acceptance-fixture.js',fixtureBundleBytes:Buffer.byteLength(fixture),fixtureBundleSha256:hash(Buffer.from(fixture)),dependencyLock:{path:'package-lock.json',bytes:dependencyLock.length,sha256:hash(dependencyLock)},sources:runtimeSources,classWorker:{repositoryRelativePath:'dist/client/runtime/ffmpeg/worker.js',sha256:hash(runtime.get('/runtime/ffmpeg/worker.js').bytes)},runtimeInventoryDoesNotClaimNativeBrowserPreviewSupport:true};
const requests=[],server=createServer((req,res)=>{if(req.url!=='/'){requests.push(req.url);res.writeHead(401);res.end('Owned runtime HTTP access denied; use controlled byte relay');return;}res.setHeader('content-type','text/html');res.setHeader('content-security-policy',"default-src 'none';script-src 'unsafe-inline' blob: 'wasm-unsafe-eval';worker-src blob:;frame-src 'self';connect-src blob: data:;media-src blob: data:;img-src blob: data:;style-src 'unsafe-inline'");res.end('<!doctype html><html><body></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage(),errors=[],saved=[],inventorySaved=[];page.on('pageerror',e=>errors.push(String(e)));
let report={passed:false,ownCore:!baseline,fixtureValidationOnly:baseline,wasmBytes:wasm.length,wasmSha256:hash(wasm),manifest,runtimeUnderTest,realNativeHostAcceptanceClaimed:false};
let runtimeRelayChunks=0;
await page.exposeBinding('readCandidateRuntime',async(_,path,offset,length)=>{const file=runtime.get(path);if(!file||!Number.isSafeInteger(offset)||offset<0||length!==262144)throw new Error('Invalid owned runtime read');const bytes=file.bytes.subarray(offset,offset+length);runtimeRelayChunks++;return {base64:bytes.toString('base64'),mime:file.mime,totalBytes:file.bytes.length};});
await page.exposeBinding('saveCandidate',async(_,filename,base64,mime)=>{if(!/^[\w.-]+$/.test(filename))throw Error('Unsafe output');const bytes=Buffer.from(base64,'base64');await writeFile(join(output,filename),bytes);const row={filename,bytes:bytes.length,sha256:hash(bytes)};(mime==='text/plain'||mime==='application/json'?inventorySaved:saved).push(row);});
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const result=await page.evaluate(async({fixture})=>new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Candidate Core acceptance timeout')),600000),frame=document.createElement('iframe');frame.sandbox='allow-scripts';
  const files=new Map(),originalLengths=new Map(),loading=new Map();
  const read=async path=>{if(files.has(path))return files.get(path);if(loading.has(path))return loading.get(path);const promise=(async()=>{let bytes,mime;for(let offset=0;!bytes||offset<bytes.length;offset+=262144){const part=await window.readCandidateRuntime(path,offset,262144);if(!bytes){bytes=new Uint8Array(part.totalBytes);mime=part.mime;}const raw=atob(part.base64);for(let i=0;i<raw.length;i++)bytes[offset+i]=raw.charCodeAt(i);}const file={bytes,mime};files.set(path,file);originalLengths.set(path,bytes.length);return file;})();loading.set(path,promise);try{return await promise;}finally{loading.delete(path);}};
  const channel=new MessageChannel();let corrupt=false,readCalls=0;
  channel.port1.onmessage=async({data})=>{
   if(data.type==='runtime'){
    let file;try{file=await read(data.path);}catch(error){channel.port1.postMessage({id:data.id,error:String(error)});return;}
    const copy=new Uint8Array(file.bytes);if(corrupt&&data.path.endsWith('.part0')){copy[0]^=1;corrupt=false;}
    readCalls++;channel.port1.postMessage({id:data.id,bytes:copy.buffer,mime:file.mime},[copy.buffer]);return;
   }
   if(data.type==='corrupt-next-part'){corrupt=true;return;}
   if(data.type==='output'){const bytes=new Uint8Array(data.bytes);let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));await window.saveCandidate(data.filename,btoa(s),data.mime);channel.port1.postMessage({id:data.id,bytes:new ArrayBuffer(0),mime:'application/octet-stream'});return;}
   if(data.type==='error'){clearTimeout(timeout);reject(new Error(data.error+'\n'+data.stack));return;}
   if(data.type==='complete'){clearTimeout(timeout);resolve({checks:data.checks,readCalls,cacheBuffersIntact:[...files].every(([path,file])=>file.bytes.length===originalLengths.get(path))});}
  };
  window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.type==='fixture-ready')frame.contentWindow.postMessage({type:'connect'},'*',[channel.port2]);});
  frame.srcdoc='<base href="https://private-runtime.invalid/"><script>'+fixture.replace(/<\/script/gi,'<\\/script')+'<\/script>';document.body.append(frame);
 }),{fixture});
 report={...report,...result,files:saved,inventoryFiles:inventorySaved,browserErrors:errors,ordinaryRuntimeHttpRequests:requests,runtimeRelayChunks,runtimeRelayChunkBytes:262144,controlledLocalByteRelay:true,realMcpTransportClaimed:false};
 if(errors.length||requests.length||!result.cacheBuffersIntact||result.checks.parentAccess||result.checks.origin!=='null')throw new Error('Isolation/runtime transport acceptance failed');
 report.decodedChecks=verifyMediaOutputs(saved);
 report.passed=true;
}catch(error){report.error=String(error);report.stack=error.stack;process.exitCode=1;}
finally{report.files??=saved;report.inventoryFiles??=inventorySaved;await writeFile(join(output,'browser-acceptance.json'),JSON.stringify(report,null,2)+'\n');await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({...report,files:report.files?.map(({filename,bytes,sha256})=>({filename,bytes,sha256}))},null,2));
