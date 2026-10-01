import { tokenCostUsd, type DirectorEffort } from '@studio/core';
import { COMPACTION_SYSTEM_PROMPT } from './prompt.ts';
import type { Clock } from './ports.ts';
import { systemClock } from './ports.ts';
import type { DirectorRuntime, LoopEvent, RuntimeTurnInput, TurnResult, TurnStopReason } from './runtime.ts';
import { firstLine, isAbortError, raceAbort, errorMessage, truncate } from './util.ts';
import { errorResult, parseToolInput, resultText, type AnyDirectorTool, type ToolContext, type ToolResult } from './tools/registry.ts';
import { MemoryTranscriptStore, replayTranscript, type TranscriptEntry, type TranscriptStore } from './transcript.ts';
import type { CanonicalBlock, CanonicalMessage, CanonicalToolResult, CanonicalToolUse, ModelTransport, TransportEvent, TransportResponse } from './transports/types.ts';

export interface ClientCompactionOptions {
  /** Ab dieser geschätzten Tokenzahl wird vor dem nächsten Turn kompaktiert. */
  thresholdTokens: number;
  /** Günstigeres Modell für die Zusammenfassung (Standard claude-sonnet-5-5). */
  model?: string;
  maxTokens?: number;
}

export interface DirectorLoopOptions {
  transport: ModelTransport;
  tools: AnyDirectorTool[];
  system: string;
  model: string;
  /** Effort (Opus 5.5 Standard wäre medium – der Director setzt ihn explizit); als Funktion live änderbar. */
  effort: DirectorEffort | (() => DirectorEffort);
  /** Für Thinking + Antwort (Opus 5.5: Thinking zählt mit). Standard 64000. */
  maxTokens?: number;
  /** Maximale Modellaufrufe je Turn (Standard 60). */
  maxIterations?: number;
  /** Notbremse für die LLM-Kosten eines Turns in USD (Standard 25). */
  maxTurnCostUsd?: number;
  store?: TranscriptStore;
  makeToolContext(runId: string, signal: AbortSignal): ToolContext;
  onEvent?: (event: LoopEvent) => void;
  recordUsage?: (runId: string, usd: number, note: string) => Promise<void>;
  /**
   * Clientseitige Kompaktierung, wenn der Transport keine serverseitige hat: ältere Turns werden mit
   * einem günstigeren Modell zusammengefasst und ein neues Transkript-Segment beginnt mit der
   * Zusammenfassung (keine alten Thinking-Blöcke werden wieder eingespielt → Thinking-Bindung bleibt gültig).
   */
  compaction?: ClientCompactionOptions | false;
  /** Server-Tools (Websuche) anbieten (Standard: laut Transport). */
  serverTools?: boolean;
  clock?: Clock;
}

const MAX_TOKEN_CONTINUATIONS = 3;
const MAX_TRANSPORT_RETRIES = 2;

/**
 * Eigener Tool-Loop im Format der Anthropic Messages API. Das Transkript wird nur angehängt (Prompt-
 * Caching, Thinking-Bindung): Assistenten-Inhalte gehen unverändert zurück, alle Tool-Ergebnisse
 * eines Schritts landen in genau einer User-Nachricht.
 */
export class DirectorLoop implements DirectorRuntime {
  private messages: CanonicalMessage[] = [];
  private extras = new Map<number, Record<string, unknown>>();
  private readonly store: TranscriptStore;
  private readonly toolsByName: Map<string, AnyDirectorTool>;
  private loaded = false;
  private readonly clock: Clock;

  constructor(private readonly options: DirectorLoopOptions) {
    this.store = options.store ?? new MemoryTranscriptStore();
    this.toolsByName = new Map(options.tools.map((t) => [t.name, t]));
    this.clock = options.clock ?? systemClock;
  }

  get id(): 'anthropic' | 'fal' {
    return this.options.transport.id;
  }

  /** Aktuelles Transkript-Segment (nur lesen). */
  get transcript(): readonly CanonicalMessage[] {
    return this.messages;
  }

  get transcriptExtras(): ReadonlyMap<number, Record<string, unknown>> {
    return this.extras;
  }

  async load(): Promise<void> {
    const replay = replayTranscript(await this.store.load());
    this.messages = replay.messages;
    this.extras = replay.extras;
    this.loaded = true;
  }

  private emit(event: LoopEvent): void {
    this.options.onEvent?.(event);
  }

  private async append(message: CanonicalMessage, extra?: Record<string, unknown>): Promise<void> {
    const copy = structuredClone(message);
    const entry: TranscriptEntry = { type: 'message', message: copy, ...(extra ? { extra } : {}) };
    if (extra) this.extras.set(this.messages.length, extra);
    this.messages.push(copy);
    await this.store.append([entry]);
  }

  async runTurn(input: RuntimeTurnInput): Promise<TurnResult> {
    if (!this.loaded) await this.load();
    const { runId, signal } = input;
    const transport = this.options.transport;
    const maxIterations = this.options.maxIterations ?? 60;
    const maxTurnCost = this.options.maxTurnCostUsd ?? 25;
    const texts: string[] = [];
    let iterations = 0;
    let costUsd = 0;
    let stopReason: TurnStopReason = 'end_turn';
    let error: string | undefined;
    let continuations = 0;
    let retries = 0;

    try {
      if (this.options.compaction && !transport.caps.serverCompaction && estimateTokens(this.messages) > this.options.compaction.thresholdTokens) {
        costUsd += await this.compact(runId, signal);
      }
      await this.appendUserTurn(input);

      for (;;) {
        if (signal.aborted) {
          stopReason = 'interrupted';
          break;
        }
        if (iterations >= maxIterations) {
          stopReason = 'max_iterations';
          this.emit({ type: 'notice', text: `Schrittlimit (${maxIterations}) erreicht – Turn beendet.` });
          break;
        }
        if (costUsd >= maxTurnCost) {
          stopReason = 'budget';
          this.emit({ type: 'notice', text: `Kostenbremse für diesen Turn erreicht ($${costUsd.toFixed(2)}).` });
          break;
        }
        iterations += 1;
        let response: TransportResponse;
        try {
          response = await transport.stream(
            {
              model: this.options.model,
              system: this.options.system,
              messages: this.messages,
              tools: this.options.tools,
              effort: typeof this.options.effort === 'function' ? this.options.effort() : this.options.effort,
              maxTokens: this.options.maxTokens ?? 64000,
              signal,
              extras: this.extras,
              ...(this.options.serverTools !== undefined ? { serverTools: this.options.serverTools } : {}),
            },
            (event) => this.onTransportEvent(event),
          );
        } catch (e) {
          if (isAbortError(e) || signal.aborted) {
            stopReason = 'interrupted';
          } else if ((e as { retryable?: boolean }).retryable && retries < MAX_TRANSPORT_RETRIES) {
            retries += 1;
            this.emit({ type: 'progress', text: `Antwort war nicht verarbeitbar – neuer Versuch (${retries}/${MAX_TRANSPORT_RETRIES}).` });
            continue;
          } else {
            stopReason = 'error';
            error = errorMessage(e);
          }
          break;
        }
        retries = 0;
        const cost = response.costUsd ?? tokenCostUsd(this.options.model, response.usage);
        costUsd += cost;
        this.emit({ type: 'usage', usage: response.usage, costUsd: cost, model: response.model ?? this.options.model });
        if (cost > 0) await this.options.recordUsage?.(runId, cost, `${this.options.model} (${transport.id})`);

        if (response.stopReason === 'refusal') {
          // Abgelehnte (ggf. abgeschnittene) Ausgabe nicht übernehmen und keine Tools ausführen.
          const category = response.stopDetails?.category;
          this.emit({ type: 'notice', text: `Der Director hat diese Anfrage abgelehnt${category ? ` (Kategorie: ${category})` : ''}.${response.stopDetails?.explanation ? ` ${response.stopDetails.explanation}` : ''}` });
          stopReason = 'refusal';
          break;
        }

        await this.append({ role: 'assistant', content: response.content }, response.extra);
        this.emit({ type: 'assistant', content: response.content });
        for (const block of response.content) if (block.type === 'text' && block.text.trim()) texts.push(block.text);

        if (response.stopReason === 'pause_turn' || response.stopReason === 'compaction') continue;

        const toolUses = response.content.filter((b): b is CanonicalToolUse => b.type === 'tool_use');
        if (response.stopReason === 'max_tokens' || response.stopReason === 'model_context_window_exceeded') {
          continuations += 1;
          const results: CanonicalBlock[] = toolUses.map((tu) => toToolResultBlock(tu.id, errorResult('Eingabe wurde wegen des Token-Limits abgeschnitten und nicht ausgeführt. Teile große Eingaben auf.')));
          results.push({ type: 'text', text: 'Deine letzte Antwort wurde wegen des Token-Limits abgeschnitten. Setze nahtlos fort.' });
          await this.append({ role: 'user', content: results });
          if (continuations > MAX_TOKEN_CONTINUATIONS) {
            stopReason = 'error';
            error = 'Antwort wiederholt abgeschnitten (max_tokens).';
            break;
          }
          continue;
        }
        if (toolUses.length === 0) {
          stopReason = 'end_turn';
          break;
        }
        const results = await this.executeTools(toolUses, runId, signal);
        await this.append({ role: 'user', content: results });
        if (signal.aborted) {
          stopReason = 'interrupted';
          break;
        }
      }
    } catch (e) {
      if (isAbortError(e) || signal.aborted) stopReason = 'interrupted';
      else {
        stopReason = 'error';
        error = errorMessage(e);
      }
    }
    await this.finalize(stopReason);
    return { stopReason, text: texts.join('\n\n'), iterations, costUsd, ...(error ? { error } : {}) };
  }

  /** User-Turn anhängen; Kontext je nach Fähigkeit als System-Nachricht danach oder als Präfix-Block. */
  private async appendUserTurn(input: RuntimeTurnInput): Promise<void> {
    const blocks: CanonicalBlock[] = typeof input.content === 'string' ? [{ type: 'text', text: input.content }] : [...input.content];
    const context = input.context?.trim();
    if (context && this.options.transport.caps.midConversationSystem) {
      await this.append({ role: 'user', content: blocks });
      // Mid-Conversation-System-Message: muss auf eine User-Nachricht folgen und letzte Nachricht sein
      // (oder von einem Assistenten-Turn gefolgt werden) → direkt nach dem User-Turn.
      await this.append({ role: 'system', content: context });
    } else if (context) {
      await this.append({ role: 'user', content: [{ type: 'text', text: `<studio-context>\n${context}\n</studio-context>` }, ...blocks] });
    } else {
      await this.append({ role: 'user', content: blocks });
    }
  }

  /** Hält das Transkript nach Abbruch/Fehler gültig. */
  private async finalize(stopReason: TurnStopReason): Promise<void> {
    if (stopReason === 'end_turn') return;
    const last = this.messages[this.messages.length - 1];
    if (!last) return;
    // Eine System-Nachricht muss von einem Assistenten-Turn gefolgt werden, sonst ist der nächste Turn
    // ungültig; nach einer Ablehnung schließt ein Hinweis den Turn sauber ab.
    if (last.role === 'system' || (stopReason === 'refusal' && last.role !== 'assistant')) {
      const note =
        stopReason === 'refusal'
          ? '[Diese Anfrage wurde abgelehnt; keine Aktion ausgeführt.]'
          : stopReason === 'interrupted'
            ? '[Vom Nutzer unterbrochen, bevor eine Antwort entstand.]'
            : '[Turn ohne Antwort beendet.]';
      await this.append({ role: 'assistant', content: [{ type: 'text', text: note }] });
    }
  }

  private onTransportEvent(event: TransportEvent): void {
    switch (event.type) {
      case 'text_delta':
        this.emit({ type: 'text_delta', text: event.text });
        break;
      case 'thinking_done':
        this.emit({ type: 'progress', text: event.text.trim() });
        break;
      case 'notice':
        this.emit({ type: 'notice', text: event.text });
        break;
      case 'server_tool_use':
        this.emit({ type: 'progress', text: event.name === 'web_search' ? 'Recherchiere im Web …' : event.name === 'web_fetch' ? 'Lese Webseite …' : `${event.name} …` });
        break;
      default:
        break;
    }
  }

  /** Führt Tools aus: 'none' parallel, 'local'/'paid' nacheinander; Ergebnisse in Aufrufreihenfolge. */
  private async executeTools(toolUses: CanonicalToolUse[], runId: string, signal: AbortSignal): Promise<CanonicalToolResult[]> {
    const ctx = this.options.makeToolContext(runId, signal);
    // Kein `new Array(n)`: `.map` überspringt Löcher in dünn besetzten Arrays.
    const results: Array<CanonicalToolResult | undefined> = Array.from({ length: toolUses.length }, () => undefined);
    const runOne = async (tu: CanonicalToolUse, index: number): Promise<void> => {
      this.emit({ type: 'tool_start', id: tu.id, name: tu.name, input: tu.input });
      const tool = this.toolsByName.get(tu.name);
      let result: ToolResult;
      if (!tool) {
        result = errorResult(`Unbekanntes Tool „${tu.name}“.`);
      } else {
        const parsed = parseToolInput(tool, tu.input);
        if (!parsed.ok) result = errorResult(parsed.error);
        else {
          try {
            result = await raceAbort(tool.run(parsed.value, ctx), signal);
          } catch (e) {
            if (isAbortError(e) || signal.aborted) throw e;
            result = errorResult(`Tool-Fehler in ${tu.name}: ${errorMessage(e)}`);
          }
        }
      }
      results[index] = toToolResultBlock(tu.id, result);
      this.emit({ type: 'tool_end', id: tu.id, name: tu.name, ok: !result.isError, summary: firstLine(resultText(result)) });
    };
    const sideEffect = (name: string) => this.toolsByName.get(name)?.sideEffect ?? 'none';
    const parallel = toolUses.map((tu, i) => ({ tu, i })).filter((x) => sideEffect(x.tu.name) === 'none');
    const serial = toolUses.map((tu, i) => ({ tu, i })).filter((x) => sideEffect(x.tu.name) !== 'none');
    try {
      await Promise.all([
        Promise.all(parallel.map((x) => runOne(x.tu, x.i))),
        (async () => {
          for (const x of serial) {
            if (signal.aborted) break;
            await runOne(x.tu, x.i);
          }
        })(),
      ]);
    } catch (e) {
      if (!isAbortError(e) && !signal.aborted) throw e;
    }
    return results.map((r, i) => {
      if (r) return r;
      const tu = toolUses[i]!;
      this.emit({ type: 'tool_end', id: tu.id, name: tu.name, ok: false, summary: 'unterbrochen' });
      return toToolResultBlock(tu.id, errorResult('Vom Nutzer unterbrochen – nicht (vollständig) ausgeführt.'));
    });
  }

  /** Clientseitige Kompaktierung: Zusammenfassung → neues Segment. Liefert die Kosten. */
  private async compact(runId: string, signal: AbortSignal): Promise<number> {
    const options = this.options.compaction as ClientCompactionOptions;
    const model = options.model ?? 'claude-sonnet-5-5';
    const dump = truncate(renderTranscriptText(this.messages), 600_000, '\n… [älteste Teile gekürzt]');
    const response = await this.options.transport.stream(
      {
        model,
        system: COMPACTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `<transcript>\n${dump}\n</transcript>\n\nFasse diese Sitzung für die nahtlose Fortsetzung zusammen.` }],
        tools: [],
        effort: 'medium',
        maxTokens: options.maxTokens ?? 8000,
        signal,
        serverTools: false,
      },
      () => undefined,
    );
    const summary = response.content
      .filter((b): b is Extract<CanonicalBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const cost = response.costUsd ?? tokenCostUsd(model, response.usage);
    if (cost > 0) await this.options.recordUsage?.(runId, cost, `Kompaktierung (${model})`);
    if (!summary) return cost;
    const replaced = this.messages.length;
    await this.store.append([{ type: 'compaction', summary, replaced, at: this.clock() }]);
    this.messages = [];
    this.extras = new Map();
    await this.append({
      role: 'user',
      content: `<conversation_summary>\n${summary}\n</conversation_summary>\nÄltere Turns wurden zusammengefasst (Kompaktierung). Arbeite auf Basis dieser Zusammenfassung nahtlos weiter.`,
    });
    // Die Zusammenfassung bekommt eine kurze Bestätigung, damit Rollen sauber abwechseln.
    await this.append({ role: 'assistant', content: [{ type: 'text', text: 'Verstanden – ich setze auf Basis der Zusammenfassung fort.' }] });
    this.emit({ type: 'compaction', summary });
    return cost;
  }
}

export function toToolResultBlock(toolUseId: string, result: ToolResult): CanonicalToolResult {
  const content = result.content.map((c) =>
    c.type === 'text'
      ? { type: 'text' as const, text: c.text.trim() ? c.text : '(leer)' }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: c.mediaType, data: c.data } },
  );
  return { type: 'tool_result', tool_use_id: toolUseId, content: content.length ? content : [{ type: 'text', text: '(leer)' }], ...(result.isError ? { is_error: true } : {}) };
}

/** Grobe Token-Schätzung (Zeichen/3.5, Bilder ~1600 Tokens). */
export function estimateTokens(messages: readonly CanonicalMessage[]): number {
  let chars = 0;
  let images = 0;
  const visit = (value: unknown): void => {
    if (typeof value === 'string') chars += value.length;
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (obj.type === 'image') {
        images += 1;
        return;
      }
      for (const [k, v] of Object.entries(obj)) if (k !== 'signature' && k !== 'data') visit(v);
    }
  };
  visit(messages);
  return Math.round(chars / 3.5) + images * 1600;
}

/** Textfassung eines Transkripts für die Zusammenfassung (ohne Bilder und Thinking). */
export function renderTranscriptText(messages: readonly CanonicalMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type === 'text') lines.push(`[${m.role}] ${truncate(b.text, 6000)}`);
      else if (b.type === 'tool_use') lines.push(`[${m.role} → ${b.name}] ${truncate(JSON.stringify(b.input), 1500)}`);
      else if (b.type === 'tool_result') {
        const text = typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join(' ');
        lines.push(`[tool_result${b.is_error ? ' FEHLER' : ''}] ${truncate(text, 1500)}`);
      }
    }
  }
  return lines.join('\n');
}
