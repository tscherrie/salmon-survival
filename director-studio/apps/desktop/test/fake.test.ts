import { describe, expect, it } from 'vitest';
import type { StudioEvent } from '@studio/core';
import { FakeStudioApi } from '../src/renderer/fake/FakeStudioApi.ts';
import { DEMO_VIDEO_ID, DEMO_VIDEO_PATH } from '../src/renderer/fake/demoProjects.ts';

function record(api: FakeStudioApi): StudioEvent[] {
  const events: StudioEvent[] = [];
  api.onEvent((e) => events.push(e));
  return events;
}

describe('FakeStudioApi', () => {
  it('liefert Demo-Projekte jeder Kategorie mit echten Core-Dokumenten', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const recent = await api.listRecentProjects();
    expect(recent.map((r) => r.category).sort()).toEqual(['audio', 'graphic', 'slides', 'video', 'web']);
    const snap = await api.openProject(DEMO_VIDEO_PATH);
    expect(snap.document.kind).toBe('timeline');
    expect(snap.versions.map((v) => v.number)).toEqual([1, 2, 3]);
    expect(snap.usedAssetIds).toContain('ast_song');
    expect(snap.assets.map((a) => a.kind)).toEqual(expect.arrayContaining(['image', 'video', 'audio', 'text', 'code', 'data', 'font', 'web']));
    expect(api.assetUrl(DEMO_VIDEO_ID, 'ast_sb_01', 'thumb')).toMatch(/^data:image\/svg\+xml/);
    expect(api.assetUrl(DEMO_VIDEO_ID, 'ast_song')).toMatch(/^data:audio\/wav;base64,UklGR/);
    const peaks = await api.assetPeaks(DEMO_VIDEO_ID, 'ast_song');
    expect(peaks!.durationMs).toBe(60_000);
    expect(peaks!.peaks.length % 2).toBe(0);
    expect(await api.assetPeaks(DEMO_VIDEO_ID, 'ast_char_mira')).toBeNull();
    const models = await api.listModels('video');
    expect(models.find((m) => m.recommended)?.id).toBe('minimax/h3-max/text-to-video');
  });

  it('geskripteter Director: Planung → Rückfrage → Checkpoint → Freigabe → neue Version', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const events = record(api);
    await api.sendMessage(DEMO_VIDEO_ID, { segments: [{ type: 'text', text: 'Mach das ' }, { type: 'ref', ref: { kind: 'time', frame: 372 } }] });
    await api.debug.whenIdle(DEMO_VIDEO_ID);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('message');
    expect(types).toContain('message_delta');
    expect(types).toContain('tool');
    const question = events.find((e) => e.type === 'question');
    expect(question).toBeDefined();
    const director = events.filter((e) => e.type === 'message' && e.message.role === 'director').at(-1);
    expect(director && director.type === 'message' && director.message.text).toContain('00:12.400');
    expect(events.at(-1)).toMatchObject({ type: 'run_state', state: 'waiting_user' });

    events.length = 0;
    await api.answerQuestion(DEMO_VIDEO_ID, (question as { questionId: string }).questionId, { q_platform: 'Beides', q_style: 'Neon-Noir' });
    await api.debug.whenIdle(DEMO_VIDEO_ID);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['question_resolved', 'progress', 'asset', 'checkpoints']));
    const snap = await api.getSnapshot(DEMO_VIDEO_ID);
    const proposed = snap.checkpoints.find((c) => c.status === 'proposed')!;
    expect(proposed.id).toBe('cp_1_treatment');
    expect(proposed.budgetRequestedUsd).toBe(12.5);

    events.length = 0;
    await api.decideCheckpoint(DEMO_VIDEO_ID, proposed.id, { decision: 'approve', budgetApprovedUsd: 15 });
    await api.debug.whenIdle(DEMO_VIDEO_ID);
    const doc = events.find((e) => e.type === 'document');
    expect(doc && doc.type === 'document' && doc.version.number).toBe(4);
    expect(events.filter((e) => e.type === 'generation').map((e) => (e.type === 'generation' ? e.generation.status : ''))).toEqual(['queued', 'running', 'completed']);
    const after = await api.getSnapshot(DEMO_VIDEO_ID);
    expect(after.manifest.phase).toBe('production');
    expect(after.budget.approvedUsd).toBe(20);
    expect(after.budget.bySource.fal).toBeCloseTo(1.82);
    expect(after.runState).toBe('idle');
    const v4 = await api.getVersion(DEMO_VIDEO_ID, 4);
    expect(v4.document.kind === 'timeline' && v4.document.markers.some((m) => m.kind === 'checkpoint')).toBe(true);
  });

  it('Produktion: Zeit-Referenz → Notiz-Marker als neue Version; „4K“ → Genehmigung', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const p = api.debug.project(DEMO_VIDEO_ID);
    p.manifest.phase = 'production';
    const events = record(api);
    await api.sendMessage(DEMO_VIDEO_ID, { segments: [{ type: 'ref', ref: { kind: 'time', frame: 600 } }, { type: 'text', text: ' bitte in 4K' }] });
    await api.debug.whenIdle(DEMO_VIDEO_ID);
    expect(events.some((e) => e.type === 'document' && e.version.number === 4)).toBe(true);
    const approval = events.find((e) => e.type === 'approval');
    expect(approval).toBeDefined();
    expect(events.at(-1)).toMatchObject({ type: 'run_state', state: 'waiting_user' });
    await api.decideApproval(DEMO_VIDEO_ID, (approval as { request: { id: string } }).request.id, true);
    await api.debug.whenIdle(DEMO_VIDEO_ID);
    expect((await api.getSnapshot(DEMO_VIDEO_ID)).pendingApprovals).toEqual([]);
  });

  it('Unterbrechen beendet den Lauf und übernimmt den bisherigen Text', async () => {
    const api = new FakeStudioApi({ delayMs: 5 });
    const events = record(api);
    await api.sendMessage(DEMO_VIDEO_ID, { segments: [{ type: 'text', text: 'Hallo' }] });
    await new Promise((r) => setTimeout(r, 40));
    await api.interrupt(DEMO_VIDEO_ID);
    await api.debug.whenIdle(DEMO_VIDEO_ID);
    expect(events.at(-1)).toMatchObject({ type: 'run_state', state: 'interrupted' });
    const count = events.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(events.length).toBe(count);
  });

  it('Projekt ohne Kategorie: der Director klärt sie im Gespräch und legt das Dokument an', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const snap = await api.createProject({ title: 'Offen', category: null });
    expect(snap.document).toBeNull();
    const id = snap.manifest.id;
    const events = record(api);
    await api.sendMessage(id, { segments: [{ type: 'text', text: 'Ich brauche etwas für den Sommer' }] });
    await api.debug.whenIdle(id);
    const question = events.find((e) => e.type === 'question');
    expect(question && question.type === 'question' && question.questions[0]!.id).toBe('q_category');
    await api.answerQuestion(id, (question as { questionId: string }).questionId, { q_category: 'Präsentation', q_platform: 'Beides', q_style: 'Analogfilm' });
    await api.debug.whenIdle(id);
    const after = await api.getSnapshot(id);
    expect(after.manifest.category).toBe('slides');
    expect(after.document.kind).toBe('deck');
  });

  it('Versionen wiederherstellen, Dateien importieren, Transkription, Anmeldestatus', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    await api.restoreVersion(DEMO_VIDEO_ID, 1);
    const snap = await api.getSnapshot(DEMO_VIDEO_ID);
    expect(snap.versions.at(-1)).toMatchObject({ number: 4, restoredFrom: 1, author: 'user' });
    const imported = await api.importFiles(DEMO_VIDEO_ID, ['/x/Voice.wav', '/x/Foto.png'], 'link');
    expect(imported.map((a) => [a.kind, a.source, a.title])).toEqual([
      ['audio', 'linked', 'Voice'],
      ['image', 'linked', 'Foto'],
    ]);
    const result = await api.transcribe(DEMO_VIDEO_ID, new ArrayBuffer(4), 'audio/webm');
    expect(result.words.length).toBeGreaterThan(3);
    expect(result.words[0]!.start).toBeLessThan(result.words[1]!.start);
    expect((await api.getAuthStatus()).active).toBe('anthropic');
    await api.setSecret('anthropic', null);
    await api.updateSettings({ allowClaudeSubscription: true });
    expect((await api.getAuthStatus()).active).toBe('agent-sdk');
    await api.updateSettings({ preferredRuntime: 'fal' });
    expect((await api.getAuthStatus()).active).toBe('agent-sdk'); // fal ohne Key nicht verfügbar
    await api.setSecret('fal', 'xyz');
    expect((await api.getAuthStatus())).toMatchObject({ active: 'fal', falConfigured: true });
  });

  it('Stresstest-Projekt: 5 Minuten, ~200 Clips, ~640 Beats', async () => {
    const api = new FakeStudioApi({ delayMs: 0, seed: false });
    const path = await api.debug.createLargeProject();
    const snap = await api.openProject(path);
    expect(snap.document.kind).toBe('timeline');
    if (snap.document.kind !== 'timeline') return;
    expect(snap.document.durationFrames).toBe(9000);
    expect(snap.document.tracks.reduce((n, t) => n + t.clips.length, 0)).toBe(201);
    expect(snap.document.markers.filter((m) => m.kind === 'beat' || m.kind === 'downbeat').length).toBe(640);
  });
});
