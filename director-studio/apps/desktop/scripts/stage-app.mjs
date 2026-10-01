// Stellt die App für electron-builder zusammen (Staging). Aufbau unter apps/desktop/dist/stage:
//
//   app/                 App-Ordner für electron-builder (landet als app.asar in resources/):
//     package.json       Name, Version, Einstieg – OHNE dependencies (electron-builder sammelt nichts ein)
//     out/               Main/Preload (esbuild) und Oberfläche (Vite), ohne Source-Maps
//   node_modules/        Laufzeitpakete (landet über extraResources als resources/node_modules, AUSSERHALB des asar):
//                        die externen Importe des Main-Bündels samt Abhängigkeitshülle, genau in den installierten
//                        (= Lockfile-)Versionen und nur mit den Plattformpaketen des Build-Rechners; dazu die Quellen
//                        von @studio/render und @studio/core, die Remotion zur Laufzeit bündelt.
//   package.json         Liste der Laufzeitabhängigkeiten mit exakten Versionen (Prüfung mit `npm ls`)
//
// Warum node_modules außerhalb des asar: Remotion (webpack, Compositor), esbuild und der Claude-Agent-SDK starten
// Binaries bzw. lesen Dateien über Pfade, die im asar nicht existieren. Node findet resources/node_modules von
// resources/app.asar/out/main/index.js aus über die normale Suche nach oben.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectClosure, copyClosure, isForeignLibcPackage, npmExternals, packageNameOf, RUNTIME_EXTRA_PACKAGES, SOURCE_WORKSPACE_PACKAGES } from './package-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_DIR = path.join(here, '..');
export const ROOT_DIR = path.join(APP_DIR, '..', '..');
export const STAGE_DIR = path.join(APP_DIR, 'dist', 'stage');

/**
 * @param {{ appDir?: string, rootDir?: string, stageDir?: string, log?: (msg: string) => void }} [options]
 */
export function stageApp(options = {}) {
  const appDir = options.appDir ?? APP_DIR;
  const rootDir = options.rootDir ?? ROOT_DIR;
  const stageDir = options.stageDir ?? STAGE_DIR;
  const log = options.log ?? ((msg) => console.log(msg));

  const out = path.join(appDir, 'out');
  for (const required of ['main/index.js', 'main/externals.json', 'preload/index.cjs', 'renderer/index.html']) {
    if (!existsSync(path.join(out, required))) throw new Error(`out/${required} fehlt – zuerst „npm run build“ ausführen.`);
  }

  rmSync(stageDir, { recursive: true, force: true });
  const stageApp = path.join(stageDir, 'app');
  const stageModules = path.join(stageDir, 'node_modules');
  mkdirSync(stageApp, { recursive: true });

  // 1. App-Ordner: package.json ohne Abhängigkeiten + out/ ohne Source-Maps.
  const rootPkg = readJson(path.join(rootDir, 'package.json'));
  const desktopPkg = readJson(path.join(appDir, 'package.json'));
  writeJson(path.join(stageApp, 'package.json'), {
    name: 'director-studio',
    productName: 'Director Studio',
    version: rootPkg.version,
    description: rootPkg.description,
    author: 'Director Studio',
    private: true,
    type: desktopPkg.type ?? 'module',
    main: desktopPkg.main ?? 'out/main/index.js',
  });
  cpSync(out, path.join(stageApp, 'out'), { recursive: true, filter: (src) => !src.endsWith('.map') });

  // 2. Laufzeitpakete: externe Importe des Main-Bündels (Metafile) + Remotion-Laufzeit, mit Abhängigkeitshülle.
  const externals = npmExternals(readJson(path.join(out, 'main', 'externals.json')));
  const roots = [...new Set([...externals.map((e) => packageNameOf(e.path)), ...RUNTIME_EXTRA_PACKAGES])].sort();
  const { packages, missing } = collectClosure({ rootDir, roots, skip: (name) => isForeignLibcPackage(name) });
  const hard = missing.filter((m) => m.kind === 'required');
  if (hard.length > 0) throw new Error(`Laufzeitpakete fehlen in node_modules (npm ci ausführen):\n${hard.map((m) => `  ${m.name} (von ${m.requiredBy})`).join('\n')}`);
  for (const m of missing) log(`  Hinweis: Peer-Abhängigkeit ${m.name} (von ${m.requiredBy}) ist nicht installiert`);
  copyClosure(packages, stageDir);

  // 3. Quellen der Workspace-Pakete, die Remotion zur Laufzeit übersetzt (ohne Tests).
  for (const name of SOURCE_WORKSPACE_PACKAGES) {
    const src = path.join(rootDir, 'packages', name.split('/')[1]);
    const dest = path.join(stageModules, ...name.split('/'));
    mkdirSync(dest, { recursive: true });
    cpSync(path.join(src, 'package.json'), path.join(dest, 'package.json'));
    cpSync(path.join(src, 'src'), path.join(dest, 'src'), { recursive: true });
  }

  // 4. Liste der Laufzeitabhängigkeiten (exakte Versionen) – dokumentiert den Inhalt und erlaubt `npm ls`.
  const top = (name) => packages.get(`node_modules/${name}`)?.version;
  writeJson(path.join(stageDir, 'package.json'), {
    name: 'director-studio-runtime',
    version: rootPkg.version,
    private: true,
    description: 'Laufzeitpakete der gepackten App (automatisch erzeugt von apps/desktop/scripts/stage-app.mjs).',
    dependencies: Object.fromEntries([
      ...roots.map((name) => [name, top(name) ?? '*']),
      ...SOURCE_WORKSPACE_PACKAGES.map((name) => [name, readJson(path.join(stageModules, ...name.split('/'), 'package.json')).version]),
    ]),
  });
  writeJson(path.join(stageDir, 'manifest.json'), {
    externals: externals.map((e) => e.path),
    roots,
    sourcePackages: SOURCE_WORKSPACE_PACKAGES,
    packages: [...packages].map(([rel, p]) => ({ path: rel, name: p.name, version: p.version })).sort((a, b) => a.path.localeCompare(b.path)),
  });

  log(`Staging fertig: ${packages.size} Pakete für ${roots.length} Laufzeitabhängigkeiten (${roots.join(', ')})`);
  return { stageDir, appDir: stageApp, modulesDir: stageModules, roots, packages };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    stageApp();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
