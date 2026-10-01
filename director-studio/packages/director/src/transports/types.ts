import type Anthropic from '@anthropic-ai/sdk';
import type { DirectorEffort } from '@studio/core';
import type { AnyDirectorTool } from '../tools/registry.ts';

/** Kanonisches Transkript: Anthropic Messages (Beta-Typen), nur anhängen. */
export type CanonicalMessage = Anthropic.Beta.Messages.BetaMessageParam;
export type CanonicalBlock = Anthropic.Beta.Messages.BetaContentBlockParam;
export type CanonicalToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;
export type CanonicalToolUse = Anthropic.Beta.Messages.BetaToolUseBlockParam;

export interface TransportCaps {
  /** `{role:'system'}` mitten im Gespräch (Anthropic GA). Sonst `<studio-context>` im User-Turn. */
  midConversationSystem: boolean;
  /** Server-Tools `web_search`/`web_fetch`. Sonst eigene Tools über WebPort. */
  serverWebSearch: boolean;
  /** Serverseitige Kompaktierung. Sonst clientseitige Zusammenfassung. */
  serverCompaction: boolean;
  promptCache: 'native' | 'explicit-only' | 'none';
  thinkingRoundtrip: 'native' | 'reasoning_details' | 'none';
  effort: 'native' | 'verbosity' | 'none';
  vision: boolean;
}

export interface TransportUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface TransportRequest {
  /** Kanonische Modell-ID (z. B. `claude-opus-5-5`); der Transport übersetzt sie bei Bedarf. */
  model: string;
  /** Statischer, cachebarer Systemprompt. */
  system: string;
  messages: readonly CanonicalMessage[];
  tools: readonly AnyDirectorTool[];
  effort: DirectorEffort;
  maxTokens: number;
  signal?: AbortSignal | undefined;
  /** Transport-spezifische Zusatzdaten je Nachrichtenindex (z. B. `reasoning_details` beim fal-Router). */
  extras?: ReadonlyMap<number, Record<string, unknown>> | undefined;
  /** Server-Websuche anbieten (Standard: laut caps). Subagenten können sie abschalten. */
  serverTools?: boolean | undefined;
}

export type TransportEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; index: number; text: string }
  /** Ein Thinking-Block mit Text ist fertig – unter `display: "updates"` eine Fortschrittsnotiz. */
  | { type: 'thinking_done'; index: number; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'server_tool_use'; id: string; name: string }
  | { type: 'notice'; text: string };

export interface TransportResponse {
  /** Inhalt der Assistenten-Nachricht, kanonisch und unverändert zurückzuspielen. */
  content: CanonicalBlock[];
  stopReason: string;
  usage: TransportUsage;
  /** Kosten laut Anbieter (z. B. fal/OpenRouter `usage.cost`); sonst rechnet der Loop über Tokenpreise. */
  costUsd?: number | undefined;
  model?: string | undefined;
  stopDetails?: { category?: string | null | undefined; explanation?: string | null | undefined } | null | undefined;
  /** Sidecar-Daten zu dieser Assistenten-Nachricht (werden mit dem Transkript gespeichert). */
  extra?: Record<string, unknown> | undefined;
}

export interface ModelTransport {
  readonly id: 'anthropic' | 'fal';
  readonly caps: TransportCaps;
  stream(req: TransportRequest, onEvent: (event: TransportEvent) => void): Promise<TransportResponse>;
}

export const EMPTY_USAGE: TransportUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
