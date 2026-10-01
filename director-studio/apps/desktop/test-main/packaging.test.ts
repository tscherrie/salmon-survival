import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error – js-yaml kommt mit electron-builder (ohne eigene Typen); derselbe Parser liest die Konfiguration
import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error – reines ESM-Skript ohne Typdeklaration
import { collectClosure, npmExternals, packageNameOf, resolvePackageDir } from '../scripts/package-lib.mjs';
// @ts-expect-error – reines ESM-Skript ohne Typdeklaration
import { electronFuses, MAC_SIGN_IGNORE, macSigningConfig, unpackedLayout, unsupportedTarget } from '../scripts/dist.mjs';
// @ts-expect-error – reines ESM-Skript ohne Typdeklaration
import { findMachOFiles, findRelativeInstallNames, fixRelativeInstallNames, installNameToolArgs, isMachOHeader, isRelativeInstallName, parseMachO } from '../scripts/macho.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

interface BuilderConfig {
  electronVersion: string;
  asar: boolean;
  publish: unknown;
  npmRebuild: boolean;
  directories: { app: string; output: string };
  files: string[];
  extraResources: Array<{ from: string; to: string; filter?: string[] }>;
  mac: { hardenedRuntime: boolean; entitlements: string; entitlementsInherit: string; identity?: unknown; signIgnore: string[]; extendInfo: Record<string, string> };
  win: { target: string[] };
}

describe('electron-builder.yml', () => {
  const config = () => readFile(join(appDir, 'electron-builder.yml'), 'utf8').then((text) => yaml.load(text) as BuilderConfig);

  it('Electron-Version entspricht der installierten (sonst passen Header und Binary nicht)', async () => {
    expect((await config()).electronVersion).toBe((require('electron/package.json') as { version: string }).version);
  });

  it('App aus dem Staging im asar, Laufzeitpakete als resources/node_modules, kein Veröffentlichen', async () => {
    const c = await config();
    expect(c.asar).toBe(true);
    expect(c.publish).toBeNull();
    expect(c.npmRebuild).toBe(false);
    expect(c.directories.app).toBe('dist/stage/app');
    expect(c.files).toEqual(expect.arrayContaining(['out/**', 'package.json', '!**/*.map']));
    expect(c.extraResources).toContainEqual({ from: 'dist/stage/node_modules', to: 'node_modules', filter: ['**/*'] });
    // Optionale ffmpeg-Builds bleiben konfiguriert (fehlender Ordner = nur Warnung).
    expect(c.extraResources).toContainEqual(expect.objectContaining({ from: 'vendor/ffmpeg/${os}-${arch}', to: 'ffmpeg' }));
    expect(c.win.target).toEqual(['nsis']);
  });

  const entitlementKeys = (plist: string) => [...plist.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map((m) => m[1]).sort();

  it('macOS: Hardened Runtime; Developer ID nur mit JIT, Mikrofon und Netz (Library Validation bleibt an)', async () => {
    const c = await config();
    expect(c.mac.hardenedRuntime).toBe(true);
    // Die Identität setzt dist.mjs (ad hoc ohne Developer ID) – statisch würde sie echte Signierung verhindern.
    expect(c.mac.identity).toBeUndefined();
    expect(c.mac.extendInfo.NSMicrophoneUsageDescription).toContain('Push-to-Talk');
    expect(c.mac.entitlementsInherit).toBe(c.mac.entitlements);
    expect(c.mac.signIgnore).toEqual(MAC_SIGN_IGNORE);
    expect(entitlementKeys(await readFile(join(appDir, c.mac.entitlements), 'utf8'))).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.device.audio-input',
      'com.apple.security.network.client',
    ]);
  });

  it('macOS ad hoc: zusätzlich nur disable-library-validation (keine Team-ID), nie DYLD-Variablen oder unsignierter Speicher', async () => {
    const adhoc = macSigningConfig({ hasDeveloperId: false });
    expect(adhoc).toMatchObject({ identity: '-', notarize: false, entitlements: 'build/entitlements.mac.adhoc.plist', entitlementsInherit: 'build/entitlements.mac.adhoc.plist' });
    expect(entitlementKeys(await readFile(join(appDir, adhoc.entitlements), 'utf8'))).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.disable-library-validation',
      'com.apple.security.device.audio-input',
      'com.apple.security.network.client',
    ]);
    const developerId = macSigningConfig({ hasDeveloperId: true });
    expect(developerId.identity).toBeUndefined();
    expect(developerId.entitlements).toBe('build/entitlements.mac.plist');
    // install-mac.sh signiert notfalls mit derselben Datei nach.
    expect(await readFile(join(appDir, '..', '..', 'scripts', 'install-mac.sh'), 'utf8')).toContain('build/entitlements.mac.adhoc.plist');
  });

  it('macOS: das Claude-Code-Binary behält Anthropics Signatur (signIgnore), alles andere wird signiert', () => {
    const ignored = (file: string) => MAC_SIGN_IGNORE.some((re: string) => new RegExp(re).test(file));
    const res = '/x/release/mac-arm64/Director Studio.app/Contents/Resources/node_modules';
    expect(ignored(`${res}/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`)).toBe(true);
    expect(ignored(`${res}/@anthropic-ai/claude-agent-sdk-darwin-x64/claude`)).toBe(true);
    expect(ignored(`${res}/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude.bak`)).toBe(false);
    expect(ignored(`${res}/@remotion/compositor-darwin-arm64/remotion`)).toBe(false);
    expect(ignored(`${res}/@esbuild/darwin-arm64/bin/esbuild`)).toBe(false);
  });
});

describe('Electron-Fuses (dist.mjs)', () => {
  it('ausgelieferte App: kein RunAsNode, kein NODE_OPTIONS, kein --inspect, nur app.asar mit Integritätsprüfung', () => {
    expect(electronFuses()).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      onlyLoadAppFromAsar: true,
      enableEmbeddedAsarIntegrityValidation: true,
    });
  });

  it('--test-fuses erlaubt nur die Inspektor-Argumente (Playwright)', () => {
    expect(electronFuses({ testFuses: true })).toEqual({ ...electronFuses(), enableNodeCliInspectArguments: true });
  });

  it('Zielplattformen: Windows nur x64 (Remotion-Compositor/Headless-Shell), macOS beide', () => {
    expect(unsupportedTarget('win32', 'arm64')).toMatch(/x64-Version von Node\.js/);
    expect(unsupportedTarget('win32', 'x64')).toBeNull();
    expect(unsupportedTarget('darwin', 'arm64')).toBeNull();
    expect(unsupportedTarget('darwin', 'x64')).toBeNull();
    expect(unsupportedTarget('linux', 'x64')).toBeNull();
    expect(unsupportedTarget('freebsd', 'x64')).toMatch(/Nicht unterstützt/);
  });
});

/** Minimales Mach-O (64 Bit, little endian) mit ID, Abhängigkeiten und rpaths. */
function machO({ id, deps = [], rpaths = [] }: { id?: string; deps?: string[]; rpaths?: string[] }): Buffer {
  const pad = (n: number) => Math.ceil(n / 8) * 8;
  const commands: Buffer[] = [];
  const dylib = (cmd: number, name: string) => {
    const size = pad(24 + Buffer.byteLength(name) + 1);
    const b = Buffer.alloc(size);
    b.writeUInt32LE(cmd, 0);
    b.writeUInt32LE(size, 4);
    b.writeUInt32LE(24, 8);
    b.write(name, 24);
    commands.push(b);
  };
  if (id) dylib(0xd, id);
  for (const dep of deps) dylib(0xc, dep);
  for (const rpath of rpaths) {
    const size = pad(12 + Buffer.byteLength(rpath) + 1);
    const b = Buffer.alloc(size);
    b.writeUInt32LE(0x8000001c, 0);
    b.writeUInt32LE(size, 4);
    b.writeUInt32LE(12, 8);
    b.write(rpath, 12);
    commands.push(b);
  }
  const body = Buffer.concat(commands);
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4); // arm64
  header.writeUInt32LE(id ? 6 : 2, 12); // MH_DYLIB bzw. MH_EXECUTE
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(body.length, 20);
  return Buffer.concat([header, body, Buffer.alloc(64)]);
}

describe('Mach-O (macho.mjs): relative Bibliotheksnamen des Remotion-Compositors', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dstudio-macho-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('liest ID, Abhängigkeiten und rpaths (auch aus Universal-Binaries) und erkennt Java-Klassen nicht als Mach-O', () => {
    const thin = machO({ id: 'libavcodec.dylib', deps: ['libavutil.dylib', '/usr/lib/libSystem.B.dylib'], rpaths: ['@loader_path'] });
    expect(parseMachO(thin)).toEqual({ slices: [{ cputype: 0x0100000c, id: 'libavcodec.dylib', dependencies: ['libavutil.dylib', '/usr/lib/libSystem.B.dylib'], rpaths: ['@loader_path'] }] });
    const fat = Buffer.alloc(64 + thin.length);
    fat.writeUInt32BE(0xcafebabe, 0);
    fat.writeUInt32BE(1, 4);
    fat.writeUInt32BE(0x0100000c, 8);
    fat.writeUInt32BE(64, 16); // Offset des Slices
    fat.writeUInt32BE(thin.length, 20);
    thin.copy(fat, 64);
    expect(parseMachO(fat)!.slices[0].dependencies).toEqual(['libavutil.dylib', '/usr/lib/libSystem.B.dylib']);
    const javaClass = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34]);
    expect(isMachOHeader(javaClass)).toBe(false);
    expect(parseMachO(Buffer.from('#!/bin/sh\necho hallo\n'))).toBeNull();
    expect(['libavcodec.dylib', 'lib/x.dylib', '/usr/lib/libz.dylib', '@rpath/x.dylib', '@loader_path/x.dylib'].map(isRelativeInstallName)).toEqual([true, true, false, false, false]);
  });

  it('findet Binaries mit relativen Namen und plant @loader_path (nur für Bibliotheken direkt daneben)', async () => {
    const comp = join(dir, '@remotion', 'compositor-darwin-arm64');
    await mkdir(comp, { recursive: true });
    await writeFile(join(comp, 'ffprobe'), machO({ deps: ['libavformat.dylib', '/usr/lib/libSystem.B.dylib'] }));
    await chmod(join(comp, 'ffprobe'), 0o755);
    await writeFile(join(comp, 'libavformat.dylib'), machO({ id: 'libavformat.dylib', deps: ['/usr/lib/libz.1.dylib'] }));
    await writeFile(join(comp, 'README.md'), 'kein Binary');
    await writeFile(join(dir, 'ok.node'), machO({ deps: ['@rpath/libok.dylib', '/usr/lib/libc++.1.dylib'] }));
    expect(findMachOFiles(dir).map((f: string) => f.slice(dir.length + 1))).toEqual(['@remotion/compositor-darwin-arm64/ffprobe', '@remotion/compositor-darwin-arm64/libavformat.dylib', 'ok.node']);
    const found = findRelativeInstallNames(dir);
    expect(found).toEqual([
      { file: join(comp, 'ffprobe'), id: null, relative: ['libavformat.dylib'] },
      { file: join(comp, 'libavformat.dylib'), id: 'libavformat.dylib', relative: [] },
    ]);
    expect(installNameToolArgs(found[0])).toEqual(['-change', 'libavformat.dylib', '@loader_path/libavformat.dylib']);
    expect(installNameToolArgs(found[1])).toEqual(['-id', '@loader_path/libavformat.dylib']);
    expect(() => installNameToolArgs({ file: join(comp, 'ffprobe'), id: null, relative: ['libfehlt.dylib'] })).toThrow(/nicht daneben/);
    // Nichts zu tun → install_name_tool wird gar nicht erst gesucht.
    await rm(comp, { recursive: true });
    expect(fixRelativeInstallNames(dir, { tool: '/gibt/es/nicht' })).toEqual([]);
  });

  // Mit echtem Compositor und install_name_tool (macOS: Command Line Tools; Linux: z. B.
  // INSTALL_NAME_TOOL=llvm-install-name-tool und STUDIO_TEST_DARWIN_COMPOSITOR=<entpacktes compositor-darwin-*-Paket>).
  const realCompositor =
    process.env.STUDIO_TEST_DARWIN_COMPOSITOR ??
    (() => {
      const scope = join(appDir, '..', '..', 'node_modules', '@remotion');
      const name = existsSync(scope) ? readdirSync(scope).find((n) => n.startsWith('compositor-darwin-')) : undefined;
      return name ? join(scope, name) : undefined;
    })();
  const tool = process.env.INSTALL_NAME_TOOL ?? (process.platform === 'darwin' ? spawnSync('xcrun', ['--find', 'install_name_tool'], { encoding: 'utf8' }).stdout?.trim() : undefined);
  it.skipIf(!realCompositor || !tool)('echter Compositor: danach keine relativen Namen mehr', async () => {
    const copy = join(dir, 'node_modules', '@remotion', 'compositor');
    await cp(realCompositor!, copy, { recursive: true });
    expect(findRelativeInstallNames(join(dir, 'node_modules')).length).toBeGreaterThan(0);
    const changed = fixRelativeInstallNames(join(dir, 'node_modules'), { tool });
    expect(changed.map((c: { file: string }) => c.file.split('/').pop())).toEqual(expect.arrayContaining(['remotion', 'ffmpeg', 'ffprobe', 'libavcodec.dylib']));
    expect(findRelativeInstallNames(join(dir, 'node_modules'))).toEqual([]);
    const ffprobe = parseMachO(await readFile(join(copy, 'ffprobe')))!;
    expect(ffprobe.slices[0].dependencies).toContain('@loader_path/libavcodec.dylib');
  });
});

describe('unpackedLayout (dist.mjs)', () => {
  it('kennt die Ordner von electron-builder je Plattform/Architektur', () => {
    expect(unpackedLayout('/r', 'darwin', 'arm64')).toEqual({
      root: '/r/mac-arm64/Director Studio.app',
      resources: '/r/mac-arm64/Director Studio.app/Contents/Resources',
      executable: '/r/mac-arm64/Director Studio.app/Contents/MacOS/Director Studio',
    });
    expect(unpackedLayout('/r', 'darwin', 'x64').root).toBe('/r/mac/Director Studio.app');
    expect(unpackedLayout('/r', 'win32', 'x64').executable).toBe(join('/r', 'win-unpacked', 'Director Studio.exe'));
    expect(unpackedLayout('/r', 'linux', 'x64').executable).toBe('/r/linux-unpacked/director-studio');
  });
});

describe('Abhängigkeitshülle (package-lib.mjs)', () => {
  let root: string;
  const pkg = async (dir: string, json: Record<string, unknown>) => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify(json));
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dstudio-closure-'));
    const nm = join(root, 'node_modules');
    await pkg(root, { name: 'root', workspaces: ['packages/*'] });
    await pkg(join(nm, 'app-dep'), { name: 'app-dep', version: '1.0.0', dependencies: { shared: '^1' }, optionalDependencies: { 'native-linux': '1', 'native-win': '1' }, peerDependencies: { peer: '*', 'peer-optional': '*' }, peerDependenciesMeta: { 'peer-optional': { optional: true } } });
    await pkg(join(nm, 'shared'), { name: 'shared', version: '1.2.0' });
    await pkg(join(nm, 'native-linux'), { name: 'native-linux', version: '1.0.0' });
    await pkg(join(nm, 'peer'), { name: 'peer', version: '3.0.0' });
    // Verschachtelte Version für ein Paket, das eine andere Hauptversion braucht.
    await pkg(join(nm, '@scope', 'tool'), { name: '@scope/tool', version: '2.0.0', dependencies: { shared: '^2' } });
    await pkg(join(nm, '@scope', 'tool', 'node_modules', 'shared'), { name: 'shared', version: '2.0.0' });
    await pkg(join(nm, 'dev-only'), { name: 'dev-only', version: '9.9.9' });
    // Workspace-Paket als Symlink (wird gebündelt, nicht kopiert).
    await pkg(join(root, 'packages', 'core'), { name: '@studio/core', version: '0.1.0' });
    await mkdir(join(nm, '@studio'), { recursive: true });
    await symlink(join(root, 'packages', 'core'), join(nm, '@studio', 'core'), 'dir');
    await pkg(join(nm, 'uses-workspace'), { name: 'uses-workspace', version: '1.0.0', dependencies: { '@studio/core': '*', missing: '^1' } });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('nimmt Abhängigkeiten, vorhandene optionale und Peer-Pakete in der installierten Verschachtelung mit', () => {
    const { packages, missing } = collectClosure({ rootDir: root, roots: ['app-dep', '@scope/tool'] });
    expect([...packages.keys()].sort()).toEqual([
      'node_modules/@scope/tool',
      'node_modules/@scope/tool/node_modules/shared',
      'node_modules/app-dep',
      'node_modules/native-linux',
      'node_modules/peer',
      'node_modules/shared',
    ]);
    expect(packages.get('node_modules/@scope/tool/node_modules/shared').version).toBe('2.0.0');
    expect(packages.get('node_modules/shared').version).toBe('1.2.0');
    // Fehlende optionale Pakete (andere Plattform) und optionale Peers sind kein Fehler; dev-only bleibt draußen.
    expect(missing).toEqual([]);
    expect(packages.has('node_modules/dev-only')).toBe(false);
  });

  it('überspringt Workspace-Symlinks und meldet fehlende Pflichtpakete', () => {
    const { packages, missing } = collectClosure({ rootDir: root, roots: ['uses-workspace'] });
    expect([...packages.keys()]).toEqual(['node_modules/uses-workspace']);
    expect(missing).toEqual([{ name: 'missing', requiredBy: 'uses-workspace', kind: 'required' }]);
  });

  it('skip-Filter (z. B. musl-Varianten unter glibc)', () => {
    const { packages } = collectClosure({ rootDir: root, roots: ['app-dep'], skip: (name: string) => name.startsWith('native-') });
    expect(packages.has('node_modules/native-linux')).toBe(false);
  });

  it('löst wie Node auf: erst verschachtelt, dann nach oben', () => {
    expect(resolvePackageDir('shared', join(root, 'node_modules', '@scope', 'tool'), root)).toBe(join(root, 'node_modules', '@scope', 'tool', 'node_modules', 'shared'));
    expect(resolvePackageDir('shared', join(root, 'node_modules', 'app-dep'), root)).toBe(join(root, 'node_modules', 'shared'));
    expect(resolvePackageDir('gibt-es-nicht', root, root)).toBeNull();
  });
});

describe('Externe Importe', () => {
  it('Paketnamen und Filter', () => {
    expect(packageNameOf('ajv/dist/2020.js')).toBe('ajv');
    expect(packageNameOf('@remotion/renderer')).toBe('@remotion/renderer');
    expect(packageNameOf('react/jsx-runtime')).toBe('react');
    const list = [
      { path: 'node:fs', kinds: ['import-statement'] },
      { path: 'fs', kinds: ['require-call'] },
      { path: 'electron', kinds: ['import-statement'] },
      { path: 'zod', kinds: ['import-statement'] },
      { path: '@anthropic-ai/claude-agent-sdk', kinds: ['dynamic-import'] },
    ];
    expect(npmExternals(list).map((e: { path: string }) => e.path)).toEqual(['zod', '@anthropic-ai/claude-agent-sdk']);
  });

  it('das gebaute Main-Bündel bringt die Director-Skills und den Chromium-Hilfsprozess mit', async () => {
    const out = join(appDir, 'out');
    if (!existsSync(join(out, 'main', 'index.js'))) return; // ohne vorherigen Build nichts zu prüfen
    const source = join(appDir, '..', '..', 'packages', 'director', 'skills');
    const skills = readdirSync(source).filter((name) => existsSync(join(source, name, 'SKILL.md')));
    expect(skills.length).toBeGreaterThan(10);
    // defaultSkillsDir() im Bündel: new URL('../skills/', out/main/index.js) → out/skills
    for (const name of skills) expect(await readFile(join(out, 'skills', name, 'SKILL.md'), 'utf8')).toBe(await readFile(join(source, name, 'SKILL.md'), 'utf8'));
    expect(existsSync(join(out, 'main', 'chromium-worker.js'))).toBe(true);
  });

  it('das gebaute Main-Bündel listet seine externen Importe (externals.json)', async () => {
    const file = join(appDir, 'out', 'main', 'externals.json');
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return; // ohne vorherigen Build nichts zu prüfen
    const names = npmExternals(JSON.parse(text)).map((e: { path: string }) => packageNameOf(e.path));
    expect(names).toEqual(expect.arrayContaining(['@remotion/bundler', '@remotion/renderer', 'remotion', 'react', 'esbuild', 'playwright', 'zod']));
  });
});
