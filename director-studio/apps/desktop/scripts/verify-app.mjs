// Prüft, ob eine gepackte App (oder das Staging) vollständig ist: Jeder externe Import des Main-Bündels muss sich
// VON DER APP AUS auflösen und laden lassen – und zwar aus deren eigenem node_modules, nicht aus dem Monorepo.
// Dazu die Laufzeit-Auflösungen (Remotion-Quellen, react-dom) und die nativen Helfer des Build-Rechners.
//
//   Gepackte App (Electron als Node, damit app.asar lesbar ist):
//     ELECTRON_RUN_AS_NODE=1 "<App-Binary>" scripts/verify-app.mjs --resources "<…/resources>"
//   Staging:
//     node scripts/verify-app.mjs --stage dist/stage
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nativePackageNames, npmExternals } from './package-lib.mjs';

/**
 * @param {{ appRoot: string, modulesDir: string, log?: (msg: string) => void, runNative?: boolean }} options
 * @returns {Promise<{ ok: boolean, failures: string[], checked: number }>}
 */
export async function verifyApp({ appRoot, modulesDir, log = (m) => console.log(m), runNative = true }) {
  const failures = [];
  let checked = 0;
  const fail = (msg) => {
    failures.push(msg);
    log(`  ✗ ${msg}`);
  };
  const ok = (msg) => {
    checked++;
    log(`  ✓ ${msg}`);
  };
  const mainFile = path.join(appRoot, 'out', 'main', 'index.js');
  const modulesPrefix = path.resolve(modulesDir) + path.sep;
  const inside = (file) => path.resolve(file).startsWith(modulesPrefix);
  const requireFromMain = createRequire(mainFile);

  for (const required of ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html', 'package.json']) {
    if (existsSync(path.join(appRoot, required))) ok(`${required} im App-Archiv`);
    else fail(`${required} fehlt im App-Archiv (${appRoot})`);
  }

  const externals = npmExternals(JSON.parse(readFileSync(path.join(appRoot, 'out', 'main', 'externals.json'), 'utf8')));
  if (externals.length === 0) fail('externals.json enthält keine Importe');

  /** Löst `spec` aus Sicht von `require` auf, prüft den Ort und lädt das Modul (ESM-`import()`). */
  const check = async (spec, req, label, { load = true } = {}) => {
    let resolved;
    try {
      resolved = req.resolve(spec);
    } catch (error) {
      fail(`${label}: „${spec}“ lässt sich nicht auflösen (${error.code ?? error.message})`);
      return undefined;
    }
    if (!inside(resolved)) {
      fail(`${label}: „${spec}“ kommt nicht aus der App, sondern aus ${resolved}`);
      return undefined;
    }
    if (load) {
      try {
        await import(pathToFileURL(resolved).href);
      } catch (error) {
        fail(`${label}: „${spec}“ lädt nicht: ${error.message}`);
        return undefined;
      }
    }
    ok(`${label}: ${spec}`);
    return resolved;
  };

  log('Externe Importe des Main-Bündels (aus dem esbuild-Metafile):');
  for (const ext of externals) await check(ext.path, requireFromMain, ext.kinds.join('/'));

  log('Laufzeit-Auflösungen (Remotion bündelt die Komposition aus den Quellen):');
  const browserEntry = await check('@studio/render/browser', requireFromMain, 'resolveRenderBrowserEntry', { load: false });
  if (browserEntry) {
    const fromRender = createRequire(browserEntry);
    await check('@studio/core', fromRender, '@studio/render → @studio/core', { load: false });
    for (const spec of ['react', 'react/jsx-runtime', 'remotion', 'zod']) await check(spec, fromRender, 'Komposition', { load: false });
  }
  await check('remotion/package.json', requireFromMain, 'remotionNodeModules', { load: false });
  const remotionDir = path.dirname(requireFromMain.resolve('remotion/package.json'));
  const fromRemotion = createRequire(path.join(remotionDir, 'package.json'));
  for (const spec of ['react-dom', 'react-dom/client']) await check(spec, fromRemotion, 'Remotion-Bündel', { load: false });

  log(`Native Helfer (${process.platform}-${process.arch}):`);
  const native = nativePackageNames();
  const rendererPkg = requireFromMain.resolve('@remotion/renderer/package.json');
  const compositorPkg = await check(`${native.compositor}/package.json`, createRequire(rendererPkg), 'Remotion-Compositor', { load: false });
  if (compositorPkg) {
    const dir = path.dirname(compositorPkg);
    const exe = (name) => path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
    for (const name of ['remotion', 'ffmpeg', 'ffprobe']) executable(exe(name), `Compositor: ${name}`, { ok, fail });
    if (runNative) run(exe('ffprobe'), ['-version'], 'Compositor-ffprobe startet', { ok, fail });
  }
  const esbuildMain = requireFromMain.resolve('esbuild');
  if (inside(esbuildMain)) {
    try {
      const esbuild = await import(pathToFileURL(esbuildMain).href);
      const result = await (esbuild.transform ?? esbuild.default.transform)('const answer: number = 42; export default answer;', { loader: 'ts' });
      if (result.code.includes('42')) ok(`esbuild-Binary läuft (${esbuild.version ?? esbuild.default.version})`);
      else fail('esbuild lieferte unerwartete Ausgabe');
    } catch (error) {
      fail(`esbuild-Binary startet nicht: ${error.message}`);
    }
  }
  // Remotion-Bundler bringt sein eigenes esbuild mit (andere Version) – auch dessen Binary muss passen.
  try {
    const bundlerEsbuild = createRequire(requireFromMain.resolve('@remotion/bundler/package.json')).resolve('esbuild');
    if (bundlerEsbuild !== esbuildMain) {
      const esbuild = await import(pathToFileURL(bundlerEsbuild).href);
      await (esbuild.transform ?? esbuild.default.transform)('let x: number = 1', { loader: 'ts' });
      ok(`esbuild von @remotion/bundler läuft (${esbuild.version ?? esbuild.default.version})`);
    }
  } catch (error) {
    fail(`esbuild von @remotion/bundler: ${error.message}`);
  }
  const sdkDir = path.dirname(requireFromMain.resolve('@anthropic-ai/claude-agent-sdk'));
  const agentPkg = await check(`${native.agentSdk}/package.json`, createRequire(path.join(sdkDir, 'package.json')), 'Claude-Agent-SDK (optional)', { load: false });
  if (agentPkg) executable(path.join(path.dirname(agentPkg), process.platform === 'win32' ? 'claude.exe' : 'claude'), 'Claude-Agent-SDK: claude', { ok, fail });

  log(failures.length === 0 ? `Vollständig: ${checked} Prüfungen bestanden.` : `${failures.length} Fehler, ${checked} Prüfungen bestanden.`);
  return { ok: failures.length === 0, failures, checked };
}

function executable(file, label, { ok, fail }) {
  try {
    if (!statSync(file).isFile()) throw new Error('keine Datei');
    if (process.platform !== 'win32') accessSync(file, constants.X_OK);
    ok(`${label} vorhanden`);
  } catch (error) {
    fail(`${label} fehlt oder ist nicht ausführbar: ${file} (${error.message})`);
  }
}

function run(file, args, label, { ok, fail }) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 30_000 });
  if (result.status === 0) ok(label);
  else fail(`${label}: Exit ${result.status ?? result.signal} ${result.error?.message ?? (result.stderr ?? '').slice(-300)}`);
}

/** Ordner `resources` einer gepackten App → App-Archiv und node_modules. */
export function layoutFromResources(resourcesDir) {
  const asar = path.join(resourcesDir, 'app.asar');
  return { appRoot: existsSync(asar) ? asar : path.join(resourcesDir, 'app'), modulesDir: path.join(resourcesDir, 'node_modules') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  let layout;
  if (value('--resources')) layout = layoutFromResources(path.resolve(value('--resources')));
  else if (value('--stage')) layout = { appRoot: path.resolve(value('--stage'), 'app'), modulesDir: path.resolve(value('--stage'), 'node_modules') };
  else {
    console.error('Aufruf: verify-app.mjs --resources <resources-Ordner> | --stage <dist/stage>');
    process.exit(2);
  }
  console.log(`Prüfe ${layout.appRoot} (Module: ${layout.modulesDir}) mit ${process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`}`);
  const result = await verifyApp({ ...layout, runNative: !args.includes('--no-run') });
  // Geladene Module (Playwright, Remotion …) halten Handles offen – ausdrücklich beenden.
  process.exit(result.ok ? 0 : 1);
}
