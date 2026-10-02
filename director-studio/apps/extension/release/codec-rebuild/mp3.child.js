let worker;
let cancelled=false;
let workerGeneration=0;
let port;
async function createEncoder() {
  const generation=++workerGeneration;
  const glue=await(await fetch(window.CODEC_BASE+'/lame-classic.js')).text();
  const bridge=await(await fetch(window.CODEC_BASE+'/mp3.worker.js')).text();
  const workerUrl=URL.createObjectURL(new Blob([glue,';self.createMp3Module=createMp3Module;',bridge],{type:'text/javascript'}));
  worker=new Worker(workerUrl);
  worker.onerror=event=>port.postMessage({type:'error',error:String(event.message)});
  worker.onmessage=({data})=>{
    if(data.type==='error'){port.postMessage(data);return;}
    if(data.type==='ready'){worker.postMessage({type:'encode',frames:cancelled?96000:48000*60});return;}
    if(data.type==='progress'&&!cancelled) {
      cancelled=true;worker.terminate();URL.revokeObjectURL(workerUrl);
      port.postMessage({type:'cancelled',afterChunks:data.encodedChunks,afterSentChunks:data.sentChunks,actualOutputBytes:data.actualOutputBytes,workerGeneration:generation});
      createEncoder().catch(error=>port.postMessage({type:'error',error:String(error)}));return;
    }
    if(data.type==='complete') {
      let parentAccess=false;try{parentAccess=!!parent.document;}catch{}
      port.postMessage({...data,origin:window.origin,parentAccess,cancelled,workerGeneration:generation},[data.bytes,data.pcm,data.sourceS16]);
      worker.terminate();URL.revokeObjectURL(workerUrl);
    }
  };
  worker.postMessage({type:'init'});
}
window.addEventListener('securitypolicyviolation',event=>port?.postMessage({type:'csp-violation',directive:event.violatedDirective,blockedURI:event.blockedURI}));
window.addEventListener('message',event=>{
  if(event.source!==parent||!event.ports[0])return;
  port=event.ports[0];createEncoder().catch(error=>port.postMessage({type:'error',error:String(error)}));
},{once:true});
parent.postMessage({type:'fixture-ready'},'*');
