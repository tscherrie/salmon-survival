import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareRuntimeDir, systemCheckText } from '../src/main/app-env.ts';
import { RenderService } from '../src/main/services.ts';

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
