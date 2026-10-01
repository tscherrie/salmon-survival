import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

/**
 * `studio-asset://<projectId>/<assetId>?v=original|proxy|thumb` – liefert Projektdateien an den Renderer
 * (Player, Thumbnails, Wellenformen) ohne Dateisystemzugriff im Renderer. Unterstützt HTTP-Range
 * (nötig für Video-Scrubbing).
 */
export const ASSET_SCHEME = 'studio-asset';

export type AssetVariant = 'original' | 'proxy' | 'thumb';

export function buildAssetUrl(projectId: string, assetId: string, variant: AssetVariant = 'original'): string {
  return `${ASSET_SCHEME}://${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}${variant === 'original' ? '' : `?v=${variant}`}`;
}

export function parseAssetUrl(url: string): { projectId: string; assetId: string; variant: AssetVariant } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${ASSET_SCHEME}:`) return null;
  const projectId = decodeURIComponent(parsed.hostname || parsed.host);
  const assetId = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!projectId || !assetId || assetId.includes('/')) return null;
  const v = parsed.searchParams.get('v');
  const variant: AssetVariant = v === 'proxy' || v === 'thumb' ? v : 'original';
  return { projectId, assetId, variant };
}

export interface ResolvedAssetFile {
  path: string;
  mime: string;
}

export type AssetFileResolver = (projectId: string, assetId: string, variant: AssetVariant) => Promise<ResolvedAssetFile | null>;

/** Handler im Fetch-Stil (Electron `protocol.handle`), in Node testbar. */
export function createAssetHandler(resolve: AssetFileResolver): (request: Request) => Promise<Response> {
  return async (request) => {
    const target = parseAssetUrl(request.url);
    if (!target) return new Response('Ungültige Asset-URL', { status: 400 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const file = await resolve(target.projectId, target.assetId, target.variant);
    if (!file) return new Response('Asset nicht gefunden', { status: 404 });
    let size: number;
    try {
      size = (await stat(file.path)).size;
    } catch {
      return new Response('Datei fehlt', { status: 404 });
    }
    const baseHeaders: Record<string, string> = {
      'Content-Type': file.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` } });
    }
    if (range) {
      const { start, end } = range;
      const headers = { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) };
      if (request.method === 'HEAD') return new Response(null, { status: 206, headers });
      return new Response(toWebStream(file.path, start, end), { status: 206, headers });
    }
    const headers = { ...baseHeaders, 'Content-Length': String(size) };
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(size === 0 ? null : toWebStream(file.path, 0, size - 1), { status: 200, headers });
  };
}

export function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';
  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;
  if (rawStart === '' && rawEnd === '') return 'invalid';
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

function toWebStream(path: string, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream<Uint8Array>;
}
