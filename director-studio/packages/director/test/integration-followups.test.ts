import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectStore } from '@studio/project';
import {
  buildDirectorTools,
  DIRECTOR_SYSTEM_PROMPT,
  generateTool,
  InteractiveUi,
  opsSchemaFor,
  resultText,
  type AnyDirectorTool,
} from '../src/index.ts';
import { OPS_SCHEMA_LIMIT } from '../src/tools/documents.ts';
import { stableJson } from '../src/util.ts';
import { createProject, makeEnv, tempRoot } from './helpers.ts';

let root: string;
let cleanup: () => Promise<void>;
let project: ProjectStore;

beforeEach(async () => {
  ({ root, cleanup } = await tempRoot());
  project = await createProject(root, 'video');
});

afterEach(async () => {
  await project.close();
  await cleanup();
});

function tool(name: string): AnyDirectorTool {
  return buildDirectorTools({ webFallback: true, delegate: true }).find((t) => t.name === name)!;
}

async function approveBudget(amount: number) {
  await project.updateManifest((m) => {
    m.checkpoints = m.checkpoints.map((c) => (c.id === 'cp_1_treatment' ? { ...c, status: 'approved', budgetApprovedUsd: amount } : c));
  });
  await project.approveBudget('cp_1_treatment', amount);
}

// ───────────────────────── merge_checkpoints ─────────────────────────

describe('merge_checkpoints', () => {
  it('legt offene Checkpoints zusammen, speichert und meldet die neue Liste', async () => {
    const env = makeEnv(project);
    const [, second, third] = project.manifest.checkpoints;
    const before = project.manifest.checkpoints.length;
    const res = await tool('merge_checkpoints').run({ ids: [third!.id, second!.id], title: 'Style Bible & Storyboard' }, env.ctx);
    expect(res.isError).toBeFalsy();
    const list = project.manifest.checkpoints;
    expect(list).toHaveLength(before - 1);
    // Behält ID und Position des in der Reihenfolge ersten Checkpoints
    expect(list[1]).toMatchObject({ id: second!.id, title: 'Style Bible & Storyboard', status: 'pending' });
    expect(list.some((c) => c.id === third!.id)).toBe(false);
    expect(list[1]!.mergedFrom).toEqual([{ id: third!.id, kind: third!.kind, title: third!.title }]);
    expect(env.ui.ofType('checkpoints').at(-1)!.checkpoints).toEqual(list);
    expect(resultText(res)).toContain('Style Bible & Storyboard');
  });

  it('lehnt bereits freigegebene Checkpoints und unbekannte IDs ab, ohne zu speichern', async () => {
    const env = makeEnv(project);
    await approveBudget(5);
    const before = project.manifest.checkpoints;
    const approved = await tool('merge_checkpoints').run({ ids: ['cp_1_treatment', before[1]!.id], title: 'X' }, env.ctx);
    expect(approved.isError).toBe(true);
    expect(resultText(approved)).toMatch(/Nur offene Checkpoints/);
    const unknown = await tool('merge_checkpoints').run({ ids: [before[1]!.id, 'cp_gibt_es_nicht'], title: 'X' }, env.ctx);
    expect(unknown.isError).toBe(true);
    expect(project.manifest.checkpoints).toEqual(before);
  });

  it('ist im Werkzeugkasten', () => {
    expect(buildDirectorTools().map((t) => t.name)).toContain('merge_checkpoints');
  });
});

// ───────────────────────── Wiederaufnahme ohne doppelten Ingest ─────────────────────────

describe('resumePending nach Absturz zwischen Ist-Buchung und Journal-Abschluss', () => {
  it('holt nichts erneut ab, sondern schließt das Journal mit den vorhandenen Assets ab', async () => {
    await approveBudget(5);
    const env = makeEnv(project);
    const base = { endpointId: 'minimax/h3-max/text-to-video', modality: 'video' as const, input: { prompt: 'x' }, purpose: 'P', estimateUsd: 0.8, checkpointId: 'cp_1_treatment', inputAssetIds: [], outputAssetIds: [], createdAt: '2026-10-01T00:00:00.000Z' };
    await project.saveGeneration({ ...base, id: 'gen_a', status: 'running', requestId: 'req_a' });
    await project.budgetReserve('gen_a', 0.8, { checkpointId: 'cp_1_treatment' });
    const asset = await project.addAssetFromBuffer('video-bytes', { fileName: 'out.mp4', kind: 'video', source: 'generated', generationId: 'gen_a', title: 'Shot' });
    await project.budgetSettle('gen_a', 0.75, { source: 'fal', checkpointId: 'cp_1_treatment' });
    const assetsBefore = project.allAssets().length;

    const result = await env.jobs.resumePending();
    await env.jobs.drain();

    expect(result).toEqual({ resumed: [], failed: [], recovered: ['gen_a'] });
    expect(env.generation.runs).toHaveLength(0);
    expect(project.allAssets()).toHaveLength(assetsBefore);
    const gen = project.getGeneration('gen_a')!;
    expect(gen).toMatchObject({ status: 'completed', outputAssetIds: [asset.id], costUsd: 0.75 });
    expect(project.budgetSummary().reservedUsd).toBe(0);
    expect(project.ledgerEntries().filter((e) => e.refId === 'gen_a' && e.kind === 'actual')).toHaveLength(1);
    expect(env.ui.ofType('generation').at(-1)!.generation.status).toBe('completed');
  });
});

// ───────────────────────── Projekt während einer Generierung geschlossen ─────────────────────────

describe('Generierung läuft, Projekt wird geschlossen', () => {
  it('endet ohne unbehandelte Ablehnung („Projekt ist geschlossen“)', async () => {
    await approveBudget(5);
    const env = makeEnv(project);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      env.generation.hold();
      const res = await generateTool.run({ endpointId: 'minimax/h3-max/text-to-video', input: { prompt: 'x', duration: 5 }, purpose: 'T' }, env.ctx);
      const id = /Generierung (gen_\d+)/.exec(resultText(res))![1]!;
      await project.close();
      env.generation.release();
      const outcome = await env.jobs.wait(id, 5000);
      await env.jobs.drain();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(outcome?.generation.status).toBe('failed');
      expect(outcome?.generation.error).toMatch(/geschlossen/);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

// ───────────────────────── ops_schema, Patch-Hilfe, Prompt ─────────────────────────

describe('Dokument-Werkzeuge', () => {
  it('ops_schema liefert immer gültiges JSON innerhalb der Grenze', async () => {
    const env = makeEnv(project);
    const res = await tool('get_document').run({ mode: 'ops_schema' }, env.ctx);
    const text = resultText(res);
    expect(text.length).toBeLessThanOrEqual(OPS_SCHEMA_LIMIT);
    expect(() => JSON.parse(text)).not.toThrow();
    // Auch das größte Schema passt kompakt sicher in die Grenze (sonst wäre die Antwort abgeschnitten).
    for (const kind of ['timeline', 'deck', 'canvas', 'site'] as const) {
      expect(stableJson(opsSchemaFor(kind)).length, kind).toBeLessThan(OPS_SCHEMA_LIMIT);
    }
  });

  it('apply_document_ops erklärt null und Merge bei update_*', () => {
    expect(tool('apply_document_ops').description).toMatch(/null löscht ein optionales Feld/);
    expect(tool('apply_document_ops').description).toMatch(/schlüsselweise gemergt/);
  });

  it('Systemprompt und write_site_file nennen die netzlose Vorschau', () => {
    expect(DIRECTOR_SYSTEM_PROMPT).toContain('no outside network');
    expect(tool('write_site_file').description).toMatch(/kein externes Netz/);
  });
});

// ───────────────────────── Lauf-ID an Freigaben ─────────────────────────

describe('InteractiveUi', () => {
  it('trägt die Lauf-ID in die Freigabe-Anfrage ein', async () => {
    const events: Array<{ type: string; request?: { runId?: string } }> = [];
    const ui = new InteractiveUi({ projectId: 'p', emit: (e) => events.push(e as never) });
    const controller = new AbortController();
    const pending = ui.requestApproval({ kind: 'budget', title: 'T', detail: 'D' }, controller.signal, { runId: 'run_7' });
    expect(events.find((e) => e.type === 'approval')!.request!.runId).toBe('run_7');
    expect(ui.pendingApprovals('run_7')[0]!.runId).toBe('run_7');
    ui.decideApproval(ui.pendingApprovals()[0]!.id, true);
    await expect(pending).resolves.toBe(true);
    const without = ui.requestApproval({ kind: 'budget', title: 'T', detail: 'D' }, controller.signal);
    expect('runId' in ui.pendingApprovals()[0]!).toBe(false);
    controller.abort();
    await expect(without).rejects.toThrow();
  });
});
