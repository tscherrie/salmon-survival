import {cp,mkdtemp,mkdir,readFile,readdir,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),output=path.resolve(process.argv[2]??'/tmp/director-extension-deploy.tar.gz');
const manifest=JSON.parse(await readFile(path.join(root,'dist/.openai/hosting.json')));
if(!manifest.project_id||manifest.d1!=='DB'||manifest.r2!=='MEDIA')throw Error('Expected built canonical Sites manifest');
const files=[];async function inspect(dir){for(const name of await readdir(dir)){const file=path.join(dir,name),s=await stat(file);if(s.isDirectory())await inspect(file);else{if(s.size>25*1024*1024)throw Error(`Sites static-file limit exceeded: ${path.relative(root,file)}`);files.push(file);}}}await inspect(path.join(root,'dist/client'));
const stage=await mkdtemp(path.join(os.tmpdir(),'director-sites-package.'));
try{await cp(path.join(root,'dist'),path.join(stage,'dist'),{recursive:true});await mkdir(path.join(stage,'dist/.openai/drizzle'),{recursive:true});await cp(path.join(root,'drizzle'),path.join(stage,'dist/.openai/drizzle'),{recursive:true});execFileSync('tar',['-czf',output,'-C',stage,'dist'],{env:{...process.env,COPYFILE_DISABLE:'1'}});}finally{await rm(stage,{recursive:true,force:true});}
console.log(JSON.stringify({archive:output,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),staticFiles:files.length}));
