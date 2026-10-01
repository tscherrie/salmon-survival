// Baut die installierbare App für den Build-Rechner: Main/Preload/Oberfläche bauen → Staging (stage-app.mjs) →
// electron-builder → Vollständigkeitsprüfung der gepackten App (verify-app.mjs, läuft mit dem gepackten Electron).
//
//   node apps/desktop/scripts/dist.mjs              Installer (macOS .dmg, Windows NSIS-.exe, Linux .tar.gz)
//   node apps/desktop/scripts/dist.mjs --dir        nur die entpackte App (für die lokale Installation)
//   … --mac | --win | --linux                       Zielplattform; muss die des Build-Rechners sein (s. u.)
//   … --skip-build                                  vorhandenes out/ verwenden
//   … --no-verify                                   Prüfung der gepackten App überspringen
//   … --allow-cross                                 andere Plattform trotzdem paketieren (nur zum Testen der Konfiguration)
//
// Plattform und Architektur folgen dem Build-Rechner, weil die nativen Pakete (Remotion-Compositor, esbuild,
// rspack, Claude-Code-Binary) aus dessen node_modules stammen: Eine Mac-App auf dem Mac bauen, eine Windows-App
// unter Windows.
//
// macOS-Signierung: Ohne CSC_LINK/CSC_NAME wird ad hoc signiert (Identität „-“, Hardened Runtime mit den
// Entitlements aus build/entitlements.mac.plist) – genug für den eigenen Rechner. Mit CSC_LINK (+ CSC_KEY_PASSWORD)
// oder CSC_NAME signiert electron-builder mit der Developer ID; mit APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID
// oder APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER wird zusätzlich notarisiert.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR, ROOT_DIR, stageApp } from './stage-app.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const PLATFORM_FLAGS = { '--mac': 'darwin', '--win': 'win32', '--linux': 'linux' };
const ARCH_FLAGS = { '--arm64': 'arm64', '--x64': 'x64' };

function parseArgs(argv) {
  const opts = { dir: false, skipBuild: false, verify: true, allowCross: false, platform: process.platform, arch: process.arch };
  for (const arg of argv) {
    if (arg === '--dir') opts.dir = true;
    else if (arg === '--skip-build') opts.skipBuild = true;
    else if (arg === '--no-verify') opts.verify = false;
    else if (arg === '--allow-cross') opts.allowCross = true;
    else if (arg in PLATFORM_FLAGS) opts.platform = PLATFORM_FLAGS[arg];
    else if (arg in ARCH_FLAGS) opts.arch = ARCH_FLAGS[arg];
    else throw new Error(`Unbekannte Option: ${arg}`);
  }
  return opts;
}

/** Ordner der entpackten App in release/ (Namensschema von electron-builder). */
export function unpackedLayout(releaseDir, platform, arch, productName = 'Director Studio', executableName = 'director-studio') {
  if (platform === 'darwin') {
    const app = path.join(releaseDir, arch === 'x64' ? 'mac' : `mac-${arch}`, `${productName}.app`);
    return { root: app, resources: path.join(app, 'Contents', 'Resources'), executable: path.join(app, 'Contents', 'MacOS', productName) };
  }
  if (platform === 'win32') {
    const root = path.join(releaseDir, arch === 'x64' ? 'win-unpacked' : `win-${arch}-unpacked`);
    return { root, resources: path.join(root, 'resources'), executable: path.join(root, `${productName}.exe`) };
  }
  const root = path.join(releaseDir, arch === 'x64' ? 'linux-unpacked' : `linux-${arch}-unpacked`);
  return { root, resources: path.join(root, 'resources'), executable: path.join(root, executableName) };
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${path.basename(cmd)} ${args.join(' ')} ist fehlgeschlagen (Exit ${result.status ?? result.signal})`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cross = opts.platform !== process.platform || opts.arch !== process.arch;
  if (cross && !opts.allowCross) {
    throw new Error(
      `Ziel ${opts.platform}-${opts.arch} ≠ Build-Rechner ${process.platform}-${process.arch}. Die nativen Pakete ` +
        '(Remotion-Compositor, esbuild, Claude-Code-Binary) stammen aus diesem node_modules – bitte auf der Zielplattform bauen ' +
        '(oder --allow-cross nur zum Testen der Konfiguration).',
    );
  }

  if (!opts.skipBuild) {
    console.log('▸ Main/Preload und Oberfläche bauen');
    run(process.execPath, [path.join(here, 'build-main.mjs')], { cwd: APP_DIR });
    run(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js'), 'build', '--config', 'vite.renderer.config.ts'], { cwd: APP_DIR });
  }

  console.log('▸ Staging (Laufzeitpakete aus dem Lockfile, Plattform des Build-Rechners)');
  stageApp();
  if (cross) console.warn(`⚠ Cross-Build: Die nativen Pakete sind für ${process.platform}-${process.arch}, die App ist für ${opts.platform}-${opts.arch} – so nicht lauffähig.`);

  console.log('▸ electron-builder');
  const builder = require('electron-builder');
  const electronPkgFile = require.resolve('electron/package.json');
  const electronVersion = require(electronPkgFile).version;
  const electronDist = path.join(path.dirname(electronPkgFile), 'dist');
  // Das electron-Paket (Version 44) lädt sein Binary erst beim ersten `require('electron')` (kein postinstall) – hier anstoßen,
  // damit electron-builder das installierte Electron nimmt statt es erneut herunterzuladen.
  if (!cross && !existsSync(electronDist)) {
    try {
      require('electron');
    } catch (error) {
      console.warn(`  Electron-Binary nicht vorab geladen (${error instanceof Error ? error.message : error}) – electron-builder lädt es selbst.`);
    }
  }
  const hasDeveloperId = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
  /** @type {import('electron-builder').Configuration} */
  const config = {
    electronVersion,
    // Das installierte Electron (gleiche Version) statt eines Downloads – nur für die eigene Plattform/Architektur.
    ...(!cross && existsSync(electronDist) ? { electronDist } : {}),
    ...(opts.platform === 'darwin' && !hasDeveloperId ? { mac: { identity: '-', notarize: false } } : {}),
    // Mit electronDist räumt electron-builder Electrons Beispiel-App nicht weg (vor dem Signieren entfernen).
    afterPack: async ({ appOutDir, packager }) => {
      const resources =
        packager.platform === builder.Platform.MAC ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : path.join(appOutDir, 'resources');
      await rm(path.join(resources, 'default_app.asar'), { force: true });
    },
  };
  if (opts.platform === 'darwin') console.log(hasDeveloperId ? '  macOS: Signierung mit Developer ID (CSC_LINK/CSC_NAME)' : '  macOS: Ad-hoc-Signierung (keine Developer ID konfiguriert)');
  const platform = { darwin: builder.Platform.MAC, win32: builder.Platform.WINDOWS, linux: builder.Platform.LINUX }[opts.platform];
  const arch = builder.Arch[opts.arch];
  if (!platform || arch === undefined) throw new Error(`Nicht unterstützt: ${opts.platform}-${opts.arch}`);
  const artifacts = await builder.build({
    projectDir: APP_DIR,
    targets: platform.createTarget(opts.dir ? 'dir' : null, arch),
    config,
    publish: 'never',
  });

  const layout = unpackedLayout(path.join(APP_DIR, 'release'), opts.platform, opts.arch);
  if (opts.verify && !cross) {
    console.log('▸ Prüfung der gepackten App (externe Importe, Laufzeit-Auflösungen, native Helfer)');
    run(layout.executable, [path.join(here, 'verify-app.mjs'), '--resources', layout.resources], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  }

  console.log('\n✔ Fertig.');
  if (existsSync(layout.root)) console.log(`  App:       ${layout.root} (${formatSize(dirSize(layout.root))})`);
  for (const file of artifacts.filter((a) => !a.endsWith('.blockmap'))) console.log(`  Artefakt:  ${file}`);
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.chdir(ROOT_DIR);
  main().catch((error) => {
    console.error(`\n✘ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
