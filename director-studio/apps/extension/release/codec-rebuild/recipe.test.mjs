import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const lock=JSON.parse(await readFile(join(here,'source-lock.json')));
const hash=b=>createHash('sha256').update(b).digest('hex');
test('both toolchains use verified immutable OCI manifests/configs',async()=>{
 for(const [name,manifest,config] of [['core','container-manifest.json','container-config.json'],['encoders','manifest-6.0.3-arm64.json','config-6.0.3-arm64.json']]){
  const tool=lock.toolchains[name],image=tool.immutableImage??tool.image;
  assert.equal('sha256:'+hash(await readFile(join(here,manifest))),image.split('@')[1]);
  assert.equal('sha256:'+hash(await readFile(join(here,config))),tool.configDigest);
 }
});
test('all new-build sources are fixed commits or exact version archives with byte/hash locks',()=>{
 for(const row of [...Object.values(lock.sources),lock.aacNewSource,...lock.encoderToolchainSources]){
  assert.ok(row.archive);assert.ok(row.bytes>0);assert.match(row.sha256,/^[a-f0-9]{64}$/);
  assert.ok(/\/[a-f0-9]{40}$/.test(row.url)||/\/3\.100\/lame-3\.100\.tar\.gz$/.test(row.url));
 }
});
test('completed build scripts exactly match the recorded successful recipes',async()=>{
 for(const build of Object.values(lock.completedBuilds))for(const row of build.scripts){const bytes=await readFile(join(here,row.filename));assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);}
 assert.equal(lock.completedBuilds.aac.outputAcceptance.status,'passed');
 assert.equal(lock.completedBuilds['aac-classic'].outputAcceptance.status,'passed');
 assert.equal(lock.completedBuilds.mp3.outputAcceptance.status,'passed');
 assert.equal(lock.completedBuilds.flac.outputAcceptance.status,'passed');
 assert.equal(lock.coreContextPreparation.compileStarted,false);
});
test('actual FLAC receipt proves opaque abort/recovery and exact PCM roundtrip',async()=>{
 const receipt=JSON.parse(await readFile(join(here,'receipts/flac-browser-acceptance.json')));
 assert.equal(receipt.passed,true);assert.equal(receipt.decodedPcmEqualsInput,true);assert.equal(receipt.opaqueOrigin,'null');assert.equal(receipt.parentAccess,false);
 assert.equal(receipt.cancelAfterActualEncodeChunks,1);assert.equal(receipt.recoveryEncodedChunks,24);assert.equal(receipt.frames,96000);assert.deepEqual(receipt.pageErrors,[]);assert.equal(receipt.realNativeHostAcceptanceClaimed,false);
});
test('own Core receipts prove offered outputs, decoding, isolation and actual abort recovery',async()=>{
 const receipt=JSON.parse(await readFile(join(here,'receipts/core-browser-acceptance.json')));
 const esm=JSON.parse(await readFile(join(here,'receipts/core-esm-browser-acceptance.json')));
 assert.equal(receipt.passed,true);assert.equal(receipt.ownCore,true);assert.equal(receipt.fixtureValidationOnly,false);
 assert.equal(receipt.files.length,16);assert.equal(receipt.decodedChecks.files.length,16);
 assert.equal(receipt.checks.origin,'null');assert.equal(receipt.checks.parentAccess,false);
 assert.deepEqual(receipt.ordinaryRuntimeHttpRequests,[]);assert.equal(receipt.cacheBuffersIntact,true);
 assert.ok(receipt.checks.cancelledAfterActualEncodeTimeUs>0);assert.equal(receipt.checks.recoveryFlac,true);
 assert.equal(receipt.checks.vp9OpusWebmImportedToH264Aac,true);assert.equal(receipt.checks.ownCoreVp9EncodeAccepted,false);
 assert.ok(Math.abs(receipt.checks.normalization.integratedLufs+16)<.8);
 assert.equal(esm.passed,true);assert.equal(esm.ownCore,true);assert.equal(esm.diagnosticOnly,false);
 assert.equal(esm.decodedPcmEqualsInput,true);assert.equal(esm.decodedPcmFrames,96000);
 assert.equal(receipt.realNativeHostAcceptanceClaimed,false);assert.equal(esm.realNativeHostAcceptanceClaimed,false);
});
test('source audit excludes binary seeds and proves the full exported Core reproduction chain',async()=>{
 const audit=JSON.parse(await readFile(join(here,'receipts/core-source-audit.json')));
 assert.equal(audit.status,'passed');assert.equal(audit.sourceTreeCount,18);assert.equal(audit.sourceRegularFilesCompared,18020);
 assert.equal(audit.frozenContext.matchesExecutedReceipt,true);assert.deepEqual(audit.frozenContext.sourceContextWasmOrStaticArchiveSeeds,[]);
 assert.deepEqual(audit.frozenContext.sourceContextDistFiles,[]);assert.deepEqual(audit.frozenContext.sourceContextNodeModulesFiles,[]);
 assert.equal(audit.sourceBuildReproducesAllFourOriginalNpmFiles,true);
 assert.equal(audit.boundary.historicalPublisherCheckoutClaimed,false);assert.equal(audit.boundary.secondColdBuildClaimed,false);
 assert.equal(lock.completedBuilds.core.outputs.length,4);assert.equal(lock.completedBuilds.core.outputAcceptance.status,'passed');
});
test('actual standalone ESM encoder receipts prove output and fresh-worker recovery',async()=>{
 for(const name of ['flac','aac','mp3']){
  const receipt=JSON.parse(await readFile(join(here,'receipts/'+name+'-esm-browser-acceptance.json')));
  assert.equal(receipt.passed,true);assert.equal(receipt.sameOriginModuleBlobWorker,true);assert.equal(receipt.noUnsafeEvalAllowed,true);
  assert.deepEqual(receipt.ordinaryRuntimeHttpRequests,[]);assert.deepEqual(receipt.pageErrors,[]);assert.deepEqual(receipt.cspViolations,[]);
  assert.ok(receipt.cancellation.actualOutputBytes>0);assert.equal(receipt.recoveryGeneration,2);assert.ok(receipt.recoveryEncodedChunks>0);
  assert.equal(receipt.realMcpTransportClaimed,false);assert.equal(receipt.realNativeHostAcceptanceClaimed,false);
  assert.equal(lock.completedBuilds[name].outputAcceptance.directEsmBrowserExecution,'passed');
 }
});
test('runner rejects changed source bytes before invoking Docker',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'codec-source-corruption-'));
 try{
  await writeFile(join(temporary,lock.sources.flac.archive),'corrupt');
  const result=spawnSync(process.execPath,[join(here,'run-build.mjs'),'flac',temporary,join(temporary,'output')],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Source integrity mismatch/);
 }finally{await rm(temporary,{recursive:true,force:true});}
});
test('offline Core preparation rejects corrupt recipe before any source extraction',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'codec-core-corruption-'));
 try{
  await writeFile(join(temporary,lock.sources['ffmpegwasm-recipe'].archive),'corrupt');
  const result=spawnSync('python3',[join(here,'prepare-core.py'),temporary,join(temporary,'context')],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Source integrity mismatch: ffmpegwasm-recipe/);
 }finally{await rm(temporary,{recursive:true,force:true});}
});
test('new-source fetch rejects a changed existing archive rather than overwriting it',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'codec-fetch-corruption-'));
 try{
  const {mkdir}=await import('node:fs/promises');await mkdir(join(temporary,'rebuild/sources'),{recursive:true});
  const path=join(temporary,'rebuild/sources',lock.aacNewSource.archive);await writeFile(path,'corrupt');
  const result=spawnSync(process.execPath,[join(here,'fetch-new-sources.mjs'),temporary],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Existing source integrity mismatch/);assert.equal(await readFile(path,'utf8'),'corrupt');
 }finally{await rm(temporary,{recursive:true,force:true});}
});
