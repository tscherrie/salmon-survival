import type { DirectorEffort } from '@studio/core';
import { toOpenAITools } from '../tools/registry.ts';
import { abortError, isAbortError } from '../util.ts';
import { parseSse } from './sse.ts';
import { EMPTY_USAGE, type CanonicalBlock, type CanonicalMessage, type ModelTransport, type TransportCaps, type TransportEvent, type TransportRequest, type TransportResponse, type TransportUsage } from './types.ts';

/**
 * Fallback-Transport: Claude über den OpenAI-kompatiblen LLM-Router von fal (OpenRouter auf fal).
 * Reduzierte Fähigkeiten (siehe caps): keine Mid-Conversation-System-Messages (Kontext kommt als
 * `<studio-context>` in den User-Turn), keine Server-Websuche/Kompaktierung, Prompt-Cache nur über
 * explizite `cache_control`-Marker. Thinking über Tool-Aufrufe hinweg nur, wenn der Router
 * `reasoning_details` durchreicht – diese werden im Sidecar je Nachricht gespeichert und unverändert
 * zurückgespielt. (Durchreichen von tools/verbosity/reasoning_details ist laut Recherche
 * unverifiziert → Start-Probe in der App empfohlen.)
 */

export const FAL_ROUTER_BASE_URL = 'https://fal.run/openrouter/router/openai/v1';

export interface FalOpenAITransportOptions {
  /** fal-Key (`Authorization: Key …`). */
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Kanonische Modell-ID → Router-ID (Standard: `claude-opus-5-5` → `anthropic/claude-opus-5.5`). */
  modelMap?: (model: string) => string;
  /** Effort → `verbosity` (OpenRouter bildet verbosity auf output_config.effort ab). */
  verbosityFor?: (effort: DirectorEffort) => string;
  /** Explizite cache_control-Marker auf Systemprompt und letztem User-Block (Standard: an). */
  explicitCache?: boolean;
  /** Optional: OpenRouter-Providerrouting, z. B. `{ order: ['anthropic'], allow_fallbacks: false }`. */
  provider?: Record<string, unknown>;
  extraBody?: Record<string, unknown>;
}

export function falModelId(model: string): string {
  if (model.includes('/')) return model;
  const m = /^(claude-[a-z]+)-(\d+)-(\d+)$/.exec(model);
  return m ? `anthropic/${m[1]}-${m[2]}.${m[3]}` : `anthropic/${model}`;
}

type OAPart = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } } | { type: 'image_url'; image_url: { url: string } };
export type OAMessage =
  | { role: 'system'; content: string | OAPart[] }
  | { role: 'user'; content: string | OAPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>; reasoning_details?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function imagePart(block: Extract<CanonicalBlock, { type: 'image' }>): OAPart | undefined {
  const source = block.source;
  if (source.type === 'base64') return { type: 'image_url', image_url: { url: `data:${source.media_type};base64,${source.data}` } };
  if (source.type === 'url') return { type: 'image_url', image_url: { url: source.url } };
  return undefined;
}

function toolResultParts(block: Extract<CanonicalBlock, { type: 'tool_result' }>): { text: string; images: OAPart[] } {
  const content = block.content;
  let text = '';
  const images: OAPart[] = [];
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === 'text') text += (text ? '\n' : '') + part.text;
      else if (part.type === 'image') {
        const img = imagePart(part as Extract<CanonicalBlock, { type: 'image' }>);
        if (img) images.push(img);
      }
    }
  }
  if (block.is_error) text = `FEHLER: ${text}`;
  return { text: text || (images.length ? '(Bilder folgen in der nächsten Nachricht)' : '(leer)'), images };
}

/** Kanonische Nachrichten → OpenAI-Chat-Nachrichten. */
export function toOpenAIMessages(
  system: string,
  messages: readonly CanonicalMessage[],
  extras: ReadonlyMap<number, Record<string, unknown>> = new Map(),
  options: { explicitCache?: boolean } = {},
): OAMessage[] {
  const cache = options.explicitCache ?? true;
  const out: OAMessage[] = [cache ? { role: 'system', content: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : { role: 'system', content: system }];
  messages.forEach((message, index) => {
    if (message.role === 'system') {
      const text = typeof message.content === 'string' ? message.content : message.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
      if (text.trim()) out.push({ role: 'user', content: `<system-reminder>\n${text}\n</system-reminder>` });
      return;
    }
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        out.push({ role: 'user', content: message.content });
        return;
      }
      const parts: OAPart[] = [];
      const toolImages: OAPart[] = [];
      for (const block of message.content) {
        if (block.type === 'tool_result') {
          const { text, images } = toolResultParts(block);
          out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: text });
          if (images.length) toolImages.push({ type: 'text', text: `Bilder aus Tool-Ergebnis ${block.tool_use_id}:` }, ...images);
        } else if (block.type === 'text') {
          parts.push({ type: 'text', text: block.text });
        } else if (block.type === 'image') {
          const img = imagePart(block);
          if (img) parts.push(img);
        }
      }
      const all = [...toolImages, ...parts];
      if (all.length) out.push({ role: 'user', content: all });
      return;
    }
    // assistant
    const blocks = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
    const text = blocks
      .filter((b): b is Extract<CanonicalBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const toolCalls = blocks
      .filter((b): b is Extract<CanonicalBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => ({ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
    const msg: OAMessage = { role: 'assistant', content: text || (toolCalls.length ? null : '') };
    if (toolCalls.length) msg.tool_calls = toolCalls;
    const details = extras.get(index)?.reasoning_details;
    if (Array.isArray(details) && details.length) msg.reasoning_details = details;
    out.push(msg);
  });
  if (cache) {
    // Zweiter Breakpoint: letzter Textteil der letzten User-Nachricht (wachsendes Gesprächsende).
    for (let i = out.length - 1; i > 0; i--) {
      const m = out[i]!;
      if (m.role !== 'user') continue;
      if (typeof m.content === 'string') m.content = [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }];
      else {
        const lastText = [...m.content].reverse().find((p): p is Extract<OAPart, { type: 'text' }> => p.type === 'text');
        if (lastText) lastText.cache_control = { type: 'ephemeral' };
      }
      break;
    }
  }
  return out;
}

/** Fügt gestreamte `reasoning_details`-Fragmente je (type, index) zusammen. */
export function mergeReasoningDetails(fragments: unknown[]): unknown[] {
  const merged: Array<Record<string, unknown>> = [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const raw of fragments) {
    if (!raw || typeof raw !== 'object') continue;
    const frag = raw as Record<string, unknown>;
    const key = `${String(frag.type)}#${String(frag.index ?? merged.length)}`;
    const existing = byKey.get(key);
    if (!existing) {
      const copy = { ...frag };
      byKey.set(key, copy);
      merged.push(copy);
      continue;
    }
    for (const [k, v] of Object.entries(frag)) {
      if ((k === 'text' || k === 'summary') && typeof v === 'string' && typeof existing[k] === 'string') existing[k] = (existing[k] as string) + v;
      else if (v !== undefined && v !== null) existing[k] = v;
    }
  }
  return merged;
}

const STOP_MAP: Record<string, string> = { stop: 'end_turn', tool_calls: 'tool_use', length: 'max_tokens', content_filter: 'refusal', function_call: 'tool_use' };

interface AccumulatedCall {
  id: string;
  name: string;
  args: string;
}

/** Baut die kanonische Antwort aus den gesammelten Teilen. */
export function buildCanonicalResponse(parts: {
  text: string;
  calls: AccumulatedCall[];
  finishReason: string | undefined;
  usage: Record<string, unknown> | undefined;
  reasoningDetails: unknown[];
}): TransportResponse {
  const content: CanonicalBlock[] = [];
  if (parts.text) content.push({ type: 'text', text: parts.text });
  parts.calls.forEach((call, i) => {
    let input: unknown;
    try {
      input = call.args.trim() ? JSON.parse(call.args) : {};
      if (!input || typeof input !== 'object' || Array.isArray(input)) input = { __invalid_json: call.args };
    } catch {
      input = { __invalid_json: call.args };
    }
    content.push({ type: 'tool_use', id: call.id || `call_${i}`, name: call.name, input });
  });
  let stopReason = STOP_MAP[parts.finishReason ?? 'stop'] ?? 'end_turn';
  if (parts.calls.length && stopReason === 'end_turn') stopReason = 'tool_use';
  const u = parts.usage ?? {};
  const prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0;
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cached = typeof details.cached_tokens === 'number' ? details.cached_tokens : 0;
  const cacheWrite = typeof details.cache_write_tokens === 'number' ? details.cache_write_tokens : 0;
  const usage: TransportUsage = {
    inputTokens: Math.max(0, prompt - cached - cacheWrite),
    outputTokens: typeof u.completion_tokens === 'number' ? u.completion_tokens : 0,
    cacheReadTokens: cached,
    cacheWriteTokens: cacheWrite,
  };
  const response: TransportResponse = { content, stopReason, usage: parts.usage ? usage : { ...EMPTY_USAGE } };
  if (typeof u.cost === 'number') response.costUsd = u.cost;
  const merged = mergeReasoningDetails(parts.reasoningDetails);
  if (merged.length) response.extra = { reasoning_details: merged };
  return response;
}

export class FalOpenAITransport implements ModelTransport {
  readonly id = 'fal' as const;
  readonly caps: TransportCaps = {
    midConversationSystem: false,
    serverWebSearch: false,
    serverCompaction: false,
    promptCache: 'explicit-only',
    thinkingRoundtrip: 'reasoning_details',
    effort: 'verbosity',
    vision: true,
  };

  constructor(private readonly options: FalOpenAITransportOptions) {
    if (!options.apiKey) throw new Error('fal-Key fehlt');
  }

  buildBody(req: TransportRequest): Record<string, unknown> {
    const tools = toOpenAITools(req.tools);
    const body: Record<string, unknown> = {
      model: (this.options.modelMap ?? falModelId)(req.model),
      messages: toOpenAIMessages(req.system, req.messages, req.extras ?? new Map(), { explicitCache: this.options.explicitCache ?? true }),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: req.maxTokens,
      reasoning: { enabled: true },
      verbosity: (this.options.verbosityFor ?? ((e: DirectorEffort) => e))(req.effort),
      usage: { include: true },
    };
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    if (this.options.provider) body.provider = this.options.provider;
    return { ...body, ...(this.options.extraBody ?? {}) };
  }

  async stream(req: TransportRequest, onEvent: (event: TransportEvent) => void): Promise<TransportResponse> {
    const doFetch = this.options.fetch ?? fetch;
    const url = `${(this.options.baseUrl ?? FAL_ROUTER_BASE_URL).replace(/\/$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Key ${this.options.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(this.buildBody(req)),
        ...(req.signal ? { signal: req.signal } : {}),
      });
    } catch (error) {
      if (isAbortError(error) || req.signal?.aborted) throw abortError();
      throw error;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`fal LLM-Router ${res.status}: ${detail.slice(0, 1000)}`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    try {
      if (!contentType.includes('text/event-stream') && contentType.includes('json')) {
        return this.fromJson((await res.json()) as Record<string, unknown>, onEvent);
      }
      if (!res.body) throw new Error('fal LLM-Router: leere Antwort');
      return await this.fromSse(res.body, onEvent);
    } catch (error) {
      if (isAbortError(error) || req.signal?.aborted) throw abortError();
      throw error;
    }
  }

  private async fromSse(body: ReadableStream<Uint8Array>, onEvent: (event: TransportEvent) => void): Promise<TransportResponse> {
    let text = '';
    const calls = new Map<number, AccumulatedCall>();
    let finishReason: string | undefined;
    let usage: Record<string, unknown> | undefined;
    const reasoningDetails: unknown[] = [];
    let reasoning = '';
    for await (const ev of parseSse(body)) {
      if (ev.data === '[DONE]') break;
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (chunk.error) {
        const err = chunk.error as Record<string, unknown>;
        throw new Error(`fal LLM-Router: ${String(err.message ?? JSON.stringify(err))}`);
      }
      const choice = (Array.isArray(chunk.choices) ? chunk.choices[0] : undefined) as Record<string, unknown> | undefined;
      if (choice) {
        const delta = (choice.delta ?? {}) as Record<string, unknown>;
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          onEvent({ type: 'text_delta', text: delta.content });
        }
        if (typeof delta.reasoning === 'string' && delta.reasoning) {
          reasoning += delta.reasoning;
          onEvent({ type: 'thinking_delta', index: 0, text: delta.reasoning });
        }
        if (Array.isArray(delta.reasoning_details)) reasoningDetails.push(...delta.reasoning_details);
        if (Array.isArray(delta.tool_calls)) {
          for (const raw of delta.tool_calls as Array<Record<string, unknown>>) {
            const index = typeof raw.index === 'number' ? raw.index : calls.size;
            const fn = (raw.function ?? {}) as Record<string, unknown>;
            let call = calls.get(index);
            if (!call) {
              call = { id: '', name: '', args: '' };
              calls.set(index, call);
            }
            if (typeof raw.id === 'string' && raw.id) call.id = raw.id;
            if (typeof fn.name === 'string' && fn.name) {
              const first = !call.name;
              call.name += fn.name;
              if (first) onEvent({ type: 'tool_use_start', id: call.id || `call_${index}`, name: call.name });
            }
            if (typeof fn.arguments === 'string') call.args += fn.arguments;
          }
        }
        if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
      }
      if (chunk.usage && typeof chunk.usage === 'object') usage = chunk.usage as Record<string, unknown>;
    }
    if (reasoning.trim()) onEvent({ type: 'thinking_done', index: 0, text: reasoning });
    return buildCanonicalResponse({ text, calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c), finishReason, usage, reasoningDetails });
  }

  private fromJson(json: Record<string, unknown>, onEvent: (event: TransportEvent) => void): TransportResponse {
    if (json.error) throw new Error(`fal LLM-Router: ${JSON.stringify(json.error)}`);
    const choice = (Array.isArray(json.choices) ? json.choices[0] : {}) as Record<string, unknown>;
    const message = (choice.message ?? {}) as Record<string, unknown>;
    const text = typeof message.content === 'string' ? message.content : '';
    if (text) onEvent({ type: 'text_delta', text });
    const calls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((raw: Record<string, unknown>, i: number) => {
      const fn = (raw.function ?? {}) as Record<string, unknown>;
      return { id: typeof raw.id === 'string' ? raw.id : `call_${i}`, name: String(fn.name ?? ''), args: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}) };
    });
    return buildCanonicalResponse({
      text,
      calls,
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined,
      usage: (json.usage as Record<string, unknown> | undefined) ?? undefined,
      reasoningDetails: Array.isArray(message.reasoning_details) ? message.reasoning_details : [],
    });
  }
}
