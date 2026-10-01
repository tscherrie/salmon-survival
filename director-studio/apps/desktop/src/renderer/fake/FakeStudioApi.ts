import {
  BudgetLedger,
  CATEGORY_LABELS,
  DEFAULT_PICKERS,
  InMemoryVersionStore,
  PROJECT_SCHEMA_VERSION,
  STANDARD_FORMATS,
  applyDocumentOps,
  assetKindFromMime,
  clipsAtFrame,
  composerToDisplayText,
  createCheckpoints,
  createDocument,
  decideCheckpoint as decideCheckpointCore,
  documentAssetIds,
  filterAssets,
  formatTimecode,
  mimeFromExtension,
  modelMatchesModality,
  parseDataSrc,
  proposeCheckpoint,
  refSchema,
  restoreVersion as restoreVersionCore,
  type AppSettings,
  type ApprovalRequest,
  type Asset,
  type AssetQuery,
  type AuthStatus,
  type ChatMessage,
  type Checkpoint,
  type CheckpointDecision,
  type ComposerMessage,
  type CreateProjectInput,
  type DirectorEffort,
  type DirectorQuestion,
  type DocumentOp,
  type ExportOptions,
  type Generation,
  type IdGenerator,
  type LineageEdge,
  type Modality,
  type ModelInfo,
  type PickerSelection,
  type PreviewViewport,
  type ProjectCategory,
  type ProjectManifest,
  type ProjectSnapshot,
  type RecentProject,
  type Rect,
  type Ref,
  type RunState,
  type StudioApi,
  type StudioDocument,
  type StudioEvent,
  type Timeline,
  type ToolActivity,
  type TranscriptWord,
  type Version,
} from '@studio/core';
import { DEMO_MODELS } from './demoModels.ts';
import { DEMO_ROOT, DEMO_VIDEO_ID, DEMO_VIDEO_PATH, buildDemoProjects, type DemoProjectSeed, type MediaSpec } from './demoProjects.ts';
import { makePeaks, makeWavDataUri, placeholderGlyph, placeholderImage, textDataUri } from './placeholders.ts';
import { lineageEdgesOf } from '../lib/assets.ts';
import { PICK_MESSAGE, type PickMessage } from '../lib/previewMessages.ts';
import { demoSiteUrl } from './sitePreview.ts';

/**
 * Vollständige In-Memory-Implementierung von `StudioApi` für Browser-Dev, Tests und E2E.
 * Enthält Demo-Projekte (je Kategorie), Demo-Modelle und einen geskripteten Director:
 * Planungsfrage → Antwort → Checkpoint-Vorschlag → Freigabe → Generierung + neue Version.
 */

export interface FakeStudioApiOptions {
  /** Pause zwischen Streaming-Schritten (ms). Tests: 0. */
  delayMs?: number;
  /** Demo-Projekte anlegen (Standard: true). */
  seed?: boolean;
  /** Zusätzlich ein 5-Minuten-Projekt mit ~200 Clips und ~640 Beat-Markern (Performance). */
  largeDemo?: boolean;
}

interface FakeRun {
  id: string;
  canceled: boolean;
  streamingMessageId: string | null;
  streamedText: string;
}

interface FakeProject {
  path: string;
  manifest: ProjectManifest;
  versions: InMemoryVersionStore;
  commitTime: string | null;
  assets: Asset[];
  media: Map<string, MediaSpec>;
  mediaCache: Map<string, string>;
  peakSpecs: Map<string, { bpm?: number; level?: number }>;
  peaksCache: Map<string, { peaks: number[]; durationMs: number }>;
  messages: ChatMessage[];
  generations: Generation[];
  ledger: BudgetLedger;
  runState: RunState;
  run: FakeRun | null;
  runPromise: Promise<void> | null;
  pendingQuestion: { questionId: string; questions: DirectorQuestion[]; runId: string } | null;
  pendingApprovals: ApprovalRequest[];
  activities: ToolActivity[];
  script: { asked: boolean; approvalsRequested: number; notes: number };
}

class Canceled extends Error {
  constructor() {
    super('canceled');
  }
}

const DEFAULT_TRANSCRIPT_TEXT = 'Mach diese Stelle etwas dunkler und nimm hier die Gitarre raus';

function defaultTranscript(): { text: string; words: TranscriptWord[] } {
  const words = DEFAULT_TRANSCRIPT_TEXT.split(' ').map((text, i) => ({ text, start: 0.2 + i * 0.4, end: 0.2 + i * 0.4 + 0.32 }));
  return { text: DEFAULT_TRANSCRIPT_TEXT, words };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Projekt';
}

export interface FakeDebug {
  /** Protokoll aller API-Aufrufe (Methode + Argumente). */
  readonly calls: Array<{ method: string; args: unknown[] }>;
  emit(event: StudioEvent): void;
  demoProjectId: string;
  demoProjectPath: string;
  setTranscript(words: TranscriptWord[], text?: string): void;
  setNextDirectory(path: string | null): void;
  setNextFiles(paths: string[]): void;
  setDelay(ms: number): void;
  /** Simuliert ein Anthropic-Login-Profil (`ant auth login`). */
  setAnthropicProfile(present: boolean): void;
  /** Markiert die Datei eines verknüpften Assets als fehlend (`metadata.missing`) bzw. wieder vorhanden. */
  setLinkedMissing(projectId: string, assetId: string, missing?: boolean): Asset;
  triggerApproval(projectId: string, request?: Partial<ApprovalRequest>): ApprovalRequest;
  triggerQuestion(projectId: string, questions?: DirectorQuestion[]): string;
  proposeCheckpoint(projectId: string, checkpointId?: string, budgetUsd?: number): Promise<Checkpoint>;
  createLargeProject(): Promise<string>;
  /** Wartet, bis der laufende Director-Lauf beendet ist. */
  whenIdle(projectId: string): Promise<void>;
  project(projectId: string): FakeProject;
}

export class FakeStudioApi implements StudioApi {
  /** Markierung für `apiModeOf` (Browser-/Testmodus). */
  readonly isFake = true;
  readonly debug: FakeDebug;
  private readonly listeners = new Set<(event: StudioEvent) => void>();
  private readonly projects = new Map<string, FakeProject>();
  private readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private readonly ready: Promise<void>;
  private readonly ids: IdGenerator;
  private delayMs: number;
  private settings: AppSettings = {
    language: 'de',
    defaultEffort: 'xhigh',
    preferredRuntime: 'auto',
    projectsDir: DEMO_ROOT,
    allowClaudeSubscription: false,
  };
  /** Nur „gesetzt / nicht gesetzt“ – die Werte selbst werden nie gespeichert oder zurückgegeben. */
  private readonly secrets = { anthropic: true, fal: false };
  /** Simuliertes OAuth-Profil aus `ant auth login`. */
  private anthropicProfile = false;
  private transcript = defaultTranscript();
  private nextDirectory: string | null = null;
  private nextFiles: string[] | null = null;
  private previewProjectId: string | null = null;
  private readonly onWindowMessage = (event: MessageEvent) => this.handleWindowMessage(event);

  constructor(options: FakeStudioApiOptions = {}) {
    this.delayMs = options.delayMs ?? 30;
    let counter = 0;
    this.ids = (prefix) => `${prefix}_f${(++counter).toString(36)}`;
    const seeds = options.seed === false ? [] : buildDemoProjects();
    this.ready = (async () => {
      for (const seed of seeds) await this.addSeed(seed);
      if (options.largeDemo) await this.createLargeProject();
    })();
    if (typeof window !== 'undefined') window.addEventListener('message', this.onWindowMessage);
    const self = this;
    this.debug = {
      calls: this.calls,
      emit: (event) => this.emit(event),
      demoProjectId: DEMO_VIDEO_ID,
      demoProjectPath: DEMO_VIDEO_PATH,
      setTranscript: (words, text) => {
        this.transcript = { words, text: text ?? words.map((w) => w.text).join(' ') };
      },
      setNextDirectory: (path) => {
        this.nextDirectory = path;
      },
      setNextFiles: (paths) => {
        this.nextFiles = paths;
      },
      setDelay: (ms) => {
        this.delayMs = ms;
      },
      setAnthropicProfile: (present) => {
        this.anthropicProfile = present;
      },
      setLinkedMissing: (projectId, assetId, missing = true) => {
        const p = this.project(projectId);
        const index = p.assets.findIndex((a) => a.id === assetId);
        const current = p.assets[index];
        if (!current || current.source !== 'linked') throw new Error(`Asset "${assetId}" ist keine verknüpfte Datei`);
        const { missing: _old, ...rest } = current.metadata ?? {};
        const metadata = missing ? { ...rest, missing: true } : rest;
        const next: Asset = { ...current };
        if (Object.keys(metadata).length) next.metadata = metadata;
        else delete next.metadata;
        p.assets[index] = next;
        this.emit({ type: 'asset', projectId, asset: next });
        return clone(next);
      },
      triggerApproval: (projectId, request) => {
        const p = this.project(projectId);
        const full: ApprovalRequest = {
          id: request?.id ?? this.ids('apr'),
          kind: request?.kind ?? 'budget',
          title: request?.title ?? 'Zusatzbudget für 4K-Upscaling',
          detail: request?.detail ?? 'Upscaling aller Shots mit Topaz Video Upscale (geschätzt).',
          amountUsd: request?.amountUsd ?? 8.4,
          createdAt: new Date().toISOString(),
        };
        p.pendingApprovals.push(full);
        this.emit({ type: 'approval', projectId, request: full });
        return full;
      },
      triggerQuestion: (projectId, questions) => {
        const p = this.project(projectId);
        const questionId = this.ids('q');
        const runId = p.run?.id ?? this.ids('run');
        const qs = questions ?? this.planningQuestions(p);
        p.pendingQuestion = { questionId, questions: qs, runId };
        this.emit({ type: 'question', projectId, runId, questionId, questions: qs });
        return questionId;
      },
      proposeCheckpoint: async (projectId, checkpointId, budgetUsd) => {
        await this.ready;
        const p = this.project(projectId);
        return this.propose(p, checkpointId, budgetUsd ?? 12.5, 'Treatment: nächtliche Fahrt durch die Stadt, Auflösung im Morgengrauen.');
      },
      createLargeProject: () => this.createLargeProject(),
      whenIdle: async (projectId) => {
        await this.ready;
        const p = this.project(projectId);
        while (p.runPromise) {
          const current = p.runPromise;
          await current;
          if (p.runPromise === current) break;
        }
      },
      project: (projectId) => self.project(projectId),
    };
  }

  dispose(): void {
    if (typeof window !== 'undefined') window.removeEventListener('message', this.onWindowMessage);
    for (const p of this.projects.values()) if (p.run) p.run.canceled = true;
    this.listeners.clear();
  }

  // ───────────────────────── Interna ─────────────────────────

  private log(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  private emit(event: StudioEvent): void {
    for (const listener of [...this.listeners]) listener(clone(event));
  }

  private project(projectId: string): FakeProject {
    const p = this.projects.get(projectId);
    if (!p) throw new Error(`Unbekanntes Projekt: ${projectId}`);
    return p;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private newProject(path: string, manifest: ProjectManifest): FakeProject {
    const p: FakeProject = {
      path,
      manifest,
      versions: new InMemoryVersionStore(() => p.commitTime ?? this.now()),
      commitTime: null,
      assets: [],
      media: new Map(),
      mediaCache: new Map(),
      peakSpecs: new Map(),
      peaksCache: new Map(),
      messages: [],
      generations: [],
      ledger: new BudgetLedger({}, () => this.now(), () => this.ids('led')),
      runState: 'idle',
      run: null,
      runPromise: null,
      pendingQuestion: null,
      pendingApprovals: [],
      activities: [],
      script: { asked: false, approvalsRequested: 0, notes: 0 },
    };
    this.projects.set(manifest.id, p);
    return p;
  }

  private async addSeed(seed: DemoProjectSeed): Promise<void> {
    const p = this.newProject(seed.path, clone(seed.manifest));
    p.assets = clone(seed.assets);
    for (const [id, spec] of Object.entries(seed.media)) p.media.set(id, spec);
    for (const [id, spec] of Object.entries(seed.peaks)) p.peakSpecs.set(id, spec);
    p.messages = clone(seed.messages);
    p.generations = clone(seed.generations);
    // Laufende/wartende Demo-Jobs „jetzt“ starten lassen (sonst zeigt die Warteschlange Tage an)
    p.generations.forEach((g, i) => {
      if (g.status === 'running' || g.status === 'queued') {
        const at = new Date(Date.now() - (40 + i * 5) * 1000).toISOString();
        g.createdAt = at;
        if (g.submittedAt) g.submittedAt = at;
      }
    });
    p.ledger = new BudgetLedger(clone(seed.ledger), () => this.now(), () => this.ids('led'));
    if (seed.initialDocument) {
      p.commitTime = seed.manifest.createdAt;
      let doc = seed.initialDocument;
      await p.versions.commit({ document: doc, ops: [], note: 'Projekt angelegt', author: 'system' });
      for (const v of seed.versions) {
        doc = applyDocumentOps(doc, v.ops, this.opContext(p));
        p.commitTime = v.createdAt;
        await p.versions.commit({ document: doc, ops: v.ops, note: v.note, author: v.author });
      }
      p.commitTime = null;
    }
  }

  private opContext(p: FakeProject) {
    return { assetKind: (id: string) => p.assets.find((a) => a.id === id)?.kind };
  }

  private async head(p: FakeProject): Promise<StudioDocument | null> {
    return (await p.versions.head())?.document ?? null;
  }

  private async snapshot(p: FakeProject): Promise<ProjectSnapshot> {
    const document = await this.head(p);
    return clone({
      path: p.path,
      manifest: p.manifest,
      // Projekte ohne Kategorie haben noch kein Dokument (`null`, bis der Director sie festlegt).
      document,
      versions: await p.versions.list(),
      assets: p.assets,
      usedAssetIds: document ? [...documentAssetIds(document)] : [],
      budget: p.ledger.summary(),
      checkpoints: p.manifest.checkpoints,
      messages: p.messages,
      generations: p.generations,
      runState: p.runState,
      pendingQuestion: p.pendingQuestion ? { questionId: p.pendingQuestion.questionId, questions: p.pendingQuestion.questions, runId: p.pendingQuestion.runId } : null,
      pendingApprovals: p.pendingApprovals,
      activities: p.activities,
    });
  }

  private touch(p: FakeProject): void {
    p.manifest.updatedAt = this.now();
  }

  private emitManifest(p: FakeProject): void {
    this.touch(p);
    this.emit({ type: 'manifest', projectId: p.manifest.id, manifest: p.manifest });
  }

  private async commit(p: FakeProject, ops: DocumentOp[], note: string, runId?: string): Promise<number> {
    const head = await p.versions.head();
    if (!head) throw new Error('Projekt hat noch kein Dokument');
    const document = applyDocumentOps(head.document, ops, this.opContext(p));
    const version = await p.versions.commit({ document, ops, note, author: 'director', runId });
    const { document: _d, ops: _o, ...meta } = version;
    this.touch(p);
    this.emit({ type: 'document', projectId: p.manifest.id, version: meta });
    return version.number;
  }

  private addAsset(p: FakeProject, asset: Asset, media?: MediaSpec): Asset {
    p.assets.push(asset);
    if (media) p.media.set(asset.id, media);
    this.emit({ type: 'asset', projectId: p.manifest.id, asset });
    return asset;
  }

  private setRunState(p: FakeProject, runId: string | null, state: RunState, error?: string): void {
    p.runState = state;
    this.emit({ type: 'run_state', projectId: p.manifest.id, runId, state, ...(error ? { error } : {}) });
  }

  private async sleep(run: FakeRun, factor = 1): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, Math.round(this.delayMs * factor)));
    if (run.canceled) throw new Canceled();
  }

  /** Startet einen Director-Lauf; ein laufender wird abgebrochen. */
  private startRun(p: FakeProject, script: (run: FakeRun) => Promise<void>): void {
    if (p.run) p.run.canceled = true;
    const run: FakeRun = { id: this.ids('run'), canceled: false, streamingMessageId: null, streamedText: '' };
    p.run = run;
    this.setRunState(p, run.id, 'running');
    const holder: { promise: Promise<void> | null } = { promise: null };
    holder.promise = (async () => {
      try {
        await script(run);
      } catch (error) {
        if (error instanceof Canceled) return;
        this.setRunState(p, run.id, 'failed', (error as Error).message);
      } finally {
        if (p.run === run) p.run = null;
        if (p.runPromise === holder.promise) p.runPromise = null;
      }
    })();
    p.runPromise = holder.promise;
  }

  private async stream(p: FakeProject, run: FakeRun, text: string): Promise<ChatMessage> {
    const messageId = this.ids('msg');
    run.streamingMessageId = messageId;
    run.streamedText = '';
    const chunks = text.match(/\S+\s*/g) ?? [text];
    for (let i = 0; i < chunks.length; i += 2) {
      await this.sleep(run);
      const delta = chunks.slice(i, i + 2).join('');
      run.streamedText += delta;
      this.emit({ type: 'message_delta', projectId: p.manifest.id, messageId, delta });
    }
    await this.sleep(run);
    const message: ChatMessage = { id: messageId, role: 'director', text, createdAt: this.now(), runId: run.id };
    p.messages.push(message);
    run.streamingMessageId = null;
    this.emit({ type: 'message', projectId: p.manifest.id, message });
    return message;
  }

  private async tool<T>(p: FakeProject, run: FakeRun, name: string, summary: string, body?: () => Promise<T>): Promise<T | undefined> {
    await this.sleep(run);
    const activity: ToolActivity = { id: this.ids('act'), runId: run.id, name, status: 'started', startedAt: this.now() };
    p.activities.push(activity);
    if (p.activities.length > 60) p.activities.shift();
    this.emit({ type: 'tool', projectId: p.manifest.id, activity });
    await this.sleep(run, 2);
    const result = body ? await body() : undefined;
    activity.status = 'finished';
    activity.summary = summary;
    activity.finishedAt = this.now();
    this.emit({ type: 'tool', projectId: p.manifest.id, activity });
    return result;
  }

  private progress(p: FakeProject, run: FakeRun, text: string): void {
    this.emit({ type: 'progress', projectId: p.manifest.id, runId: run.id, text });
  }

  private planningQuestions(p: FakeProject): DirectorQuestion[] {
    const questions: DirectorQuestion[] = [];
    if (!p.manifest.category) {
      questions.push({
        id: 'q_category',
        header: 'Kategorie',
        question: 'Was soll entstehen?',
        options: [
          { label: 'Video', description: 'Musikvideo, Kurzfilm, Social Ad, Explainer' },
          { label: 'Präsentation', description: 'Slides mit Theme und Export als PDF/PPTX' },
          { label: 'Grafik', description: 'Plakat, Collage, Social-Grafik' },
          { label: 'Website', description: 'Erst Mockups, dann lauffähige Seite' },
          { label: 'Audio', description: 'Podcast, Schnitt, Mix & Master' },
        ],
      });
    }
    questions.push(
      {
        id: 'q_platform',
        header: 'Plattform',
        question: 'Wo soll das Ergebnis hauptsächlich laufen?',
        options: [
          { label: 'YouTube (16:9)', description: 'Empfohlen: volle Länge im Querformat' },
          { label: 'Reels/Shorts (9:16)', description: 'Hochkant, Ausschnitte bis 90 s' },
          { label: 'Beides', description: '16:9 und 9:16 mit Reframing je Shot' },
        ],
      },
      {
        id: 'q_style',
        header: 'Stil',
        question: 'Welche Bildsprache passt? (Mehrfachauswahl)',
        multiSelect: true,
        options: [
          { label: 'Neon-Noir', description: 'Kühle Nacht, Neonreflexe, harte Kontraste' },
          { label: 'Analogfilm', description: 'Korn, warme Lichter, leichte Unschärfe' },
          { label: 'Papier-Rotoscope', description: 'Gezeichnete Ebene über dem Footage' },
        ],
      },
    );
    return questions;
  }

  private labelContext(p: FakeProject, doc: StudioDocument | null) {
    const names: Record<string, string> = {};
    for (const a of p.assets) names[a.id] = a.title;
    if (doc?.kind === 'timeline') {
      for (const t of doc.tracks) {
        if (t.name) names[t.id] = t.name;
        for (const c of t.clips) names[c.id] = c.name ?? c.text ?? (c.assetId ? (names[c.assetId] ?? c.id) : c.id);
      }
      for (const m of doc.markers) if (m.label) names[m.id] = m.label;
    }
    return { names, fps: doc?.kind === 'timeline' ? doc.fps : 30 };
  }

  private describeRefs(p: FakeProject, doc: StudioDocument | null, refs: Ref[]): string {
    if (doc?.kind !== 'timeline') return refs.length ? `Deine ${refs.length} Referenz(en) habe ich mir angesehen. ` : '';
    const timeRef = refs.find((r) => r.kind === 'time' || r.kind === 'range');
    if (!timeRef) return '';
    const frame = timeRef.kind === 'time' ? timeRef.frame : timeRef.kind === 'range' ? timeRef.from : 0;
    const hit = clipsAtFrame(doc, frame).find((h) => h.track.kind === 'video');
    const where = hit ? ` – dort liegt „${hit.clip.name ?? hit.clip.id}“` : '';
    return `Die Stelle bei ${formatTimecode(frame, doc.fps)} habe ich mir angesehen${where}. `;
  }

  private async propose(p: FakeProject, checkpointId: string | undefined, budgetUsd: number, summary: string, assetIds?: string[]): Promise<Checkpoint> {
    const target = checkpointId
      ? p.manifest.checkpoints.find((c) => c.id === checkpointId)
      : p.manifest.checkpoints.find((c) => c.status === 'pending' || c.status === 'changes_requested' || c.status === 'proposed');
    if (!target) throw new Error('Kein offener Checkpoint');
    p.manifest.checkpoints = proposeCheckpoint(
      p.manifest.checkpoints,
      target.id,
      { summary, budgetRequestedUsd: budgetUsd, ...(assetIds ? { assetIds } : {}) },
      this.now(),
    );
    this.emit({ type: 'checkpoints', projectId: p.manifest.id, checkpoints: p.manifest.checkpoints });
    return clone(p.manifest.checkpoints.find((c) => c.id === target.id)!);
  }

  private firstRefs(message: ComposerMessage): Ref[] {
    return message.segments.flatMap((s) => (s.type === 'ref' ? [s.ref] : []));
  }

  private handleWindowMessage(event: MessageEvent): void {
    const data = event.data as Partial<PickMessage> | null;
    if (!data || data.type !== PICK_MESSAGE || !this.previewProjectId || !data.bbox || !data.selector) return;
    const source = data.source ? parseDataSrc(data.source) : undefined;
    const text = typeof data.text === 'string' ? data.text.replace(/\s+/g, ' ').trim() : '';
    const tag = typeof data.tag === 'string' ? data.tag.trim().toLowerCase() : '';
    const parsed = refSchema.safeParse({
      kind: 'element',
      doc: 'site',
      page: data.page ?? '/',
      selector: data.selector,
      ...(source ? { source } : {}),
      ...(text ? { text } : {}),
      ...(tag ? { tag } : {}),
      bbox: {
        x: Math.round(data.bbox.x),
        y: Math.round(data.bbox.y),
        width: Math.max(0, Math.round(data.bbox.width)),
        height: Math.max(0, Math.round(data.bbox.height)),
      },
    });
    if (!parsed.success) return;
    this.emit({ type: 'preview_pick', projectId: this.previewProjectId, ref: parsed.data });
  }

  // ───────────────────────── Director-Skripte ─────────────────────────

  private async scriptPlanningIntro(p: FakeProject, run: FakeRun, refs: Ref[]): Promise<void> {
    const doc = await this.head(p);
    await this.tool(p, run, 'get_document', doc ? 'Dokument gelesen' : 'Noch kein Dokument – Kategorie offen');
    await this.stream(
      p,
      run,
      `Danke, das ist ein guter Ausgangspunkt! ${this.describeRefs(p, doc, refs)}Bevor ich ein Treatment schreibe, kläre ich kurz ${p.manifest.category ? 'zwei Punkte' : 'drei Punkte'} – meine Empfehlung steht jeweils oben.`,
    );
    await this.sleep(run);
    const questionId = this.ids('q');
    const questions = this.planningQuestions(p);
    p.pendingQuestion = { questionId, questions, runId: run.id };
    p.script.asked = true;
    this.emit({ type: 'question', projectId: p.manifest.id, runId: run.id, questionId, questions });
    this.setRunState(p, run.id, 'waiting_user');
  }

  private async scriptAfterAnswer(p: FakeProject, run: FakeRun, answers: Record<string, string>): Promise<void> {
    const categoryAnswer = answers.q_category;
    if (!p.manifest.category && categoryAnswer) {
      const map: Record<string, ProjectCategory> = { Video: 'video', Präsentation: 'slides', Grafik: 'graphic', Website: 'web', Audio: 'audio' };
      const category = map[categoryAnswer] ?? 'video';
      await this.tool(p, run, 'set_category', `Kategorie: ${CATEGORY_LABELS[category]}`, async () => {
        p.manifest.category = category;
        p.manifest.checkpoints = createCheckpoints(category);
        const document = createDocument(category, { formats: p.manifest.formats });
        const version = await p.versions.commit({ document, ops: [], note: 'Dokument angelegt', author: 'director', runId: run.id });
        this.emitManifest(p);
        const { document: _d, ops: _o, ...meta } = version;
        this.emit({ type: 'document', projectId: p.manifest.id, version: meta });
        this.emit({ type: 'checkpoints', projectId: p.manifest.id, checkpoints: p.manifest.checkpoints });
      });
    }
    this.progress(p, run, 'Treatment wird geschrieben …');
    const treatment = await this.tool(p, run, 'create_text_asset', 'Treatment v1 angelegt', async () =>
      this.addAsset(
        p,
        {
          id: this.ids('ast'),
          kind: 'text',
          subtype: 'treatment',
          title: 'Treatment v1',
          description: `Plattform: ${answers.q_platform ?? '—'} · Stil: ${answers.q_style ?? '—'}`,
          tags: ['treatment'],
          status: 'active',
          source: 'director',
          mime: 'text/markdown',
          createdAt: this.now(),
        },
        { type: 'text', text: '# Treatment v1\n\nNächtliche Fahrt durch die Stadt …', mime: 'text/markdown' },
      ),
    );
    await this.stream(
      p,
      run,
      `Danke! Hier ist mein Vorschlag für das **Treatment**:\n\n- Plattform: ${answers.q_platform ?? 'offen'}\n- Stil: ${answers.q_style ?? 'offen'}\n- Dramaturgie: Aufbruch in der Strophe, Geschwindigkeit im Refrain ab 00:24.000, Stillstand in der Bridge, Auflösung im Morgengrauen.\n\nFür Style Bible und Storyboard beantrage ich ein Budget. Bitte prüfe den Checkpoint unten.`,
    );
    await this.sleep(run);
    const imageIds = p.assets.filter((a) => a.kind === 'image' && a.status === 'active').slice(0, 2).map((a) => a.id);
    await this.propose(
      p,
      undefined,
      12.5,
      `**Treatment:** Eine nächtliche Fahrt als Bild für Aufbruch.\n\n1. Strophe: Mira allein im Auto, ruhige Kamera\n2. Refrain: Lichter, Tempo, harte Schnitte auf Downbeats\n3. Bridge: Stillstand an der Ampel\n4. Outro: Morgengrauen über der Brücke\n\n*Budget:* Style Bible (Charakter, Sets, Palette) und Storyboard mit ~24 Frames.`,
      [...(treatment ? [treatment.id] : []), ...imageIds],
    );
    this.setRunState(p, run.id, 'waiting_user');
  }

  private async scriptAfterApproval(p: FakeProject, run: FakeRun, checkpoint: Checkpoint): Promise<void> {
    await this.stream(p, run, `Danke für die Freigabe von „${checkpoint.title}“! Ich setze das jetzt um und beginne mit dem Refrain.`);
    const doc = await this.head(p);
    const generation: Generation = {
      id: this.ids('gen'),
      endpointId: 'fal-ai/nano-banana-pro',
      modality: 'image',
      status: 'queued',
      input: { prompt: 'Refrain: Neonlichter der Stadt, Mira im Profil, 16:9' },
      purpose: 'Neuer Storyboard-Frame für den Refrain',
      estimateUsd: 0.04,
      queuePosition: 1,
      checkpointId: checkpoint.id,
      inputAssetIds: p.assets.filter((a) => a.subtype === 'character-sheet').map((a) => a.id),
      outputAssetIds: [],
      createdAt: this.now(),
    };
    await this.tool(p, run, 'generate', 'Storyboard-Frame „Refrain – Neon“ erzeugt', async () => {
      p.generations.push(generation);
      p.ledger.reserve(generation.id, generation.estimateUsd, { checkpointId: checkpoint.id });
      this.emit({ type: 'generation', projectId: p.manifest.id, generation });
      this.emit({ type: 'budget', projectId: p.manifest.id, summary: p.ledger.summary() });
      await this.sleep(run, 3);
      generation.status = 'running';
      generation.queuePosition = undefined;
      generation.submittedAt = this.now();
      this.emit({ type: 'generation', projectId: p.manifest.id, generation });
      await this.sleep(run, 4);
      const created = this.addAsset(
        p,
        {
          id: this.ids('ast'),
          kind: 'image',
          subtype: 'storyboard-frame',
          title: 'Storyboard 07 – Refrain Neon',
          tags: ['storyboard', 'refrain'],
          status: 'active',
          source: 'generated',
          mime: 'image/png',
          modelId: generation.endpointId,
          generationId: generation.id,
          prompt: String(generation.input.prompt),
          costUsd: 0.04,
          width: 1920,
          height: 1080,
          createdAt: this.now(),
        },
        { type: 'image', title: 'SB 07 – Neon', hue: 172, motif: 'horizon' },
      );
      generation.status = 'completed';
      generation.costUsd = 0.04;
      generation.finishedAt = this.now();
      generation.outputAssetIds = [created.id];
      p.ledger.settle(generation.id, 0.04);
      this.emit({ type: 'generation', projectId: p.manifest.id, generation });
      this.emit({ type: 'budget', projectId: p.manifest.id, summary: p.ledger.summary() });
    });
    const newAssetId = generation.outputAssetIds[0];
    let versionNumber = 0;
    await this.tool(p, run, 'apply_document_ops', 'Neue Version angelegt', async () => {
      const ops = this.approvalOps(doc, checkpoint, newAssetId);
      versionNumber = await this.commit(p, ops, `${checkpoint.title} umgesetzt`, run.id);
    });
    await this.stream(
      p,
      run,
      doc?.kind === 'timeline'
        ? `Fertig – **v${versionNumber}**: Der Refrain ab 00:24.000 nutzt jetzt den neuen Frame „Storyboard 07 – Refrain Neon“, und bei 00:00.000 steht ein Checkpoint-Marker. Als Nächstes bereite ich die Style Bible vor.`
        : `Fertig – **v${versionNumber}** ist angelegt. Als Nächstes bereite ich den nächsten Checkpoint vor.`,
    );
    this.setRunState(p, run.id, 'idle');
  }

  private approvalOps(doc: StudioDocument | null, checkpoint: Checkpoint, assetId: string | undefined): DocumentOp[] {
    const suffix = this.ids('m');
    switch (doc?.kind) {
      case 'timeline': {
        const ops: DocumentOp[] = [{ op: 'add_marker', marker: { id: `cp_${suffix}`, frame: 0, kind: 'checkpoint', label: `${checkpoint.title} ✓` } }];
        const refrain = doc.tracks.find((t) => t.kind === 'video')?.clips.find((c) => c.start <= doc.fps * 24 && c.start + c.duration > doc.fps * 24);
        if (refrain && assetId) ops.push({ op: 'update_clip', clipId: refrain.id, patch: { assetId, name: 'Refrain: Neon' } });
        return ops;
      }
      case 'deck':
        return [
          {
            op: 'add_slide',
            slide: {
              id: `s_${suffix}`,
              title: checkpoint.title,
              elements: [{ id: `el_${suffix}`, type: 'text', x: 120, y: 120, width: 1600, height: 200, text: `${checkpoint.title} – freigegeben`, style: { fontSize: 72 } }],
            },
          },
        ];
      case 'canvas':
        return [{ op: 'add_layer', layer: { id: `ly_${suffix}`, type: 'text', name: 'Notiz', text: `${checkpoint.title} ✓`, x: 60, y: 60, width: 600, height: 80, style: { fontSize: 40 } } }];
      case 'site':
        return [{ op: 'update_site', patch: { stage: 'code' } }];
      default:
        return [];
    }
  }

  private async scriptProduction(p: FakeProject, run: FakeRun, message: ComposerMessage, text: string): Promise<void> {
    const doc = await this.head(p);
    const refs = this.firstRefs(message);
    await this.tool(p, run, 'get_document', 'Dokument und Referenzen aufgelöst');
    await this.stream(p, run, `Alles klar. ${this.describeRefs(p, doc, refs)}Ich kümmere mich darum.`);
    const timeRef = refs.find((r) => r.kind === 'time' || r.kind === 'range');
    if (doc?.kind === 'timeline' && timeRef && (timeRef.kind === 'time' || timeRef.kind === 'range')) {
      const frame = timeRef.kind === 'time' ? timeRef.frame : timeRef.from;
      p.script.notes += 1;
      const label = text.trim().replace(/\s+/g, ' ').slice(0, 40) || 'Notiz';
      let versionNumber = 0;
      await this.tool(p, run, 'apply_document_ops', `Notiz bei ${formatTimecode(frame, doc.fps)}`, async () => {
        versionNumber = await this.commit(p, [{ op: 'add_marker', marker: { id: `note_${this.ids('n')}`, frame: Math.min(frame, doc.durationFrames), kind: 'note', label } }], `Notiz: ${label}`, run.id);
      });
      await this.stream(p, run, `Erledigt: Notiz bei ${formatTimecode(frame, doc.fps)} gesetzt (**v${versionNumber}**). Sag Bescheid, wenn ich die Stelle neu generieren soll.`);
    } else {
      await this.stream(p, run, 'Ich habe mir das angesehen und plane die nächsten Schritte. Sobald etwas Kostenpflichtiges ansteht, melde ich mich mit einer Freigabe.');
    }
    if (/4k|upscal|teuer|budget/i.test(text)) {
      p.script.approvalsRequested += 1;
      this.debug.triggerApproval(p.manifest.id);
      this.setRunState(p, run.id, 'waiting_user');
      return;
    }
    this.setRunState(p, run.id, 'idle');
  }

  // ───────────────────────── StudioApi: App & Einstellungen ─────────────────────────

  async getSettings(): Promise<AppSettings> {
    this.log('getSettings', []);
    return clone(this.settings);
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.log('updateSettings', [patch]);
    this.settings = { ...this.settings, ...patch };
    return clone(this.settings);
  }

  async setSecret(name: 'anthropic' | 'fal', value: string | null): Promise<void> {
    // Der Wert wird bewusst nicht protokolliert oder gespeichert.
    this.log('setSecret', [name, value === null ? null : '***']);
    this.secrets[name] = value !== null && value.trim() !== '';
  }

  async getAuthStatus(): Promise<AuthStatus> {
    this.log('getAuthStatus', []);
    const apiKey = this.secrets.anthropic;
    const oauthProfile = this.anthropicProfile;
    const runtimes: AuthStatus['runtimes'] = [
      {
        id: 'anthropic',
        available: apiKey || oauthProfile,
        detail: apiKey ? 'API-Key im Schlüsselbund (Demo)' : oauthProfile ? 'Anthropic-Login (ant auth login, Demo)' : 'Kein API-Key und kein Login gefunden',
      },
      {
        id: 'agent-sdk',
        available: this.settings.allowClaudeSubscription,
        detail: this.settings.allowClaudeSubscription ? 'Claude-Abo über Agent SDK (nur Eigennutzung)' : 'In den Einstellungen deaktiviert',
      },
      { id: 'fal', available: this.secrets.fal, detail: this.secrets.fal ? 'fal-Router mit eingeschränkten Fähigkeiten' : 'Kein fal-Key' },
    ];
    const pref = this.settings.preferredRuntime;
    const preferred = pref !== 'auto' ? runtimes.find((r) => r.id === pref && r.available) : undefined;
    const active = preferred?.id ?? runtimes.find((r) => r.available)?.id ?? null;
    return { runtimes, active, falConfigured: this.secrets.fal, anthropic: { apiKey, oauthProfile } };
  }

  // ───────────────────────── Projekte ─────────────────────────

  async listRecentProjects(): Promise<RecentProject[]> {
    await this.ready;
    this.log('listRecentProjects', []);
    const entries = await Promise.all([...this.projects.values()].map((p) => this.recentEntry(p)));
    return entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  /**
   * Eintrag wie in Main (DESIGN.md §7.12): Checkpoint, Budget und Standbild nur, wenn es sie gibt. Standbild = erstes
   * im Dokument verwendetes Video bzw. Bild.
   */
  private async recentEntry(p: FakeProject): Promise<RecentProject> {
    const m = p.manifest;
    const entry: RecentProject = { path: p.path, title: m.title, category: m.category, updatedAt: m.updatedAt };
    if (m.checkpoints.length > 0) {
      const open = m.checkpoints.findIndex((c) => c.status !== 'approved' && c.status !== 'skipped');
      const at = open === -1 ? m.checkpoints.length - 1 : open;
      const cp = m.checkpoints[at]!;
      entry.checkpoint = { index: at + 1, total: m.checkpoints.length, title: cp.title, status: cp.status };
    }
    const budget = p.ledger.summary();
    if (budget.approvedUsd > 0 || budget.spentUsd > 0) entry.budget = { spentUsd: budget.spentUsd, approvedUsd: budget.approvedUsd };
    const document = await this.head(p);
    const used = document ? documentAssetIds(document) : new Set<string>();
    const media = p.assets.filter((a) => used.has(a.id) && a.status === 'active' && a.metadata?.missing !== true);
    const poster = media.find((a) => a.kind === 'video') ?? media.find((a) => a.kind === 'image');
    if (poster) entry.poster = this.assetUrl(m.id, poster.id, 'thumb');
    return entry;
  }

  async createProject(input: CreateProjectInput): Promise<ProjectSnapshot> {
    await this.ready;
    this.log('createProject', [input]);
    if (!input.title.trim()) throw new Error('Titel fehlt');
    const dir = input.directory ?? this.settings.projectsDir;
    let path = `${dir}/${safeName(input.title)}.dstudio`;
    for (let n = 2; [...this.projects.values()].some((p) => p.path === path); n++) path = `${dir}/${safeName(input.title)} ${n}.dstudio`;
    const formats = input.formats?.length ? input.formats : [STANDARD_FORMATS['16:9']!];
    const now = this.now();
    const manifest: ProjectManifest = {
      schema: PROJECT_SCHEMA_VERSION,
      id: this.ids('prj'),
      title: input.title.trim(),
      category: input.category,
      createdAt: now,
      updatedAt: now,
      formats,
      brief: null,
      pickers: { ...DEFAULT_PICKERS },
      checkpoints: input.category ? createCheckpoints(input.category) : [],
      budgetApprovals: [],
      director: { effort: this.settings.defaultEffort },
      phase: 'planning',
    };
    const p = this.newProject(path, manifest);
    if (input.category) {
      const document = createDocument(input.category, { format: formats[0]!, formats });
      await p.versions.commit({ document, ops: [], note: 'Projekt angelegt', author: 'system' });
    }
    return this.snapshot(p);
  }

  async openProject(path: string): Promise<ProjectSnapshot> {
    await this.ready;
    this.log('openProject', [path]);
    const p = [...this.projects.values()].find((x) => x.path === path);
    if (!p) throw new Error(`Kein Projekt unter ${path}`);
    return this.snapshot(p);
  }

  async getSnapshot(projectId: string): Promise<ProjectSnapshot> {
    await this.ready;
    this.log('getSnapshot', [projectId]);
    return this.snapshot(this.project(projectId));
  }

  async chooseDirectory(): Promise<string | null> {
    this.log('chooseDirectory', []);
    const next = this.nextDirectory;
    this.nextDirectory = null;
    return next ?? DEMO_ROOT;
  }

  async chooseFiles(): Promise<string[]> {
    this.log('chooseFiles', []);
    const next = this.nextFiles;
    this.nextFiles = null;
    return next ?? ['/Users/demo/Material/Referenz Nachtfahrt.jpg', '/Users/demo/Material/Voiceover Intro.wav'];
  }

  // ───────────────────────── Director ─────────────────────────

  async sendMessage(projectId: string, message: ComposerMessage): Promise<void> {
    await this.ready;
    this.log('sendMessage', [projectId, message]);
    const p = this.project(projectId);
    const doc = await this.head(p);
    const text = composerToDisplayText(message.segments, this.labelContext(p, doc));
    const userMessage: ChatMessage = { id: this.ids('msg'), role: 'user', segments: clone(message.segments), text, createdAt: this.now() };
    p.messages.push(userMessage);
    this.emit({ type: 'message', projectId, message: userMessage });
    const plain = message.segments.map((s) => (s.type === 'text' ? s.text : '')).join('');
    const refs = this.firstRefs(message);
    const proposed = p.manifest.checkpoints.find((c) => c.status === 'proposed');
    if (p.manifest.phase === 'planning' && !p.script.asked) {
      this.startRun(p, (run) => this.scriptPlanningIntro(p, run, refs));
    } else if (p.pendingQuestion) {
      this.startRun(p, async (run) => {
        await this.stream(p, run, 'Beantworte gern zuerst die Rückfrage oben – dann lege ich los.');
        this.setRunState(p, run.id, 'waiting_user');
      });
    } else if (proposed && p.manifest.phase === 'planning') {
      this.startRun(p, async (run) => {
        await this.stream(p, run, `Ich warte noch auf deine Entscheidung zum Checkpoint „${proposed.title}“. Du kannst ihn freigeben oder Änderungen wünschen.`);
        this.setRunState(p, run.id, 'waiting_user');
      });
    } else {
      this.startRun(p, (run) => this.scriptProduction(p, run, message, plain));
    }
  }

  async interrupt(projectId: string): Promise<void> {
    await this.ready;
    this.log('interrupt', [projectId]);
    const p = this.project(projectId);
    const run = p.run;
    if (!run) return;
    run.canceled = true;
    if (run.streamingMessageId) {
      const message: ChatMessage = { id: run.streamingMessageId, role: 'director', text: `${run.streamedText.trimEnd()} …`, createdAt: this.now(), runId: run.id };
      p.messages.push(message);
      this.emit({ type: 'message', projectId, message });
    }
    for (const a of p.activities) {
      if (a.runId === run.id && a.status === 'started') {
        a.status = 'failed';
        a.summary = 'unterbrochen';
        a.finishedAt = this.now();
        this.emit({ type: 'tool', projectId, activity: a });
      }
    }
    p.run = null;
    this.setRunState(p, run.id, 'interrupted');
  }

  async answerQuestion(projectId: string, questionId: string, answers: Record<string, string>): Promise<void> {
    await this.ready;
    this.log('answerQuestion', [projectId, questionId, answers]);
    const p = this.project(projectId);
    if (!p.pendingQuestion || p.pendingQuestion.questionId !== questionId) throw new Error('Keine offene Rückfrage mit dieser ID');
    const questions = p.pendingQuestion.questions;
    p.pendingQuestion = null;
    this.emit({ type: 'question_resolved', projectId, questionId });
    const summary = questions.map((q) => `${q.header ?? q.question}: ${answers[q.id] ?? '—'}`).join(' · ');
    const answerMessage: ChatMessage = { id: this.ids('msg'), role: 'user', text: summary, createdAt: this.now() };
    p.messages.push(answerMessage);
    this.emit({ type: 'message', projectId, message: answerMessage });
    this.startRun(p, (run) => this.scriptAfterAnswer(p, run, answers));
  }

  async decideCheckpoint(projectId: string, checkpointId: string, decision: CheckpointDecision): Promise<void> {
    await this.ready;
    this.log('decideCheckpoint', [projectId, checkpointId, decision]);
    const p = this.project(projectId);
    p.manifest.checkpoints = decideCheckpointCore(p.manifest.checkpoints, checkpointId, decision, this.now());
    this.emit({ type: 'checkpoints', projectId, checkpoints: p.manifest.checkpoints });
    const checkpoint = p.manifest.checkpoints.find((c) => c.id === checkpointId)!;
    if (decision.decision === 'approve') {
      const amount = checkpoint.budgetApprovedUsd ?? 0;
      if (amount > 0) {
        const approval = p.ledger.approve(checkpointId, amount);
        p.manifest.budgetApprovals.push(approval);
        this.emit({ type: 'budget', projectId, summary: p.ledger.summary() });
      }
      if (p.manifest.phase === 'planning') {
        p.manifest.phase = 'production';
        p.manifest.brief = {
          goal: 'Musikvideo zum Song',
          audience: '',
          platforms: [],
          formats: p.manifest.formats.map((f) => f.id),
          tone: '',
          references: [],
          constraints: '',
          language: 'de',
          notes: '',
        };
      }
      this.emitManifest(p);
      this.startRun(p, (run) => this.scriptAfterApproval(p, run, checkpoint));
    } else if (decision.decision === 'request_changes') {
      this.startRun(p, async (run) => {
        await this.stream(p, run, `Verstanden: „${decision.feedback}“. Ich überarbeite den Vorschlag.`);
        await this.tool(p, run, 'create_text_asset', 'Überarbeitung angelegt');
        await this.propose(p, checkpointId, (checkpoint.budgetRequestedUsd ?? 10) * 0.9, `**Überarbeitet:** ${decision.feedback}\n\n${checkpoint.summary ?? ''}`, checkpoint.assetIds);
        this.setRunState(p, run.id, 'waiting_user');
      });
    } else {
      this.emitManifest(p);
    }
  }

  async decideApproval(projectId: string, approvalId: string, approved: boolean): Promise<void> {
    await this.ready;
    this.log('decideApproval', [projectId, approvalId, approved]);
    const p = this.project(projectId);
    const request = p.pendingApprovals.find((a) => a.id === approvalId);
    if (!request) throw new Error('Keine offene Genehmigung mit dieser ID');
    p.pendingApprovals = p.pendingApprovals.filter((a) => a.id !== approvalId);
    this.emit({ type: 'approval_resolved', projectId, approvalId, approved });
    if (approved && request.amountUsd) {
      const approval = p.ledger.approve(`_extra_${approvalId}`, request.amountUsd, request.title);
      p.manifest.budgetApprovals.push(approval);
      this.emit({ type: 'budget', projectId, summary: p.ledger.summary() });
    }
    this.startRun(p, async (run) => {
      await this.stream(p, run, approved ? `Danke – „${request.title}“ ist genehmigt, ich fahre fort.` : 'Okay, ich bleibe im bisherigen Rahmen und suche eine günstigere Lösung.');
      this.setRunState(p, run.id, 'idle');
    });
  }

  async setEffort(projectId: string, effort: DirectorEffort): Promise<void> {
    await this.ready;
    this.log('setEffort', [projectId, effort]);
    const p = this.project(projectId);
    p.manifest.director = { ...p.manifest.director, effort };
    this.emitManifest(p);
  }

  // ───────────────────────── Modelle ─────────────────────────

  async listModels(modality?: Modality): Promise<ModelInfo[]> {
    this.log('listModels', [modality]);
    return clone(modality ? DEMO_MODELS.filter((m) => modelMatchesModality(m, modality)) : DEMO_MODELS);
  }

  async refreshModels(): Promise<{ count: number; updatedAt: string }> {
    this.log('refreshModels', []);
    return { count: DEMO_MODELS.length, updatedAt: this.now() };
  }

  async setPicker(projectId: string, modality: Modality, selection: PickerSelection): Promise<void> {
    await this.ready;
    this.log('setPicker', [projectId, modality, selection]);
    const p = this.project(projectId);
    p.manifest.pickers = { ...p.manifest.pickers, [modality]: selection };
    this.emitManifest(p);
  }

  // ───────────────────────── Assets ─────────────────────────

  async importFiles(projectId: string, paths: string[], mode: 'link' | 'import'): Promise<Asset[]> {
    await this.ready;
    this.log('importFiles', [projectId, paths, mode]);
    const p = this.project(projectId);
    return paths.map((path, i) => {
      const name = baseName(path);
      const mime = mimeFromExtension(name);
      const kind = assetKindFromMime(mime);
      const title = name.replace(/\.[^.]+$/, '') || name;
      const media: MediaSpec =
        kind === 'image' || kind === 'video'
          ? { type: 'image', title, hue: (i * 67 + title.length * 13) % 360, motif: kind === 'video' ? 'frame' : 'horizon' }
          : kind === 'audio'
            ? { type: 'audio', seconds: 6, toneHz: 196, sampleRate: 4000 }
            : kind === 'text'
              ? { type: 'text', text: `${title}\n` }
              : { type: 'glyph', label: name.split('.').pop()?.toUpperCase() ?? '?', hue: 200 };
      const asset: Asset = {
        id: this.ids('ast'),
        kind,
        title,
        tags: [],
        status: 'active',
        source: mode === 'link' ? 'linked' : 'imported',
        mime,
        path: mode === 'link' ? path : `assets/store/${title.toLowerCase().replace(/\W+/g, '-')}`,
        ...(kind === 'audio' || kind === 'video' ? { durationMs: 6000 } : {}),
        createdAt: this.now(),
      };
      if (kind === 'audio') p.peakSpecs.set(asset.id, { level: 0.6 });
      return this.addAsset(p, asset, media);
    });
  }

  async searchAssets(projectId: string, query: AssetQuery): Promise<Asset[]> {
    await this.ready;
    this.log('searchAssets', [projectId, query]);
    return clone(filterAssets(this.project(projectId).assets, query));
  }

  assetUrl(projectId: string, assetId: string, variant: 'original' | 'proxy' | 'thumb' = 'original'): string {
    const p = this.projects.get(projectId);
    if (!p) return placeholderGlyph('?', 0);
    // Fehlende verknüpfte Datei: Warnsymbol statt Inhalt (nicht zwischengespeichert, damit „Erneut verknüpfen“ wirkt).
    if (p.assets.find((a) => a.id === assetId)?.metadata?.missing === true) return placeholderGlyph('!', 8);
    const key = `${assetId}:${variant === 'thumb' ? 'thumb' : 'original'}`;
    const cached = p.mediaCache.get(key);
    if (cached) return cached;
    const spec = p.media.get(assetId);
    const asset = p.assets.find((a) => a.id === assetId);
    let url: string;
    if (!spec) {
      url = placeholderGlyph(asset ? asset.kind.slice(0, 3).toUpperCase() : '?', 210);
    } else if (spec.type === 'image') {
      url = placeholderImage({ title: spec.title, ...(spec.subtitle ? { subtitle: spec.subtitle } : {}), hue: spec.hue, motif: spec.motif, width: spec.width, height: spec.height });
    } else if (spec.type === 'audio') {
      url = variant === 'thumb' ? placeholderGlyph('♪', 160) : makeWavDataUri({ seconds: spec.seconds, ...(spec.bpm ? { bpm: spec.bpm } : {}), toneHz: spec.toneHz, sampleRate: spec.sampleRate, seed: assetId });
    } else if (spec.type === 'text') {
      url = variant === 'thumb' ? placeholderGlyph('¶', 40) : textDataUri(spec.text, spec.mime);
    } else {
      url = placeholderGlyph(spec.label, spec.hue);
    }
    p.mediaCache.set(key, url);
    return url;
  }

  async revealAsset(projectId: string, assetId: string): Promise<void> {
    this.log('revealAsset', [projectId, assetId]);
  }

  async getLineage(projectId: string, assetId: string): Promise<{ parents: LineageEdge[]; children: LineageEdge[] }> {
    await this.ready;
    this.log('getLineage', [projectId, assetId]);
    const p = this.project(projectId);
    const asset = p.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error(`Unbekanntes Asset: ${assetId}`);
    return clone(lineageEdgesOf(asset, p.assets, p.generations));
  }

  async relinkAsset(projectId: string, assetId: string, newPath: string): Promise<Asset> {
    await this.ready;
    this.log('relinkAsset', [projectId, assetId, newPath]);
    const p = this.project(projectId);
    const index = p.assets.findIndex((a) => a.id === assetId);
    const current = p.assets[index];
    if (!current || current.source !== 'linked') throw new Error(`Asset "${assetId}" ist keine verknüpfte Datei`);
    if (typeof newPath !== 'string' || !newPath.trim()) throw new Error('Kein Dateipfad angegeben');
    // Simulation der Inhaltsprüfung (echtes Backend: SHA-256): eine Datei anderer Art (Bild ↔ Audio …) gilt als anderer Inhalt.
    if (assetKindFromMime(mimeFromExtension(baseName(newPath))) !== current.kind) throw new Error('Die neue Datei hat einen anderen Inhalt');
    const { missing: _missing, ...metadata } = current.metadata ?? {};
    const next: Asset = { ...current, path: newPath.trim() };
    if (Object.keys(metadata).length) next.metadata = metadata;
    else delete next.metadata;
    p.assets[index] = next;
    this.touch(p);
    this.emit({ type: 'asset', projectId, asset: next });
    return clone(next);
  }

  async assetPeaks(projectId: string, assetId: string): Promise<{ peaks: number[]; durationMs: number } | null> {
    await this.ready;
    const p = this.project(projectId);
    const cached = p.peaksCache.get(assetId);
    if (cached) return clone(cached);
    const asset = p.assets.find((a) => a.id === assetId);
    if (!asset || (asset.kind !== 'audio' && asset.kind !== 'video') || !asset.durationMs) return null;
    const spec = p.peakSpecs.get(assetId) ?? {};
    const result = { peaks: makePeaks(assetId, asset.durationMs, spec), durationMs: asset.durationMs };
    p.peaksCache.set(assetId, result);
    return clone(result);
  }

  // ───────────────────────── Versionen ─────────────────────────

  async getVersion(projectId: string, number: number): Promise<Version> {
    await this.ready;
    this.log('getVersion', [projectId, number]);
    const version = await this.project(projectId).versions.get(number);
    if (!version) throw new Error(`Version ${number} existiert nicht`);
    return version;
  }

  async restoreVersion(projectId: string, number: number): Promise<void> {
    await this.ready;
    this.log('restoreVersion', [projectId, number]);
    const p = this.project(projectId);
    const version = await restoreVersionCore(p.versions, number, { author: 'user' });
    const { document: _d, ops: _o, ...meta } = version;
    this.touch(p);
    this.emit({ type: 'document', projectId, version: meta });
  }

  // ───────────────────────── Sprache ─────────────────────────

  async transcribe(projectId: string, audio: ArrayBuffer, mime: string): Promise<{ text: string; words: TranscriptWord[] }> {
    this.log('transcribe', [projectId, audio.byteLength, mime]);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return clone(this.transcript);
  }

  // ───────────────────────── Web-Vorschau ─────────────────────────

  async previewOpen(projectId: string, options: { viewport: PreviewViewport }): Promise<{ url: string }> {
    await this.ready;
    this.log('previewOpen', [projectId, options]);
    const p = this.project(projectId);
    this.previewProjectId = projectId;
    const url = demoSiteUrl(p.manifest.title);
    this.emit({ type: 'preview_state', projectId, url, status: 'ready' });
    return { url };
  }

  async previewSetBounds(projectId: string, bounds: Rect | null): Promise<void> {
    this.log('previewSetBounds', [projectId, bounds]);
  }

  async previewSetPickMode(projectId: string, enabled: boolean): Promise<void> {
    this.log('previewSetPickMode', [projectId, enabled]);
  }

  async previewOpenExternal(projectId: string): Promise<void> {
    this.log('previewOpenExternal', [projectId]);
  }

  async previewNavigate(projectId: string, path: string): Promise<void> {
    await this.ready;
    this.log('previewNavigate', [projectId, path]);
    this.project(projectId);
    // Wie das echte Backend: nur Seitenpfade der Site (kein Schema, kein fremder Host).
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) throw new Error(`Ungültiger Seitenpfad: ${String(path)}`);
  }

  // ───────────────────────── Export ─────────────────────────

  async exportProject(projectId: string, options: ExportOptions): Promise<{ path: string }> {
    await this.ready;
    this.log('exportProject', [projectId, options]);
    const p = this.project(projectId);
    const suffix = options.format ? `-${options.format.replace(':', 'x')}` : '';
    return { path: `${p.path}/exports/${safeName(p.manifest.title)}${suffix}.${options.target}` };
  }

  async openExternal(url: string): Promise<void> {
    this.log('openExternal', [url]);
  }

  onEvent(listener: (event: StudioEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ───────────────────────── Stresstest-Projekt ─────────────────────────

  private async createLargeProject(): Promise<string> {
    const fps = 30;
    const seconds = 300;
    const path = `${DEMO_ROOT}/Langes Video (Stresstest).dstudio`;
    const existing = [...this.projects.values()].find((x) => x.path === path);
    if (existing) return path;
    const now = this.now();
    const formats = [STANDARD_FORMATS['16:9']!];
    const p = this.newProject(path, {
      schema: PROJECT_SCHEMA_VERSION,
      id: 'prj_demo_large',
      title: 'Langes Video (Stresstest)',
      category: 'video',
      createdAt: now,
      updatedAt: now,
      formats,
      brief: null,
      pickers: { ...DEFAULT_PICKERS },
      checkpoints: createCheckpoints('video'),
      budgetApprovals: [],
      director: { effort: 'xhigh' },
      phase: 'production',
    });
    const hues = [12, 48, 96, 160, 200, 240, 290, 330];
    for (let i = 0; i < 8; i++) {
      const id = `ast_l_img_${i}`;
      p.assets.push({ id, kind: 'image', title: `Shot ${i + 1}`, tags: [], status: 'active', source: 'generated', modelId: 'fal-ai/nano-banana-pro', costUsd: 0.04, createdAt: now });
      p.media.set(id, { type: 'image', title: `Shot ${i + 1}`, hue: hues[i]!, motif: i % 2 ? 'frame' : 'horizon' });
    }
    p.assets.push({ id: 'ast_l_song', kind: 'audio', subtype: 'music', title: 'Langer Song', tags: [], status: 'active', source: 'imported', durationMs: seconds * 1000, createdAt: now });
    p.media.set('ast_l_song', { type: 'audio', seconds, bpm: 128, toneHz: 98, sampleRate: 2000 });
    p.peakSpecs.set('ast_l_song', { bpm: 128, level: 0.8 });
    p.assets.push({ id: 'ast_l_voice', kind: 'audio', subtype: 'voice', title: 'Voiceover', tags: [], status: 'active', source: 'generated', durationMs: 8000, createdAt: now });
    p.media.set('ast_l_voice', { type: 'audio', seconds: 8, toneHz: 200, sampleRate: 2000 });
    const total = seconds * fps;
    const ops: DocumentOp[] = [{ op: 'update_timeline', patch: { durationFrames: total } }];
    for (let i = 0; i < 100; i++) ops.push({ op: 'insert_clip', trackId: 'V1', clip: { id: `lv_${i}`, assetId: `ast_l_img_${i % 8}`, start: i * 90, duration: 90, name: `Shot ${i + 1}` } });
    for (let i = 0; i < 60; i++) ops.push({ op: 'insert_clip', trackId: 'T1', clip: { id: `lt_${i}`, text: `Zeile ${i + 1}`, style: 'lyric', start: i * 150 + 10, duration: 120 } });
    for (let i = 0; i < 30; i++) ops.push({ op: 'insert_clip', trackId: 'A1', clip: { id: `la_${i}`, assetId: 'ast_l_voice', start: i * 300 + 20, duration: 240, name: `VO ${i + 1}` } });
    ops.push({ op: 'insert_clip', trackId: 'A2', clip: { id: 'l_song', assetId: 'ast_l_song', start: 0, duration: total, name: 'Song' } });
    for (let i = 0; i < 10; i++) ops.push({ op: 'insert_clip', trackId: 'A3', clip: { id: `ls_${i}`, assetId: 'ast_l_voice', start: i * 900 + 450, duration: 30, name: `SFX ${i + 1}` } });
    const beat = (60 / 128) * fps;
    for (let i = 0; i * beat < total; i++) ops.push({ op: 'add_marker', marker: { id: `lb_${i}`, frame: Math.round(i * beat), kind: i % 4 === 0 ? 'downbeat' : 'beat' } });
    for (let i = 0; i < 10; i++) ops.push({ op: 'add_marker', marker: { id: `lsec_${i}`, frame: i * 30 * fps, kind: 'section', label: i === 0 ? 'Intro' : `Teil ${i + 1}` } });
    const base = createDocument('video', { format: formats[0]!, formats }) as Timeline;
    await p.versions.commit({ document: base, ops: [], note: 'Projekt angelegt', author: 'system' });
    await p.versions.commit({ document: applyDocumentOps(base, ops, this.opContext(p)), ops, note: 'Stresstest-Timeline', author: 'director' });
    return path;
  }
}
