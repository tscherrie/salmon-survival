import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ProjectStore } from '@studio/project';
import {
  defineTool,
  DirectorLoop,
  estimateTokens,
  FakeTransport,
  fakeText,
  fakeToolUse,
  MemoryTranscriptStore,
  projectTranscriptStore,
  textResult,
  usage,
  type AnyDirectorTool,
  type CanonicalMessage,
  type LoopEvent,
} from '../src/index.ts';
import { createProject, makeEnv, tempRoot, type TestEnv } from './helpers.ts';

let root: string;
let cleanup: () => Promise<void>;
let project: ProjectStore;
let env: TestEnv;

beforeEach(async () => {
  ({ root, cleanup } = await tempRoot());
  project = await createProject(root, 'video');
  env = makeEnv(project);
});

afterEach(async () => {
  project.close();
  await cleanup();
});

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const log: string[] = [];
const echoTool = defineTool({
  name: 'echo',
  description: 'Echo',
  input: z.object({ text: z.string() }),
  sideEffect: 'none',
  run: async (args) => {
    log.push(`echo:${args.text}`);
    return textResult(`echo ${args.text}`);
  },
});

function makeLoop(transport: FakeTransport, tools: AnyDirectorTool[], extra: Partial<ConstructorParameters<typeof DirectorLoop>[0]> = {}) {
  const events: LoopEvent[] = [];
  const store = new MemoryTranscriptStore();
  const loop = new DirectorLoop({
    transport,
    tools,
    system: 'SYSTEM',
    model: 'claude-opus-5-5',
    effort: 'xhigh',
    store,
    makeToolContext: (runId, signal) => ({ ...env.ctx, runId, signal }),
    onEvent: (e) => events.push(e),
    recordUsage: (runId, usd, note) => project.budgetRecordUsage(runId, usd, 'director', note),
    ...extra,
  });
  return { loop, events, store };
}

describe('DirectorLoop', () => {
  beforeEach(() => {
    log.length = 0;
  });

  it('beendet einen Text-Turn und bucht die LLM-Kosten', async () => {
    const transport = new FakeTransport([fakeText('Hallo!', { usage: usage(1000, 500, 2000, 100) })]);
    const { loop, events } = makeLoop(transport, [echoTool]);
    const result = await loop.runTurn({ content: 'Hi', runId: 'run_1', signal: new AbortController().signal });
    expect(result).toMatchObject({ stopReason: 'end_turn', text: 'Hallo!', iterations: 1 });
    // 1000×4 + 500×20 + 2000×0.2 + 100×5 = 14900 µ$ → $0.0149
    expect(result.costUsd).toBeCloseTo(0.0149);
    expect(project.budgetSummary().bySource.director).toBeCloseTo(0.0149);
    expect(loop.transcript.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(events.filter((e) => e.type === 'text_delta')).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({ model: 'claude-opus-5-5', system: 'SYSTEM', effort: 'xhigh', toolNames: ['echo'] });
  });

  it('führt parallele Tool-Aufrufe aus und bündelt alle Ergebnisse in EINER User-Nachricht', async () => {
    const transport = new FakeTransport([
      fakeToolUse([
        { name: 'echo', input: { text: 'a' }, id: 'tu_a' },
        { name: 'echo', input: { text: 'b' }, id: 'tu_b' },
        { name: 'unknown_tool', input: {}, id: 'tu_c' },
        { name: 'echo', input: { wrong: 1 }, id: 'tu_d' },
      ]),
      fakeText('Fertig.'),
    ]);
    const { loop, events } = makeLoop(transport, [echoTool]);
    const result = await loop.runTurn({ content: 'Los', runId: 'run_1', signal: new AbortController().signal });
    expect(result.stopReason).toBe('end_turn');
    const msgs = loop.transcript;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const results = msgs[2]!.content as Array<{ type: string; tool_use_id: string; is_error?: boolean; content: Array<{ text: string }> }>;
    expect(results.map((r) => r.type)).toEqual(['tool_result', 'tool_result', 'tool_result', 'tool_result']);
    expect(results.map((r) => r.tool_use_id)).toEqual(['tu_a', 'tu_b', 'tu_c', 'tu_d']);
    expect(results[0]!.content[0]!.text).toBe('echo a');
    expect(results[2]!.is_error).toBe(true);
    expect(results[3]!.is_error).toBe(true);
    expect(results[3]!.content[0]!.text).toContain('Ungültige Eingabe');
    // Der zweite Modellaufruf sieht die Ergebnisse
    expect(transport.requests[1]!.messages).toHaveLength(3);
    expect(events.filter((e) => e.type === 'tool_start')).toHaveLength(4);
    expect(events.filter((e) => e.type === 'tool_end' && !e.ok)).toHaveLength(2);
  });

  it('hält das Transkript append-only (frühere Einträge verändern sich nie)', async () => {
    const transport = new FakeTransport([fakeToolUse([{ name: 'echo', input: { text: 'x' } }]), fakeText('A'), fakeText('B'), fakeToolUse([{ name: 'echo', input: { text: 'y' } }]), fakeText('C')]);
    const { loop, store } = makeLoop(transport, [echoTool]);
    await loop.runTurn({ content: 'eins', context: '<budget>\n$1\n</budget>', runId: 'r1', signal: new AbortController().signal });
    const snapshot = JSON.stringify(loop.transcript);
    const entriesSnapshot = JSON.stringify(store.entries);
    await loop.runTurn({ content: 'zwei', runId: 'r2', signal: new AbortController().signal });
    await loop.runTurn({ content: 'drei', context: '<budget>\n$2\n</budget>', runId: 'r3', signal: new AbortController().signal });
    expect(JSON.stringify(loop.transcript.slice(0, JSON.parse(snapshot).length))).toBe(snapshot);
    expect(JSON.stringify(store.entries).startsWith(entriesSnapshot.slice(0, -1))).toBe(true);
    // Jede Anfrage beginnt mit exakt dem vorherigen Transkript (Präfix)
    for (let i = 1; i < transport.requests.length; i++) {
      const prev = transport.requests[i - 1]!.messages;
      expect(JSON.stringify(transport.requests[i]!.messages.slice(0, prev.length))).toBe(JSON.stringify(prev));
    }
  });

  it('setzt Kontext als Mid-Conversation-System-Message direkt nach den User-Turn', async () => {
    const transport = new FakeTransport([fakeText('ok')]);
    const { loop } = makeLoop(transport, []);
    await loop.runTurn({ content: 'Hallo', context: '<budget>\nfrei\n</budget>', runId: 'r', signal: new AbortController().signal });
    const sent = transport.requests[0]!.messages;
    expect(sent.map((m) => m.role)).toEqual(['user', 'system']);
    expect(sent[1]!.content).toBe('<budget>\nfrei\n</budget>');
  });

  it('ohne Mid-Conversation-System-Messages (fal) kommt der Kontext als <studio-context> in den User-Turn', async () => {
    const transport = new FakeTransport([fakeText('ok')], { id: 'fal', caps: { midConversationSystem: false, serverCompaction: false, serverWebSearch: false } });
    const { loop } = makeLoop(transport, []);
    await loop.runTurn({ content: 'Hallo', context: '<budget>\nfrei\n</budget>', runId: 'r', signal: new AbortController().signal });
    const sent = transport.requests[0]!.messages as CanonicalMessage[];
    expect(sent).toHaveLength(1);
    const blocks = sent[0]!.content as Array<{ type: string; text: string }>;
    expect(blocks[0]!.text).toBe('<studio-context>\n<budget>\nfrei\n</budget>\n</studio-context>');
    expect(blocks[1]!.text).toBe('Hallo');
  });

  it('serialisiert local/paid-Tools, während none-Tools parallel laufen', async () => {
    const order: string[] = [];
    const gate = deferred();
    const slowNone = defineTool({ name: 'slow_none', description: 'x', input: z.object({}), sideEffect: 'none', run: async () => (order.push('none:start'), await gate.promise, order.push('none:end'), textResult('n')) });
    let active = 0;
    let maxActive = 0;
    const local = defineTool({
      name: 'local_op',
      description: 'x',
      input: z.object({ i: z.number() }),
      sideEffect: 'local',
      run: async (args) => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(`local:${args.i}`);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        if (args.i === 2) gate.resolve();
        return textResult('l');
      },
    });
    const transport = new FakeTransport([
      fakeToolUse([
        { name: 'local_op', input: { i: 1 } },
        { name: 'slow_none', input: {} },
        { name: 'local_op', input: { i: 2 } },
      ]),
      fakeText('ok'),
    ]);
    const { loop } = makeLoop(transport, [slowNone, local]);
    await loop.runTurn({ content: 'x', runId: 'r', signal: new AbortController().signal });
    expect(maxActive).toBe(1);
    expect(order.indexOf('none:start')).toBeLessThan(order.indexOf('local:2'));
    expect(order.at(-1)).toBe('none:end');
    const results = loop.transcript[2]!.content as Array<{ tool_use_id: string }>;
    expect(results).toHaveLength(3);
  });

  it('Unterbrechung während eines Tools erzeugt synthetische Fehler-Ergebnisse und ein gültiges Transkript', async () => {
    const started = deferred();
    const blocking = defineTool({
      name: 'blocking',
      description: 'x',
      input: z.object({}),
      sideEffect: 'local',
      run: async () => {
        started.resolve();
        await new Promise(() => undefined);
        return textResult('nie');
      },
    });
    const transport = new FakeTransport([fakeToolUse([{ name: 'blocking', input: {}, id: 'tu_1' }, { name: 'echo', input: { text: 'z' }, id: 'tu_2' }]), fakeText('danach')]);
    const { loop } = makeLoop(transport, [blocking, echoTool]);
    const controller = new AbortController();
    const running = loop.runTurn({ content: 'x', runId: 'r', signal: controller.signal });
    await started.promise;
    controller.abort();
    const result = await running;
    expect(result.stopReason).toBe('interrupted');
    const last = loop.transcript.at(-1)!;
    expect(last.role).toBe('user');
    const results = last.content as Array<{ tool_use_id: string; is_error?: boolean; content: Array<{ text: string }> }>;
    expect(results.map((r) => r.tool_use_id).sort()).toEqual(['tu_1', 'tu_2']);
    const blocked = results.find((r) => r.tool_use_id === 'tu_1')!;
    expect(blocked.is_error).toBe(true);
    expect(blocked.content[0]!.text).toContain('unterbrochen');
    // Nächster Turn funktioniert
    await loop.runTurn({ content: 'weiter', runId: 'r2', signal: new AbortController().signal });
    expect(loop.transcript.at(-1)!.role).toBe('assistant');
  });

  it('Unterbrechung während des Streamings: nach einer System-Message folgt ein synthetischer Assistenten-Turn', async () => {
    const transport = new FakeTransport([{ hang: true }, fakeText('ok')]);
    const { loop } = makeLoop(transport, []);
    const controller = new AbortController();
    const running = loop.runTurn({ content: 'x', context: '<budget>\n1\n</budget>', runId: 'r', signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    expect((await running).stopReason).toBe('interrupted');
    expect(loop.transcript.map((m) => m.role)).toEqual(['user', 'system', 'assistant']);
    await loop.runTurn({ content: 'y', context: '<budget>\n2\n</budget>', runId: 'r2', signal: new AbortController().signal });
    const roles = transport.requests[1]!.messages.map((m) => m.role);
    // Jede System-Message folgt einem User-Turn und wird von einem Assistenten-Turn gefolgt bzw. ist die letzte
    roles.forEach((role, i) => {
      if (role === 'system') {
        expect(roles[i - 1]).toBe('user');
        expect(i === roles.length - 1 || roles[i + 1] === 'assistant').toBe(true);
      }
    });
  });

  it('pause_turn wird fortgesetzt, max_tokens mit Tool-Aufruf führt das Tool nicht aus', async () => {
    const transport = new FakeTransport([
      { content: [{ type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'x' } }], stopReason: 'pause_turn', usage: usage() },
      { ...fakeToolUse([{ name: 'echo', input: { text: 'abgeschnitten' }, id: 'tu_cut' }]), stopReason: 'max_tokens' },
      fakeText('Fertig'),
    ]);
    const { loop } = makeLoop(transport, [echoTool]);
    const result = await loop.runTurn({ content: 'x', runId: 'r', signal: new AbortController().signal });
    expect(result.stopReason).toBe('end_turn');
    expect(result.iterations).toBe(3);
    expect(log).toEqual([]);
    const cut = loop.transcript[3]!.content as Array<{ type: string; is_error?: boolean; tool_use_id?: string; text?: string }>;
    expect(cut[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_cut', is_error: true });
    expect(cut[1]!.type).toBe('text');
  });

  it('Refusal: keine Tools, Hinweis, Turn wird sauber abgeschlossen', async () => {
    const transport = new FakeTransport([{ ...fakeToolUse([{ name: 'echo', input: { text: 'nein' } }]), stopReason: 'refusal', stopDetails: { category: 'cyber' } }]);
    const { loop, events } = makeLoop(transport, [echoTool]);
    const result = await loop.runTurn({ content: 'x', runId: 'r', signal: new AbortController().signal });
    expect(result.stopReason).toBe('refusal');
    expect(log).toEqual([]);
    expect(events.some((e) => e.type === 'notice' && e.text.includes('cyber'))).toBe(true);
    expect(loop.transcript.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(loop.transcript[1])).not.toContain('tool_use');
  });

  it('stoppt am Schrittlimit und an der Kostenbremse', async () => {
    const many = Array.from({ length: 5 }, () => fakeToolUse([{ name: 'echo', input: { text: 'n' } }]));
    const { loop } = makeLoop(new FakeTransport(many), [echoTool], { maxIterations: 3 });
    expect((await loop.runTurn({ content: 'x', runId: 'r', signal: new AbortController().signal })).stopReason).toBe('max_iterations');
    const expensive = Array.from({ length: 5 }, () => ({ ...fakeToolUse([{ name: 'echo', input: { text: 'n' } }]), costUsd: 3 }));
    const { loop: loop2 } = makeLoop(new FakeTransport(expensive), [echoTool], { maxTurnCostUsd: 5 });
    const r2 = await loop2.runTurn({ content: 'x', runId: 'r', signal: new AbortController().signal });
    expect(r2.stopReason).toBe('budget');
    expect(r2.costUsd).toBe(6);
  });

  it('stellt die Anfrage nach unverarbeitbarer Antwort (eager JSON) begrenzt erneut', async () => {
    const retryable = Object.assign(new Error('Unexpected end of JSON input'), { retryable: true });
    const { loop } = makeLoop(new FakeTransport([{ error: retryable }, fakeText('zweiter Versuch')]), []);
    const ok = await loop.runTurn({ content: 'x', runId: 'r', signal: new AbortController().signal });
    expect(ok).toMatchObject({ stopReason: 'end_turn', text: 'zweiter Versuch', iterations: 2 });
    const { loop: loop2 } = makeLoop(new FakeTransport([{ error: retryable }, { error: retryable }, { error: retryable }]), []);
    expect((await loop2.runTurn({ content: 'x', runId: 'r', signal: new AbortController().signal })).stopReason).toBe('error');
  });

  it('Transportfehler beenden den Turn mit error', async () => {
    const { loop } = makeLoop(new FakeTransport([{ error: new Error('529 overloaded') }]), []);
    const result = await loop.runTurn({ content: 'x', runId: 'r', signal: new AbortController().signal });
    expect(result).toMatchObject({ stopReason: 'error', error: '529 overloaded' });
  });

  it('persistiert im Projekt und lädt das Transkript beim Neustart (inkl. Sidecar-Extras)', async () => {
    const store = projectTranscriptStore(project, 'fal');
    const transport = new FakeTransport([fakeText('eins', { extra: { reasoning_details: [{ type: 'reasoning.text', text: 'r' }] } })], { id: 'fal', caps: { midConversationSystem: false } });
    const { loop } = makeLoop(transport, [], { store });
    await loop.runTurn({ content: 'Hallo', runId: 'r', signal: new AbortController().signal });

    const transport2 = new FakeTransport([fakeText('zwei')], { id: 'fal', caps: { midConversationSystem: false } });
    const { loop: reloaded } = makeLoop(transport2, [], { store: projectTranscriptStore(project, 'fal') });
    await reloaded.load();
    expect(reloaded.transcript).toEqual(loop.transcript);
    expect(reloaded.transcriptExtras.get(1)).toEqual({ reasoning_details: [{ type: 'reasoning.text', text: 'r' }] });
    await reloaded.runTurn({ content: 'Weiter', runId: 'r2', signal: new AbortController().signal });
    expect(transport2.requests[0]!.messages).toHaveLength(3);
  });

  it('kompaktiert clientseitig, wenn der Transport keine Serverkompaktierung hat', async () => {
    const transport = new FakeTransport([fakeText('x'.repeat(4000)), fakeText('## Zusammenfassung\nBrief steht.'), fakeText('weiter')], { id: 'fal', caps: { serverCompaction: false, midConversationSystem: false } });
    const store = new MemoryTranscriptStore();
    const { loop, events } = makeLoop(transport, [], { store, compaction: { thresholdTokens: 500 } });
    await loop.runTurn({ content: 'Start', runId: 'r1', signal: new AbortController().signal });
    expect(estimateTokens(loop.transcript)).toBeGreaterThan(500);
    await loop.runTurn({ content: 'Nächster Turn', runId: 'r2', signal: new AbortController().signal });
    // Aufruf 2 war die Zusammenfassung (anderes Modell, ohne Tools)
    expect(transport.requests[1]!.model).toBe('claude-sonnet-5-5');
    expect(transport.requests[1]!.toolNames).toEqual([]);
    // Neues Segment: Zusammenfassung, Bestätigung, neuer User-Turn, Antwort
    expect(loop.transcript).toHaveLength(4);
    expect(JSON.stringify(loop.transcript[0])).toContain('conversation_summary');
    expect(store.entries.some((e) => e.type === 'compaction')).toBe(true);
    expect(events.some((e) => e.type === 'compaction')).toBe(true);
    // Alte Einträge bleiben im Speicher (append-only)
    expect(store.entries[0]).toMatchObject({ type: 'message' });
  });
});
