import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectStore } from '@studio/project';
import { awaitGenerationsTool, cancelGenerationTool, collectAssetRefs, generateTool, replaceAssetRefs, resultText } from '../src/index.ts';
import { addFileAsset, createProject, makeEnv, PNG_1X1, tempRoot, type TestEnv } from './helpers.ts';

let root: string;
let cleanup: () => Promise<void>;
let project: ProjectStore;
let env: TestEnv;

async function approveBudget(amount: number) {
  // Treatment vorlegen und freigeben → aktiver Budget-Checkpoint.
  await project.updateManifest((m) => {
    m.checkpoints = m.checkpoints.map((c) => (c.id === 'cp_1_treatment' ? { ...c, status: 'approved', budgetApprovedUsd: amount } : c));
  });
  await project.approveBudget('cp_1_treatment', amount);
}

beforeEach(async () => {
  ({ root, cleanup } = await tempRoot());
  project = await createProject(root, 'video');
  env = makeEnv(project);
});

afterEach(async () => {
  await env.jobs.drain();
  project.close();
  await cleanup();
});

describe('asset:<id>-Referenzen', () => {
  it('findet und ersetzt Referenzen rekursiv', () => {
    const input = { prompt: 'x', image_url: 'asset:ast_1', refs: ['asset:ast_2', 'nicht asset:ast_3'], nested: { a: 'asset:ast_1' } };
    expect([...collectAssetRefs(input)].sort()).toEqual(['ast_1', 'ast_2']);
    expect(replaceAssetRefs(input, { ast_1: 'https://u/1', ast_2: 'https://u/2' })).toEqual({ prompt: 'x', image_url: 'https://u/1', refs: ['https://u/2', 'nicht asset:ast_3'], nested: { a: 'https://u/1' } });
  });
});

describe('generate – Picker-Gate', () => {
  it('lehnt ein anderes Modell der festgelegten Modalität ab', async () => {
    await approveBudget(10);
    const result = await generateTool.run({ endpointId: 'fal-ai/kling-video/v3/text-to-video', input: { prompt: 'x' }, purpose: 'Test' }, env.ctx);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('minimax/h3-max/text-to-video');
    expect(env.generation.runs).toHaveLength(0);
  });

  it('erlaubt Varianten derselben Familie', async () => {
    await approveBudget(10);
    const result = await generateTool.run({ endpointId: 'minimax/h3-max/reference-to-video', input: { prompt: 'x', duration: 5 }, purpose: 'Test', wait: true }, env.ctx);
    expect(result.isError).toBeUndefined();
    expect(env.generation.runs[0]!.endpointId).toBe('minimax/h3-max/reference-to-video');
  });

  it('erlaubt jedes Modell bei „Auto“', async () => {
    await approveBudget(10);
    await project.updateManifest((m) => {
      m.pickers.video = { mode: 'auto' };
    });
    const result = await generateTool.run({ endpointId: 'fal-ai/kling-video/v3/text-to-video', input: { prompt: 'x' }, purpose: 'Test', wait: true }, env.ctx);
    expect(result.isError).toBeUndefined();
  });

  it('lehnt unbekannte Modelle und Schemafehler ab', async () => {
    expect((await generateTool.run({ endpointId: 'nope/model', input: { prompt: 'x' }, purpose: 'T' }, env.ctx)).isError).toBe(true);
    const bad = await generateTool.run({ endpointId: 'minimax/h3-max/text-to-video', input: { duration: 5 }, purpose: 'T' }, env.ctx);
    expect(bad.isError).toBe(true);
    expect(resultText(bad)).toContain('prompt: required');
  });
});

describe('generate – Budget-Gate', () => {
  it('fragt bei fehlendem Budget nach Freigabe und bucht die Nachfreigabe', async () => {
    await approveBudget(0.5);
    env.ui.approve = true;
    const result = await generateTool.run({ endpointId: 'minimax/h3-max/text-to-video', input: { prompt: 'x', duration: 5 }, purpose: 'Shot 1', wait: true }, env.ctx);
    expect(result.isError).toBeUndefined();
    expect(env.ui.approvals).toHaveLength(1);
    expect(env.ui.approvals[0]).toMatchObject({ kind: 'budget', amountUsd: 0.3 });
    const summary = project.budgetSummary();
    expect(summary.approvedUsd).toBeCloseTo(0.8);
    expect(summary.byCheckpoint.cp_1_treatment!.spentUsd).toBeCloseTo(0.8);
    expect(env.ui.ofType('budget').length).toBeGreaterThan(0);
  });

  it('bricht ab, wenn der Nutzer die Freigabe verweigert', async () => {
    env.ui.approve = false;
    const result = await generateTool.run({ endpointId: 'minimax/h3-max/text-to-video', input: { prompt: 'x', duration: 5 }, purpose: 'Shot 1' }, env.ctx);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('Budget nicht freigegeben');
    expect(env.generation.runs).toHaveLength(0);
    expect(project.listGenerations()).toHaveLength(0);
  });

  it('ohne aktiven Checkpoint wird auf cp_extra freigegeben', async () => {
    env.ui.approve = true;
    await generateTool.run({ endpointId: 'fal-ai/nano-banana-pro', input: { prompt: 'x' }, purpose: 'Test', wait: true }, env.ctx);
    expect(project.budgetSummary().byCheckpoint.cp_extra).toMatchObject({ approvedUsd: 0.04, spentUsd: 0.04 });
  });
});

describe('generate – Journal, Upload, Ingest', () => {
  it('journalisiert vor dem Absenden, lädt asset:-Eingaben hoch und übernimmt Ausgaben mit Lineage', async () => {
    await approveBudget(5);
    const ref = await addFileAsset(project, root, 'mira.png', PNG_1X1, { title: 'Mira Charakterblatt', tags: ['character'] });
    const storyboard = await addFileAsset(project, root, 'board.png', Buffer.concat([PNG_1X1, Buffer.from('x')]), { title: 'Board' });
    env.generation.onRun = () => project.listGenerations()[0]?.status;

    const started = await generateTool.run(
      {
        endpointId: 'minimax/h3-max/reference-to-video',
        input: { prompt: 'Mira runs', duration: 10, image_url: `asset:${ref.id}` },
        purpose: 'Shot 7 Test',
        outputTitle: 'Shot 7',
        tags: ['shot-07'],
        inputAssetIds: [storyboard.id],
      },
      env.ctx,
    );
    expect(started.isError).toBeUndefined();
    const genId = /Generierung (gen_\d+)/.exec(resultText(started))![1]!;
    expect(resultText(started)).toContain('await_generations');

    // Validierung lief mit Platzhalter-URL statt "asset:…"
    expect(JSON.stringify(env.catalog.validateCalls[0])).toContain('https://upload.pending.invalid/');

    const awaited = await awaitGenerationsTool.run({ ids: [genId], timeoutSec: 30 }, env.ctx);
    expect(resultText(awaited)).toContain('fertig');

    // Journal vor dem Absenden (queued), Upload ersetzt die Referenz
    expect(env.generation.runs[0]!.journalStatusAtSubmit).toBe('queued');
    expect(env.generation.uploads).toHaveLength(1);
    expect(env.generation.runs[0]!.input.image_url).toMatch(/^https:\/\/fal\.media\/upload\//);
    expect(project.getAsset(ref.id)!.metadata!.falUploads).toHaveLength(1);

    const gen = project.getGeneration(genId)!;
    expect(gen.status).toBe('completed');
    expect(gen.requestId).toBe('req_1');
    expect(gen.costUsd).toBeCloseTo(1.6);
    expect(gen.inputAssetIds.sort()).toEqual([ref.id, storyboard.id].sort());
    expect(gen.outputAssetIds).toHaveLength(1);

    const asset = project.getAsset(gen.outputAssetIds[0]!)!;
    expect(asset).toMatchObject({ kind: 'video', source: 'generated', modelId: 'minimax/h3-max/reference-to-video', generationId: genId, prompt: 'Mira runs', title: 'Shot 7', tags: ['shot-07'], width: 1280, height: 720, durationMs: 5000 });
    expect(asset.costUsd).toBeCloseTo(1.6);
    expect(await readFile(project.assetFilePath(asset)!, 'utf8')).toContain('video:');
    const parents = project.lineage(asset.id).parents;
    expect(parents.map((p) => p.parentId).sort()).toEqual([ref.id, storyboard.id].sort());
    expect(parents.every((p) => p.relation === 'input')).toBe(true);

    // Ledger: Reservierung → Ist-Buchung (Schätzung als Ist)
    const kinds = project.ledgerEntries().filter((e) => e.refId === genId).map((e) => e.kind);
    expect(kinds).toEqual(['reservation', 'release', 'actual']);
    expect(project.budgetSummary().reservedUsd).toBe(0);

    // Ereignisse
    expect(env.ui.ofType('generation').map((e) => e.generation.status)).toContain('completed');
    expect(env.ui.ofType('asset').map((e) => e.asset.id)).toContain(asset.id);
  });

  it('teilt die Kosten auf mehrere Ausgaben auf', async () => {
    await approveBudget(5);
    const res = await generateTool.run({ endpointId: 'fal-ai/nano-banana-pro', input: { prompt: 'Style test' }, purpose: 'Stiltest', wait: true }, env.ctx);
    expect(res.isError).toBeUndefined();
    const gen = project.listGenerations()[0]!;
    expect(gen.outputAssetIds).toHaveLength(2);
    const assets = gen.outputAssetIds.map((id) => project.getAsset(id)!);
    expect(assets.map((a) => a.title)).toEqual(['Stiltest (1/2)', 'Stiltest (2/2)']);
    expect(assets[0]!.costUsd).toBeCloseTo(0.02);
    expect(assets[0]!.kind).toBe('image');
  });

  it('gibt die Reservierung bei Fehlschlag frei', async () => {
    await approveBudget(5);
    env.generation.failWith = new Error('fal: 500');
    const res = await generateTool.run({ endpointId: 'minimax/h3-max/text-to-video', input: { prompt: 'x' }, purpose: 'T', wait: true }, env.ctx);
    expect(res.isError).toBe(true);
    expect(resultText(res)).toContain('fal: 500');
    const gen = project.listGenerations()[0]!;
    expect(gen.status).toBe('failed');
    expect(project.ledgerEntries().filter((e) => e.refId === gen.id).map((e) => e.kind)).toEqual(['reservation', 'release']);
    expect(project.budgetSummary().spentUsd).toBe(0);
  });

  it('cancel_generation bricht einen laufenden Job ab', async () => {
    await approveBudget(5);
    env.generation.hold();
    const res = await generateTool.run({ endpointId: 'minimax/h3-max/text-to-video', input: { prompt: 'x' }, purpose: 'T' }, env.ctx);
    const id = /Generierung (gen_\d+)/.exec(resultText(res))![1]!;
    expect(env.jobs.isRunning(id)).toBe(true);
    const cancel = await cancelGenerationTool.run({ id }, env.ctx);
    expect(resultText(cancel)).toContain('canceled');
    expect(project.getGeneration(id)!.status).toBe('canceled');
    expect(project.budgetSummary().reservedUsd).toBe(0);
  });

  it('await_generations liefert nach dem Zeitlimit den Zwischenstand', async () => {
    await approveBudget(5);
    env.generation.hold();
    const res = await generateTool.run({ endpointId: 'minimax/h3-max/text-to-video', input: { prompt: 'x' }, purpose: 'T' }, env.ctx);
    const id = /Generierung (gen_\d+)/.exec(resultText(res))![1]!;
    const waited = await awaitGenerationsTool.run({ ids: [id], timeoutSec: 1 }, env.ctx);
    expect(resultText(waited)).toMatch(/läuft|Warteschlange/);
    env.generation.release();
    await env.jobs.drain();
    expect(project.getGeneration(id)!.status).toBe('completed');
  });

  it('nimmt journalisierte Generierungen nach einem Neustart wieder auf', async () => {
    await approveBudget(5);
    const base = { endpointId: 'minimax/h3-max/text-to-video', modality: 'video' as const, input: { prompt: 'x' }, purpose: 'P', estimateUsd: 0.8, checkpointId: 'cp_1_treatment', inputAssetIds: [], outputAssetIds: [], createdAt: '2026-10-01T00:00:00.000Z' };
    await project.saveGeneration({ ...base, id: 'gen_a', status: 'running', requestId: 'req_a' });
    await project.budgetReserve('gen_a', 0.8, { checkpointId: 'cp_1_treatment' });
    await project.saveGeneration({ ...base, id: 'gen_b', status: 'queued' });
    await project.budgetReserve('gen_b', 0.8, { checkpointId: 'cp_1_treatment' });
    const result = await env.jobs.resumePending();
    expect(result).toEqual({ resumed: ['gen_a'], failed: ['gen_b'] });
    await env.jobs.drain();
    expect(project.getGeneration('gen_a')!.status).toBe('completed');
    expect(project.getGeneration('gen_a')!.outputAssetIds).toHaveLength(1);
    expect(project.getGeneration('gen_b')!.status).toBe('failed');
    expect(project.budgetSummary().reservedUsd).toBe(0);
  });
});
