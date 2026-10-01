import type { Asset, AssetQuery } from './assets.ts';
import type { BudgetSummary } from './budget.ts';
import type { Checkpoint, CheckpointDecision } from './checkpoints.ts';
import type { ComposerMessage } from './composer.ts';
import type { FormatSpec, ProjectCategory, StudioDocument } from './documents/index.ts';
import type { ApprovalRequest, ChatMessage, DirectorQuestion, RunState, StudioEvent, ToolActivity } from './events.ts';
import type { Generation } from './generation.ts';
import type { Modality, ModelInfo, PickerSelection } from './models.ts';
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
  document: StudioDocument;
  versions: VersionMeta[];
  assets: Asset[];
  /** Asset-IDs, die im aktuellen Dokument verwendet werden. */
  usedAssetIds: string[];
  budget: BudgetSummary;
  checkpoints: Checkpoint[];
  messages: ChatMessage[];
  generations: Generation[];
  runState: RunState;
  pendingQuestion: { questionId: string; questions: DirectorQuestion[] } | null;
  pendingApprovals: ApprovalRequest[];
  activities: ToolActivity[];
}

export interface RecentProject {
  path: string;
  title: string;
  category: ProjectCategory | null;
  updatedAt: string;
}

export type DirectorRuntimeId = 'anthropic' | 'fal' | 'agent-sdk';

export interface AuthStatus {
  /** Verfügbare Director-Laufzeiten in Prioritätsreihenfolge. */
  runtimes: Array<{ id: DirectorRuntimeId; available: boolean; detail: string }>;
  active: DirectorRuntimeId | null;
  falConfigured: boolean;
}

export interface AppSettings {
  language: 'de' | 'en';
  defaultEffort: DirectorEffort;
  /** Bevorzugte Director-Laufzeit; `auto` = Anmeldekette. */
  preferredRuntime: DirectorRuntimeId | 'auto';
  projectsDir: string;
  /** Erlaubt die Claude-Abo-Anmeldung (nur Eigennutzung). */
  allowClaudeSubscription: boolean;
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

  // Export
  exportProject(projectId: string, options: ExportOptions): Promise<{ path: string }>;
  openExternal(url: string): Promise<void>;

  // Ereignisse
  onEvent(listener: (event: StudioEvent) => void): () => void;

  /** Nur Electron: Dateipfad einer per Drag & Drop abgelegten Datei (`webUtils.getPathForFile`). */
  pathForFile?(file: File): string;
}
