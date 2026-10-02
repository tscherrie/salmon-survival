import { z } from 'zod';
import { ASSET_KINDS, CATEGORY_DOCUMENT, PROJECT_CATEGORIES, canvasSchema, deckSchema, documentAssetIds, siteSchema, timelineSchema } from '@studio/core';

export const PROJECT_FILE_SCHEMA = 'director-studio/native-project@1';
/** Product limits for this adapter, not claims about ChatGPT account quotas. */
export const DEFAULT_LIMITS = { maxJsonBytes: 2 * 1024 * 1024, maxAssets: 1024, maxDepth: 64, maxMediaBytes: 128 * 1024 * 1024, maxBundleBytes: 512 * 1024 * 1024 } as const;
/** Explicit local recovery can preserve drafts too large for the host adapter. */
export const DEFAULT_PORTABLE_LIMITS = { ...DEFAULT_LIMITS, maxJsonBytes: 16 * 1024 * 1024 } as const;
export type ProjectFileLimits = { [K in keyof typeof DEFAULT_LIMITS]: number };
export class ProjectFileError extends Error {
  constructor(readonly code: 'invalid' | 'too-large' | 'missing-media' | 'integrity' | 'host-unavailable' | 'unobserved-file', message: string) { super(message); this.name = 'ProjectFileError'; }
}
export function limitsWith(overrides: Partial<ProjectFileLimits> = {}): ProjectFileLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value <= 0)) throw new ProjectFileError('invalid', 'Storage limits must be positive integers.');
  return limits;
}
export function portableLimitsWith(overrides: Partial<ProjectFileLimits> = {}): ProjectFileLimits {
  return limitsWith({ ...DEFAULT_PORTABLE_LIMITS, ...overrides });
}
export function isPortableMediaPath(value: string): boolean {
  return /^media\/[a-f0-9]{64}$/.test(value);
}
export function isOpaqueHostResourceUri(value: string): boolean {
  // This adapter deliberately accepts stable opaque resource handles, never a download URL.
  return /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^(?:https?|blob|data|javascript):/i.test(value) && !/[?#\s\u0000-\u001f]/.test(value);
}
const opaque = z.string().min(1).max(1024).refine(isOpaqueHostResourceUri);
const id = z.string().min(1).max(256).refine(value => !/[\s\u0000-\u001f]/.test(value) && !/^[a-z][a-z0-9+.-]*:/i.test(value));
export const assetLocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('host-resource'), uri: opaque }),
  z.strictObject({ kind: z.literal('host-file'), fileId: id, library: z.enum(['selected', 'requested-unverified']) }),
  z.strictObject({ kind: z.literal('portable'), path: z.string().refine(isPortableMediaPath) }),
]);
export type AssetLocation = z.infer<typeof assetLocationSchema>;
export type HostFileLocation = Extract<AssetLocation, { kind: 'host-file' }>;
const projectAssetSchema = z.strictObject({
  id, kind: z.enum(ASSET_KINDS), title: z.string().max(512), mimeType: z.string().min(1).max(255),
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  location: assetLocationSchema,
});
export type ProjectAsset = z.infer<typeof projectAssetSchema>;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValue), z.record(z.string(), jsonValue)]));
const documentSchema = z.union([timelineSchema.strict(), deckSchema.strict(), canvasSchema.strict(), siteSchema.strict()]);
const schema = z.strictObject({
  schema: z.literal(PROJECT_FILE_SCHEMA), id, title: z.string().min(1).max(512), category: z.enum(PROJECT_CATEGORIES),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  document: documentSchema, assets: z.array(projectAssetSchema), state: z.record(z.string(), jsonValue),
});
export type ProjectFile = z.infer<typeof schema>;
const forbiddenKeys = new Set(['downloadurl', 'download_url', 'temporaryurl', 'temporary_url', 'objecturl', 'object_url']);
function checkJson(value: unknown, depth: number, limits: ProjectFileLimits, ancestors = new Set<object>()): void {
  if (depth > limits.maxDepth) throw new ProjectFileError('invalid', 'Project JSON is nested too deeply.');
  if (typeof value === 'string') {
    if (/^(?:blob|data):/i.test(value) || /[?&](?:x-amz-signature|x-goog-signature|signature|sig|token|expires)=/i.test(value)) throw new ProjectFileError('invalid', 'Temporary URLs cannot be stored in a project file.');
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null || ancestors.has(value)) throw new ProjectFileError('invalid', 'Project must contain plain, finite JSON values.');
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLowerCase()) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new ProjectFileError('invalid', 'Unsafe or temporary project field.');
    checkJson(child, depth + 1, limits, ancestors);
  }
  ancestors.delete(value);
}
function assertNoDroppedFields(input: unknown, parsed: unknown): void {
  if (!input || typeof input !== 'object') return;
  for (const [key, child] of Object.entries(input)) {
    if (!parsed || typeof parsed !== 'object' || !Object.hasOwn(parsed, key)) throw new ProjectFileError('invalid', 'Unsupported project fields must be migrated explicitly, never silently discarded.');
    assertNoDroppedFields(child, (parsed as Record<string, unknown>)[key]);
  }
}
export function parseProjectFile(value: unknown, overrides: Partial<ProjectFileLimits> = {}): ProjectFile {
  const limits = limitsWith(overrides);
  checkJson(value, 0, limits);
  if (new TextEncoder().encode(JSON.stringify(value)).length > limits.maxJsonBytes) throw new ProjectFileError('too-large', 'Project JSON exceeds the configured byte limit.');
  const result = schema.safeParse(value);
  if (!result.success) throw new ProjectFileError('invalid', 'Invalid project file structure.');
  const project = result.data;
  assertNoDroppedFields(value, project);
  if (project.assets.length > limits.maxAssets) throw new ProjectFileError('too-large', 'Project asset-reference limit exceeded.');
  if (CATEGORY_DOCUMENT[project.category] !== project.document.kind) throw new ProjectFileError('invalid', 'Project category and document kind disagree.');
  const ids = new Set(project.assets.map(asset => asset.id));
  if (ids.size !== project.assets.length) throw new ProjectFileError('invalid', 'Project asset IDs must be unique.');
  if ([...documentAssetIds(project.document)].some(assetId => !ids.has(assetId))) throw new ProjectFileError('invalid', 'Document references an unlisted asset.');
  for (const asset of project.assets) if (asset.location.kind === 'portable' && asset.location.path !== `media/${asset.sha256}`) throw new ProjectFileError('invalid', 'Portable media path must match its content hash.');
  return project;
}
export function readProjectText(text: string, overrides: Partial<ProjectFileLimits> = {}): ProjectFile {
  if (new TextEncoder().encode(text).length > limitsWith(overrides).maxJsonBytes) throw new ProjectFileError('too-large', 'Project JSON exceeds the configured byte limit.');
  let value: unknown; try { value = JSON.parse(text); } catch { throw new ProjectFileError('invalid', 'Project file is not JSON.'); }
  return parseProjectFile(value, overrides);
}
export function serializeProjectFile(project: ProjectFile, overrides: Partial<ProjectFileLimits> = {}): string {
  const text = JSON.stringify(parseProjectFile(project, overrides)) + '\n';
  if (new TextEncoder().encode(text).length > limitsWith(overrides).maxJsonBytes) throw new ProjectFileError('too-large', 'Serialized project exceeds the configured byte limit.');
  return text;
}
export async function digest(bytes: Uint8Array): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export interface PortableBundle { projectText: string; media: ReadonlyMap<string, Uint8Array>; }
/** Builds a complete directory-shaped bundle. No host/server download or save is performed implicitly. */
export async function createPortableBundle(input: ProjectFile, mediaByAssetId: ReadonlyMap<string, Uint8Array>, overrides: Partial<ProjectFileLimits> = {}): Promise<PortableBundle> {
  const limits = portableLimitsWith(overrides), project = parseProjectFile(input, limits), media = new Map<string, Uint8Array>();
  if ([...mediaByAssetId.keys()].some(assetId => !project.assets.some(asset => asset.id === assetId))) throw new ProjectFileError('invalid', 'Unlisted media cannot enter the project bundle.');
  let total = 0;
  for (const asset of project.assets) {
    const bytes = mediaByAssetId.get(asset.id);
    if (!bytes) throw new ProjectFileError('missing-media', 'Every portable asset requires its actual bytes.');
    if (bytes.length > limits.maxMediaBytes) throw new ProjectFileError('too-large', 'Portable media exceeds the configured byte limit.');
    if (bytes.length !== asset.bytes || await digest(bytes) !== asset.sha256) throw new ProjectFileError('integrity', 'Portable media does not match its recorded bytes and SHA256.');
    const filename = `media/${asset.sha256}`;
    if (!media.has(filename)) { total += bytes.length; media.set(filename, new Uint8Array(bytes)); }
    if (total > limits.maxBundleBytes) throw new ProjectFileError('too-large', 'Portable bundle exceeds the configured byte limit.');
    asset.location = { kind: 'portable', path: filename };
  }
  const projectText = serializeProjectFile(project, limits);
  if (total + new TextEncoder().encode(projectText).length > limits.maxBundleBytes) throw new ProjectFileError('too-large', 'Portable bundle exceeds the configured byte limit.');
  return { projectText, media };
}
/** Verifies the complete bundle before returning any project for use. */
export async function openPortableBundle(bundle: PortableBundle, overrides: Partial<ProjectFileLimits> = {}): Promise<ProjectFile> {
  const limits = portableLimitsWith(overrides), project = readProjectText(bundle.projectText, limits), byId = new Map<string, Uint8Array>(), paths = new Set<string>();
  for (const asset of project.assets) {
    if (asset.location.kind !== 'portable') throw new ProjectFileError('invalid', 'A complete portable bundle cannot depend on host files.');
    paths.add(asset.location.path);
    const bytes = bundle.media.get(asset.location.path);
    if (!bytes) throw new ProjectFileError('missing-media', 'Portable bundle is missing media.');
    byId.set(asset.id, bytes);
  }
  if ([...bundle.media.keys()].some(filename => !paths.has(filename))) throw new ProjectFileError('invalid', 'Portable bundle contains unlisted media.');
  return readProjectText((await createPortableBundle(project, byId, limits)).projectText, limits);
}
