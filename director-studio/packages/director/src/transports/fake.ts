import { abortError, delay } from '../util.ts';
import type { CanonicalBlock, CanonicalMessage, ModelTransport, TransportCaps, TransportEvent, TransportRequest, TransportResponse, TransportUsage } from './types.ts';

/**
 * Skriptgesteuerter Transport für Tests und Fake-Backends (E2E der App ohne Netz).
 * Jeder Aufruf von `stream` nimmt den nächsten Schritt aus dem Skript.
 */

export type FakeStep =
  | TransportResponse
  | ((req: TransportRequest, call: number) => TransportResponse | Promise<TransportResponse>)
  | { hang: true }
  | { error: Error };

export interface RecordedRequest {
  model: string;
  system: string;
  messages: CanonicalMessage[];
  toolNames: string[];
  effort: string;
  maxTokens: number;
}

const ANTHROPIC_LIKE_CAPS: TransportCaps = {
  midConversationSystem: true,
  serverWebSearch: true,
  serverCompaction: true,
  promptCache: 'native',
  thinkingRoundtrip: 'native',
  effort: 'native',
  vision: true,
};

export class FakeTransport implements ModelTransport {
  readonly id: 'anthropic' | 'fal';
  readonly caps: TransportCaps;
  readonly requests: RecordedRequest[] = [];
  private readonly steps: FakeStep[];
  private readonly delayMs: number;

  constructor(steps: FakeStep[], options: { id?: 'anthropic' | 'fal'; caps?: Partial<TransportCaps>; delayMs?: number } = {}) {
    this.steps = [...steps];
    this.id = options.id ?? 'anthropic';
    this.caps = { ...ANTHROPIC_LIKE_CAPS, ...(options.caps ?? {}) };
    this.delayMs = options.delayMs ?? 0;
  }

  /** Weitere Schritte anhängen (z. B. für Folge-Turns). */
  push(...steps: FakeStep[]): void {
    this.steps.push(...steps);
  }

  get remaining(): number {
    return this.steps.length;
  }

  async stream(req: TransportRequest, onEvent: (event: TransportEvent) => void): Promise<TransportResponse> {
    const call = this.requests.length;
    this.requests.push({
      model: req.model,
      system: req.system,
      messages: structuredClone([...req.messages]) as CanonicalMessage[],
      toolNames: req.tools.map((t) => t.name),
      effort: req.effort,
      maxTokens: req.maxTokens,
    });
    if (req.signal?.aborted) throw abortError();
    const step = this.steps.shift();
    if (!step) throw new Error(`FakeTransport: kein Skriptschritt für Aufruf ${call + 1}`);
    if (this.delayMs) await delay(this.delayMs, req.signal);
    if ('hang' in step) {
      await new Promise<never>((_, reject) => {
        if (!req.signal) return;
        req.signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    }
    if ('error' in step) throw step.error;
    const response: TransportResponse = typeof step === 'function' ? await step(req, call) : (step as TransportResponse);
    for (const block of response.content) {
      if (block.type === 'text') onEvent({ type: 'text_delta', text: block.text });
      if (block.type === 'tool_use') onEvent({ type: 'tool_use_start', id: block.id, name: block.name });
      if (block.type === 'thinking' && block.thinking) onEvent({ type: 'thinking_done', index: 0, text: block.thinking });
    }
    if (req.signal?.aborted) throw abortError();
    return structuredClone(response);
  }
}

let toolCounter = 0;

export function usage(input = 100, output = 50, cacheRead = 0, cacheWrite = 0): TransportUsage {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite };
}

/** Antwort mit reinem Text (end_turn). */
export function fakeText(text: string, extra: Partial<TransportResponse> = {}): TransportResponse {
  return { content: [{ type: 'text', text }], stopReason: 'end_turn', usage: usage(), ...extra };
}

/** Antwort mit einem oder mehreren Tool-Aufrufen (stop_reason tool_use), optional mit Text davor. */
export function fakeToolUse(calls: Array<{ name: string; input: unknown; id?: string }>, text?: string, extra: Partial<TransportResponse> = {}): TransportResponse {
  const content: CanonicalBlock[] = [];
  content.push({ type: 'thinking', thinking: '', signature: `sig_${++toolCounter}` });
  if (text) content.push({ type: 'text', text });
  for (const call of calls) content.push({ type: 'tool_use', id: call.id ?? `toolu_${++toolCounter}`, name: call.name, input: call.input });
  return { content, stopReason: 'tool_use', usage: usage(), ...extra };
}
