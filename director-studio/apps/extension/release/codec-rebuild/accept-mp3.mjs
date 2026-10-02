import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const output=resolve(process.argv[2]);
const dependencyRoot=resolve(process.argv[3]??process.cwd());
const {chromium}=createRequire(join(dependencyRoot,'package.json'))('playwright');
const csp=origin=>"default-src 'none'; script-src 'unsafe-inline' blob: 'wasm-unsafe-eval' "+origin+"; worker-src blob:; frame-src 'self'; connect-src "+origin+"; style-src 'unsafe-inline'";
const server=createServer(async(req,res)=>{
  try {
    const origin='http://127.0.0.1:'+server.address().port;
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Security-Policy',csp(origin));
    const route=req.url.split('?')[0];
    if(route==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div>');return;}
    const source=route==='/lame-classic.js'?join(output,'lame-classic.js'):route==='/mp3.worker.js'?join(here,'mp3.worker.js'):null;
    if(!source){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','text/javascript');res.end(await readFile(source));
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',message=>console.error('browser:',message.text()));
  await page.goto(base);
  const child=await readFile(join(here,'mp3.child.js'),'utf8');
  const result=await page.evaluate(async({base,child})=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('MP3 acceptance timeout')),60000);
    const frame=document.createElement('iframe');frame.sandbox='allow-scripts';
    const channel=new MessageChannel();let cancellation=null;const violations=[];
    channel.port1.onmessage=({data})=>{
      if(data.type==='cancelled'){cancellation=data;return;}
      if(data.type==='csp-violation'){violations.push(data);return;}
      if(data.type==='error'){clearTimeout(timeout);reject(new Error(data.error));return;}
      if(data.type==='complete'){
        clearTimeout(timeout);
        const encode=buffer=>{let s='';for(const byte of new Uint8Array(buffer))s+=String.fromCharCode(byte);return btoa(s);};
        resolve({...data,bytes:encode(data.bytes),pcm:encode(data.pcm),sourceS16:encode(data.sourceS16),cancellation,violations});
      }
    };
    window.addEventListener('message',event=>{
      if(event.source===frame.contentWindow&&event.data?.type==='fixture-ready')frame.contentWindow.postMessage({type:'connect'},'*',[channel.port2]);
    });
    frame.srcdoc='<script>window.CODEC_BASE='+JSON.stringify(base)+';<\/script><script>'+child+'<\/script>';
    document.body.append(frame);
  }),{base,child});
  if(result.origin!=='null'||result.parentAccess!==false||!result.cancelled||!result.cancellation?.afterChunks||!result.cancellation?.actualOutputBytes||result.workerGeneration!==2)throw new Error('Opaque/abort/fresh-worker boundary failed');
  if(errors.length||result.violations.length)throw new Error('Browser errors/CSP violations: '+JSON.stringify({errors,violations:result.violations}));
  const bytes=Buffer.from(result.bytes,'base64'),pcm=Buffer.from(result.pcm,'base64');
  const path=join(output,'synthetic-stereo.mp3');
  await writeFile(path,bytes);await writeFile(join(output,'synthetic-input.f32le'),pcm);
  await writeFile(join(output,'synthetic-input.s16le'),Buffer.from(result.sourceS16,'base64'));
  const probe=spawnSync('ffprobe',['-v','error','-count_frames','-show_packets','-show_streams','-show_format','-of','json',path],{encoding:'utf8'});
  if(probe.status!==0)throw new Error(probe.stderr);
  const probeData=JSON.parse(probe.stdout),stream=probeData.streams[0],packets=probeData.packets;
  if(stream.codec_name!=='mp3'||Number(stream.sample_rate)!==48000||stream.channels!==2||Number(stream.nb_read_frames)!==packets.length)throw new Error('Wrong MP3 output stream/frame count');
  const decoded=spawnSync('ffmpeg',['-v','error','-i',path,'-f','f32le','-acodec','pcm_f32le','-'],{maxBuffer:4*1024*1024});
  if(decoded.status!==0)throw new Error('MP3 decode failed: '+decoded.stderr);
  await writeFile(join(output,'synthetic-decoded.f32le'),decoded.stdout);
  const source=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.length/4);
  const actual=new Float32Array(decoded.stdout.buffer,decoded.stdout.byteOffset,decoded.stdout.length/4);
  const inputFrames=source.length/2,decodedFrames=actual.length/2;
  let delayFrames=0,minError=Infinity;
  for(let delay=0;delay<=2304;delay++) {
    let error=0;
    for(let i=480;i<Math.min(inputFrames,24000);i+=16)for(let ch=0;ch<2;ch++) {
      const difference=source[i*2+ch]-actual[(i+delay)*2+ch];error+=difference*difference;
    }
    if(error<minError){minError=error;delayFrames=delay;}
  }
  const quality=[];
  for(let ch=0;ch<2;ch++) {
    let signal=0,error=0,maxAbsoluteError=0,maxAbsoluteErrorFrame=0,decodedPeak=0;
    const absoluteErrors=[];
    for(let i=0;i<inputFrames;i++) {
      const expected=source[i*2+ch],difference=expected-actual[(i+delayFrames)*2+ch],absoluteError=Math.abs(difference);
      signal+=expected*expected;error+=difference*difference;absoluteErrors.push(absoluteError);
      if(absoluteError>maxAbsoluteError){maxAbsoluteError=absoluteError;maxAbsoluteErrorFrame=i;}
    }
    for(let i=0;i<decodedFrames;i++)decodedPeak=Math.max(decodedPeak,Math.abs(actual[i*2+ch]));
    absoluteErrors.sort((a,b)=>a-b);
    quality.push({channel:ch,snrDb:10*Math.log10(signal/error),rmsError:Math.sqrt(error/inputFrames),absoluteErrorP99:absoluteErrors[Math.floor(absoluteErrors.length*.99)],maxAbsoluteError,maxAbsoluteErrorFrame,maxAbsoluteErrorSeconds:maxAbsoluteErrorFrame/48000,decodedPeak});
  }
  const frameSize=1152;
  const qualityCriteria={minimumSnrDb:20,maximumAbsoluteErrorP99:0.1,maximumDecodedPeak:1,maximumMeasuredCombinedDelayFrames:2304,maximumTrailingPaddingFrames:frameSize*2};
  const consistentPackets=packets.every((packet,index)=>Number(packet.duration)>0&&Number(packet.pts)===Number(packets[0].pts)+index*Number(packets[0].duration)&&Number(packet.duration)===Number(packets[0].duration)&&Math.abs(Number(packet.duration_time)-frameSize/48000)<0.000001);
  const trailingPaddingFrames=decodedFrames-inputFrames-delayFrames;
  if(!consistentPackets||decodedFrames!==packets.length*frameSize||delayFrames<=0||delayFrames>qualityCriteria.maximumMeasuredCombinedDelayFrames||trailingPaddingFrames<0||trailingPaddingFrames>qualityCriteria.maximumTrailingPaddingFrames||quality.some(channel=>!Number.isFinite(channel.snrDb)||!Number.isFinite(channel.decodedPeak)||channel.snrDb<qualityCriteria.minimumSnrDb||channel.absoluteErrorP99>qualityCriteria.maximumAbsoluteErrorP99||channel.decodedPeak>qualityCriteria.maximumDecodedPeak))throw new Error('MP3 delay/duration/quality failed: '+JSON.stringify({consistentPackets,delayFrames,inputFrames,decodedFrames,trailingPaddingFrames,quality}));
  const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
  const report={passed:true,codec:'mp3',container:'raw MPEG-1 Layer III',compileIsIndependentFromShippedRuntime:true,inputFrames,inputDurationSeconds:inputFrames/48000,sampleRate:48000,channels:2,sourcePcmBits:16,bitrate:192000,frameSize,sentChunks:result.sentChunks,decodedFrames,decodedDurationSeconds:decodedFrames/48000,measuredCombinedEncoderDecoderDelayFrames:delayFrames,measuredCombinedEncoderDecoderDelaySeconds:delayFrames/48000,rawMp3DoesNotCarryGaplessDelayMetadata:true,trailingPaddingFrames,qualityCriteria,quality,consistentPackets,outputBytes:bytes.length,outputSha256:hash(bytes),pcmSha256:hash(pcm),decodedPcmSha256:hash(decoded.stdout),glueSha256:hash(await readFile(join(output,'lame-classic.js'))),cancelAfterActualEncodeChunks:result.cancellation.afterChunks,cancelAfterSentChunks:result.cancellation.afterSentChunks,cancelledActualOutputBytes:result.cancellation.actualOutputBytes,cancelledWorkerGeneration:result.cancellation.workerGeneration,recoveryWorkerGeneration:result.workerGeneration,recoveryEncodedChunks:result.encodedChunks,opaqueOrigin:result.origin,parentAccess:result.parentAccess,csp:csp(base),noUnsafeEvalAllowed:true,classicBlobWorker:true,cspViolations:result.violations,pageErrors:errors,browserVersion:browser.version(),stream,packetCount:packets.length,encodedChunkBytes:result.chunkBytes,realNativeHostAcceptanceClaimed:false};
  await writeFile(join(output,'ffprobe.json'),probe.stdout);
  await writeFile(join(output,'browser-acceptance.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
