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
import { defaultCoach, type CoachState } from '../lib/coach.ts';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
  /** Optionale Aktion im Toast, z. B. „Rückgängig“ nach einer Referenz aus dem Monitor (DESIGN.md §7.4, §7.11). */
  action?: { label: string; run: () => void };
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

/** Genehmigung nach `approval_resolved`: Anfrage, Entscheidung und Zeitpunkt (Systemzeile im Verlauf). */
export interface DecidedApproval {
  request: ApprovalRequest;
  approved: boolean;
  decidedAt: string;
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
  /** Erledigte Genehmigungen dieser Sitzung: erscheinen im Verlauf nur noch als Systemzeile (DESIGN.md §7.6.2). */
  decidedApprovals: DecidedApproval[];
  generations: Generation[];
  runState: RunState;
  runId: string | null;
  runError: string | null;
  preview: { url: string | null; status: 'idle' | 'starting' | 'ready' | 'error'; error: string | null };
  /** Ältere Version im Nur-Ansehen-Modus. */
  viewing: { number: number; document: StudioDocument } | null;

  /** Composer-Inhalt. Geschrieben wird nur über `writeComposer` im Store (Nummern, Revision; DESIGN.md §8.7). */
  composer: ComposerSegment[];
  /** Einfügeposition (Zeichen zählen 1, Chips zählen 1 – wie `insertRefAt`). */
  caret: number;
  /** Erhöht sich bei jedem Schreiben des Composers; der Editor baut sein DOM neu auf, wenn er die Änderung nicht selbst verursacht hat. */
  composerRevision: number;
  /** Nummer je Referenz-Schlüssel (`refKey`) der Chips im Composer (§9.3); Assets und Versionen haben keine. */
  refNumbers: Record<string, number>;
  /** Schlüssel der Referenz unter dem Pointer (Chip, Marker, Clip …): Gegenstücke bekommen `.is-linked` (§9.4). */
  hoveredRefKey: string | null;
  /** Verknüpfungs-Blitz (600 ms) auf allen Gegenstücken einer Referenz. */
  flash: { key: string; nonce: number } | null;
  /** Zuletzt gesetzter Marker (Settle-Animation, §5). */
  lastMarkerKey: string | null;
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
  /** Einmalige Hinweise (§8.6); der Store liest und speichert sie in `lib/coach.ts`. */
  coach: CoachState;
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
    decidedApprovals: [],
    generations: [],
    runState: 'idle',
    runId: null,
    runError: null,
    preview: { url: null, status: 'idle', error: null },
    viewing: null,
    composer: [],
    caret: 0,
    composerRevision: 0,
    refNumbers: {},
    hoveredRefKey: null,
    flash: null,
    lastMarkerKey: null,
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
    coach: defaultCoach(),
  };
}
