#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const [outputArgument,dependencyArgument]=process.argv.slice(2),baseline=process.argv.includes('--baseline');
if(!outputArgument||!dependencyArgument)throw Error('Use accept-core-esm.mjs COMPILED_CORE_DIRECTORY DEPENDENCY_ROOT [--baseline] [--probe-x265]');
const probeX265=process.argv.includes('--probe-x265'),reportFilename=probeX265?'esm-x265-browser-diagnostic.json':'esm-browser-acceptance.json';
const output=resolve(outputArgument),require=createRequire(join(resolve(dependencyArgument),'package.json'));
const {chromium}=require('playwright'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const glue=await readFile(join(output,'artifacts/dist/esm/ffmpeg-core.js'));
const wasm=await readFile(join(output,'artifacts/dist/esm/ffmpeg-core.wasm'));
if(!WebAssembly.validate(wasm))throw Error('Candidate ESM WASM does not validate');
const files={'glue':glue,'wasm':wasm},ordinaryRequests=[];
const server=createServer((req,res)=>{
 if(req.url!=='/'){ordinaryRequests.push(req.url);res.writeHead(401);res.end('No runtime HTTP access');return;}
 res.setHeader('content-type','text/html');
 res.setHeader('content-security-policy',"default-src 'none';script-src 'unsafe-inline' blob: 'wasm-unsafe-eval';worker-src blob:;connect-src blob:;style-src 'unsafe-inline'");
 res.end('<!doctype html><html><body></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage(),pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error)));
let relayChunks=0,report={passed:false,diagnosticOnly:probeX265,ownCore:!baseline,fixtureValidationOnly:baseline,variant:'esm-module-blob-worker',realNativeHostAcceptanceClaimed:false,realMcpTransportClaimed:false,wasmBytes:wasm.length,wasmSha256:hash(wasm),glueBytes:glue.length,glueSha256:hash(glue)};
await page.exposeBinding('readCandidate',(_,name,offset)=>{
 const file=files[name];if(!file||!Number.isSafeInteger(offset)||offset<0||offset>=file.length)throw Error('Invalid candidate byte read');
 relayChunks++;return {totalBytes:file.length,base64:file.subarray(offset,offset+262144).toString('base64')};
});
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const result=await page.evaluate(async({expectedWasmHash,probeX265})=>{
  const read=async name=>{let bytes;for(let offset=0;!bytes||offset<bytes.length;offset+=262144){const part=await window.readCandidate(name,offset);bytes??=new Uint8Array(part.totalBytes);const raw=atob(part.base64);for(let i=0;i<raw.length;i++)bytes[offset+i]=raw.charCodeAt(i);}return bytes;};
  const [glue,wasm]=await Promise.all([read('glue'),read('wasm')]);
  const wasmHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',wasm))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  if(wasmHash!==expectedWasmHash)throw Error('Transferred ESM WASM hash differs');
  const rate=48000,frames=rate*2,channels=2,data=new ArrayBuffer(44+frames*channels*2),view=new DataView(data);
  const text=(offset,string)=>[...string].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)));
  text(0,'RIFF');view.setUint32(4,data.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,rate,true);view.setUint32(28,rate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*channels*2,true);
  for(let frame=0;frame<frames;frame++)for(let channel=0;channel<channels;channel++)view.setInt16(44+(frame*channels+channel)*2,Math.round(Math.sin(frame/rate*Math.PI*2*(channel?440:330))*8000),true);
  const coreUrl=URL.createObjectURL(new Blob([glue],{type:'text/javascript'}));
  const workerText=`import createCore from ${JSON.stringify(coreUrl)};self.onmessage=async({data})=>{
   try{self.postMessage({phase:'module-load'});const core=await createCore({wasmBinary:new Uint8Array(data.wasm)});const logs=[];
    core.setLogger(event=>{logs.push(event);self.postMessage({log:event});});core.FS.writeFile('input.wav',new Uint8Array(data.input));
    self.postMessage({phase:'flac-encode'});core.exec('-i','input.wav','-c:a','flac','output.flac');const exitCode=core.ret;core.reset();
    if(exitCode!==0)throw Error('ESM encode exit '+exitCode);const bytes=new Uint8Array(core.FS.readFile('output.flac'));let hevc,x265ExitCode;
    if(${probeX265}){self.postMessage({phase:'x265-encode'});core.exec('-f','lavfi','-i','testsrc2=size=64x64:rate=1','-frames:v','1','-c:v','libx265','-preset','ultrafast','-x265-params','pools=none:frame-threads=1','output.hevc');x265ExitCode=core.ret;core.reset();if(x265ExitCode!==0)throw Error('x265 encode exit '+x265ExitCode);hevc=new Uint8Array(core.FS.readFile('output.hevc'));}
    self.postMessage({bytes:bytes.buffer,hevc:hevc?.buffer,exitCode,x265ExitCode,logs},[bytes.buffer,...(hevc?[hevc.buffer]:[])]);
   }catch(error){self.postMessage({error:String(error),stack:error.stack});}
  };`;
  const workerUrl=URL.createObjectURL(new Blob([workerText],{type:'text/javascript'})),worker=new Worker(workerUrl,{type:'module'});
  try{
   const encoded=await new Promise((resolve,reject)=>{let phase='worker-start';const recentLogs=[];
    const timer=setTimeout(()=>reject(Error('ESM encode timeout at '+phase+'; recent logs: '+JSON.stringify(recentLogs))),60000);
    worker.onerror=event=>{clearTimeout(timer);reject(Error(event.message));};
    worker.onmessage=({data})=>{if(data.phase){phase=data.phase;return;}if(data.log){recentLogs.push(data.log);if(recentLogs.length>6)recentLogs.shift();return;}clearTimeout(timer);data.error?reject(Error(data.error+'\n'+data.stack)):resolve(data);};
    worker.postMessage({wasm:wasm.buffer,input:data.slice(0)},[wasm.buffer]);
   });
   const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
   return {exitCode:encoded.exitCode,inputBase64:base64(new Uint8Array(data)),outputBase64:base64(new Uint8Array(encoded.bytes)),hevcBase64:base64(new Uint8Array(encoded.hevc)),x265ExitCode:encoded.x265ExitCode,logs:encoded.logs,moduleWorker:true,strictNoUnsafeEval:true};
  }finally{worker.terminate();URL.revokeObjectURL(workerUrl);URL.revokeObjectURL(coreUrl);}
 },{expectedWasmHash:hash(wasm),probeX265});
 const input=Buffer.from(result.inputBase64,'base64'),encoded=Buffer.from(result.outputBase64,'base64');
 await writeFile(join(output,'esm-source.wav'),input);await writeFile(join(output,'esm-roundtrip.flac'),encoded);
 let x265,hevcFile;
 if(probeX265){
  const hevc=Buffer.from(result.hevcBase64,'base64');await writeFile(join(output,'esm-x265.hevc'),hevc);
  const hevcProbe=spawnSync('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',join(output,'esm-x265.hevc')],{encoding:'utf8'});
  if(hevcProbe.status!==0)throw Error('x265 ffprobe failed: '+hevcProbe.stderr);
  const hevcMetadata=JSON.parse(hevcProbe.stdout),video=hevcMetadata.streams[0];
  const hevcDecode=spawnSync('ffmpeg',['-v','error','-i',join(output,'esm-x265.hevc'),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-'],{maxBuffer:1024*1024});
  if(video.codec_name!=='hevc'||video.width!==64||video.height!==64||Number(video.nb_read_frames)!==1||hevcDecode.status!==0||hevcDecode.stderr.length||hevcDecode.stdout.length!==64*64*3||!hevcDecode.stdout.some(byte=>byte>32))throw Error('x265 real encode/decode acceptance failed');
  x265={exitCode:result.x265ExitCode,decodedVideoFrames:1,width:64,height:64,decodedRgbSha256:hash(hevcDecode.stdout),probe:hevcMetadata};
  hevcFile={filename:'esm-x265.hevc',bytes:hevc.length,sha256:hash(hevc)};
 }
 const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',join(output,'esm-roundtrip.flac')],{encoding:'utf8'});
 if(probe.status!==0)throw Error('ESM ffprobe failed: '+probe.stderr);
 const ffprobe=JSON.parse(probe.stdout),stream=ffprobe.streams[0];
 const decode=spawnSync('ffmpeg',['-v','error','-i',join(output,'esm-roundtrip.flac'),'-f','s16le','-c:a','pcm_s16le','-'],{maxBuffer:2*1024*1024});
 const equals=decode.status===0&&decode.stderr.length===0&&decode.stdout.equals(input.subarray(44));
 if(!equals||stream.codec_name!=='flac'||Number(stream.sample_rate)!==48000||stream.channels!==2||Number(stream.duration)!==2||pageErrors.length||ordinaryRequests.length)throw Error('ESM codec/decode/transport acceptance failed');
 report={...report,passed:true,exitCode:result.exitCode,moduleWorker:result.moduleWorker,strictNoUnsafeEval:result.strictNoUnsafeEval,decodedPcmEqualsInput:true,x265,decodedPcmFrames:decode.stdout.length/4,decodedPcmSha256:hash(decode.stdout),relayChunks,relayChunkBytes:262144,ordinaryRuntimeHttpRequests:ordinaryRequests,pageErrors,files:[{filename:'esm-source.wav',bytes:input.length,sha256:hash(input)},{filename:'esm-roundtrip.flac',bytes:encoded.length,sha256:hash(encoded),ffprobe},...(hevcFile?[hevcFile]:[])],logs:result.logs};
}catch(error){report={...report,error:String(error),stack:error.stack,pageErrors,ordinaryRuntimeHttpRequests:ordinaryRequests};process.exitCode=1;}
finally{await writeFile(join(output,reportFilename),JSON.stringify(report,null,2)+'\n');await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({...report,logs:undefined},null,2));
