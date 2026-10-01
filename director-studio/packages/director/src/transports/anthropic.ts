import Anthropic from '@anthropic-ai/sdk';
import { toAnthropicTools } from '../tools/registry.ts';
import { abortError } from '../util.ts';
import type { CanonicalBlock, ModelTransport, TransportCaps, TransportEvent, TransportRequest, TransportResponse } from './types.ts';

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaRawMessageStreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** Was der Transport vom SDK-Client braucht (injizierbar für Tests). */
export interface AnthropicClientLike {
  beta: {
    messages: {
      stream(params: StreamParams, options?: { signal?: AbortSignal }): AsyncIterable<BetaRawMessageStreamEvent> & { finalMessage(): Promise<BetaMessage> };
    };
  };
}

export const ANTHROPIC_BETAS = {
  /** Fortschrittsnotizen zwischen Tool-Aufrufen als Text (`thinking.display: "updates"`). */
  thinkingUpdates: 'thinking-display-updates-2026-08-18',
  /** Serverseitige Fallbacks bei Klassifikator-Ablehnungen (`fallbacks: "default"`). */
  fallbacks: 'server-side-fallback-2026-07-01',
  /** Serverseitige Kompaktierung (`context_management.edits: [{type:"compact_20260112"}]`). */
  compaction: 'compact-2026-01-12',
} as const;

export interface AnthropicTransportOptions {
  /** Fertiger Client (Tests, eigene Konfiguration). */
  client?: AnthropicClientLike;
  /**
   * API-Key. Ohne Key wird der Client ohne Argumente erzeugt: das SDK löst dann `ANTHROPIC_API_KEY`,
   * `ANTHROPIC_AUTH_TOKEN` oder ein OAuth-Profil aus `ant auth login` automatisch auf.
   */
  apiKey?: string | null;
  /** `updates` (Standard, Beta) oder `summarized` als Rückfall, falls die Beta nicht verfügbar ist. */
  thinkingDisplay?: 'updates' | 'summarized';
  /** Server-Tools web_search/web_fetch (Standard: an). */
  serverWebTools?: boolean;
  /**
   * Serverseitige Refusal-Fallbacks (Standard: AN). Bei einer Klassifikator-Ablehnung (z. B. eine
   * harmlose Anfrage, die fälschlich als `cyber`/`bio` eingestuft wird) läuft dieselbe Anfrage auf dem
   * von Anthropic empfohlenen Fallback-Modell weiter, statt mit `stop_reason: "refusal"` zu enden.
   * Hinweis: Das Fallback-Modell sieht die Thinking-Blöcke von Opus 5.5 nicht.
   */
  fallbacks?: boolean;
  /** Serverseitige Kompaktierung langer Gespräche (Standard: an). */
  serverCompaction?: boolean;
  /** Zusätzliche Beta-Header. */
  betas?: string[];
  /** TTL des Cache-Breakpoints auf dem Systemprompt (Standard 5 min). */
  cacheTtl?: '5m' | '1h';
  /** strict tool use für kompatible Schemas (Standard: an). */
  strictTools?: boolean;
}

interface ModelProfile {
  /** Opus/Sonnet/Fable 5.x: adaptives Thinking, Effort, Updates-Display, Fallbacks, Kompaktierung. */
  modern: boolean;
}

export function anthropicModelProfile(model: string): ModelProfile {
  return { modern: /^claude-(opus|sonnet|fable|mythos)-5/.test(model) };
}

/** Transport über `@anthropic-ai/sdk` (Beta-Messages, Streaming). */
export class AnthropicTransport implements ModelTransport {
  readonly id = 'anthropic' as const;
  readonly caps: TransportCaps;
  private clientValue: AnthropicClientLike | undefined;

  constructor(private readonly options: AnthropicTransportOptions = {}) {
    this.clientValue = options.client;
    this.caps = {
      midConversationSystem: true,
      serverWebSearch: options.serverWebTools ?? true,
      serverCompaction: options.serverCompaction ?? true,
      promptCache: 'native',
      thinkingRoundtrip: 'native',
      effort: 'native',
      vision: true,
    };
  }

  private get client(): AnthropicClientLike {
    this.clientValue ??= (this.options.apiKey ? new Anthropic({ apiKey: this.options.apiKey }) : new Anthropic()) as unknown as AnthropicClientLike;
    return this.clientValue;
  }

  /** Baut die Anfrage (öffentlich für Tests und Diagnose). */
  buildParams(req: TransportRequest): StreamParams {
    const profile = anthropicModelProfile(req.model);
    const betas = new Set<string>(this.options.betas ?? []);
    const display = this.options.thinkingDisplay ?? 'updates';
    const tools: unknown[] = toAnthropicTools(req.tools, { strict: this.options.strictTools ?? true, eagerInputStreaming: true });
    if (this.caps.serverWebSearch && profile.modern && req.serverTools !== false) {
      tools.push({ type: 'web_search_20260209', name: 'web_search' }, { type: 'web_fetch_20260209', name: 'web_fetch' });
    }
    const cacheControl = this.options.cacheTtl === '1h' ? { type: 'ephemeral' as const, ttl: '1h' as const } : { type: 'ephemeral' as const };
    const params: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      // Expliziter Breakpoint auf dem statischen Systemprompt (cacht Tools + System) …
      system: [{ type: 'text', text: req.system, cache_control: cacheControl }],
      messages: req.messages,
      tools,
      tool_choice: { type: 'auto' },
      // … plus automatisches Caching des wachsenden Gesprächsendes.
      cache_control: cacheControl,
    };
    if (profile.modern) {
      // Opus 5.5: Thinking ist immer an; Tiefe nur über effort (Standard wäre medium).
      params.thinking = { type: 'adaptive', display };
      params.output_config = { effort: req.effort };
      if (display === 'updates') betas.add(ANTHROPIC_BETAS.thinkingUpdates);
      if (this.options.fallbacks ?? true) {
        params.fallbacks = 'default';
        betas.add(ANTHROPIC_BETAS.fallbacks);
      }
      if (this.caps.serverCompaction) {
        params.context_management = { edits: [{ type: 'compact_20260112' }] };
        betas.add(ANTHROPIC_BETAS.compaction);
      }
    }
    if (betas.size) params.betas = [...betas].sort();
    return params as unknown as StreamParams;
  }

  async stream(req: TransportRequest, onEvent: (event: TransportEvent) => void): Promise<TransportResponse> {
    const params = this.buildParams(req);
    const thinking = new Map<number, string>();
    let message: BetaMessage;
    try {
      const stream = this.client.beta.messages.stream(params, req.signal ? { signal: req.signal } : {});
      for await (const event of stream) {
        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'tool_use') onEvent({ type: 'tool_use_start', id: block.id, name: block.name });
            else if (block.type === 'server_tool_use') onEvent({ type: 'server_tool_use', id: block.id, name: block.name });
            else if (block.type === 'thinking') thinking.set(event.index, block.thinking ?? '');
            else if (block.type === 'fallback') onEvent({ type: 'notice', text: `Ablehnung durch ${block.from.model}; ${block.to.model} übernimmt.` });
            else if (block.type === 'text' && block.text) onEvent({ type: 'text_delta', text: block.text });
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') onEvent({ type: 'text_delta', text: delta.text });
            else if (delta.type === 'thinking_delta' && delta.thinking) {
              thinking.set(event.index, (thinking.get(event.index) ?? '') + delta.thinking);
              onEvent({ type: 'thinking_delta', index: event.index, text: delta.thinking });
            }
            break;
          }
          case 'content_block_stop': {
            const text = thinking.get(event.index);
            if (text !== undefined && text.trim()) onEvent({ type: 'thinking_done', index: event.index, text });
            thinking.delete(event.index);
            break;
          }
          default:
            break;
        }
      }
      message = await stream.finalMessage();
    } catch (error) {
      if (error instanceof Anthropic.APIUserAbortError || req.signal?.aborted) throw abortError();
      // Mit eager_input_streaming kann das SDK beim Materialisieren einer Tool-Eingabe an ungültigem JSON
      // scheitern (kein tool_use_id zum Antworten) → Anfrage erneut stellen (Loop begrenzt die Versuche).
      if (!(error instanceof Anthropic.APIError)) throw new RetryableTransportError(`Antwort nicht verarbeitbar: ${(error as Error).message}`);
      throw error;
    }
    const usage = message.usage;
    return {
      content: sanitizeFallbackContent(message.content as unknown as CanonicalBlock[]),
      stopReason: message.stop_reason ?? 'end_turn',
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      },
      model: message.model,
      stopDetails: message.stop_details ? { category: message.stop_details.category, explanation: message.stop_details.explanation ?? null } : null,
    };
  }
}

/** Fehler, nach dem der Loop dieselbe Anfrage erneut stellen darf (z. B. unparsebares Tool-JSON). */
export class RetryableTransportError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'RetryableTransportError';
  }
}

/**
 * Regeln zum Zurückspielen nach einem Fallback mitten in der Ausgabe: Vor dem letzten `fallback`-Block
 * entfallen thinking-, redacted_thinking- und tool_use-Blöcke sowie server_tool_use ohne passendes
 * Ergebnis; Text und gepaarte Server-Tool-Blöcke bleiben.
 */
export function sanitizeFallbackContent(content: CanonicalBlock[]): CanonicalBlock[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
  if (lastFallback < 0) return content;
  const resultIds = new Set(
    content
      .filter((b) => b.type.endsWith('_tool_result') && 'tool_use_id' in b)
      .map((b) => (b as { tool_use_id: string }).tool_use_id),
  );
  return content.filter((block, i) => {
    if (i >= lastFallback) return true;
    if (block.type === 'thinking' || block.type === 'redacted_thinking' || block.type === 'tool_use') return false;
    if (block.type === 'server_tool_use') return resultIds.has(block.id);
    return true;
  });
}
