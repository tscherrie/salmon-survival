#!/usr/bin/env node
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
if(!process.argv[2])throw new Error('Use fetch-new-sources.mjs SOURCE_COLLECTION');
const lock=JSON.parse(await readFile(join(here,'source-lock.json')));
const destination=join(resolve(process.argv[2]),'rebuild/sources');await mkdir(destination,{recursive:true});
for(const row of [lock.aacNewSource,...lock.encoderToolchainSources]){
 const path=join(destination,row.archive);let bytes;
 try{bytes=await readFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}
 const valid=b=>b.length===row.bytes&&createHash('sha256').update(b).digest('hex')===row.sha256;
 if(bytes){if(!valid(bytes))throw new Error('Existing source integrity mismatch: '+row.archive);console.log('verified '+row.archive);continue;}
 const response=await fetch(row.url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('Source HTTP '+response.status+': '+row.archive);
 bytes=Buffer.from(await response.arrayBuffer());if(!valid(bytes))throw new Error('Downloaded source integrity mismatch: '+row.archive);
 const temporary=path+'.download-'+process.pid;
 try{await writeFile(temporary,bytes,{flag:'wx'});await rename(temporary,path);}finally{await rm(temporary,{force:true});}
 console.log('downloaded and verified '+row.archive);
}
