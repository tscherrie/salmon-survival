// Anonymous/static access diagnostics only. A Sites dispatch token is not an owner identity.
// Usage: node live-acceptance.mjs https://site.chatgpt.site [report.json] [--token-stdin]
import {writeFile} from 'node:fs/promises';

const args=process.argv.slice(2),withToken=args.includes('--token-stdin');
const [site,output]=args.filter(arg=>arg!=='--token-stdin');
if(!site)throw Error('Provide an HTTPS Site origin; optionally add --token-stdin for the static health probe.');
const url=new URL(site);
if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Expected an HTTPS Site origin without credentials or a path.');
const origin=url.origin;

async function hiddenToken(){
 const terminal=process.stdin.isTTY;
 if(terminal){process.stdin.setRawMode(true);process.stderr.write('Sites dispatch token (hidden; static health only): ');}
 try{
  return await new Promise((resolve,reject)=>{
   let value='';
   const finish=error=>{process.stdin.removeListener('data',onData);process.stdin.removeListener('end',onEnd);process.stdin.pause();error?reject(error):resolve(value.trim());};
   const onData=chunk=>{value+=chunk;if(value.includes('\u0003'))finish(Error('Canceled'));else if(value.length>65536)finish(Error('Input too large'));else if(/[\r\n]/.test(value))finish();};
   const onEnd=()=>finish();
   process.stdin.setEncoding('utf8');process.stdin.on('data',onData);process.stdin.on('end',onEnd);process.stdin.resume();
  });
 }finally{if(terminal){process.stdin.setRawMode(false);process.stderr.write('\n');}}
}

const token=withToken?await hiddenToken():undefined;
if(withToken&&!token)throw Error('Expected a token on hidden stdin.');
const denied=status=>[302,303,307,308,401,403].includes(status);
const report={origin,scope:'anonymous/static-access-diagnostic',checks:[],passed:false,
 proof:{authenticatedMcp:false,d1:false,r2:false,nativeHostUi:false},
 note:'Sites dispatch access does not establish an authenticated Director owner. Native OAuth MCP and storage evidence must be recorded separately.'};

async function probe(path,headers){
 const response=await fetch(`${origin}${path}`,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});
 const result={status:response.status,mime:response.headers.get('content-type'),access:denied(response.status)?'access-denied':response.ok?'accessible':'unexpected-status'};
 if(path==='/health'&&response.ok){
  const body=await response.json();result.runtime=body.director;
  if(body.director!=='native-host')throw Error('Unexpected static health runtime marker.');
 }else await response.body?.cancel();
 return result;
}

try{
 const paths=['/api/projects','/health','/media-sandbox.html','/runtime/ffmpeg/worker.js','/runtime/esbuild.wasm','/privacy.html'];
 const results=await Promise.all(paths.map(path=>probe(path)));
 report.anonymous=Object.fromEntries(paths.map((path,index)=>[path,results[index]]));
 if(!denied(report.anonymous['/api/projects'].status))throw Error('Anonymous project API was not denied.');
 report.checks.push('Anonymous project API access is denied.');
 for(const path of paths.slice(1))if(report.anonymous[path].access==='unexpected-status')throw Error(`Anonymous static probe ${path}: HTTP ${report.anonymous[path].status}`);
 report.checks.push('Anonymous health and static resources report either accessible content or a private access boundary.');
 if(token){
  report.dispatchHealth=await probe('/health',{'OAI-Sites-Authorization':`Bearer ${token}`});
  if(report.dispatchHealth.access==='unexpected-status')throw Error(`Dispatch static health: HTTP ${report.dispatchHealth.status}`);
  report.checks.push('Optional Sites dispatch token was used only for static health; no owner or MCP inference was made.');
 }
 report.passed=true;
}catch(error){report.error=error.message;}
if(output)await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
