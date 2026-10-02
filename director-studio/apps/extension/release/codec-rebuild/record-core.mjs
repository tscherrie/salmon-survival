#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const [collectionArgument,outputArgument]=process.argv.slice(2);
if(!collectionArgument||!outputArgument)throw new Error('Use record-core.mjs SOURCE_COLLECTION ACCEPTED_CORE_OUTPUT');
const collection=resolve(collectionArgument),output=resolve(outputArgument),externalDirectory=relative(collection,output);
if(!externalDirectory||externalDirectory.startsWith('..'))throw new Error('Core outputs must stay in the owned source collection');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const row=async(directory,filename)=>{const bytes=await readFile(join(directory,filename));return {filename,bytes:bytes.length,sha256:hash(bytes)};};
const receipt=JSON.parse(await readFile(join(output,'run-receipt.json'),'utf8'));
const acceptance=JSON.parse(await readFile(join(output,'browser-acceptance.json'),'utf8'));
const esmAcceptance=JSON.parse(await readFile(join(output,'esm-browser-acceptance.json'),'utf8'));
const lock=JSON.parse(await readFile(join(here,'source-lock.json'),'utf8'));
const sourceChain=JSON.parse(await readFile(join(output,'source-chain-proof.json'),'utf8'));
const sourceAudit=JSON.parse(await readFile(join(output,'independent-source-audit.json'),'utf8'));
const byteComparison=JSON.parse(await readFile(join(output,'final-exported-byte-comparison.json'),'utf8'));
if(receipt.status!=='compiled'||receipt.exitCode!==0||receipt.compilerImage!==lock.toolchains.core.immutableImage)throw new Error('Successful pinned Core compile receipt is required');
if(!acceptance.passed||acceptance.ownCore!==true||acceptance.fixtureValidationOnly!==false||acceptance.realNativeHostAcceptanceClaimed!==false)throw new Error('Actual own-byte local browser acceptance is required');
if(!esmAcceptance.passed||esmAcceptance.diagnosticOnly!==false||esmAcceptance.ownCore!==true||esmAcceptance.fixtureValidationOnly!==false||esmAcceptance.variant!=='esm-module-blob-worker'||!esmAcceptance.decodedPcmEqualsInput||esmAcceptance.realNativeHostAcceptanceClaimed!==false)throw new Error('Actual own-byte ESM module-worker output/decode acceptance is required');
const contextLock=await readFile(join(receipt.context,'SOURCE-LOCK.json'));
const dockerfile=await readFile(join(receipt.context,'Dockerfile'));
if(hash(contextLock)!==receipt.sourceLockSha256||hash(dockerfile)!==receipt.dockerfileSha256)throw new Error('Executed Core context changed');
if(!sourceChain.contextMatchesExecutedReceipt||sourceChain.sourceContextWasmOrStaticArchiveSeeds.length||!sourceChain.finalExport.stage79Succeeded||!sourceChain.finalExport.stage80Succeeded||sourceAudit.status!=='passed'||!sourceAudit.sourceBuildReproducesAllFourOriginalNpmFiles)throw new Error('Complete source-to-export provenance is required');
const outputs=[];
for(const variant of ['umd','esm'])for(const suffix of ['js','wasm'])outputs.push(await row(output,'artifacts/dist/'+variant+'/ffmpeg-core.'+suffix));
for(const file of outputs){const comparison=byteComparison.outputs.find(candidate=>candidate.filename===file.filename);if(!comparison||comparison.bytes!==file.bytes||comparison.sha256!==file.sha256||!comparison.directByteEqualPublishedCore01210)throw new Error('Final reproduction comparison changed: '+file.filename);}
const wasm=await readFile(join(output,'artifacts/dist/umd/ffmpeg-core.wasm'));
if(!WebAssembly.validate(wasm)||hash(wasm)!==acceptance.wasmSha256||wasm.length!==acceptance.wasmBytes)throw new Error('Accepted WASM does not match compiled output');
const esmWasm=await readFile(join(output,'artifacts/dist/esm/ffmpeg-core.wasm')),esmGlue=await readFile(join(output,'artifacts/dist/esm/ffmpeg-core.js'));
if(!WebAssembly.validate(esmWasm)||hash(esmWasm)!==esmAcceptance.wasmSha256||esmWasm.length!==esmAcceptance.wasmBytes||hash(esmGlue)!==esmAcceptance.glueSha256||esmGlue.length!==esmAcceptance.glueBytes)throw new Error('Accepted ESM artifacts do not match compiled output');
const optionalRow=async filename=>{try{return await row(output,filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const resourceAdjustmentRow=await optionalRow('resource-adjustment.json');
// The resumed runner starts with its measured limits. Preserve the earlier
// adjustment as prior history, without claiming a second live adjustment.
if(resourceAdjustmentRow)receipt.priorResourceLimitHistory=[JSON.parse(await readFile(join(output,'resource-adjustment.json'),'utf8'))];
// Preserve the original compile receipt; derived history belongs in the
// tracked summary instead of changing the audited execution record.
const scripts=[];
for(const filename of ['prepare-core.py','run-core.mjs','buildkitd.toml','core.child.js','accept-core.mjs','accept-core-esm.mjs','audit-core-source.mjs','record-core.mjs'])scripts.push(await row(here,filename));
const executedBuildScripts=[];
for(const filename of [...new Set([...dockerfile.toString().matchAll(/^COPY build\/([^\s]+\.sh) \/src\/build\.sh$/gm)].map(match=>match[1]))])executedBuildScripts.push(await row(receipt.context,'build/'+filename));
if(!executedBuildScripts.some(file=>file.filename==='build/ffmpeg-wasm.sh'))executedBuildScripts.push(await row(receipt.context,'build/ffmpeg-wasm.sh'));
const rawBuildEvidence=[];
for(const filename of ['build.log','build-metadata.json','run-receipt.json','browser-acceptance.json','esm-browser-acceptance.json','acceptance-fixture.js'])rawBuildEvidence.push(await row(output,filename));
const fixture=rawBuildEvidence.find(file=>file.filename==='acceptance-fixture.js');
if(fixture.bytes!==acceptance.runtimeUnderTest.fixtureBundleBytes||fixture.sha256!==acceptance.runtimeUnderTest.fixtureBundleSha256)throw new Error('Executed browser fixture bytes changed');
for(const filename of ['resource-adjustment.json','recovery-receipt.json','configure-proof.json','ffmpeg-configure.log','ffmpeg-config.mak','ffmpeg-config.h','ffmpeg-config-components.h','compiled-static-libraries.json','esm-x265-browser-diagnostic.json','source-chain-proof.json','compiler-base-workspace-proof.txt','final-exported-byte-comparison.json','independent-source-audit.json','vp9-browser-diagnostic.json','webm-source-fixture.json']){const file=await optionalRow(filename);if(file)rawBuildEvidence.push(file);}
for(const file of acceptance.inventoryFiles??[]){const observed=await row(output,file.filename);if(observed.bytes!==file.bytes||observed.sha256!==file.sha256)throw new Error('Accepted inventory changed: '+file.filename);rawBuildEvidence.push(observed);}
const acceptedMedia=[];for(const file of [...acceptance.files,...esmAcceptance.files])acceptedMedia.push(await row(output,file.filename));
const sourceNames=['ffmpegwasm-recipe','ffmpeg','x264','x265','libvpx','lame','ogg','theora','opus','vorbis','zlib','libwebp','freetype2','fribidi','harfbuzz','libass','zimg','zimg-googletest','sdl2'];
lock.completedBuilds.core={externalDirectory,sources:Object.fromEntries(sourceNames.map(name=>[name,lock.sources[name]])),scripts,outputs,rawBuildEvidence,acceptedMedia,compilerImage:receipt.compilerImage,buildkitImage:receipt.buildkitImage,executedContext:{externalDirectory:relative(collection,receipt.context),sourceLockSha256:receipt.sourceLockSha256,dockerfileSha256:receipt.dockerfileSha256,buildScripts:executedBuildScripts},additionalLibrarySourcePatches:[],upstreamRecipeTransforms:['HarfBuzz configure.ac have_pthread=true -> false for FFMPEG_ST=yes','Vorbis configure.ac removes -mno-ieee-fp','libvpx copies generated vpx.pc to the install pkgconfig directory'],sourceDateEpochSet:false,outputAcceptance:{status:'passed',variants:['umd-classic-blob-worker','esm-module-blob-worker'],realNativeHostAcceptanceClaimed:false,realMcpTransportClaimed:false}};
lock.coreExecution={...lock.coreExecution,status:'browser-output-accepted',finishedAtUtc:receipt.finishedAtUtc,receiptExternal:join(externalDirectory,'run-receipt.json')};
lock.completedBuilds.core.sourceCorrespondence={publishedPackage:'@ffmpeg/core@0.12.10',allFourExportedFilesDirectByteEqual:true,frozenContextHasNoWasmOrStaticArchiveSeeds:true,compiledFfmpegArchives:true,umdAndEsmActuallyLinked:true,dependencyStagesCachedFromPreservedAttempts:true,secondColdRebuildClaimed:false,historicalPublisherCheckoutTimelineAttested:false};
lock.completedBuilds.core.knownRuntimeLimits={ffprobeBinding:'The pinned wrapper discards the C return; validated ffprobe JSON is produced while Module.ret remains -1.',vp9Encoder:'Auxiliary VP9 encode crashes memory-out-of-bounds with default, single-thread realtime and good parameters. Offered WebM import/VP9 decoding passes on a known synthetic input; offered exports use H264.',x265:'Separate one-frame single-thread browser diagnostic times out at60s, also observed on the byte-identical published baseline. No codec is removed; offered H264 exports pass.'};
for(const directory of ['attempt-inventory-parser-20261002','attempt-ffprobe-return-20261002','attempt-ffprobe-binding-20261002','attempt-webm-20261002','attempt-vp9-default-20261002','attempt-vp9-singlethread-20261002','attempt-vp9-good-20261002','attempt-webm-input-path-20261002']){
 const evidence=[];for(const filename of ['browser-acceptance.json','browser-acceptance-run.log','acceptance-fixture.js','failure-receipt.json','wasm-ffprobe-call.json','webm-failure.json']){try{evidence.push(await row(join(output,directory),filename));}catch(error){if(error.code!=='ENOENT')throw error;}}
 if(evidence.length&&!lock.attempts.some(attempt=>attempt.externalDirectory===join(externalDirectory,directory)))lock.attempts.push({status:'failed-fixture-assertion-preserved',externalDirectory:join(externalDirectory,directory),rawEvidence:evidence});
}
lock.remaining=['Adopt only the recorded own-built Core/AAC/MP3/FLAC candidates and run actual authenticated native SDK preview/export/cancellation/chunk acceptance before runtime replacement.','Published AAC historical checkout/patchset is still unproven; the new AAC candidate has its own direct source/output mapping. The selected full Core inputs now reproduce all four published Core files exactly, without attesting the publisher historical checkout timeline.'];
if(['flac','aac','mp3'].some(name=>lock.completedBuilds[name].outputAcceptance.directEsmBrowserExecution!=='passed'))lock.remaining.push('Direct ESM standalone encoder acceptance is required before any untested ESM variant is adopted.');
await writeFile(join(here,'source-lock.json'),JSON.stringify(lock,null,2)+'\n');
await writeFile(join(here,'receipts/core-run.json'),JSON.stringify({...receipt,context:'external verified context; SHA256 recorded above',output:externalDirectory,nodePid:undefined,dockerPid:undefined},null,2)+'\n');
await writeFile(join(here,'receipts/core-browser-acceptance.json'),JSON.stringify(acceptance,null,2)+'\n');
await writeFile(join(here,'receipts/core-esm-browser-acceptance.json'),JSON.stringify(esmAcceptance,null,2)+'\n');
console.log(JSON.stringify({recorded:true,externalDirectory,wasmBytes:wasm.length,wasmSha256:hash(wasm),acceptedMediaFiles:acceptedMedia.length,shippedRuntimeChanged:false},null,2));
