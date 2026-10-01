import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareRuntimeDir, systemCheckText } from '../src/main/app-env.ts';
import { cachedHeadlessShell, headlessShellLocation, remotionBrowserPlatform, remotionCacheDir, runChromiumWorker, type ForkWorker, type WorkerProcess } from '../src/main/chromium.ts';
import { RenderService } from '../src/main/services.ts';

const WORKER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'chromium-worker.ts');
const require = createRequire(import.meta.url);
/** Chrome-Version, die das installierte Remotion erwartet (steht in der VERSION-Datei seines Caches). */
const REMOTION_CHROME_VERSION = (
  require(join(dirname(require.resolve('@remotion/renderer/package.json')), 'dist', 'browser', 'get-chrome-download-url.js')) as { TESTED_VERSION: string }
).TESTED_VERSION;

/** Hilfsprozess wie in der App, aber mit Node (`child_process.fork`, TypeScript-Quelle). */
const nodeFork: ForkWorker = (modulePath, { cwd }) => {
  const child = fork(modulePath, [], { cwd, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  return {
    onMessage: (listener) => void child.once('message', listener),
    onExit: (listener) => void child.once('exit', listener),
    kill: () => void child.kill(),
  };
};

/** Legt eine (Schein-)Headless-Shell so in Remotions Cache, wie Remotion sie nach dem Download hinterlässt. */
async function seedHeadlessShell(cwd: string, version = REMOTION_CHROME_VERSION): Promise<string> {
  const location = headlessShellLocation(cwd)!;
  await mkdir(dirname(location.executable), { recursive: true });
  await writeFile(location.executable, '#!/bin/sh\n');
  await chmod(location.executable, 0o755);
  await writeFile(location.versionFile, version);
  return location.executable;
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dstudio-appenv-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('prepareRuntimeDir', () => {
  it('legt <userData>/runtime mit eigenem package.json an (Remotion-Downloads landen dort)', async () => {
    const dir = prepareRuntimeDir(root);
    expect(dir).toBe(join(root, 'runtime'));
    expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))).toMatchObject({ private: true });
  });

  it('ist idempotent und überschreibt nichts', async () => {
    prepareRuntimeDir(root);
    await writeFile(join(root, 'runtime', 'package.json'), '{"name":"eigen"}');
    prepareRuntimeDir(root);
    expect(await readFile(join(root, 'runtime', 'package.json'), 'utf8')).toBe('{"name":"eigen"}');
  });
});

describe('systemCheckText', () => {
  it('alles da', () => {
    const text = systemCheckText({
      media: { ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe', source: 'system', message: null },
      chromium: null,
      provisionChromium: true,
      userData: '/Users/x/Library/Application Support/Director Studio',
    });
    expect(text.ok).toBe(true);
    expect(text.detail).toContain('ffmpeg: /opt/homebrew/bin/ffmpeg (Systeminstallation)');
    expect(text.detail).toContain('automatisch geladen');
  });

  it('Headless-Shell aus einer früheren Sitzung: Pfad und Version statt „wird geladen“', () => {
    const text = systemCheckText({
      media: { ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe', source: 'system', message: null },
      chromium: null,
      cachedChromium: { path: '/u/runtime/node_modules/.remotion/chrome-headless-shell/mac-arm64/x/chrome-headless-shell', version: '149.0.7790.0' },
      provisionChromium: true,
      userData: '/u',
    });
    expect(text.detail).toContain('Chromium: /u/runtime/node_modules/.remotion/chrome-headless-shell/mac-arm64/x/chrome-headless-shell (bereits geladen, Version 149.0.7790.0)');
    expect(text.detail).not.toContain('automatisch geladen');
  });

  it('ffmpeg fehlt: Warnung mit Installationshinweis ohne Markdown', () => {
    const text = systemCheckText({
      media: { ffmpeg: null, ffprobe: null, source: null, message: '**ffmpeg und ffprobe wurden nicht gefunden.** Im Terminal installieren: `brew install ffmpeg`.' },
      chromium: '/x/headless_shell',
      provisionChromium: true,
      userData: '/u',
    });
    expect(text.ok).toBe(false);
    expect(text.message).toContain('ffmpeg fehlt');
    expect(text.detail).toContain('brew install ffmpeg');
    expect(text.detail).not.toContain('**');
    expect(text.detail).toContain('Chromium: /x/headless_shell');
  });
});

describe('RenderService.ensureChromium', () => {
  const saved = process.env.STUDIO_CHROMIUM_PATH;
  afterEach(() => {
    if (saved === undefined) delete process.env.STUDIO_CHROMIUM_PATH;
    else process.env.STUDIO_CHROMIUM_PATH = saved;
  });

  it('ausdrücklicher Pfad gewinnt, ohne Download', async () => {
    let calls = 0;
    const service = new RenderService({ workDir: root, browserExecutable: '/explizit/chrome', provisionChromium: true, ensureBrowser: async () => (calls++, '/geladen') });
    expect(await service.ensureChromium()).toBe('/explizit/chrome');
    expect(calls).toBe(0);
  });

  it('Entwicklung (ohne provisionChromium): nichts tun', async () => {
    delete process.env.STUDIO_CHROMIUM_PATH;
    const service = new RenderService({ workDir: root, ensureBrowser: async () => '/geladen' });
    expect(await service.ensureChromium()).toBeUndefined();
    expect(process.env.STUDIO_CHROMIUM_PATH).toBeUndefined();
  });

  it('gepackte App: lädt einmal und setzt STUDIO_CHROMIUM_PATH für Remotion und Playwright', async () => {
    delete process.env.STUDIO_CHROMIUM_PATH;
    let calls = 0;
    const service = new RenderService({ workDir: root, provisionChromium: true, ensureBrowser: async () => (calls++, '/geladen/headless_shell') });
    const [a, b] = await Promise.all([service.ensureChromium(), service.ensureChromium()]);
    expect([a, b]).toEqual(['/geladen/headless_shell', '/geladen/headless_shell']);
    expect(calls).toBe(1);
    expect(process.env.STUDIO_CHROMIUM_PATH).toBe('/geladen/headless_shell');
  });

  it('gepackte App ohne Bereitstellungsfunktion: klare Meldung statt Remotion im Hauptprozess', async () => {
    delete process.env.STUDIO_CHROMIUM_PATH;
    const service = new RenderService({ workDir: root, provisionChromium: true });
    await expect(service.ensureChromium()).rejects.toThrow(/nicht eingerichtet/);
  });

  it('Fehler beim Laden: verständliche Meldung, nächster Versuch lädt erneut', async () => {
    delete process.env.STUDIO_CHROMIUM_PATH;
    let calls = 0;
    const service = new RenderService({
      workDir: root,
      provisionChromium: true,
      ensureBrowser: async () => {
        calls++;
        if (calls === 1) throw new Error('offline');
        return '/zweiter/versuch';
      },
    });
    await expect(service.ensureChromium()).rejects.toThrow(/Chromium für das Rendern konnte nicht geladen werden.*offline/);
    expect(await service.ensureChromium()).toBe('/zweiter/versuch');
    expect(existsSync(root)).toBe(true);
  });
});

describe('Remotions Cache für die Headless-Shell', () => {
  it('Plattform-Kennungen wie Remotion', () => {
    expect(remotionBrowserPlatform('darwin', 'arm64')).toBe('mac-arm64');
    expect(remotionBrowserPlatform('darwin', 'x64')).toBe('mac-x64');
    expect(remotionBrowserPlatform('win32', 'x64')).toBe('win64');
    expect(remotionBrowserPlatform('linux', 'x64')).toBe('linux64');
    expect(remotionBrowserPlatform('freebsd', 'x64')).toBeNull();
  });

  it('liegt unter dem nächsten Ordner mit package.json (gepackte App: userData/runtime)', async () => {
    const runtime = prepareRuntimeDir(root);
    await mkdir(join(runtime, 'tief', 'drin'), { recursive: true });
    expect(remotionCacheDir(join(runtime, 'tief', 'drin'))).toBe(join(runtime, 'node_modules', '.remotion'));
    expect(headlessShellLocation(runtime, 'darwin', 'arm64')!.executable).toBe(
      join(runtime, 'node_modules', '.remotion', 'chrome-headless-shell', 'mac-arm64', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
    );
    expect(headlessShellLocation(runtime, 'win32', 'x64')!.executable).toMatch(/chrome-headless-shell-win64[\\/]chrome-headless-shell\.exe$/);
  });

  it('cachedHeadlessShell: nichts geladen → null, sonst Pfad und Version', async () => {
    const runtime = prepareRuntimeDir(root);
    expect(cachedHeadlessShell(runtime)).toBeNull();
    const exe = await seedHeadlessShell(runtime, '149.0.7790.0');
    expect(cachedHeadlessShell(runtime)).toEqual({ path: exe, version: '149.0.7790.0' });
  });
});

describe('runChromiumWorker', () => {
  const fakeFork = (behave: (child: { message: (m: unknown) => void; exit: (code: number | null) => void }) => void) => {
    const killed: string[] = [];
    const forkFn: ForkWorker = (modulePath, { cwd }) => {
      let onMessage: (m: unknown) => void = () => {};
      let onExit: (code: number | null) => void = () => {};
      const child: WorkerProcess = {
        onMessage: (l) => void (onMessage = l),
        onExit: (l) => void (onExit = l),
        kill: () => void killed.push(`${modulePath}@${cwd}`),
      };
      setTimeout(() => behave({ message: (m) => onMessage(m), exit: (c) => onExit(c) }), 5);
      return child;
    };
    return { forkFn, killed };
  };

  it('liefert den Pfad und beendet den Hilfsprozess', async () => {
    const { forkFn, killed } = fakeFork((c) => c.message({ ok: true, path: '/shell' }));
    expect(await runChromiumWorker(forkFn, '/w.js', '/cwd')).toBe('/shell');
    expect(killed).toEqual(['/w.js@/cwd']);
  });

  it('meldet Fehler des Hilfsprozesses und ein vorzeitiges Ende', async () => {
    await expect(runChromiumWorker(fakeFork((c) => c.message({ ok: false, message: 'offline' })).forkFn, '/w.js', '/cwd')).rejects.toThrow('offline');
    await expect(runChromiumWorker(fakeFork((c) => c.exit(1)).forkFn, '/w.js', '/cwd')).rejects.toThrow(/vorzeitig beendet \(Code 1\)/);
    await expect(runChromiumWorker(fakeFork(() => undefined).forkFn, '/w.js', '/cwd', 50)).rejects.toThrow(/Zeitüberschreitung/);
  });

  // Der echte Hilfsprozess mit Remotions ensureBrowser – ohne Netz: Ein gesperrter Cache lässt den Download sofort
  // scheitern, danach liegt die Shell im Cache. Früher (ensureBrowser im Hauptprozess) blieb Remotions
  // modulweites Promise nach dem ersten Fehler abgelehnt, und jedes weitere Rendern scheiterte bis zum Neustart.
  it('echter Hilfsprozess: erster Versuch scheitert, der zweite (neuer Prozess) findet die Shell im Cache', async () => {
    const runtime = prepareRuntimeDir(root);
    await mkdir(join(runtime, 'node_modules'), { recursive: true });
    await writeFile(join(runtime, 'node_modules', '.remotion'), 'gesperrt'); // Datei statt Ordner → mkdir scheitert
    delete process.env.STUDIO_CHROMIUM_PATH;
    const service = new RenderService({ workDir: root, provisionChromium: true, ensureBrowser: () => runChromiumWorker(nodeFork, WORKER, runtime, 60_000) });
    await expect(service.ensureChromium()).rejects.toThrow(/Chromium für das Rendern konnte nicht geladen werden.*ENOTDIR/);

    await rm(join(runtime, 'node_modules', '.remotion'));
    const exe = await seedHeadlessShell(runtime);
    try {
      expect(await service.ensureChromium()).toBe(exe);
      expect(process.env.STUDIO_CHROMIUM_PATH).toBe(exe);
    } finally {
      delete process.env.STUDIO_CHROMIUM_PATH;
    }
  }, 60_000);
});
