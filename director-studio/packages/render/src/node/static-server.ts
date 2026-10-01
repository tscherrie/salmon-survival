import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Kleine statische Dateiauslieferung (nur 127.0.0.1) mit korrekten MIME-Typen und HTTP-Range
 * (für Video-Seeking in Chromium/Remotion).
 */

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
};

export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Parst einen `Range`-Header (nur ein Bereich). `null` = ungültig/nicht erfüllbar. */
export function parseRange(header: string, size: number): { start: number; end: number } | null | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start: number;
  let end: number;
  if (a === '') {
    const suffix = Number(b);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

/** Sendet eine Datei mit Range-Unterstützung. */
export async function sendFile(req: IncomingMessage, res: ServerResponse, filePath: string, extraHeaders: Record<string, string> = {}): Promise<void> {
  const info = await stat(filePath);
  const size = info.size;
  const headers: Record<string, string | number> = {
    'Content-Type': mimeTypeFor(filePath),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Last-Modified': info.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  };
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (range === null) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    if (range) {
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      await pipeFile(filePath, res, range.start, range.end);
      return;
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  await pipeFile(filePath, res, 0, Math.max(0, size - 1), size === 0);
}

function pipeFile(filePath: string, res: ServerResponse, start: number, end: number, empty = false): Promise<void> {
  if (empty) {
    res.end();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { start, end });
    stream.on('error', () => {
      res.destroy();
      resolve();
    });
    res.on('close', () => {
      stream.destroy();
      resolve();
    });
    stream.pipe(res);
  });
}

/**
 * Löst einen URL-Pfad sicher innerhalb von `root` auf. Wirft bei Pfad-Traversal, Nullbytes,
 * versteckten Dateien (Segmente mit `.`, außer `.well-known`) und Symlinks, die aus `root` herausführen.
 */
export async function resolveSafePath(root: string, urlPath: string): Promise<{ path: string; realRoot: string }> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    throw new PathError(400, 'Ungültige URL-Kodierung');
  }
  if (decoded.includes('\0')) throw new PathError(400, 'Ungültiger Pfad');
  const segments = decoded.split(/[\\/]+/).filter(Boolean);
  if (segments.some((s) => s === '..')) throw new PathError(403, 'Pfad außerhalb des Stammverzeichnisses');
  if (segments.some((s) => s.startsWith('.') && s !== '.well-known')) throw new PathError(404, 'Nicht gefunden');
  const realRoot = await realpath(root);
  const resolved = path.resolve(realRoot, ...segments);
  if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) throw new PathError(403, 'Pfad außerhalb des Stammverzeichnisses');
  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    return { path: resolved, realRoot };
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new PathError(403, 'Symlink führt aus dem Stammverzeichnis heraus');
  return { path: real, realRoot };
}

export class PathError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Asset-Server für den Render-Worker: liefert nur ausdrücklich registrierte Dateien aus, unter
 * zufälligen, nicht erratbaren Pfaden (`/<token>/<hash>/<dateiname>`), gebunden an 127.0.0.1.
 */
export class AssetFileServer {
  private readonly files = new Map<string, string>();
  private readonly token = randomBytes(12).toString('hex');
  private constructor(
    private readonly server: Server,
    readonly origin: string,
  ) {}

  static async start(): Promise<AssetFileServer> {
    const holder: { self?: AssetFileServer } = {};
    const server = createServer((req, res) => {
      void holder.self?.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    const self = new AssetFileServer(server, `http://127.0.0.1:${port}`);
    holder.self = self;
    return self;
  }

  /** Registriert eine lokale Datei (Pfad oder `file://`-URL) und liefert ihre HTTP-URL. */
  register(fileOrUrl: string): string {
    const filePath = fileOrUrl.startsWith('file:') ? fileURLToPath(fileOrUrl) : path.resolve(fileOrUrl);
    const key = createHash('sha256').update(filePath).digest('hex').slice(0, 24);
    this.files.set(key, filePath);
    return `${this.origin}/${this.token}/${key}/${encodeURIComponent(path.basename(filePath))}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      const url = new URL(req.url ?? '/', this.origin);
      const [token, key] = url.pathname.split('/').filter(Boolean);
      const filePath = token === this.token && key ? this.files.get(key) : undefined;
      if (!filePath) {
        res.writeHead(404).end();
        return;
      }
      await sendFile(req, res, filePath, { 'Access-Control-Allow-Origin': '*' });
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    }
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.closeAllConnections?.();
      this.server.close(() => resolve());
    });
  }
}
