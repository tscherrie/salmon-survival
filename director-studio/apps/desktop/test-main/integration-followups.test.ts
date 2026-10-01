import { appendFile, copyFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timelineSchema, type StudioEvent } from '@studio/core';
import type { MediaToolkit } from '@studio/media';
import { StudioBackend, type BackendDeps, type OpenProject } from '../src/main/backend.ts';
import type { SecretCipher } from '../src/main/secrets.ts';
import { RenderService } from '../src/main/services.ts';

const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p).reverse(),
  decrypt: (d) => Buffer.from(d).reverse().toString(),
};

let root: string;
let events: StudioEvent[];

function makeBackend(overrides: Partial<NonNullable<BackendDeps['overrides']>> = {}): StudioBackend {
  return new StudioBackend({
    appDataDir: join(root, 'appdata'),
    documentsDir: join(root, 'docs'),
    tempDir: root,
    cipher,
    dialogs: { chooseDirectory: async () => null, chooseFiles: async () => [] },
    shell: { openExternal: async () => undefined, showItemInFolder: () => undefined },
    emit: (e) => events.push(e),
    overrides: { agentSdkAvailable: false, env: {}, homedir: join(root, 'home'), platform: 'linux', ...overrides },
  });
}

function projectsOf(backend: StudioBackend): Map<string, OpenProject> {
  return (backend as unknown as { projects: Map<string, OpenProject> }).projects;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dstudio-followups-'));
  events = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('Render-Medien der Timeline', () => {
  it('liefert auch Assets aus Clip-Props (rotoscope, …Asset, …AssetId, Übergang) an den Renderer', async () => {
    const backend = makeBackend();
    const snap = await backend.createProject({ title: 'Props', category: 'video', directory: root });
    const store = projectsOf(backend).get(snap.manifest.id)!.store;
    const add = (name: string) => store.addAssetFromBuffer(`daten ${name}`, { fileName: `${name}.png`, kind: 'image', source: 'generated', title: name });
    const [base, roto, logo, mask, wipe] = await Promise.all(['base', 'roto', 'logo', 'mask', 'wipe'].map(add));
    const timeline = timelineSchema.parse({
      kind: 'timeline',
      fps: 30,
      width: 1920,
      height: 1080,
      durationFrames: 60,
      tracks: [
        {
          id: 'V1',
          kind: 'video',
          clips: [
            {
              id: 'c1',
              start: 0,
              duration: 30,
              assetId: base!.id,
              props: { rotoscope: roto!.id, logoAsset: logo!.id, maskAssetId: mask!.id, title: 'kein Asset' },
              transitionIn: { type: 'component', componentId: 'wipe', durationFrames: 10, props: { textureAsset: wipe!.id } },
            },
          ],
        },
      ],
    });
    const media = new RenderService({ workDir: join(root, 'render') }).timelineAssets(store, timeline);
    expect(Object.keys(media).sort()).toEqual([base!.id, roto!.id, logo!.id, mask!.id, wipe!.id].sort());
    expect(media[logo!.id]!.url.startsWith('file://')).toBe(true);
    await backend.shutdown();
  });
});

describe('Export: Originalton von Videoclips und ausgelassene Medien', () => {
  it('mischt den Ton auch ohne Audiospur und meldet fehlende Medien als Systemhinweis', async () => {
    const calls: string[] = [];
    const media = {
      renderAudioMix: async (_timeline: unknown, _resolve: unknown, out: string) => {
        calls.push('mix');
        await writeFile(out, 'mix');
        return { path: out, warnings: [] };
      },
      normalizeLoudness: async (_src: string, out: string) => {
        calls.push('normalize');
        await writeFile(out, 'norm');
      },
      mux: async (_video: string, _audio: string, out: string) => {
        calls.push('mux');
        await writeFile(out, 'mp4');
      },
    } as unknown as MediaToolkit;
    const render = {
      renderTimelineVideo: async (_store: unknown, input: { out: string; onMediaError?: (info: unknown) => void }) => {
        calls.push('picture');
        input.onMediaError?.({ clipId: 'c1', assetId: 'ast_weg', kind: 'video', url: 'file:///weg.mp4', message: 'Datei fehlt' });
        input.onMediaError?.({ clipId: 'c1', assetId: 'ast_weg', kind: 'video', url: 'file:///weg.mp4', message: 'Datei fehlt' });
        await writeFile(input.out, 'bild');
        return input.out;
      },
      close: async () => undefined,
    } as unknown as RenderService;
    const backend = makeBackend({ media, render });
    const snap = await backend.createProject({ title: 'Mit Ton', category: 'video', directory: root });
    const id = snap.manifest.id;
    const store = projectsOf(backend).get(id)!.store;
    const video = await store.addAssetFromBuffer('video', { fileName: 'take.mp4', kind: 'video', source: 'generated', title: 'Take', durationMs: 2000 });
    const doc = await store.getDocument();
    const videoTrack = doc!.kind === 'timeline' ? doc!.tracks.find((t) => t.kind === 'video')! : null;
    await store.commitOps(
      [
        { op: 'update_timeline', patch: { durationFrames: 60 } },
        // Keine Audiospur mit Clips – der einzige Ton ist der Originalton des Videos.
        { op: 'insert_clip', trackId: videoTrack!.id, clip: { id: 'c1', assetId: video.id, start: 0, duration: 60, includeSourceAudio: true } },
      ],
      { note: 'Test', author: 'director' },
    );
    events = [];
    const { path } = await backend.exportProject(id, { target: 'mp4' });
    expect(path.endsWith('.mp4')).toBe(true);
    expect(calls).toEqual(['picture', 'mix', 'normalize', 'mux']);
    const notices = events.filter((e): e is Extract<StudioEvent, { type: 'message' }> => e.type === 'message' && e.message.role === 'system');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.message.text).toMatch(/Export \(mp4\).*Ein Medium fehlte/);
    expect(notices[0]!.message.text).toContain('`c1`');
    // Gespeichert: nach dem Neuladen weiter sichtbar.
    expect((await backend.getSnapshot(id)).messages.some((m) => m.role === 'system' && m.text.includes('Export (mp4)'))).toBe(true);
    await backend.shutdown();
  });
});

describe('Snapshot: fehlende verknüpfte Dateien, Rückfrage-Lauf, Speicher-Warnungen', () => {
  it('markiert verknüpfte Dateien, die fehlen, und hebt die Markierung nach dem Neu-Verknüpfen auf', async () => {
    const backend = makeBackend();
    const snap = await backend.createProject({ title: 'Links', category: 'graphic', directory: root });
    const id = snap.manifest.id;
    const file = join(root, 'logo.txt');
    await writeFile(file, 'Logo');
    const [linked] = await backend.importFiles(id, [file], 'link');
    expect((await backend.getSnapshot(id)).assets.find((a) => a.id === linked!.id)!.metadata?.missing).toBeUndefined();
    await mkdir(join(root, 'neu'));
    await copyFile(file, join(root, 'neu', 'logo.txt'));
    await unlink(file);
    expect((await backend.getSnapshot(id)).assets.find((a) => a.id === linked!.id)!.metadata?.missing).toBe(true);
    await backend.relinkAsset(id, linked!.id, join(root, 'neu', 'logo.txt'));
    expect((await backend.getSnapshot(id)).assets.find((a) => a.id === linked!.id)!.metadata?.missing).toBeUndefined();
    await backend.shutdown();
  });

  it('gibt die Lauf-ID der offenen Rückfrage im Snapshot mit', async () => {
    const backend = makeBackend();
    const snap = await backend.createProject({ title: 'Frage', category: 'video', directory: root });
    const open = projectsOf(backend).get(snap.manifest.id)!;
    const controller = new AbortController();
    const pending = open.ui.askUser([{ id: 'q1', question: 'Format?', options: [{ label: 'A' }, { label: 'B' }] }], controller.signal, { runId: 'run_9' });
    expect((await backend.getSnapshot(snap.manifest.id)).pendingQuestion).toMatchObject({ runId: 'run_9' });
    controller.abort();
    await expect(pending).rejects.toThrow();
    await backend.shutdown();
  });

  it('zeigt übersprungene Journalzeilen einmal als Systemhinweis (auch über mehrere Öffnungen)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = makeBackend();
    const snap = await first.createProject({ title: 'Kaputt', category: 'video', directory: root });
    await first.shutdown();
    await appendFile(join(snap.path, 'conversation', 'messages.jsonl'), '{"id":"msg_x","role":"user","te\n');
    for (let round = 0; round < 2; round++) {
      const backend = makeBackend();
      const reopened = await backend.openProject(snap.path);
      const notices = reopened.messages.filter((m) => m.role === 'system' && m.text.startsWith('Hinweis zum Projektspeicher'));
      expect(notices, `Öffnung ${round + 1}`).toHaveLength(1);
      expect(notices[0]!.text).toMatch(/Zeile 1 .*messages\.jsonl.*übersprungen/);
      await backend.shutdown();
    }
  });
});
