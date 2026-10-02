import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudStore } from '../storage.ts';
import { DirectorService } from '../service.ts';
import { handleMcp } from '../mcp.ts';
import { beginUpload, uploadChunk, completeUpload } from '../transfers.ts';
import { environment, request } from './emulator.ts';
import { SUNO_CREATE_URL, sunoPromptText, sunoSourceUrlSchema } from '../../shared/suno.ts';

const receipt = { title: 'Night music', planAtCreation: 'pro', intendedUse: 'commercial', rightsAcknowledged: true } as const;
function service(env = environment(), user = 'alice') { return new DirectorService(new CloudStore(env.DB, { id: user, email: `${user}@example.test` }), env); }
async function create(svc: DirectorService, category = 'audio') { return svc.create({ title: 'Music project', category }); }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Suno official website handoff', () => {
  it('persists host-prepared prompts across reopening without network, jobs or charges', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const env = environment(), svc = service(env), p = await create(svc);
    const result: any = await svc.action(p.manifest.id, 'prepareSunoMusic', { title: 'Night music', prompt: 'Warm strings', instrumental: true });
    expect(result).toMatchObject({ generationStarted: false, handoff: { createUrl: SUNO_CREATE_URL, status: 'prepared' } });
    expect(result.copyText).toContain('Warm strings'); expect(result.copyText).toContain('Instrumental');
    expect(await service(env).action(p.manifest.id, 'listSunoHandoffs')).toEqual([result.handoff]);
    const reopened = await svc.get(p.manifest.id);
    expect(reopened.generations).toEqual([]); expect(reopened.jobs).toEqual([]); expect(reopened.pendingApprovals).toEqual([]); expect(reopened.budget.spentUsd).toBe(0); expect(fetch).not.toHaveBeenCalled();
    expect(await svc.action(p.manifest.id, 'getMusicProviders')).toMatchObject({ defaultProvider: 'fal', providers: [{ nativeGeneration: false, accountLink: false, synchronizedStems: true }] });
  });
  it('offers the prompt and capabilities to the native host through actual MCP tools', async () => {
    const env = environment(), svc = service(env), p = await create(svc);
    const response = await handleMcp(request('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'prepare_suno_music', arguments: { projectId: p.manifest.id, title: 'Music', prompt: 'Acoustic' } } }, 'alice'), env);
    expect(await response.json()).toMatchObject({ result: { structuredContent: { generationStarted: false, handoff: { prompt: 'Acoustic' } } } });
  });
  it('accepts official origin links, without using queries as a prompt/login transport', () => {
    expect(sunoSourceUrlSchema.parse('https://suno.com/song/00000000-0000-0000-0000-000000000000')).toContain('suno.com');
    for (const url of ['https://sunoapi.org/song/id', 'https://suno.com.evil.test/song/id', 'http://suno.com/song/id', 'https://suno.com/song/id?token=secret']) expect(sunoSourceUrlSchema.safeParse(url).success).toBe(false);
    expect(sunoPromptText({ title: 'Title', prompt: 'Prompt', style: 'Jazz', lyrics: 'Own lyrics' })).toContain('Own lyrics');
  });
});

describe('owned Suno audio and synchronized stem imports', () => {
  it('stores bytes, declaration and atomic aligned tracks, then reopens and retries without duplication', async () => {
    const env = environment(), svc = service(env), p = await create(svc), pid = p.manifest.id;
    const one = await svc.upload(pid, new Uint8Array([1, 2]), 'vocals.wav', 'audio/wav', { durationMs: 4000 });
    const two = await svc.upload(pid, new Uint8Array([3, 4]), 'drums.wav', 'audio/wav', { durationMs: 4200 });
    const input = { assetIds: [one.id, two.id], receipt, kind: 'stems', placement: { startFrame: 17, expectedHead: 1 } };
    const result: any = await svc.action(pid, 'recordSunoImport', input);
    expect(result).toMatchObject({ alreadyRecorded: false, rightsVerified: false });
    const reopened = await service(env).get(pid); const doc: any = reopened.document;
    const clips = doc.tracks.flatMap((t: any) => t.clips).filter((c: any) => [one.id, two.id].includes(c.assetId));
    expect(clips.map((c: any) => c.start)).toEqual([17, 17]); expect(clips.map((c: any) => c.in)).toEqual([0, 0]);
    expect(clips.map((c: any) => c.duration)).toEqual([4000, 4200]);
    expect(reopened.assets.map(a => a.metadata?.musicProvider)).toEqual(expect.arrayContaining([expect.objectContaining({ groupId: result.groupId, generationVerified: false, rightsVerified: false, billingKnown: false })]));
    expect(reopened.budget.spentUsd).toBe(0); expect(reopened.generations).toEqual([]);
    expect(await svc.action(pid, 'recordSunoImport', input)).toMatchObject({ alreadyRecorded: true });
    expect((await svc.get(pid)).versions).toHaveLength(2);
  });
  it('retains independent same-byte stem records in chunked native uploads', async () => {
    const env = environment(), svc = service(env), p = await create(svc), pid = p.manifest.id;
    const ids: string[] = [];
    for (const name of ['left.wav', 'right.wav']) {
      const begun = await beginUpload(svc.store, env, pid, { name, mime: 'audio/wav', bytes: 2, metadata: { forceNewAssetRecord: true, durationMs: 1000 } });
      await uploadChunk(svc.store, env, pid, begun.uploadId, { offset: 0, base64: btoa('AB') });
      ids.push((await completeUpload(svc.store, env, pid, begun.uploadId)).id);
    }
    expect(new Set(ids).size).toBe(2); expect((await svc.get(pid)).assets).toHaveLength(2);
  });
  it('rejects stale placement before mutating declarations or tracks', async () => {
    const svc = service(), p = await create(svc), pid = p.manifest.id;
    const a = await svc.upload(pid, new Uint8Array([1]), 'music.wav', 'audio/wav', { durationMs: 1000 });
    await svc.action(pid, 'applyDocumentOps', { expectedHead: 1, ops: [{ op: 'update_timeline', patch: { durationFrames: 120 } }] });
    await expect(svc.action(pid, 'recordSunoImport', { assetIds: [a.id], receipt, kind: 'song', placement: { startFrame: 0, expectedHead: 1 } })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const reopened = await svc.get(pid); expect(reopened.assets[0]?.metadata?.musicProvider).toBeUndefined(); expect(reopened.versions).toHaveLength(2);
  });
  it('does not infer a commercial license from a later or unknown plan', async () => {
    const svc = service(), p = await create(svc), a = await svc.upload(p.manifest.id, new Uint8Array([1]), 'song.wav', 'audio/wav');
    const input = { assetIds: [a.id], receipt: { ...receipt, planAtCreation: 'free' }, kind: 'song' };
    const r: any = await svc.action(p.manifest.id, 'recordSunoImport', input);
    expect(r.assets[0].metadata.musicProvider).toMatchObject({ rightsVerified: false, rightsReviewRequired: true, receipt: { planAtCreation: 'free' } });
    await expect(svc.action(p.manifest.id, 'updateAsset', { assetId: a.id, patch: { metadata: { musicProvider: { rightsVerified: true } } } })).rejects.toMatchObject({ code: 'PROTECTED_ASSET_FIELD' });
    await expect(svc.action(p.manifest.id, 'recordSunoImport', { ...input, receipt })).rejects.toMatchObject({ code: 'SUNO_PROVENANCE_CONFLICT' });
  });
  it('requires the actual owned audio set and rights acknowledgement', async () => {
    const env = environment(), svc = service(env), p = await create(svc), other = await create(svc);
    const a = await svc.upload(p.manifest.id, new Uint8Array([1]), 'song.wav', 'audio/wav');
    await expect(svc.action(other.manifest.id, 'recordSunoImport', { assetIds: [a.id], receipt, kind: 'song' })).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(service(env, 'bob').action(p.manifest.id, 'recordSunoImport', { assetIds: [a.id], receipt, kind: 'song' })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    await expect(svc.action(p.manifest.id, 'recordSunoImport', { assetIds: [a.id], receipt: { ...receipt, rightsAcknowledged: false }, kind: 'song' })).rejects.toThrow();
    await expect(svc.upload(p.manifest.id, new Uint8Array([2]), 'forged.wav', 'audio/wav', { metadata: { musicProvider: { rightsVerified: true } } })).rejects.toMatchObject({ code: 'PROTECTED_ASSET_FIELD' });
    expect((await svc.get(p.manifest.id)).assets[0]?.metadata?.musicProvider).toBeUndefined();
  });
  it('imports a direct audio URL, rejects song HTML without scraping, and authorizes before fetching', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/mpeg' } })); vi.stubGlobal('fetch', fetch);
    const env = environment(), svc = service(env), p = await create(svc);
    const a: any = await svc.action(p.manifest.id, 'importSunoUrl', { url: 'https://cdn.example.test/export.mp3', title: 'Suno export' });
    expect(a).toMatchObject({ kind: 'audio', bytes: 2 }); expect(a.metadata?.musicProvider).toBeUndefined();
    fetch.mockImplementation(async () => new Response('<html>Song</html>', { headers: { 'content-type': 'text/html' } }));
    await expect(svc.action(p.manifest.id, 'importSunoUrl', { url: 'https://suno.com/song/id' })).rejects.toMatchObject({ code: 'SUNO_AUDIO_REQUIRED' });
    const n = fetch.mock.calls.length;
    await expect(service(env, 'bob').action(p.manifest.id, 'importSunoUrl', { url: 'https://cdn.example.test/export.mp3' })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' }); expect(fetch).toHaveBeenCalledTimes(n);
  });
});
