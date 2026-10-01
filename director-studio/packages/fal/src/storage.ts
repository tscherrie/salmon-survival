import { open, readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { extensionFromMime, mimeFromExtension } from '@studio/core';
import { z } from 'zod';
import { type FalConfig, resolveConfig, type ResolvedFalConfig, UPLOAD_LIFECYCLE_HEADER } from './config.ts';
import { abortError, FalError, redact } from './errors.ts';
import { readBody, requestJson, sleep } from './http.ts';

/**
 * Upload lokaler Dateien in den fal-Storage (nur, was ein Cloud-Modell zwingend braucht).
 * Ablauf wie `@fal-ai/client` 1.10.1 (`src/storage.js`):
 * 1. `POST https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3` mit `{ content_type, file_name }`
 *    (Authorization: Key) → `{ upload_url, file_url }`.
 * 2. `PUT upload_url` mit den Rohdaten und `Content-Type` (signierte URL, OHNE Key).
 * Dateien > 90 MB: `initiate-multipart`, Teile à 10 MB per `PUT <upload_url-pfad>/<n><query>` (Antwort `{partNumber, etag}`),
 * dann `POST <pfad>/complete<query>` mit `{ parts: [{partNumber, etag}] }`.
 * Signierte Upload-URLs gelten als Geheimnis und erscheinen nie in Fehlermeldungen.
 */

export interface FalStorageOptions extends FalConfig {
  /** Ablauf der hochgeladenen Datei in Sekunden (Header `X-Fal-Object-Lifecycle`). */
  objectLifecycleSeconds?: number;
  /** Ab dieser Größe Multipart-Upload (Standard 90 MB wie der offizielle Client). */
  multipartThresholdBytes?: number;
  /** Teilgröße beim Multipart-Upload (Standard 10 MB). */
  chunkBytes?: number;
}

export interface UploadOptions {
  contentType: string;
  fileName?: string;
  signal?: AbortSignal;
}

const initiateSchema = z.looseObject({ upload_url: z.string().url(), file_url: z.string().url() });
const partSchema = z.looseObject({ partNumber: z.number().optional().catch(undefined), etag: z.string().optional().catch(undefined) });

type ChunkReader = (start: number, end: number) => Promise<Uint8Array>;

export class FalStorage {
  private readonly cfg: ResolvedFalConfig;
  private readonly lifecycleSeconds: number | undefined;
  private readonly threshold: number;
  private readonly chunkBytes: number;

  constructor(cfg: FalStorageOptions) {
    this.cfg = resolveConfig(cfg);
    this.lifecycleSeconds = cfg.objectLifecycleSeconds;
    this.threshold = cfg.multipartThresholdBytes ?? 90 * 1024 * 1024;
    this.chunkBytes = Math.max(1, Math.floor(cfg.chunkBytes ?? 10 * 1024 * 1024));
  }

  /** Lädt Bytes hoch und liefert die öffentliche URL. */
  async upload(data: Uint8Array, opts: UploadOptions): Promise<string> {
    const contentType = opts.contentType || 'application/octet-stream';
    const fileName = this.fileName(opts.fileName, contentType);
    if (data.byteLength > this.threshold) {
      return this.multipart(data.byteLength, async (start, end) => data.subarray(start, end), contentType, fileName, opts.signal);
    }
    return this.single(data, contentType, fileName, opts.signal);
  }

  /** Lädt eine lokale Datei hoch (Content-Type aus der Endung, falls nicht angegeben). */
  async uploadFile(path: string, contentType?: string, opts: { signal?: AbortSignal; fileName?: string } = {}): Promise<string> {
    const type = contentType || mimeFromExtension(path);
    const fileName = this.fileName(opts.fileName ?? basename(path), type);
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Kein Datei-Upload möglich: „${basename(path)}“ ist keine Datei`);
    if (info.size > this.threshold) {
      const handle = await open(path, 'r');
      try {
        const reader: ChunkReader = async (start, end) => {
          const buffer = new Uint8Array(end - start);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
          return buffer.subarray(0, bytesRead);
        };
        return await this.multipart(info.size, reader, type, fileName, opts.signal);
      } finally {
        await handle.close();
      }
    }
    return this.single(await readFile(path), type, fileName, opts.signal);
  }

  private fileName(name: string | undefined, contentType: string): string {
    const clean = (name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    if (clean) return clean.slice(0, 200);
    return `upload-${Date.now()}.${extensionFromMime(contentType.split(';')[0]?.trim() ?? '')}`;
  }

  private initiateHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.lifecycleSeconds !== undefined && Number.isFinite(this.lifecycleSeconds) && this.lifecycleSeconds > 0) {
      headers[UPLOAD_LIFECYCLE_HEADER] = JSON.stringify({ expiration_duration_seconds: Math.round(this.lifecycleSeconds) });
    }
    return headers;
  }

  private async initiate(kind: 'initiate' | 'initiate-multipart', contentType: string, fileName: string, signal?: AbortSignal) {
    const { data } = await requestJson(this.cfg, `${this.cfg.storageBaseUrl}/storage/upload/${kind}?storage_type=fal-cdn-v3`, {
      method: 'POST',
      body: { content_type: contentType, file_name: fileName },
      headers: this.initiateHeaders(),
      signal,
      context: 'Upload vorbereiten (fal-Storage)',
      retries: 2,
    });
    const parsed = initiateSchema.safeParse(data);
    if (!parsed.success) throw new FalError('fal-Storage lieferte keine Upload-URL', { code: 'bad_response' });
    return { uploadUrl: parsed.data.upload_url, fileUrl: parsed.data.file_url };
  }

  private async single(data: Uint8Array, contentType: string, fileName: string, signal?: AbortSignal): Promise<string> {
    const { uploadUrl, fileUrl } = await this.initiate('initiate', contentType, fileName, signal);
    await this.put(uploadUrl, data, { 'Content-Type': contentType }, signal, 'Upload');
    return fileUrl;
  }

  private async multipart(size: number, read: ChunkReader, contentType: string, fileName: string, signal?: AbortSignal): Promise<string> {
    const { uploadUrl, fileUrl } = await this.initiate('initiate-multipart', contentType, fileName, signal);
    const parsed = new URL(uploadUrl);
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const count = Math.ceil(size / this.chunkBytes);
    for (let i = 0; i < count; i++) {
      const partNumber = i + 1;
      const chunk = await read(i * this.chunkBytes, Math.min(size, (i + 1) * this.chunkBytes));
      const partUrl = `${parsed.origin}${parsed.pathname}/${partNumber}${parsed.search}`;
      let lastError: unknown;
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        try {
          const response = await this.put(partUrl, chunk, {}, signal, `Upload Teil ${partNumber}/${count}`);
          const body = partSchema.safeParse(response.body);
          const etag = (body.success ? body.data.etag : undefined) ?? response.etag;
          if (!etag) throw new FalError(`fal-Storage lieferte kein ETag für Teil ${partNumber}`, { code: 'bad_response' });
          parts.push({ partNumber: (body.success ? body.data.partNumber : undefined) ?? partNumber, etag });
          done = true;
        } catch (error) {
          if (signal?.aborted) throw abortError(signal);
          lastError = error;
          if (attempt < 2) await sleep(500 * (attempt + 1), signal);
        }
      }
      if (!done) throw lastError;
    }
    const completeUrl = `${parsed.origin}${parsed.pathname}/complete${parsed.search}`;
    let response: Response;
    try {
      response = await this.cfg.fetch(completeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ parts }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      throw new FalError('Upload abschließen fehlgeschlagen (Netzwerk)', { code: 'network', retryable: true, cause: error });
    }
    if (!response.ok) {
      throw new FalError(`Upload abschließen fehlgeschlagen (HTTP ${response.status})`, { status: response.status, code: 'http', retryable: response.status >= 500 });
    }
    return fileUrl;
  }

  /** PUT auf eine signierte URL – ohne API-Key, Fehlermeldungen ohne URL. */
  private async put(url: string, body: Uint8Array, headers: Record<string, string>, signal: AbortSignal | undefined, what: string) {
    let response: Response;
    try {
      response = await this.cfg.fetch(url, { method: 'PUT', body: body as unknown as BodyInit, headers, signal });
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      const reason = error instanceof Error ? error.message.replace(url, '<upload-url>') : String(error);
      throw new FalError(`${what} zu fal-Storage fehlgeschlagen (Netzwerk): ${redact(reason, this.cfg.apiKey)}`, { code: 'network', retryable: true });
    }
    if (!response.ok) {
      throw new FalError(`${what} zu fal-Storage fehlgeschlagen (HTTP ${response.status})`, {
        status: response.status,
        code: response.status === 401 || response.status === 403 ? 'forbidden' : 'http',
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    const parsedBody = await readBody(response).catch(() => null);
    return { body: parsedBody, etag: response.headers.get('etag') ?? undefined };
  }
}
