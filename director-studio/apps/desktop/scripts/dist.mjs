// Baut die installierbare App für den Build-Rechner: Main/Preload/Oberfläche bauen → Staging (stage-app.mjs) →
// electron-builder → Vollständigkeitsprüfung der gepackten App (verify-app.mjs, läuft mit dem gepackten Electron).
//
//   node apps/desktop/scripts/dist.mjs              Installer (macOS .dmg, Windows NSIS-.exe, Linux .tar.gz)
//   node apps/desktop/scripts/dist.mjs --dir        nur die entpackte App (für die lokale Installation)
//   … --mac | --win | --linux                       Zielplattform; muss die des Build-Rechners sein (s. u.)
//   … --skip-build                                  vorhandenes out/ verwenden
//   … --no-verify                                   Prüfung der gepackten App überspringen
//   … --test-fuses                                  nur für Tests: Node-Inspektor-Argumente erlauben (Playwright, s. u.)
//   … --allow-cross                                 andere Plattform trotzdem paketieren (nur zum Testen der Konfiguration)
//
// Plattform und Architektur folgen dem Build-Rechner, weil die nativen Pakete (Remotion-Compositor, esbuild,
// rspack, Claude-Code-Binary) aus dessen node_modules stammen: Eine Mac-App auf dem Mac bauen, eine Windows-App
// unter Windows (x64; für Windows auf ARM64 gibt es weder Remotion-Compositor noch Chromium-Headless-Shell).
//
// Electron-Fuses (immer): kein ELECTRON_RUN_AS_NODE, kein NODE_OPTIONS, keine --inspect-Argumente, App nur aus dem
// app.asar und dessen Integrität geprüft. Sonst könnte jeder lokale Prozess beliebiges JavaScript unter der Identität
// der App ausführen – mit ihrem Schlüsselbund-Zugriff (verschlüsselte API-Keys) und der Mikrofon-Freigabe.
// `--test-fuses` lässt nur die Inspektor-Argumente an: Playwright steuert Electron darüber (npm run test:packaged).
//
// macOS-Signierung: Ohne CSC_LINK/CSC_NAME wird ad hoc signiert (Identität „-“, Hardened Runtime mit den
// Entitlements aus build/entitlements.mac.adhoc.plist) – genug für den eigenen Rechner. Mit CSC_LINK (+ CSC_KEY_PASSWORD)
// oder CSC_NAME signiert electron-builder mit der Developer ID (build/entitlements.mac.plist); mit
// APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID oder APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER wird
// zusätzlich notarisiert. Vor dem Signieren stellt afterPack die relativen Bibliotheksnamen des Remotion-Compositors
// auf @loader_path um (scripts/macho.mjs; braucht install_name_tool aus den Xcode Command Line Tools).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findInstallNameTool, fixRelativeInstallNames } from './macho.mjs';
import { APP_DIR, ROOT_DIR, stageApp } from './stage-app.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const PLATFORM_FLAGS = { '--mac': 'darwin', '--win': 'win32', '--linux': 'linux' };
const ARCH_FLAGS = { '--arm64': 'arm64', '--x64': 'x64' };

/**
 * Das Claude-Code-Binary des Agent-SDK ist von Anthropic signiert (Developer ID, Hardened Runtime, eigene
 * Entitlements) und behält diese Signatur: neu signiert verlöre es Notarisierung und Code-Identität (der Zugriff auf
 * den Schlüsselbund-Eintrag eines Claude-Abos fragte dann nach jedem Update erneut).
 */
export const MAC_SIGN_IGNORE = ['/node_modules/@anthropic-ai/claude-agent-sdk-darwin-[^/]+/claude$'];

/** Fuses der ausgelieferten App (siehe oben); `testFuses` erlaubt nur die Inspektor-Argumente (Playwright). */
export function electronFuses({ testFuses = false } = {}) {
  return {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: testFuses,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
  };
}

/** macOS-Signierung: ad hoc (lokal) oder mit Developer ID; jeweils mit den passenden Entitlements. */
export function macSigningConfig({ hasDeveloperId }) {
  const entitlements = hasDeveloperId ? 'build/entitlements.mac.plist' : 'build/entitlements.mac.adhoc.plist';
  return {
    ...(hasDeveloperId ? {} : { identity: '-', notarize: false }),
    entitlements,
    entitlementsInherit: entitlements,
    signIgnore: MAC_SIGN_IGNORE,
  };
}

/** Plattformen, für die eine App gebaut werden kann (native Pakete von Remotion, Chromium-Headless-Shell). */
export function unsupportedTarget(platform, arch) {
  if (platform === 'win32' && arch !== 'x64') {
    return (
      `Windows auf ${arch} wird nicht unterstützt: Für Windows gibt es Remotions Compositor und die Chromium-Headless-Shell nur für x64. ` +
      'Auf einem ARM-Rechner die x64-Version von Node.js installieren (läuft in der x64-Emulation) und damit bauen.'
    );
  }
  if (!['darwin', 'win32', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) return `Nicht unterstützt: ${platform}-${arch}`;
  return null;
}

function parseArgs(argv) {
  const opts = { dir: false, skipBuild: false, verify: true, allowCross: false, testFuses: false, platform: process.platform, arch: process.arch };
  for (const arg of argv) {
    if (arg === '--dir') opts.dir = true;
    else if (arg === '--skip-build') opts.skipBuild = true;
    else if (arg === '--no-verify') opts.verify = false;
    else if (arg === '--allow-cross') opts.allowCross = true;
    else if (arg === '--test-fuses') opts.testFuses = true;
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
  const unsupported = unsupportedTarget(opts.platform, opts.arch);
  if (unsupported) throw new Error(unsupported);
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
  // Auf dem Mac vorab prüfen (nicht erst im afterPack): install_name_tool muss da sein.
  const installNameTool = opts.platform === 'darwin' && !cross ? findInstallNameTool() : undefined;
  const fuses = electronFuses({ testFuses: opts.testFuses });
  /** @type {import('electron-builder').Configuration} */
  const config = {
    electronVersion,
    // Das installierte Electron (gleiche Version) statt eines Downloads – nur für die eigene Plattform/Architektur.
    ...(!cross && existsSync(electronDist) ? { electronDist } : {}),
    ...(opts.platform === 'darwin' ? { mac: macSigningConfig({ hasDeveloperId }) } : {}),
    electronFuses: fuses,
    // Läuft nach dem Zusammenstellen, vor Fuses und Signatur.
    afterPack: async ({ appOutDir, packager }) => {
      const mac = packager.platform === builder.Platform.MAC;
      const resources = mac ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : path.join(appOutDir, 'resources');
      // Mit electronDist räumt electron-builder Electrons Beispiel-App nicht weg.
      await rm(path.join(resources, 'default_app.asar'), { force: true });
      if (mac) {
        console.log('  macOS: relative Bibliotheksnamen (Remotion-Compositor) → @loader_path');
        const changed = fixRelativeInstallNames(path.join(resources, 'node_modules'), { tool: installNameTool, log: (m) => console.log(m) });
        if (changed.length === 0) console.log('    (nichts zu ändern)');
      }
    },
  };
  if (opts.platform === 'darwin') console.log(hasDeveloperId ? '  macOS: Signierung mit Developer ID (CSC_LINK/CSC_NAME)' : '  macOS: Ad-hoc-Signierung (keine Developer ID konfiguriert)');
  if (opts.testFuses) console.warn('  ⚠ --test-fuses: Node-Inspektor-Argumente bleiben an – nur für Tests, nicht installieren.');
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
  if (!cross) {
    console.log('▸ Fuses der gepackten App');
    await checkFuses(layout.executable, fuses);
  }
  if (opts.verify && !cross) {
    console.log('▸ Prüfung der gepackten App (Skills, externe Importe, Laufzeit-Auflösungen, native Helfer)');
    // Die gepackte App startet nicht mehr als Node (Fuse RunAsNode aus) – das gleiche Electron aus node_modules
    // liest ihr app.asar und lädt ihre Module; die nativen Helfer sind die der gepackten App.
    const electronBinary = require('electron');
    run(electronBinary, [path.join(here, 'verify-app.mjs'), '--resources', layout.resources], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  }

  console.log('\n✔ Fertig.');
  if (existsSync(layout.root)) console.log(`  App:       ${layout.root} (${formatSize(dirSize(layout.root))})`);
  for (const file of artifacts.filter((a) => !a.endsWith('.blockmap'))) console.log(`  Artefakt:  ${file}`);
}

/** Liest die Fuses aus dem gepackten Binary und vergleicht sie mit der Konfiguration. */
async function checkFuses(executable, expected) {
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
  const wire = await getCurrentFuseWire(executable);
  const names = {
    runAsNode: FuseV1Options.RunAsNode,
    enableNodeOptionsEnvironmentVariable: FuseV1Options.EnableNodeOptionsEnvironmentVariable,
    enableNodeCliInspectArguments: FuseV1Options.EnableNodeCliInspectArguments,
    onlyLoadAppFromAsar: FuseV1Options.OnlyLoadAppFromAsar,
    enableEmbeddedAsarIntegrityValidation: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  };
  const wrong = [];
  for (const [name, value] of Object.entries(expected)) {
    const state = wire[names[name]];
    // FuseState: 48 = aus, 49 = an
    if (state !== (value ? 49 : 48)) wrong.push(`${name}=${state === 49 ? 'an' : state === 48 ? 'aus' : state}`);
  }
  if (wrong.length > 0) throw new Error(`Fuses der gepackten App stimmen nicht: ${wrong.join(', ')}`);
  console.log(`  ✓ ${Object.entries(expected).map(([n, v]) => `${n}=${v ? 'an' : 'aus'}`).join(', ')}`);
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
