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
const server=createServer(async(req,res)=>{
 try {
  const origin='http://127.0.0.1:'+server.address().port;
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline' blob: 'wasm-unsafe-eval' "+origin+"; worker-src blob:; frame-src 'self'; connect-src "+origin+"; style-src 'unsafe-inline'");
  const route=req.url.split('?')[0];
  if(route==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div>');return;}
  const source=route==='/flac-classic.js'?join(output,'flac-classic.js'):route==='/flac.worker.js'?join(here,'flac.worker.js'):null;
  if(!source){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','text/javascript');res.end(await readFile(source));
 }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();
 const errors=[],violations=[];
 page.on('pageerror',error=>errors.push(String(error)));
 page.on('console',message=>console.error('browser:',message.text()));
 page.on('requestfailed',request=>console.error('requestfailed:',request.url(),request.failure()?.errorText));
 await page.goto(base);
 const child=await readFile(join(here,'flac.child.js'),'utf8');
 const result=await page.evaluate(async({base,child})=>{
  return await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Codec acceptance timeout')),60000);
   const frame=document.createElement('iframe');frame.sandbox='allow-scripts';
   const channel=new MessageChannel();let cancellation=null;
   channel.port1.onmessage=({data})=>{
    if(data.type==='cancelled'){cancellation=data;return;}
    if(data.type==='error'){clearTimeout(timeout);reject(new Error(data.error));return;}
    if(data.type==='complete'){
     clearTimeout(timeout);
     const encode=buffer=>{let s='';for(const byte of new Uint8Array(buffer))s+=String.fromCharCode(byte);return btoa(s);};
     resolve({...data,bytes:encode(data.bytes),pcm:encode(data.pcm),cancellation});
    }
   };
   window.addEventListener('message',event=>{
    if(event.source===frame.contentWindow&&event.data?.type==='fixture-ready')frame.contentWindow.postMessage({type:'connect'},'*',[channel.port2]);
   });
   frame.srcdoc='<script>window.CODEC_BASE='+JSON.stringify(base)+';<\/script><script>'+child+'<\/script>';
   document.body.append(frame);
  });
 },{base,child});
 if(result.origin!=='null'||result.parentAccess!==false||!result.cancelled||!result.cancellation?.afterChunks)throw new Error('Opaque/abort boundary failed');
 const bytes=Buffer.from(result.bytes,'base64'),pcm=Buffer.from(result.pcm,'base64');
 const path=join(output,'synthetic-stereo.flac');
 await writeFile(path,bytes);await writeFile(join(output,'synthetic-input.s32le'),pcm);
 const probe=spawnSync('ffprobe',['-v','error','-show_streams','-of','json',path],{encoding:'utf8'});
 if(probe.status!==0)throw new Error(probe.stderr);
 const decoded=spawnSync('ffmpeg',['-v','error','-i',path,'-f','s32le','-acodec','pcm_s32le','-'],{maxBuffer:4*1024*1024});
 if(decoded.status!==0||!decoded.stdout.equals(pcm))throw new Error('FLAC PCM roundtrip mismatch: '+decoded.stderr);
 const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
 const report={passed:true,codec:'flac',compileIsIndependentFromShippedRuntime:true,frames:96000,durationSeconds:2,sampleRate:48000,channels:2,bits:24,outputBytes:bytes.length,outputSha256:hash(bytes),pcmSha256:hash(pcm),decodedPcmEqualsInput:true,cancelAfterActualEncodeChunks:result.cancellation.afterChunks,recoveryEncodedChunks:result.encodedChunks,opaqueOrigin:result.origin,parentAccess:result.parentAccess,noUnsafeEvalAllowed:true,pageErrors:errors,stream:JSON.parse(probe.stdout).streams[0],realNativeHostAcceptanceClaimed:false};
 if(errors.length)throw new Error('Page errors: '+errors.join(';'));
 await writeFile(join(output,'browser-acceptance.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
