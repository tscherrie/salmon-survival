import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FalError, FalStorage } from '../src/index.ts';
import { API_KEY, createFakeFetch, json, type RecordedRequest } from './helpers.ts';

const SIGNED = 'https://v3b.fal.media/files/upload/abc?X-Signature=topsecret&expires=1';
const FILE_URL = 'https://v3b.fal.media/files/zebra/abc.png';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fal-storage-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function storageFake(opts: { putStatus?: number; multipart?: boolean } = {}) {
  return createFakeFetch((req: RecordedRequest) => {
    const url = new URL(req.url);
    if (url.hostname === 'rest.fal.ai') {
      return json({ upload_url: opts.multipart ? 'https://v3b.fal.media/multi/abc?token=topsecret' : SIGNED, file_url: FILE_URL });
    }
    if (req.method === 'PUT') {
      if (opts.putStatus) return new Response('denied', { status: opts.putStatus });
      const part = /\/(\d+)$/.exec(url.pathname)?.[1];
      return part ? json({ partNumber: Number(part), etag: `"etag-${part}"` }) : new Response(null, { status: 200 });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/complete')) return json({ ok: true });
    return json({}, { status: 404 });
  });
}

describe('FalStorage', () => {
  it('upload(): initiate (with key) → PUT to signed URL (without key) → public file URL', async () => {
    const fake = storageFake();
    const storage = new FalStorage({ apiKey: API_KEY, fetch: fake.fetch, objectLifecycleSeconds: 86_400 });
    const data = new Uint8Array([137, 80, 78, 71]);
    const url = await storage.upload(data, { contentType: 'image/png', fileName: 'ref/frame 1.png' });
    expect(url).toBe(FILE_URL);
    const [initiate, put] = fake.requests;
    expect(initiate).toMatchObject({ method: 'POST', url: 'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3' });
    expect(initiate!.body).toEqual({ content_type: 'image/png', file_name: 'ref_frame 1.png' });
    expect(initiate!.headers.authorization).toBe(`Key ${API_KEY}`);
    expect(JSON.parse(initiate!.headers['x-fal-object-lifecycle']!)).toEqual({ expiration_duration_seconds: 86_400 });
    expect(put).toMatchObject({ method: 'PUT', url: SIGNED });
    expect(put!.headers['content-type']).toBe('image/png');
    expect(put!.headers.authorization).toBeUndefined();
    expect(put!.rawBody).toBe(data);
  });

  it('uploadFile(): content type from the extension, file name from the path', async () => {
    const path = join(dir, 'voice take.wav');
    await writeFile(path, Buffer.from('RIFF....WAVE'));
    const fake = storageFake();
    const storage = new FalStorage({ apiKey: API_KEY, fetch: fake.fetch, storageBaseUrl: 'https://rest.fal.ai/' });
    expect(await storage.uploadFile(path)).toBe(FILE_URL);
    expect(fake.requests[0]!.body).toEqual({ content_type: 'audio/wav', file_name: 'voice take.wav' });
    expect(fake.requests[0]!.headers['x-fal-object-lifecycle']).toBeUndefined();
    expect(fake.requests[1]!.headers['content-type']).toBe('audio/wav');
    expect(Buffer.from(fake.requests[1]!.rawBody as Uint8Array).toString()).toBe('RIFF....WAVE');
    await storage.uploadFile(path, 'audio/x-custom');
    expect(fake.requests[2]!.body).toMatchObject({ content_type: 'audio/x-custom' });
  });

  it('generates a file name when none is given', async () => {
    const fake = storageFake();
    await new FalStorage({ apiKey: API_KEY, fetch: fake.fetch }).upload(new Uint8Array([1]), { contentType: 'video/mp4' });
    expect((fake.requests[0]!.body as { file_name: string }).file_name).toMatch(/^upload-\d+\.mp4$/);
  });

  it('multipart upload for large data: parts, ETags, complete', async () => {
    const fake = storageFake({ multipart: true });
    const storage = new FalStorage({ apiKey: API_KEY, fetch: fake.fetch, multipartThresholdBytes: 10, chunkBytes: 8 });
    const data = new Uint8Array(20).map((_, i) => i);
    expect(await storage.upload(data, { contentType: 'video/mp4', fileName: 'big.mp4' })).toBe(FILE_URL);
    expect(fake.requests[0]!.url).toBe('https://rest.fal.ai/storage/upload/initiate-multipart?storage_type=fal-cdn-v3');
    const puts = fake.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.url)).toEqual([
      'https://v3b.fal.media/multi/abc/1?token=topsecret',
      'https://v3b.fal.media/multi/abc/2?token=topsecret',
      'https://v3b.fal.media/multi/abc/3?token=topsecret',
    ]);
    expect(puts.map((r) => (r.rawBody as Uint8Array).length)).toEqual([8, 8, 4]);
    expect(puts.every((r) => r.headers.authorization === undefined)).toBe(true);
    const complete = fake.requests.at(-1)!;
    expect(complete).toMatchObject({ method: 'POST', url: 'https://v3b.fal.media/multi/abc/complete?token=topsecret' });
    expect(complete.body).toEqual({ parts: [1, 2, 3].map((n) => ({ partNumber: n, etag: `"etag-${n}"` })) });
  });

  it('multipart via uploadFile reads the file in chunks', async () => {
    const path = join(dir, 'clip.mov');
    await writeFile(path, Buffer.alloc(25, 7));
    const fake = storageFake({ multipart: true });
    await new FalStorage({ apiKey: API_KEY, fetch: fake.fetch, multipartThresholdBytes: 10, chunkBytes: 10 }).uploadFile(path);
    expect(fake.requests[0]!.body).toEqual({ content_type: 'video/quicktime', file_name: 'clip.mov' });
    expect(fake.requests.filter((r) => r.method === 'PUT').map((r) => (r.rawBody as Uint8Array).length)).toEqual([10, 10, 5]);
  });

  it('errors never contain the signed URL or the key', async () => {
    const fake = storageFake({ putStatus: 403 });
    const error = (await new FalStorage({ apiKey: API_KEY, fetch: fake.fetch }).upload(new Uint8Array([1]), { contentType: 'image/png' }).catch((e: unknown) => e)) as FalError;
    expect(error).toBeInstanceOf(FalError);
    expect(error.message).toBe('Upload zu fal-Storage fehlgeschlagen (HTTP 403)');
    expect(error.message + JSON.stringify(error.details)).not.toMatch(/topsecret|secret-abc/);

    const network = createFakeFetch((req) => {
      if (req.method === 'POST') return json({ upload_url: SIGNED, file_url: FILE_URL });
      throw new TypeError(`connect ECONNREFUSED ${SIGNED}`);
    });
    const netError = (await new FalStorage({ apiKey: API_KEY, fetch: network.fetch }).upload(new Uint8Array([1]), { contentType: 'image/png' }).catch((e: unknown) => e)) as FalError;
    expect(netError.code).toBe('network');
    expect(netError.message).not.toContain('topsecret');
  });

  it('rejects missing upload URLs and missing keys', async () => {
    const bad = createFakeFetch(() => json({ file_url: FILE_URL }));
    await expect(new FalStorage({ apiKey: API_KEY, fetch: bad.fetch }).upload(new Uint8Array([1]), { contentType: 'image/png' })).rejects.toMatchObject({ code: 'bad_response' });
    const none = createFakeFetch(() => json({}));
    await expect(new FalStorage({ apiKey: '', fetch: none.fetch }).upload(new Uint8Array([1]), { contentType: 'image/png' })).rejects.toMatchObject({ code: 'missing_key' });
    expect(none.requests).toHaveLength(0);
  });
});
