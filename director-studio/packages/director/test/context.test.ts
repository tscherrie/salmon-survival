import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSettings } from '@studio/core';
import type { ProjectStore } from '@studio/project';
import { buildContextBlockList, buildContextBlocks, ContextTracker, detectAnthropicProfile, listAnthropicProfiles, resolveReferences, selectRuntime, SkillLibrary, anthropicConfigDir } from '../src/index.ts';
import { addFileAsset, createProject, FakeCatalog, FakeMedia, FakeRender, PNG_1X1, tempRoot } from './helpers.ts';

let root: string;
let cleanup: () => Promise<void>;
let project: ProjectStore;

beforeEach(async () => {
  ({ root, cleanup } = await tempRoot());
  project = await createProject(root, 'video');
});

afterEach(async () => {
  project.close();
  await cleanup();
});

async function setupTimeline() {
  const shot = await addFileAsset(project, root, 'shot.mp4', 'video-bytes', { title: 'Shot 7 Regen', tags: ['shot-07'], modelId: 'minimax/h3-max/text-to-video', prompt: 'Mira runs in rain' } as never);
  const song = await addFileAsset(project, root, 'song.mp3', 'mp3', { title: 'Song' });
  await project.commitOps(
    [
      { op: 'update_timeline', patch: { durationFrames: 900 } },
      { op: 'insert_clip', trackId: 'V1', clip: { id: 'shot_07', assetId: shot.id, start: 360, duration: 180 } },
      { op: 'insert_clip', trackId: 'T1', clip: { id: 'lyr_12', text: 'faster', style: 'hero', start: 384, duration: 40 } },
      { op: 'insert_clip', trackId: 'A2', clip: { id: 'song', assetId: song.id, start: 0, duration: 900 } },
      { op: 'add_marker', marker: { id: 'sec1', frame: 360, kind: 'section', label: 'Chorus 1' } },
      { op: 'add_marker', marker: { id: 'w1', frame: 386, kind: 'word', label: 'faster' } },
      { op: 'add_marker', marker: { id: 'b1', frame: 375, kind: 'beat' } },
    ],
    { note: 'Schnitt', author: 'director' },
  );
  return { shot, song };
}

describe('Kontextblöcke', () => {
  it('enthalten Brief, Picker mit Preis, Budget, Checkpoints, Dokument, Assets, Skills', async () => {
    await setupTimeline();
    await project.updateManifest((m) => {
      m.brief = { goal: 'Musikvideo für „Rain“', audience: 'Gen Z', platforms: ['TikTok'], formats: ['9:16'], tone: 'roh', references: [], constraints: '', language: 'de', notes: '' };
      m.phase = 'production';
    });
    await project.approveBudget('cp_1_treatment', 40);
    const text = await buildContextBlocks(project, new FakeCatalog(), { skills: SkillLibrary.fromDirectory() });
    for (const tag of ['phase', 'project_brief', 'model_selection', 'budget', 'checkpoints', 'document_summary', 'asset_index', 'active_generations', 'skills_index']) {
      expect(text).toContain(`<${tag}>`);
      expect(text).toContain(`</${tag}>`);
    }
    expect(text).toContain('Musikvideo für „Rain“');
    expect(text).toContain('Video (video): verbindlich minimax/h3-max/text-to-video – h3-max · $0.16 / s · 5 s ≈ $0.80');
    expect(text).toContain('Director (director): verbindlich claude-opus-5-5 – Claude Opus 5.5');
    expect(text).toContain('Bild (image): Auto');
    expect(text).toContain('Freigegeben $40.00');
    expect(text).toContain('cp_1_treatment · Treatment · pending');
    expect(text).toContain('shot_07');
    expect(text).toContain('Shot 7 Regen');
    expect(text).toContain('· im Dokument');
    expect(text).toContain('- h3-max:');
    expect(text).toContain('PRODUCTION');
    expect(text).toContain('Noch keine Style-Bible-Assets');
  });

  it('style_bible listet Referenz-Assets', async () => {
    const sheet = await addFileAsset(project, root, 'mira.png', PNG_1X1, { title: 'Mira Charakterblatt', subtype: 'character-sheet', tags: ['mira'] });
    await addFileAsset(project, root, 'other.png', Buffer.concat([PNG_1X1, Buffer.from('1')]), { title: 'Zufall' });
    const blocks = await buildContextBlockList(project, new FakeCatalog());
    const style = blocks.find((b) => b.name === 'style_bible')!.content;
    expect(style).toContain(sheet.id);
    expect(style).not.toContain('Zufall');
  });

  it('Planungsphase und Diffing: nur geänderte Blöcke werden erneut gesendet', async () => {
    const tracker = new ContextTracker();
    const first = tracker.diff(await buildContextBlockList(project, new FakeCatalog()));
    expect(first.find((b) => b.name === 'phase')!.content).toContain('PLANNING');
    expect(tracker.diff(await buildContextBlockList(project, new FakeCatalog()))).toEqual([]);
    await project.budgetRecordUsage('run_1', 0.5, 'director');
    const changed = tracker.diff(await buildContextBlockList(project, new FakeCatalog()));
    expect(changed.map((b) => b.name)).toEqual(['budget']);
  });
});

describe('resolveReferences', () => {
  it('löst Zeit, Bereich, Clip, Asset und Version auf – mit Bildern (höchstens 4)', async () => {
    const { shot } = await setupTimeline();
    const render = new FakeRender();
    const media = new FakeMedia();
    const resolved = await resolveReferences(
      [
        { type: 'text', text: 'Mach ' },
        { type: 'ref', ref: { kind: 'range', from: 372, to: 540 } },
        { type: 'text', text: ' dunkler, wie bei ' },
        { type: 'ref', ref: { kind: 'time', frame: 386 } },
        { type: 'text', text: ', nimm ' },
        { type: 'ref', ref: { kind: 'asset', assetId: shot.id } },
        { type: 'ref', ref: { kind: 'clip', clipId: 'shot_07' } },
        { type: 'ref', ref: { kind: 'version', versionNumber: 2 } },
      ],
      project,
      { render, media },
    );
    expect(resolved.text).toContain('<ref id="r1" type="range" from="00:12.400" to="00:18.000"');
    expect(resolved.contexts).toContain('<ref_context id="r1">');
    expect(resolved.contexts).toContain('V1 shot_07 00:12.000–00:18.000');
    expect(resolved.contexts).toContain('„faster“ [hero]');
    expect(resolved.contexts).toContain('Wörter: faster@12.87');
    expect(resolved.contexts).toContain('Chorus 1');
    expect(resolved.contexts).toContain('<ref_context id="r2">');
    expect(resolved.contexts).toContain('Clip-Zeit 0.87 s');
    expect(resolved.contexts).toContain('Prompt: Mira runs in rain');
    expect(resolved.contexts).toContain('Version v2');
    expect(resolved.images).toHaveLength(4);
    expect(resolved.images.map((i) => i.refId)).toEqual(['r1', 'r1', 'r1', 'r2']);
    expect(resolved.images[0]!.image.mediaType).toBe('image/png');
    expect(render.calls.filter((c) => c.method === 'renderTimelineStill').map((c) => (c.args as { frame: number }).frame)).toEqual([372, 456, 539, 386]);
  });

  it('Folien, Deck-Elemente und Web-Elemente mit Quelltext', async () => {
    const deckProject = await createProject(join(root, 'deck'), 'slides');
    await deckProject.commitOps([{ op: 'add_slide', slide: { id: 's1', title: 'Intro', elements: [{ id: 's1_title', type: 'text', x: 96, y: 96, width: 800, height: 120, text: 'Hallo' }] } }], { note: 'Folie', author: 'director' });
    const render = new FakeRender();
    const res = await resolveReferences(
      [
        { type: 'ref', ref: { kind: 'slide', slideId: 's1' } },
        { type: 'ref', ref: { kind: 'element', doc: 'deck', slideId: 's1', elementId: 's1_title' } },
        { type: 'ref', ref: { kind: 'region', doc: 'deck', slideId: 's1', rect: { x: 0, y: 0, width: 500, height: 500 } } },
      ],
      deckProject,
      { render },
    );
    expect(res.contexts).toContain('Folie 1 von 1');
    expect(res.contexts).toContain('"s1_title"');
    expect(res.contexts).toContain('Elemente darin: s1_title (text)');
    expect(res.images.length).toBe(3);
    deckProject.close();

    await mkdir(join(project.siteDir, 'src'), { recursive: true });
    await writeFile(join(project.siteDir, 'src', 'Hero.tsx'), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'));
    const web = await resolveReferences([{ type: 'ref', ref: { kind: 'element', doc: 'site', selector: 'section.hero > h1', page: '/', source: { file: 'src/Hero.tsx', line: 10 }, bbox: { x: 0, y: 0, width: 300, height: 80 } } }], project, {});
    expect(web.contexts).toContain('section.hero > h1');
    expect(web.contexts).toContain('<untrusted_data source="site/src/Hero.tsx">');
    expect(web.contexts).toContain('   10> line 10');
  });

  it('Asset-Vorschau eines Bildes und fehlende Referenzen', async () => {
    const img = await addFileAsset(project, root, 'ref.png', PNG_1X1, { title: 'Mira' });
    const res = await resolveReferences(
      [
        { type: 'ref', ref: { kind: 'asset', assetId: img.id } },
        { type: 'ref', ref: { kind: 'clip', clipId: 'gibts_nicht' } },
      ],
      project,
      {},
    );
    expect(res.images).toHaveLength(1);
    expect(res.contexts).toContain('existiert nicht');
  });
});

describe('Anmeldung', () => {
  const settings: AppSettings = { language: 'de', defaultEffort: 'xhigh', preferredRuntime: 'auto', projectsDir: '/p', allowClaudeSubscription: false };

  it('selectRuntime folgt der Kette Anthropic → Agent SDK (nur erlaubt) → fal', () => {
    expect(selectRuntime({ settings, anthropicApiKey: 'sk', hasAnthropicProfile: false, falApiKey: 'fal', agentSdkAvailable: true }).active).toBe('anthropic');
    expect(selectRuntime({ settings, hasAnthropicProfile: true, agentSdkAvailable: false }).active).toBe('anthropic');
    expect(selectRuntime({ settings, hasAnthropicProfile: false, falApiKey: 'fal', agentSdkAvailable: true }).active).toBe('fal');
    const allowed = { ...settings, allowClaudeSubscription: true };
    expect(selectRuntime({ settings: allowed, hasAnthropicProfile: false, falApiKey: 'fal', agentSdkAvailable: true }).active).toBe('agent-sdk');
    expect(selectRuntime({ settings: allowed, hasAnthropicProfile: false, falApiKey: null, agentSdkAvailable: false }).active).toBeNull();
    const none = selectRuntime({ settings, hasAnthropicProfile: false, agentSdkAvailable: true });
    expect(none.runtimes.map((r) => [r.id, r.available])).toEqual([
      ['anthropic', false],
      ['agent-sdk', false],
      ['fal', false],
    ]);
    // Bevorzugte Laufzeit gewinnt, wenn verfügbar; sonst Kette
    expect(selectRuntime({ settings: { ...settings, preferredRuntime: 'fal' }, anthropicApiKey: 'sk', hasAnthropicProfile: false, falApiKey: 'fal', agentSdkAvailable: false }).active).toBe('fal');
    expect(selectRuntime({ settings: { ...settings, preferredRuntime: 'fal' }, anthropicApiKey: 'sk', hasAnthropicProfile: false, falApiKey: '', agentSdkAvailable: false }).active).toBe('anthropic');
  });

  it('detectAnthropicProfile findet ant-auth-Profile (Linux/macOS und Windows)', async () => {
    const home = join(root, 'home');
    expect(detectAnthropicProfile({}, home, 'linux')).toBe(false);
    await mkdir(join(home, '.config', 'anthropic', 'credentials'), { recursive: true });
    expect(detectAnthropicProfile({}, home, 'darwin')).toBe(false);
    await writeFile(join(home, '.config', 'anthropic', 'credentials', 'default.json'), '{}');
    expect(detectAnthropicProfile({}, home, 'darwin')).toBe(true);
    expect(detectAnthropicProfile({ ANTHROPIC_PROFILE: 'work' }, home, 'linux')).toBe(false);
    await writeFile(join(home, '.config', 'anthropic', 'credentials', 'work.json'), '{}');
    expect(detectAnthropicProfile({ ANTHROPIC_PROFILE: 'work' }, home, 'linux')).toBe(true);
    expect(detectAnthropicProfile({ ANTHROPIC_PROFILE: '../evil' }, home, 'linux')).toBe(false);
    expect(listAnthropicProfiles({}, home, 'linux')).toEqual(['default', 'work']);
    await writeFile(join(home, '.config', 'anthropic', 'active_config'), 'work\n');
    expect(detectAnthropicProfile({}, home, 'linux')).toBe(true);

    const appData = join(root, 'AppData', 'Roaming');
    expect(anthropicConfigDir({ APPDATA: appData }, 'C:\\Users\\x', 'win32')).toBe(join(appData, 'Anthropic'));
    await mkdir(join(appData, 'Anthropic', 'credentials'), { recursive: true });
    await writeFile(join(appData, 'Anthropic', 'credentials', 'default.json'), '{}');
    expect(detectAnthropicProfile({ APPDATA: appData }, 'C:\\Users\\x', 'win32')).toBe(true);
    expect(anthropicConfigDir({ ANTHROPIC_CONFIG_DIR: '/cfg' }, home, 'linux')).toBe('/cfg');
    expect(anthropicConfigDir({ XDG_CONFIG_HOME: '/xdg' }, home, 'linux')).toBe(join('/xdg', 'anthropic'));
  });
});
