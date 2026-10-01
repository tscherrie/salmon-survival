import type { Asset } from './assets.ts';
import type { BudgetSummary } from './budget.ts';
import type { Checkpoint } from './checkpoints.ts';
import type { ComposerSegment } from './composer.ts';
import type { Generation } from './generation.ts';
import type { ProjectManifest } from './project.ts';
import type { Ref } from './refs.ts';
import type { VersionMeta } from './versioning.ts';

/** Nachrichten im Director-Panel. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'director' | 'system';
  /** Für Nutzer: Composer-Segmente; für Director/System: Markdown-Text. */
  segments?: ComposerSegment[] | undefined;
  text: string;
  createdAt: string;
  runId?: string | undefined;
}

export interface QuestionOption {
  label: string;
  description?: string | undefined;
}

export interface DirectorQuestion {
  id: string;
  question: string;
  header?: string | undefined;
  options: QuestionOption[];
  multiSelect?: boolean | undefined;
}

export interface ApprovalRequest {
  id: string;
  kind: 'budget' | 'upload' | 'export';
  title: string;
  detail: string;
  amountUsd?: number | undefined;
  createdAt: string;
}

export type RunState = 'idle' | 'running' | 'waiting_user' | 'failed' | 'interrupted';

export interface ToolActivity {
  id: string;
  runId: string;
  name: string;
  status: 'started' | 'finished' | 'failed';
  summary?: string | undefined;
  startedAt: string;
  finishedAt?: string | undefined;
}

/** Alles, was die UI über einen Kanal (IPC) live erfährt. */
export type StudioEvent =
  | { type: 'message'; projectId: string; message: ChatMessage }
  | { type: 'message_delta'; projectId: string; messageId: string; delta: string }
  | { type: 'progress'; projectId: string; runId: string; text: string }
  | { type: 'tool'; projectId: string; activity: ToolActivity }
  | { type: 'question'; projectId: string; runId: string; questions: DirectorQuestion[]; questionId: string }
  | { type: 'question_resolved'; projectId: string; questionId: string }
  | { type: 'approval'; projectId: string; request: ApprovalRequest }
  | { type: 'approval_resolved'; projectId: string; approvalId: string; approved: boolean }
  | { type: 'checkpoints'; projectId: string; checkpoints: Checkpoint[] }
  | { type: 'budget'; projectId: string; summary: BudgetSummary }
  | { type: 'document'; projectId: string; version: VersionMeta }
  | { type: 'asset'; projectId: string; asset: Asset }
  | { type: 'generation'; projectId: string; generation: Generation }
  | { type: 'run_state'; projectId: string; runId: string | null; state: RunState; error?: string | undefined }
  | { type: 'manifest'; projectId: string; manifest: ProjectManifest }
  /** Element in der Web-Vorschau gewählt (Picker-Modus). */
  | { type: 'preview_pick'; projectId: string; ref: Ref; label?: string | undefined }
  | { type: 'preview_state'; projectId: string; url: string | null; status: 'starting' | 'ready' | 'error'; error?: string | undefined };

export type StudioEventType = StudioEvent['type'];
