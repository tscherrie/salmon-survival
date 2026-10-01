import type { DirectorEffort, DirectorRuntimeId } from '@studio/core';
import type { Clock } from './ports.ts';
import type { AnyDirectorTool, ToolContext } from './tools/registry.ts';
import type { TranscriptStore } from './transcript.ts';
import type { CanonicalBlock, TransportUsage } from './transports/types.ts';

/** Ereignisse einer Laufzeit (eigener Loop oder Agent SDK) an die Session. */
export type LoopEvent =
  | { type: 'text_delta'; text: string }
  /** Fortschrittsnotiz (Thinking-Update zwischen Tool-Aufrufen). */
  | { type: 'progress'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'usage'; usage: TransportUsage; costUsd: number; model: string }
  | { type: 'notice'; text: string }
  | { type: 'assistant'; content: CanonicalBlock[] }
  | { type: 'compaction'; summary: string };

export type TurnStopReason = 'end_turn' | 'interrupted' | 'max_iterations' | 'refusal' | 'budget' | 'error';

export interface TurnResult {
  stopReason: TurnStopReason;
  /** Gesamter Assistenten-Text dieses Turns. */
  text: string;
  iterations: number;
  costUsd: number;
  error?: string | undefined;
}

export type UserContent = string | CanonicalBlock[];

export interface RuntimeTurnInput {
  content: UserContent;
  /** Kontextblöcke (nur geänderte); Platzierung entscheidet die Laufzeit. */
  context?: string | undefined;
  runId: string;
  signal: AbortSignal;
}

export interface DirectorRuntime {
  readonly id: DirectorRuntimeId;
  /** Lädt das persistierte Transkript (Session-Start). */
  load(): Promise<void>;
  runTurn(input: RuntimeTurnInput): Promise<TurnResult>;
}

/** Was eine Laufzeit von der Session bekommt. */
export interface RuntimeSetup {
  tools: AnyDirectorTool[];
  system: string;
  model: string;
  effort: DirectorEffort;
  maxIterations: number;
  makeToolContext(runId: string, signal: AbortSignal): ToolContext;
  onEvent(event: LoopEvent): void;
  recordUsage(runId: string, usd: number, note: string): Promise<void>;
  /** Transkript-Speicher dieser Laufzeit. */
  store(runtimeId: string): TranscriptStore;
  projectDir: string;
  clock: Clock;
}
