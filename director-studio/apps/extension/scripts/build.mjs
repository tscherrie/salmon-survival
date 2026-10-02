import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, cp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = fileURLToPath(new URL('..', import.meta.url));
const studio = path.resolve(here, '../..');
const root = path.resolve(studio, '..');
const dist = path.join(root, 'dist');
await viteBuild({ configFile: path.join(here, 'vite.config.ts') });
await mkdir(path.join(dist, 'server'), {recursive: true});
await mkdir(path.join(dist, '.openai'), {recursive: true});
const hosting = path.join(root, '.openai/hosting.json');
try { await access(hosting); await cp(hosting, path.join(dist, '.openai/hosting.json')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await cp(path.join(root, '.openai/hosting.example.json'), path.join(dist, '.openai/hosting.json'));
  console.log('Local build uses unbound hosting template. Provision your own Site before packaging a deployment.');
}
await cp(path.join(studio, 'node_modules/@ffmpeg/core/dist/esm'), path.join(dist, 'client/runtime/ffmpeg'), {recursive: true});
await cp(path.join(studio, 'node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js'), path.join(dist, 'client/runtime/ffmpeg/ffmpeg-core-classic.js'));
// Sites static files have a25MiB limit. Preserve the original WASM bytes while
// transporting them in independently verified16MiB chunks.
const wasmPath=path.join(dist,'client/runtime/ffmpeg/ffmpeg-core.wasm');
const wasm=await readFile(wasmPath), hash=bytes=>createHash('sha256').update(bytes).digest('hex'), chunks=[];
for(let offset=0,index=0;offset<wasm.length;offset+=16*1024*1024,index++) {
  const bytes=wasm.subarray(offset,offset+16*1024*1024), url=`ffmpeg-core.wasm.part${index}`;
  await writeFile(path.join(dist,'client/runtime/ffmpeg',url),bytes);
  chunks.push({url,bytes:bytes.length,sha256:hash(bytes)});
}
await writeFile(path.join(dist,'client/runtime/ffmpeg/ffmpeg-core.wasm.json'),JSON.stringify({version:1,bytes:wasm.length,sha256:hash(wasm),chunks}));
await rm(wasmPath);
await cp(path.join(studio, 'node_modules/esbuild-wasm/esbuild.wasm'), path.join(dist, 'client/runtime/esbuild.wasm'));
await build({entryPoints:[path.join(studio,'node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js')],outfile:path.join(dist,'client/runtime/ffmpeg/worker.js'),bundle:true,format:'esm',platform:'browser',target:'es2023'});
await cp(path.join(here, 'public'), path.join(dist, 'client'), {recursive: true});
await cp(path.join(studio, 'apps/desktop/src/renderer/assets/fonts'), path.join(dist, 'client/fonts'), {recursive: true});
await writeFile(path.join(dist, 'client/fonts/fonts.css'), '@font-face{font-family:"Instrument Sans";src:url("./InstrumentSans-Variable.woff2") format("woff2");font-weight:100 900;font-display:swap}@font-face{font-family:"IBM Plex Mono";src:url("./IBMPlexMono-Regular.woff2") format("woff2");font-display:swap}');
await writeFile(path.join(dist, 'server/wrangler.json'), JSON.stringify({name:'director-studio',main:'index.js',compatibility_date:'2026-09-29',assets:{directory:'../client',binding:'ASSETS',run_worker_first:true},d1_databases:[{binding:'DB',database_name:'director-studio',database_id:'local-preview-db'}],r2_buckets:[{binding:'MEDIA',bucket_name:'director-studio'}]},null,2));
// A native MCP resource cannot authenticate separate private Site asset requests.
// Bundle every module and style into the resource; runtime bytes use the app-only bridge.
const loaders = { '.woff2':'dataurl', '.woff':'dataurl', '.png':'dataurl', '.svg':'dataurl', '.jpg':'dataurl' };
for (const [name, entry] of [['native',path.join(here,'ui/main.tsx')],['native-sandbox',path.join(studio,'packages/browser-media/src/sandbox-entry.tsx')]]) {
  const bundled=await build({entryPoints:[entry],outfile:path.join(dist,`${name}.js`),bundle:true,write:false,platform:'browser',target:'es2022',format:'iife',minify:true,jsx:'automatic',loader:loaders,conditions:['browser'],define:{'process.env.NODE_ENV':'"production"'}});
  const js=bundled.outputFiles.find(file=>file.path.endsWith('.js'))?.text;
  if(!js)throw new Error('Self-contained native resource bundle missing.');
  let css=bundled.outputFiles.find(file=>file.path.endsWith('.css'))?.text ?? '';
  if(name==='native-sandbox') {
    for(const [font,file] of [['Instrument Sans','InstrumentSans-Variable.woff2'],['IBM Plex Mono','IBMPlexMono-Regular.woff2']]) css+=`@font-face{font-family:"${font}";src:url(data:font/woff2;base64,${(await readFile(path.join(studio,'apps/desktop/src/renderer/assets/fonts',file))).toString('base64')}) format("woff2");font-weight:100 900}`;
  }
  const html=`<!doctype html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>AI Director Studio</title><style>${css.replaceAll('</style','<\\/style')}</style></head><body><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`;
  await writeFile(path.join(dist,'client',`${name}.html`),html);
}
// MCP hosts cache UI resources by URI. Generate the identity from the complete
// native document, then build the Worker against that same content identity.
const nativeUiBuildId = hash(await readFile(path.join(dist, 'client/native.html')));
const uiBuildModule = path.join(here, 'server/generated/ui-build.ts');
await mkdir(path.dirname(uiBuildModule), { recursive: true });
await writeFile(uiBuildModule, `// Generated by extension:build from native.html.\nexport const NATIVE_UI_BUILD_ID = '${nativeUiBuildId}' as const;\n`);
await build({ entryPoints: [path.join(here, 'server/worker.ts')], outfile: path.join(dist, 'server/index.js'), bundle: true, platform: 'browser', target: 'es2023', format: 'esm', sourcemap: false, conditions: ['worker', 'browser'] });
console.log('Native Extension UI and Worker built.');
