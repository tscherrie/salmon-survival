import type { ApprovalRequest, DirectorQuestion, IdGenerator, Modality, ModelInfo, StudioEvent } from '@studio/core';

/**
 * Ports: Der Director hängt nur von diesen Schnittstellen ab. Die Desktop-App verdrahtet die echten
 * Implementierungen (@studio/fal, @studio/media, @studio/render, Session/IPC). Tests nutzen Fakes.
 *
 * Für Ergebnisse paralleler Pakete (Media) sind die Typen bewusst locker gehalten; der Director
 * normalisiert sie defensiv (siehe `normalize.ts`).
 */

// ───────────────────────── Modelle (fal-Katalog) ─────────────────────────

export interface CostEstimate {
  usd: number;
  /** Rechenweg in Worten, z. B. „5 s × $0.16/s“. */
  basis: string;
  /** `true`, wenn der Preis exakt feststeht (z. B. Pauschalpreis je Aufruf). */
  exact: boolean;
}

/** Implementiert von `@studio/fal` (ModelRegistry) mit genau diesen Methodennamen. */
export interface ModelCatalogPort {
  list(modality?: Modality): ModelInfo[];
  get(id: string): ModelInfo | undefined;
  search(q: { modality?: Modality; text?: string }): ModelInfo[];
  /** Beschreibung des Modells (Markdown/Text aus fal). */
  describe(id: string): Promise<string>;
  /** JSON-Schema der Eingabe (aus dem OpenAPI-Dokument). */
  getInputSchema(id: string): Promise<Record<string, unknown>>;
  validate(id: string, input: unknown): Promise<{ ok: boolean; errors: string[] }>;
  estimate(id: string, input: unknown): Promise<CostEstimate>;
}

// ───────────────────────── Generierung (fal Queue) ─────────────────────────

export interface QueueHandle {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
  endpointId: string;
}

export interface QueueStatus {
  state: string;
  queuePosition?: number;
  logs: string[];
}

export interface GenerationRunOptions {
  signal?: AbortSignal;
  /** Wird aufgerufen, sobald fal die Anfrage angenommen hat (request_id bekannt). */
  onSubmitted?: (handle: QueueHandle) => void | Promise<void>;
  onStatus?: (status: QueueStatus) => void;
}

export type MediaOutputKind = 'image' | 'video' | 'audio' | 'file' | 'text';

export interface MediaOutput {
  url: string;
  kind: MediaOutputKind;
  contentType?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  fileName?: string;
  /** Für reine Textausgaben (z. B. Transkript ohne Datei). */
  text?: string;
}

/** Implementiert von `@studio/fal` (Queue-Runner + Storage). */
export interface GenerationPort {
  /** Reicht ein, pollt bis zum Ende und liefert die Ausgabe. Abbruch über `signal` (fal cancel). */
  run(endpointId: string, input: Record<string, unknown>, opts: GenerationRunOptions): Promise<{ output: unknown }>;
  /**
   * Optional: setzt das Polling einer bereits eingereichten Anfrage fort (Absturz-Wiederaufnahme).
   * `statusUrl`/`responseUrl`/`cancelUrl` fehlen evtl. bei alten Journal-Einträgen.
   */
  resume?(handle: Pick<QueueHandle, 'requestId' | 'endpointId'> & Partial<QueueHandle>, opts: Omit<GenerationRunOptions, 'onSubmitted'>): Promise<{ output: unknown }>;
  /** Lädt eine lokale Datei temporär in den fal-Storage und liefert die URL. */
  uploadFile(path: string, contentType?: string): Promise<string>;
  /** Findet Medien-Ausgaben in einer Modellantwort (wird mit `output` aus `run()` aufgerufen). */
  extractMediaOutputs(result: unknown): MediaOutput[];
  /** Lädt eine (temporäre) fal-URL in `destDir` herunter. */
  download(url: string, destDir: string): Promise<{ path: string; contentType: string; bytes: number }>;
}

// ───────────────────────── Medien (ffmpeg, Analyse) ─────────────────────────

/** Spiegelt die Methodennamen von `@studio/media` (MediaToolkit). Ergebnisse werden normalisiert. */
export interface MediaPort {
  probe(path: string): Promise<unknown>;
  extractFrames(src: string, timesSec: number[], outDir: string, opts?: { width?: number; format?: 'png' | 'jpg' }): Promise<unknown>;
  contactSheet(src: string, out: string, opts: { count?: number; columns?: number; width?: number }): Promise<unknown>;
  cutAudio(src: string, out: string, range: { fromSec: number; toSec: number; handlesSec: number }): Promise<unknown>;
  detectBeats(src: string): Promise<unknown>;
  loudness(src: string): Promise<unknown>;
  peaks(src: string): Promise<unknown>;
  checkAvSync(input: { videoPath: string; referenceAudioPath: string; roi?: { x: number; y: number; width: number; height: number } }): Promise<unknown>;
}

// ───────────────────────── Rendern & Export ─────────────────────────

export type SiteViewport = 'mobile' | 'tablet' | 'desktop';

/** Implementiert vom Render-Worker; der Integrator bindet aktuelles Projekt und Dokument. */
export interface RenderPort {
  compileComponent(source: string, opts: { fileName: string }): Promise<{ ok: boolean; code?: string; errors: string[]; warnings: string[] }>;
  renderTimelineStill(input: { frame: number; formatId?: string; out: string }): Promise<string>;
  renderTimelinePreview?(input: { fromFrame: number; toFrame: number; formatId?: string; out: string; scale?: number }): Promise<string>;
  renderDocumentPng(input: { slideId?: string; out: string }): Promise<string>;
  screenshotSite(input: { viewports: SiteViewport[]; outDir: string; path?: string }): Promise<{
    shots: Array<{ viewport: string; path: string }>;
    consoleErrors: string[];
    pageErrors: string[];
  }>;
  exportProject(target: string): Promise<{ path: string }>;
}

// ───────────────────────── Transkription ─────────────────────────

export interface TranscribedWord {
  text: string;
  /** Sekunden relativ zum Dateianfang. */
  start: number;
  end: number;
  speaker?: string;
}

export interface TranscribePort {
  transcribe(path: string, opts?: { language?: string }): Promise<{ text: string; words: TranscribedWord[]; language?: string }>;
}

// ───────────────────────── Web (Fallback ohne Server-Websuche) ─────────────────────────

export interface WebPort {
  search?(query: string): Promise<Array<{ title: string; url: string; snippet: string }>>;
  fetch?(url: string): Promise<{ title?: string; text: string; contentType: string }>;
}

// ───────────────────────── UI ─────────────────────────

/** Wie der Director mit dem Nutzer spricht (implementiert von Session/App, z. B. {@link InteractiveUi}). */
export interface UiPort {
  emit(event: StudioEvent): void;
  /** Blockiert, bis der Nutzer geantwortet hat. Ergebnis: Frage-ID → Antwort (Label oder Freitext). */
  askUser(questions: DirectorQuestion[], signal: AbortSignal): Promise<Record<string, string>>;
  /** Approval-Karte (Budget, Upload, Export); `true` = freigegeben. */
  requestApproval(req: Omit<ApprovalRequest, 'id' | 'createdAt'>, signal: AbortSignal): Promise<boolean>;
}

// ───────────────────────── Uhr & IDs ─────────────────────────

/** Liefert den aktuellen Zeitpunkt als ISO-String. */
export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

export type { IdGenerator };
