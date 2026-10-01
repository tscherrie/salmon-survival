import { describe, expect, it } from 'vitest';
import {
  AnthropicTransport,
  buildDirectorTools,
  falModelId,
  FalOpenAITransport,
  mergeReasoningDetails,
  parseSse,
  sanitizeFallbackContent,
  toOpenAIMessages,
  type AnthropicClientLike,
  type CanonicalMessage,
  type TransportEvent,
  type TransportRequest,
} from '../src/index.ts';

const tools = buildDirectorTools({ delegate: true });

function request(extra: Partial<TransportRequest> = {}): TransportRequest {
  return {
    model: 'claude-opus-5-5',
    system: 'STATIC SYSTEM',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Mach es dunkler' }] },
      { role: 'system', content: '<budget>\n$5\n</budget>' },
    ],
    tools,
    effort: 'xhigh',
    maxTokens: 64000,
    ...extra,
  };
}

function fakeAnthropicClient(events: unknown[], final: Record<string, unknown>) {
  const calls: Array<{ params: Record<string, unknown>; options: unknown }> = [];
  const client: AnthropicClientLike = {
    beta: {
      messages: {
        stream(params, options) {
          calls.push({ params: params as unknown as Record<string, unknown>, options });
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of events) yield e as never;
            },
            finalMessage: async () => final as never,
          };
        },
      },
    },
  };
  return { client, calls };
}

const FINAL = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [
    { type: 'thinking', thinking: 'Ich prüfe die Frames.', signature: 'sig' },
    { type: 'text', text: 'Okay.', citations: null },
    { type: 'tool_use', id: 'toolu_1', name: 'frames', input: { source: 'timeline', timesSec: [1] } },
  ],
  stop_reason: 'tool_use',
  stop_details: null,
  usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
};

describe('AnthropicTransport', () => {
  it('baut die Anfrage für Opus 5.5 korrekt', async () => {
    const { client, calls } = fakeAnthropicClient([], FINAL);
    const transport = new AnthropicTransport({ client });
    await transport.stream(request(), () => undefined);
    const p = calls[0]!.params;
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.max_tokens).toBe(64000);
    expect(p.thinking).toEqual({ type: 'adaptive', display: 'updates' });
    expect(p.output_config).toEqual({ effort: 'xhigh' });
    expect(p.tool_choice).toEqual({ type: 'auto' });
    expect(p.system).toEqual([{ type: 'text', text: 'STATIC SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(p.cache_control).toEqual({ type: 'ephemeral' });
    expect(p.fallbacks).toBe('default');
    expect(p.context_management).toEqual({ edits: [{ type: 'compact_20260112' }] });
    expect(p.betas).toEqual(['compact-2026-01-12', 'server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18']);
    // Mid-Conversation-System-Message bleibt unverändert an ihrer Stelle
    expect((p.messages as CanonicalMessage[]).map((m) => m.role)).toEqual(['user', 'system']);
    const sentTools = p.tools as Array<Record<string, unknown>>;
    const client_tools = sentTools.filter((t) => !t.type);
    expect(client_tools.every((t) => t.eager_input_streaming === true)).toBe(true);
    expect(client_tools.some((t) => t.strict === true)).toBe(true);
    expect(client_tools.find((t) => t.name === 'generate')!.strict).toBeUndefined();
    expect(sentTools.slice(-2)).toEqual([
      { type: 'web_search_20260209', name: 'web_search' },
      { type: 'web_fetch_20260209', name: 'web_fetch' },
    ]);
    expect(p).not.toHaveProperty('temperature');
  });

  it('fällt auf display "summarized" ohne Beta zurück und lässt Fallbacks abschaltbar', () => {
    const transport = new AnthropicTransport({ client: fakeAnthropicClient([], FINAL).client, thinkingDisplay: 'summarized', fallbacks: false, serverCompaction: false, serverWebTools: false, betas: ['x-beta'] });
    const p = transport.buildParams(request()) as unknown as Record<string, unknown>;
    expect(p.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(p.betas).toEqual(['x-beta']);
    expect(p.fallbacks).toBeUndefined();
    expect(p.context_management).toBeUndefined();
    expect((p.tools as Array<{ type?: string }>).some((t) => t.type?.startsWith('web_'))).toBe(false);
    expect(transport.caps.serverWebSearch).toBe(false);
  });

  it('sendet Haiku (Subagent) ohne adaptive Thinking/Effort/Fallbacks', () => {
    const transport = new AnthropicTransport({ client: fakeAnthropicClient([], FINAL).client });
    const p = transport.buildParams(request({ model: 'claude-haiku-4-5' })) as unknown as Record<string, unknown>;
    expect(p.thinking).toBeUndefined();
    expect(p.output_config).toBeUndefined();
    expect(p.fallbacks).toBeUndefined();
    expect(p.betas).toBeUndefined();
  });

  it('übersetzt Stream-Ereignisse und liefert kanonischen Inhalt', async () => {
    const events = [
      { type: 'message_start', message: {} },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Ich prüfe ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'die Frames.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Okay.' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'frames', input: {} } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: {} },
    ];
    const { client, calls } = fakeAnthropicClient(events, FINAL);
    const transport = new AnthropicTransport({ client });
    const seen: TransportEvent[] = [];
    const controller = new AbortController();
    const res = await transport.stream(request({ signal: controller.signal }), (e) => seen.push(e));
    expect(calls[0]!.options).toEqual({ signal: controller.signal });
    expect(seen).toEqual([
      { type: 'thinking_delta', index: 0, text: 'Ich prüfe ' },
      { type: 'thinking_delta', index: 0, text: 'die Frames.' },
      { type: 'thinking_done', index: 0, text: 'Ich prüfe die Frames.' },
      { type: 'text_delta', text: 'Okay.' },
      { type: 'tool_use_start', id: 'toolu_1', name: 'frames' },
    ]);
    expect(res.stopReason).toBe('tool_use');
    expect(res.content).toEqual(FINAL.content);
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 });
  });

  it('meldet Refusal mit Kategorie', async () => {
    const final = { ...FINAL, content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio', explanation: 'nein' } };
    const transport = new AnthropicTransport({ client: fakeAnthropicClient([], final).client });
    const res = await transport.stream(request(), () => undefined);
    expect(res.stopReason).toBe('refusal');
    expect(res.stopDetails).toEqual({ category: 'bio', explanation: 'nein' });
  });

  it('entfernt beim Fallback mitten in der Ausgabe Thinking/Tool-Use vor dem Fallback-Block', () => {
    const content = [
      { type: 'thinking', thinking: 'a', signature: 's' },
      { type: 'text', text: 'Teil' },
      { type: 'tool_use', id: 't1', name: 'x', input: {} },
      { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
      { type: 'thinking', thinking: 'b', signature: 's2' },
      { type: 'text', text: 'Rest' },
    ] as never;
    expect((sanitizeFallbackContent(content) as Array<{ type: string }>).map((b) => b.type)).toEqual(['text', 'fallback', 'thinking', 'text']);
  });
});

// ───────────────────────── fal ─────────────────────────

describe('FalOpenAITransport – Übersetzung', () => {
  it('kanonisch → OpenAI: System, Text/Bild, Tool-Calls, Tool-Ergebnisse (Bilder als Folge-Nachricht), reasoning_details, System-Reminder', () => {
    const messages: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Hallo' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] },
      { role: 'system', content: '<budget>1</budget>' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'x', signature: 's' },
          { type: 'text', text: 'Ich schaue.' },
          { type: 'tool_use', id: 'call_1', name: 'frames', input: { source: 'timeline', timesSec: [1] } },
          { type: 'tool_use', id: 'call_2', name: 'get_asset', input: { assetId: 'ast_1' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: [{ type: 'text', text: '1 Frame' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } }] },
          { type: 'tool_result', tool_use_id: 'call_2', content: 'nicht gefunden', is_error: true },
        ],
      },
    ];
    const extras = new Map([[2, { reasoning_details: [{ type: 'reasoning.text', text: 'r', signature: 'sig' }] }]]);
    const out = toOpenAIMessages('SYS', messages, extras);
    expect(out[0]).toEqual({ role: 'system', content: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }] });
    expect(out[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Hallo' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] });
    expect(out[2]).toEqual({ role: 'user', content: '<system-reminder>\n<budget>1</budget>\n</system-reminder>' });
    expect(out[3]).toEqual({
      role: 'assistant',
      content: 'Ich schaue.',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'frames', arguments: '{"source":"timeline","timesSec":[1]}' } },
        { id: 'call_2', type: 'function', function: { name: 'get_asset', arguments: '{"assetId":"ast_1"}' } },
      ],
      reasoning_details: [{ type: 'reasoning.text', text: 'r', signature: 'sig' }],
    });
    expect(out[4]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '1 Frame' });
    expect(out[5]).toEqual({ role: 'tool', tool_call_id: 'call_2', content: 'FEHLER: nicht gefunden' });
    expect(out[6]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Bilder aus Tool-Ergebnis call_1:', cache_control: { type: 'ephemeral' } },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
      ],
    });
    expect(out).toHaveLength(7);
  });

  it('Modell-IDs und reasoning_details-Fragmente', () => {
    expect(falModelId('claude-opus-5-5')).toBe('anthropic/claude-opus-5.5');
    expect(falModelId('claude-haiku-4-5')).toBe('anthropic/claude-haiku-4.5');
    expect(falModelId('anthropic/custom')).toBe('anthropic/custom');
    expect(
      mergeReasoningDetails([
        { type: 'reasoning.text', index: 0, text: 'Hal' },
        { type: 'reasoning.text', index: 0, text: 'lo', signature: 'sig' },
        { type: 'reasoning.encrypted', index: 1, data: 'x' },
      ]),
    ).toEqual([
      { type: 'reasoning.text', index: 0, text: 'Hallo', signature: 'sig' },
      { type: 'reasoning.encrypted', index: 1, data: 'x' },
    ]);
  });
});

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

describe('FalOpenAITransport – Streaming', () => {
  it('sendet die Anfrage an den fal-Router und parst SSE (Text, Tool-Calls in Stücken, Reasoning, Usage/Kosten)', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const data = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    const chunks = [
      ': OPENROUTER PROCESSING\n\n',
      data({ choices: [{ index: 0, delta: { role: 'assistant', reasoning: 'Denke…', reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'Denke' }] } }] }),
      data({ choices: [{ index: 0, delta: { content: 'Ich ' } }] }),
      // Ein JSON-Chunk über zwei Netzwerk-Pakete verteilt
      'data: {"choices":[{"index":0,"delta":{"content":"prüfe."}}',
      ']}\n\n',
      data({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'frames', arguments: '{"source":' } }] } }] }),
      data({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"timeline","timesSec":[2]}' } }] } }] }),
      data({ choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'get_asset', arguments: '{"assetId":' } }] } }] }),
      data({ choices: [{ index: 0, delta: { reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'n', signature: 'S' }] }, finish_reason: 'tool_calls' }] }),
      data({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 600 }, cost: 0.0123 } }),
      'data: [DONE]\n\n',
    ];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return sseResponse(chunks);
    }) as unknown as typeof fetch;
    const transport = new FalOpenAITransport({ apiKey: 'fal-secret', fetch: fetchImpl });
    expect(transport.caps).toMatchObject({ midConversationSystem: false, serverWebSearch: false, serverCompaction: false, promptCache: 'explicit-only' });
    const seen: TransportEvent[] = [];
    const res = await transport.stream(
      { model: 'claude-opus-5-5', system: 'SYS', messages: [{ role: 'user', content: 'Hi' }], tools: tools.slice(0, 3), effort: 'high', maxTokens: 4000 },
      (e) => seen.push(e),
    );
    expect(calls[0]!.url).toBe('https://fal.run/openrouter/router/openai/v1/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Key fal-secret');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ model: 'anthropic/claude-opus-5.5', stream: true, max_tokens: 4000, reasoning: { enabled: true }, verbosity: 'high', tool_choice: 'auto' });
    expect(body.tools).toHaveLength(3);
    expect(body.tools[0].type).toBe('function');

    expect(seen.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('')).toBe('Ich prüfe.');
    expect(seen).toContainEqual({ type: 'tool_use_start', id: 'call_a', name: 'frames' });
    expect(seen).toContainEqual({ type: 'thinking_done', index: 0, text: 'Denke…' });

    expect(res.stopReason).toBe('tool_use');
    expect(res.content[0]).toEqual({ type: 'text', text: 'Ich prüfe.' });
    expect(res.content[1]).toEqual({ type: 'tool_use', id: 'call_a', name: 'frames', input: { source: 'timeline', timesSec: [2] } });
    // Unvollständiges JSON → markiert, der Loop antwortet mit INVALID_JSON
    expect(res.content[2]).toEqual({ type: 'tool_use', id: 'call_b', name: 'get_asset', input: { __invalid_json: '{"assetId":' } });
    expect(res.usage).toEqual({ inputTokens: 400, outputTokens: 50, cacheReadTokens: 600, cacheWriteTokens: 0 });
    expect(res.costUsd).toBe(0.0123);
    expect(res.extra).toEqual({ reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'Denken', signature: 'S' }] });
  });

  it('meldet HTTP- und Stream-Fehler', async () => {
    const t1 = new FalOpenAITransport({ apiKey: 'k', fetch: (async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch });
    await expect(t1.stream({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], effort: 'high', maxTokens: 10 }, () => undefined)).rejects.toThrow(/401/);
    const t2 = new FalOpenAITransport({ apiKey: 'k', fetch: (async () => sseResponse([`data: ${JSON.stringify({ error: { message: 'rate limited' } })}\n\n`])) as unknown as typeof fetch });
    await expect(t2.stream({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], effort: 'high', maxTokens: 10 }, () => undefined)).rejects.toThrow(/rate limited/);
  });

  it('versteht auch eine nicht gestreamte JSON-Antwort', async () => {
    const json = { choices: [{ message: { content: 'Hallo', tool_calls: [{ id: 'c1', function: { name: 'echo', arguments: '{"a":1}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
    const t = new FalOpenAITransport({ apiKey: 'k', fetch: (async () => new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch });
    const res = await t.stream({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], effort: 'low', maxTokens: 10 }, () => undefined);
    expect(res.content).toEqual([
      { type: 'text', text: 'Hallo' },
      { type: 'tool_use', id: 'c1', name: 'echo', input: { a: 1 } },
    ]);
    expect(res.stopReason).toBe('tool_use');
  });
});

describe('parseSse', () => {
  it('verarbeitet CRLF, Kommentare, mehrzeilige Daten und Ereignisnamen', async () => {
    const encoder = new TextEncoder();
    async function* source() {
      yield encoder.encode(': ping\r\nevent: update\r\ndata: a\r\ndata: b\r\n\r\n');
      yield encoder.encode('data: c');
      yield encoder.encode('\n\n');
    }
    const events = [];
    for await (const e of parseSse(source())) events.push(e);
    expect(events).toEqual([{ event: 'update', data: 'a\nb' }, { data: 'c' }]);
  });
});
