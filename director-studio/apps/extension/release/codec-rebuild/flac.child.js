let worker;
let progress=0;
let cancelled=false;
let results=[];
let port;
async function createEncoder() {
  const glue=await (await fetch(window.CODEC_BASE+'/flac-classic.js')).text();
  const source=glue+';self.createFlacModule=Module;'+await (await fetch(window.CODEC_BASE+'/flac.worker.js')).text();
  worker=new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  worker.onerror=event=>port.postMessage({type:'error',error:String(event.message)});
  worker.onmessage=({data})=>{
    if(data.type==='error'){port.postMessage(data);return;}
    if(data.type==='ready'){
      worker.postMessage({type:'encode',frames:cancelled?96000:48000*60});
      return;
    }
    if(data.type==='progress'){
      progress++;
      if(!cancelled) {
        cancelled=true;
        worker.terminate();
        port.postMessage({type:'cancelled',afterChunks:data.encodedChunks});
        createEncoder();
      }
      return;
    }
    if(data.type==='complete'){
      let parentAccess=false;
      try {parentAccess=!!parent.document;}catch {}
      port.postMessage({...data,origin:window.origin,parentAccess,cancelled},[data.bytes,data.pcm]);
      worker.terminate();
    }
  };
  worker.postMessage({type:'init',url:window.CODEC_BASE+'/flac-classic.js'});
}
window.addEventListener('message',event=>{
 if(event.source!==parent||!event.ports[0])return;
 port=event.ports[0];
 createEncoder().catch(error=>port.postMessage({type:'error',error:String(error)}));
},{once:true});
parent.postMessage({type:'fixture-ready'},'*');
