import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';
import {
  clampRefText,
  defaultIdGenerator,
  initialPickers,
  type AppSettings,
  type Asset,
  type AssetQuery,
  type AuthStatus,
  type ChatMessage,
  type CheckpointDecision,
  type ComposerMessage,
  type CreateProjectInput,
  type DirectorEffort,
  type DirectorRuntimeId,
  type ExportOptions,
  type LineageEdge,
  type MediaToolsStatus,
  type Modality,
  type ModelInfo,
  type PickerSelection,
  type PreviewViewport,
  type ProjectSnapshot,
  type RecentProject,
  type Rect,
  type RunState,
  type StudioApi,
  type StudioEvent,
  type ToolActivity,
  type TranscriptWord,
  type Version,
} from '@studio/core';
import {
  AnthropicTransport,
  agentSdkRuntimeFactory,
  detectAnthropicProfile,
  DirectorSession,
  FalOpenAITransport,
  InteractiveUi,
  isAgentSdkAvailable,
  selectRuntime,
  SkillLibrary,
  type WebPort,
} from '@studio/director';
import { MediaToolkit } from '@studio/media';
import { ProjectStore, recentCheckpoint, RecentProjects, type RecentEntry } from '@studio/project';
import type { NodeLauncher } from '@studio/render';
import type { MediaErrorInfo } from '@studio/render/browser';
import { buildAssetUrl, type AssetVariant, type ResolvedAssetFile } from './asset-protocol.ts';
import { exportProject as runExport } from './exporter.ts';
import { locateFfmpeg, type FfmpegLocation } from './ffmpeg.ts';
import { SecretStore, type SecretCipher, type SecretName } from './secrets.ts';
import { resolvePreviewPath, validatePickPayload } from './security.ts';
import { CombinedCatalog, DerivedMedia, FalHub, renderPortFor, RenderService } from './services.ts';
import { defaultSettings, SettingsStore } from './settings.ts';
import { createWebPort } from './web.ts';

/** Elektron-spezifische Fähigkeiten, die das Backend braucht (in Tests ersetzbar). */
export interface PreviewPort {
  open(projectId: string, url: string, viewport: PreviewViewport): Promise<void>;
  /** Seitenpfad der Site anzeigen (z. B. `/about`). */
  navigate(projectId: string, path: string): Promise<void>;
  setBounds(projectId: string, bounds: Rect | null): void;
  setPickMode(projectId: string, enabled: boolean): Promise<void>;
  /** Aktuell angezeigte Seite der Vorschau; `null`, wenn keine Vorschau offen ist. */
  currentUrl(projectId: string): string | null;
  close(projectId: string): void;
  closeAll(): void;
}

export interface BackendDeps {
  appDataDir: string;
  documentsDir: string;
  tempDir: string;
  cipher: SecretCipher;
  dialogs: { chooseDirectory(): Promise<string | null>; chooseFiles(): Promise<string[]> };
  shell: { openExternal(url: string): Promise<void>; showItemInFolder(path: string): void };
  preview?: PreviewPort | undefined;
  emit(event: StudioEvent): void;
  /**
   * Laufzeit der App: Ordner mit mitgelieferten ffmpeg/ffprobe (`<resources>/ffmpeg`); in der ausgelieferten App
   * die Bereitstellung der Chromium-Headless-Shell (Hilfsprozess, siehe `RenderService.ensureChromium`); und der
   * Start von Node-Kindprozessen (Vite der Website-Vorschau) – in Electron als utilityProcess.
   */
  runtime?:
    | {
        bundledFfmpegDir?: string | undefined;
        provisionChromium?: (() => Promise<string | undefined>) | undefined;
        nodeLauncher?: NodeLauncher | undefined;
      }
    | undefined;
  /** Für Tests: Medien-Toolkit, Render-Dienst, Director-Fabrik ersetzen. */
  overrides?: {
    media?: MediaToolkit;
    render?: RenderService;
    createSession?: (open: OpenProject, runtime: DirectorRuntimeId) => Promise<DirectorSession>;
    agentSdkAvailable?: boolean;
    env?: Record<string, string | undefined>;
    homedir?: string;
    platform?: NodeJS.Platform;
    skillsDir?: string;
    web?: WebPort;
    /** ffmpeg-Suche: Prüfung „ausführbare Datei“ ersetzen (Tests ohne echtes Dateisystem). */
    isExecutable?: (file: string) => boolean;
    /** Website-Vorschau: Suche nach Vite ersetzen (Tests: „nicht installiert“ wie in der ausgelieferten App). */
    findViteBin?: (siteDir: string) => string | undefined;
  };
}

export interface OpenProject {
  id: string;
  store: ProjectStore;
  ui: InteractiveUi;
  session: DirectorSession | null;
  sessionRuntime: DirectorRuntimeId | null;
  runState: RunState;
  activities: ToolActivity[];
  site: { url: string; stop(): Promise<void> } | null;
  /** Bereits gezeigte Systemhinweise (Schlüssel siehe {@link noticeKey}), damit derselbe Hinweis nicht mehrfach erscheint. */
  notices: Set<string>;
}

const MAX_ACTIVITIES = 60;

/** Systemhinweis, wenn eine Vite-Website ohne installiertes Vite in der Vorschau geöffnet wird. */
export const VITE_MISSING_NOTICE =
  '**Website-Vorschau ohne Vite:** Im Ordner `site/` dieses Projekts ist Vite nicht installiert, deshalb zeigt die Vorschau die Dateien unverändert. ' +
  'Seiten mit `.tsx`/`.jsx` oder npm-Paketen bleiben dann leer. Abhilfe: im Terminal im Ordner `site/` einmal `npm install` ausführen (Node.js nötig) und die Vorschau neu öffnen – ' +
  'oder den Director bitten, die Website als schlichtes HTML/CSS/JS ohne Build-Schritt anzulegen.';

/**
 * Das Backend hinter `window.studio`: verwaltet Projekte, Director-Sessions, Modelle, Medien, Rendering
 * und Export. Läuft im Electron-Hauptprozess; schwere Arbeit geschieht in Kindprozessen (ffmpeg,
 * Chromium) bzw. asynchron.
 */
export class StudioBackend implements StudioApi {
  private readonly settings: SettingsStore;
  private readonly secrets: SecretStore;
  private readonly recent: RecentProjects;
  private readonly fal: FalHub;
  private readonly catalog: CombinedCatalog;
  private readonly render: RenderService;
  private readonly derived: DerivedMedia;
  private readonly projects = new Map<string, OpenProject>();
  private mediaValue: MediaToolkit | null;
  /** Ergebnis der ffmpeg-Suche (verworfen, wenn sich `ffmpegPath` ändert). */
  private mediaLocation: FfmpegLocation | null = null;
  private agentSdkAvailable: Promise<boolean> | null = null;
  private secretsLoaded: Promise<void> | null = null;

  constructor(private readonly deps: BackendDeps) {
    this.settings = new SettingsStore(deps.appDataDir, defaultSettings(deps.documentsDir));
    this.secrets = new SecretStore(deps.appDataDir, deps.cipher);
    this.recent = new RecentProjects(deps.appDataDir);
    this.fal = new FalHub(join(deps.appDataDir, 'fal-catalog.json'));
    this.catalog = new CombinedCatalog(() => this.fal.get());
    this.render =
      deps.overrides?.render ??
      new RenderService({
        workDir: join(deps.appDataDir, 'render-cache'),
        browserExecutable: process.env.STUDIO_CHROMIUM_PATH,
        provisionChromium: Boolean(deps.runtime?.provisionChromium),
        ensureBrowser: deps.runtime?.provisionChromium,
      });
    this.mediaValue = deps.overrides?.media ?? null;
    this.derived = new DerivedMedia(() => this.media);
  }

  /**
   * Medien-Werkzeuge mit den gefundenen ffmpeg/ffprobe-Pfaden. Asynchrone Einstiege rufen vorher
   * {@link ensureMediaTools} auf (berücksichtigt die Einstellung `ffmpegPath`); ohne das gilt die Suche ohne Einstellung.
   */
  private get media(): MediaToolkit {
    this.mediaValue ??= this.toolkitFor(this.mediaLocation ?? this.locateMediaTools(undefined));
    return this.mediaValue;
  }

  private locateMediaTools(settingsPath: string | undefined): FfmpegLocation {
    const o = this.deps.overrides;
    return locateFfmpeg({
      platform: o?.platform ?? process.platform,
      env: o?.env ?? process.env,
      homedir: o?.homedir ?? homedir(),
      settingsPath,
      bundledDir: this.deps.runtime?.bundledFfmpegDir,
      isExecutable: o?.isExecutable,
    });
  }

  private toolkitFor(location: FfmpegLocation): MediaToolkit {
    // Nicht gefunden: Programmnamen behalten – der Aufruf scheitert dann mit der Meldung aus @studio/media.
    return new MediaToolkit({ ffmpegPath: location.ffmpeg ?? 'ffmpeg', ffprobePath: location.ffprobe ?? 'ffprobe' });
  }

  /** ffmpeg/ffprobe suchen (einmal je Einstellungsstand) und die Werkzeuge darauf einstellen. */
  private async ensureMediaTools(): Promise<FfmpegLocation> {
    if (this.mediaLocation) return this.mediaLocation;
    const settings = await this.settings.get();
    const location = this.locateMediaTools(settings.ffmpegPath);
    if (location.message) console.warn(`[media] ${location.message.replace(/\*\*/g, '')}`);
    this.mediaLocation = location;
    if (!this.deps.overrides?.media) this.mediaValue = this.toolkitFor(location);
    return location;
  }

  /** Status für Einstellungen/Systemprüfung (ohne die internen Warnungen). */
  async mediaToolsStatus(): Promise<MediaToolsStatus> {
    const { ffmpeg, ffprobe, source, message } = await this.ensureMediaTools();
    return { ffmpeg, ffprobe, source, message };
  }

  /** Einmal je Projekt ein Systemhinweis, wenn ffmpeg/ffprobe fehlen (mit Installationsbefehl). */
  private async noticeMissingMediaTools(open: OpenProject): Promise<void> {
    if (this.deps.overrides?.media) return;
    const location = await this.ensureMediaTools();
    if (location.ffmpeg && location.ffprobe) return;
    if (location.message) await this.postNotice(open, location.message, { once: true });
  }

  private ensureSecrets(): Promise<void> {
    this.secretsLoaded ??= (async () => {
      this.fal.setKey(await this.secrets.get('fal'));
    })().catch((error: unknown) => {
      // Kein abgelehntes Promise cachen: der nächste Aufruf versucht es erneut.
      this.secretsLoaded = null;
      throw error;
    });
    return this.secretsLoaded;
  }

  // ───────────── Ereignisse ─────────────

  private emit(event: StudioEvent): void {
    const open = 'projectId' in event ? this.projects.get(event.projectId) : undefined;
    if (open) {
      if (event.type === 'run_state') open.runState = event.state;
      if (event.type === 'tool') {
        const idx = open.activities.findIndex((a) => a.id === event.activity.id);
        if (idx >= 0) open.activities[idx] = event.activity;
        else open.activities.push(event.activity);
        if (open.activities.length > MAX_ACTIVITIES) open.activities.splice(0, open.activities.length - MAX_ACTIVITIES);
      }
      if (event.type === 'asset') this.deriveInBackground(open, event.asset);
    }
    this.deps.emit(event);
  }

  // ───────────── Einstellungen & Anmeldung ─────────────

  getSettings(): Promise<AppSettings> {
    return this.settings.get();
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = await this.settings.update(patch);
    if (patch && typeof patch === 'object' && 'ffmpegPath' in patch) {
      this.mediaLocation = null;
      this.mediaValue = this.deps.overrides?.media ?? null;
    }
    if ('preferredRuntime' in patch || 'allowClaudeSubscription' in patch) await this.resetSessions();
    return next;
  }

  async setSecret(name: SecretName, value: string | null): Promise<void> {
    if (name !== 'anthropic' && name !== 'fal') throw new Error('Unbekannter Schlüssel');
    await this.secrets.set(name, value);
    if (name === 'fal') this.fal.setKey(await this.secrets.get('fal'));
    await this.resetSessions();
  }

  async getAuthStatus(): Promise<AuthStatus> {
    await this.ensureSecrets();
    const settings = await this.settings.get();
    const o = this.deps.overrides;
    const anthropicApiKey = await this.secrets.get('anthropic');
    const hasAnthropicProfile = detectAnthropicProfile(o?.env ?? process.env, o?.homedir ?? homedir(), o?.platform ?? platform());
    const result = selectRuntime({
      settings,
      anthropicApiKey,
      hasAnthropicProfile,
      falApiKey: await this.secrets.get('fal'),
      agentSdkAvailable: await this.isAgentSdkAvailable(),
    });
    return {
      runtimes: result.runtimes,
      active: result.active,
      falConfigured: this.fal.hasKey,
      anthropic: { apiKey: !!anthropicApiKey?.trim(), oauthProfile: hasAnthropicProfile },
      media: await this.mediaToolsStatus(),
    };
  }

  private isAgentSdkAvailable(): Promise<boolean> {
    if (this.deps.overrides?.agentSdkAvailable !== undefined) return Promise.resolve(this.deps.overrides.agentSdkAvailable);
    this.agentSdkAvailable ??= isAgentSdkAvailable();
    return this.agentSdkAvailable;
  }

  private async resetSessions(): Promise<void> {
    for (const open of this.projects.values()) {
      await open.session?.close();
      open.session = null;
      open.sessionRuntime = null;
    }
  }

  // ───────────── Projekte ─────────────

  async listRecentProjects(): Promise<RecentProject[]> {
    return this.recent.list();
  }

  async createProject(input: CreateProjectInput): Promise<ProjectSnapshot> {
    const settings = await this.settings.get();
    const parent = input.directory ?? settings.projectsDir;
    await mkdir(parent, { recursive: true });
    const store = await ProjectStore.create(parent, {
      title: input.title.trim() || 'Neues Projekt',
      category: input.category,
      ...(input.formats?.length ? { formats: input.formats } : {}),
    });
    await store.updateManifest((m) => {
      m.director.effort = settings.defaultEffort;
      // Picker-Defaults des Nutzers (PLAN 4.3), fehlende Modalitäten aus DEFAULT_PICKERS.
      m.pickers = initialPickers(settings.defaultPickers);
    });
    const open = this.register(store);
    await this.touchRecent(open);
    await this.noticeMissingMediaTools(open).catch(() => undefined);
    return this.snapshot(open);
  }

  async openProject(path: string): Promise<ProjectSnapshot> {
    for (const open of this.projects.values()) {
      if (open.store.dir === path) return this.snapshot(open);
    }
    if (!(await ProjectStore.isProject(path))) throw new Error(`Kein Director-Studio-Projekt: ${path}`);
    const warnings = this.storeWarnings();
    const store = await ProjectStore.open(path, { onWarning: warnings.onWarning });
    const open = this.register(store);
    // Übersprungene Journalzeilen u. Ä. stehen als Systemhinweis im Panel (und damit schon im Snapshot).
    await warnings.attach(open);
    await this.noticeMissingMediaTools(open).catch(() => undefined);
    await this.touchRecent(open);
    // Absturz-Wiederaufnahme laufender Generierungen (braucht fal-Key und eine Session).
    void this.resumeGenerations(open);
    return this.snapshot(open);
  }

  async getSnapshot(projectId: string): Promise<ProjectSnapshot> {
    return this.snapshot(this.project(projectId));
  }

  chooseDirectory(): Promise<string | null> {
    return this.deps.dialogs.chooseDirectory();
  }

  chooseFiles(): Promise<string[]> {
    return this.deps.dialogs.chooseFiles();
  }

  private register(store: ProjectStore): OpenProject {
    const id = store.manifest.id;
    const open: OpenProject = {
      id,
      store,
      ui: new InteractiveUi({ projectId: id, emit: (event) => this.emit(event) }),
      session: null,
      sessionRuntime: null,
      runState: 'idle',
      activities: [],
      site: null,
      notices: new Set(),
    };
    this.projects.set(id, open);
    return open;
  }

  /**
   * Warnungen des Projektspeichers (z. B. beschädigte Journalzeilen, die übersprungen wurden): in die Konsole und
   * einmal je Text als Systemhinweis ins Panel. Vor `attach` (während `ProjectStore.open`) werden sie gesammelt.
   */
  private storeWarnings(): { onWarning: (message: string) => void; attach: (open: OpenProject) => Promise<void> } {
    const pending: string[] = [];
    let target: OpenProject | null = null;
    const notice = (message: string) => `Hinweis zum Projektspeicher: ${message}`;
    return {
      onWarning: (message) => {
        console.warn(message);
        if (target) void this.postNotice(target, notice(message), { once: true }).catch(() => undefined);
        else pending.push(message);
      },
      attach: async (open) => {
        // Hinweise früherer Sitzungen nicht wiederholen (die beschädigte Zeile bleibt ja bestehen).
        for (const m of await open.store.listMessages().catch(() => [])) if (m.role === 'system') open.notices.add(noticeKey(m.text));
        target = open;
        for (const message of pending.splice(0)) await this.postNotice(open, notice(message), { once: true }).catch(() => undefined);
      },
    };
  }

  /**
   * Hinweis der App (nicht des Directors) im Panel – gespeichert, damit er nach dem Neuladen sichtbar bleibt.
   * Mit `once` erscheint derselbe Text nur einmal.
   */
  private async postNotice(open: OpenProject, text: string, options: { once?: boolean } = {}): Promise<void> {
    if (options.once) {
      if (open.notices.has(noticeKey(text))) return;
      open.notices.add(noticeKey(text));
    }
    const message: ChatMessage = { id: defaultIdGenerator('msg'), role: 'system', text, createdAt: new Date().toISOString() };
    await open.store.appendMessage(message);
    this.emit({ type: 'message', projectId: open.id, message });
  }

  private project(projectId: string): OpenProject {
    const open = this.projects.get(projectId);
    if (!open) throw new Error('Projekt ist nicht geöffnet');
    return open;
  }

  private async touchRecent(open: OpenProject): Promise<void> {
    await this.recent.touch(await this.recentEntry(open));
  }

  /**
   * Eintrag für „Zuletzt geöffnet“ (DESIGN.md §7.12): Titel und Kategorie, dazu – nur wenn vorhanden – der aktuelle
   * Checkpoint, das Budget und ein Standbild. Das Standbild ist das erste im Dokument verwendete Video (dessen schon
   * erzeugtes Thumbnail) bzw. Bild; es wird hier nichts neu gerechnet.
   */
  private async recentEntry(open: OpenProject): Promise<RecentEntry> {
    const { store } = open;
    const m = store.manifest;
    const entry: RecentEntry = { path: store.dir, title: m.title, category: m.category, updatedAt: m.updatedAt };
    const checkpoint = recentCheckpoint(m.checkpoints);
    if (checkpoint) entry.checkpoint = checkpoint;
    const budget = store.budgetSummary();
    if (budget.approvedUsd > 0 || budget.spentUsd > 0) entry.budget = { spentUsd: budget.spentUsd, approvedUsd: budget.approvedUsd };
    const poster = await this.posterOf(store).catch(() => null);
    if (poster) {
      entry.poster = buildAssetUrl(open.id, poster.assetId, 'thumb');
      entry.posterFile = poster.path;
      entry.posterMime = poster.mime;
    }
    return entry;
  }

  private async posterOf(store: ProjectStore): Promise<{ assetId: string; path: string; mime: string } | null> {
    const used = await store.usedAssetIds();
    const assets = store.allAssets().filter((a) => used.has(a.id) && a.status === 'active' && a.metadata?.missing !== true);
    for (const asset of [...assets.filter((a) => a.kind === 'video'), ...assets.filter((a) => a.kind === 'image')]) {
      const path = asset.kind === 'video' ? join(store.derivedDir(asset.id), 'thumb.jpg') : store.assetFilePath(asset);
      if (path && (await hasFile(path))) return { assetId: asset.id, path, mime: asset.kind === 'video' ? 'image/jpeg' : (asset.mime ?? 'image/jpeg') };
    }
    return null;
  }

  private async snapshot(open: OpenProject): Promise<ProjectSnapshot> {
    const { store } = open;
    const head = await store.head();
    const pendingQuestion = open.ui.pendingQuestion?.() ?? null;
    return {
      path: store.dir,
      manifest: store.manifest,
      // Projekte ohne Kategorie haben bis zum Planungsergebnis kein Dokument; die UI zeigt dann den Chat.
      document: head?.document ?? null,
      versions: await store.listVersions(),
      assets: await withLinkState(store, store.allAssets()),
      usedAssetIds: [...(await store.usedAssetIds())],
      budget: store.budgetSummary(),
      checkpoints: store.manifest.checkpoints,
      messages: await store.listMessages(),
      generations: store.listGenerations(),
      runState: open.runState,
      pendingQuestion: pendingQuestion
        ? { questionId: pendingQuestion.questionId, questions: pendingQuestion.questions, ...(pendingQuestion.runId ? { runId: pendingQuestion.runId } : {}) }
        : null,
      pendingApprovals: open.ui.pendingApprovals?.() ?? [],
      activities: [...open.activities],
    };
  }

  // ───────────── Director ─────────────

  private async session(open: OpenProject): Promise<DirectorSession> {
    const status = await this.getAuthStatus();
    const runtime = status.active;
    if (!runtime) {
      throw new Error('Kein Director verfügbar: Bitte in den Einstellungen mit Anthropic anmelden (API-Key oder „ant auth login“) oder einen fal-Key hinterlegen.');
    }
    if (open.session && open.sessionRuntime === runtime) return open.session;
    await open.session?.close();
    open.session = this.deps.overrides?.createSession ? await this.deps.overrides.createSession(open, runtime) : await this.createSession(open, runtime);
    open.sessionRuntime = runtime;
    return open.session;
  }

  private async createSession(open: OpenProject, runtime: DirectorRuntimeId): Promise<DirectorSession> {
    await this.fal.ready();
    await this.ensureMediaTools();
    const { store } = open;
    const skills = this.deps.overrides?.skillsDir ? SkillLibrary.fromDirectory(this.deps.overrides.skillsDir) : process.env.STUDIO_SKILLS_DIR ? SkillLibrary.fromDirectory(process.env.STUDIO_SKILLS_DIR) : undefined;
    const common = {
      project: store,
      catalog: this.catalog,
      generation: this.fal.generationPort(),
      media: this.media,
      render: renderPortFor(store, this.render, {
        siteUrl: () => this.ensureSite(open),
        exportProject: (target) => this.exportProject(open.id, { target }),
      }),
      transcribe: this.fal.transcribePort(),
      // `import_url`: Download mit Schutz vor lokalen/privaten Zielen und Größenlimit.
      web: this.deps.overrides?.web ?? createWebPort(),
      ui: open.ui,
      runtimeId: runtime,
      ...(skills ? { options: { skills } } : {}),
    };
    if (runtime === 'agent-sdk') {
      return new DirectorSession({ ...common, runtime: agentSdkRuntimeFactory({ configDir: join(this.deps.appDataDir, 'claude-agent') }) });
    }
    if (runtime === 'fal') {
      const key = await this.secrets.get('fal');
      if (!key) throw new Error('fal-Key fehlt');
      return new DirectorSession({ ...common, transport: new FalOpenAITransport({ apiKey: key }) });
    }
    const apiKey = await this.secrets.get('anthropic');
    return new DirectorSession({ ...common, transport: new AnthropicTransport({ apiKey: apiKey ?? null }) });
  }

  async sendMessage(projectId: string, message: ComposerMessage): Promise<void> {
    const open = this.project(projectId);
    const session = await this.session(open);
    // Der Turn läuft im Hintergrund; Fortschritt kommt über Ereignisse.
    void session.send(message).catch((error: unknown) => this.reportError(open, error));
  }

  async interrupt(projectId: string): Promise<void> {
    this.project(projectId).session?.interrupt();
  }

  async answerQuestion(projectId: string, questionId: string, answers: Record<string, string>): Promise<void> {
    if (!this.project(projectId).ui.answerQuestion(questionId, answers)) throw new Error('Diese Rückfrage ist nicht mehr offen');
  }

  async decideApproval(projectId: string, approvalId: string, approved: boolean): Promise<void> {
    if (!this.project(projectId).ui.decideApproval(approvalId, approved)) throw new Error('Diese Freigabe ist nicht mehr offen');
  }

  async decideCheckpoint(projectId: string, checkpointId: string, decision: CheckpointDecision): Promise<void> {
    const open = this.project(projectId);
    let session: DirectorSession | null = null;
    try {
      session = await this.session(open);
    } catch {
      session = null;
    }
    if (session) {
      void session.decideCheckpoint(checkpointId, decision).catch((error: unknown) => this.reportError(open, error));
      return;
    }
    // Ohne Director (kein Login): Entscheidung trotzdem speichern.
    const { decideCheckpoint } = await import('@studio/core');
    const manifest = await open.store.updateManifest((m) => {
      m.checkpoints = decideCheckpoint(m.checkpoints, checkpointId, decision, new Date().toISOString());
    });
    const cp = manifest.checkpoints.find((c) => c.id === checkpointId);
    if (decision.decision === 'approve' && cp?.budgetApprovedUsd) await open.store.approveBudget(checkpointId, cp.budgetApprovedUsd);
    this.emit({ type: 'checkpoints', projectId, checkpoints: manifest.checkpoints });
    this.emit({ type: 'budget', projectId, summary: open.store.budgetSummary() });
  }

  async setEffort(projectId: string, effort: DirectorEffort): Promise<void> {
    const open = this.project(projectId);
    const manifest = await open.store.updateManifest((m) => {
      m.director.effort = effort;
    });
    this.emit({ type: 'manifest', projectId, manifest });
  }

  private reportError(open: OpenProject, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.emit({ type: 'run_state', projectId: open.id, runId: null, state: 'failed', error: message });
  }

  private async resumeGenerations(open: OpenProject): Promise<void> {
    await this.ensureSecrets();
    if (!this.fal.hasKey) return;
    if (open.store.listGenerations(['queued', 'running']).length === 0) return;
    try {
      const session = await this.session(open);
      await session.resumePendingGenerations();
    } catch {
      // ohne Director-Anmeldung keine Wiederaufnahme – bleibt im Journal
    }
  }

  // ───────────── Modelle ─────────────

  async listModels(modality?: Modality): Promise<ModelInfo[]> {
    await this.ensureSecrets();
    await this.fal.ready();
    return this.catalog.list(modality);
  }

  async refreshModels(): Promise<{ count: number; updatedAt: string }> {
    await this.ensureSecrets();
    const services = this.fal.requireKey();
    await this.fal.ready();
    const result = await services.registry.sync();
    return { count: result.count, updatedAt: result.updatedAt };
  }

  async setPicker(projectId: string, modality: Modality, selection: PickerSelection): Promise<void> {
    const open = this.project(projectId);
    if (selection.mode === 'model' && !this.catalog.get(selection.modelId)) {
      await this.fal.ready();
      if (!this.catalog.get(selection.modelId)) throw new Error(`Unbekanntes Modell: ${selection.modelId}`);
    }
    const manifest = await open.store.updateManifest((m) => {
      m.pickers[modality] = selection;
    });
    this.emit({ type: 'manifest', projectId, manifest });
  }

  // ───────────── Assets ─────────────

  async importFiles(projectId: string, paths: string[], mode: 'link' | 'import'): Promise<Asset[]> {
    const open = this.project(projectId);
    await this.ensureMediaTools();
    const out: Asset[] = [];
    for (const path of paths) {
      let asset = await open.store.importFile(path, mode, { title: basename(path) });
      asset = await this.derived.enrich(open.store, asset);
      out.push(asset);
      this.emit({ type: 'asset', projectId, asset });
    }
    return out;
  }

  async searchAssets(projectId: string, query: AssetQuery): Promise<Asset[]> {
    return this.project(projectId).store.listAssets(query);
  }

  assetUrl(projectId: string, assetId: string, variant?: AssetVariant): string {
    return buildAssetUrl(projectId, assetId, variant);
  }

  async revealAsset(projectId: string, assetId: string): Promise<void> {
    const { store } = this.project(projectId);
    const asset = store.getAsset(assetId);
    const file = asset && store.assetFilePath(asset);
    if (file) this.deps.shell.showItemInFolder(file);
  }

  async getLineage(projectId: string, assetId: string): Promise<{ parents: LineageEdge[]; children: LineageEdge[] }> {
    return this.project(projectId).store.lineage(assetId);
  }

  async relinkAsset(projectId: string, assetId: string, newPath: string): Promise<Asset> {
    const open = this.project(projectId);
    if (typeof newPath !== 'string' || !newPath.trim()) throw new Error('Kein Dateipfad angegeben');
    // relink() prüft, dass die neue Datei denselben Inhalt (SHA-256) hat.
    const asset = await open.store.relink(assetId, newPath);
    this.emit({ type: 'asset', projectId, asset });
    return asset;
  }

  async assetPeaks(projectId: string, assetId: string): Promise<{ peaks: number[]; durationMs: number } | null> {
    const { store } = this.project(projectId);
    const asset = store.getAsset(assetId);
    return asset ? this.derived.peaks(store, asset) : null;
  }

  /** Für das `studio-asset://`-Protokoll. */
  async resolveAssetFile(projectId: string, assetId: string, variant: AssetVariant): Promise<ResolvedAssetFile | null> {
    const open = this.projects.get(projectId);
    // Geschlossenes Projekt: nur das Standbild aus „Zuletzt geöffnet“ (Startbildschirm), sonst nichts
    if (!open) return variant === 'thumb' ? this.recent.posterFile(buildAssetUrl(projectId, assetId, 'thumb')) : null;
    const asset = open.store.getAsset(assetId);
    if (!asset) return null;
    const original = open.store.assetFilePath(asset);
    if (!original) return null;
    if (variant === 'thumb') {
      const thumb = await this.derived.thumbPath(open.store, asset);
      if (thumb) return { path: thumb, mime: thumb === original ? (asset.mime ?? 'application/octet-stream') : 'image/jpeg' };
      return null;
    }
    if (variant === 'proxy' && asset.kind === 'video') {
      const proxy = await this.derived.proxyPath(open.store, asset);
      if (proxy) return { path: proxy, mime: 'video/mp4' };
    }
    return { path: original, mime: asset.mime ?? 'application/octet-stream' };
  }

  private deriveInBackground(open: OpenProject, asset: Asset): void {
    if (asset.kind !== 'video' && asset.kind !== 'audio') return;
    void (async () => {
      await this.derived.thumbPath(open.store, asset);
      await this.derived.peaks(open.store, asset).catch(() => null);
      await this.derived.proxyPath(open.store, asset);
    })().catch(() => undefined);
  }

  // ───────────── Versionen ─────────────

  async getVersion(projectId: string, number: number): Promise<Version> {
    const version = await this.project(projectId).store.getVersion(number);
    if (!version) throw new Error(`Version ${number} existiert nicht`);
    return version;
  }

  async restoreVersion(projectId: string, number: number): Promise<void> {
    const open = this.project(projectId);
    const version = await open.store.restoreVersion(number, 'user');
    const { document: _d, ops: _o, ...meta } = version;
    this.emit({ type: 'document', projectId, version: meta });
    open.session?.notify(`Der Nutzer hat Version ${number} wiederhergestellt (neu: v${version.number}). Arbeite ab jetzt auf diesem Stand weiter.`).catch(() => undefined);
  }

  // ───────────── Sprache ─────────────

  async transcribe(projectId: string, audio: ArrayBuffer, mime: string): Promise<{ text: string; words: TranscriptWord[] }> {
    this.project(projectId);
    await this.ensureSecrets();
    const dir = await mkdtemp(join(this.deps.tempDir, 'studio-ptt-'));
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : mime.includes('wav') ? 'wav' : 'webm';
    const file = join(dir, `ptt.${ext}`);
    try {
      await writeFile(file, Buffer.from(audio));
      const result = await this.fal.transcribePort().transcribe(file, { language: 'de' });
      return { text: result.text, words: result.words.map((w) => ({ text: w.text, start: w.start, end: w.end })) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // ───────────── Web-Vorschau ─────────────

  private async ensureSite(open: OpenProject): Promise<string> {
    if (open.site) return open.site.url;
    const doc = await open.store.getDocument();
    if (!doc || doc.kind !== 'site') throw new Error('Dieses Projekt ist keine Website');
    await mkdir(open.store.siteDir, { recursive: true });
    const mod = await this.render.load();
    let framework: 'vite-react' | 'html' =
      doc.framework === 'vite-react' && (await ProjectStore.isProject(open.store.dir)) && (await hasFile(join(open.store.siteDir, 'package.json'))) ? 'vite-react' : 'html';
    // Vite kommt aus dem node_modules des Site-Ordners (in der Entwicklung notfalls aus dem Monorepo); die
    // ausgelieferte App bringt keins mit. Ohne Vite zeigt die Vorschau die Dateien statisch und sagt, warum.
    const viteBin = framework === 'vite-react' ? (this.deps.overrides?.findViteBin ?? mod.findViteBin)(open.store.siteDir) : undefined;
    if (framework === 'vite-react' && !viteBin) {
      framework = 'html';
      await this.postNotice(open, VITE_MISSING_NOTICE, { once: true }).catch(() => undefined);
    }
    // Kein Picker im ausgelieferten HTML: Die Electron-Vorschau lädt ihn selbst in eine isolierte Welt
    // (Seiten-Skripte können ihn dort weder sehen noch Picks vortäuschen).
    const launcher = this.deps.runtime?.nodeLauncher;
    const server = await mod.SiteServer.start(open.store.siteDir, {
      injectPicker: false,
      framework,
      ...(viteBin ? { viteBin } : {}),
      ...(launcher ? { launcher } : {}),
    });
    open.site = { url: server.url, stop: () => server.stop() };
    return server.url;
  }

  async previewOpen(projectId: string, options: { viewport: PreviewViewport }): Promise<{ url: string }> {
    const open = this.project(projectId);
    const url = await this.ensureSite(open);
    await this.deps.preview?.open(projectId, url, options.viewport);
    return { url };
  }

  async previewSetBounds(projectId: string, bounds: Rect | null): Promise<void> {
    this.deps.preview?.setBounds(projectId, bounds);
  }

  async previewSetPickMode(projectId: string, enabled: boolean): Promise<void> {
    await this.deps.preview?.setPickMode(projectId, enabled);
  }

  async previewOpenExternal(projectId: string): Promise<void> {
    const open = this.project(projectId);
    const base = await this.ensureSite(open);
    // Die gerade angezeigte Seite öffnen, sofern sie zum Vorschau-Server gehört.
    const current = this.deps.preview?.currentUrl(projectId) ?? null;
    const target = current && sameOrigin(current, base) ? current : base;
    await this.deps.shell.openExternal(target);
  }

  async previewNavigate(projectId: string, path: string): Promise<void> {
    const open = this.project(projectId);
    const base = await this.ensureSite(open);
    resolvePreviewPath(base, path); // wirft bei fremden/ungültigen Pfaden
    await this.deps.preview?.navigate(projectId, path);
  }

  /** Vom PreviewController: Element in der Web-Vorschau gewählt (Nutzlast wird hier erneut geprüft). */
  handlePreviewPick(projectId: string, payload: unknown): void {
    const pick = validatePickPayload(payload);
    if (!pick || !this.projects.has(projectId)) return;
    void (async () => {
      const mod = await import('@studio/render/browser');
      const ref = mod.pickPayloadToRef(
        {
          selector: pick.selector,
          bbox: pick.bbox,
          text: pick.text ?? '',
          tag: pick.tag ?? '',
          dataSid: pick.dataSid ?? null,
          dataSrc: pick.dataSrc ?? null,
          page: pick.page ?? '/',
        },
        'site',
      );
      const text = pick.text ? clampRefText(pick.text) : '';
      const tag = pick.tag?.trim().toLowerCase() ?? '';
      const enriched = ref.kind === 'element' ? { ...ref, ...(text && !ref.text ? { text } : {}), ...(tag && !ref.tag ? { tag } : {}) } : ref;
      this.emit({ type: 'preview_pick', projectId, ref: enriched, ...(text ? { label: text.slice(0, 60) } : tag ? { label: `<${tag}>` } : {}) });
    })().catch(() => undefined);
  }

  // ───────────── Export ─────────────

  async exportProject(projectId: string, options: ExportOptions): Promise<{ path: string }> {
    const open = this.project(projectId);
    await this.ensureMediaTools();
    const missing = new Map<string, MediaErrorInfo>();
    try {
      return await runExport(open.store, options, {
        media: this.media,
        render: this.render,
        siteUrl: () => this.ensureSite(open),
        onMediaError: (info) => {
          if (!missing.has(`${info.clipId}\u0000${info.assetId}`)) missing.set(`${info.clipId}\u0000${info.assetId}`, info);
        },
      });
    } finally {
      if (missing.size > 0) await this.postNotice(open, mediaErrorNotice(open.store, `Export (${options.target})`, [...missing.values()])).catch(() => undefined);
    }
  }

  openExternal(url: string): Promise<void> {
    if (!/^https?:\/\//.test(url)) return Promise.reject(new Error('Nur http(s)-Links können geöffnet werden'));
    return this.deps.shell.openExternal(url);
  }

  onEvent(): () => void {
    // Im Main-Prozess laufen Ereignisse über deps.emit (IPC); der Renderer abonniert in der Preload-Schicht.
    return () => undefined;
  }

  // ───────────── Lebenszyklus ─────────────

  async closeProject(projectId: string): Promise<void> {
    const open = this.projects.get(projectId);
    if (!open) return;
    this.projects.delete(projectId);
    // Jeder Schritt einzeln: ein Fehler (z. B. hängender Dev-Server) darf das Schließen nicht abbrechen.
    const errors: unknown[] = [];
    const step = async (fn: () => unknown) => {
      try {
        await fn();
      } catch (error) {
        errors.push(error);
      }
    };
    await step(() => open.session?.close());
    await step(() => open.site?.stop());
    await step(() => this.deps.preview?.close(projectId));
    // „Zuletzt geöffnet“ mit dem Stand beim Schließen (Checkpoint, Budget, Standbild), ohne die Reihenfolge zu ändern
    await step(async () => this.recent.update(await this.recentEntry(open)));
    await step(() => open.store.close());
    if (errors.length > 0) throw errors[0];
  }

  async shutdown(): Promise<void> {
    // Projekte parallel schließen, damit mehrere Dev-Server sich nicht aufsummieren.
    const results = await Promise.allSettled([...this.projects.keys()].map((id) => this.closeProject(id)));
    this.deps.preview?.closeAll();
    await this.render.close();
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

/**
 * Vergleichsschlüssel für Systemhinweise: Eine beschädigte Journalzeile heißt beim ersten Öffnen „unvollständige
 * letzte Zeile“, später (wenn danach weitere Zeilen stehen) „beschädigte Zeile“ – es ist aber derselbe Hinweis.
 */
export function noticeKey(text: string): string {
  return text.replace(/(?:Unvollständige letzte|Beschädigte) Zeile/g, 'Zeile').replace(/ \(vermutlich Absturz beim Schreiben\)/g, '');
}

/** Systemhinweis über beim Rendern ausgelassene Medien (fehlende/defekte Dateien). */
export function mediaErrorNotice(store: Pick<ProjectStore, 'getAsset'>, context: string, infos: readonly MediaErrorInfo[]): string {
  const lines = infos.slice(0, 12).map((info) => {
    const title = store.getAsset(info.assetId)?.title;
    return `- Clip \`${info.clipId}\`: ${title ? `„${title}“ (${info.assetId})` : info.assetId} – ${info.message}`;
  });
  if (infos.length > 12) lines.push(`- … und ${infos.length - 12} weitere`);
  const count = infos.length === 1 ? 'Ein Medium fehlte oder war defekt und wurde' : `${infos.length} Medien fehlten oder waren defekt und wurden`;
  return `**${context}:** ${count} ausgelassen. Bitte die Datei(en) erneut verknüpfen oder den Director bitten, sie zu ersetzen.\n${lines.join('\n')}`;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Verknüpfte Dateien, die nicht mehr am gespeicherten Ort liegen, bekommen `metadata.missing = true` (nur in der
 * Sicht für die UI, nicht gespeichert) – die Asset-Karte zeigt dann „Datei fehlt“ und bietet „Erneut verknüpfen“.
 */
export async function withLinkState(store: Pick<ProjectStore, 'assetFilePath'>, assets: Asset[]): Promise<Asset[]> {
  return Promise.all(
    assets.map(async (asset) => {
      if (asset.source !== 'linked') return asset;
      const path = store.assetFilePath(asset);
      const missing = !path || !(await hasFile(path));
      if (missing === (asset.metadata?.missing === true)) return asset;
      const { missing: _missing, ...rest } = asset.metadata ?? {};
      return { ...asset, metadata: missing ? { ...rest, missing: true } : rest };
    }),
  );
}

async function hasFile(path: string): Promise<boolean> {
  const { stat } = await import('node:fs/promises');
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

