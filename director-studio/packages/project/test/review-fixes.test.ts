import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocument, sequentialIds, type Generation, type Site, type Timeline } from '@studio/core';
import {
  appendJsonLine,
  FileVersionStore,
  normalizeStoredPath,
  ProjectStore,
  readJson,
  readJsonLines,
  RecentProjects,
  resolveStoredPath,
  sha256Buffer,
  writeJsonAtomic,
  type CorruptJsonLine,
} from '../src/index.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dstudio-fix-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const quiet = { onWarning: () => undefined };

function generation(id: string, extra: Partial<Generation> = {}): Generation {
  return {
    id,
    endpointId: 'minimax/h3-max/text-to-video',
    modality: 'video',
    status: 'queued',
    input: { prompt: 'x' },
    purpose: 'Shot',
    estimateUsd: 0.8,
    inputAssetIds: [],
    outputAssetIds: [],
    createdAt: '2026-10-01T00:00:00Z',
    ...extra,
  };
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFilesRecursive(abs)));
    else out.push(abs);
  }
  return out;
}

describe('JSONL-Journale', () => {
  it('hängt nach einer abgerissenen letzten Zeile sauber an und verliert keinen gültigen Eintrag', async () => {
    const file = join(root, 'log.jsonl');
    await appendJsonLine(file, { id: 1 });
    await appendFile(file, '{"id":2,"sta');
    await appendJsonLine(file, { id: 3 });
    await appendJsonLine(file, { id: 4 });
    const warnings: CorruptJsonLine[] = [];
    expect(await readJsonLines(file, { onCorruptLine: (w) => warnings.push(w) })).toEqual([{ id: 1 }, { id: 3 }, { id: 4 }]);
    expect(warnings).toEqual([expect.objectContaining({ line: 2, last: false })]);
    expect(await readFile(file, 'utf8')).toBe('{"id":1}\n{"id":2,"sta\n{"id":3}\n{"id":4}\n');
  });

  it('überspringt eine beschädigte Zeile mittendrin mit Warnung statt das Lesen abzubrechen', async () => {
    const file = join(root, 'mid.jsonl');
    await writeFile(file, '{"a":1}\nnicht-json\n{"a":2}\n{"a":3}');
    const warnings: CorruptJsonLine[] = [];
    // Auch eine letzte gültige Zeile ohne abschließenden Zeilenumbruch wird gelesen.
    expect(await readJsonLines(file, { onCorruptLine: (w) => warnings.push(w) })).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(warnings.map((w) => [w.line, w.last])).toEqual([[2, false]]);
    // Eine gültige letzte Zeile ohne Umbruch bleibt beim nächsten Anhängen erhalten.
    await appendJsonLine(file, { a: 4 });
    expect(await readJsonLines(file, { onCorruptLine: () => undefined })).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
  });

  it('öffnet ein Projekt nach abgerissener Journalzeile und weiteren Einträgen weiterhin vollständig', async () => {
    const warnings: string[] = [];
    const store = await ProjectStore.create(root, { title: 'Torn', category: 'video' }, { onWarning: (m) => warnings.push(m) });
    await store.saveGeneration(generation('gen_1', { status: 'running', requestId: 'req_1' }));
    await appendFile(join(store.dir, 'log', 'generations.jsonl'), '{"id":"gen_2","stat');
    await appendFile(join(store.dir, 'conversation', 'messages.jsonl'), '{"id":"m0","ro');
    await store.close();

    const reopened = await ProjectStore.open(store.dir, { onWarning: (m) => warnings.push(m) });
    await reopened.saveGeneration(generation('gen_3', { status: 'running', requestId: 'req_3' }));
    await reopened.saveGeneration(generation('gen_4'));
    await reopened.appendMessage({ id: 'm1', role: 'user', text: 'Hallo', createdAt: 't' });
    await reopened.appendMessage({ id: 'm2', role: 'director', text: 'Hi', createdAt: 't' });
    await reopened.close();

    const again = await ProjectStore.open(store.dir, { onWarning: (m) => warnings.push(m) });
    expect(again.getGeneration('gen_3')).toMatchObject({ status: 'running', requestId: 'req_3' });
    expect(again.getGeneration('gen_4')).toBeDefined();
    expect(again.getGeneration('gen_2')).toBeUndefined();
    expect((await again.listMessages()).map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(warnings.some((w) => /generations\.jsonl/.test(w))).toBe(true);
    await again.close();
  });
});

describe('FileVersionStore', () => {
  it('lässt einen langsamen Lesezugriff bei kaltem Cache keinen neueren Commit überschreiben', async () => {
    const store = await ProjectStore.create(root, { title: 'Race', category: 'video' }, quiet);
    for (let i = 0; i < 20; i++) await store.commitOps([{ op: 'update_timeline', patch: { durationFrames: 100 + i } }], { note: `v${i}`, author: 'director' });
    await store.close();

    for (let trial = 0; trial < 40; trial++) {
      const reopened = await ProjectStore.open(store.dir, quiet);
      const before = (await new FileVersionStore(store.dir).list()).length;
      // Erster Zugriff nach dem Öffnen: Commit, dann – zeitlich gestaffelt – Lesezugriffe bei (noch) kaltem Cache.
      const commit = reopened.commitOps([{ op: 'update_timeline', patch: { durationFrames: 1000 + trial } }], { note: 'A', author: 'director' });
      for (let tick = 0; tick < trial; tick++) await new Promise((r) => setImmediate(r));
      const reads = Promise.all([reopened.getDocument(), reopened.listVersions(), reopened.head()]);
      await Promise.all([commit, reads]);
      const next = await reopened.commitOps([{ op: 'update_timeline', patch: { backgroundColor: '#101010' } }], { note: 'B', author: 'director' });
      expect(next.number).toBe(before + 2);
      expect(next.parentNumber).toBe(before + 1);
      expect((next.document as Timeline).durationFrames).toBe(1000 + trial);
      expect((await reopened.listVersions()).map((v) => v.number)).toEqual(Array.from({ length: before + 2 }, (_, i) => i + 1));
      await reopened.close();
    }
  });

  it('überschreibt nie eine vorhandene Versionsdatei', async () => {
    const store = await ProjectStore.create(root, { title: 'Immutable', category: 'video' }, quiet);
    await store.close();
    const versions = new FileVersionStore(store.dir);
    expect((await versions.list()).length).toBe(1);
    const original = await readJson<{ note: string }>(join(store.dir, 'versions', '000001.json'));
    // Ein zweiter Prozess/Store hat inzwischen v2 geschrieben; dieser Store kennt sie nicht.
    const other = new FileVersionStore(store.dir);
    await other.commit({ document: createDocument('video'), ops: [], note: 'anderer Stand', author: 'system' });
    await expect(versions.commit({ document: createDocument('video'), ops: [], note: 'veraltet', author: 'system' })).rejects.toThrow(/existiert bereits/);
    expect((await readJson<{ note: string }>(join(store.dir, 'versions', '000002.json'))).note).toBe('anderer Stand');
    expect(original.note).toBe('Projekt angelegt');
  });
});

describe('Inhaltsadressierter Speicher', () => {
  it('speichert POSIX-Pfade und löst alte Windows-Pfade und fremde absolute Pfade plattformunabhängig auf', async () => {
    expect(normalizeStoredPath('assets\\store\\ab\\cd\\x.mp4')).toBe('assets/store/ab/cd/x.mp4');
    expect(normalizeStoredPath('C:\\Users\\me\\clip.mp4')).toBe('C:\\Users\\me\\clip.mp4');
    expect(normalizeStoredPath('/Users/me/clip.mp4')).toBe('/Users/me/clip.mp4');
    expect(resolveStoredPath(join(root, 'P.dstudio'), 'assets\\store\\ab\\cd\\x.mp4')).toBe(join(root, 'P.dstudio', 'assets', 'store', 'ab', 'cd', 'x.mp4'));
    expect(resolveStoredPath(join(root, 'P.dstudio'), 'C:\\Users\\me\\clip.mp4')).toBe('C:\\Users\\me\\clip.mp4');
    expect(resolveStoredPath(join(root, 'P.dstudio'), '\\\\server\\share\\clip.mp4')).toBe('\\\\server\\share\\clip.mp4');

    const store = await ProjectStore.create(root, { title: 'Paths', category: 'video' }, { ...quiet, ids: sequentialIds() });
    const asset = await store.addAssetFromBuffer('bytes', { fileName: 'a.txt', kind: 'text' });
    expect(asset.path).toMatch(/^assets\/store\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.txt$/);
    // Ein unter Windows geschriebener Eintrag (Backslashes) bleibt lesbar.
    const sha = sha256Buffer('legacy');
    const legacyRel = `assets\\store\\${sha.slice(0, 2)}\\${sha.slice(2, 4)}\\${sha}.txt`;
    await mkdir(join(store.dir, 'assets', 'store', sha.slice(0, 2), sha.slice(2, 4)), { recursive: true });
    await writeFile(join(store.dir, 'assets', 'store', sha.slice(0, 2), sha.slice(2, 4), `${sha}.txt`), 'legacy');
    await appendJsonLine(join(store.dir, 'assets', 'records.jsonl'), { ...asset, id: 'ast_legacy', sha256: sha, path: legacyRel, bytes: 6 });
    await store.close();
    const reopened = await ProjectStore.open(store.dir, quiet);
    const legacy = reopened.getAsset('ast_legacy')!;
    expect(legacy.path).toBe(`assets/store/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.txt`);
    expect(await reopened.readAssetText('ast_legacy')).toBe('legacy');
    expect(reopened.assetFilePath({ path: legacyRel })).toBe(reopened.assetFilePath(legacy));
    await reopened.close();
  });

  it('repariert eine abgeschnittene Datei im Speicher beim erneuten Import und kopiert atomar', async () => {
    const store = await ProjectStore.create(root, { title: 'Truncated', category: 'video' }, quiet);
    const src = join(root, 'clip.mp4');
    const content = Buffer.alloc(256 * 1024, 7);
    await writeFile(src, content);
    const sha = sha256Buffer(content);
    // Überbleibsel eines abgebrochenen Kopiervorgangs am Zielpfad.
    const cas = join(store.dir, 'assets', 'store', sha.slice(0, 2), sha.slice(2, 4), `${sha}.mp4`);
    await mkdir(join(cas, '..'), { recursive: true });
    await writeFile(cas, content.subarray(0, 1000));
    const asset = await store.importFile(src, 'import');
    expect(asset.bytes).toBe(content.length);
    expect((await stat(store.assetFilePath(asset)!)).size).toBe(content.length);
    expect((await listFilesRecursive(join(store.dir, 'assets', 'store'))).filter((f) => f.includes('.tmp-'))).toEqual([]);
    await store.close();
  });

  it('entfernt beim Verschieben die Quelldatei auch, wenn der Inhalt schon im Speicher liegt', async () => {
    const store = await ProjectStore.create(root, { title: 'Move', category: 'video' }, quiet);
    const a = join(root, 'a.wav');
    const b = join(root, 'b.wav');
    await writeFile(a, 'same');
    await writeFile(b, 'same');
    const first = await store.addAssetFromFile(a, { move: true });
    const second = await store.addAssetFromFile(b, { move: true });
    expect(second.path).toBe(first.path);
    await expect(stat(a)).rejects.toThrow();
    await expect(stat(b)).rejects.toThrow();
    expect(await readFile(store.assetFilePath(second)!, 'utf8')).toBe('same');
    await store.close();
  });
});

describe('Verknüpfte Dateien', () => {
  it('stellt eine fehlende Verknüpfung beim erneuten Hinzufügen gleichen Inhalts auf den neuen Pfad um', async () => {
    const store = await ProjectStore.create(root, { title: 'Link', category: 'video' }, quiet);
    await mkdir(join(root, 'usb'));
    await mkdir(join(root, 'disk'));
    const oldPath = join(root, 'usb', 'clip.mp4');
    const newPath = join(root, 'disk', 'clip.mp4');
    await writeFile(oldPath, 'footage');
    const linked = await store.importFile(oldPath, 'link');
    await rm(oldPath);
    await writeFile(newPath, 'footage');
    const again = await store.importFile(newPath, 'link');
    expect(again.id).toBe(linked.id);
    expect(again.path).toBe(newPath);
    expect(await store.checkLinked(linked.id)).toEqual({ ok: true });
    // Existiert der alte Pfad noch, bleibt es bei der bisherigen Verknüpfung.
    const copy = join(root, 'copy.mp4');
    await writeFile(copy, 'footage');
    expect((await store.importFile(copy, 'link')).path).toBe(newPath);
    await store.close();
    const reopened = await ProjectStore.open(store.dir, quiet);
    expect(reopened.getAsset(linked.id)?.path).toBe(newPath);
    await reopened.close();
  });

  it('relink überschreibt keine parallel vorgenommenen Änderungen am Asset', async () => {
    const store = await ProjectStore.create(root, { title: 'Relink', category: 'video' }, quiet);
    const oldPath = join(root, 'old.mp4');
    const moved = join(root, 'moved.mp4');
    await writeFile(oldPath, Buffer.alloc(512 * 1024, 3));
    const linked = await store.importFile(oldPath, 'link');
    await writeFile(moved, Buffer.alloc(512 * 1024, 3));
    const relinking = store.relink(linked.id, moved);
    await store.updateAsset(linked.id, { status: 'rejected', tags: ['bad'], metadata: { falUploads: ['u1'] } });
    const result = await relinking;
    expect(result).toMatchObject({ path: moved, status: 'rejected', tags: ['bad'] });
    expect(result.metadata).toMatchObject({ falUploads: ['u1'] });
    await store.close();
    const reopened = await ProjectStore.open(store.dir, quiet);
    expect(reopened.getAsset(linked.id)).toMatchObject({ path: moved, status: 'rejected', tags: ['bad'] });
    await reopened.close();
  });
});

describe('Kategorie', () => {
  it('setzt die Kategorie bei parallelen Aufrufen genau einmal', async () => {
    const store = await ProjectStore.create(root, { title: 'Cat', category: null }, quiet);
    const results = await Promise.allSettled([store.setCategory('slides'), store.setCategory('video')]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(store.manifest.category).toBe('slides');
    expect(store.manifest.checkpoints[0]?.kind).toBe('outline');
    expect(await store.listVersions()).toHaveLength(1);
    expect((await store.getDocument())?.kind).toBe('deck');
    await store.close();
  });

  it('heilt eine Kategorie ohne Dokument beim Öffnen und übernimmt ein verwaistes Dokument passender Art', async () => {
    const healed = await ProjectStore.create(root, { title: 'Heal', category: null }, quiet);
    await healed.close();
    // Älterer Absturz: Manifest mit Kategorie geschrieben, aber keine Version.
    const manifest = await readJson<Record<string, unknown>>(join(healed.dir, 'project.json'));
    await writeJsonAtomic(join(healed.dir, 'project.json'), { ...manifest, category: 'video' });
    const reopened = await ProjectStore.open(healed.dir, quiet);
    expect((await reopened.getDocument())?.kind).toBe('timeline');
    await reopened.close();

    // Absturz nach der ersten Version, aber vor dem Manifest: das Dokument wird übernommen, keine zweite Version.
    const orphan = await ProjectStore.create(root, { title: 'Orphan', category: null }, quiet);
    await orphan.close();
    await new FileVersionStore(orphan.dir).commit({ document: createDocument('slides'), ops: [], note: 'Projekt angelegt', author: 'system' });
    const opened = await ProjectStore.open(orphan.dir, quiet);
    await opened.setCategory('slides');
    expect(await opened.listVersions()).toHaveLength(1);
    expect(opened.manifest.category).toBe('slides');
    await opened.close();
  });
});

describe('Sperre & Schließen', () => {
  it('blockiert Journal-Schreibvorgänge nicht, während eine große Datei gehasht und kopiert wird', async () => {
    const store = await ProjectStore.create(root, { title: 'Lock', category: 'video' }, quiet);
    const big = join(root, 'big.mov');
    await writeFile(big, Buffer.alloc(8 * 1024 * 1024, 1));
    const order: string[] = [];
    const importing = store.importFile(big, 'import').then(() => order.push('import'));
    const saving = store.saveGeneration(generation('gen_1', { status: 'running', requestId: 'r' })).then(() => order.push('generation'));
    await Promise.all([importing, saving]);
    expect(order).toEqual(['generation', 'import']);
    await store.close();
  });

  it('close() lässt begonnene Schreibvorgänge zu Ende laufen und lehnt spätere ab, bevor etwas geschrieben wird', async () => {
    const store = await ProjectStore.create(root, { title: 'Close', category: 'video' }, quiet);
    const adding = store.addAssetFromBuffer('data', { fileName: 'x.txt', kind: 'text' });
    const saving = store.saveGeneration(generation('gen_1'));
    const closing = store.close();
    const asset = await adding;
    await saving;
    await closing;
    await expect(store.saveGeneration(generation('gen_2'))).rejects.toThrow(/geschlossen/);
    await expect(store.addAssetFromBuffer('later', { fileName: 'y.txt' })).rejects.toThrow(/geschlossen/);
    await store.close(); // idempotent
    const lines = await readJsonLines<Generation>(join(store.dir, 'log', 'generations.jsonl'));
    expect(lines.map((g) => g.id)).toEqual(['gen_1']);
    const reopened = await ProjectStore.open(store.dir, quiet);
    expect(reopened.getAsset(asset.id)).toBeDefined();
    expect(reopened.allAssets()).toHaveLength(1);
    await reopened.close();
  });
});

describe('Budget', () => {
  it('bucht Director-Nutzung auf einen Checkpoint und entfernt doppelt geschriebene Ledger-Zeilen beim Öffnen', async () => {
    const store = await ProjectStore.create(root, { title: 'Ledger', category: 'video' }, quiet);
    await store.approveBudget('cp_1_treatment', 10);
    await store.budgetRecordUsage('run_1', 0.5, 'director', 'Planung', 'cp_1_treatment');
    expect(store.ledgerEntries().at(-1)).toMatchObject({ refId: 'run_1', checkpointId: 'cp_1_treatment', source: 'director' });
    await store.budgetReserve('gen_1', 4, { checkpointId: 'cp_1_treatment' });
    await store.close();
    // Ein Anhängen kam auf der Platte an, wurde aber als Fehler gemeldet und wiederholt: Zeile doppelt.
    const ledgerFile = join(store.dir, 'log', 'ledger.jsonl');
    const lines = (await readFile(ledgerFile, 'utf8')).trim().split('\n');
    await appendFile(ledgerFile, `${lines.at(-1)}\n`);
    const reopened = await ProjectStore.open(store.dir, quiet);
    expect(reopened.ledgerEntries()).toHaveLength(2);
    expect(reopened.budgetSummary()).toMatchObject({ spentUsd: 0.5, reservedUsd: 4 });
    await reopened.budgetSettle('gen_1', 3);
    expect(reopened.budgetSummary()).toMatchObject({ spentUsd: 3.5, reservedUsd: 0 });
    await reopened.close();
    const again = await ProjectStore.open(store.dir, quiet);
    expect(again.budgetSummary()).toMatchObject({ spentUsd: 3.5, reservedUsd: 0 });
    await again.close();
  });
});

describe('Website-Versionen', () => {
  async function webProject() {
    const store = await ProjectStore.create(root, { title: 'Web', category: 'web' }, { ...quiet, ids: sequentialIds() });
    await mkdir(join(store.siteDir, 'src', 'components'), { recursive: true });
    await mkdir(join(store.siteDir, 'node_modules', 'react'), { recursive: true });
    await writeFile(join(store.siteDir, 'index.html'), '<div id=root>');
    await writeFile(join(store.siteDir, 'src', 'App.tsx'), 'export default "v1"');
    await writeFile(join(store.siteDir, 'node_modules', 'react', 'index.js'), 'react');
    await writeFile(join(store.siteDir, '.env'), 'SECRET=1');
    return store;
  }

  it('sichert den Inhalt jeder Datei und stellt site/ exakt auf den Stand einer Version zurück', async () => {
    const store = await webProject();
    const { version: v2, files } = await store.commitSiteSnapshot({ note: 'Erster Stand', author: 'director' });
    expect(Object.keys(files)).toEqual(['index.html', 'src/App.tsx']);
    // Inhalt liegt inhaltsadressiert im Projektspeicher.
    const sha = files['src/App.tsx']!;
    expect(await readFile(join(store.dir, 'assets', 'store', sha.slice(0, 2), sha.slice(2, 4), sha), 'utf8')).toBe('export default "v1"');
    // Keine sichtbaren Assets.
    expect(store.allAssets()).toHaveLength(0);

    await writeFile(join(store.siteDir, 'src', 'App.tsx'), 'export default "kaputt"');
    await writeFile(join(store.siteDir, 'src', 'components', 'Hero.tsx'), 'hero');
    await rm(join(store.siteDir, 'index.html'));
    const snap3 = await store.snapshotSiteFiles();
    await store.commitOps([{ op: 'snapshot_files', files: snap3 }], { note: 'Kaputt', author: 'director' });

    const restored = await store.restoreVersion(v2.number, 'director');
    expect(restored.restoredFrom).toBe(v2.number);
    expect((restored.document as Site).files).toEqual(files);
    expect(await readFile(join(store.siteDir, 'src', 'App.tsx'), 'utf8')).toBe('export default "v1"');
    expect(await readFile(join(store.siteDir, 'index.html'), 'utf8')).toBe('<div id=root>');
    await expect(stat(join(store.siteDir, 'src', 'components'))).rejects.toThrow();
    // Abhängigkeiten und .env bleiben unberührt.
    expect(await readFile(join(store.siteDir, 'node_modules', 'react', 'index.js'), 'utf8')).toBe('react');
    expect(await readFile(join(store.siteDir, '.env'), 'utf8')).toBe('SECRET=1');
    // Der nächste Snapshot entspricht dem wiederhergestellten Stand.
    expect(await store.snapshotSiteFiles()).toEqual(files);
    await store.close();
  });

  it('bricht ohne Änderung ab, wenn der Inhalt einer alten Version fehlt, und nutzt passende Dateien auf der Platte', async () => {
    const store = await webProject();
    const appSha = sha256Buffer('export default "v1"');
    const indexSha = sha256Buffer('<div id=root>');
    // Snapshot einer älteren App-Version: nur Hashes, kein Inhalt im Speicher.
    const legacy = await store.commitOps([{ op: 'snapshot_files', files: { 'index.html': indexSha, 'src/App.tsx': appSha } }], { note: 'alt', author: 'director' });
    const broken = await store.commitOps([{ op: 'snapshot_files', files: { 'index.html': indexSha, 'src/Gone.tsx': sha256Buffer('weg') } }], { note: 'alt 2', author: 'director' });
    await writeFile(join(store.siteDir, 'src', 'Extra.tsx'), 'extra');
    const versionsBefore = (await store.listVersions()).length;
    await expect(store.restoreVersion(broken.number)).rejects.toThrow(/fehlt im Projektspeicher.*src\/Gone\.tsx/);
    expect((await store.listVersions()).length).toBe(versionsBefore);
    expect(await readFile(join(store.siteDir, 'src', 'Extra.tsx'), 'utf8')).toBe('extra');

    // Stimmen die Dateien auf der Platte, gelingt das Wiederherstellen trotzdem (nicht enthaltene Dateien werden entfernt).
    const restored = await store.restoreVersion(legacy.number);
    expect(restored.restoredFrom).toBe(legacy.number);
    await expect(stat(join(store.siteDir, 'src', 'Extra.tsx'))).rejects.toThrow();
    expect(await readFile(join(store.siteDir, 'src', 'App.tsx'), 'utf8')).toBe('export default "v1"');
    await store.close();
  });
});

describe('RecentProjects', () => {
  it('behält Projekte auf gerade nicht erreichbaren Laufwerken in der gespeicherten Liste', async () => {
    const store = await ProjectStore.create(root, { title: 'Here', category: 'audio' }, quiet);
    const external = join(root, 'ssd', 'Film.dstudio');
    const recent = new RecentProjects(join(root, 'appdata'));
    await recent.touch({ path: external, title: 'Film', category: 'video', updatedAt: 't' });
    await recent.touch({ path: store.dir, title: 'Here', category: 'audio', updatedAt: 't' });
    expect((await recent.list()).map((r) => r.title)).toEqual(['Here']);
    // Laufwerk wieder angeschlossen.
    await mkdir(external, { recursive: true });
    await writeFile(join(external, 'project.json'), '{}');
    expect((await recent.list()).map((r) => r.title)).toEqual(['Here', 'Film']);
    await recent.remove(store.dir);
    expect((await recent.list()).map((r) => r.title)).toEqual(['Film']);
    await store.close();
  });
});
