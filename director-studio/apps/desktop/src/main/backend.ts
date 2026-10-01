import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';
import {
  clampRefText,
  initialPickers,
  type AppSettings,
  type Asset,
  type AssetQuery,
  type AuthStatus,
  type CheckpointDecision,
  type ComposerMessage,
  type CreateProjectInput,
  type DirectorEffort,
  type DirectorRuntimeId,
  type ExportOptions,
  type LineageEdge,
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
} from '@studio/director';
import { defaultMediaToolkit, type MediaToolkit } from '@studio/media';
import { ProjectStore, RecentProjects } from '@studio/project';
import { buildAssetUrl, type AssetVariant, type ResolvedAssetFile } from './asset-protocol.ts';
import { exportProject as runExport } from './exporter.ts';
import { SecretStore, type SecretCipher, type SecretName } from './secrets.ts';
import { resolvePreviewPath, validatePickPayload } from './security.ts';
import { CombinedCatalog, DerivedMedia, FalHub, renderPortFor, RenderService } from './services.ts';
import { defaultSettings, SettingsStore } from './settings.ts';

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
}

const MAX_ACTIVITIES = 60;

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
  private agentSdkAvailable: Promise<boolean> | null = null;
  private secretsLoaded: Promise<void> | null = null;

  constructor(private readonly deps: BackendDeps) {
    this.settings = new SettingsStore(deps.appDataDir, defaultSettings(deps.documentsDir));
    this.secrets = new SecretStore(deps.appDataDir, deps.cipher);
    this.recent = new RecentProjects(deps.appDataDir);
    this.fal = new FalHub(join(deps.appDataDir, 'fal-catalog.json'));
    this.catalog = new CombinedCatalog(() => this.fal.get());
    this.render = deps.overrides?.render ?? new RenderService({ workDir: join(deps.appDataDir, 'render-cache'), browserExecutable: process.env.STUDIO_CHROMIUM_PATH });
    this.mediaValue = deps.overrides?.media ?? null;
    this.derived = new DerivedMedia(() => this.media);
  }

  private get media(): MediaToolkit {
    this.mediaValue ??= defaultMediaToolkit();
    return this.mediaValue;
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
    return this.snapshot(open);
  }

  async openProject(path: string): Promise<ProjectSnapshot> {
    for (const open of this.projects.values()) {
      if (open.store.dir === path) return this.snapshot(open);
    }
    if (!(await ProjectStore.isProject(path))) throw new Error(`Kein Director-Studio-Projekt: ${path}`);
    const store = await ProjectStore.open(path);
    const open = this.register(store);
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
    };
    this.projects.set(id, open);
    return open;
  }

  private project(projectId: string): OpenProject {
    const open = this.projects.get(projectId);
    if (!open) throw new Error('Projekt ist nicht geöffnet');
    return open;
  }

  private async touchRecent(open: OpenProject): Promise<void> {
    const m = open.store.manifest;
    await this.recent.touch({ path: open.store.dir, title: m.title, category: m.category, updatedAt: m.updatedAt });
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
      assets: store.allAssets(),
      usedAssetIds: [...(await store.usedAssetIds())],
      budget: store.budgetSummary(),
      checkpoints: store.manifest.checkpoints,
      messages: await store.listMessages(),
      generations: store.listGenerations(),
      runState: open.runState,
      pendingQuestion: pendingQuestion ? { questionId: pendingQuestion.questionId, questions: pendingQuestion.questions } : null,
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
    if (!open) return null;
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
    const hasViteProject = doc.framework === 'vite-react' && (await ProjectStore.isProject(open.store.dir)) && (await hasFile(join(open.store.siteDir, 'package.json')));
    // Kein Picker im ausgelieferten HTML: Die Electron-Vorschau lädt ihn selbst in eine isolierte Welt
    // (Seiten-Skripte können ihn dort weder sehen noch Picks vortäuschen).
    const server = await mod.SiteServer.start(open.store.siteDir, { injectPicker: false, framework: hasViteProject ? 'vite-react' : 'html' });
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
    return runExport(open.store, options, {
      media: this.media,
      render: this.render,
      siteUrl: () => this.ensureSite(open),
    });
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

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

async function hasFile(path: string): Promise<boolean> {
  const { stat } = await import('node:fs/promises');
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

