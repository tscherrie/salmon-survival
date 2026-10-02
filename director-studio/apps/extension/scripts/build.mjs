import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, cp, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadCoreArtifacts, writeCoreRuntime } from './adopt-owned-core.mjs';
const here = fileURLToPath(new URL('..', import.meta.url));
const studio = path.resolve(here, '../..');
const root = path.resolve(studio, '..');
const dist = path.join(root, 'dist');
// Validate owned inputs before altering dist. A broken vendor scope cannot fall back to npm.
const core = await loadCoreArtifacts(studio);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
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
// Sites files have a25MiB limit;16MiB chunks preserve independently pinned variant bytes.
await writeCoreRuntime(core, path.join(dist, 'client/runtime/ffmpeg'));
console.log(`FFmpeg core source: ${core.sourceKind}.`);
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
