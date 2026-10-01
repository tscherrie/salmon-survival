import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudioEvent } from '@studio/core';
import { MediaToolkit } from '@studio/media';
import { StudioBackend, type BackendDeps } from '../src/main/backend.ts';

let root: string;
let events: StudioEvent[];

function makeBackend(overrides: Partial<NonNullable<BackendDeps['overrides']>>, runtime?: BackendDeps['runtime']): StudioBackend {
  return new StudioBackend({
    appDataDir: join(root, 'appdata'),
    documentsDir: join(root, 'docs'),
    tempDir: root,
    cipher: { isAvailable: () => true, encrypt: (p) => Buffer.from(p), decrypt: (d) => Buffer.from(d).toString() },
    dialogs: { chooseDirectory: async () => null, chooseFiles: async () => [] },
    shell: { openExternal: async () => undefined, showItemInFolder: () => undefined },
    emit: (e) => events.push(e),
    runtime,
    overrides: { agentSdkAvailable: false, env: {}, homedir: join(root, 'home'), ...overrides },
  });
}

/** ffmpeg-Pfad, den das Backend für Medienaufrufe nutzt (privat). */
function toolkitOf(backend: StudioBackend): MediaToolkit {
  return (backend as unknown as { media: MediaToolkit }).media;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dstudio-media-tools-'));
  events = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ffmpeg im Hauptprozess', () => {
  it('macOS-GUI-Start ohne Homebrew im PATH: findet /opt/homebrew/bin und meldet es im Status', async () => {
    const backend = makeBackend({ platform: 'darwin', env: { PATH: '/usr/bin:/bin' }, isExecutable: (f) => f.startsWith('/opt/homebrew/bin/') });
    const status = await backend.getAuthStatus();
    expect(status.media).toEqual({ ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe', source: 'system', message: null });
    const snap = await backend.createProject({ title: 'Video', category: 'video', directory: root });
    expect(snap.messages.filter((m) => m.role === 'system')).toEqual([]);
    expect(toolkitOf(backend).ffmpegPath).toBe('/opt/homebrew/bin/ffmpeg');
    expect(toolkitOf(backend).ffprobePath).toBe('/opt/homebrew/bin/ffprobe');
    await backend.shutdown();
  });

  it('fehlt ffmpeg: Status mit deutschem Hinweis und einmal je Projekt ein Systemhinweis mit brew-Befehl', async () => {
    const backend = makeBackend({ platform: 'darwin', isExecutable: () => false });
    const status = await backend.getAuthStatus();
    expect(status.media?.ffmpeg).toBeNull();
    expect(status.media?.message).toContain('brew install ffmpeg');
    const snap = await backend.createProject({ title: 'Video', category: 'video', directory: root });
    const notices = snap.messages.filter((m) => m.role === 'system');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toContain('`brew install ffmpeg`');
    // Erneutes Öffnen wiederholt den Hinweis nicht.
    await backend.closeProject(snap.manifest.id);
    const again = await backend.openProject(snap.path);
    expect(again.messages.filter((m) => m.role === 'system')).toHaveLength(1);
    await backend.shutdown();
  });

  it('Windows: winget-Hinweis', async () => {
    const backend = makeBackend({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local' }, isExecutable: () => false });
    expect((await backend.getAuthStatus()).media?.message).toContain('winget install Gyan.FFmpeg');
    await backend.shutdown();
  });

  it('mitgelieferte Binaries der gepackten App haben Vorrang vor Systemorten', async () => {
    const backend = makeBackend(
      { platform: 'darwin', isExecutable: (f) => f.startsWith('/res/ffmpeg/') || f.startsWith('/opt/homebrew/bin/') },
      { bundledFfmpegDir: '/res/ffmpeg' },
    );
    expect((await backend.getAuthStatus()).media).toMatchObject({ ffmpeg: '/res/ffmpeg/ffmpeg', ffprobe: '/res/ffmpeg/ffprobe', source: 'bundled' });
    await backend.shutdown();
  });

  it('Einstellung ffmpegPath gilt sofort nach dem Speichern', async () => {
    const backend = makeBackend({ platform: 'darwin', isExecutable: (f) => f.startsWith('/eigen/') || f.startsWith('/opt/homebrew/bin/') });
    expect((await backend.getAuthStatus()).media?.source).toBe('system');
    const settings = await backend.updateSettings({ ffmpegPath: '/eigen/ffmpeg' });
    expect(settings.ffmpegPath).toBe('/eigen/ffmpeg');
    expect((await backend.getAuthStatus()).media).toMatchObject({ ffmpeg: '/eigen/ffmpeg', ffprobe: '/eigen/ffprobe', source: 'settings' });
    expect(toolkitOf(backend).ffmpegPath).toBe('/eigen/ffmpeg');
    // Leerer Wert = wieder automatisch suchen.
    expect((await backend.updateSettings({ ffmpegPath: '' })).ffmpegPath).toBeUndefined();
    expect((await backend.getAuthStatus()).media?.source).toBe('system');
    await backend.shutdown();
  });
});
