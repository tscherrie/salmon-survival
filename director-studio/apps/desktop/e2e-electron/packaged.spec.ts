import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ProjectStore } from '@studio/project';
import { headlessShellLocation } from '../src/main/chromium.ts';

/**
 * Smoke-Test der GEPACKTEN App (release/…, vorher `npm run dist:test`, d. h. dist.mjs --dir --test-fuses: Playwright
 * braucht die Inspektor-Argumente): Oberfläche aus dem asar, Director-Skills, Preload/IPC, `studio-asset://`,
 * Projekte anlegen/öffnen und echte lokale Renderings über die mitgelieferten Pakete (Remotion-Bündel + Compositor +
 * ffmpeg für das Video, Playwright/Chromium für das PDF, pptxgenjs), die Website-Vorschau (statisch und mit Vite im
 * utilityProcess) und die Fuses.
 *
 * Chromium: Wie in der ausgelieferten App ohne STUDIO_CHROMIUM_PATH – der Hilfsprozess stellt Remotions
 * Headless-Shell bereit. Ohne Netz (Standard) liegt Playwrights Headless-Shell als „Download“ in Remotions Cache;
 * vorher lässt ein gesperrter Cache den ersten Versuch scheitern (ein zweiter muss in derselben Sitzung gelingen).
 * Mit STUDIO_PACKAGED_DOWNLOAD=1 lädt die App die Shell wirklich herunter (Netz nötig).
 */

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = join(appDir, '..', '..');
const HEADLESS_SHELL = process.env.STUDIO_TEST_HEADLESS_SHELL ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const realDownload = process.env.STUDIO_PACKAGED_DOWNLOAD === '1';
const require = createRequire(import.meta.url);
/** Chrome-Version, die das mitgelieferte Remotion erwartet (steht in der VERSION-Datei seines Caches). */
const REMOTION_CHROME_VERSION = (
  require(join(dirname(require.resolve('@remotion/renderer/package.json')), 'dist', 'browser', 'get-chrome-download-url.js')) as { TESTED_VERSION: string }
).TESTED_VERSION;

function packagedExecutable(): string {
  if (process.env.STUDIO_PACKAGED_APP) return process.env.STUDIO_PACKAGED_APP;
  const release = join(appDir, 'release');
  const arch = process.arch;
  if (process.platform === 'darwin') return join(release, arch === 'x64' ? 'mac' : `mac-${arch}`, 'Director Studio.app', 'Contents', 'MacOS', 'Director Studio');
  if (process.platform === 'win32') return join(release, arch === 'x64' ? 'win-unpacked' : `win-${arch}-unpacked`, 'Director Studio.exe');
  return join(release, arch === 'x64' ? 'linux-unpacked' : `linux-${arch}-unpacked`, 'director-studio');
}

type AnyStudio = { studio: Record<string, (...args: any[]) => any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const studio = <T>(window: Page, method: string, ...args: unknown[]): Promise<T> =>
  window.evaluate(([m, a]) => (window as unknown as AnyStudio).studio[m as string]!(...(a as unknown[])), [method, args] as const) as Promise<T>;

function ffprobeJson(file: string): { streams: Array<{ codec_type: string; codec_name: string }>; format: { duration: string } } {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' }));
}

const executable = packagedExecutable();

test.skip(!existsSync(executable), `Gepackte App fehlt (${executable}) – zuerst „npm run dist:test“`);
test.skip(!realDownload && !existsSync(HEADLESS_SHELL), `Headless-Shell für den Test fehlt (${HEADLESS_SHELL}) – STUDIO_TEST_HEADLESS_SHELL setzen oder STUDIO_PACKAGED_DOWNLOAD=1`);

/** Legt eine Headless-Shell so in Remotions Cache unter `runtime`, wie Remotions Download sie hinterlässt. */
async function seedRemotionCache(runtime: string): Promise<void> {
  const location = headlessShellLocation(runtime)!;
  await mkdir(dirname(location.executable), { recursive: true });
  await symlink(HEADLESS_SHELL, location.executable);
  await writeFile(location.versionFile, REMOTION_CHROME_VERSION);
}

test('gepackte App: Oberfläche aus dem asar, Asset-Protokoll, Projekte und echte Exporte', async () => {
  const work = await mkdtemp(join(tmpdir(), 'dstudio-packaged-'));
  const userData = join(work, 'userdata');
  const projectsDir = join(work, 'projects');
  let app: ElectronApplication | undefined;
  try {
    // Testmedien (System-ffmpeg der Testumgebung).
    const tone = join(work, 'ton.wav');
    const clip = join(work, 'clip.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ac', '2', '-ar', '48000', tone]);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=1', '-pix_fmt', 'yuv420p', clip]);

    // Projekte wie vom Director bearbeitet vorbereiten, die App öffnet sie danach.
    const deck = await ProjectStore.create(projectsDir, { title: 'Deck', category: 'slides' });
    await deck.commitOps(
      [{ op: 'add_slide', slide: { id: 's1', elements: [{ id: 't1', type: 'text', x: 100, y: 100, width: 1200, height: 200, text: '**Hallo** aus der gepackten App' }] } }],
      { note: 'Folie', author: 'director' },
    );
    const deckDir = deck.dir;
    await deck.close();
    const film = await ProjectStore.create(projectsDir, { title: 'Film', category: 'video' });
    const toneAsset = await film.importFile(tone, 'import', { title: 'Ton' });
    await film.commitOps(
      [
        { op: 'update_timeline', patch: { durationFrames: 30 } },
        { op: 'insert_clip', trackId: 'T1', clip: { id: 'txt', start: 0, duration: 30, text: 'Director Studio' } },
        { op: 'insert_clip', trackId: 'A2', clip: { id: 'mus', assetId: toneAsset.id, start: 0, duration: 30 } },
      ],
      { note: 'Test', author: 'director' },
    );
    const filmDir = film.dir;
    await film.close();
    // Websites: eine ohne installiertes Vite (wie aus dem Director), eine mit Vite im node_modules des Site-Ordners.
    const webWithout = await ProjectStore.create(projectsDir, { title: 'Web ohne Vite', category: 'web' });
    await mkdir(webWithout.siteDir, { recursive: true });
    await writeFile(join(webWithout.siteDir, 'package.json'), '{"name":"site","private":true,"devDependencies":{"vite":"*"}}');
    await writeFile(join(webWithout.siteDir, 'index.html'), '<!doctype html><html><body><h1>Statische Vorschau</h1></body></html>');
    const webWithoutDir = webWithout.dir;
    await webWithout.close();
    const webVite = await ProjectStore.create(projectsDir, { title: 'Web mit Vite', category: 'web' });
    await mkdir(join(webVite.siteDir, 'node_modules'), { recursive: true });
    await writeFile(join(webVite.siteDir, 'package.json'), '{"name":"site","private":true,"type":"module"}');
    await writeFile(join(webVite.siteDir, 'index.html'), '<!doctype html><html><body><h1>Vite im utilityProcess</h1></body></html>');
    await symlink(dirname(require.resolve('vite/package.json')), join(webVite.siteDir, 'node_modules', 'vite'), 'dir');
    const webViteDir = webVite.dir;
    await webVite.close();

    // Remotions Cache im Arbeitsordner der App: zunächst gesperrt (Datei statt Ordner) → der erste Versuch scheitert.
    const runtime = join(userData, 'runtime');
    if (!realDownload) {
      await mkdir(join(runtime, 'node_modules'), { recursive: true });
      await writeFile(join(runtime, 'node_modules', '.remotion'), 'gesperrt');
    }
    const { STUDIO_CHROMIUM_PATH: _ignored, ...env } = process.env;
    app = await electron.launch({
      executablePath: executable,
      args: ['--no-sandbox'],
      env: {
        ...env,
        // Wie eine aus Finder/Dock gestartete App: ffmpeg nicht im PATH, die App muss es selbst finden.
        PATH: '/nonexistent-gui-path',
        FFMPEG_PATH: '',
        FFPROBE_PATH: '',
        STUDIO_SMOKE_TEST: '1',
        STUDIO_USER_DATA: userData,
        ELECTRON_ENABLE_LOGGING: '1',
      },
    });
    const mainLog: string[] = [];
    app.process().stderr?.on('data', (chunk: Buffer) => mainLog.push(chunk.toString('utf8')));
    const window = await app.firstWindow();
    const errors: string[] = [];
    window.on('pageerror', (e) => errors.push(e.message));
    await window.waitForLoadState('domcontentloaded');

    // 1. Gepackt, Oberfläche aus dem asar, Hauptprozess-Einstellungen.
    expect(await window.title()).toContain('Director Studio');
    expect(window.url()).toMatch(/\/resources\/app\.asar\/out\/renderer\/index\.html$/);
    const main = await app.evaluate(({ app: electronApp, BrowserWindow, Menu }) => ({
      packaged: electronApp.isPackaged,
      cwd: process.cwd(),
      minimumSize: BrowserWindow.getAllWindows()[0]!.getMinimumSize(),
      menu: Menu.getApplicationMenu()!.items.map((item) => item.label),
      accelerators: Menu.getApplicationMenu()!
        .items.flatMap((item) => item.submenu?.items ?? [])
        .map((item) => item.accelerator)
        .filter(Boolean),
    }));
    expect(main.packaged).toBe(true);
    expect(main.cwd).toBe(join(userData, 'runtime'));
    expect(main.minimumSize).toEqual([1180, 720]);
    expect(main.menu).toEqual(process.platform === 'darwin' ? ['Director Studio', 'Bearbeiten', 'Fenster', 'Hilfe'] : ['Datei', 'Bearbeiten', 'Fenster', 'Hilfe']);
    expect(main.accelerators.join(' ')).not.toMatch(/(?:CommandOrControl|CmdOrCtrl)\+(?:0|1|2|3|M|Plus|-)\b/);

    // Director-Skills im asar, dort, wo defaultSkillsDir() des Bündels sucht (out/skills neben out/main).
    const skills = await app.evaluate(() => {
      const builtin = (process as unknown as { getBuiltinModule(id: string): unknown }).getBuiltinModule;
      const fs = builtin('node:fs') as typeof import('node:fs');
      const path = builtin('node:path') as typeof import('node:path');
      const dir = path.join(process.resourcesPath, 'app.asar', 'out', 'skills');
      return fs.readdirSync(dir).filter((name) => fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8').includes('description:'));
    });
    expect(skills.length).toBeGreaterThan(10);
    expect(skills).toEqual(expect.arrayContaining(['web-design', 'slides', 'image-models']));

    // 2. Preload/IPC und Werkzeugsuche (ffmpeg trotz leerem PATH über die bekannten Systemordner).
    expect(await window.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
    const auth = await studio<{ active: string | null; media: { ffmpeg: string | null; ffprobe: string | null; source: string; message: string | null } }>(window, 'getAuthStatus');
    expect(auth.media.ffmpeg).toBeTruthy();
    expect(auth.media.ffprobe).toBeTruthy();
    expect(auth.media.source).toBe('system');

    // 3. Projekt anlegen und öffnen.
    const created = await studio<{ manifest: { id: string; title: string }; path: string; document: { kind: string } }>(window, 'createProject', {
      title: 'Neu',
      category: 'video',
      directory: projectsDir,
    });
    expect(created.document.kind).toBe('timeline');
    const err = await window.evaluate(() => (window as unknown as AnyStudio).studio.openProject!('/gibt/es/nicht').then(() => 'ok', (e: Error) => e.message));
    expect(err).toContain('Kein Director-Studio-Projekt');

    // 4. Import mit ffprobe, Asset-Protokoll (Original + Vorschaubild über ffmpeg).
    const [video] = await studio<Array<{ id: string; width?: number; durationMs?: number }>>(window, 'importFiles', created.manifest.id, [clip], 'import');
    expect(video!.width).toBe(320);
    expect(video!.durationMs).toBeGreaterThan(900);
    const fetchAsset = (variant: string) =>
      window.evaluate(
        async ([pid, aid, v]) => {
          const url = (window as unknown as AnyStudio).studio.assetUrl!(pid, aid, v) as string;
          const res = await fetch(url);
          return { status: res.status, type: res.headers.get('content-type'), size: (await res.arrayBuffer()).byteLength };
        },
        [created.manifest.id, video!.id, variant] as const,
      );
    expect(await fetchAsset('original')).toMatchObject({ status: 200, type: 'video/mp4' });
    const thumb = await fetchAsset('thumb');
    expect(thumb).toMatchObject({ status: 200, type: 'image/jpeg' });
    expect(thumb.size).toBeGreaterThan(1000);
    const missing = await window.evaluate((pid) => fetch(`studio-asset://${pid}/unbekannt`).then((r) => r.status), created.manifest.id);
    expect(missing).toBe(404);

    // 5. Deck: PDF (Playwright + Chromium) und PPTX (pptxgenjs).
    const deckSnap = await studio<{ manifest: { id: string } }>(window, 'openProject', deckDir);
    if (!realDownload) {
      // Erster Versuch: Chromium lässt sich nicht bereitstellen (gesperrter Cache) → verständlicher Fehler …
      const failed = await window.evaluate(
        (pid) => (window as unknown as AnyStudio).studio.exportProject!(pid, { target: 'pdf' }).then(() => 'ok', (e: Error) => e.message),
        deckSnap.manifest.id,
      );
      expect(failed).toContain('Chromium für das Rendern konnte nicht geladen werden');
      // … danach liegt die Shell im Cache, und der nächste Versuch in DERSELBEN Sitzung muss gelingen.
      await rm(join(runtime, 'node_modules', '.remotion'));
      await seedRemotionCache(runtime);
    }
    const pdf = await studio<{ path: string }>(window, 'exportProject', deckSnap.manifest.id, { target: 'pdf' });
    expect((await readFile(pdf.path)).subarray(0, 4).toString()).toBe('%PDF');
    const pptx = await studio<{ path: string }>(window, 'exportProject', deckSnap.manifest.id, { target: 'pptx' });
    expect((await readFile(pptx.path)).subarray(0, 2).toString()).toBe('PK');

    // 6. Timeline-Video: Remotion bündelt die Komposition aus resources/node_modules/@studio/render, rendert über
    //    Compositor + Chromium; ffmpeg mischt, normalisiert und muxt den Ton.
    const filmSnap = await studio<{ manifest: { id: string } }>(window, 'openProject', filmDir);
    const mp4 = await studio<{ path: string }>(window, 'exportProject', filmSnap.manifest.id, { target: 'mp4' });
    const probe = ffprobeJson(mp4.path);
    expect(probe.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(Number(probe.format.duration)).toBeGreaterThan(0.8);
    expect(Number(probe.format.duration)).toBeLessThan(1.5);
    // Die Headless-Shell kam aus Remotions Cache im Arbeitsordner (über den Hilfsprozess), nicht von außen.
    const chromiumPath = await app.evaluate(() => process.env.STUDIO_CHROMIUM_PATH ?? null);
    expect(chromiumPath).toBe(headlessShellLocation(runtime)!.executable);

    // 7. Website ohne Vite: statische Vorschau und ein Hinweis im Projekt.
    const webWithoutSnap = await studio<{ manifest: { id: string } }>(window, 'openProject', webWithoutDir);
    const staticPreview = await studio<{ url: string }>(window, 'previewOpen', webWithoutSnap.manifest.id, { viewport: 'desktop' });
    expect(await (await fetch(staticPreview.url)).text()).toContain('Statische Vorschau');
    const webWithoutMessages = (await studio<{ messages: Array<{ role: string; text: string }> }>(window, 'getSnapshot', webWithoutSnap.manifest.id)).messages;
    expect(webWithoutMessages.some((m) => m.role === 'system' && m.text.includes('Website-Vorschau ohne Vite'))).toBe(true);

    // 8. Website mit Vite: Dev-Server als utilityProcess (die App startet nicht mehr als Node, Fuse RunAsNode aus).
    const webViteSnap = await studio<{ manifest: { id: string } }>(window, 'openProject', webViteDir);
    const vitePreview = await studio<{ url: string }>(window, 'previewOpen', webViteSnap.manifest.id, { viewport: 'desktop' });
    const viteHtml = await (await fetch(vitePreview.url)).text();
    expect(viteHtml).toContain('Vite im utilityProcess');
    expect(viteHtml).toContain('/@vite/client');

    await window.screenshot({ path: join(appDir, 'test-results', 'packaged-smoke.png') });
    expect(errors).toEqual([]);
    // Kein unbehandelter Promise-Fehler im Hauptprozess (früher nach dem ersten gescheiterten Chromium-Download).
    expect(mainLog.join('')).not.toMatch(/UnhandledPromiseRejection/);
  } finally {
    await app?.close();
    // STUDIO_KEEP_TEST_OUTPUT=1: Projekte und Exporte zum Ansehen behalten.
    if (process.env.STUDIO_KEEP_TEST_OUTPUT === '1') console.log(`Testausgabe behalten: ${work}`);
    else await rm(work, { recursive: true, force: true });
  }
});

test('gepackte App: Fuses – kein ELECTRON_RUN_AS_NODE, kein NODE_OPTIONS, nur app.asar mit Integritätsprüfung', async () => {
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses') as typeof import('@electron/fuses');
  const wire = await getCurrentFuseWire(executable);
  const on = (fuse: number) => wire[fuse as keyof typeof wire] === 49; // FuseState.ENABLE
  expect(on(FuseV1Options.RunAsNode)).toBe(false);
  expect(on(FuseV1Options.EnableNodeOptionsEnvironmentVariable)).toBe(false);
  expect(on(FuseV1Options.OnlyLoadAppFromAsar)).toBe(true);
  expect(on(FuseV1Options.EnableEmbeddedAsarIntegrityValidation)).toBe(true);
  // EnableNodeCliInspectArguments ist nur im Test-Build (--test-fuses) an – sonst könnte Playwright die App nicht steuern.

  // Mit ELECTRON_RUN_AS_NODE und NODE_OPTIONS startet trotzdem die App (kein Node, keine fremden Module).
  const work = await mkdtemp(join(tmpdir(), 'dstudio-fuses-'));
  try {
    const child = spawn(executable, ['--no-sandbox', '-e', "console.log('ALS-NODE-GESTARTET')"], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: `--require ${join(work, 'gibt-es-nicht.cjs')}`,
        STUDIO_SMOKE_TEST: '1',
        STUDIO_USER_DATA: join(work, 'userdata'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const result = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('Zeitüberschreitung'), 60_000);
      const check = () => {
        if (output.includes('STUDIO_SMOKE_READY')) {
          clearTimeout(timer);
          resolve('App gestartet');
        }
      };
      child.stdout.on('data', check);
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve(`beendet (${code})`);
      });
    });
    const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    expect(result).toBe('App gestartet');
    expect(output).not.toContain('ALS-NODE-GESTARTET');
  } finally {
    await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
