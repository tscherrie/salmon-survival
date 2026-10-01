import { mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sequentialIds, type Generation, type Timeline } from '@studio/core';
import { ProjectStore, readJsonLines, RecentProjects, safeFileName } from '../src/index.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dstudio-test-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function clock() {
  let n = 0;
  return () => new Date(Date.UTC(2026, 9, 1, 10, 0, n++)).toISOString();
}

describe('ProjectStore', () => {
  it('creates a project folder with manifest, first version and checkpoints', async () => {
    const store = await ProjectStore.create(root, { title: 'Claude Pop: Remix', category: 'video' }, { now: clock(), ids: sequentialIds() });
    expect(store.dir).toBe(join(root, 'Claude Pop- Remix.dstudio'));
    const manifest = store.manifest;
    expect(manifest.id).toBe('prj_1');
    expect(manifest.phase).toBe('planning');
    expect(manifest.director.effort).toBe('xhigh');
    expect(manifest.checkpoints.map((c) => c.kind)).toEqual(['treatment', 'style_bible', 'storyboard', 'production', 'finishing']);
    expect(manifest.pickers.video).toEqual({ mode: 'model', modelId: 'minimax/h3-max/text-to-video' });
    const versions = await store.listVersions();
    expect(versions).toHaveLength(1);
    expect((await store.getDocument())?.kind).toBe('timeline');
    const mirror = JSON.parse(await readFile(join(store.dir, 'documents', 'main.json'), 'utf8'));
    expect(mirror.kind).toBe('timeline');
    // Namenskollision
    const second = await ProjectStore.create(root, { title: 'Claude Pop: Remix', category: 'video' });
    expect(second.dir).toBe(join(root, 'Claude Pop- Remix 2.dstudio'));
    store.close();
    second.close();
  });

  it('imports and links files, deduplicates and tracks lineage', async () => {
    const store = await ProjectStore.create(root, { title: 'Assets', category: 'video' }, { ids: sequentialIds() });
    const src = join(root, 'song.mp3');
    await writeFile(src, 'fake-mp3-bytes');
    const imported = await store.importFile(src, 'import', { title: 'Song' });
    expect(imported).toMatchObject({ kind: 'audio', source: 'imported', mime: 'audio/mpeg', title: 'Song', bytes: 14 });
    expect(imported.path).toMatch(/^assets\/store\/..\/..\/[0-9a-f]{64}\.mp3$/);
    expect(await readFile(store.assetFilePath(imported)!, 'utf8')).toBe('fake-mp3-bytes');
    expect((await store.importFile(src, 'import')).id).toBe(imported.id);

    const linked = await store.importFile(src, 'link');
    expect(linked.source).toBe('linked');
    expect(store.assetFilePath(linked)).toBe(src);
    expect(await store.checkLinked(linked.id)).toEqual({ ok: true });
    await writeFile(src, 'changed!');
    expect(await store.checkLinked(linked.id)).toEqual({ ok: false, reason: 'changed' });
    await rm(src);
    expect(await store.checkLinked(linked.id)).toEqual({ ok: false, reason: 'missing' });

    const child = await store.addAssetFromBuffer('Treatment-Text', {
      fileName: 'treatment.md',
      kind: 'text',
      subtype: 'treatment',
      title: 'Treatment v1',
      source: 'director',
      parents: [{ assetId: imported.id, relation: 'reference' }],
    });
    expect(store.lineage(child.id).parents).toEqual([{ parentId: imported.id, childId: child.id, relation: 'reference' }]);
    expect(store.lineage(imported.id).children.map((e) => e.childId)).toEqual([child.id]);
    expect(await store.readAssetText(child.id)).toBe('Treatment-Text');

    await store.updateAsset(child.id, { tags: ['v1'], status: 'rejected' });
    expect(store.listAssets({ text: 'treatment' })).toHaveLength(0);
    expect(store.listAssets({ statuses: ['rejected'] }).map((a) => a.id)).toEqual([child.id]);
    expect(store.listAssets({ kinds: ['audio'] }).map((a) => a.id).sort()).toEqual([imported.id, linked.id].sort());
    store.close();
  });

  it('commits document ops with asset validation and restores versions', async () => {
    const store = await ProjectStore.create(root, { title: 'Ops', category: 'video' });
    const clip = join(root, 'clip.mp4');
    await writeFile(clip, 'video');
    const asset = await store.importFile(clip, 'import');
    await store.commitOps([{ op: 'update_timeline', patch: { durationFrames: 300 } }], { note: 'Länge', author: 'director' });
    const v3 = await store.commitOps([{ op: 'insert_clip', trackId: 'V1', clip: { id: 'c1', assetId: asset.id, start: 0, duration: 90 } }], { note: 'Clip', author: 'director', runId: 'run_1' });
    expect(v3.number).toBe(3);
    await expect(store.commitOps([{ op: 'insert_clip', trackId: 'V1', clip: { id: 'c2', assetId: 'ast_missing', start: 100, duration: 10 } }], { note: 'x', author: 'director' })).rejects.toThrow(/existiert nicht/);
    await expect(store.commitOps([{ op: 'update_timeline', patch: { durationFrames: 400 } }], { note: 'x', author: 'director', expectedHead: 2 })).rejects.toThrow(/Versionskonflikt/);
    expect(await store.usedAssetIds()).toEqual(new Set([asset.id]));
    const restored = await store.restoreVersion(2);
    expect(restored.restoredFrom).toBe(2);
    expect((restored.document as Timeline).tracks[0]!.clips).toHaveLength(0);
    store.close();

    // Wiederöffnen: Versionen, Assets und Index bleiben erhalten.
    const reopened = await ProjectStore.open(store.dir);
    expect((await reopened.listVersions()).map((v) => v.number)).toEqual([1, 2, 3, 4]);
    expect(reopened.getAsset(asset.id)?.sha256).toBe(asset.sha256);
    reopened.close();
  });

  it('journals generations before submit and survives a torn last line', async () => {
    const store = await ProjectStore.create(root, { title: 'Jobs', category: 'video' });
    const gen: Generation = {
      id: 'gen_1',
      endpointId: 'minimax/h3-max/text-to-video',
      modality: 'video',
      status: 'queued',
      input: { prompt: 'x' },
      purpose: 'Shot 1',
      estimateUsd: 0.8,
      inputAssetIds: [],
      outputAssetIds: [],
      createdAt: '2026-10-01T00:00:00Z',
    };
    await store.saveGeneration(gen);
    await store.saveGeneration({ ...gen, status: 'running', requestId: 'req_1' });
    expect(store.getGeneration('gen_1')?.status).toBe('running');
    expect(store.listGenerations(['queued', 'running'])).toHaveLength(1);
    await appendFile(join(store.dir, 'log', 'generations.jsonl'), '{"id":"gen_2","stat');
    store.close();
    const reopened = await ProjectStore.open(store.dir);
    expect(reopened.getGeneration('gen_1')).toMatchObject({ status: 'running', requestId: 'req_1' });
    expect(reopened.getGeneration('gen_2')).toBeUndefined();
    reopened.close();
  });

  it('persists the budget ledger and approvals', async () => {
    const store = await ProjectStore.create(root, { title: 'Budget', category: 'video' });
    await store.approveBudget('cp_1_treatment', 20);
    await store.budgetReserve('gen_1', 4, { checkpointId: 'cp_1_treatment' });
    await store.budgetSettle('gen_1', 3.5);
    await store.budgetRecordUsage('run_1', 0.75);
    expect(store.budgetSummary()).toMatchObject({ approvedUsd: 20, spentUsd: 4.25, availableUsd: 15.75 });
    store.close();
    const reopened = await ProjectStore.open(store.dir);
    expect(reopened.budgetSummary()).toMatchObject({ approvedUsd: 20, spentUsd: 4.25, reservedUsd: 0 });
    expect(reopened.budgetCheck(16).ok).toBe(false);
    expect((await readJsonLines(join(store.dir, 'log', 'ledger.jsonl'))).length).toBe(4);
    reopened.close();
  });

  it('stores messages and transcripts append-only', async () => {
    const store = await ProjectStore.create(root, { title: 'Chat', category: null });
    expect(await store.getDocument()).toBeNull();
    await store.appendMessage({ id: 'm1', role: 'user', text: 'Hallo', createdAt: 't' });
    await store.appendMessage({ id: 'm2', role: 'director', text: 'Hi!', createdAt: 't' });
    await store.appendTranscript('anthropic', [{ role: 'user', content: 'Hallo' }]);
    expect((await store.listMessages()).map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(await store.readTranscript('anthropic')).toEqual([{ role: 'user', content: 'Hallo' }]);
    await store.setCategory('slides');
    expect((await store.getDocument())?.kind).toBe('deck');
    expect(store.manifest.checkpoints[0]?.kind).toBe('outline');
    await expect(store.setCategory('video')).rejects.toThrow(/bereits gesetzt/);
    store.close();
  });

  it('snapshots site files without dependency folders', async () => {
    const store = await ProjectStore.create(root, { title: 'Web', category: 'web' });
    await writeFile(join(root, 'tmp.txt'), 'x');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(store.siteDir, 'src'), { recursive: true });
    await mkdir(join(store.siteDir, 'node_modules', 'react'), { recursive: true });
    await writeFile(join(store.siteDir, 'src', 'App.tsx'), 'export default 1');
    await writeFile(join(store.siteDir, 'index.html'), '<div id=root>');
    await writeFile(join(store.siteDir, 'node_modules', 'react', 'index.js'), 'x');
    const snap = await store.snapshotSiteFiles();
    expect(Object.keys(snap)).toEqual(['index.html', 'src/App.tsx']);
    store.close();
  });
});

describe('helpers', () => {
  it('makes safe file names', () => {
    expect(safeFileName('A/B:C*?')).toBe('A-B-C--');
    expect(safeFileName('  trailing dots... ')).toBe('trailing dots');
    expect(safeFileName('CON')).toBe('CON-projekt');
    expect(safeFileName('')).toBe('Projekt');
  });

  it('tracks recent projects', async () => {
    const store = await ProjectStore.create(root, { title: 'R', category: 'audio' });
    const recent = new RecentProjects(join(root, 'appdata'));
    await recent.touch({ path: store.dir, title: 'R', category: 'audio', updatedAt: 't' });
    await recent.touch({ path: join(root, 'gone.dstudio'), title: 'Gone', category: null, updatedAt: 't' });
    expect((await recent.list()).map((r) => r.title)).toEqual(['R']);
    store.close();
  });
});
