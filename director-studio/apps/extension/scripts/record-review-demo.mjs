// Record real SDK-browser interactions with the built Worker for review preparation.
// Start acceptance-server.mjs with isolated DIRECTOR_ACCEPTANCE_DIR first; DIRECTOR_ACCEPTANCE_PORT defaults to5201.
// Requires installed Chrome, ffmpeg, ffprobe and the Playwright video helper (node ../../node_modules/playwright/cli.js install ffmpeg).
// No host UI claim: synthetic owner identity exists only in this Node proxy.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const studio = process.env.DIRECTOR_STUDIO_DIR ?? fileURLToPath(new URL('../../../',import.meta.url));
const outputDir=path.resolve(process.argv[2]??'/tmp/director-sdk-review-demo');
const require=createRequire(path.join(studio,'package.json'));
const {build}=require('esbuild');
const {chromium}=require('playwright');
const {JSDOM}=require('jsdom');
const workerOrigin='http://127.0.0.1:'+Number(process.env.DIRECTOR_ACCEPTANCE_PORT??5201);
const privateOrigin='https://ai-director-studio.yearemia.chatgpt.site';
const owner={'oai-authenticated-user-id':'sdk-review-synthetic-owner-'+Date.now(),'oai-authenticated-user-email':'sdk-review-synthetic@example.test'};
const evidence=path.join(outputDir,'sdk-review-demo.json');
let rpcId=1;
async function rpc(method,params={}) {
 const response=await fetch(workerOrigin+'/mcp',{method:'POST',headers:{...owner,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:rpcId++,method,params})});
 const result=await response.json(); if(result.error)throw Error(JSON.stringify(result.error)); return result.result;
}
async function call(name,args={}) {
 const result=await rpc('tools/call',{name,arguments:args}); if(result.isError)throw Error(JSON.stringify(result));
 return result.structuredContent?.result ?? result.structuredContent ?? JSON.parse(result.content.find(x=>x.type==='text').text);
}
const unwrap=result=>result.structuredContent?.result ?? result.structuredContent ?? JSON.parse(result.content.find(x=>x.type==='text').text);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={scope:'Supporting recording of actual built Worker + actual MCP Apps SDK host bridge, synthetic loopback owner and procedural sample, opaque iframe; not native ChatGPT/Codex visual acceptance and not completion of all eight native review cases',passed:false,startedAt:new Date().toISOString(),checks:[],toolSteps:[],console:[],pageErrors:[],deniedRequests:[],runtimeCalls:[],hostMcpCalls:[],violations:[]};
let browser,server,context,recordedVideo;
try {
 await fs.mkdir(outputDir,{recursive:true});
 const compiledRoot=path.resolve(studio,'..','dist');
 report.build={workerSha256:sha256(await fs.readFile(path.join(compiledRoot,'server/index.js'))),nativeHtmlSha256:sha256(await fs.readFile(path.join(compiledRoot,'client/native.html'))),runtimeFiles:[]};
 for(const filename of ['ffmpeg-core.wasm.part0','ffmpeg-core.wasm.part1'])report.build.runtimeFiles.push({path:'runtime/ffmpeg/'+filename,sha256:sha256(await fs.readFile(path.join(compiledRoot,'client/runtime/ffmpeg',filename)))});
 const samplePath=path.join(outputDir,'review-sample.mp4');
 execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','libx264','-preset','veryfast','-crf','28','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k',samplePath]);
 const created=await call('create_project',{title:'SDK Browser Demo',category:'video',formats:[{id:'native-test',width:320,height:180}]});
 const projectId=created.manifest?.id ?? created.projectId ?? created.id; assert(projectId,'Project id missing'); report.projectId=projectId;
 const source=await fs.readFile(samplePath);
 const form=new FormData();form.set('file',new File([source],'Procedural Review Sample.mp4',{type:'video/mp4'}));form.set('metadata',JSON.stringify({durationSec:4,width:640,height:360,fps:30}));
 const uploaded=await fetch(workerOrigin+'/api/projects/'+encodeURIComponent(projectId)+'/assets',{method:'POST',headers:owner,body:form});if(!uploaded.ok)throw Error(await uploaded.text());
 const asset=await uploaded.json();report.sourceAsset={id:asset.id,bytes:asset.bytes,mime:asset.mime};
 const component=await call('write_component',{projectId,componentId:'native-opaque-overlay',title:'SDK demo overlay',code:'export default function NativeOpaqueOverlay(){globalThis.__nativeFixtureAuthoredContext={hasEditor:!!document.querySelector(".native-header"),origin:location.origin};return <div style={{position:"absolute",left:8,top:8,width:145,height:30,background:"#00ff88",color:"#102018",fontSize:18,fontWeight:700}}>SDK BROWSER DEMO</div>}'});
 const componentAsset=component.asset ?? component;
 let snapshot=await call('get_project',{projectId});
 const head=snapshot.document?.head ?? snapshot.head ?? snapshot.versions?.at(-1)?.number ?? 1;
 await call('apply_document_ops',{projectId,expectedHead:head,ops:[{op:'update_timeline',patch:{durationFrames:120}},{op:'register_component',componentId:'native-opaque-overlay',component:{assetId:componentAsset.id,name:'NativeOpaqueOverlay'}},{op:'insert_clip',trackId:'V1',clip:{id:'native-video-clip',assetId:asset.id,start:0,duration:120,in:0,speed:1,includeSourceAudio:true}},{op:'insert_clip',trackId:'V2',clip:{id:'native-overlay-clip',componentId:'native-opaque-overlay',start:0,duration:120,in:0,speed:1,props:{}}}],note:'Synthetic SDK-browser sample setup'});
 const listing=await rpc('tools/list');
 const editorUri=listing.tools.find(tool=>tool.name==='director_open')._meta.ui.resourceUri;
 const resource=await rpc('resources/read',{uri:editorUri});
 assert.equal(resource.ttlMs,0);assert.equal(resource.cacheScope,'private');
 const content=resource.contents[0];
 const launch=await rpc('tools/call',{name:'director_open',arguments:{projectId}});
 const parsed=new JSDOM(content.text).window.document;
 report.resource={uri:content.uri,mimeType:content.mimeType,bytes:Buffer.byteLength(content.text),metadata:content._meta,externalBootScriptSources:[...parsed.querySelectorAll('script[src]')].map(x=>x.getAttribute('src')),externalStylesheets:[...parsed.querySelectorAll('link[rel="stylesheet"]')].map(x=>x.getAttribute('href')),inlineScriptCount:parsed.querySelectorAll('script:not([src])').length,fontDataUrls:[...content.text.matchAll(/data:font\//g)].length};
 const hostCsp="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: https://esm.sh; style-src 'unsafe-inline'; font-src data: blob:; img-src data: blob:; media-src data: blob:; worker-src blob:; connect-src blob: data: https://esm.sh; frame-src "+workerOrigin+" blob:; base-uri "+workerOrigin+"; form-action 'none'";
 report.hostPolicy={iframeSandbox:'allow-scripts allow-downloads',iframeOrigin:'opaque (no allow-same-origin)',source:'Deliberately constrained test host policy without unsafe-eval, allowing only packaged inline/blob and Wasm evaluation plus declared esm.sh origin. This is not a claim about ChatGPT default CSP.',fixtureCsp:hostCsp,resourceCsp:content._meta?.ui?.csp};
 const fixtureHtml=content.text.replace(/<head>/i,'<head><meta http-equiv="Content-Security-Policy" content="'+hostCsp+'">');
 assert.equal(report.resource.externalBootScriptSources.length,0,'External native boot scripts');
 const hostSource=`import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
window.fixture={initialized:false,errors:[],events:[]};
const client=new Client({name:'Director opaque iframe regression host',version:'1.0.0'});
try {
await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',location.href)));
const bundle=await (await fetch('/resource')).json();
const iframe=document.getElementById('view');
const bridge=new AppBridge(client,{name:'Director regression host',version:'1.0.0'},{serverTools:{},serverResources:{},logging:{},openLinks:{}},{hostContext:{displayMode:'fullscreen',availableDisplayModes:['fullscreen'],theme:'dark'}});
bridge.oninitialized=async()=>{window.fixture.initialized=true;window.fixture.events.push('ui/notifications/initialized');await bridge.sendToolInput({arguments:{projectId:bundle.projectId}});await bridge.sendToolResult(bundle.launch);window.fixture.events.push('tool-input/result-sent');};
bridge.onrequestdisplaymode=async({mode})=>({mode});
bridge.onloggingmessage=(params)=>window.fixture.events.push({logging:params});
bridge.onerror=error=>window.fixture.errors.push(String(error));
await bridge.connect(new PostMessageTransport(iframe.contentWindow,iframe.contentWindow));
window.fixture.bridge=bridge;window.fixture.client=client;
iframe.srcdoc=bundle.html;
}catch(error){window.fixture.errors.push(String(error));console.error(error);}`;
 const built=await build({stdin:{contents:hostSource,sourcefile:'director-auth-host.js',resolveDir:studio},bundle:true,write:false,platform:'browser',target:'es2022',format:'esm'});
 const hostJs=built.outputFiles[0].contents;
 server=http.createServer(async(req,res)=>{
  try {
   if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;background:#101014;font-family:Arial,sans-serif;color:white}header{height:80px;padding:10px 20px;background:#181824;border-bottom:1px solid #555}header strong{font-size:18px}#demo-caption{font-size:14px;margin-top:6px}#view{display:block;border:0;width:100vw;height:calc(100vh - 380px)}#evidence{height:300px;padding:12px 20px;background:#191b25;border-top:2px solid #7385a0}#demo-step{font-size:15px;font-weight:bold;margin-bottom:8px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:18px}.cards label{font-size:13px;color:#b8c7dc}.cards pre{margin:5px 0 0;font:13px/1.35 monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#e8f5ff;max-height:145px;overflow:hidden}</style></head><body><header><strong>AI Director Studio — SDK-Browsertest · synthetisches Beispielprojekt auf Loopback</strong><div id="demo-caption">Echter gebauter Editor + Worker. Unterstützende Aufnahme; keine native ChatGPT/Codex-Aufnahme.</div></header><iframe id="view" sandbox="allow-scripts allow-downloads"></iframe><section id="evidence"><div id="demo-step">Testhost stellt skriptgesteuerte SDK-Anfragen; kein Modell oder kostenpflichtiger Auftrag.</div><div class="cards"><div><label>Skriptgesteuerte SDK-Tool-Anfrage / UI-Aktion</label><pre id="demo-request">Vorbereitetes 4-Sekunden-Testvideo + TSX-Overlay öffnen.</pre></div><div><label>Antwort des echten Workers / beobachtetes UI-Ergebnis (Auszug)</label><pre id="demo-response">SDK-Verbindung und Editor werden geprüft…</pre></div></div></section><script type="module" src="/host.js"></script></body></html>');return;}
   if(req.url==='/host.js'){res.setHeader('content-type','text/javascript');res.end(hostJs);return;}
   if(req.url==='/resource'){res.setHeader('content-type','application/json');res.end(JSON.stringify({html:fixtureHtml,launch,projectId}));return;}
   if(req.url==='/mcp'){
    const parts=[];for await(const chunk of req)parts.push(chunk);const bytes=Buffer.concat(parts);
    let message;try{message=JSON.parse(bytes)}catch{}
    let runtimeCall;
    if(message){report.hostMcpCalls.push({method:message.method,tool:message.params?.name});const args=message.params?.arguments;if(args?.path?.startsWith('/api/runtime-file')){runtimeCall={path:args.path,startedAt:Date.now()};report.runtimeCalls.push(runtimeCall);}}
    const response=await fetch(workerOrigin+'/mcp',{method:req.method,headers:{...owner,'content-type':'application/json',accept:req.headers.accept??'application/json, text/event-stream',...(req.headers['mcp-protocol-version']?{'mcp-protocol-version':req.headers['mcp-protocol-version']}:{})},...(!['GET','HEAD'].includes(req.method)?{body:bytes}:{})});
    const responseBytes=Buffer.from(await response.arrayBuffer());
    if(runtimeCall){runtimeCall.ms=Date.now()-runtimeCall.startedAt;runtimeCall.wireBytes=responseBytes.length;try{const parsed=JSON.parse(responseBytes);const file=parsed.result?.structuredContent;runtimeCall.bytes=file?.bytes;runtimeCall.totalBytes=file?.totalBytes;runtimeCall.mime=file?.mime}catch{}}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(responseBytes);return;
   }
   res.writeHead(401);res.end('Widget ordinary HTTP is forbidden');
  }catch(error){res.writeHead(500);res.end(String(error));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const hostOrigin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required']});
 context=await browser.newContext({viewport:{width:1280,height:960},acceptDownloads:true,recordVideo:{dir:path.join(outputDir,'recording'),size:{width:1280,height:960}}});
 await context.addInitScript(()=>{window.addEventListener('securitypolicyviolation',e=>console.warn('DIRECTOR_CSP '+JSON.stringify({blockedURI:e.blockedURI,violatedDirective:e.violatedDirective,effectiveDirective:e.effectiveDirective,originalPolicy:e.originalPolicy})));});
 const page=await context.newPage();recordedVideo=page.video();
 const caption=async text=>{await page.locator('#demo-caption').evaluate((el,text)=>el.textContent=text,text);await page.waitForTimeout(2200)};
 const cardText=value=>typeof value==='string'?value:Object.entries(value).map(([key,value])=>key+': '+JSON.stringify(value)).join('\n');
 const card=async(title,request,response,wait=4200)=>{await page.evaluate(({title,request,response})=>{document.getElementById('demo-step').textContent=title;document.getElementById('demo-request').textContent=request;document.getElementById('demo-response').textContent=response;},{title,request:cardText(request),response:cardText(response)});if(wait)await page.waitForTimeout(wait);};
 const toolStep=async(title,name,args,view=unwrap)=>{await card(title,{name,arguments:args},'Anfrage wird über den echten MCP-SDK-Client gesendet…',2000);const raw=await page.evaluate(async({name,args})=>window.fixture.client.callTool({name,arguments:args}),{name,args});const step={title,name,arguments:args,response:raw,recordedAt:new Date().toISOString()};report.toolSteps.push(step);await card(title,{name,arguments:args},view(raw));return raw;};
 page.on('console',message=>{const entry={type:message.type(),text:message.text().slice(0,4000)};report.console.push(entry);if(entry.text.startsWith('DIRECTOR_CSP '))report.violations.push(JSON.parse(entry.text.slice(13)));});
 page.on('pageerror',error=>report.pageErrors.push(String(error)));
 await context.route(/^https?:\/\//,async(route)=>{
  const request=route.request();let frame;try{frame=request.frame()}catch{}
  const requestUrl=new URL(request.url());
  const hostAllowed=frame===page.mainFrame()&&requestUrl.origin===hostOrigin&&['/','/host.js','/resource','/mcp'].includes(requestUrl.pathname);
  if(hostAllowed)return route.continue();
  report.deniedRequests.push({url:request.url(),method:request.method(),origin:frame?.url(),status:401});
  return route.fulfill({status:401,contentType:'text/plain',headers:{'access-control-allow-origin':hostOrigin},body:'Private widget ordinary HTTP denied'});
 });
 await page.goto(hostOrigin);await page.waitForFunction(()=>window.fixture?.initialized,null,{timeout:45000});
 const frame=page.frames().find(x=>x!==page.mainFrame());assert(frame,'Missing iframe');
 await frame.locator('.native-header h1').waitFor({state:'visible',timeout:60000});assert.match(await frame.locator('.native-header h1').innerText(),/SDK Browser Demo/);
 await caption('Gespeichertes Video-Projekt: Material, Vorschau und Timeline im echten gebauten Editor.');
 report.handshake=await page.evaluate(()=>({initialized:window.fixture.initialized,events:window.fixture.events,errors:window.fixture.errors}));
 report.frame=await frame.evaluate(()=>({href:location.href,origin:location.origin,baseURI:document.baseURI,readyState:document.readyState,bodyText:document.body.innerText.slice(0,1000)}));
 report.fonts=await frame.evaluate(async()=>{await document.fonts.ready;return {status:document.fonts.status,faces:document.fonts.size}});
 assert.equal(report.frame.origin,'null');report.checks.push('Actual SDK App/Bridge initialize handshake and visible editor in an opaque srcdoc iframe.');
 await card('1 · Echtes gespeichertes Sample im SDK-Testhost',{name:'director_open',arguments:{projectId}},{title:created.manifest?.title??'SDK Browser Demo',category:'video',sample:'procedural testsrc2 + sine',durationSec:4,iframeOrigin:report.frame.origin});
 report.widgetHttpBeforeGuardProbes=report.deniedRequests.length;
 report.denialGuardProbes=await page.evaluate(async({hostOrigin,privateOrigin})=>Promise.all(['/assets/editor.js','/fonts/Inter.woff2','/runtime/esbuild.wasm','/media-sandbox.html','/native-sandbox.html',privateOrigin+'/assets/editor.js'].map(async p=>{const url=p.startsWith('https:')?p:hostOrigin+p;const response=await fetch(url);return {url,status:response.status}})),{hostOrigin,privateOrigin});
 assert(report.denialGuardProbes.every(p=>p.status===401),'Ordinary HTTP denial rule ineffective');
 console.log('Native SDK handshake and editor visible; waiting for decoded sandbox video canvas');
 const previewElement=await frame.locator('iframe[title="Director media preview"]').elementHandle();assert(previewElement);const previewFrame=await previewElement.contentFrame();assert(previewFrame);
 await previewFrame.waitForFunction(()=>[...document.querySelectorAll('canvas')].some(canvas=>{try{if(!canvas.width||!canvas.height)return false;const ctx=canvas.getContext('2d');if(!ctx)return false;const pixel=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let n=0;n<pixel.length;n+=Math.max(4,Math.floor(pixel.length/4096/4)*4))if(pixel[n]+pixel[n+1]+pixel[n+2]>30&&pixel[n+3]>0)return true;return false}catch{return false}}),null,{timeout:120000});
 report.preview=await previewFrame.evaluate(()=>({origin:location.origin,authoredContext:globalThis.__nativeFixtureAuthoredContext,overlayText:document.body.innerText,canvases:[...document.querySelectorAll('canvas')].map(canvas=>{const pixels=canvas.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data;let nonBlack=0,opaque=0;for(let n=0;pixels&&n<pixels.length;n+=Math.max(4,Math.floor(pixels.length/4096/4)*4)){if(pixels[n]+pixels[n+1]+pixels[n+2]>30)nonBlack++;if(pixels[n+3]>0)opaque++;}return {width:canvas.width,height:canvas.height,nonBlackSamples:nonBlack,opaqueSamples:opaque}})}));
 assert.equal(report.preview.origin,'null');assert(report.preview.canvases.some(c=>c.nonBlackSamples>20));assert.match(report.preview.overlayText,/SDK BROWSER DEMO/);report.checks.push('Owned stored video loaded through authenticated MCP asset chunks, WebVideo canvas contains decoded nonblack pixels and isolated preview shows its exact TSX overlay.');
 await caption('Video und geschriebene Codekomponente erscheinen in einer isolierten Browser-Vorschau.');
 const initialClock=await frame.getByRole('timer').innerText();await frame.getByRole('button',{name:/^(Abspielen|Play)$/}).click();
 const advancedClock=await frame.waitForFunction(initial=>{const value=document.querySelector('[role="timer"]')?.innerText;return value&&value!==initial?value:false},initialClock,{timeout:10000});
 report.playback={before:initialClock,after:await advancedClock.jsonValue()};await page.waitForTimeout(1200);const pause=frame.getByRole('button',{name:/^(Anhalten|Pause|Pausieren)$/});await pause.click();await frame.getByRole('button',{name:/^(Abspielen|Play)$/}).waitFor({state:'visible'});report.playback.pausedAt=await frame.getByRole('timer').innerText();report.checks.push('Pointer play control advances the actual isolated preview timeline clock, then the pause control stops it before screenshot.');
 const sourceCard=frame.locator(`[role="listitem"][data-asset-id="${asset.id}"]`);await sourceCard.locator('.asset-icon svg').waitFor({state:'visible'});
 report.assetBrowser=await frame.evaluate(assetId=>{const cards=[...document.querySelectorAll('[role="listitem"][data-asset-id]')],card=cards.find(c=>c.getAttribute('data-asset-id')===assetId),icon=card.querySelector('.asset-icon svg');return {brokenImages:cards.flatMap(c=>[...c.querySelectorAll('img')].filter(i=>i.complete&&i.naturalWidth===0).map(i=>({assetId:c.getAttribute('data-asset-id'),source:i.currentSrc}))),sourceCardImageCount:card.querySelectorAll('img').length,videoFallbackIcon:{width:icon.getAttribute('width'),height:icon.getAttribute('height'),path:icon.querySelector('path')?.getAttribute('d')}}},asset.id);
 assert.equal(report.assetBrowser.brokenImages.length,0,'Broken asset browser image');assert.equal(report.assetBrowser.sourceCardImageCount,0,'Video without thumbnail must not create MP4-backed img');assert.equal(report.assetBrowser.videoFallbackIcon.width,'22');assert.equal(report.assetBrowser.videoFallbackIcon.path,'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4');
 report.checks.push('Stored video without thumbnail metadata shows the film icon, creates no MP4-backed img, and the asset browser contains zero broken images.');
 await caption('Abspielen und Pause bewegen den Timeline-Zähler. Die Materialkarte nutzt das passende Video-Symbol.');
 await card('2 · Echte Vorschau / Pointer-Abspielen und Pause','UI: Abspielen → Pause',report.playback);
 const collapsedStage=frame.locator('.stage-collapse[aria-expanded="false"]');if(await collapsedStage.count())await collapsedStage.click();
 await frame.locator('[data-clip-id="native-video-clip"]').first().click({modifiers:['Alt']});
 await frame.locator('.native-ref-chips button').first().waitFor({state:'visible'});
 report.selection={chips:await frame.locator('.native-ref-chips').innerText(),status:await frame.locator('.native-context-status').innerText(),copyButtonVisible:await frame.locator('.native-context').getByRole('button',{name:/^(Kopieren|Copy)$/}).isVisible(),clipboardWriteVerified:false};
 assert.match(report.selection.status,/Kontext kopieren|Copy context/);assert(report.selection.copyButtonVisible);
 report.checks.push('Actual Alt-click selects the imported timeline clip; UI offers its real copy-context fallback. Clipboard write and native Composer attachment are not claimed.');
 await card('3 · Clipauswahl und echter Kontext-Fallback','UI: Alt-Klick auf den importierten Timeline-Clip',report.selection);
 const observed=await toolStep('4 · Aktuellen Dokumentkopf vor Änderung lesen','get_project',{projectId},raw=>{const s=unwrap(raw);return {title:s.manifest.title,head:s.versions.at(-1).number,markers:s.document.markers};});
 assert(!observed.isError);const observedSnapshot=unwrap(observed);const expectedHead=observedSnapshot.versions.at(-1).number;
 const marker={id:'sdk-review-marker',frame:60,kind:'note',label:'SDK review marker'};
 const markerArgs={projectId,expectedHead,ops:[{op:'add_marker',marker}],note:'Scripted SDK review: add a named sample marker'};
 const applied=await toolStep('5 · Echte SDK-Änderung mit beobachtetem expectedHead','apply_document_ops',markerArgs,raw=>{const value=unwrap(raw);return {isError:!!raw.isError,number:value.number,note:value.note,markers:value.document?.markers};});
 assert(!applied.isError);const newHead=unwrap(applied).number;assert.equal(newHead,expectedHead+1);
 await frame.locator('.native-header').getByRole('button',{name:'v'+newHead,exact:true}).waitFor({state:'visible',timeout:10000});
 await frame.locator('[data-marker-id="sdk-review-marker"]').first().waitFor({state:'visible'});
 report.markerEdit={expectedHead,newHead,marker,visibleVersion:await frame.locator('.native-header').getByRole('button',{name:'v'+newHead,exact:true}).innerText()};
 report.checks.push('Real MCP apply_document_ops adds a named marker with the last observed expectedHead; already-open UI advances exactly one version and shows the actual marker.');
 await caption('Der echte Worker hat den Marker gespeichert; der offene Editor zeigt die neue Version.');
 const conflict=await toolStep('6 · Derselbe veraltete expectedHead wird wirklich zurückgewiesen','apply_document_ops',markerArgs,raw=>({isError:!!raw.isError,...unwrap(raw)}));
 assert.equal(conflict.isError,true);assert.equal(unwrap(conflict).code,'VERSION_CONFLICT');
 snapshot=await call('get_project',{projectId});assert.equal(snapshot.versions.at(-1).number,newHead);assert.equal(snapshot.document.markers.filter(m=>m.id===marker.id).length,1);
 report.staleConflict={response:conflict,headAfter:snapshot.versions.at(-1).number,markerCountAfter:snapshot.document.markers.filter(m=>m.id===marker.id).length};
 report.checks.push('Replay of the identical stale edit receives actual VERSION_CONFLICT from the Worker; no extra version or duplicate marker is created.');
 await frame.locator('.player-box').screenshot({path:path.join(outputDir,'sdk-preview.png')});
 const editorScreenshot=path.join(outputDir,'sdk-editor.png');await fs.mkdir(path.dirname(editorScreenshot),{recursive:true});await frame.locator('body').screenshot({path:editorScreenshot});
 report.editorScreenshot={path:editorScreenshot,scope:'Actual SDK authenticated opaque iframe regression host; not the native ChatGPT app'};
 await caption('Der SDK-Testhost stellt einen echten MCP-Exportauftrag. Kein Modell oder kostenpflichtiger Fal-Auftrag läuft.');
 const exportResult=await toolStep('7 · Echter MP4-Exportauftrag über den SDK-Client','export_project',{projectId,input:{target:'mp4',format:'native-test'}},raw=>{const value=unwrap(raw);return {id:value.id,kind:value.kind,status:value.status,input:value.input};});
 if(exportResult.isError)throw Error(JSON.stringify(exportResult));const job=exportResult.structuredContent?.result??exportResult.structuredContent;report.exportRequested=job;
 console.log('Stored video and component sandbox preview passed; real export queued');
 const jobId=job.id??job.job?.id;assert(jobId,'Export job missing id');
 const deadline=Date.now()+180000;let completed;
 while(Date.now()<deadline){snapshot=await call('get_project',{projectId});completed=snapshot.jobs?.find(x=>x.id===jobId);if(['completed','failed','canceled'].includes(completed?.status))break;await new Promise(resolve=>setTimeout(resolve,500));}
 report.exportJob=completed;report.generatedIsolation={preview:report.preview.authoredContext,outerAfterExport:await frame.evaluate(()=>globalThis.__nativeFixtureAuthoredContext??null)};
 assert.equal(report.generatedIsolation.preview?.hasEditor,false);assert.equal(report.generatedIsolation.outerAfterExport,null,'Authored component executed in authenticated outer editor');
 assert.equal(completed?.status,'completed',completed?.error??'Export did not complete');
 assert(completed.output?.assetIds?.length);const outputAsset=snapshot.assets.find(x=>x.id===completed.output.assetIds[0]);report.outputAsset={id:outputAsset.id,mime:outputAsset.mime,bytes:outputAsset.bytes};
 const output=await fetch(workerOrigin+'/api/projects/'+encodeURIComponent(projectId)+'/assets/'+encodeURIComponent(outputAsset.id),{headers:owner});assert(output.ok);const outputPath=path.join(outputDir,'sdk-export.mp4');await fs.writeFile(outputPath,new Uint8Array(await output.arrayBuffer()));
 report.ffprobe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',outputPath],{encoding:'utf8'}));
 assert(report.ffprobe.streams.some(x=>x.codec_type==='video'));assert(Math.abs(Number(report.ffprobe.format.duration)-4)<0.2);
 const firstFrame=execFileSync('ffmpeg',['-v','error','-i',outputPath,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:4_000_000});let brightGreen=0,nonBlack=0;
 for(let i=0;i<firstFrame.length;i+=3){if(firstFrame[i]+firstFrame[i+1]+firstFrame[i+2]>30)nonBlack++;if(firstFrame[i]<80&&firstFrame[i+1]>180&&firstFrame[i+2]>60&&firstFrame[i+2]<180)brightGreen++;}
 report.exportPixels={decodedRgbBytes:firstFrame.length,nonBlackPixels:nonBlack,authoredGreenOverlayPixels:brightGreen};assert(brightGreen>1000,'Authored overlay absent from decoded MP4 first frame');
 const completionRead=await toolStep('8 · Echter Abschlussbeleg und gespeicherte Ausgabedatei','get_project',{projectId},raw=>{const s=unwrap(raw),j=s.jobs.find(x=>x.id===jobId),a=s.assets.find(x=>x.id===j.output?.assetIds?.[0]);return {job:{id:j.id,status:j.status,output:j.output},asset:{id:a.id,mime:a.mime,bytes:a.bytes}};});
 assert(!completionRead.isError);
 await frame.locator('.native-header').getByRole('button',{name:/^(Projekte|Projects)$/,exact:true}).click();
 const projectButton=frame.getByRole('button',{name:/SDK Browser Demo/}).first();await projectButton.waitFor({state:'visible'});
 await card('9 · Gespeichertes Projekt über die echte Projektliste wieder öffnen','UI: Projekte → SDK Browser Demo','Projektliste zeigt das gespeicherte synthetische Sample.');
 await projectButton.click();await frame.locator('.native-header h1').waitFor({state:'visible'});
 await frame.locator('.native-header').getByRole('button',{name:'v'+newHead,exact:true}).waitFor({state:'visible'});
 if(await collapsedStage.count())await collapsedStage.click();
 await frame.locator('[data-marker-id="sdk-review-marker"]').first().waitFor({state:'visible'});
 const storedOutputCard=frame.locator(`[role="listitem"][data-asset-id="${outputAsset.id}"]`);await storedOutputCard.waitFor({state:'visible',timeout:15000});await storedOutputCard.scrollIntoViewIfNeeded();
 const reopened=await toolStep('10 · Tatsächliche Persistenz nach UI-Wiederöffnen prüfen','get_project',{projectId},raw=>{const s=unwrap(raw),j=s.jobs.find(x=>x.id===jobId),a=s.assets.find(x=>x.id===outputAsset.id);return {title:s.manifest.title,head:s.versions.at(-1).number,marker:s.document.markers.find(x=>x.id===marker.id),exportStatus:j.status,output:{id:a.id,mime:a.mime,bytes:a.bytes}};});
 assert(!reopened.isError);const persisted=unwrap(reopened);assert.equal(persisted.versions.at(-1).number,newHead);assert.equal(persisted.document.markers.filter(m=>m.id===marker.id).length,1);assert.equal(persisted.jobs.find(x=>x.id===jobId).status,'completed');assert(persisted.assets.some(x=>x.id===outputAsset.id));
 report.reopen={head:persisted.versions.at(-1).number,marker:persisted.document.markers.find(x=>x.id===marker.id),exportStatus:persisted.jobs.find(x=>x.id===jobId).status,outputAssetId:outputAsset.id,uiMarkerVisible:true,uiOutputCardVisible:true};
 report.checks.push('Actual Projects navigation reopens the same stored project; named marker, exact head version, completed MP4 job and stored output persist and are visible again.');
 await page.screenshot({path:path.join(outputDir,'sdk-reopened.png')});
 report.runtimeSummary=Object.values(report.runtimeCalls.reduce((all,x)=>{const pathname=new URL(x.path,workerOrigin).searchParams.get('path');const entry=all[pathname]??={path:pathname,chunks:0,totalBytes:x.totalBytes,bytesTransferred:0,jsonWireBytes:0,serverMs:0};entry.chunks++;entry.bytesTransferred+=x.bytes??0;entry.jsonWireBytes+=x.wireBytes??0;entry.serverMs+=x.ms??0;return all},{}));
 assert(report.runtimeSummary.some(x=>x.path==='/native-sandbox.html'),'Native sandbox not supplied by authenticated bridge');
 assert(report.runtimeSummary.some(x=>x.path.includes('wasm')),'Codec/compiler WASM not supplied by authenticated bridge');
 report.checks.push('Real queued MP4 codec job executed by the open opaque editor, native sandbox/runtime fetched only through authenticated host MCP, output stored with persistent completion receipt and ffprobe-verified four-second video with source audio.');
 report.checks.push('The decoded MP4 first frame contains the authored green overlay also visible in preview.');
 report.checks.push('Ordinary widget HTTP was forbidden and none was initiated; six explicit private asset/runtime/sandbox guard probes returned 401. Host-side /mcp alone injected synthetic loopback owner identity.');
 report.finalFrameCount=page.frames().length;report.privateHttpDenialRule={origin:privateOrigin,allOrdinaryIframeHttp:'401',normalPaths:['/assets','/fonts','/runtime','/media-sandbox.html','/native-sandbox.html']};
 report.finalHostErrors=await page.evaluate(()=>window.fixture.errors);assert.equal(report.finalHostErrors.length,0);
 await caption('Export fertig: gespeicherte H.264/AAC-Datei, vier Sekunden. SDK-Browsertest; native Funktionsabnahme bleibt separat.');
 report.passed=true;
}catch(error){report.error=String(error);report.stack=error.stack;process.exitCode=1;}
finally{report.console=report.console.filter(x=>x.type!=='debug');report.finishedAt=new Date().toISOString();await fs.mkdir(path.dirname(evidence),{recursive:true});await fs.writeFile(evidence,JSON.stringify(report,null,2));await context?.close();
 if(recordedVideo){const videoPath=await recordedVideo.path();const demoPath=path.join(outputDir,'sdk-review-demo.mp4');execFileSync('ffmpeg',['-v','error','-y','-i',videoPath,'-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',demoPath]);const bytes=await fs.readFile(demoPath);report.recording={path:demoPath,bytes:bytes.length,sha256:sha256(bytes),scope:'Actual recorded SDK-browser interactions with synthetic loopback owner and procedural media; supporting evidence only, not native ChatGPT/Codex capture or all eight native review cases',probe:JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',demoPath],{encoding:'utf8'}))};await fs.writeFile(evidence,JSON.stringify(report,null,2));}
 await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());console.log(JSON.stringify({passed:report.passed,error:report.error,resourceBytes:report.resource?.bytes,handshake:report.handshake?.initialized,runtime:report.runtimeSummary,exportStatus:report.exportJob?.status,evidence},null,2));}
