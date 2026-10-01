import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sequentialIds, type StudioEvent } from '@studio/core';
import type { ProjectStore } from '@studio/project';
import { DirectorSession, FakeTransport, fakeText, fakeToolUse, InteractiveUi, type CanonicalMessage, type TransportRequest } from '../src/index.ts';
import { createProject, FakeCatalog, FakeGeneration, FakeMedia, FakeRender, tempRoot, testClock } from './helpers.ts';

let root: string;
let cleanup: () => Promise<void>;
let project: ProjectStore;

beforeEach(async () => {
  ({ root, cleanup } = await tempRoot());
  project = await createProject(root, null);
});

afterEach(async () => {
  project.close();
  await cleanup();
});

function lastToolResultText(req: TransportRequest): string {
  const last = req.messages.at(-1)!;
  const blocks = last.content as Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
  return blocks
    .filter((b) => b.type === 'tool_result')
    .flatMap((b) => b.content ?? [])
    .map((c) => c.text ?? '')
    .join('\n');
}

function makeSession(transport: FakeTransport, onEvent: (e: StudioEvent, ui: InteractiveUi) => void = () => undefined) {
  const events: StudioEvent[] = [];
  const ids = sequentialIds();
  const clock = testClock();
  const ui: InteractiveUi = new InteractiveUi({
    projectId: project.manifest.id,
    emit: (e) => {
      events.push(e);
      onEvent(e, ui);
    },
    ids,
    clock,
  });
  const session = new DirectorSession({
    project,
    catalog: new FakeCatalog(),
    generation: new FakeGeneration(),
    media: new FakeMedia(),
    render: new FakeRender(),
    ui,
    transport,
    runtimeId: 'anthropic',
    ids,
    clock,
  });
  return { session, ui, events };
}

describe('DirectorSession – Planungsgespräch Ende-zu-Ende', () => {
  it('Nachricht → ask_user → Antwort → set_brief → propose_checkpoint → Abschluss', async () => {
    const transport = new FakeTransport([
      fakeToolUse([{ name: 'ask_user', input: { questions: [{ question: 'Welches Format?', header: 'Format', options: [{ label: '9:16 (Empfehlung)' }, { label: '16:9' }] }] } }], 'Kurze Rückfrage.'),
      (req) => {
        expect(lastToolResultText(req)).toContain('→ 16:9');
        return fakeToolUse([{ name: 'set_brief', input: { goal: 'Musikvideo zu „Rain“', audience: 'Indie-Fans', formats: ['16:9'], category: 'video', budgetUsd: 150 } }]);
      },
      fakeToolUse([{ name: 'create_text_asset', input: { title: 'Treatment v1', subtype: 'treatment', text: '# Rain\nIdee …' } }]),
      (req) => {
        const id = /(ast_\d+)/.exec(lastToolResultText(req))![1]!;
        return fakeToolUse([{ name: 'propose_checkpoint', input: { checkpointId: 'cp_1_treatment', summary: '## Treatment\nRegen als Motiv.', assetIds: [id], budgetRequestedUsd: 40 } }]);
      },
      fakeText('Das Treatment liegt zur Freigabe bereit.'),
    ]);
    const { session, events } = makeSession(transport, (e, ui) => {
      if (e.type === 'question') setTimeout(() => ui.answerQuestion(e.questionId, { q1: '16:9' }), 0);
    });

    await session.send({ segments: [{ type: 'text', text: 'Ich will ein Musikvideo zu meinem Song.' }] });

    // Projektzustand
    const manifest = project.manifest;
    expect(manifest.phase).toBe('production');
    expect(manifest.category).toBe('video');
    expect(manifest.brief?.goal).toBe('Musikvideo zu „Rain“');
    expect(manifest.checkpoints[0]).toMatchObject({ id: 'cp_1_treatment', status: 'proposed', budgetRequestedUsd: 40 });
    expect(session.state).toBe('idle');

    // Gesprächsverlauf
    const messages = await project.listMessages();
    expect(messages.map((m) => m.role)).toEqual(['user', 'director']);
    expect(messages[1]!.text).toBe('Kurze Rückfrage.\n\nDas Treatment liegt zur Freigabe bereit.');

    // Erste Anfrage: User-Turn + Kontext (Planungsphase) als Mid-Conversation-System-Message
    const first = transport.requests[0]!;
    expect(first.messages.map((m) => m.role)).toEqual(['user', 'system']);
    const context = first.messages[1]!.content as string;
    expect(context).toContain('<phase>');
    expect(context).toContain('PLANNING');
    expect(context).toContain('<skills_index>');
    expect(first.system).toContain('# Studio mechanics');
    expect(first.effort).toBe('xhigh');
    expect(first.model).toBe('claude-opus-5-5');

    // Ereignisfolge
    const types = events.map((e) => e.type);
    const order = (t: StudioEvent['type']) => types.indexOf(t);
    expect(order('message')).toBe(0);
    expect(types[1]).toBe('run_state');
    expect(order('question')).toBeGreaterThan(order('run_state'));
    expect(order('question_resolved')).toBeGreaterThan(order('question'));
    expect(order('manifest')).toBeGreaterThan(order('question_resolved'));
    expect(order('checkpoints')).toBeGreaterThan(order('question_resolved'));
    const states = events.filter((e): e is Extract<StudioEvent, { type: 'run_state' }> => e.type === 'run_state').map((e) => e.state);
    expect(states).toEqual(['running', 'waiting_user', 'running', 'idle']);
    const tools = events.filter((e): e is Extract<StudioEvent, { type: 'tool' }> => e.type === 'tool').map((e) => `${e.activity.name}:${e.activity.status}`);
    expect(tools).toEqual([
      'ask_user:started',
      'ask_user:finished',
      'set_brief:started',
      'set_brief:finished',
      'create_text_asset:started',
      'create_text_asset:finished',
      'propose_checkpoint:started',
      'propose_checkpoint:finished',
    ]);
    expect(events.some((e) => e.type === 'message_delta')).toBe(true);
    expect(events.some((e) => e.type === 'asset')).toBe(true);
    expect(events.some((e) => e.type === 'document')).toBe(true);
    expect(events.filter((e) => e.type === 'budget').length).toBeGreaterThan(0);
    const lastCheckpoints = events.filter((e): e is Extract<StudioEvent, { type: 'checkpoints' }> => e.type === 'checkpoints').at(-1)!;
    expect(lastCheckpoints.checkpoints[0]!.status).toBe('proposed');

    // LLM-Kosten gebucht
    expect(project.budgetSummary().bySource.director).toBeGreaterThan(0);

    // Transkript persistiert (append-only JSONL) und beim nächsten Start geladen
    const transcript = await project.readTranscript<{ type: string; message: CanonicalMessage }>('anthropic');
    expect(transcript.map((e) => e.message.role)).toEqual(['user', 'system', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant']);

    // Folge-Turn: nur geänderte Kontextblöcke (Phase ist jetzt PRODUCTION)
    transport.push(fakeText('Gern.'));
    await session.send({ segments: [{ type: 'text', text: 'Danke!' }] });
    const followUp = transport.requests.at(-1)!;
    const ctx2 = followUp.messages.at(-1)!.content as string;
    expect(followUp.messages.at(-1)!.role).toBe('system');
    expect(ctx2).toContain('PRODUCTION');
    expect(ctx2).not.toContain('<skills_index>');
  });

  it('Referenzen werden aufgelöst und Bilder angehängt', async () => {
    const videoProject = project;
    await videoProject.setCategory('video');
    await videoProject.commitOps([{ op: 'update_timeline', patch: { durationFrames: 600 } }], { note: 'd', author: 'director' });
    const transport = new FakeTransport([fakeText('Ok.')]);
    const { session } = makeSession(transport);
    await session.send({ segments: [{ type: 'text', text: 'Mach ' }, { type: 'ref', ref: { kind: 'time', frame: 372 } }, { type: 'text', text: ' dunkler' }] });
    const user = transport.requests[0]!.messages[0]!;
    const blocks = user.content as Array<{ type: string; text?: string }>;
    expect(blocks[0]!.text).toContain('<ref id="r1" type="time" t="00:12.400" frame="372"/>');
    expect(blocks[0]!.text).toContain('<ref_context id="r1">');
    expect(blocks[1]!.text).toContain('[Bild zu r1');
    expect(blocks[2]!.type).toBe('image');
    const chat = (await project.listMessages())[0]!;
    expect(chat.text).toBe('Mach [⏱ 00:12.400] dunkler');
    expect(chat.segments).toHaveLength(3);
  });

  it('reiht Nachrichten während eines Turns ein und kann unterbrechen', async () => {
    const transport = new FakeTransport([{ hang: true }, fakeText('Zweite Antwort.')]);
    const { session, events } = makeSession(transport);
    const first = session.send({ segments: [{ type: 'text', text: 'Erste' }] });
    await vi.waitFor(() => expect(session.state).toBe('running'));
    const second = session.send({ segments: [{ type: 'text', text: 'Zweite' }] });
    // Beide Nutzernachrichten sind sofort persistiert
    await vi.waitFor(async () => expect((await project.listMessages()).filter((m) => m.role === 'user')).toHaveLength(2));
    expect(transport.requests).toHaveLength(1);
    session.interrupt();
    await first;
    await second;
    const states = events.filter((e): e is Extract<StudioEvent, { type: 'run_state' }> => e.type === 'run_state').map((e) => e.state);
    expect(states).toEqual(['running', 'interrupted', 'running', 'idle']);
    expect(transport.requests).toHaveLength(2);
    // Transkript nach Unterbrechung gültig: user, system, assistant(synthetisch), user, …
    const roles = transport.requests[1]!.messages.map((m) => m.role);
    expect(roles.slice(0, 4)).toEqual(['user', 'system', 'assistant', 'user']);
  });

  it('notify startet einen Turn mit Operator-Ereignis, Rückfrage-Abbruch bei Unterbrechung', async () => {
    const transport = new FakeTransport([fakeText('Danke für die Freigabe.')]);
    const { session } = makeSession(transport);
    await session.notify('Checkpoint „Treatment“ freigegeben, Budget $40.');
    const content = transport.requests[0]!.messages[0]!.content as Array<{ text: string }>;
    expect(content[0]!.text).toContain('<studio_event>');
    expect((await project.listMessages()).map((m) => m.role)).toEqual(['director']);

    transport.push(fakeToolUse([{ name: 'ask_user', input: { questions: [{ question: 'A oder B?', options: [{ label: 'A' }, { label: 'B' }] }] } }]), fakeText('ok'));
    const { session: s2, events } = makeSession(transport);
    const running = s2.send({ segments: [{ type: 'text', text: 'Frag mich' }] });
    await vi.waitFor(() => expect(events.some((e) => e.type === 'question')).toBe(true));
    expect(s2.state).toBe('waiting_user');
    s2.interrupt();
    await running;
    expect(events.some((e) => e.type === 'question_resolved')).toBe(true);
    expect(s2.state).toBe('interrupted');
  });

  it('delegate startet einen Subagenten auf günstigerem Modell mit nur lesenden Tools', async () => {
    const transport = new FakeTransport([
      fakeToolUse([{ name: 'delegate', input: { task: 'Prüfe alle Assets.', model: 'claude-sonnet-5-5', tools: ['search_assets'] } }]),
      fakeToolUse([{ name: 'search_assets', input: {} }]),
      fakeText('Alles geprüft: keine Assets.'),
      (req) => {
        expect(lastToolResultText(req)).toContain('Alles geprüft');
        return fakeText('Der Subagent meldet: keine Assets.');
      },
    ]);
    const { session } = makeSession(transport);
    await session.send({ segments: [{ type: 'text', text: 'QA bitte' }] });
    const sub = transport.requests[1]!;
    expect(sub.model).toBe('claude-sonnet-5-5');
    expect(sub.toolNames).toEqual(['search_assets']);
    expect(sub.system).toContain('focused assistant');
    expect(sub.messages[0]!.content).toEqual([{ type: 'text', text: 'Prüfe alle Assets.' }]);
    const entries = project.ledgerEntries().filter((e) => e.source === 'director');
    expect(entries.some((e) => e.note?.startsWith('delegate'))).toBe(true);
  });

  it('decideCheckpoint bucht das Budget und informiert den Director', async () => {
    await project.setCategory('video');
    await project.updateManifest((m) => {
      m.checkpoints = m.checkpoints.map((c) => (c.id === 'cp_1_treatment' ? { ...c, status: 'proposed', budgetRequestedUsd: 40 } : c));
    });
    const transport = new FakeTransport([fakeText('Danke, ich starte die Style Bible.')]);
    const { session, events } = makeSession(transport);
    await session.decideCheckpoint('cp_1_treatment', { decision: 'approve' });
    expect(project.manifest.checkpoints[0]).toMatchObject({ status: 'approved', budgetApprovedUsd: 40 });
    expect(project.budgetSummary().byCheckpoint.cp_1_treatment!.approvedUsd).toBe(40);
    expect(events.some((e) => e.type === 'checkpoints')).toBe(true);
    const content = transport.requests[0]!.messages[0]!.content as Array<{ text: string }>;
    expect(content[0]!.text).toContain('freigegeben – Budget $40.00');
    const ctx = transport.requests[0]!.messages[1]!.content as string;
    expect(ctx).toContain('Aktiver Budget-Checkpoint: cp_1_treatment');

    transport.push(fakeText('Verstanden.'));
    await project.updateManifest((m) => {
      m.checkpoints = m.checkpoints.map((c) => (c.id === 'cp_2_style_bible' ? { ...c, status: 'proposed' } : c));
    });
    await session.decideCheckpoint('cp_2_style_bible', { decision: 'request_changes', feedback: 'Wärmere Farben' });
    expect(JSON.stringify(transport.requests[1]!.messages.at(-2))).toContain('Wärmere Farben');
  });

  it('meldet Konfigurationsfehler als failed', async () => {
    const ids = sequentialIds();
    const events: StudioEvent[] = [];
    const ui = new InteractiveUi({ projectId: project.manifest.id, emit: (e) => events.push(e), ids });
    const session = new DirectorSession({ project, catalog: new FakeCatalog(), generation: new FakeGeneration(), ui, runtimeId: 'x', ids });
    await session.send({ segments: [{ type: 'text', text: 'Hallo' }] });
    expect(session.state).toBe('failed');
    expect((await project.listMessages()).at(-1)!.text).toContain('Transport fehlt');
  });
});
