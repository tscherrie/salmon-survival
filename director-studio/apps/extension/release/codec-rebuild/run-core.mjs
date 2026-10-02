#!/usr/bin/env node
import {readFile,mkdir,writeFile,open} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const [contextArgument,outputArgument,builder='director-codec-core-20261002']=process.argv.slice(2);
if(!contextArgument||!outputArgument)throw new Error('Use run-core.mjs PREPARED_CONTEXT OUTPUT_DIRECTORY [isolated-builder]');
const context=resolve(contextArgument),output=resolve(outputArgument);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceLockBytes=await readFile(join(context,'SOURCE-LOCK.json'));const lock=JSON.parse(sourceLockBytes);
const dockerfile=await readFile(join(context,'Dockerfile'),'utf8');
if(!dockerfile.includes(lock.toolchains.core.immutableImage)||/ADD https:\/\/|RUN git clone|apt-get/.test(dockerfile))throw new Error('Unpinned/network source remains');
const inspection=spawnSync('docker',['--context','colima','inspect','buildx_buildkit_'+builder+'0'],{encoding:'utf8'});
if(inspection.status!==0)throw new Error('Owned BuildKit container inspection failed: '+inspection.stderr);
const container=JSON.parse(inspection.stdout)[0],limits=container.HostConfig;
if(container.Config.Image!==lock.coreExecution.buildkitImage)throw new Error('BuildKit image does not match the fixed source lock');
const cpuQuotaCores=limits.NanoCpus?limits.NanoCpus/1e9:limits.CpuQuota>0?limits.CpuQuota/limits.CpuPeriod:null;
if(cpuQuotaCores===null||limits.Memory<=0)throw new Error('Configure explicit owned BuildKit CPU and memory limits before compilation');
await mkdir(output,{recursive:true});
const args=['--context','colima','buildx','build','--builder',builder,'--network=none','--platform=linux/amd64','--build-arg','FFMPEG_ST=yes','--build-arg','EXTRA_CFLAGS=-O3 -msimd128','--progress=plain','--metadata-file',join(output,'build-metadata.json'),'--output','type=local,dest='+join(output,'artifacts'),context];
const log=await open(join(output,'build.log'),'a');
const child=spawn('docker',args,{stdio:['ignore',log.fd,log.fd]});
const receipt={status:'running',startedAtUtc:new Date().toISOString(),nodePid:process.pid,dockerPid:child.pid,builder,buildkitContainerId:container.Id,buildkitImage:lock.coreExecution.buildkitImage,compilerImage:lock.toolchains.core.immutableImage,sourceLockSha256:hash(sourceLockBytes),dockerfileSha256:hash(Buffer.from(dockerfile)),context,output,argv:args,networkDuringRunSteps:'none',maxParallelStages:1,compileJobsPerStage:2,cpuQuotaCores,memoryBytes:limits.Memory,shippedRuntimeChanged:false,realNativeHostAcceptanceClaimed:false};
await writeFile(join(output,'run-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
try{
 const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});
 receipt.exitCode=exitCode;receipt.status=exitCode===0?'compiled':'failed';if(exitCode!==0)process.exitCode=exitCode??1;
}catch(error){receipt.status='failed';receipt.error=String(error);process.exitCode=1;}
finally{receipt.finishedAtUtc=new Date().toISOString();await writeFile(join(output,'run-receipt.json'),JSON.stringify(receipt,null,2)+'\n');await log.close();console.log(JSON.stringify(receipt,null,2));}
