import type { PersistentUpload } from './transfers.ts';
import type { AppSettings, Asset, CheckpointDecision, DirectorQuestion, Generation, LedgerEntry, LineageEdge, ProjectManifest, StudioDocument, Version } from '@studio/core';

/** Structural Worker interfaces: do not import Node libraries into the deployed Worker. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}
export interface D1Database { prepare(sql: string): D1Statement; batch(statements: D1Statement[]): Promise<Array<{ meta: { changes?: number } }>>; }
export interface R2Object {
  body: ReadableStream<Uint8Array>; size: number; httpEtag?: string;
  httpMetadata?: { contentType?: string };
  range?: { offset?: number; length?: number };
}
export interface R2MultipartUpload { uploadPart(partNumber: number, value: Uint8Array): Promise<{ partNumber: number; etag: string }>; complete(parts: Array<{ partNumber: number; etag: string }>): Promise<unknown>; abort(): Promise<void>; }
export interface R2Bucket {
  createMultipartUpload?(key: string, options?: { httpMetadata?: { contentType?: string } }): Promise<R2MultipartUpload>;
  delete?(key: string): Promise<void>;
  put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string, options?: { range?: Headers }): Promise<R2Object | null>;
}
export interface StaticFetcher { fetch(request: Request): Promise<Response>; }
export interface WorkerEnv { DB: D1Database; MEDIA: R2Bucket; ASSETS?: StaticFetcher; UI?: StaticFetcher; MAX_IMPORT_BYTES?: string; DIRECTOR_OPENAI_APPS_CHALLENGE?: string; }
export interface UserIdentity { id: string; email: string; }
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export interface PersistentJob {
  id: string; kind: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
  createdAt: string; updatedAt: string; input: Record<string, unknown>; executorId?: string; leaseUntil?: string; projectVersion?: number; output?: Record<string, unknown>; error?: string;
}
export interface PendingApproval {
  id: string; kind: 'budget' | 'upload' | 'export'; title: string; detail: string;
  amountUsd?: number; createdAt: string; generationId?: string;
}
export interface CloudProject {
  uploads?: PersistentUpload[];
  manifest: ProjectManifest;
  versions: Version[];
  assets: Asset[];
  lineage: LineageEdge[];
  ledger: LedgerEntry[];
  generations: Generation[];
  jobs: PersistentJob[];
  pendingQuestion: { questionId: string; questions: DirectorQuestion[] } | null;
  questionAnswers: Array<{ questionId: string; answers: Record<string, string>; answeredAt: string }>;
  pendingApprovals: PendingApproval[];
  decisions: Array<{ kind: string; id: string; value: boolean | CheckpointDecision; at: string }>;
  siteFiles: Record<string, string>;
  siteVersions: Record<string, Record<string, string>>;
  updates: Array<{ id: string; text: string; createdAt: string }>;
}
export interface StoredProject { id: string; owner_id: string; revision: number; updated_at: string; state_json: string; }
export interface LoadedProject { state: CloudProject; revision: number; }

/** These headers are injected by Sites' authenticated hosting boundary, never by UI arguments. */
export function requireIdentity(request: Request): UserIdentity {
  const id = request.headers.get('oai-authenticated-user-id')?.trim();
  const email = request.headers.get('oai-authenticated-user-email')?.trim();
  if (!id || !email) throw new ApiError(401, 'AUTH_REQUIRED', 'Connect Director Studio with your host account.');
  return { id, email };
}
export class CloudStore {
  constructor(readonly db: D1Database, readonly owner: UserIdentity) {}
  async load(id: string): Promise<LoadedProject> {
    const row = await this.db.prepare('SELECT id,owner_id,revision,updated_at,state_json FROM director_projects WHERE id=? AND owner_id=?').bind(id, this.owner.id).first<StoredProject>();
    // No distinction between an unknown project and another user's project.
    if (!row) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found.');
    const state = JSON.parse(row.state_json) as CloudProject;
    const versions = await this.db.prepare('SELECT version_json,site_files_json FROM director_versions WHERE project_id=? ORDER BY number').bind(id).all<{ version_json: string; site_files_json: string }>();
    state.versions = versions.results.map(v => JSON.parse(v.version_json));
    state.siteVersions = Object.fromEntries(versions.results.map(v => [String(JSON.parse(v.version_json).number), JSON.parse(v.site_files_json)]));
    return { state, revision: row.revision };
  }
  async create(state: CloudProject): Promise<LoadedProject> {
    const token = id('commit');
    const statements = [this.db.prepare('INSERT INTO director_projects(id,owner_id,revision,updated_at,state_json,commit_token) VALUES(?,?,1,?,?,?)').bind(state.manifest.id, this.owner.id, state.manifest.updatedAt, serializeState(state), token)];
    const version = state.versions.at(-1); if (version) statements.push(this.versionStatement(state.manifest.id, state, version, token));
    await this.db.batch(statements);
    return { state, revision: 1 };
  }
  async list(): Promise<LoadedProject[]> {
    const rows = await this.db.prepare('SELECT id,owner_id,revision,updated_at,state_json FROM director_projects WHERE owner_id=? ORDER BY updated_at DESC LIMIT 200').bind(this.owner.id).all<StoredProject>();
    return rows.results.map(row => ({ state: JSON.parse(row.state_json), revision: row.revision }));
  }
  async save(id: string, state: CloudProject, expectedRevision: number): Promise<number> {
    state.manifest.updatedAt = new Date().toISOString();
    const token = `commit_${crypto.randomUUID()}`;
    const statements = [this.db.prepare('UPDATE director_projects SET state_json=?,updated_at=?,revision=revision+1,commit_token=? WHERE id=? AND owner_id=? AND revision=?').bind(serializeState(state), state.manifest.updatedAt, token, id, this.owner.id, expectedRevision)];
    const version = state.versions.at(-1); if (version) statements.push(this.versionStatement(id, state, version, token));
    const results = await this.db.batch(statements);
    if (results[0]?.meta.changes !== 1) throw new ApiError(409, 'PROJECT_CONFLICT', 'The project changed in another editor. Reload before retrying.');
    return expectedRevision + 1;
  }
  private versionStatement(projectId: string, state: CloudProject, version: Version, token: string): D1Statement {
    // The same transaction inserts only after OUR CAS succeeded, identified by the
    // unique commit token. A stale writer cannot append a phantom document version.
    return this.db.prepare('INSERT OR IGNORE INTO director_versions(project_id,number,version_json,site_files_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM director_projects WHERE id=? AND owner_id=? AND commit_token=?)').bind(projectId, version.number, JSON.stringify(version), JSON.stringify(state.siteVersions[String(version.number)] ?? {}), projectId, this.owner.id, token);
  }
  async settings(): Promise<AppSettings> {
    const row = await this.db.prepare('SELECT settings_json FROM director_settings WHERE owner_id=?').bind(this.owner.id).first<{ settings_json: string }>();
    return { language: 'de', defaultEffort: 'xhigh', preferredRuntime: 'auto', projectsDir: '', allowClaudeSubscription: false, ...row && JSON.parse(row.settings_json) };
  }
  async saveSettings(settings: AppSettings): Promise<void> {
    await this.db.prepare('INSERT INTO director_settings(owner_id,settings_json) VALUES(?,?) ON CONFLICT(owner_id) DO UPDATE SET settings_json=excluded.settings_json').bind(this.owner.id, JSON.stringify(settings)).run();
  }
}

export function head(state: CloudProject): Version | undefined { return state.versions.at(-1); }
export function documentOf(state: CloudProject): StudioDocument | null { return head(state)?.document ?? null; }
export function id(prefix: string): string { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('');
}

function serializeState(state: CloudProject): string { return JSON.stringify({ ...state, versions: [], siteVersions: {} }); }
