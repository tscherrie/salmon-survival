#!/usr/bin/env node
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const [target,sourceArgument,outputArgument,context='colima']=process.argv.slice(2);
if(!['flac','aac','mp3','mp3-relink','flac-classic'].includes(target)||!sourceArgument||!outputArgument)throw new Error('Use run-build.mjs flac|aac|mp3|mp3-relink|flac-classic SOURCE_COLLECTION OUTPUT_DIRECTORY [docker-context]');
const sources=resolve(sourceArgument),output=resolve(outputArgument);
const lock=JSON.parse(await readFile(join(here,'source-lock.json')));
const hash=b=>createHash('sha256').update(b).digest('hex');
const mapping={flac:['flac','mediabunny-encoders'],aac:['mediabunny-encoders'],mp3:['lame-official','mediabunny-encoders'],'mp3-relink':['mediabunny-encoders'],'flac-classic':['flac','mediabunny-encoders']};
for(const name of mapping[target]){
 const row=lock.sources[name],bytes=await readFile(join(sources,row.archive));
 if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw new Error('Source integrity mismatch: '+row.archive);
}
if(target==='aac'){
 const row=lock.aacNewSource,bytes=await readFile(join(sources,'rebuild/sources',row.archive));
 if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw new Error('AAC source integrity mismatch');
}
if(target==='flac-classic'){
 const bytes=await readFile(join(output,'libFLAC.a'));
 if(hash(bytes)!==lock.completedBuilds.flac.outputs.find(f=>f.filename==='libFLAC.a').sha256)throw new Error('Classic link requires the recorded original owned FLAC archive');
}
await mkdir(output,{recursive:true});
const script=target==='flac-classic'?'link-flac-classic.sh':'build-'+target+'.sh';
const image=lock.toolchains.encoders.image;
if(!/^emscripten\/emsdk@sha256:[a-f0-9]{64}$/.test(image))throw new Error('Unpinned build image');
const args=['--context',context,'run','--rm','--platform','linux/arm64','--network','none','--mount','type=bind,src='+sources+',dst=/sources,readonly','--mount','type=bind,src='+join(sources,'rebuild/sources')+',dst=/new-sources,readonly','--mount','type=bind,src='+here+',dst=/recipe,readonly','--mount','type=bind,src='+output+',dst=/out',image,'bash','/recipe/'+script];
const startedAt=new Date().toISOString();
const receipt={target,startedAt,image,sourceLockSha256:hash(await readFile(join(here,'source-lock.json'))),scriptSha256:hash(await readFile(join(here,script))),argv:args,status:'running',siteRuntimeModified:false};
await writeFile(join(output,'run-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
const child=spawn('docker',args,{stdio:'inherit'});
const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
receipt.finishedAt=new Date().toISOString();receipt.exitCode=exitCode;receipt.status=exitCode===0?'compiled':'failed';
await writeFile(join(output,'run-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
if(exitCode!==0)process.exitCode=exitCode??1;
