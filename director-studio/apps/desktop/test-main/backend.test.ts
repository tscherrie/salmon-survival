import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StudioEvent } from '@studio/core';
import { DirectorSession, FakeTransport, fakeText, fakeToolUse, type FakeStep } from '@studio/director';
import { defaultMediaToolkit } from '@studio/media';
import { spawnNodeLauncher, type NodeLauncher } from '@studio/render';
import { StudioBackend, VITE_MISSING_NOTICE, type BackendDeps, type OpenProject, type PreviewPort } from '../src/main/backend.ts';
import type { SecretCipher } from '../src/main/secrets.ts';
import { CombinedCatalog, FalHub } from '../src/main/services.ts';

const HEADLESS = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const cipher: SecretCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p).reverse(),
  decrypt: (d) => Buffer.from(d).reverse().toString(),
};

let root: string;
let events: StudioEvent[];
let script: FakeStep[];
let opened: string[];

function makeBackend(extra: Partial<BackendDeps['overrides']> = {}, deps: Partial<BackendDeps> = {}): StudioBackend {
  return new StudioBackend({
    appDataDir: join(root, 'appdata'),
    documentsDir: join(root, 'docs'),
    tempDir: root,
    cipher,
    dialogs: { chooseDirectory: async () => join(root, 'chosen'), chooseFiles: async () => [] },
    shell: {
      openExternal: async (url) => {
        opened.push(url);
      },
      showItemInFolder: (path) => {
        opened.push(path);
      },
    },
    emit: (e) => events.push(e),
    ...(deps.preview ? { preview: deps.preview } : {}),
    ...(deps.runtime ? { runtime: deps.runtime } : {}),
    overrides: {
      agentSdkAvailable: false,
      env: {},
      homedir: join(root, 'home'),
      platform: 'linux',
      createSession: async (open: OpenProject) =>
        new DirectorSession({
          project: open.store,
          catalog: new CombinedCatalog(() => new FalHub(join(root, 'cat.json')).get()),
          generation: {
            run: async () => {
              throw new Error('kein fal im Test');
            },
            uploadFile: async () => 'https://example/x',
            extractMediaOutputs: () => [],
            download: async () => {
              throw new Error('nein');
            },
          },
          ui: open.ui,
          transport: new FakeTransport(script),
          runtimeId: 'anthropic',
        }),
      ...extra,
    },
  });
}

async function waitFor<T>(fn: () => T | undefined | false, timeoutMs = 10000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Zeitüberschreitung beim Warten: ${JSON.stringify(events.slice(-6))}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(() => {
  process.env.STUDIO_CHROMIUM_PATH = HEADLESS;
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dstudio-backend-'));
  events = [];
  script = [];
  opened = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('StudioBackend – Anmeldung', () => {
  it('reports the auth chain depending on stored keys', async () => {
    const backend = makeBackend();
    let status = await backend.getAuthStatus();
    expect(status.active).toBeNull();
    expect(status.falConfigured).toBe(false);
    await backend.setSecret('fal', 'fal-key');
    status = await backend.getAuthStatus();
    expect(status.active).toBe('fal');
    expect(status.falConfigured).toBe(true);
    await backend.setSecret('anthropic', 'sk-ant-test');
    expect((await backend.getAuthStatus()).active).toBe('anthropic');
    await backend.updateSettings({ preferredRuntime: 'fal' });
    expect((await backend.getAuthStatus()).active).toBe('fal');
    const raw = await readFile(join(root, 'appdata', 'secrets.json'), 'utf8');
    expect(raw).not.toContain('sk-ant-test');
    await backend.shutdown();
  });

  it('detects an `ant auth login` profile without any key', async () => {
    await mkdir(join(root, 'home', '.config', 'anthropic', 'credentials'), { recursive: true });
    await writeFile(join(root, 'home', '.config', 'anthropic', 'credentials', 'default.json'), '{"access_token":"x"}');
    const backend = makeBackend();
    expect((await backend.getAuthStatus()).active).toBe('anthropic');
    await backend.shutdown();
  });
});

describe('StudioBackend – Projekte und Director', () => {
  it('creates, lists and reopens projects', async () => {
    const backend = makeBackend();
    const snap = await backend.createProject({ title: 'Musikvideo', category: 'video', directory: join(root, 'projects') });
    expect(snap.manifest.title).toBe('Musikvideo');
    expect(snap.document?.kind).toBe('timeline');
    expect(snap.versions).toHaveLength(1);
    expect(snap.checkpoints[0]?.kind).toBe('treatment');
    expect((await backend.listRecentProjects()).map((p) => p.title)).toEqual(['Musikvideo']);
    const again = await backend.openProject(snap.path);
    expect(again.manifest.id).toBe(snap.manifest.id);
    await expect(backend.openProject(join(root, 'nope'))).rejects.toThrow(/Kein Director-Studio-Projekt/);
    await backend.shutdown();
  });

  it('refuses to start the Director without any login', async () => {
    const backend = makeBackend();
    const snap = await backend.createProject({ title: 'Ohne Login', category: 'slides', directory: root });
    await expect(backend.sendMessage(snap.manifest.id, { segments: [{ type: 'text', text: 'Hallo' }] })).rejects.toThrow(/Kein Director verfügbar/);
    await backend.shutdown();
  });

  it('runs a planning conversation with question, brief and checkpoint', async () => {
    script = [
      fakeToolUse([{ name: 'ask_user', input: { questions: [{ question: 'Wie lang?', header: 'Länge', options: [{ label: '60 s' }, { label: '3 min' }] }] } }]),
      fakeToolUse([{ name: 'set_brief', input: { goal: 'Pitch-Deck', audience: 'Investoren', formats: ['16:9'], category: 'slides' } }]),
      fakeToolUse([{ name: 'propose_checkpoint', input: { checkpointId: 'cp_1_outline', summary: 'Gliederung', budgetRequestedUsd: 5 } }]),
      fakeText('Die Gliederung liegt bereit.'),
      fakeText('Danke, ich lege los.'),
    ];
    const backend = makeBackend();
    await backend.setSecret('anthropic', 'sk-test');
    const snap = await backend.createProject({ title: 'Pitch', category: null, directory: root });
    const id = snap.manifest.id;
    await backend.sendMessage(id, { segments: [{ type: 'text', text: 'Ich brauche ein Pitch-Deck.' }] });
    const question = await waitFor(() => events.find((e): e is Extract<StudioEvent, { type: 'question' }> => e.type === 'question'));
    expect((await backend.getSnapshot(id)).pendingQuestion?.questionId).toBe(question.questionId);
    await backend.answerQuestion(id, question.questionId, { [question.questions[0]!.id]: '60 s' });
    await waitFor(() => events.some((e) => e.type === 'run_state' && e.state === 'idle'));
    const after = await backend.getSnapshot(id);
    expect(after.manifest.category).toBe('slides');
    expect(after.document?.kind).toBe('deck');
    expect(after.checkpoints[0]).toMatchObject({ status: 'proposed', budgetRequestedUsd: 5 });
    expect(after.messages.map((m) => m.role)).toEqual(['user', 'director']);
    expect(after.pendingQuestion).toBeNull();
    // Freigabe → Budget gebucht, Director informiert (nächster Turn).
    await backend.decideCheckpoint(id, 'cp_1_outline', { decision: 'approve', budgetApprovedUsd: 7 });
    await waitFor(() => events.some((e) => e.type === 'budget' && e.summary.approvedUsd === 7));
    await waitFor(() => events.filter((e) => e.type === 'run_state' && e.state === 'idle').length >= 2);
    expect((await backend.getSnapshot(id)).budget.approvedUsd).toBe(7);
    await expect(backend.answerQuestion(id, 'qst_x', {})).rejects.toThrow(/nicht mehr offen/);
    await backend.shutdown();
  });

  it('validates picker selections and effort', async () => {
    const backend = makeBackend();
    const snap = await backend.createProject({ title: 'Picker', category: 'video', directory: root });
    const id = snap.manifest.id;
    await backend.setPicker(id, 'video', { mode: 'model', modelId: 'minimax/h3-max/reference-to-video' });
    await backend.setPicker(id, 'image', { mode: 'auto' });
    await expect(backend.setPicker(id, 'video', { mode: 'model', modelId: 'does/not/exist' })).rejects.toThrow(/Unbekanntes Modell/);
    await backend.setEffort(id, 'max');
    const m = (await backend.getSnapshot(id)).manifest;
    expect(m.pickers.video).toEqual({ mode: 'model', modelId: 'minimax/h3-max/reference-to-video' });
    expect(m.director.effort).toBe('max');
    const models = await backend.listModels('video');
    expect(models.some((x) => x.id.startsWith('minimax/h3-max'))).toBe(true);
    const director = await backend.listModels('director');
    expect(director[0]?.id).toBe('claude-opus-5-5');
    await expect(backend.refreshModels()).rejects.toThrow(/fal-Key/);
    await backend.shutdown();
  });
});

describe('StudioBackend – Medien, Vorschau, Export', () => {
  let videoFile: string;
  let audioFile: string;
  beforeEach(() => {
    videoFile = join(root, 'clip.mp4');
    audioFile = join(root, 'song.wav');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', videoFile]);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '3', audioFile]);
  });

  it('imports media, serves thumbs/proxies/peaks through the protocol resolver', async () => {
    const backend = makeBackend({ media: defaultMediaToolkit() });
    const snap = await backend.createProject({ title: 'Medien', category: 'video', directory: root });
    const id = snap.manifest.id;
    const [video, audio] = await backend.importFiles(id, [videoFile, audioFile], 'link');
    expect(video).toMatchObject({ kind: 'video', source: 'linked', width: 320, height: 180 });
    expect(video!.durationMs).toBeGreaterThan(1900);
    expect(audio!.kind).toBe('audio');
    expect(backend.assetUrl(id, video!.id, 'thumb')).toBe(`studio-asset://${id}/${video!.id}?v=thumb`);
    const thumb = await backend.resolveAssetFile(id, video!.id, 'thumb');
    expect(thumb?.mime).toBe('image/jpeg');
    expect((await stat(thumb!.path)).size).toBeGreaterThan(100);
    const proxy = await backend.resolveAssetFile(id, video!.id, 'proxy');
    expect(proxy?.path.endsWith('proxy.mp4')).toBe(true);
    const peaks = await backend.assetPeaks(id, audio!.id);
    expect(peaks?.peaks.length).toBeGreaterThan(100);
    expect(peaks?.durationMs).toBeGreaterThan(2900);
    expect(await backend.resolveAssetFile('other', video!.id, 'original')).toBeNull();
    await backend.revealAsset(id, video!.id);
    expect(opened).toContain(videoFile);
    expect((await backend.searchAssets(id, { kinds: ['audio'] })).map((a) => a.id)).toEqual([audio!.id]);
    await backend.shutdown();
  });

  it('exports an audio timeline as loudness-normalized WAV', async () => {
    const backend = makeBackend({ media: defaultMediaToolkit() });
    const snap = await backend.createProject({ title: 'Podcast', category: 'audio', directory: root });
    const id = snap.manifest.id;
    const [audio] = await backend.importFiles(id, [audioFile], 'import');
    const open = (backend as unknown as { projects: Map<string, OpenProject> }).projects.get(id)!;
    await open.store.commitOps(
      [
        { op: 'update_timeline', patch: { durationFrames: 3000 } },
        { op: 'insert_clip', trackId: 'A1', clip: { id: 'c1', assetId: audio!.id, start: 0, duration: 3000 } },
      ],
      { note: 'Test', author: 'director' },
    );
    const { path } = await backend.exportProject(id, { target: 'wav', format: 'podcast' });
    expect(path.endsWith('.wav')).toBe(true);
    const loud = await defaultMediaToolkit().loudness(path);
    expect(loud.integratedLufs).toBeGreaterThan(-17);
    expect(loud.integratedLufs).toBeLessThan(-15);
    await expect(backend.exportProject(id, { target: 'pptx' })).rejects.toThrow(/nicht möglich/);
    await backend.shutdown();
  });

  it('exports decks (PDF + PPTX) and canvases (PNG)', async () => {
    const backend = makeBackend();
    const deckSnap = await backend.createProject({ title: 'Deck', category: 'slides', directory: root });
    const deckOpen = (backend as unknown as { projects: Map<string, OpenProject> }).projects.get(deckSnap.manifest.id)!;
    await deckOpen.store.commitOps(
      [{ op: 'add_slide', slide: { id: 's1', elements: [{ id: 't1', type: 'text', x: 100, y: 100, width: 1200, height: 200, text: '**Hallo** Welt' }] } }],
      { note: 'Folie', author: 'director' },
    );
    const pdf = await backend.exportProject(deckSnap.manifest.id, { target: 'pdf' });
    expect((await readFile(pdf.path)).subarray(0, 4).toString()).toBe('%PDF');
    const pptx = await backend.exportProject(deckSnap.manifest.id, { target: 'pptx' });
    expect((await readFile(pptx.path)).subarray(0, 2).toString()).toBe('PK');

    const canvasSnap = await backend.createProject({ title: 'Poster', category: 'graphic', directory: root });
    const canvasOpen = (backend as unknown as { projects: Map<string, OpenProject> }).projects.get(canvasSnap.manifest.id)!;
    await canvasOpen.store.commitOps([{ op: 'add_layer', layer: { id: 'l1', type: 'text', text: 'POSTER', x: 50, y: 50, width: 600, height: 200 } }], { note: 'Text', author: 'director' });
    const png = await backend.exportProject(canvasSnap.manifest.id, { target: 'png' });
    expect((await readFile(png.path)).subarray(1, 4).toString()).toBe('PNG');
    await backend.shutdown();
  }, 120000);

  it('serves the web preview and emits picks as refs', async () => {
    const backend = makeBackend();
    const snap = await backend.createProject({ title: 'Site', category: 'web', directory: root });
    const id = snap.manifest.id;
    const open = (backend as unknown as { projects: Map<string, OpenProject> }).projects.get(id)!;
    await mkdir(open.store.siteDir, { recursive: true });
    await writeFile(join(open.store.siteDir, 'index.html'), '<html><body><h1 data-sid="hero">Hallo</h1></body></html>');
    const { url } = await backend.previewOpen(id, { viewport: 'desktop' });
    const html = await (await fetch(url)).text();
    expect(html).toContain('Hallo');
    // Der Picker kommt nicht mehr über das HTML (Hauptwelt der Seite), sondern isoliert vom PreviewController.
    expect(html).not.toContain('__studioPicker');
    backend.handlePreviewPick(id, { selector: 'h1', bbox: { x: 0, y: 0, width: 100, height: 40 }, text: 'Hallo', tag: 'h1', dataSid: 'hero', page: '/' });
    const pick = await waitFor(() => events.find((e): e is Extract<StudioEvent, { type: 'preview_pick' }> => e.type === 'preview_pick'));
    expect(pick.ref.kind).toBe('element');
    expect(pick.label).toBe('Hallo');
    const zip = await backend.exportProject(id, { target: 'zip' });
    expect(existsSync(zip.path)).toBe(true);
    await backend.previewOpenExternal(id);
    expect(opened).toContain(url);
    await backend.shutdown();
  }, 60000);

  it('Vite-Website ohne installiertes Vite (ausgelieferte App): statische Vorschau und ein Hinweis, warum', async () => {
    const backend = makeBackend({ findViteBin: () => undefined });
    const snap = await backend.createProject({ title: 'Vite ohne Vite', category: 'web', directory: root });
    const id = snap.manifest.id;
    const open = (backend as unknown as { projects: Map<string, OpenProject> }).projects.get(id)!;
    await mkdir(open.store.siteDir, { recursive: true });
    await writeFile(join(open.store.siteDir, 'package.json'), '{"name":"site","private":true,"devDependencies":{"vite":"*"}}');
    await writeFile(join(open.store.siteDir, 'index.html'), '<html><body><h1>Statisch</h1></body></html>');
    const { url } = await backend.previewOpen(id, { viewport: 'desktop' });
    expect(await (await fetch(url)).text()).toContain('Statisch');
    const notices = (await open.store.listMessages()).filter((m) => m.role === 'system' && m.text === VITE_MISSING_NOTICE);
    expect(notices).toHaveLength(1);
    expect(VITE_MISSING_NOTICE).toContain('npm install');
    expect(VITE_MISSING_NOTICE).not.toMatch(/Monorepo/);
    await backend.shutdown();
  }, 60000);

  it('Vite-Website mit Vite: startet über den Launcher der Laufzeit (in Electron: utilityProcess)', async () => {
    const calls: string[] = [];
    const inner = spawnNodeLauncher();
    const nodeLauncher: NodeLauncher = (script, args, options) => {
      calls.push(script);
      return inner(script, args, options);
    };
    const backend = makeBackend({}, { runtime: { nodeLauncher } });
    const snap = await backend.createProject({ title: 'Vite', category: 'web', directory: root });
    const id = snap.manifest.id;
    const open = (backend as unknown as { projects: Map<string, OpenProject> }).projects.get(id)!;
    await mkdir(open.store.siteDir, { recursive: true });
    await writeFile(join(open.store.siteDir, 'package.json'), '{"name":"site","private":true}');
    await writeFile(join(open.store.siteDir, 'index.html'), '<html><body><h1>Mit Vite</h1></body></html>');
    const { url } = await backend.previewOpen(id, { viewport: 'desktop' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/vite\.js$/);
    const html = await (await fetch(url)).text();
    expect(html).toContain('Mit Vite');
    expect(html).toContain('/@vite/client');
    expect((await open.store.listMessages()).some((m) => m.text === VITE_MISSING_NOTICE)).toBe(false);
    await backend.shutdown();
  }, 60000);

  it('needs a fal key for push-to-talk transcription', async () => {
    const backend = makeBackend();
    const snap = await backend.createProject({ title: 'PTT', category: 'video', directory: root });
    await expect(backend.transcribe(snap.manifest.id, new ArrayBuffer(8), 'audio/webm')).rejects.toThrow(/fal-Key/);
    await expect(backend.openExternal('file:///etc/passwd')).rejects.toThrow(/http/);
    await backend.shutdown();
  });
});

/** Attrappe des PreviewControllers (Electron-frei). */
function fakePreview(options: { current?: string | null; failClose?: string } = {}) {
  const calls: string[] = [];
  const port: PreviewPort = {
    open: async (_id, url, viewport) => {
      calls.push(`open:${url}:${viewport}`);
    },
    navigate: async (_id, path) => {
      calls.push(`navigate:${path}`);
    },
    setBounds: () => undefined,
    setPickMode: async () => undefined,
    currentUrl: () => options.current ?? null,
    close: (id) => {
      calls.push(`close:${id}`);
      if (id === options.failClose) throw new Error('Object has been destroyed');
    },
    closeAll: () => {
      calls.push('closeAll');
    },
  };
  return { calls, port };
}

function projectsOf(backend: StudioBackend): Map<string, OpenProject> {
  return (backend as unknown as { projects: Map<string, OpenProject> }).projects;
}

describe('StudioBackend – Review-Befunde', () => {
  it('liefert für Projekte ohne Kategorie kein Platzhalter-Deck, sondern document: null', async () => {
    const backend = makeBackend();
    const snap = await backend.createProject({ title: 'Offen', category: null, directory: root });
    expect(snap.document).toBeNull();
    expect((await backend.getSnapshot(snap.manifest.id)).document).toBeNull();
    await backend.shutdown();
  });

  it('meldet die Anthropic-Anmeldung getrennt nach API-Key und OAuth-Profil', async () => {
    const backend = makeBackend();
    expect((await backend.getAuthStatus()).anthropic).toEqual({ apiKey: false, oauthProfile: false });
    await backend.setSecret('anthropic', 'sk-ant-x');
    expect((await backend.getAuthStatus()).anthropic).toEqual({ apiKey: true, oauthProfile: false });
    await mkdir(join(root, 'home', '.config', 'anthropic', 'credentials'), { recursive: true });
    await writeFile(join(root, 'home', '.config', 'anthropic', 'credentials', 'default.json'), '{}');
    expect((await backend.getAuthStatus()).anthropic).toEqual({ apiKey: true, oauthProfile: true });
    await backend.shutdown();
  });

  it('lädt die Keys nach einem Lesefehler erneut, statt den Fehler zu cachen', async () => {
    await mkdir(join(root, 'appdata', 'secrets.json'), { recursive: true });
    const backend = makeBackend();
    await expect(backend.getAuthStatus()).rejects.toThrow();
    await rm(join(root, 'appdata', 'secrets.json'), { recursive: true });
    const status = await backend.getAuthStatus();
    expect(status.falConfigured).toBe(false);
    await backend.setSecret('fal', 'fal-key');
    expect((await backend.getAuthStatus()).falConfigured).toBe(true);
    await backend.shutdown();
  });

  it('übernimmt die Picker-Defaults des Nutzers für neue Projekte', async () => {
    const backend = makeBackend();
    await backend.updateSettings({ defaultPickers: { video: { mode: 'model', modelId: 'fal-ai/veo3.1' } } });
    const snap = await backend.createProject({ title: 'Picker-Default', category: 'video', directory: root });
    expect(snap.manifest.pickers.video).toEqual({ mode: 'model', modelId: 'fal-ai/veo3.1' });
    expect(snap.manifest.pickers.director).toEqual({ mode: 'model', modelId: 'claude-opus-5-5' });
    await backend.shutdown();
  });

  it('liefert Lineage und ordnet verknüpfte Dateien neu zu', async () => {
    const backend = makeBackend();
    const snap = await backend.createProject({ title: 'Lineage', category: 'graphic', directory: root });
    const id = snap.manifest.id;
    await writeFile(join(root, 'a.txt'), 'Inhalt A');
    await writeFile(join(root, 'b.txt'), 'Inhalt B');
    const [a, b] = await backend.importFiles(id, [join(root, 'a.txt'), join(root, 'b.txt')], 'link');
    await projectsOf(backend).get(id)!.store.addLineage([{ parentId: a!.id, childId: b!.id, relation: 'derived' }]);
    expect(await backend.getLineage(id, b!.id)).toEqual({ parents: [{ parentId: a!.id, childId: b!.id, relation: 'derived' }], children: [] });
    expect((await backend.getLineage(id, a!.id)).children).toHaveLength(1);

    await mkdir(join(root, 'moved'));
    await copyFile(join(root, 'a.txt'), join(root, 'moved', 'a.txt'));
    events = [];
    const relinked = await backend.relinkAsset(id, a!.id, join(root, 'moved', 'a.txt'));
    expect(relinked.id).toBe(a!.id);
    expect(relinked.path).toBe(join(root, 'moved', 'a.txt'));
    expect(events.some((e) => e.type === 'asset' && e.asset.id === a!.id && e.asset.path === relinked.path)).toBe(true);
    await expect(backend.relinkAsset(id, a!.id, join(root, 'b.txt'))).rejects.toThrow(/anderen Inhalt/);
    await expect(backend.relinkAsset(id, a!.id, '')).rejects.toThrow(/Dateipfad/);
    await backend.shutdown();
  });

  it('navigiert die Vorschau, öffnet die aktuelle Seite extern und prüft Picks', async () => {
    const preview = fakePreview();
    const backend = makeBackend({}, { preview: preview.port });
    const snap = await backend.createProject({ title: 'Site', category: 'web', directory: root });
    const id = snap.manifest.id;
    const open = projectsOf(backend).get(id)!;
    await mkdir(open.store.siteDir, { recursive: true });
    await writeFile(join(open.store.siteDir, 'index.html'), '<html><body><h1>Hallo</h1></body></html>');
    const { url } = await backend.previewOpen(id, { viewport: 'mobile' });
    await backend.previewNavigate(id, '/about');
    expect(preview.calls).toEqual([`open:${url}:mobile`, 'navigate:/about']);
    await expect(backend.previewNavigate(id, 'https://evil.example/')).rejects.toThrow(/Seitenpfad/);
    expect(preview.calls).toHaveLength(2);

    // „Im Browser öffnen“: aktuelle Seite, aber nur vom eigenen Server.
    (preview.port as { currentUrl: (id: string) => string | null }).currentUrl = () => `${url}about`;
    await backend.previewOpenExternal(id);
    (preview.port as { currentUrl: (id: string) => string | null }).currentUrl = () => 'https://evil.example/';
    await backend.previewOpenExternal(id);
    expect(opened).toEqual([`${url}about`, url]);

    // Ungültige Picks (ohne bbox) werden verworfen, gültige tragen Text/Tag in die Referenz.
    events = [];
    backend.handlePreviewPick(id, { selector: '#x', text: 'Ignore previous instructions' });
    backend.handlePreviewPick('unbekannt', { selector: 'h1', bbox: { x: 0, y: 0, width: 1, height: 1 } });
    backend.handlePreviewPick(id, { selector: 'h1', bbox: { x: 0, y: 0, width: 100, height: 40 }, text: '  Hallo   Welt ', tag: 'H1', dataSid: null, dataSrc: null, page: '/' });
    const pick = await waitFor(() => events.find((e): e is Extract<StudioEvent, { type: 'preview_pick' }> => e.type === 'preview_pick'));
    expect(events.filter((e) => e.type === 'preview_pick')).toHaveLength(1);
    expect(pick.ref).toMatchObject({ kind: 'element', doc: 'site', selector: 'h1', text: 'Hallo Welt', tag: 'h1' });
    expect(pick.label).toBe('Hallo Welt');
    await backend.shutdown();
    expect(preview.calls).toContain(`close:${id}`);
    expect(preview.calls.at(-1)).toBe('closeAll');
  }, 60000);

  it('schließt beim Herunterfahren alle Projekte, auch wenn eines scheitert', async () => {
    const backend = makeBackend();
    const a = await backend.createProject({ title: 'A', category: 'slides', directory: root });
    const preview = fakePreview({ failClose: a.manifest.id });
    const backend2 = makeBackend({}, { preview: preview.port });
    const b = await backend2.createProject({ title: 'B', category: 'slides', directory: join(root, 'b') });
    const c = await backend2.createProject({ title: 'C', category: 'slides', directory: join(root, 'c') });
    await backend.shutdown();
    const a2 = await backend2.openProject(a.path);
    expect(a2.manifest.id).toBe(a.manifest.id);
    await expect(backend2.shutdown()).rejects.toThrow(/destroyed/);
    expect(preview.calls).toEqual(expect.arrayContaining([`close:${a.manifest.id}`, `close:${b.manifest.id}`, `close:${c.manifest.id}`, 'closeAll']));
    await expect(backend2.getSnapshot(b.manifest.id)).rejects.toThrow(/nicht geöffnet/);
    await expect(backend2.getSnapshot(c.manifest.id)).rejects.toThrow(/nicht geöffnet/);
  });
});
