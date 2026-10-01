import { describe, expect, it } from 'vitest';
import { createCheckpoints, type Asset, type BudgetSummary, type ChatMessage, type Generation, type ProjectManifest, type StudioEvent, type StudioEventType } from '@studio/core';
import { reduceEvent } from '../src/renderer/state/reducer.ts';
import { initialData, type StudioData } from '../src/renderer/state/types.ts';

const P = 'prj_1';
const NOW = '2026-10-01T12:00:00.000Z';

function base(patch: Partial<StudioData> = {}): StudioData {
  return { ...initialData(), projectId: P, ...patch };
}

const message = (id: string, text: string, role: ChatMessage['role'] = 'director'): ChatMessage => ({ id, role, text, createdAt: NOW });

const manifest: ProjectManifest = {
  schema: 'director-studio/project@1',
  id: P,
  title: 'Test',
  category: 'video',
  createdAt: NOW,
  updatedAt: NOW,
  formats: [],
  brief: null,
  pickers: {},
  checkpoints: createCheckpoints('video'),
  budgetApprovals: [],
  director: { effort: 'xhigh' },
  phase: 'planning',
};

/** Jede Ereignisart wird hier abgedeckt (Typprüfung über `satisfies`). */
const covered = {
  message: true,
  message_delta: true,
  progress: true,
  tool: true,
  question: true,
  question_resolved: true,
  approval: true,
  approval_resolved: true,
  checkpoints: true,
  budget: true,
  document: true,
  asset: true,
  generation: true,
  run_state: true,
  manifest: true,
  preview_pick: true,
  preview_state: true,
} satisfies Record<StudioEventType, true>;

describe('reduceEvent', () => {
  it('deckt alle Ereignisarten ab', () => {
    expect(Object.keys(covered)).toHaveLength(17);
  });

  it('ignoriert Ereignisse anderer Projekte und ohne offenes Projekt', () => {
    const event: StudioEvent = { type: 'budget', projectId: 'other', summary: {} as BudgetSummary };
    expect(reduceEvent(base(), event)).toBeNull();
    expect(reduceEvent({ ...initialData() }, { ...event, projectId: P })).toBeNull();
  });

  it('message: fügt an, ersetzt gleiche ID und beendet das Streaming', () => {
    const state = base({ messages: [message('m1', 'alt')], streaming: { m2: 'Hal' } });
    const a = reduceEvent(state, { type: 'message', projectId: P, message: message('m2', 'Hallo') })!;
    expect(a.messages!.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(a.streaming).toEqual({});
    const b = reduceEvent(state, { type: 'message', projectId: P, message: message('m1', 'neu') })!;
    expect(b.messages).toEqual([message('m1', 'neu')]);
  });

  it('message_delta: hängt Text an; ignoriert Deltas fertiger Nachrichten', () => {
    const state = base({ streaming: { m1: 'Hal' } });
    expect(reduceEvent(state, { type: 'message_delta', projectId: P, messageId: 'm1', delta: 'lo' })!.streaming).toEqual({ m1: 'Hallo' });
    expect(reduceEvent(state, { type: 'message_delta', projectId: P, messageId: 'm9', delta: 'x' })!.streaming).toEqual({ m1: 'Hal', m9: 'x' });
    expect(reduceEvent(base({ messages: [message('m1', 'fertig')] }), { type: 'message_delta', projectId: P, messageId: 'm1', delta: 'x' })).toBeNull();
  });

  it('progress: sammelt Fortschrittsnotizen mit Zeitstempel', () => {
    const patch = reduceEvent(base(), { type: 'progress', projectId: P, runId: 'r1', text: 'Rendere …' }, NOW)!;
    expect(patch.progress).toEqual([{ id: 'r1:0', runId: 'r1', text: 'Rendere …', at: NOW }]);
  });

  it('tool: fügt Aktivitäten hinzu bzw. aktualisiert sie', () => {
    const started = { id: 'a1', runId: 'r1', name: 'generate', status: 'started' as const, startedAt: NOW };
    const s1 = reduceEvent(base(), { type: 'tool', projectId: P, activity: started })!;
    const s2 = reduceEvent(base(s1), { type: 'tool', projectId: P, activity: { ...started, status: 'finished', summary: 'ok' } })!;
    expect(s2.activities).toEqual([{ ...started, status: 'finished', summary: 'ok' }]);
  });

  it('question / question_resolved', () => {
    const questions = [{ id: 'q1', question: 'Wie?', options: [{ label: 'So' }] }];
    const s1 = reduceEvent(base(), { type: 'question', projectId: P, runId: 'r1', questionId: 'qq', questions })!;
    expect(s1.question).toEqual({ questionId: 'qq', questions, runId: 'r1' });
    expect(reduceEvent(base(s1), { type: 'question_resolved', projectId: P, questionId: 'andere' })).toBeNull();
    expect(reduceEvent(base(s1), { type: 'question_resolved', projectId: P, questionId: 'qq' })!.question).toBeNull();
  });

  it('approval / approval_resolved', () => {
    const request = { id: 'ap1', kind: 'budget' as const, title: 'Mehr Budget', detail: '…', amountUsd: 5, createdAt: NOW };
    const s1 = reduceEvent(base(), { type: 'approval', projectId: P, request })!;
    expect(s1.approvals).toEqual([request]);
    expect(reduceEvent(base(s1), { type: 'approval_resolved', projectId: P, approvalId: 'ap1', approved: true })!.approvals).toEqual([]);
  });

  it('checkpoints: ersetzt die Liste (auch im Manifest)', () => {
    const checkpoints = createCheckpoints('video').map((c, i) => (i === 0 ? { ...c, status: 'proposed' as const } : c));
    const patch = reduceEvent(base({ manifest }), { type: 'checkpoints', projectId: P, checkpoints })!;
    expect(patch.checkpoints).toBe(checkpoints);
    expect(patch.manifest!.checkpoints).toBe(checkpoints);
  });

  it('budget: übernimmt die Zusammenfassung', () => {
    const summary: BudgetSummary = { approvedUsd: 10, spentUsd: 2, reservedUsd: 1, availableUsd: 7, bySource: { fal: 2, director: 0, other: 0 }, byCheckpoint: {} };
    expect(reduceEvent(base(), { type: 'budget', projectId: P, summary })!.budget).toBe(summary);
  });

  it('document: ergänzt die Versionsliste sortiert (Dokument lädt der Store nach)', () => {
    const v = (number: number) => ({ number, parentNumber: number - 1 || null, note: `v${number}`, author: 'director' as const, createdAt: NOW, opsCount: 1 });
    const patch = reduceEvent(base({ versions: [v(1), v(3)] }), { type: 'document', projectId: P, version: v(2) })!;
    expect(patch.versions!.map((x) => x.number)).toEqual([1, 2, 3]);
  });

  it('asset / generation: einfügen und aktualisieren', () => {
    const asset: Asset = { id: 'ast1', kind: 'image', title: 'A', tags: [], status: 'active', source: 'generated', createdAt: NOW };
    const s1 = reduceEvent(base(), { type: 'asset', projectId: P, asset })!;
    expect(reduceEvent(base(s1), { type: 'asset', projectId: P, asset: { ...asset, title: 'B' } })!.assets).toEqual([{ ...asset, title: 'B' }]);
    const gen: Generation = { id: 'g1', endpointId: 'x/y', modality: 'image', status: 'queued', input: {}, purpose: 'p', estimateUsd: 0.1, inputAssetIds: [], outputAssetIds: [], createdAt: NOW };
    const g1 = reduceEvent(base(), { type: 'generation', projectId: P, generation: gen })!;
    expect(reduceEvent(base(g1), { type: 'generation', projectId: P, generation: { ...gen, status: 'completed' } })!.generations).toEqual([{ ...gen, status: 'completed' }]);
  });

  it('run_state: setzt Status/Fehler und übernimmt verwaiste Streaming-Texte', () => {
    const running = reduceEvent(base({ streaming: { m1: 'Teil' } }), { type: 'run_state', projectId: P, runId: 'r1', state: 'running' })!;
    expect(running).toEqual({ runState: 'running', runId: 'r1', runError: null });
    const failed = reduceEvent(base({ streaming: { m1: 'Teil' } }), { type: 'run_state', projectId: P, runId: 'r1', state: 'failed', error: 'Netz weg' }, NOW)!;
    expect(failed.runState).toBe('failed');
    expect(failed.runError).toBe('Netz weg');
    expect(failed.streaming).toEqual({});
    expect(failed.messages).toEqual([{ id: 'm1', role: 'director', text: 'Teil', createdAt: NOW, runId: 'r1' }]);
  });

  it('manifest: ersetzt Manifest und Checkpoints', () => {
    const patch = reduceEvent(base(), { type: 'manifest', projectId: P, manifest })!;
    expect(patch.manifest).toBe(manifest);
    expect(patch.checkpoints).toBe(manifest.checkpoints);
  });

  it('preview_pick: fügt die Element-Referenz an der Cursorposition ein', () => {
    const state = base({ composer: [{ type: 'text', text: 'Mach das rot' }], caret: 7 });
    const ref = { kind: 'element' as const, doc: 'site' as const, page: '/', selector: 'h1' };
    const patch = reduceEvent(state, { type: 'preview_pick', projectId: P, ref, label: 'Überschrift' })!;
    expect(patch.composer).toEqual([
      { type: 'text', text: 'Mach da' },
      { type: 'ref', ref },
      { type: 'text', text: 's rot' },
    ]);
    expect(patch.caret).toBe(8);
    expect(patch.composerRevision).toBe(1);
  });

  it('preview_state: übernimmt URL/Status/Fehler', () => {
    expect(reduceEvent(base(), { type: 'preview_state', projectId: P, url: 'http://127.0.0.1:5173', status: 'ready' })!.preview).toEqual({
      url: 'http://127.0.0.1:5173',
      status: 'ready',
      error: null,
    });
    expect(reduceEvent(base(), { type: 'preview_state', projectId: P, url: null, status: 'error', error: 'Port belegt' })!.preview).toEqual({
      url: null,
      status: 'error',
      error: 'Port belegt',
    });
  });
});
