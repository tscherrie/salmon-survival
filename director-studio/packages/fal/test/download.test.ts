import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { downloadToFile, FalError } from '../src/index.ts';
import { createFakeFetch } from './helpers.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fal-download-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function streamResponse(chunks: Uint8Array[], headers: Record<string, string>, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, { status, headers });
}

describe('downloadToFile (local HTTP server)', () => {
  let server: Server;
  let base: string;
  const payload = Buffer.alloc(256 * 1024, 9);

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith('/files/clip.mp4')) {
        res.writeHead(200, { 'content-type': 'video/mp4' });
        // in Teilen senden (chunked)
        res.write(payload.subarray(0, 100_000));
        setTimeout(() => res.end(payload.subarray(100_000)), 5);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('gone');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('streams to a temp file, renames it and reports type and size', async () => {
    const result = await downloadToFile(`${base}/files/clip.mp4?token=x`, dir);
    expect(basename(result.path)).toBe('clip.mp4');
    expect(result.contentType).toBe('video/mp4');
    expect(result.bytes).toBe(payload.length);
    expect((await readFile(result.path)).equals(payload)).toBe(true);
    expect((await readdir(dir)).filter((f) => f.includes('.part'))).toEqual([]);
    // zweiter Download überschreibt nicht
    const second = await downloadToFile(`${base}/files/clip.mp4`, dir);
    expect(basename(second.path)).toBe('clip-1.mp4');
  });

  it('HTTP errors become FalErrors without query strings', async () => {
    const error = (await downloadToFile(`${base}/missing.png?X-Signature=geheim`, dir).catch((e: unknown) => e)) as FalError;
    expect(error).toBeInstanceOf(FalError);
    expect(error).toMatchObject({ status: 404, code: 'not_found', retryable: false });
    expect(error.message).toBe(`Download fehlgeschlagen (HTTP 404): ${base}/missing.png`);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('downloadToFile (fake fetch)', () => {
  it('derives the extension from the content type and sends no credentials', async () => {
    const fake = createFakeFetch(() => streamResponse([new Uint8Array([1, 2]), new Uint8Array([3])], { 'content-type': 'audio/mpeg; charset=binary' }));
    const result = await downloadToFile('https://v3.fal.media/files/abc/vocals', join(dir, 'nested', 'deeper'), { fetch: fake.fetch });
    expect(basename(result.path)).toBe('vocals.mp3');
    expect(result).toMatchObject({ contentType: 'audio/mpeg', bytes: 3 });
    expect(fake.requests[0]!.headers).toEqual({});
  });

  it('uses the URL extension for octet-stream and honours fileName', async () => {
    const fake = createFakeFetch(() => streamResponse([new Uint8Array(4)], { 'content-type': 'application/octet-stream' }));
    const a = await downloadToFile('https://v3.fal.media/files/x/take.wav', dir, { fetch: fake.fetch });
    expect(a.contentType).toBe('audio/wav');
    expect(basename(a.path)).toBe('take.wav');
    const b = await downloadToFile('https://v3.fal.media/files/x/take.wav', dir, { fetch: fake.fetch, fileName: 'shot_07/../v2' });
    expect(basename(b.path)).toBe('shot_07_.._v2.wav');
  });

  it('decodes data URLs', async () => {
    const result = await downloadToFile('data:image/png;base64,iVBORw0KGgo=', dir, { fileName: 'inline' });
    expect(result).toMatchObject({ contentType: 'image/png', bytes: 8 });
    expect(basename(result.path)).toBe('inline.png');
    const text = await downloadToFile('data:text/plain,Hallo%20Welt', dir);
    expect(await readFile(text.path, 'utf8')).toBe('Hallo Welt');
  });

  it('detects truncated downloads and cleans up', async () => {
    const fake = createFakeFetch(() => streamResponse([new Uint8Array(10)], { 'content-type': 'image/png', 'content-length': '20' }));
    await expect(downloadToFile('https://v3.fal.media/files/a.png', dir, { fetch: fake.fetch })).rejects.toMatchObject({ code: 'network', retryable: true });
    expect(await readdir(dir)).toEqual([]);
  });

  it('aborts and leaves no partial file', async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(5));
        setTimeout(() => controller.abort(), 10);
      },
    });
    const fake = createFakeFetch(() => new Response(body, { headers: { 'content-type': 'video/mp4' } }));
    const error = (await downloadToFile('https://v3.fal.media/files/a.mp4', dir, { fetch: fake.fetch, signal: controller.signal }).catch((e: unknown) => e)) as Error;
    expect(error.name).toBe('AbortError');
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects unsupported protocols', async () => {
    await expect(downloadToFile('file:///etc/passwd', dir)).rejects.toThrow(/nur über http/);
    await expect(downloadToFile('not a url', dir)).rejects.toThrow(/Ungültige Download-URL/);
  });
});
