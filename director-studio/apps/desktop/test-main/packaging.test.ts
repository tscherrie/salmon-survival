import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
import { unpackedLayout } from '../scripts/dist.mjs';

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
  mac: { hardenedRuntime: boolean; entitlements: string; entitlementsInherit: string; identity?: unknown; extendInfo: Record<string, string> };
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

  it('macOS: Hardened Runtime mit Entitlements für JIT, Mikrofon und ad hoc signierte Helfer', async () => {
    const c = await config();
    expect(c.mac.hardenedRuntime).toBe(true);
    // Die Identität setzt dist.mjs (ad hoc ohne Developer ID) – statisch würde sie echte Signierung verhindern.
    expect(c.mac.identity).toBeUndefined();
    expect(c.mac.extendInfo.NSMicrophoneUsageDescription).toContain('Push-to-Talk');
    expect(c.mac.entitlementsInherit).toBe(c.mac.entitlements);
    const plist = await readFile(join(appDir, c.mac.entitlements), 'utf8');
    for (const key of [
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
      'com.apple.security.cs.disable-library-validation',
      'com.apple.security.device.audio-input',
    ]) {
      expect(plist).toMatch(new RegExp(`<key>${key.replace(/\./g, '\\.')}</key>\\s*<true/>`));
    }
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

  it('das gebaute Main-Bündel listet seine externen Importe (externals.json)', async () => {
    const file = join(appDir, 'out', 'main', 'externals.json');
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) return; // ohne vorherigen Build nichts zu prüfen
    const names = npmExternals(JSON.parse(text)).map((e: { path: string }) => packageNameOf(e.path));
    expect(names).toEqual(expect.arrayContaining(['@remotion/bundler', '@remotion/renderer', 'remotion', 'react', 'esbuild', 'playwright', 'zod']));
  });
});
