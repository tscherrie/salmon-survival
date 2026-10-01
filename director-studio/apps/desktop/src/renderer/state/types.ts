import type {
  AppSettings,
  ApprovalRequest,
  Asset,
  AuthStatus,
  BudgetSummary,
  ChatMessage,
  Checkpoint,
  ComposerMessage,
  ComposerSegment,
  DirectorQuestion,
  Generation,
  ModelInfo,
  PreviewViewport,
  ProjectManifest,
  RecentProject,
  RunState,
  StudioDocument,
  ToolActivity,
  VersionMeta,
  VoiceClick,
} from '@studio/core';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface ProgressNote {
  id: string;
  runId: string;
  text: string;
  at: string;
}

export interface VoiceState {
  recording: boolean;
  /** `performance.now()` beim Aufnahmestart. */
  startedAt: number;
  clicks: VoiceClick[];
  transcribing: boolean;
  /** Eingangspegel 0..1 (Level-Meter). */
  level: number;
}

/** Steuerung des Players (vom Monitor registriert). */
export interface Transport {
  play(): void;
  pause(): void;
  toggle(): void;
  isPlaying(): boolean;
}

export interface PendingQuestion {
  questionId: string;
  questions: DirectorQuestion[];
  runId: string | null;
}

export interface StudioData {
  screen: 'start' | 'workspace';
  settings: AppSettings | null;
  authStatus: AuthStatus | null;
  recent: RecentProject[];
  models: ModelInfo[] | null;
  toasts: Toast[];
  /** Text für die aria-live-Region (Screenreader). */
  announcement: string;
  /** Anzahl offener Dialoge/Popover (die native Web-Vorschau wird dann ausgeblendet). */
  overlays: number;

  projectId: string | null;
  path: string | null;
  manifest: ProjectManifest | null;
  /** Aktuelles Dokument (Kopf-Version); `null`, solange die Kategorie offen ist. */
  document: StudioDocument | null;
  documentVersion: number;
  versions: VersionMeta[];
  assets: Asset[];
  usedAssetIds: string[];
  budget: BudgetSummary | null;
  checkpoints: Checkpoint[];
  messages: ChatMessage[];
  /** Live-Text laufender Director-Nachrichten (messageId → Text). */
  streaming: Record<string, string>;
  progress: ProgressNote[];
  activities: ToolActivity[];
  question: PendingQuestion | null;
  approvals: ApprovalRequest[];
  generations: Generation[];
  runState: RunState;
  runId: string | null;
  runError: string | null;
  preview: { url: string | null; status: 'idle' | 'starting' | 'ready' | 'error'; error: string | null };
  /** Ältere Version im Nur-Ansehen-Modus. */
  viewing: { number: number; document: StudioDocument } | null;

  composer: ComposerSegment[];
  /** Einfügeposition (Zeichen zählen 1, Chips zählen 1 – wie `insertRefAt`). */
  caret: number;
  /** Erhöht sich bei externen Einfügungen, damit der Editor sein DOM neu aufbaut. */
  composerRevision: number;
  queue: ComposerMessage[];

  playhead: number;
  playing: boolean;
  playbackRate: number;
  seekRequest: { frame: number; nonce: number } | null;
  transport: Transport | null;
  formatId: string | null;
  safeArea: boolean;
  selectedSlideId: string | null;
  selectedPageId: string | null;
  activeTrackId: string | null;
  viewport: PreviewViewport;

  voice: VoiceState;
}

export const initialVoice: VoiceState = { recording: false, startedAt: 0, clicks: [], transcribing: false, level: 0 };

export function initialData(): StudioData {
  return {
    screen: 'start',
    settings: null,
    authStatus: null,
    recent: [],
    models: null,
    toasts: [],
    announcement: '',
    overlays: 0,
    projectId: null,
    path: null,
    manifest: null,
    document: null,
    documentVersion: 0,
    versions: [],
    assets: [],
    usedAssetIds: [],
    budget: null,
    checkpoints: [],
    messages: [],
    streaming: {},
    progress: [],
    activities: [],
    question: null,
    approvals: [],
    generations: [],
    runState: 'idle',
    runId: null,
    runError: null,
    preview: { url: null, status: 'idle', error: null },
    viewing: null,
    composer: [],
    caret: 0,
    composerRevision: 0,
    queue: [],
    playhead: 0,
    playing: false,
    playbackRate: 1,
    seekRequest: null,
    transport: null,
    formatId: null,
    safeArea: false,
    selectedSlideId: null,
    selectedPageId: null,
    activeTrackId: null,
    viewport: 'desktop',
    voice: initialVoice,
  };
}
