import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { extensionFromMime, mimeFromExtension } from '@studio/core';
import { abortError, FalError, safeUrl } from './errors.ts';
import { isPlainObject } from './schema.ts';

/**
 * Medien in Modellantworten finden und herunterladen. fal-URLs sind nicht dauerhaft → sofort in den
 * Projektspeicher kopieren. Downloads gehen an öffentliche CDN-URLs und senden NIE den API-Key.
 */

export type MediaKind = 'image' | 'video' | 'audio' | 'file' | 'text';

export interface MediaOutput {
  url: string;
  kind: MediaKind;
  contentType?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  fileName?: string;
  /** JSON-Pfad im Ergebnis, z. B. `images[0]`, `video`, `vocals`. */
  path: string;
}

/** Schlüssel mit URLs, die keine Ausgaben sind. */
const SKIP_KEYS = new Set(['status_url', 'response_url', 'cancel_url', 'webhook_url', 'logs_url', 'request_url', 'model_url', 'github_url', 'docs_url', 'license_url', 'stream_url']);
/** Freitextfelder: eine URL darin ist Text (z. B. im Prompt), keine Ausgabe. */
const TEXT_KEYS = new Set(['prompt', 'negative_prompt', 'revised_prompt', 'enhanced_prompt', 'text', 'description', 'caption', 'title', 'lyrics', 'message', 'output_text']);
const IMAGE_HINT = /image|img|mask|frame|thumbnail|depth|pose|photo|picture|sketch|matte|segmentation|vector|svg/;
const VIDEO_HINT = /video|clip|movie|footage/;
const AUDIO_HINT = /audio|voice|speech|music|song|vocal|drums|bass|guitar|piano|instrumental|accompaniment|stem|sound|sfx|track/;
const TEXT_EXT = new Set(['txt', 'srt', 'vtt', 'md', 'csv']);

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value) || /^data:[a-z]+\/[\w.+-]+[;,]/i.test(value);
}

function dataUrlMime(url: string): string | undefined {
  const m = /^data:([^;,]+)/i.exec(url);
  return m?.[1]?.toLowerCase();
}

function extOf(name: string | undefined): string {
  if (!name) return '';
  try {
    const pathname = /^https?:/i.test(name) ? new URL(name).pathname : name;
    return extname(pathname).slice(1).toLowerCase();
  } catch {
    return '';
  }
}

function kindFromMime(mime: string | undefined): MediaKind | undefined {
  if (!mime) return undefined;
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('text/') || m === 'application/x-subrip') return 'text';
  if (m === 'application/octet-stream' || m === 'binary/octet-stream') return undefined;
  return 'file';
}

function kindFromExtension(ext: string): MediaKind | undefined {
  if (!ext) return undefined;
  if (TEXT_EXT.has(ext)) return 'text';
  if (ext === 'mpeg' || ext === 'mpga') return 'audio';
  const mime = mimeFromExtension(`x.${ext}`);
  return mime === 'application/octet-stream' ? undefined : kindFromMime(mime);
}

function kindFromHint(...hints: Array<string | undefined>): MediaKind | undefined {
  for (const hint of hints) {
    if (!hint) continue;
    const h = hint.toLowerCase();
    if (VIDEO_HINT.test(h)) return 'video';
    if (AUDIO_HINT.test(h)) return 'audio';
    if (IMAGE_HINT.test(h)) return 'image';
  }
  return undefined;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/**
 * Durchsucht ein Ergebnis-JSON nach Medien: `{images:[{url,content_type,width,height}]}`, `{image:{url}}`,
 * `{video:{url}}`, `{audio:{url}}`, `{audio_file:{…}}`, `{audio_url:"…"}`, Stems (`vocals`, `drums` …), verschachtelte Arrays.
 * Art aus content_type → Dateiendung → Feldname. Doppelte URLs werden entfernt.
 */
export function extractMediaOutputs(result: unknown): MediaOutput[] {
  const out: MediaOutput[] = [];
  const seen = new Set<string>();

  const push = (entry: MediaOutput) => {
    if (seen.has(entry.url)) return;
    seen.add(entry.url);
    out.push(entry);
  };

  const fromString = (url: string, path: string, key?: string, parentKey?: string) => {
    const mime = url.startsWith('data:') ? dataUrlMime(url) : undefined;
    const ext = url.startsWith('data:') ? '' : extOf(url);
    const kind = kindFromMime(mime) ?? kindFromExtension(ext) ?? kindFromHint(key, parentKey) ?? 'file';
    const entry: MediaOutput = { url, kind, path };
    const contentType = mime ?? (ext ? mimeFromExtension(`x.${ext}`) : undefined);
    if (contentType && contentType !== 'application/octet-stream') entry.contentType = contentType;
    push(entry);
  };

  const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

  const walk = (node: unknown, path: string, key: string | undefined, parentKey: string | undefined, depth: number) => {
    if (depth > 16 || node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (looksLikeUrl(node) && !(key && (SKIP_KEYS.has(key) || TEXT_KEYS.has(key)))) fromString(node, path, key, parentKey);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, key, parentKey, depth + 1));
      return;
    }
    if (!isPlainObject(node)) return;
    const url = typeof node.url === 'string' ? node.url : undefined;
    if (url && looksLikeUrl(url)) {
      const contentType = typeof node.content_type === 'string' ? node.content_type : typeof node.mime_type === 'string' ? node.mime_type : undefined;
      const fileName = typeof node.file_name === 'string' ? node.file_name : undefined;
      const dataMime = url.startsWith('data:') ? dataUrlMime(url) : undefined;
      const kind =
        kindFromMime(contentType) ??
        kindFromMime(dataMime) ??
        kindFromExtension(extOf(fileName)) ??
        kindFromExtension(url.startsWith('data:') ? '' : extOf(url)) ??
        kindFromHint(typeof node.media_type === 'string' ? node.media_type : undefined, key, parentKey) ??
        'file';
      const entry: MediaOutput = { url, kind, path };
      const extName = fileName ?? (url.startsWith('data:') ? '' : url);
      const extMime = extOf(extName) ? mimeFromExtension(`x.${extOf(extName)}`) : undefined;
      const type = contentType ?? dataMime ?? (extMime !== 'application/octet-stream' ? extMime : undefined);
      if (type) entry.contentType = type;
      const resolution = isPlainObject(node.resolution) ? node.resolution : undefined;
      const width = num(node.width) ?? num(resolution?.width);
      const height = num(node.height) ?? num(resolution?.height);
      if (width) entry.width = width;
      if (height) entry.height = height;
      const duration = num(node.duration) ?? num(node.duration_seconds) ?? (num(node.duration_ms) !== undefined ? (num(node.duration_ms) ?? 0) / 1000 : undefined);
      if (duration) entry.durationSec = duration;
      if (fileName) entry.fileName = fileName;
      push(entry);
      return; // Unterfelder (z. B. Vorschaubilder eines Videos) sind keine eigenständigen Ausgaben
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(childKey)) continue;
      walk(value, join(path, childKey), childKey, key, depth + 1);
    }
  };

  walk(result, '', undefined, undefined, 0);
  return out;
}

// ───────────────────────── Download ─────────────────────────

function sanitizeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
}

function extensionFor(contentType: string, url: string): string {
  const fromMime = extensionFromMime(contentType);
  if (fromMime !== 'bin') return fromMime;
  if (contentType === 'audio/mpeg') return 'mp3';
  return extOf(url) || 'bin';
}

function chooseName(fileName: string | undefined, url: string, contentType: string): string {
  const ext = extensionFor(contentType, url);
  let base = fileName ? sanitizeName(fileName) : '';
  if (!base && /^https?:/i.test(url)) {
    try {
      const last = new URL(url).pathname.split('/').filter(Boolean).pop();
      base = last ? sanitizeName(decodeURIComponent(last)) : '';
    } catch {
      base = '';
    }
  }
  if (!base) base = `fal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return /\.[a-z0-9]{1,6}$/i.test(base) ? base : `${base}.${ext}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function uniquePath(dir: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = join(dir, name);
  for (let i = 1; await exists(candidate); i++) candidate = join(dir, `${stem}-${i}${ext}`);
  return candidate;
}

export interface DownloadOptions {
  fetch?: typeof fetch;
  fileName?: string;
  signal?: AbortSignal;
}

/**
 * Lädt eine (temporäre) fal-URL in `destDir`: Stream in eine `.part`-Datei, dann Umbenennen.
 * Endung aus Content-Type bzw. URL; bestehende Dateien werden nicht überschrieben (`name-1.ext`).
 * `data:`-URLs (fal `sync_mode`) werden direkt dekodiert.
 */
export async function downloadToFile(url: string, destDir: string, opts: DownloadOptions = {}): Promise<{ path: string; contentType: string; bytes: number }> {
  if (opts.signal?.aborted) throw abortError(opts.signal);
  await mkdir(destDir, { recursive: true });

  if (url.startsWith('data:')) {
    const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(url);
    if (!m) throw new Error('Ungültige data-URL');
    const contentType = (m[1] || 'application/octet-stream').toLowerCase();
    const payload = m[3] ?? '';
    const bytes = (m[2] ?? '').includes(';base64') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
    const target = await uniquePath(destDir, chooseName(opts.fileName, url, contentType));
    const tmp = `${target}.part-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmp, bytes);
    await rename(tmp, target);
    return { path: target, contentType, bytes: bytes.length };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Ungültige Download-URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`Download nur über http(s) möglich, nicht ${parsed.protocol}`);

  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: opts.signal });
  } catch (error) {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    throw new FalError(`Download fehlgeschlagen (Netzwerk): ${safeUrl(url)}`, { code: 'network', retryable: true, cause: error });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new FalError(`Download fehlgeschlagen (HTTP ${response.status}): ${safeUrl(url)}`, {
      status: response.status,
      code: response.status === 404 || response.status === 410 ? 'not_found' : 'http',
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  const headerType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const fromExt = mimeFromExtension(parsed.pathname);
  const contentType = headerType && headerType !== 'application/octet-stream' && headerType !== 'binary/octet-stream' ? headerType : fromExt !== 'application/octet-stream' ? fromExt : headerType || 'application/octet-stream';
  const target = await uniquePath(destDir, chooseName(opts.fileName, url, contentType));
  const tmp = `${target}.part-${Math.random().toString(36).slice(2, 8)}`;
  let bytes = 0;
  try {
    if (response.body) {
      const source = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
      await pipeline(
        source,
        async function* count(chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            bytes += chunk.length;
            yield chunk;
          }
        },
        createWriteStream(tmp),
        opts.signal ? { signal: opts.signal } : {},
      );
    } else {
      const buffer = new Uint8Array(await response.arrayBuffer());
      bytes = buffer.length;
      await writeFile(tmp, buffer);
    }
    const expected = Number(response.headers.get('content-length'));
    const encoded = Boolean(response.headers.get('content-encoding'));
    if (!encoded && Number.isFinite(expected) && expected > 0 && expected !== bytes) {
      throw new FalError(`Download unvollständig (${bytes} von ${expected} Bytes): ${safeUrl(url)}`, { code: 'network', retryable: true });
    }
    await rename(tmp, target);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    if (opts.signal?.aborted) throw abortError(opts.signal);
    if (error instanceof FalError) throw error;
    throw new FalError(`Download fehlgeschlagen: ${safeUrl(url)} (${(error as Error).message})`, { code: 'network', retryable: true, cause: error });
  }
  return { path: target, contentType, bytes };
}
