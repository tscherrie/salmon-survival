#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Use verify.mjs SOURCE_COLLECTION');
const lock=JSON.parse(await readFile(join(here,'source-lock.json')));
let checks=0;
const verify=async(path,row)=>{
 const bytes=await readFile(path);
 if(bytes.length!==row.bytes||createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw new Error('Integrity mismatch: '+path);
 checks++;
};
for(const row of Object.values(lock.sources))await verify(join(root,row.archive),row);
for(const row of [lock.aacNewSource,...lock.encoderToolchainSources])await verify(join(root,'rebuild/sources',row.archive),row);
if(lock.coreRecipePatch)await verify(join(here,lock.coreRecipePatch.filename),lock.coreRecipePatch);
for(const row of lock.apt.downloadedDebs)await verify(join(root,'rebuild/core-toolchain-lock/debs',row.filename),row);
for(const attempt of lock.attempts)for(const row of attempt.rawEvidence??[])await verify(join(root,attempt.externalDirectory,row.filename),row);
for(const [target,build] of Object.entries(lock.completedBuilds)){
 for(const row of build.scripts)await verify(join(here,row.filename),row);
 for(const row of build.outputs)await verify(join(root,build.externalDirectory,row.filename),row);
 for(const row of build.rawBuildEvidence)await verify(join(root,build.externalDirectory,row.filename),row);
 for(const row of build.acceptedMedia??[])await verify(join(root,build.externalDirectory,row.filename),row);
 for(const row of build.executedContext?.buildScripts??[])await verify(join(root,build.executedContext.externalDirectory,row.filename),row);
}
const acceptance=JSON.parse(await readFile(join(here,'receipts/flac-browser-acceptance.json')));
await verify(join(root,lock.completedBuilds.flac.externalDirectory,'synthetic-stereo.flac'),{bytes:acceptance.outputBytes,sha256:acceptance.outputSha256});
console.log(JSON.stringify({passed:true,checks,ownFlacOutputAcceptance:acceptance.passed,ownAacOutputAcceptance:lock.completedBuilds['aac-classic'].outputAcceptance.status==='passed',ownMp3OutputAcceptance:lock.completedBuilds.mp3.outputAcceptance.status==='passed',fullCoreCompiled:Boolean(lock.completedBuilds.core),ownCoreOutputAcceptance:lock.completedBuilds.core?.outputAcceptance.status==='passed',shippedRuntimeChanged:false,realNativeHostAcceptanceClaimed:false},null,2));
