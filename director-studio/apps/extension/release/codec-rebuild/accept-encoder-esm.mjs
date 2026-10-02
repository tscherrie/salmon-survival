#!/usr/bin/env node
import {readFile,writeFile,access} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
if(!process.argv[2]||!process.argv[3])throw new Error('Use accept-encoder-esm.mjs SOURCE_COLLECTION DEPENDENCY_ROOT [flac|aac|mp3]');
const collection=resolve(process.argv[2]),dependencyRoot=resolve(process.argv[3]);
const require=createRequire(join(dependencyRoot,'package.json'));
const {chromium}=require('playwright'),{parseExpressionAt}=require('acorn');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const lockBytes=await readFile(join(here,'source-lock.json')),lock=JSON.parse(lockBytes);
const csp="default-src 'none';script-src 'unsafe-inline' blob: 'wasm-unsafe-eval';worker-src blob:;connect-src blob: data:;style-src 'unsafe-inline'";
const httpRequests=[];
const server=createServer((req,res)=>{if(req.url!=='/'){httpRequests.push(req.url);res.writeHead(401);res.end('Runtime HTTP denied');return;}res.setHeader('content-type','text/html');res.setHeader('content-security-policy',csp);res.end('<!doctype html><html><body></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const summary=[];
try{
 for(const codec of (process.argv[4]?[process.argv[4]]:['flac','aac','mp3'])){
  if(!['flac','aac','mp3'].includes(codec))throw new Error('Unsupported encoder '+codec);
  const build=lock.completedBuilds[codec],directory=join(collection,build.externalDirectory),glueName=codec==='mp3'?'lame.js':codec+'.js';
  let suffix='';try{await access(join(directory,codec+'-esm-browser-acceptance.json'));suffix='-attempt-'+Date.now();}catch{}
  const stem=codec+'-esm'+suffix,receiptPath=join(directory,codec+'-esm-browser-acceptance'+suffix+'.json');
  let report={passed:false,codec,variant:'actual own ESM glue and embedded WASM',sameOriginModuleBlobWorker:true,csp,noUnsafeEvalAllowed:true,sourceLockSnapshotSha256:hash(lockBytes),realMcpTransportClaimed:false,realNativeHostAcceptanceClaimed:false,replacedShippedRuntime:false,files:[]};
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  try{
   const glueBytes=await readFile(join(directory,glueName)),glue=glueBytes.toString('utf8'),expectedGlue=build.outputs.find(row=>row.filename===glueName);
   if(hash(glueBytes)!==expectedGlue.sha256)throw new Error('ESM glue does not match compiled receipt');
   const expression=parseExpressionAt(glue,glue.indexOf('return binaryDecode(')+7,{ecmaVersion:'latest'}),bin=expression.arguments[0].value;
   const embedded=Uint8Array.from(bin,char=>(~char.charCodeAt(0)>>8)&char.charCodeAt(0)),wasmName=codec==='mp3'?'lame.wasm':codec+'.wasm';
   if(hash(embedded)!==build.outputs.find(row=>row.filename===wasmName).sha256)throw new Error('ESM embedded WASM differs from compiled receipt');
   const sources=[];for(const key of build.sources){const source=key==='aacNewSource'?lock.aacNewSource:lock.sources[key],path=join(collection,key==='aacNewSource'?'rebuild/sources':'',source.archive),bytes=await readFile(path);if(hash(bytes)!==source.sha256)throw new Error('Source archive hash mismatch '+key);sources.push({key,archive:source.archive,bytes:bytes.length,sha256:hash(bytes),commit:source.commit??source.chosenSourceCommit??null,version:source.version??null});}
   const originalWorker=await readFile(join(here,codec+'.worker.js'),'utf8');let workerSource=originalWorker;
   if(codec==='flac'){
    const before="self.postMessage({type:'progress',encodedChunks});";
    if(!workerSource.includes(before))throw new Error('FLAC worker instrumentation location changed');
    workerSource=workerSource.replace(before,"if(chunks.length>1)self.postMessage({type:'progress',encodedChunks:chunks.length-1,sentChunks:encodedChunks,actualOutputBytes:chunks.slice(1).reduce((sum,chunk)=>sum+chunk.length,0)});");
   }else if(codec==='aac'){
    const before="self.postMessage({type:'progress',encodedChunks:packets.length,sentFrames});";
    if(!workerSource.includes(before))throw new Error('AAC worker instrumentation location changed');
    workerSource=workerSource.replace(before,"self.postMessage({type:'progress',encodedChunks:packets.length,sentFrames,actualOutputBytes:chunks.reduce((sum,chunk)=>sum+chunk.length,0)});");
   }
   report={...report,glue:{filename:glueName,bytes:glueBytes.length,sha256:hash(glueBytes)},embeddedWasm:{bytes:embedded.length,sha256:hash(embedded)},sources,fixtureWorker:{filename:codec+'.worker.js',originalSha256:hash(Buffer.from(originalWorker)),executedSha256:hash(Buffer.from(workerSource)),progressRequiresActualOutputBytes:true},browserVersion:browser.version()};
   await page.goto(base);
   const result=await page.evaluate(async({glue,workerSource,codec})=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('ESM encoder acceptance timeout')),60000),glueUrl=URL.createObjectURL(new Blob([glue],{type:'text/javascript'}));
    const factoryName={flac:'createFlacModule',aac:'createAacModule',mp3:'createMp3Module'}[codec];
    const wrapper='import factory from '+JSON.stringify(glueUrl)+';self.'+factoryName+'=factory;self.addEventListener("securitypolicyviolation",event=>self.postMessage({type:"csp-violation",directive:event.violatedDirective,blockedURI:event.blockedURI}));self.postMessage({type:"module-context",origin:self.location.origin});\n'+workerSource;
    const workerUrl=URL.createObjectURL(new Blob([wrapper],{type:'text/javascript'}));
    let worker,generation=0,cancellation=null;const contexts=[],violations=[];
    const fail=error=>{clearTimeout(timeout);worker?.terminate();URL.revokeObjectURL(workerUrl);URL.revokeObjectURL(glueUrl);reject(error);};
    const create=()=>{
     const current=++generation;worker=new Worker(workerUrl,{type:'module'});
     worker.onerror=event=>fail(new Error('ESM Worker: '+event.message));
     worker.onmessage=({data})=>{
      if(data.type==='module-context'){contexts.push({generation:current,origin:data.origin});return;}
      if(data.type==='csp-violation'){violations.push(data);return;}
      if(data.type==='error'){fail(new Error(data.error));return;}
      if(data.type==='ready'){worker.postMessage({type:'encode',frames:cancellation?96000:48000*60});return;}
      if(data.type==='progress'&&!cancellation){
       if(!(data.encodedChunks>0&&data.actualOutputBytes>0)){fail(new Error('Progress did not prove actual output'));return;}
       cancellation={afterActualChunks:data.encodedChunks,actualOutputBytes:data.actualOutputBytes,sentFrames:data.sentFrames??null,sentChunks:data.sentChunks??null,generation:current};
       worker.terminate();create();return;
      }
      if(data.type==='complete'){
       clearTimeout(timeout);worker.terminate();URL.revokeObjectURL(workerUrl);URL.revokeObjectURL(glueUrl);
       const encode=buffer=>{let text='';for(const byte of new Uint8Array(buffer))text+=String.fromCharCode(byte);return btoa(text);};
       resolve({...data,bytes:encode(data.bytes),pcm:encode(data.pcm),sourceS16:data.sourceS16?encode(data.sourceS16):null,cancellation,recoveryGeneration:current,contexts,violations,pageOrigin:location.origin});
      }
     };worker.postMessage({type:'init'});
    };create();
   }),{glue,workerSource,codec});
   if(!result.cancellation||result.recoveryGeneration!==2||result.contexts.length!==2||result.contexts.some(context=>context.origin!==result.pageOrigin)||result.violations.length||errors.length||httpRequests.length)throw new Error('ESM worker/transport/CSP boundary failed');
   const bytes=Buffer.from(result.bytes,'base64'),pcm=Buffer.from(result.pcm,'base64'),filename=stem+'-synthetic-stereo.'+(codec==='aac'?'aac':codec);
   const save=async(name,buffer)=>{await writeFile(join(directory,name),buffer);report.files.push({filename:name,bytes:buffer.length,sha256:hash(buffer)});};
   await save(filename,bytes);await save(stem+'-synthetic-input.'+(codec==='flac'?'s32le':'f32le'),pcm);
   if(result.sourceS16)await save(stem+'-synthetic-input.s16le',Buffer.from(result.sourceS16,'base64'));
   const probe=spawnSync('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',join(directory,filename)],{encoding:'utf8'});
   if(probe.status!==0)throw new Error(probe.stderr);const stream=JSON.parse(probe.stdout).streams[0];
   if(stream.codec_name!==codec||Number(stream.sample_rate)!==48000||stream.channels!==2)throw new Error('Wrong actual ESM output stream');
   const format=codec==='flac'?'s32le':'f32le',decoded=spawnSync('ffmpeg',['-v','error','-i',join(directory,filename),'-f',format,'-acodec','pcm_'+format,'-'],{maxBuffer:4*1024*1024});
   if(decoded.status!==0||decoded.stderr.length)throw new Error('ESM output decode failed: '+decoded.stderr);
   await save(stem+'-synthetic-decoded.'+format,decoded.stdout);await save(stem+'-ffprobe.json',Buffer.from(probe.stdout));
   const inputFrames=pcm.length/8,decodedFrames=decoded.stdout.length/8;let quality=null,delayFrames=0,qualityCriteria=null;
   if(codec==='flac'){
    if(!decoded.stdout.equals(pcm)||inputFrames!==96000||decodedFrames!==96000||Math.abs(Number(stream.duration)-2)>1/48000)throw new Error('ESM FLAC lossless PCM roundtrip failed');
   }else{
    const source=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.length/4),actual=new Float32Array(decoded.stdout.buffer,decoded.stdout.byteOffset,decoded.stdout.length/4);
    let minimum=Infinity;
    for(let delay=0;delay<=2304;delay++){let error=0;for(let i=480;i<24000;i+=16)for(let channel=0;channel<2;channel++){const difference=source[i*2+channel]-actual[(i+delay)*2+channel];error+=difference*difference;}if(error<minimum){minimum=error;delayFrames=delay;}}
    quality=[];for(let channel=0;channel<2;channel++){
     let signal=0,error=0,maxAbsoluteError=0,maxAbsoluteErrorFrame=0,decodedPeak=0;const absoluteErrors=[];
     for(let i=0;i<inputFrames;i++){const value=source[i*2+channel],difference=value-actual[(i+delayFrames)*2+channel],absolute=Math.abs(difference);signal+=value*value;error+=difference*difference;absoluteErrors.push(absolute);if(absolute>maxAbsoluteError){maxAbsoluteError=absolute;maxAbsoluteErrorFrame=i;}}
     for(let i=0;i<decodedFrames;i++)decodedPeak=Math.max(decodedPeak,Math.abs(actual[i*2+channel]));absoluteErrors.sort((a,b)=>a-b);
     quality.push({channel,snrDb:10*Math.log10(signal/error),rmsError:Math.sqrt(error/inputFrames),absoluteErrorP99:absoluteErrors[Math.floor(inputFrames*.99)],maxAbsoluteError,maxAbsoluteErrorFrame,decodedPeak});
    }
    qualityCriteria={minimumSnrDb:20,maximumAbsoluteErrorP99:0.1,maximumDecodedPeak:1,maximumDelayFrames:2304,maximumTrailingPaddingFrames:codec==='aac'?1024:2304};
    const padding=decodedFrames-inputFrames-delayFrames;
    if(inputFrames!==96000||delayFrames<=0||padding<0||padding>qualityCriteria.maximumTrailingPaddingFrames||quality.some(row=>!Number.isFinite(row.snrDb)||!Number.isFinite(row.decodedPeak)||row.snrDb<20||row.absoluteErrorP99>0.1||row.decodedPeak>1))throw new Error('ESM delay/quality failed: '+JSON.stringify({inputFrames,decodedFrames,delayFrames,padding,quality}));
    if(codec==='aac'&&(delayFrames!==-result.packets[0].pts||Number(stream.nb_read_frames)!==result.packets.length))throw new Error('ESM AAC timing/packet consistency failed');
    if(codec==='mp3'&&decodedFrames!==Number(stream.nb_read_frames)*1152)throw new Error('ESM MP3 frame count failed');
   }
   report={...report,passed:true,inputFrames,inputDurationSeconds:2,sampleRate:48000,channels:2,decodedFrames,decodedDurationSeconds:decodedFrames/48000,measuredDelayFrames:delayFrames,delayMeaning:codec==='mp3'?'combined encoder and decoder delay; no gapless metadata':codec==='aac'?'encoder priming confirmed against first packet PTS':'lossless zero delay',trailingPaddingFrames:decodedFrames-inputFrames-delayFrames,decodedPcmEqualsInput:codec==='flac',qualityCriteria,quality,outputBytes:bytes.length,outputSha256:hash(bytes),stream,cancellation:result.cancellation,recoveryGeneration:result.recoveryGeneration,recoveryEncodedChunks:result.encodedChunks,workerContexts:result.contexts,cspViolations:result.violations,pageErrors:errors,ordinaryRuntimeHttpRequests:[...httpRequests],runtimeBytesProvidedByControlledLocalArguments:true};
  }catch(error){report.error=String(error);report.stack=error.stack;report.pageErrors=errors;report.ordinaryRuntimeHttpRequests=[...httpRequests];process.exitCode=1;}
  finally{await writeFile(receiptPath,JSON.stringify(report,null,2)+'\n');await page.close();}
  summary.push({codec,passed:report.passed,error:report.error,receiptPath,receiptSha256:hash(await readFile(receiptPath)),glueSha256:report.glue?.sha256,wasmSha256:report.embeddedWasm?.sha256,outputSha256:report.outputSha256,delayFrames:report.measuredDelayFrames,paddingFrames:report.trailingPaddingFrames,quality:report.quality});
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify(summary,null,2));
