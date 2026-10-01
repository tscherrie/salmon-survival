// Prüft, ob eine gepackte App (oder das Staging) vollständig ist: Jeder externe Import des Main-Bündels muss sich
// VON DER APP AUS auflösen und laden lassen – und zwar aus deren eigenem node_modules, nicht aus dem Monorepo.
// Dazu die Director-Skills im App-Archiv, die Laufzeit-Auflösungen (Remotion-Quellen, react-dom) und die nativen
// Helfer des Build-Rechners – gestartet so, wie Remotion bzw. der Agent-SDK sie startet.
//
//   Gepackte App (Electron als Node, damit app.asar lesbar ist). Die ausgelieferte App hat die Fuse RunAsNode aus;
//   deshalb das Electron aus node_modules nehmen und nur die Ressourcen der gepackten App prüfen:
//     ELECTRON_RUN_AS_NODE=1 "$(node -p "require('electron')")" scripts/verify-app.mjs --resources "<…/resources>"
//   Staging:
//     node scripts/verify-app.mjs --stage dist/stage
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findRelativeInstallNames } from './macho.mjs';
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

  for (const required of ['out/main/index.js', 'out/main/chromium-worker.js', 'out/preload/index.cjs', 'out/renderer/index.html', 'package.json']) {
    if (existsSync(path.join(appRoot, required))) ok(`${required} im App-Archiv`);
    else fail(`${required} fehlt im App-Archiv (${appRoot})`);
  }

  // Director-Skills: defaultSkillsDir() des Bündels zeigt auf out/skills (neben out/main).
  const skills = countSkills(path.join(appRoot, 'out', 'skills'));
  if (skills.count > 0 && skills.empty.length === 0) ok(`Director-Skills: ${skills.count} SKILL.md in out/skills`);
  else fail(`Director-Skills fehlen oder sind leer in ${path.join(appRoot, 'out', 'skills')} (${skills.count} gefunden${skills.empty.length ? `, leer: ${skills.empty.join(', ')}` : ''})`);

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
    if (runNative) {
      // Wie Remotion (call-ffmpeg.js): cwd = Compositor-Ordner, unter macOS zusätzlich DYLD_LIBRARY_PATH. Unter der
      // Hardened Runtime ignoriert dyld beides – die Bibliotheken müssen über @loader_path gefunden werden.
      const env = process.platform === 'darwin' ? { ...process.env, DYLD_LIBRARY_PATH: dir } : process.env;
      run(exe('ffprobe'), ['-version'], 'Compositor-ffprobe startet', { ok, fail }, { cwd: dir, env });
      await compositorAnswers(requireFromMain, inside, { ok, fail });
    }
  }
  // macOS: kein Binary darf seine Bibliotheken über relative Namen laden (dist.mjs stellt sie auf @loader_path um).
  try {
    const relative = findRelativeInstallNames(modulesDir);
    if (relative.length === 0) ok('Mach-O: keine relativen Bibliotheksnamen');
    else for (const entry of relative) fail(`Mach-O mit relativen Bibliotheksnamen (dyld verweigert sie unter der Hardened Runtime): ${entry.file} → ${[...entry.relative, ...(entry.id ? [`ID ${entry.id}`] : [])].join(', ')}`);
  } catch (error) {
    fail(`Mach-O-Prüfung: ${error.message}`);
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
  if (agentPkg) {
    const claude = path.join(path.dirname(agentPkg), process.platform === 'win32' ? 'claude.exe' : 'claude');
    executable(claude, 'Claude-Agent-SDK: claude', { ok, fail });
    if (runNative) run(claude, ['--version'], 'Claude-Agent-SDK: claude --version', { ok, fail });
  }

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

function run(file, args, label, { ok, fail }, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 30_000, ...options });
  if (result.status === 0) ok(label);
  else fail(`${label}: Exit ${result.status ?? result.signal} ${result.error?.message ?? (result.stderr ?? '').slice(-300)}`);
}

/** Zählt `<dir>/<name>/SKILL.md` (und leere Dateien). */
function countSkills(dir) {
  const empty = [];
  let count = 0;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { count: 0, empty };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    count++;
    if (readFileSync(file, 'utf8').trim().length === 0) empty.push(entry.name);
  }
  return { count, empty };
}

/**
 * Startet den Compositor (`remotion`) über Remotions eigenen Weg und lässt ihn eine WAV-Datei öffnen. Die erwartete
 * Antwort ist ein Fehler DES COMPOSITORS („No video stream found“) – er beweist, dass das Programm samt
 * FFmpeg-Bibliotheken geladen hat und antwortet. Lädt dyld eine Bibliothek nicht, endet der Prozess ohne Antwort.
 */
async function compositorAnswers(requireFromMain, inside, { ok, fail }) {
  const label = 'Compositor (remotion) antwortet über Remotion';
  const dir = mkdtempSync(path.join(tmpdir(), 'dstudio-verify-'));
  try {
    const wav = path.join(dir, 'stille.wav');
    writeFileSync(wav, silentWav());
    const entry = requireFromMain.resolve('@remotion/renderer');
    if (!inside(entry)) throw new Error(`@remotion/renderer kommt nicht aus der App (${entry})`);
    const remotion = await import(pathToFileURL(entry).href);
    const getVideoMetadata = remotion.getVideoMetadata ?? remotion.default?.getVideoMetadata;
    const answer = await Promise.race([
      getVideoMetadata(wav, { logLevel: 'error' }).then(
        () => 'Metadaten',
        (error) => (String(error?.message ?? error).startsWith('Compositor error:') ? 'Compositor-Fehler' : Promise.reject(error)),
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('keine Antwort nach 30 s')), 30_000).unref()),
    ]);
    ok(`${label} (${answer})`);
  } catch (error) {
    fail(`${label}: ${String(error?.message ?? error).slice(0, 600)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 0,1 s Stille als 16-Bit-PCM-WAV (8 kHz, mono). */
function silentWav() {
  const samples = 800;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
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
  // Geladene Module (Remotion-Compositor …) halten Handles offen; ein Fehler darin soll die Prüfung nicht abbrechen.
  process.on('unhandledRejection', (error) => console.warn(`  (Hinweis: ${error instanceof Error ? error.message : error})`));
  const result = await verifyApp({ ...layout, runNative: !args.includes('--no-run') });
  // Geladene Module (Playwright, Remotion …) halten Handles offen – ausdrücklich beenden.
  process.exit(result.ok ? 0 : 1);
}
