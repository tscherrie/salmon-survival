import type { Loader } from 'esbuild-wasm';
import { isSafeSitePath } from '@studio/core';
import { BrowserCapabilityError } from './types.ts';
import type { AssetMedia } from '@studio/render/browser';
import { blobToDataUrl, fetchAsset } from './assets.ts';
import { readRuntimeFile } from './runtime.ts';
let initialized: Promise<void> | undefined;
let compiler: typeof import('esbuild-wasm') | undefined;
export async function initializeCompiler(wasmURL = '/runtime/esbuild.wasm'): Promise<void> {
  initialized ??= (async () => { compiler ??= await import('esbuild-wasm'); const response = await readRuntimeFile(wasmURL); const wasmModule = await WebAssembly.compile(new Uint8Array(response.bytes)); await compiler.initialize({ wasmModule, worker: false }); })();
  try { await initialized; } catch (error) { initialized = undefined; throw new BrowserCapabilityError('tsx-compiler', `TSX-Compiler nicht verfügbar: ${(error as Error).message}`); }
}
export async function compileComponentSource(source: string): Promise<string> {
  if (source.startsWith('/* @studio/component v1 */')) return source;
  await initializeCompiler();
  const result = await compiler!.transform(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic', target: 'es2022' });
  return `/* @studio/component v1 */\n${result.code}`;
}
function resolveFile(files: Record<string, string | Uint8Array>, raw: string): string | undefined {
  const path = raw.replace(/^\//, ''); return [path, `${path}.tsx`, `${path}.ts`, `${path}.jsx`, `${path}.js`, `${path}.json`, `${path}/index.tsx`, `${path}/index.ts`, `${path}/index.js`].find((p) => files[p] !== undefined);
}
function normalize(path: string): string { const out: string[] = []; for (const p of path.split('/')) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); } return out.join('/'); }
const loaderFor = (p: string): Loader => p.endsWith('.tsx') ? 'tsx' : p.endsWith('.jsx') ? 'jsx' : p.endsWith('.css') ? 'css' : p.endsWith('.json') ? 'json' : /\.(png|jpe?g|gif|svg|woff2?|mp4|mp3|wav)$/.test(p) ? 'dataurl' : 'ts';
/** Browser-only Vite/React build: source imports become a real production JS/CSS bundle. */
export async function inlineSiteAssets(files: Record<string, string | Uint8Array>, assets: Record<string, AssetMedia> = {}): Promise<Record<string, string | Uint8Array>> {
  const out = { ...files };
  for (const [id, asset] of Object.entries(assets)) {
    const tokens = [`asset://${id}`, `studio-asset://${id}`, asset.url].filter(Boolean);
    const referenced = Object.values(out).some((source) => typeof source === 'string' && tokens.some((token) => source.includes(token)));
    if (!referenced) continue;
    const data = asset.url.startsWith('data:') ? asset.url : await blobToDataUrl(await fetchAsset(asset));
    for (const [path, source] of Object.entries(out)) if (typeof source === 'string') { let next = source; for (const token of tokens) next = next.split(token).join(data); out[path] = next; }
  }
  return out;
}
export async function buildWebsite(sourceFiles: Record<string, string | Uint8Array>, framework: 'html' | 'vite-react', assets: Record<string, AssetMedia> = {}, buildOnlyIndex = false): Promise<Record<string, Uint8Array>> {
  const files = await inlineSiteAssets(sourceFiles, assets);
  for (const path of Object.keys(files)) if (!isSafeSitePath(path)) throw new Error(`Unsicherer Websitepfad: ${path}`);
  const enc = new TextEncoder(), out: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) out[path] = typeof data === 'string' ? enc.encode(data) : data;
  if (framework === 'html') { if (!out['index.html'] || !String(files['index.html']).includes('<')) throw new Error('Website benötigt index.html'); return out; }
  await initializeCompiler();
  const html = typeof files['index.html'] === 'string' ? files['index.html'] : '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
  const script = /<script\b[^>]*\bsrc=["']([^"']+\.(?:tsx?|jsx?))["'][^>]*><\/script>/i.exec(html);
  const entry = resolveFile(files, script?.[1] ?? 'src/main.tsx') ?? resolveFile(files, 'src/index.tsx');
  if (!entry) throw new Error('React-Website benötigt eine ausführbare Einstiegsdatei (src/main.tsx)');
  let dependencies: Record<string, string> = {};
  if (typeof files['package.json'] === 'string') { const pkg = JSON.parse(files['package.json']); dependencies = { ...pkg.dependencies, ...pkg.devDependencies }; }
  const cache = new Map<string, string>();
  const build = await compiler!.build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', target: 'es2022', jsx: 'automatic', outdir: 'dist', entryNames: 'app', assetNames: '[name]-[hash]', plugins: [{ name: 'studio-virtual-browser-project', setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.path.startsWith('node:')) throw new Error(`Node-Abhängigkeit ${args.path} kann nicht im Browser laufen`);
      if (args.namespace === 'http') return { path: new URL(args.path, args.importer).href, namespace: 'http' };
      if (/^https:\/\//.test(args.path)) { if (new URL(args.path).hostname !== 'esm.sh') throw new Error('Externe Quellimports müssen von esm.sh stammen'); return { path: args.path, namespace: 'http' }; }
      if (args.kind === 'entry-point') return { path: entry, namespace: 'project' };
      if (args.path.startsWith('.') || args.path.startsWith('/')) { const dir = args.importer.split('/').slice(0, -1).join('/'); const path = resolveFile(files, normalize(args.path.startsWith('/') ? args.path : `${dir}/${args.path}`)); if (!path) throw new Error(`Website-Datei fehlt: ${args.path}`); return { path, namespace: 'project' }; }
      const parts = args.path.split('/'), name = args.path.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!, suffix = parts.slice(args.path.startsWith('@') ? 2 : 1).join('/');
      const version = dependencies[name]?.replace(/^[~^]/, '') ?? (name === 'react' || name === 'react-dom' ? '19.3.0' : null);
      if (!version || !/^[\w.+-]+$/.test(version)) throw new Error(`Browser-Abhängigkeit ${name}: exakte Version in package.json angeben`);
      return { path: `https://esm.sh/${name}@${version}${suffix ? `/${suffix}` : ''}?target=es2022`, namespace: 'http' };
    });
    build.onLoad({ filter: /.*/, namespace: 'project' }, (args) => ({ contents: files[args.path]!, loader: loaderFor(args.path), resolveDir: '/' }));
    build.onLoad({ filter: /.*/, namespace: 'http' }, async (args) => { if (new URL(args.path).hostname !== 'esm.sh') throw new Error('Unbekannte Modulquelle'); let source = cache.get(args.path); if (!source) { const response = await fetch(args.path, { credentials: 'omit' }); if (!response.ok) throw new Error(`Paketdownload ${response.status}: ${args.path}`); source = await response.text(); cache.set(args.path, source); } return { contents: source, loader: args.path.endsWith('.css') ? 'css' : 'js' }; });
  } }] });
  for (const file of build.outputFiles ?? []) out[`dist/${file.path.split('/').at(-1)!}`] = file.contents;
  const js = 'app.js'; if (!out[`dist/${js}`]) throw new Error('Website-Build hat keine ausführbare JS-Datei erzeugt');
  let finalHtml = script ? html.replace(script[0], '<script type="module" src="./app.js"></script>') : html.replace('</body>', '<script type="module" src="./app.js"></script></body>');
  if (out['dist/app.css']) finalHtml = finalHtml.replace('</head>', '<link rel="stylesheet" href="./app.css"></head>');
  out['dist/index.html'] = enc.encode(finalHtml);
  for (const [path, data] of Object.entries(out)) if (path.startsWith('public/')) out[`dist/${path.slice(7)}`] = data;
  if (!buildOnlyIndex) for (const [page, source] of Object.entries(files)) {
    if (page === 'index.html' || !page.endsWith('.html') || page.startsWith('public/') || typeof source !== 'string') continue;
    const pageEntry = /<script\b[^>]*\bsrc=["']([^"']+\.(?:tsx?|jsx?))["'][^>]*><\/script>/i.exec(source);
    if (!pageEntry) { out[`dist/${page}`] = enc.encode(source); continue; }
    const dirname = page.split('/').slice(0, -1).join('/'), resolvedEntry = normalize(pageEntry[1]!.startsWith('/') ? pageEntry[1]! : `${dirname}/${pageEntry[1]}`);
    const subset = { ...files, 'index.html': source.replace(pageEntry[1]!, `/${resolvedEntry}`) };
    const compiled = await buildWebsite(subset, framework, {}, true), base = page.replace(/[^\w-]/g, '_');
    for (const [name, bytes] of Object.entries(compiled)) if (name.startsWith('dist/') && name !== 'dist/index.html') out[name === 'dist/app.js' ? `dist/${base}.js` : name === 'dist/app.css' ? `dist/${base}.css` : name] = bytes;
    let pageHtml = new TextDecoder().decode(compiled['dist/index.html']);
    const relativeRoot = '../'.repeat(page.split('/').length - 1);
    pageHtml = pageHtml.replace('./app.js', `${relativeRoot}${base}.js`).replace('./app.css', `${relativeRoot}${base}.css`);
    out[`dist/${page}`] = enc.encode(pageHtml);
  }
  out['README-EXPORT.txt'] = enc.encode('Production output: dist/. Serve this folder with any static HTTPS server (or: npx serve dist). Original source is included. Dependencies are bundled into app.js; no Electron or Director server is needed.');
  return out;
}
function mediaMime(path: string): string {
  const ext = path.split('.').at(-1)?.toLowerCase();
  return ({ svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', css: 'text/css', js: 'text/javascript' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}
function bytesUrl(bytes: Uint8Array, mime: string): string {
  let raw = ''; for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${mime};base64,${btoa(raw)}`;
}
/** Resolve local resources without relying on the preview Blob's origin or filesystem. */
export async function selfContainedSiteHtml(built: Record<string, Uint8Array>, filename: string, route = '/'): Promise<string> {
  const decoder = new TextDecoder(), root = filename.startsWith('dist/') ? 'dist/' : '';
  const resolve = (raw: string, from = filename): string | undefined => {
    if (/^(?:data:|blob:|https?:|mailto:|tel:|#|javascript:)/i.test(raw)) return undefined;
    const clean = raw.split(/[?#]/)[0]!, path = normalize(clean.startsWith('/') ? `${root}${clean.slice(1)}` : `${from.split('/').slice(0, -1).join('/')}/${clean}`);
    return [path, `${path}.html`, `${path}/index.html`].find((p) => built[p] !== undefined);
  };
  const resource = (raw: string, from = filename): string => { const path = resolve(raw, from); if (!path) { if (!/^(?:data:|blob:|https?:|mailto:|tel:|#)/i.test(raw)) throw new Error(`Website-Datei fehlt: ${raw} (in ${from})`); return raw; } return bytesUrl(built[path]!, mediaMime(path)); };
  const cssText = (path: string, seen = new Set<string>()): string => {
    if (seen.has(path)) throw new Error(`Zyklischer CSS-Import: ${path}`); const next = new Set(seen).add(path);
    let css = decoder.decode(built[path]);
    css = css.replace(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?[^;]*;/g, (all, ref: string) => { const file = resolve(ref, path); return file ? cssText(file, next) : all; });
    return css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (_, _quote, raw: string) => `url("${resource(raw, path)}")`);
  };
  const jsText = (path: string): string => {
    let js = decoder.decode(built[path]);
    // Public resource literals in the production bundle resolve to the identical bytes in preview.
    for (const [file, bytes] of Object.entries(built)) {
      const local = root && file.startsWith(root) ? file.slice(root.length) : file;
      if (/\.(?:html?|[cm]?[jt]sx?|css|json|map)$/.test(local)) continue;
      const data = bytesUrl(bytes, mediaMime(file));
      for (const token of [`/${local}`, `./${local}`]) js = js.split(JSON.stringify(token)).join(JSON.stringify(data)).split(`'${token}'`).join(JSON.stringify(data));
    }
    return js;
  };
  const doc = new DOMParser().parseFromString(decoder.decode(built[filename]), 'text/html');
  for (const el of doc.querySelectorAll('base,meta[http-equiv="Content-Security-Policy"]')) el.remove();
  for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) { const path = resolve(link.getAttribute('href') ?? ''); if (!path) throw new Error(`Lokales Stylesheet fehlt: ${link.getAttribute('href')}`); const style = doc.createElement('style'); style.textContent = cssText(path); link.replaceWith(style); }
  for (const script of doc.querySelectorAll<HTMLScriptElement>('script[src]')) { const path = resolve(script.getAttribute('src') ?? ''); if (!path) throw new Error(`Lokales Skript fehlt: ${script.getAttribute('src')}`); script.removeAttribute('src'); script.textContent = jsText(path); }
  for (const el of doc.querySelectorAll<HTMLElement>('[src],[poster],[srcset],link[href]')) {
    if (el.tagName === 'SCRIPT') continue;
    for (const attr of ['src', 'poster']) { const raw = el.getAttribute(attr); if (raw) el.setAttribute(attr, resource(raw)); }
    const srcset = el.getAttribute('srcset'); if (srcset) el.setAttribute('srcset', srcset.split(',').map((part) => { const [src, ...size] = part.trim().split(/\s+/); return `${resource(src!)} ${size.join(' ')}`.trim(); }).join(', '));
    if (el.tagName === 'LINK') { const raw = el.getAttribute('href'); if (raw) el.setAttribute('href', resource(raw)); }
  }
  for (const el of doc.querySelectorAll<HTMLElement>('[style]')) el.setAttribute('style', el.getAttribute('style')!.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (_, _q, raw: string) => `url("${resource(raw)}")`));
  const nav = doc.createElement('script');
  nav.textContent = `window.__directorPath=${JSON.stringify(route)};document.addEventListener('click',event=>{const link=event.target.closest?.('a[href]');if(!link)return;const raw=link.getAttribute('href');if(!raw||raw.startsWith('#')||/^[a-z]+:/i.test(raw)||link.hasAttribute('download'))return;event.preventDefault();const base='https://director.invalid'+window.__directorPath;const target=new URL(raw,base);parent.postMessage({type:'studio-navigate',path:target.pathname+target.search+target.hash},'*');});`;
  doc.head.prepend(nav);
  for (const script of doc.querySelectorAll('script')) script.textContent = (script.textContent ?? '').replace(/<\/script/gi, '<\\/script');
  for (const style of doc.querySelectorAll('style')) style.textContent = (style.textContent ?? '').replace(/<\/style/gi, '<\\/style');
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
/** Every local HTML page is independently executable; safe navigation is relayed to the host. */
export async function buildSitePreviews(files: Record<string, string | Uint8Array>, framework: 'html' | 'vite-react' = 'vite-react', assets: Record<string, AssetMedia> = {}): Promise<Record<string, string>> {
  const built = await buildWebsite(files, framework, assets), pages: Record<string, string> = {};
  const root = framework === 'html' ? '' : 'dist/';
  for (const path of Object.keys(built).filter((p) => p.startsWith(root) && p.endsWith('.html') && (framework === 'html' || p.startsWith('dist/')))) {
    const relative = path.slice(root.length), route = relative === 'index.html' ? '/' : `/${relative}`;
    let pageFiles = built, pageFile = path;
    if (framework === 'html') {
      const source = new TextDecoder().decode(built[path]);
      const module = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=)[^>]*>/i.test(source);
      if (module) {
        const entry = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/i.exec(source);
        const directory = path.split('/').slice(0, -1).join('/'), ref = entry?.[1];
        const normalized = ref ? normalize(ref.startsWith('/') ? ref : `${directory}/${ref}`) : '';
        pageFiles = await buildWebsite({ ...files, 'index.html': ref ? source.replace(ref, `/${normalized}`) : source }, 'vite-react', assets, true); pageFile = 'dist/index.html';
      }
    }
    const html = await selfContainedSiteHtml(pageFiles, pageFile, route); pages[route] = html;
    if (relative.endsWith('/index.html')) pages[`/${relative.slice(0, -10)}`] = html;
    else if (relative !== 'index.html') pages[`/${relative.slice(0, -5)}`] = html;
  }
  return pages;
}
/** Uses the same production bundle and asset bytes placed in the export ZIP. */
export async function buildSitePreview(files: Record<string, string | Uint8Array>, framework: 'html' | 'vite-react' = 'vite-react', assets: Record<string, AssetMedia> = {}): Promise<string> {
  return (await buildSitePreviews(files, framework, assets))['/']!;
}
