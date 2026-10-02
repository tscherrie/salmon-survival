import { build } from 'esbuild';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const studio = fileURLToPath(new URL('../../../', import.meta.url)), dist = path.resolve(studio, '../dist/client');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'director-native-runtime.'));
const worker = (await import(path.resolve(studio, '../dist/server/index.js'))).default;
const entry = `
import {DirectorHostBridge} from './apps/extension/ui/hostBridge.ts';
import {installNativeRuntime} from './apps/extension/ui/nativeRuntime.ts';
import {compileComponentSource,withFFmpeg,MediaSandboxClient,loadMediaSandbox} from './packages/browser-media/src/index.ts';
import {createTimeline} from './packages/core/src/index.ts';
const bridge=new DirectorHostBridge();bridge.status.connected=true;bridge.connect=async()=>{};
bridge.app.callServerTool=(args)=>new Promise((resolve,reject)=>{const channel=new MessageChannel();channel.port1.onmessage=event=>{channel.port1.close();event.data.error?reject(new Error(event.data.error)):resolve(event.data.result)};parent.postMessage({type:'fixture-server-tool',args},'*',[channel.port2]);});
installNativeRuntime(bridge);const RealWorker=Worker;window.Worker=class extends RealWorker{constructor(...args){super(...args);this.addEventListener('error',event=>console.error('runtime-worker-error',event.message))}};
window.nativeRuntimeCheck=async()=>{
 const compiled=await compileComponentSource("import React from 'react';export default ()=> <div>Native TSX runtime</div>");
 console.log('Native compiler completed');const simple=URL.createObjectURL(new Blob(["postMessage('started')"],{type:'text/javascript'}));await new Promise((resolve,reject)=>{const w=new Worker(simple);w.onmessage=()=>{w.terminate();URL.revokeObjectURL(simple);resolve()};w.onerror=reject;setTimeout(()=>reject(new Error('Simple opaque worker timeout')),10000)});console.log('Opaque classic worker completed');const wav=await withFFmpeg(async ff=>{if(await ff.exec(['-f','lavfi','-i','sine=frequency=440:duration=0.05','-c:a','pcm_s16le','tone.wav']))throw new Error('Fixture codec failed');const bytes=await ff.readFile('tone.wav');return {bytes:bytes.length,riff:String.fromCharCode(...bytes.slice(0,4))};});
 const frame=document.createElement('iframe');frame.sandbox.add('allow-scripts');frame.style.cssText='width:320px;height:180px;border:0';const client=new MediaSandboxClient(frame);await loadMediaSandbox(frame);document.body.append(frame);
 const source="import React from 'react';export default ()=> <div style={{width:'100%',height:'100%',background:'#24b8aa'}}>Native isolated component</div>";
 const doc=createTimeline({width:320,height:180,fps:30});doc.durationFrames=2;doc.components.demo={assetId:'source',name:'Native component'};doc.tracks.find(t=>t.kind==='overlay').clips.push({id:'component',componentId:'demo',start:0,duration:2,in:0,speed:1});
 const result=await client.export({document:doc,assets:{source:{id:'source',kind:'code',url:'data:text/plain;base64,'+btoa(source)}},components:{demo:source},format:'png'});
 const bitmap=await createImageBitmap(result.blob);const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);const pixel=[...ctx.getImageData(5,5,1,1).data];bitmap.close();
 const isolation={sandbox:frame.getAttribute('sandbox'),srcdoc:frame.hasAttribute('srcdoc'),parentAccessDenied:false};try{void frame.contentWindow.document}catch{isolation.parentAccessDenied=true}client.dispose();frame.remove();
 return {compiler:compiled.startsWith('/* @studio/component v1 */'),wav,component:{bytes:result.blob.size,mime:result.blob.type,pixel},isolation};
};`;
await build({stdin:{contents:entry,resolveDir:studio,sourcefile:'native-runtime-fixture.ts'},outfile:path.join(output,'widget.js'),bundle:true,platform:'browser',format:'iife',target:'chrome140',define:{'process.env.NODE_ENV':'"production"'}});
const bundle=(await fs.readFile(path.join(output,'widget.js'),'utf8')).replaceAll('</script','<\\/script');
const counters={authenticatedRuntimeRpc:0,unauthenticatedRuntimeRpc:0,directRuntimeGets:0,requestedFileCount:0};const paths=new Set();
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture.invalid');
 try {
  if(url.pathname==='/'){
   res.setHeader('content-type','text/html');res.setHeader('content-security-policy',"default-src 'none';script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:;connect-src 'self' blob: data:;worker-src blob:;style-src 'unsafe-inline';img-src data: blob:;font-src data:;media-src data: blob:;frame-src 'self' data: blob:");
   res.end(`<!doctype html><html><body><iframe id="widget" sandbox="allow-scripts" style="width:640px;height:480px"></iframe><script>const widget=document.getElementById('widget');window.addEventListener('message',async event=>{if(event.source!==widget.contentWindow||event.data?.type!=='fixture-server-tool'||!event.ports[0])return;try{const args=event.data.args;if(args.name!=='director_ui_request')throw new Error('Fixture tool denied');const response=await fetch('/mcp',{method:'POST',headers:{'content-type':'application/json','authorization':'fixture-parent-only'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:args})});const body=await response.json();event.ports[0].postMessage({result:body.result})}catch(error){event.ports[0].postMessage({error:String(error)})}});widget.srcdoc=${JSON.stringify('<!doctype html><html><head><base href="http://127.0.0.1:'+server.address().port+'/"></head><body><script>'+bundle+'</script></body></html>').replaceAll('</script','<\\/script')};</script></body></html>`);return;
  }
  if(url.pathname.startsWith('/runtime/')||url.pathname==='/native-sandbox.html'){counters.directRuntimeGets++;res.writeHead(403);res.end('Private Site GET denied');return;}
  if(url.pathname==='/mcp'&&req.method==='POST'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString();const authenticated=req.headers.authorization==='fixture-parent-only';
   const parsed=JSON.parse(body), requested=new URL(parsed.params.arguments.path,'http://fixture.invalid').searchParams.get('path');if(authenticated){counters.authenticatedRuntimeRpc++;paths.add(requested)}else counters.unauthenticatedRuntimeRpc++;
   const headers={'content-type':'application/json',...(authenticated?{'oai-authenticated-user-id':'fixture-runtime','oai-authenticated-user-email':'fixture-runtime@example.test'}:{})};
   const assets={fetch:async request=>{const file=new URL(request.url).pathname;const bytes=await fs.readFile(path.resolve(dist,'.'+file));return new Response(bytes,{headers:{'content-type':types[path.extname(file)]??'application/octet-stream'}})}};
   const result=await worker.fetch(new Request('http://127.0.0.1:'+server.address().port+'/mcp',{method:'POST',headers,body}),{ASSETS:assets});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  res.writeHead(404);res.end();
 }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error'||msg.text().startsWith('Native ')||msg.text().startsWith('Opaque '))console.log(msg.text().slice(0,800));});
try {
 const unauth=await fetch(origin+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'director_ui_request',arguments:{path:'/api/runtime-file?path=%2Fruntime%2Fesbuild.wasm&offset=0&length=262144',method:'GET'}}})});
 const denied=await fetch(origin+'/runtime/esbuild.wasm');if(unauth.status!==401||denied.status!==403)throw new Error('Denied transport controls failed');
 await page.goto(origin);const frame=page.frames().find(frame=>frame!==page.mainFrame());await frame.waitForFunction(()=>typeof window.nativeRuntimeCheck==='function');
 const result=await frame.evaluate(()=>window.nativeRuntimeCheck());
 counters.requestedFileCount=paths.size;
 const report={fixture:'Actual built Worker MCP tools/call and DirectorHostBridge.request; simulated parent host SDK call capability',controls:{unauthenticatedMcpStatus:unauth.status,directPrivateGetStatus:denied.status,noWidgetDirectRuntimeGets:counters.directRuntimeGets===1},result,counters,browserErrors:errors,limits:['Native host handshake is simulated in this fixture; production host iframe CSP and SDK negotiation need the real user widget recheck.']};
 if(!result.compiler||result.wav.riff!=='RIFF'||!result.isolation.srcdoc||!result.isolation.parentAccessDenied||result.component.pixel[1]<150||errors.length||counters.directRuntimeGets!==1)throw new Error('Native runtime acceptance checks failed');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,checks:report},null,2));
}finally{await browser.close();server.close();}
