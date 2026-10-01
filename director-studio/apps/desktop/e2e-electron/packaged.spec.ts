import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ProjectStore } from '@studio/project';

/**
 * Smoke-Test der GEPACKTEN App (release/…, vorher `npm run dist:dir`): Oberfläche aus dem asar, Preload/IPC,
 * `studio-asset://`, Projekte anlegen/öffnen und echte lokale Renderings über die mitgelieferten Pakete
 * (Remotion-Bündel + Compositor + ffmpeg für das Video, Playwright/Chromium für das PDF, pptxgenjs).
 */

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEADLESS_SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

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

test.skip(!existsSync(executable), `Gepackte App fehlt (${executable}) – zuerst „npm run dist:dir“`);

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

    const chromium = process.env.STUDIO_CHROMIUM_PATH ?? (existsSync(HEADLESS_SHELL) ? HEADLESS_SHELL : undefined);
    app = await electron.launch({
      executablePath: executable,
      args: ['--no-sandbox'],
      env: {
        ...process.env,
        // Wie eine aus Finder/Dock gestartete App: ffmpeg nicht im PATH, die App muss es selbst finden.
        PATH: '/nonexistent-gui-path',
        FFMPEG_PATH: '',
        FFPROBE_PATH: '',
        STUDIO_SMOKE_TEST: '1',
        STUDIO_USER_DATA: userData,
        ELECTRON_ENABLE_LOGGING: '1',
        ...(chromium ? { STUDIO_CHROMIUM_PATH: chromium } : {}),
      },
    });
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

    await window.screenshot({ path: join(appDir, 'test-results', 'packaged-smoke.png') });
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    // STUDIO_KEEP_TEST_OUTPUT=1: Projekte und Exporte zum Ansehen behalten.
    if (process.env.STUDIO_KEEP_TEST_OUTPUT === '1') console.log(`Testausgabe behalten: ${work}`);
    else await rm(work, { recursive: true, force: true });
  }
});
