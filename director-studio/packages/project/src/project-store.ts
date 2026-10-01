import { lstat, mkdir, readdir, readFile, realpath, rename, rmdir, stat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import {
  assetSchema,
  BudgetLedger,
  CATEGORY_DOCUMENT,
  commitOps as coreCommitOps,
  createCheckpoints,
  createDocument,
  DEFAULT_PICKERS,
  defaultIdGenerator,
  documentAssetIds,
  extensionFromMime,
  isSafeSitePath,
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
import {
  appendJsonLine,
  appendJsonLines,
  copyFileAtomic,
  copyFileSynced,
  describeCorruptLine,
  ensureDir,
  exists,
  isRegularFile,
  readJson,
  readJsonLines,
  safeFileName,
  sha256Buffer,
  sha256File,
  writeFileAtomic,
  writeJsonAtomic,
  type ReadJsonLinesOptions,
} from './fsutil.ts';
import { ProjectIndex } from './index-db.ts';
import { FileVersionStore } from './version-store.ts';

export const PROJECT_EXTENSION = '.dstudio';

export interface ProjectStoreOptions {
  now?: () => string;
  ids?: IdGenerator;
  /** Index im Speicher halten (Tests). */
  inMemoryIndex?: boolean;
  /** Warnungen (z. B. übersprungene beschädigte Journalzeilen); Standard: `console.warn`. */
  onWarning?: (message: string) => void;
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

/**
 * Ordner/Dateien unter `site/`, die weder gesichert noch beim Wiederherstellen angefasst werden: Build- und
 * Abhängigkeitsordner sowie `.env*` (Geheimnisse des Nutzers; der Director darf sie ohnehin nicht schreiben).
 */
function isSiteIgnored(name: string): boolean {
  return SITE_IGNORE.has(name) || /^\.env(\..*)?$/.test(name);
}

const CLOSED_MESSAGE = 'Projekt ist geschlossen';

/** Windows-Laufwerks-/UNC-Pfad oder POSIX-absoluter Pfad – unabhängig vom aktuellen Betriebssystem. */
function looksAbsolute(path: string): boolean {
  return isAbsolute(path) || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/**
 * Projektrelative Pfade werden immer mit `/` gespeichert (ein Projektordner wandert zwischen macOS und Windows).
 * Ältere, unter Windows geschriebene Einträge mit `\` werden beim Lesen vereinheitlicht.
 */
export function normalizeStoredPath(path: string): string {
  return looksAbsolute(path) ? path : path.replace(/\\/g, '/');
}

/**
 * Löst einen gespeicherten Asset-Pfad auf: projektrelativ (POSIX oder alt mit `\`) → absoluter Pfad im Projekt;
 * absolute Pfade (verknüpfte Dateien) bleiben unverändert – auch fremde, z. B. `C:\…` auf macOS (dann „fehlt“).
 */
export function resolveStoredPath(projectDir: string, stored: string): string {
  if (looksAbsolute(stored)) return stored;
  return join(projectDir, ...stored.split(/[\\/]+/).filter(Boolean));
}

function sameLedgerEntry(a: LedgerEntry, b: LedgerEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Entfernt doppelt geschriebene Ledger-Zeilen (gleiche ID und identischer Inhalt), wie sie entstehen, wenn ein
 * Anhängen auf der Platte ankam, aber als Fehler gemeldet und später wiederholt wurde.
 */
export function dedupeLedgerEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const seen = new Map<string, LedgerEntry[]>();
  const out: LedgerEntry[] = [];
  for (const entry of entries) {
    const same = seen.get(entry.id) ?? [];
    if (same.some((e) => sameLedgerEntry(e, entry))) continue;
    same.push(entry);
    seen.set(entry.id, same);
    out.push(entry);
  }
  return out;
}

function lineWarnings(warn: (message: string) => void): ReadJsonLinesOptions {
  return { onCorruptLine: (info) => warn(describeCorruptLine(info)) };
}

/** Wirft, wenn `target` (oder sein nächster existierender Vorfahr) per Symlink aus `root` herausführt. */
async function assertInside(root: string, target: string): Promise<void> {
  let probe = target;
  for (;;) {
    let real: string;
    try {
      real = await realpath(probe);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(probe);
      if (parent === probe) throw new Error(`Pfad nicht auflösbar: ${target}`);
      probe = parent;
      continue;
    }
    const rel = relative(root, real);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Pfad verlässt site/: ${target}`);
    return;
  }
}

/** Ein Projektordner (`*.dstudio`) mit Dokument, Versionen, Assets, Journalen und Index. */
export class ProjectStore {
  readonly dir: string;
  private manifestValue: ProjectManifest;
  private readonly versions: FileVersionStore;
  private readonly index: ProjectIndex;
  private readonly now: () => string;
  private readonly ids: IdGenerator;
  private readonly warn: (message: string) => void;
  private ledgerValue: BudgetLedger;
  private persistedLedgerCount: number;
  private messagesCache: ChatMessage[] | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | null = null;
  /** Begonnene Schreiboperationen; `close()` wartet, bis sie abgeschlossen sind. */
  private readonly pending = new Set<Promise<void>>();

  private constructor(dir: string, manifest: ProjectManifest, ledgerEntries: LedgerEntry[], options: ProjectStoreOptions) {
    this.dir = dir;
    this.manifestValue = manifest;
    this.now = options.now ?? (() => new Date().toISOString());
    this.ids = options.ids ?? defaultIdGenerator;
    this.warn = options.onWarning ?? ((message) => console.warn(message));
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
    const warn = options.onWarning ?? ((message: string) => console.warn(message));
    const manifest = parseManifest(await readJson(join(dir, 'project.json')));
    const ledger = dedupeLedgerEntries(await readJsonLines<LedgerEntry>(join(dir, 'log', 'ledger.jsonl'), lineWarnings(warn)));
    const store = new ProjectStore(dir, manifest, ledger, options);
    await store.rebuildIndex();
    await store.repairMissingDocument();
    return store;
  }

  static async isProject(dir: string): Promise<boolean> {
    return exists(join(dir, 'project.json'));
  }

  /** Index aus den kanonischen Logs neu aufbauen. */
  async rebuildIndex(): Promise<void> {
    const warnings = lineWarnings(this.warn);
    this.index.clear();
    for (const asset of await readJsonLines<Asset>(join(this.dir, 'assets', 'records.jsonl'), warnings)) {
      this.index.upsertAsset(asset.path ? { ...asset, path: normalizeStoredPath(asset.path) } : asset);
    }
    for (const edge of await readJsonLines<LineageEdge>(join(this.dir, 'assets', 'lineage.jsonl'), warnings)) this.index.addLineage(edge);
    for (const gen of await readJsonLines<Generation>(join(this.dir, 'log', 'generations.jsonl'), warnings)) this.index.upsertGeneration(gen);
  }

  /**
   * Selbstheilung: Kategorie gesetzt, aber noch keine Version (Absturz zwischen Manifest und erster Version in
   * einer älteren App-Version) – dann das Startdokument jetzt anlegen.
   */
  private async repairMissingDocument(): Promise<void> {
    const category = this.manifestValue.category;
    if (!category || (await this.versions.head())) return;
    this.warn(`Projekt ${this.dir}: Kategorie „${category}“ ohne Dokument – Startdokument wird angelegt`);
    await this.initDocument(category, this.manifestValue.formats);
  }

  /**
   * Schließt das Projekt: Neue Schreiboperationen werden sofort abgelehnt, bereits begonnene laufen zu Ende;
   * erst danach wird der Index geschlossen.
   */
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.closed = true;
      while (this.pending.size > 0) await Promise.all([...this.pending]);
      await this.lock;
      this.index.close();
    })();
    return this.closing;
  }

  /** Öffentliche Schreiboperation: nach `close()` abgelehnt, bevor irgendetwas geschrieben wird. */
  private operation<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error(CLOSED_MESSAGE));
    const run = fn();
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.pending.add(settled);
    void settled.then(() => this.pending.delete(settled));
    return run;
  }

  /** Serialisiert schreibende Operationen (parallele Tool-Aufrufe des Directors). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Schreiboperation vollständig unter der Sperre. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    return this.operation(() => this.exclusive(fn));
  }

  // ───────────── Manifest ─────────────

  get manifest(): ProjectManifest {
    return structuredClone(this.manifestValue);
  }

  updateManifest(mutate: (draft: ProjectManifest) => void): Promise<ProjectManifest> {
    return this.locked(async () => {
      const draft = structuredClone(this.manifestValue);
      mutate(draft);
      return this.writeManifest(draft);
    });
  }

  private async writeManifest(draft: ProjectManifest): Promise<ProjectManifest> {
    draft.updatedAt = this.now();
    await writeJsonAtomic(join(this.dir, 'project.json'), draft);
    this.manifestValue = draft;
    return structuredClone(draft);
  }

  /**
   * Setzt die Kategorie nachträglich (Projekt ohne Kategorie angelegt, Director entscheidet im Planungsgespräch).
   * Prüfung und Änderung laufen unter einer Sperre; erst entsteht das Startdokument, dann wird das Manifest
   * geschrieben – ein Absturz dazwischen hinterlässt nie eine Kategorie ohne Dokument.
   */
  setCategory(category: ProjectCategory, formats?: FormatSpec[]): Promise<void> {
    return this.locked(async () => {
      const head = await this.versions.head();
      if (this.manifestValue.category && head) throw new Error('Kategorie ist bereits gesetzt');
      const fm = formats?.length ? formats : this.manifestValue.formats;
      // Ein Dokument ohne Kategorie im Manifest stammt aus einem abgebrochenen Aufruf; passt die Art, wird es übernommen.
      if (!head || head.document.kind !== CATEGORY_DOCUMENT[category]) await this.initDocument(category, fm);
      const draft = structuredClone(this.manifestValue);
      draft.category = category;
      draft.formats = fm;
      if (draft.checkpoints.length === 0) draft.checkpoints = createCheckpoints(category);
      await this.writeManifest(draft);
    });
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
    return this.locked(() => this.commitOpsUnlocked(ops, options));
  }

  private async commitOpsUnlocked(ops: DocumentOp[], options: { note: string; author: VersionAuthor; runId?: string; expectedHead?: number | null }): Promise<Version> {
    const version = await coreCommitOps(this.versions, ops, {
      ...options,
      ctx: { assetKind: (id) => this.index.getAsset(id)?.kind },
    });
    await this.touch();
    return version;
  }

  /**
   * „Wiederherstellen“ = neue Version mit dem Inhalt einer alten. Bei einer Website wird vorher `site/` exakt auf
   * den Dateistand der Version zurückgeschrieben (aus dem inhaltsadressierten Speicher); fehlt dafür Inhalt, schlägt
   * das Wiederherstellen fehl, ohne etwas zu verändern.
   */
  restoreVersion(number: number, author: VersionAuthor = 'user'): Promise<Version> {
    return this.locked(async () => {
      const target = await this.versions.get(number);
      if (!target) throw new Error(`Version ${number} existiert nicht`);
      if (target.document.kind === 'site') await this.materializeSite(number, target.document.files);
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
    return resolveStoredPath(this.dir, asset.path);
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

  /**
   * Importiert (kopiert in den Projektspeicher) oder verknüpft eine lokale Datei. Hashen und Kopieren laufen
   * ohne Sperre (inhaltsadressiert, atomar); nur Dublettenprüfung und Eintrag sind exklusiv.
   */
  importFile(filePath: string, mode: 'import' | 'link', options: AddAssetOptions = {}): Promise<Asset> {
    return this.operation(async () => {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error(`Keine Datei: ${filePath}`);
      const sha = await sha256File(filePath);
      const source = mode === 'link' ? 'linked' : 'imported';
      const mime = options.mime ?? mimeFromExtension(filePath);
      const path = mode === 'link' ? resolve(filePath) : await this.storeFile(filePath, sha, mime, info.size);
      return this.exclusive(async () => {
        const existing = this.index.allAssets().find((a) => a.sha256 === sha && a.source === source && a.status === 'active');
        if (existing) {
          // Gleicher Inhalt an neuem Ort, alter Ort fehlt: Verknüpfung auf den neuen Pfad umstellen statt den toten zurückzugeben.
          const existingPath = this.assetFilePath(existing);
          if (mode === 'link' && existingPath !== path && !(existingPath && (await isRegularFile(existingPath)))) {
            return this.appendAssetRecord({ ...existing, path, metadata: { ...(existing.metadata ?? {}), originalMtimeMs: info.mtimeMs } });
          }
          return existing;
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
    });
  }

  /** Legt Bytes als neues Asset im Projektspeicher ab (z. B. Director-Text, heruntergeladene Generierung). */
  addAssetFromBuffer(data: Uint8Array | string, options: AddAssetOptions & { fileName?: string }): Promise<Asset> {
    return this.operation(async () => {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const sha = sha256Buffer(bytes);
      const mime = options.mime ?? (options.fileName ? mimeFromExtension(options.fileName) : 'application/octet-stream');
      const rel = this.casPath(sha, mime);
      const abs = this.resolvePath(rel);
      if (!(await isRegularFile(abs, bytes.byteLength))) await writeFileAtomic(abs, bytes);
      return this.exclusive(() =>
        this.putAsset({
          ...this.baseAsset(options, mime, options.fileName ?? 'Asset'),
          source: options.source ?? 'generated',
          sha256: sha,
          path: rel,
          bytes: bytes.byteLength,
        }, options.parents),
      );
    });
  }

  /** Übernimmt eine (temporäre) Datei in den Projektspeicher; mit `move` wird sie verschoben. */
  addAssetFromFile(filePath: string, options: AddAssetOptions & { move?: boolean }): Promise<Asset> {
    return this.operation(async () => {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error(`Keine Datei: ${filePath}`);
      const sha = await sha256File(filePath);
      const mime = options.mime ?? mimeFromExtension(filePath);
      const rel = await this.storeFile(filePath, sha, mime, info.size, options.move);
      return this.exclusive(() =>
        this.putAsset({
          ...this.baseAsset(options, mime, basename(filePath)),
          source: options.source ?? 'generated',
          sha256: sha,
          path: rel,
          bytes: info.size,
        }, options.parents),
      );
    });
  }

  updateAsset(id: string, patch: Partial<Pick<Asset, 'title' | 'description' | 'tags' | 'status' | 'subtype' | 'metadata' | 'durationMs' | 'width' | 'height' | 'fps' | 'costUsd'>>): Promise<Asset> {
    return this.locked(async () => {
      const current = this.index.getAsset(id);
      if (!current) throw new Error(`Asset "${id}" existiert nicht`);
      const next = assetSchema.parse({ ...current, ...patch, metadata: patch.metadata ? { ...(current.metadata ?? {}), ...patch.metadata } : current.metadata });
      return this.appendAssetRecord(next);
    });
  }

  addLineage(edges: LineageEdge[]): Promise<void> {
    return this.locked(async () => {
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
    const path = asset && this.assetFilePath(asset);
    if (!asset || asset.source !== 'linked' || !path) return { ok: true };
    if (!(await exists(path))) return { ok: false, reason: 'missing' };
    const info = await stat(path);
    if (info.mtimeMs !== asset.metadata?.originalMtimeMs && (await sha256File(path)) !== asset.sha256) return { ok: false, reason: 'changed' };
    return { ok: true };
  }

  /**
   * Neuer Pfad für eine verknüpfte Datei; der Inhalt muss identisch sein. Gehasht wird ohne Sperre, geschrieben
   * wird der dann aktuelle Stand des Assets (parallele Änderungen an Status/Tags/Metadaten bleiben erhalten).
   */
  relink(assetId: string, newPath: string): Promise<Asset> {
    return this.operation(async () => {
      const notLinked = () => new Error(`Asset "${assetId}" ist keine verknüpfte Datei`);
      const before = this.getAsset(assetId);
      if (!before || before.source !== 'linked') throw notLinked();
      const path = resolve(newPath);
      const info = await stat(path);
      if (!info.isFile()) throw new Error(`Keine Datei: ${newPath}`);
      const sha = await sha256File(path);
      return this.exclusive(async () => {
        const current = this.index.getAsset(assetId);
        if (!current || current.source !== 'linked') throw notLinked();
        if (current.sha256 !== sha) throw new Error('Die neue Datei hat einen anderen Inhalt');
        return this.appendAssetRecord({ ...current, path, metadata: { ...(current.metadata ?? {}), originalMtimeMs: info.mtimeMs } });
      });
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

  /** Nur unter der Sperre aufrufen. */
  private async putAsset(input: AssetInput, parents?: AddAssetOptions['parents']): Promise<Asset> {
    const asset = await this.appendAssetRecord(assetSchema.parse(input));
    for (const p of parents ?? []) {
      const edge = { parentId: p.assetId, childId: asset.id, relation: p.relation };
      await appendJsonLine(join(this.dir, 'assets', 'lineage.jsonl'), edge);
      this.index.addLineage(edge);
    }
    return asset;
  }

  /** Nur unter der Sperre aufrufen. */
  private async appendAssetRecord(asset: Asset): Promise<Asset> {
    await appendJsonLine(join(this.dir, 'assets', 'records.jsonl'), asset);
    this.index.upsertAsset(asset);
    return asset;
  }

  private resolvePath(rel: string): string {
    return resolveStoredPath(this.dir, rel);
  }

  /** Relativer Pfad im inhaltsadressierten Speicher – immer mit `/` (plattformunabhängig). */
  private casPath(sha: string, mime: string): string {
    return posix.join('assets', 'store', sha.slice(0, 2), sha.slice(2, 4), `${sha}.${extensionFromMime(mime)}`);
  }

  /** Inhaltsadressierte Ablage ohne Endung (Website-Quelldateien der Versionen). */
  private blobPath(sha: string): string {
    return posix.join('assets', 'store', sha.slice(0, 2), sha.slice(2, 4), sha);
  }

  /**
   * Legt eine Datei inhaltsadressiert ab. Nie direkt an den Zielpfad kopieren (tmp + rename), damit ein Abbruch
   * keine halbe Datei hinterlässt. Eine vorhandene Datei mit falscher Größe (Überbleibsel eines Absturzes) wird ersetzt.
   */
  private async storeFile(filePath: string, sha: string, mime: string, size: number, move = false): Promise<string> {
    const rel = this.casPath(sha, mime);
    const abs = this.resolvePath(rel);
    if (await isRegularFile(abs, size)) {
      if (move && resolve(filePath) !== abs) await unlink(filePath).catch(() => undefined);
      return rel;
    }
    await mkdir(dirname(abs), { recursive: true });
    if (move) {
      try {
        await rename(filePath, abs);
        return rel;
      } catch {
        // Anderes Laufwerk: kopieren.
      }
    }
    await copyFileAtomic(filePath, abs);
    if (move) await unlink(filePath).catch(() => undefined);
    return rel;
  }

  // ───────────── Generierungen (Journal) ─────────────

  /** Muss VOR dem Absenden an fal aufgerufen werden (Absturzsicherheit). */
  saveGeneration(gen: Generation): Promise<Generation> {
    return this.locked(async () => {
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
    return this.locked(async () => {
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

  /** Bucht Director-Nutzung direkt als Ist-Kosten; mit `checkpointId` auf das Budget dieses Checkpoints. */
  budgetRecordUsage(refId: string, amountUsd: number, source: LedgerSource = 'director', note?: string, checkpointId?: string): Promise<void> {
    return this.ledgerMutation(() => this.ledgerValue.recordUsage(refId, amountUsd, source, note, checkpointId));
  }

  private ledgerMutation(fn: () => unknown): Promise<void> {
    return this.locked(async () => {
      fn();
      const entries = this.ledgerValue.listEntries();
      // Zähler je erfolgreich geschriebenem Eintrag erhöhen: Scheitert ein späterer, wird nichts doppelt angehängt.
      for (const entry of entries.slice(this.persistedLedgerCount)) {
        await appendJsonLine(join(this.dir, 'log', 'ledger.jsonl'), entry);
        this.persistedLedgerCount++;
      }
    });
  }

  // ───────────── Gespräch ─────────────

  async listMessages(): Promise<ChatMessage[]> {
    if (!this.messagesCache) this.messagesCache = await readJsonLines<ChatMessage>(join(this.dir, 'conversation', 'messages.jsonl'), lineWarnings(this.warn));
    return [...this.messagesCache];
  }

  appendMessage(message: ChatMessage): Promise<void> {
    return this.locked(async () => {
      await this.listMessages();
      await appendJsonLine(join(this.dir, 'conversation', 'messages.jsonl'), message);
      this.messagesCache!.push(message);
    });
  }

  /** Rohes LLM-Transkript je Laufzeit (nur anhängen; nötig für Prompt-Caching/Thinking-Bindung). */
  appendTranscript(runtimeId: string, entries: unknown[]): Promise<void> {
    return this.locked(() => appendJsonLines(join(this.dir, 'conversation', `transcript-${runtimeId}.jsonl`), entries));
  }

  readTranscript<T>(runtimeId: string): Promise<T[]> {
    return readJsonLines<T>(join(this.dir, 'conversation', `transcript-${runtimeId}.jsonl`), lineWarnings(this.warn));
  }

  // ───────────── Code & Website ─────────────

  get codeDir(): string {
    return join(this.dir, 'code');
  }

  get siteDir(): string {
    return join(this.dir, 'site');
  }

  /**
   * Snapshot des Website-Quellbaums (relativer POSIX-Pfad → SHA-256), ohne Build-/Abhängigkeitsordner und `.env*`.
   * Der Inhalt jeder Datei wird zusätzlich inhaltsadressiert abgelegt, damit sich jede Version wiederherstellen
   * lässt (siehe {@link restoreVersion}). Läuft unter der Sperre, damit er nie einen halb wiederhergestellten Baum sieht.
   */
  snapshotSiteFiles(): Promise<Record<string, string>> {
    return this.locked(() => this.snapshotSiteFilesUnlocked());
  }

  /**
   * Snapshot aufnehmen und als `snapshot_files`-Version committen – atomar unter einer Sperre (kein
   * Wiederherstellen kann sich zwischen Snapshot und Commit schieben).
   */
  commitSiteSnapshot(options: { note: string; author: VersionAuthor; runId?: string }): Promise<{ version: Version; files: Record<string, string> }> {
    return this.locked(async () => {
      const files = await this.snapshotSiteFilesUnlocked();
      const version = await this.commitOpsUnlocked([{ op: 'snapshot_files', files }], options);
      return { version, files };
    });
  }

  private async snapshotSiteFilesUnlocked(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const rel of await this.listSiteFiles()) {
      if (!isSafeSitePath(rel)) {
        this.warn(`Website-Datei mit ungültigem Namen nicht gesichert: ${rel}`);
        continue;
      }
      out[rel] = await this.storeSiteBlob(join(this.siteDir, ...rel.split('/')));
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  }

  /** Reguläre Dateien unter `site/` als relative POSIX-Pfade (ohne ignorierte Ordner/Dateien, ohne Symlinks). */
  private async listSiteFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (isSiteIgnored(entry.name)) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else if (entry.isFile()) out.push(relative(this.siteDir, abs).split(sep).join('/'));
      }
    };
    await walk(this.siteDir);
    return out;
  }

  /**
   * Legt den Inhalt einer Website-Datei inhaltsadressiert ab und gibt dessen SHA-256 zurück. Ist der Inhalt neu,
   * wird zuerst kopiert und die Kopie gehasht – so passt der gespeicherte Inhalt garantiert zum Hash, auch wenn
   * die Datei sich währenddessen ändert.
   */
  private async storeSiteBlob(abs: string): Promise<string> {
    const info = await stat(abs);
    const sha = await sha256File(abs);
    if (await isRegularFile(this.resolvePath(this.blobPath(sha)), info.size)) return sha;
    const staging = join(this.dir, 'assets', 'store', `.staging-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
    try {
      await mkdir(dirname(staging), { recursive: true });
      await copyFileSynced(abs, staging);
      const actual = await sha256File(staging);
      const target = this.resolvePath(this.blobPath(actual));
      await mkdir(dirname(target), { recursive: true });
      await rename(staging, target);
      return actual;
    } catch (error) {
      await unlink(staging).catch(() => undefined);
      throw error;
    }
  }

  /** Datei mit diesem Inhalt im Projektspeicher (Site-Ablage ohne Endung, sonst ein Asset gleichen Inhalts). */
  private async findBlob(sha: string): Promise<string | undefined> {
    const exact = this.resolvePath(this.blobPath(sha));
    if (await isRegularFile(exact)) return exact;
    const dir = dirname(exact);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return undefined;
    }
    for (const name of names) {
      if (!name.startsWith(`${sha}.`) || name.includes('.tmp-')) continue;
      const candidate = join(dir, name);
      if ((await isRegularFile(candidate)) && (await sha256File(candidate)) === sha) return candidate;
    }
    return undefined;
  }

  /**
   * Schreibt `site/` exakt auf den Dateistand eines Snapshots zurück: abweichende/fehlende Dateien aus dem
   * Projektspeicher, nicht enthaltene Dateien werden gelöscht. `node_modules/`, `dist/` usw. und `.env*` bleiben
   * unberührt. Fehlt Inhalt im Speicher, wird vor jeder Änderung abgebrochen.
   */
  private async materializeSite(number: number, files: Record<string, string>): Promise<void> {
    const siteDir = this.siteDir;
    const entries: Array<{ abs: string; sha: string; blob: string }> = [];
    const missing: string[] = [];
    // 1. Prüfen, ohne etwas zu verändern: Für jede Datei muss der Inhalt im Speicher liegen. Stimmt die Datei auf
    //    der Platte bereits (Snapshot einer älteren App-Version ohne gespeicherten Inhalt), wird sie jetzt gesichert –
    //    so übersteht sie auch das Löschen einer Datei, die sich nur in Groß-/Kleinschreibung unterscheidet.
    for (const [rel, sha] of Object.entries(files)) {
      const segments = rel.split('/');
      if (!isSafeSitePath(rel) || segments.some(isSiteIgnored)) throw new Error(`Version ${number}: ungültiger Pfad im Website-Snapshot: ${rel}`);
      const abs = join(siteDir, ...segments);
      let blob = await this.findBlob(sha);
      if (!blob && (await fileHasHash(abs, sha)) && (await this.storeSiteBlob(abs)) === sha) blob = await this.findBlob(sha);
      if (blob) entries.push({ abs, sha, blob });
      else missing.push(rel);
    }
    if (missing.length > 0) {
      const list = missing.slice(0, 5).join(', ') + (missing.length > 5 ? ` … (+${missing.length - 5})` : '');
      throw new Error(
        `Version ${number} lässt sich nicht wiederherstellen: Der Inhalt von ${missing.length} Website-Datei(en) fehlt im Projektspeicher (${list}). ` +
          'Die Version stammt vermutlich aus einer älteren App-Version, die nur Prüfsummen gesichert hat. site/ wurde nicht verändert.',
      );
    }
    // 2. Nicht enthaltene Dateien entfernen, leere Ordner aufräumen.
    await mkdir(siteDir, { recursive: true });
    const root = await realpath(siteDir);
    for (const rel of await this.listSiteFiles()) {
      if (!Object.hasOwn(files, rel)) await unlink(join(siteDir, ...rel.split('/')));
    }
    await removeEmptyDirs(siteDir);
    // 3. Abweichende oder fehlende Dateien aus dem Speicher schreiben (atomar, nie über einen Symlink hinaus).
    for (const { abs, sha, blob } of entries) {
      if (await fileHasHash(abs, sha)) continue;
      await assertInside(root, dirname(abs));
      await copyFileAtomic(blob, abs);
    }
  }
}

/** `true`, wenn `path` eine reguläre Datei (kein Symlink) mit genau diesem Inhalt ist. */
async function fileHasHash(path: string, sha: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isFile()) return false;
    return (await sha256File(path)) === sha;
  } catch {
    return false;
  }
}

/** Entfernt leere Unterordner (nicht `dir` selbst); ignorierte Ordner und Symlinks werden nicht betreten. */
async function removeEmptyDirs(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || isSiteIgnored(entry.name)) continue;
    const sub = join(dir, entry.name);
    await removeEmptyDirs(sub);
    if ((await readdir(sub)).length === 0) await rmdir(sub);
  }
}
