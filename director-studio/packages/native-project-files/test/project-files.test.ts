import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from '@studio/core';
import { DEFAULT_LIMITS, DEFAULT_PORTABLE_LIMITS, HostFileLibrary, HostProjectFiles, PROJECT_FILE_SCHEMA, createPortableBundle, digest, openPortableBundle, parseProjectFile, portableLimitsWith, readHostResourceAsset, readProjectText, serializeProjectFile, type ProjectFile, type ResourceApi } from '../src/index.ts';
const uri = 'host-resource:synthetic-project-file';
const bytes = new Uint8Array([1, 2, 3, 4]);
async function project(): Promise<ProjectFile> {
 return parseProjectFile({ schema: PROJECT_FILE_SCHEMA, id: 'project-1', title: 'Synthetic Film', category: 'video', revision: 0, document: createDocument('video'), assets: [{ id: 'asset-1', kind: 'video', title: 'Shapes', mimeType: 'video/mp4', bytes: bytes.length, sha256: await digest(bytes), location: { kind: 'host-file', fileId: 'synthetic-host-file', library: 'selected' } }], state: { versions: [{ number: 1, note: 'Initial synthetic version' }], brief: { goal: 'Shapes' }, lineage: [], budget: { spentUsd: 0 }, siteFiles: { 'index.html': '<h1>Shapes</h1>' } } });
}
function resources(initial: ProjectFile, metadata: { writable?: boolean; etag?: string } = { writable: true, etag: 'etag-1' }) {
 const stored = { text: serializeProjectFile(initial), etag: metadata.etag ?? 'etag-1' };
 const read = vi.fn<ResourceApi['read']>(async ({ uri: requested }) => ({ contents: [{ uri: requested, text: stored.text, openaiMetadata: { ...metadata, ...(metadata.etag === undefined ? {} : { etag: stored.etag }) } }] }));
 const write = vi.fn<ResourceApi['write']>(async (_uri, options) => {
  if (options.ifMatch !== stored.etag) return { outcome: 'conflict', etag: stored.etag };
  if (!('text' in options) || options.text === undefined) throw new Error('Expected text');
  stored.text = options.text; stored.etag = 'etag-2'; return { outcome: 'saved', etag: stored.etag };
 });
 return { read, write, stored };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('validated project files and complete portable media', () => {
 it('roundtrips actual bytes, document and project history while replacing account refs with content-addressed local refs', async () => {
  const original = await project(), bundle = await createPortableBundle(original, new Map([['asset-1', bytes]]));
  const opened = await openPortableBundle(bundle);
  expect(opened.document).toEqual(original.document); expect(opened.state).toEqual(original.state);
  expect(opened.assets[0]!.location).toEqual({ kind: 'portable', path: `media/${await digest(bytes)}` });
  expect([...bundle.media.values()][0]).toEqual(bytes);
  expect(original.assets[0]!.location.kind).toBe('host-file');
  expect(readProjectText(serializeProjectFile(opened))).toEqual(opened);
 });
 it('deduplicates identical media but preserves distinct asset records', async () => {
  const original = await project(); original.assets.push({ ...original.assets[0]!, id: 'asset-2' });
  const bundle = await createPortableBundle(original, new Map([['asset-1', bytes], ['asset-2', bytes]]));
  expect(bundle.media.size).toBe(1); expect((await openPortableBundle(bundle)).assets).toHaveLength(2);
 });
 it('rejects incomplete or corrupted media before returning a portable project', async () => {
  const original = await project();
  await expect(createPortableBundle(original, new Map())).rejects.toMatchObject({ code: 'missing-media' });
  await expect(createPortableBundle(original, new Map([['asset-1', new Uint8Array([5, 6, 7, 8])]]))).rejects.toMatchObject({ code: 'integrity' });
  const bundle = await createPortableBundle(original, new Map([['asset-1', bytes]]));
  await expect(openPortableBundle({ ...bundle, media: new Map() })).rejects.toMatchObject({ code: 'missing-media' });
  await expect(openPortableBundle({ ...bundle, media: new Map([['../secret', bytes]]) })).rejects.toMatchObject({ code: 'missing-media' });
  const extra = new Map(bundle.media); extra.set('media/unlisted', bytes);
  await expect(openPortableBundle({ ...bundle, media: extra })).rejects.toMatchObject({ code: 'invalid' });
 });
 it('rejects transient URLs in nested state and asset refs without rejecting ordinary source links', async () => {
  const base = await project();
  for (const state of [{ downloadUrl: 'https://download.example/path' }, { preview: { url: 'blob:temporary' } }, { url: 'https://download.example/file?X-Amz-Signature=synthetic' }]) expect(() => parseProjectFile({ ...base, state })).toThrow();
  expect(() => parseProjectFile({ ...base, state: { reference: 'https://example.test/reference' } })).not.toThrow();
  expect(() => parseProjectFile({ ...base, assets: [{ ...base.assets[0], location: { kind: 'host-resource', uri: 'https://download.example/file' } }] })).toThrow();
  expect(() => parseProjectFile({ ...base, assets: [{ ...base.assets[0], location: { kind: 'server', path: 'owner/projects/p/media' } }] })).toThrow();
 });
 it('enforces asset limits, unique IDs, canonical relative paths and document category', async () => {
  const base = await project();
  expect(() => parseProjectFile({ ...base, assets: [...base.assets, { ...base.assets[0], id: 'asset-2' }] }, { maxAssets: 1 })).toThrow();
  expect(() => parseProjectFile({ ...base, assets: [...base.assets, base.assets[0]] })).toThrow();
  expect(() => parseProjectFile({ ...base, assets: [{ ...base.assets[0], location: { kind: 'portable', path: '../media/file' } }] })).toThrow();
  expect(() => parseProjectFile({ ...base, category: 'slides' })).toThrow();
 });
 it('validates finite JSON, UTF8 byte size and depth without silently dropping document fields', async () => {
  const base = await project();
  expect(() => parseProjectFile({ ...base, state: { value: Infinity } })).toThrow();
  expect(() => parseProjectFile({ ...base, state: { value: new Date() } })).toThrow();
  expect(() => parseProjectFile({ ...base, state: { value: { a: { b: { c: 1 } } } } }, { maxDepth: 3 })).toThrow();
  expect(() => readProjectText(serializeProjectFile(base), { maxJsonBytes: 100 })).toThrow();
  const withUnknown = structuredClone(base) as any; withUnknown.document.formats[0].unmappedLegacyField = 1;
  expect(() => parseProjectFile(withUnknown)).toThrow();
 });
 it('limits individual and aggregate portable media bytes', async () => {
  const base = await project(), media = new Map([['asset-1', bytes]]);
  await expect(createPortableBundle(base, media, { maxMediaBytes: 3 })).rejects.toMatchObject({ code: 'too-large' });
  await expect(createPortableBundle(base, media, { maxBundleBytes: 3 })).rejects.toMatchObject({ code: 'too-large' });
 });
 it('rejects local JSON over 16MiB and only accepts it under an explicit finite byte limit', async () => {
  const large = await project(); large.state.localOverflow = 'x'.repeat(DEFAULT_PORTABLE_LIMITS.maxJsonBytes);
  const media = new Map([['asset-1', bytes]]), projectText = JSON.stringify(large) + '\n';
  expect(new TextEncoder().encode(projectText).length).toBeGreaterThan(DEFAULT_PORTABLE_LIMITS.maxJsonBytes);
  await expect(createPortableBundle(large, media)).rejects.toMatchObject({ code: 'too-large', message: expect.stringContaining('byte limit') });
  await expect(openPortableBundle({ projectText, media })).rejects.toMatchObject({ code: 'too-large', message: expect.stringContaining('byte limit') });
  const overrides = { maxJsonBytes: 17 * 1024 * 1024 }, bundle = await createPortableBundle(large, media, overrides);
  expect((await openPortableBundle(bundle, overrides)).state).toEqual(large.state);
  await expect(openPortableBundle(bundle)).rejects.toMatchObject({ code: 'too-large' });
  await expect(createPortableBundle(large, media, { ...overrides, maxBundleBytes: 1024 })).rejects.toMatchObject({ code: 'too-large' });
 });
 it('validates local limit overrides and retains media, asset and depth bounds', async () => {
  expect(portableLimitsWith()).toEqual({ ...DEFAULT_LIMITS, maxJsonBytes: 16 * 1024 * 1024 });
  for (const key of Object.keys(DEFAULT_PORTABLE_LIMITS) as (keyof typeof DEFAULT_PORTABLE_LIMITS)[]) {
   for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => portableLimitsWith({ [key]: value })).toThrow('positive integers');
  }
  const base = await project(), media = new Map([['asset-1', bytes]]);
  await expect(createPortableBundle(base, media, { maxJsonBytes: 100 })).rejects.toMatchObject({ code: 'too-large' });
  await expect(createPortableBundle(base, media, { maxMediaBytes: 3 })).rejects.toMatchObject({ code: 'too-large' });
  await expect(createPortableBundle({ ...base, assets: [...base.assets, { ...base.assets[0]!, id: 'asset-2' }] }, media, { maxAssets: 1 })).rejects.toMatchObject({ code: 'too-large' });
  await expect(createPortableBundle({ ...base, state: { deep: { a: { b: { c: 1 } } } } }, media, { maxDepth: 3 })).rejects.toMatchObject({ code: 'invalid' });
 });
});
describe('documented resource reads and compare-and-swap writes', () => {
 it('reads the exact URI then edits and saves with the observed etag and advances only the saved revision', async () => {
  const api = resources(await project()), adapter = new HostProjectFiles(api), base = await adapter.open(uri);
  expect(api.read).toHaveBeenCalledWith({ uri, representation: 'text' });
  const changed = structuredClone(base.project); changed.title = 'Edited';
  const result = await adapter.save(base, changed);
  expect(result.outcome).toBe('saved');
  expect(api.write).toHaveBeenCalledWith(uri, { ifMatch: 'etag-1', text: expect.any(String) });
  if (result.outcome !== 'saved') throw new Error('Expected saved');
  expect(result.snapshot.etag).toBe('etag-2'); expect(result.snapshot.project.revision).toBe(1);
  expect((await adapter.open(uri)).project.title).toBe('Edited'); expect(changed.revision).toBe(0);
  await expect(adapter.save(base, changed)).rejects.toMatchObject({ code: 'invalid' });
 });
 it('returns the unsaved draft on a real CAS conflict and never overwrites the competing edit', async () => {
  const api = resources(await project()), adapter = new HostProjectFiles(api), base = await adapter.open(uri);
  const concurrent = structuredClone(base.project); concurrent.title = 'Other editor'; concurrent.revision = 1;
  api.stored.text = serializeProjectFile(concurrent); api.stored.etag = 'other-etag';
  const changed = structuredClone(base.project); changed.title = 'My unsaved edit';
  const result = await adapter.save(base, changed);
  expect(result).toMatchObject({ outcome: 'conflict', currentEtag: 'other-etag', unsavedProject: { title: changed.title, revision: 0 } });
  expect(readProjectText(api.stored.text).title).toBe('Other editor'); expect(api.write).toHaveBeenCalledTimes(1);
 });
 it('handles host and local write-size limits with a retained draft and no storage fallback', async () => {
  const original = await project(), api = resources(original), adapter = new HostProjectFiles(api), base = await adapter.open(uri);
  api.write.mockResolvedValueOnce({ outcome: 'too-large', maxBytes: 100 });
  expect(await adapter.save(base, { ...base.project, title: 'Unsaved' })).toMatchObject({ outcome: 'too-large', maxBytes: 100, unsavedProject: { title: 'Unsaved', revision: 0 } });
  const localApi = resources(original), local = new HostProjectFiles(localApi, { maxJsonBytes: new TextEncoder().encode(serializeProjectFile(original)).length + 100 }), read = await local.open(uri);
  const draft = { ...read.project, state: { text: 'x'.repeat(3000) } };
  expect(await local.save(read, draft)).toMatchObject({ outcome: 'too-large', unsavedProject: { state: draft.state, revision: 0 } });
  expect(localApi.write).not.toHaveBeenCalled();
 });
 it('recovers a retained draft over the default host limit through a complete local bundle', async () => {
  const api = resources(await project()), adapter = new HostProjectFiles(api), base = await adapter.open(uri), storedText = api.stored.text;
  const draft = structuredClone(base.project); draft.state.retainedHistory = 'ü'.repeat(1536 * 1024);
  expect(new TextEncoder().encode(JSON.stringify(draft)).length).toBeGreaterThan(DEFAULT_LIMITS.maxJsonBytes);
  const result = await adapter.save(base, draft);
  expect(result).toMatchObject({ outcome: 'too-large', maxBytes: DEFAULT_LIMITS.maxJsonBytes });
  if (result.outcome !== 'too-large') throw new Error('Expected a retained oversized draft');
  expect(result.unsavedProject).toEqual(draft); expect(api.write).not.toHaveBeenCalled(); expect(api.stored.text).toBe(storedText);
  const bundle = await createPortableBundle(result.unsavedProject, new Map([['asset-1', bytes]])), reopened = await openPortableBundle(bundle);
  const expected = structuredClone(draft); expected.assets[0]!.location = { kind: 'portable', path: `media/${await digest(bytes)}` };
  expect(reopened).toEqual(expected); expect([...bundle.media.values()][0]).toEqual(bytes);
  expect(result.unsavedProject.assets[0]!.location.kind).toBe('host-file'); expect(result.unsavedProject.revision).toBe(base.project.revision);
  api.stored.text = bundle.projectText;
  await expect(new HostProjectFiles(api).open(uri)).rejects.toMatchObject({ code: 'too-large' });
  expect(api.write).not.toHaveBeenCalled();
 });
 it('requires both writable and an observed nonblank etag even though SDK unconditional writes are possible', async () => {
  for (const metadata of [{ writable: false, etag: 'tag' }, { writable: true }, { writable: true, etag: ' ' }]) {
   const api = resources(await project(), metadata), adapter = new HostProjectFiles(api), base = await adapter.open(uri);
   expect(await adapter.save(base, base.project)).toMatchObject({ outcome: 'unavailable', reason: metadata.writable === false ? 'read-only' : 'etag-required' });
   expect(api.write).not.toHaveBeenCalled();
  }
 });
 it('fails closed on missing host support and host authorization errors without localStorage/widget state/server persistence', async () => {
  const neverFetch = vi.fn(); vi.stubGlobal('fetch', neverFetch); vi.stubGlobal('localStorage', new Proxy({}, { get() { throw new Error('Must not access pseudo-persistence'); } }));
  await expect(new HostProjectFiles(undefined).open(uri)).rejects.toMatchObject({ code: 'host-unavailable' });
  const api = resources(await project()); api.read.mockRejectedValueOnce(new Error('Synthetic host authorization denied'));
  await expect(new HostProjectFiles(api).open(uri)).rejects.toThrow('authorization denied');
  const adapter = new HostProjectFiles(api), base = await adapter.open(uri); api.write.mockRejectedValueOnce(new Error('Synthetic authorization denied'));
  expect(await adapter.save(base, { ...base.project, title: 'Unsaved' })).toMatchObject({ outcome: 'host-error', unsavedProject: { title: 'Unsaved' } });
  expect(api.write).toHaveBeenCalledTimes(1); expect(neverFetch).not.toHaveBeenCalled();
 });
 it('refuses forged snapshots, cross-project edits and ambiguous resource responses', async () => {
  const api = resources(await project()), adapter = new HostProjectFiles(api), base = await adapter.open(uri);
  await expect(adapter.save({ ...base }, base.project)).rejects.toMatchObject({ code: 'invalid' });
  await expect(adapter.save(base, { ...base.project, id: 'other-project' })).rejects.toMatchObject({ code: 'invalid' });
  api.read.mockResolvedValueOnce({ contents: [{ uri: 'host-resource:other', text: api.stored.text }] });
  await expect(adapter.open(uri)).rejects.toMatchObject({ code: 'invalid' }); expect(api.write).not.toHaveBeenCalled();
 });
 it('reads UTF8 project blobs and authenticates resource media reads before verifying exact media hashes', async () => {
  const initial = await project(), api = resources(initial); api.read.mockResolvedValueOnce({ contents: [{ uri, blob: btoa(serializeProjectFile(initial)), openaiMetadata: { writable: true, etag: 'blob-etag' } }] });
  expect((await new HostProjectFiles(api).open(uri)).etag).toBe('blob-etag');
  const asset = { ...initial.assets[0]!, location: { kind: 'host-resource' as const, uri: 'host-resource:synthetic-media' } };
  api.read.mockResolvedValueOnce({ contents: [{ uri: asset.location.uri, blob: btoa(String.fromCharCode(...bytes)) }] });
  expect(await readHostResourceAsset(api, asset)).toEqual(bytes);
  expect(api.read).toHaveBeenLastCalledWith({ uri: asset.location.uri, representation: 'blob' });
  api.read.mockResolvedValueOnce({ contents: [{ uri: asset.location.uri, blob: btoa('wrong') }] });
  await expect(readHostResourceAsset(api, asset)).rejects.toMatchObject({ code: 'integrity' });
 });
});
describe('optional ChatGPT File Library APIs', () => {
 it('uses actual upload/selection IDs and never infers a resource URI or confirmed library upload', async () => {
  const uploadFile = vi.fn(async () => ({ fileId: 'actual-synthetic-upload-result' }));
  const selectFiles = vi.fn(async () => [{ fileId: 'actual-synthetic-selection-result', fileName: 'shape.mp4', mimeType: 'video/mp4' }]);
  const library = new HostFileLibrary({ uploadFile, selectFiles });
  expect(() => library.reference('invented-file-id')).toThrow();
  const file = new File([bytes], 'shapes.mp4', { type: 'video/mp4' });
  expect(await library.upload(file)).toEqual({ kind: 'host-file', fileId: 'actual-synthetic-upload-result', library: 'requested-unverified' });
  expect(uploadFile).toHaveBeenCalledWith(file, { library: true });
  expect(await library.select()).toMatchObject([{ location: { fileId: 'actual-synthetic-selection-result', library: 'selected' } }]);
  expect(library.reference('actual-synthetic-selection-result').library).toBe('selected');
 });
 it('uses a fresh temporary download URL only inside the consumer and reauthorizes imported IDs through the host', async () => {
  const getFileDownloadUrl = vi.fn(async () => ({ downloadUrl: 'https://download.example.test/temporary?sig=synthetic' }));
  const library = new HostFileLibrary({ getFileDownloadUrl }), location = { kind: 'host-file' as const, fileId: 'imported-synthetic-host-id', library: 'selected' as const };
  const consume = vi.fn(async (_url: string) => 'decoded in memory');
  expect(await library.withDownload(location, consume)).toBe('decoded in memory');
  expect(getFileDownloadUrl).toHaveBeenCalledWith({ fileId: location.fileId }); expect(location).not.toHaveProperty('downloadUrl');
  getFileDownloadUrl.mockRejectedValueOnce(new Error('Synthetic host access denied'));
  await expect(library.withDownload(location, consume)).rejects.toThrow('access denied'); expect(consume).toHaveBeenCalledTimes(1);
 });
 it('does not substitute server storage when optional File APIs or media capacity are unavailable', async () => {
  const library = new HostFileLibrary(undefined);
  await expect(library.select()).rejects.toMatchObject({ code: 'host-unavailable' });
  await expect(library.upload(new File([bytes], 'synthetic.mp4'))).rejects.toMatchObject({ code: 'host-unavailable' });
  const uploadFile = vi.fn(async () => ({ fileId: 'unused' }));
  await expect(new HostFileLibrary({ uploadFile }, { maxMediaBytes: 1 }).upload(new File([bytes], 'synthetic.mp4'))).rejects.toMatchObject({ code: 'too-large' });
  expect(uploadFile).not.toHaveBeenCalled();
 });
});
