import { copyFile, mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import {
  assetSchema,
  BudgetLedger,
  commitOps as coreCommitOps,
  createCheckpoints,
  createDocument,
  DEFAULT_PICKERS,
  defaultIdGenerator,
  documentAssetIds,
  extensionFromMime,
  mimeFromExtension,
  assetKindFromMime,
  parseManifest,
  PROJECT_SCHEMA_VERSION,
  restoreVersion as coreRestoreVersion,
  STANDARD_FORMATS,
  type Asset,
  type AssetInput,
  type AssetKind,
  type AssetQuery,
  type BudgetApproval,
  type BudgetCheck,
  type BudgetSummary,
  type ChatMessage,
  type DocumentOp,
  type FormatSpec,
  type Generation,
  type IdGenerator,
  type LedgerEntry,
  type LedgerSource,
  type LineageEdge,
  type ProjectCategory,
  type ProjectManifest,
  type StudioDocument,
  type Version,
  type VersionAuthor,
  type VersionMeta,
} from '@studio/core';
import { appendJsonLine, ensureDir, exists, readJson, readJsonLines, safeFileName, sha256Buffer, sha256File, writeFileAtomic, writeJsonAtomic } from './fsutil.ts';
import { ProjectIndex } from './index-db.ts';
import { FileVersionStore } from './version-store.ts';

export const PROJECT_EXTENSION = '.dstudio';

export interface ProjectStoreOptions {
  now?: () => string;
  ids?: IdGenerator;
  /** Index im Speicher halten (Tests). */
  inMemoryIndex?: boolean;
}

export interface CreateProjectOptions {
  title: string;
  category: ProjectCategory | null;
  formats?: FormatSpec[];
  id?: string;
}

export interface AddAssetOptions {
  kind?: AssetKind;
  subtype?: string;
  title?: string;
  description?: string;
  tags?: string[];
  mime?: string;
  source?: Asset['source'];
  generationId?: string;
  modelId?: string;
  prompt?: string;
  costUsd?: number;
  sourceUrl?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  metadata?: Record<string, unknown>;
  parents?: Array<{ assetId: string; relation: LineageEdge['relation'] }>;
}

const SITE_IGNORE = new Set(['node_modules', 'dist', '.astro', '.vite', '.cache', '.git']);

/** Ein Projektordner (`*.dstudio`) mit Dokument, Versionen, Assets, Journalen und Index. */
export class ProjectStore {
  readonly dir: string;
  private manifestValue: ProjectManifest;
  private readonly versions: FileVersionStore;
  private readonly index: ProjectIndex;
  private readonly now: () => string;
  private readonly ids: IdGenerator;
  private ledgerValue: BudgetLedger;
  private persistedLedgerCount: number;
  private messagesCache: ChatMessage[] | null = null;
  private lock: Promise<unknown> = Promise.resolve();

  private constructor(dir: string, manifest: ProjectManifest, ledgerEntries: LedgerEntry[], options: ProjectStoreOptions) {
    this.dir = dir;
    this.manifestValue = manifest;
    this.now = options.now ?? (() => new Date().toISOString());
    this.ids = options.ids ?? defaultIdGenerator;
    this.versions = new FileVersionStore(dir, this.now);
    this.index = new ProjectIndex(options.inMemoryIndex ? ':memory:' : join(dir, '.studio', 'index.sqlite'));
    this.ledgerValue = new BudgetLedger({ entries: ledgerEntries, approvals: manifest.budgetApprovals }, this.now, () => this.ids('led'));
    this.persistedLedgerCount = ledgerEntries.length;
  }

  // ───────────── Anlegen & Öffnen ─────────────

  /** Legt `<parentDir>/<Titel>.dstudio` an (bei Namenskollision mit Suffix). */
  static async create(parentDir: string, input: CreateProjectOptions, options: ProjectStoreOptions = {}): Promise<ProjectStore> {
    const base = safeFileName(input.title);
    let dir = join(parentDir, `${base}${PROJECT_EXTENSION}`);
    for (let n = 2; await exists(dir); n++) dir = join(parentDir, `${base} ${n}${PROJECT_EXTENSION}`);
    return ProjectStore.createAt(dir, input, options);
  }

  static async createAt(dir: string, input: CreateProjectOptions, options: ProjectStoreOptions = {}): Promise<ProjectStore> {
    if (await exists(join(dir, 'project.json'))) throw new Error(`Projekt existiert bereits: ${dir}`);
    const now = options.now ?? (() => new Date().toISOString());
    const ids = options.ids ?? defaultIdGenerator;
    const formats = input.formats?.length ? input.formats : [STANDARD_FORMATS['16:9']!];
    const manifest: ProjectManifest = {
      schema: PROJECT_SCHEMA_VERSION,
      id: input.id ?? ids('prj'),
      title: input.title,
      category: input.category,
      createdAt: now(),
      updatedAt: now(),
      formats,
      brief: null,
      pickers: { ...DEFAULT_PICKERS },
      checkpoints: input.category ? createCheckpoints(input.category) : [],
      budgetApprovals: [],
      director: { effort: 'xhigh' },
      phase: 'planning',
    };
    for (const sub of ['documents', 'versions', 'assets/store', 'assets/derived', 'code/components', 'conversation', 'log', '.studio']) {
      await ensureDir(join(dir, sub));
    }
    await writeJsonAtomic(join(dir, 'project.json'), manifest);
    const store = new ProjectStore(dir, manifest, [], { ...options, now, ids });
    if (input.category) await store.initDocument(input.category, formats);
    return store;
  }

  static async open(dir: string, options: ProjectStoreOptions = {}): Promise<ProjectStore> {
    const manifest = parseManifest(await readJson(join(dir, 'project.json')));
    const ledger = await readJsonLines<LedgerEntry>(join(dir, 'log', 'ledger.jsonl'));
    const store = new ProjectStore(dir, manifest, ledger, options);
    await store.rebuildIndex();
    return store;
  }

  static async isProject(dir: string): Promise<boolean> {
    return exists(join(dir, 'project.json'));
  }

  /** Index aus den kanonischen Logs neu aufbauen. */
  async rebuildIndex(): Promise<void> {
    this.index.clear();
    for (const asset of await readJsonLines<Asset>(join(this.dir, 'assets', 'records.jsonl'))) this.index.upsertAsset(asset);
    for (const edge of await readJsonLines<LineageEdge>(join(this.dir, 'assets', 'lineage.jsonl'))) this.index.addLineage(edge);
    for (const gen of await readJsonLines<Generation>(join(this.dir, 'log', 'generations.jsonl'))) this.index.upsertGeneration(gen);
  }

  close(): void {
    this.index.close();
  }

  /** Serialisiert schreibende Operationen (parallele Tool-Aufrufe des Directors). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  // ───────────── Manifest ─────────────

  get manifest(): ProjectManifest {
    return structuredClone(this.manifestValue);
  }

  updateManifest(mutate: (draft: ProjectManifest) => void): Promise<ProjectManifest> {
    return this.exclusive(async () => {
      const draft = structuredClone(this.manifestValue);
      mutate(draft);
      draft.updatedAt = this.now();
      await writeJsonAtomic(join(this.dir, 'project.json'), draft);
      this.manifestValue = draft;
      return structuredClone(draft);
    });
  }

  /** Setzt die Kategorie nachträglich (Projekt ohne Kategorie angelegt, Director entscheidet im Planungsgespräch). */
  async setCategory(category: ProjectCategory, formats?: FormatSpec[]): Promise<void> {
    if (this.manifestValue.category && (await this.versions.head())) throw new Error('Kategorie ist bereits gesetzt');
    const fm = formats?.length ? formats : this.manifestValue.formats;
    await this.updateManifest((m) => {
      m.category = category;
      m.formats = fm;
      if (m.checkpoints.length === 0) m.checkpoints = createCheckpoints(category);
    });
    await this.initDocument(category, fm);
  }

  private async initDocument(category: ProjectCategory, formats: FormatSpec[]): Promise<void> {
    const doc = createDocument(category, { format: formats[0]!, formats });
    await this.versions.commit({ document: doc, ops: [], note: 'Projekt angelegt', author: 'system' });
  }

  // ───────────── Dokument & Versionen ─────────────

  async getDocument(): Promise<StudioDocument | null> {
    return (await this.versions.head())?.document ?? null;
  }

  async head(): Promise<Version | null> {
    return this.versions.head();
  }

  listVersions(): Promise<VersionMeta[]> {
    return this.versions.list();
  }

  getVersion(number: number): Promise<Version | null> {
    return this.versions.get(number);
  }

  commitOps(ops: DocumentOp[], options: { note: string; author: VersionAuthor; runId?: string; expectedHead?: number | null }): Promise<Version> {
    return this.exclusive(async () => {
      const version = await coreCommitOps(this.versions, ops, {
        ...options,
        ctx: { assetKind: (id) => this.index.getAsset(id)?.kind },
      });
      await this.touch();
      return version;
    });
  }

  restoreVersion(number: number, author: VersionAuthor = 'user'): Promise<Version> {
    return this.exclusive(async () => {
      const version = await coreRestoreVersion(this.versions, number, { author });
      await this.touch();
      return version;
    });
  }

  async usedAssetIds(): Promise<Set<string>> {
    const doc = await this.getDocument();
    return doc ? documentAssetIds(doc) : new Set();
  }

  private async touch(): Promise<void> {
    this.manifestValue.updatedAt = this.now();
    await writeJsonAtomic(join(this.dir, 'project.json'), this.manifestValue);
  }

  // ───────────── Assets ─────────────

  /** Absoluter Pfad der Datei eines Assets (Projektspeicher oder verknüpfte Originaldatei). */
  assetFilePath(asset: Pick<Asset, 'path'>): string | undefined {
    if (!asset.path) return undefined;
    return isAbsolute(asset.path) ? asset.path : join(this.dir, asset.path);
  }

  getAsset(id: string): Asset | undefined {
    return this.index.getAsset(id);
  }

  listAssets(query: AssetQuery = {}): Asset[] {
    return this.index.searchAssets(query);
  }

  allAssets(): Asset[] {
    return this.index.allAssets();
  }

  /** Importiert (kopiert in den Projektspeicher) oder verknüpft eine lokale Datei. */
  importFile(filePath: string, mode: 'import' | 'link', options: AddAssetOptions = {}): Promise<Asset> {
    return this.exclusive(async () => {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error(`Keine Datei: ${filePath}`);
      const sha = await sha256File(filePath);
      const source = mode === 'link' ? 'linked' : 'imported';
      const existing = this.index.allAssets().find((a) => a.sha256 === sha && a.source === source && a.status === 'active');
      if (existing) return existing;
      const mime = options.mime ?? mimeFromExtension(filePath);
      let path: string;
      if (mode === 'link') {
        path = filePath;
      } else {
        path = await this.storeFile(filePath, sha, mime);
      }
      return this.putAsset({
        ...this.baseAsset(options, mime, basename(filePath)),
        source: options.source ?? source,
        sha256: sha,
        path,
        bytes: info.size,
        metadata: { ...(options.metadata ?? {}), ...(mode === 'link' ? { originalMtimeMs: info.mtimeMs } : {}) },
      }, options.parents);
    });
  }

  /** Legt Bytes als neues Asset im Projektspeicher ab (z. B. Director-Text, heruntergeladene Generierung). */
  addAssetFromBuffer(data: Uint8Array | string, options: AddAssetOptions & { fileName?: string }): Promise<Asset> {
    return this.exclusive(async () => {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const sha = sha256Buffer(bytes);
      const mime = options.mime ?? (options.fileName ? mimeFromExtension(options.fileName) : 'application/octet-stream');
      const rel = this.casPath(sha, mime);
      const abs = join(this.dir, rel);
      if (!(await exists(abs))) await writeFileAtomic(abs, bytes);
      return this.putAsset({
        ...this.baseAsset(options, mime, options.fileName ?? 'Asset'),
        source: options.source ?? 'generated',
        sha256: sha,
        path: rel,
        bytes: bytes.byteLength,
      }, options.parents);
    });
  }

  /** Übernimmt eine (temporäre) Datei in den Projektspeicher; mit `move` wird sie verschoben. */
  addAssetFromFile(filePath: string, options: AddAssetOptions & { move?: boolean }): Promise<Asset> {
    return this.exclusive(async () => {
      const info = await stat(filePath);
      const sha = await sha256File(filePath);
      const mime = options.mime ?? mimeFromExtension(filePath);
      const rel = await this.storeFile(filePath, sha, mime, options.move);
      return this.putAsset({
        ...this.baseAsset(options, mime, basename(filePath)),
        source: options.source ?? 'generated',
        sha256: sha,
        path: rel,
        bytes: info.size,
      }, options.parents);
    });
  }

  updateAsset(id: string, patch: Partial<Pick<Asset, 'title' | 'description' | 'tags' | 'status' | 'subtype' | 'metadata' | 'durationMs' | 'width' | 'height' | 'fps' | 'costUsd'>>): Promise<Asset> {
    return this.exclusive(async () => {
      const current = this.index.getAsset(id);
      if (!current) throw new Error(`Asset "${id}" existiert nicht`);
      const next = assetSchema.parse({ ...current, ...patch, metadata: patch.metadata ? { ...(current.metadata ?? {}), ...patch.metadata } : current.metadata });
      await appendJsonLine(join(this.dir, 'assets', 'records.jsonl'), next);
      this.index.upsertAsset(next);
      return next;
    });
  }

  addLineage(edges: LineageEdge[]): Promise<void> {
    return this.exclusive(async () => {
      for (const edge of edges) {
        await appendJsonLine(join(this.dir, 'assets', 'lineage.jsonl'), edge);
        this.index.addLineage(edge);
      }
    });
  }

  lineage(assetId: string): { parents: LineageEdge[]; children: LineageEdge[] } {
    return { parents: this.index.parentsOf(assetId), children: this.index.childrenOf(assetId) };
  }

  /** Prüft verknüpfte Dateien (verschoben/geändert?). */
  async checkLinked(assetId: string): Promise<{ ok: true } | { ok: false; reason: 'missing' | 'changed' }> {
    const asset = this.getAsset(assetId);
    if (!asset || asset.source !== 'linked' || !asset.path) return { ok: true };
    if (!(await exists(asset.path))) return { ok: false, reason: 'missing' };
    const info = await stat(asset.path);
    if (info.mtimeMs !== asset.metadata?.originalMtimeMs && (await sha256File(asset.path)) !== asset.sha256) return { ok: false, reason: 'changed' };
    return { ok: true };
  }

  /** Neuer Pfad für eine verknüpfte Datei; der Inhalt muss identisch sein. */
  async relink(assetId: string, newPath: string): Promise<Asset> {
    const asset = this.getAsset(assetId);
    if (!asset || asset.source !== 'linked') throw new Error(`Asset "${assetId}" ist keine verknüpfte Datei`);
    if ((await sha256File(newPath)) !== asset.sha256) throw new Error('Die neue Datei hat einen anderen Inhalt');
    const info = await stat(newPath);
    return this.exclusive(async () => {
      const next = { ...asset, path: newPath, metadata: { ...(asset.metadata ?? {}), originalMtimeMs: info.mtimeMs } };
      await appendJsonLine(join(this.dir, 'assets', 'records.jsonl'), next);
      this.index.upsertAsset(next);
      return next;
    });
  }

  derivedDir(assetId: string): string {
    return join(this.dir, 'assets', 'derived', assetId);
  }

  async readAssetText(assetId: string): Promise<string> {
    const asset = this.getAsset(assetId);
    const path = asset && this.assetFilePath(asset);
    if (!path) throw new Error(`Asset "${assetId}" hat keine Datei`);
    return readFile(path, 'utf8');
  }

  private baseAsset(options: AddAssetOptions, mime: string, fallbackTitle: string): Omit<AssetInput, 'source'> {
    return {
      id: this.ids('ast'),
      kind: options.kind ?? assetKindFromMime(mime),
      subtype: options.subtype,
      title: options.title ?? fallbackTitle,
      description: options.description,
      tags: options.tags ?? [],
      status: 'active',
      mime,
      generationId: options.generationId,
      modelId: options.modelId,
      prompt: options.prompt,
      costUsd: options.costUsd,
      sourceUrl: options.sourceUrl,
      durationMs: options.durationMs,
      width: options.width,
      height: options.height,
      fps: options.fps,
      createdAt: this.now(),
      metadata: options.metadata,
    };
  }

  private async putAsset(input: AssetInput, parents?: AddAssetOptions['parents']): Promise<Asset> {
    const asset = assetSchema.parse(input);
    await appendJsonLine(join(this.dir, 'assets', 'records.jsonl'), asset);
    this.index.upsertAsset(asset);
    for (const p of parents ?? []) {
      const edge = { parentId: p.assetId, childId: asset.id, relation: p.relation };
      await appendJsonLine(join(this.dir, 'assets', 'lineage.jsonl'), edge);
      this.index.addLineage(edge);
    }
    return asset;
  }

  private casPath(sha: string, mime: string): string {
    return join('assets', 'store', sha.slice(0, 2), sha.slice(2, 4), `${sha}.${extensionFromMime(mime)}`);
  }

  private async storeFile(filePath: string, sha: string, mime: string, move = false): Promise<string> {
    const rel = this.casPath(sha, mime);
    const abs = join(this.dir, rel);
    if (await exists(abs)) return rel;
    await mkdir(join(abs, '..'), { recursive: true });
    if (move) {
      try {
        await rename(filePath, abs);
        return rel;
      } catch {
        // Anderes Laufwerk: kopieren.
      }
    }
    await copyFile(filePath, abs);
    return rel;
  }

  // ───────────── Generierungen (Journal) ─────────────

  /** Muss VOR dem Absenden an fal aufgerufen werden (Absturzsicherheit). */
  saveGeneration(gen: Generation): Promise<Generation> {
    return this.exclusive(async () => {
      await appendJsonLine(join(this.dir, 'log', 'generations.jsonl'), gen);
      this.index.upsertGeneration(gen);
      return gen;
    });
  }

  getGeneration(id: string): Generation | undefined {
    return this.index.getGeneration(id);
  }

  listGenerations(statuses?: Generation['status'][]): Generation[] {
    return this.index.listGenerations(statuses);
  }

  // ───────────── Budget ─────────────

  budgetSummary(): BudgetSummary {
    return this.ledgerValue.summary();
  }

  budgetCheck(amountUsd: number, checkpointId?: string): BudgetCheck {
    return this.ledgerValue.check(amountUsd, checkpointId);
  }

  ledgerEntries(): readonly LedgerEntry[] {
    return this.ledgerValue.listEntries();
  }

  approveBudget(checkpointId: string, amountUsd: number, note?: string): Promise<BudgetApproval> {
    return this.exclusive(async () => {
      const approval = this.ledgerValue.approve(checkpointId, amountUsd, note);
      this.manifestValue.budgetApprovals = [...this.ledgerValue.listApprovals()];
      await this.touch();
      return approval;
    });
  }

  budgetReserve(refId: string, amountUsd: number, options: { source?: LedgerSource; checkpointId?: string; note?: string } = {}): Promise<void> {
    return this.ledgerMutation(() => this.ledgerValue.reserve(refId, amountUsd, options));
  }

  budgetSettle(refId: string, actualUsd: number, options: { source?: LedgerSource; checkpointId?: string; note?: string } = {}): Promise<void> {
    return this.ledgerMutation(() => this.ledgerValue.settle(refId, actualUsd, options));
  }

  budgetRelease(refId: string): Promise<void> {
    return this.ledgerMutation(() => this.ledgerValue.release(refId));
  }

  budgetRecordUsage(refId: string, amountUsd: number, source: LedgerSource = 'director', note?: string): Promise<void> {
    return this.ledgerMutation(() => this.ledgerValue.recordUsage(refId, amountUsd, source, note));
  }

  private ledgerMutation(fn: () => unknown): Promise<void> {
    return this.exclusive(async () => {
      fn();
      const entries = this.ledgerValue.listEntries();
      for (const entry of entries.slice(this.persistedLedgerCount)) {
        await appendJsonLine(join(this.dir, 'log', 'ledger.jsonl'), entry);
      }
      this.persistedLedgerCount = entries.length;
    });
  }

  // ───────────── Gespräch ─────────────

  async listMessages(): Promise<ChatMessage[]> {
    if (!this.messagesCache) this.messagesCache = await readJsonLines<ChatMessage>(join(this.dir, 'conversation', 'messages.jsonl'));
    return [...this.messagesCache];
  }

  appendMessage(message: ChatMessage): Promise<void> {
    return this.exclusive(async () => {
      await this.listMessages();
      await appendJsonLine(join(this.dir, 'conversation', 'messages.jsonl'), message);
      this.messagesCache!.push(message);
    });
  }

  /** Rohes LLM-Transkript je Laufzeit (nur anhängen; nötig für Prompt-Caching/Thinking-Bindung). */
  appendTranscript(runtimeId: string, entries: unknown[]): Promise<void> {
    return this.exclusive(async () => {
      for (const entry of entries) await appendJsonLine(join(this.dir, 'conversation', `transcript-${runtimeId}.jsonl`), entry);
    });
  }

  readTranscript<T>(runtimeId: string): Promise<T[]> {
    return readJsonLines<T>(join(this.dir, 'conversation', `transcript-${runtimeId}.jsonl`));
  }

  // ───────────── Code & Website ─────────────

  get codeDir(): string {
    return join(this.dir, 'code');
  }

  get siteDir(): string {
    return join(this.dir, 'site');
  }

  /** Snapshot des Website-Quellbaums (relativer Pfad → SHA-256), ohne Build-/Abhängigkeitsordner. */
  async snapshotSiteFiles(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SITE_IGNORE.has(entry.name)) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else if (entry.isFile()) out[relative(this.siteDir, abs).split(sep).join('/')] = await sha256File(abs);
      }
    };
    await walk(this.siteDir);
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
}
