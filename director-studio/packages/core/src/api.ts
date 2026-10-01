import type { Asset, AssetQuery, LineageEdge } from './assets.ts';
import type { BudgetSummary } from './budget.ts';
import type { Checkpoint, CheckpointDecision, CheckpointStatus } from './checkpoints.ts';
import type { ComposerMessage } from './composer.ts';
import type { FormatSpec, ProjectCategory, StudioDocument } from './documents/index.ts';
import type { ApprovalRequest, ChatMessage, DirectorQuestion, RunState, StudioEvent, ToolActivity } from './events.ts';
import type { Generation } from './generation.ts';
import type { Modality, ModelInfo, PickerSelection, PickerState } from './models.ts';
import type { DirectorEffort, ProjectManifest } from './project.ts';
import type { Rect } from './refs.ts';
import type { Version, VersionMeta } from './versioning.ts';
import type { TranscriptWord } from './voice.ts';

export type PreviewViewport = 'mobile' | 'tablet' | 'desktop';

/**
 * Vertrag zwischen UI (Renderer) und Backend (Electron-Main). Die Preload-Schicht stellt ihn als
 * `window.studio` bereit; für Tests und den Browser-Modus gibt es eine In-Memory-Implementierung.
 */

export interface ProjectSnapshot {
  path: string;
  manifest: ProjectManifest;
  /** Aktuelles Dokument; `null`, solange das Projekt noch keine Kategorie (und damit kein Dokument) hat. */
  document: StudioDocument | null;
  versions: VersionMeta[];
  assets: Asset[];
  /** Asset-IDs, die im aktuellen Dokument verwendet werden. */
  usedAssetIds: string[];
  budget: BudgetSummary;
  checkpoints: Checkpoint[];
  messages: ChatMessage[];
  generations: Generation[];
  runState: RunState;
  /** Offene Rückfrage des Directors samt Lauf, aus dem sie stammt (`runId` fehlt bei älteren Backends). */
  pendingQuestion: { questionId: string; questions: DirectorQuestion[]; runId?: string | undefined } | null;
  pendingApprovals: ApprovalRequest[];
  activities: ToolActivity[];
}

export interface RecentProject {
  path: string;
  title: string;
  category: ProjectCategory | null;
  updatedAt: string;
  /** Standbild für den Startbildschirm (`studio-asset:`-URL); fehlt, solange das Projekt kein Bild verwendet. */
  poster?: string | undefined;
  /** Stand der Checkpoints: aktueller Schritt (`index` 1-basiert) von `total`, mit Titel und Status. */
  checkpoint?: { index: number; total: number; title: string; status: CheckpointStatus } | undefined;
  /** Budget beim letzten Schließen bzw. Öffnen. */
  budget?: { spentUsd: number; approvedUsd: number } | undefined;
}

export type DirectorRuntimeId = 'anthropic' | 'fal' | 'agent-sdk';

export interface AuthStatus {
  /** Verfügbare Director-Laufzeiten in Prioritätsreihenfolge. */
  runtimes: Array<{ id: DirectorRuntimeId; available: boolean; detail: string }>;
  active: DirectorRuntimeId | null;
  falConfigured: boolean;
  /** Anthropic-Anmeldung: API-Key hinterlegt bzw. OAuth-Profil (Claude-Abo) gefunden. */
  anthropic: { apiKey: boolean; oauthProfile: boolean };
}

export interface AppSettings {
  language: 'de' | 'en';
  defaultEffort: DirectorEffort;
  /** Bevorzugte Director-Laufzeit; `auto` = Anmeldekette. */
  preferredRuntime: DirectorRuntimeId | 'auto';
  projectsDir: string;
  /** Erlaubt die Claude-Abo-Anmeldung (nur Eigennutzung). */
  allowClaudeSubscription: boolean;
  /**
   * Picker-Defaults des Nutzers für neue Projekte (PLAN 4.3: „Default pro Nutzer“); fehlende Modalitäten
   * kommen aus `DEFAULT_PICKERS`. Zusammenführen mit `initialPickers()`.
   */
  defaultPickers?: PickerState | undefined;
}

export interface CreateProjectInput {
  title: string;
  category: ProjectCategory | null;
  directory?: string | undefined;
  formats?: FormatSpec[] | undefined;
}

export interface ExportOptions {
  format?: string | undefined;
  /** z. B. mp4, wav, pdf, pptx, png, zip */
  target: string;
}

export interface StudioApi {
  // App & Einstellungen
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  setSecret(name: 'anthropic' | 'fal', value: string | null): Promise<void>;
  getAuthStatus(): Promise<AuthStatus>;

  // Projekte
  listRecentProjects(): Promise<RecentProject[]>;
  createProject(input: CreateProjectInput): Promise<ProjectSnapshot>;
  openProject(path: string): Promise<ProjectSnapshot>;
  getSnapshot(projectId: string): Promise<ProjectSnapshot>;
  chooseDirectory(): Promise<string | null>;
  chooseFiles(): Promise<string[]>;

  // Director
  sendMessage(projectId: string, message: ComposerMessage): Promise<void>;
  interrupt(projectId: string): Promise<void>;
  answerQuestion(projectId: string, questionId: string, answers: Record<string, string>): Promise<void>;
  decideCheckpoint(projectId: string, checkpointId: string, decision: CheckpointDecision): Promise<void>;
  decideApproval(projectId: string, approvalId: string, approved: boolean): Promise<void>;
  setEffort(projectId: string, effort: DirectorEffort): Promise<void>;

  // Modelle
  listModels(modality?: Modality): Promise<ModelInfo[]>;
  refreshModels(): Promise<{ count: number; updatedAt: string }>;
  setPicker(projectId: string, modality: Modality, selection: PickerSelection): Promise<void>;

  // Assets
  importFiles(projectId: string, paths: string[], mode: 'link' | 'import'): Promise<Asset[]>;
  searchAssets(projectId: string, query: AssetQuery): Promise<Asset[]>;
  assetUrl(projectId: string, assetId: string, variant?: 'original' | 'proxy' | 'thumb'): string;
  revealAsset(projectId: string, assetId: string): Promise<void>;
  /** Lineage eines Assets: Kanten zu Eltern (`childId` = Asset) und Kindern (`parentId` = Asset). */
  getLineage(projectId: string, assetId: string): Promise<{ parents: LineageEdge[]; children: LineageEdge[] }>;
  /** Verknüpfte Datei neu zuordnen (z. B. nach Umbenennen/Verschieben des Ordners); ID und Verwendungen bleiben. */
  relinkAsset(projectId: string, assetId: string, newPath: string): Promise<Asset>;

  // Versionen
  getVersion(projectId: string, number: number): Promise<Version>;
  restoreVersion(projectId: string, number: number): Promise<void>;

  // Sprache
  transcribe(projectId: string, audio: ArrayBuffer, mime: string): Promise<{ text: string; words: TranscriptWord[] }>;

  /** Wellenform-Daten (min/max-Paare, normiert −1..1) eines Audio/Video-Assets; `null` wenn noch nicht berechnet. */
  assetPeaks(projectId: string, assetId: string): Promise<{ peaks: number[]; durationMs: number } | null>;

  // Web-Vorschau (eingebettetes Chromium; im Browser-Modus ein iframe)
  previewOpen(projectId: string, options: { viewport: PreviewViewport }): Promise<{ url: string }>;
  /** Position der eingebetteten Vorschau im Fenster (CSS-Pixel); `null` blendet sie aus. */
  previewSetBounds(projectId: string, bounds: Rect | null): Promise<void>;
  /** Element-Picker an/aus: Klicks erzeugen `preview_pick`-Ereignisse statt zu navigieren. */
  previewSetPickMode(projectId: string, enabled: boolean): Promise<void>;
  previewOpenExternal(projectId: string): Promise<void>;
  /** Navigiert die Web-Vorschau zu einem Seitenpfad der Site, z. B. `/about`. */
  previewNavigate(projectId: string, path: string): Promise<void>;

  // Export
  exportProject(projectId: string, options: ExportOptions): Promise<{ path: string }>;
  openExternal(url: string): Promise<void>;

  // Ereignisse
  onEvent(listener: (event: StudioEvent) => void): () => void;

  /** Nur Electron: Dateipfad einer per Drag & Drop abgelegten Datei (`webUtils.getPathForFile`). */
  pathForFile?(file: File): string;
}
