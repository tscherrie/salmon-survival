import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import { extname, join } from 'node:path';
import type { WebDownload, WebPort } from '@studio/director';

/** Standard-Obergrenze für `import_url` (Bytes). */
export const DEFAULT_WEB_MAX_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TITLE_SCAN_BYTES = 64 * 1024;

/**
 * Adressen, die `import_url` nie erreichen darf: Loopback, private Netze (RFC 1918, ULA), Link-Local, CGNAT,
 * Multicast, Dokumentations-/Benchmark-Netze und „unspezifiziert“ – sonst könnte eine Web-Referenz (oder eine
 * Weiterleitung) Dienste auf dem Rechner oder im lokalen Netz abfragen.
 */
const BLOCKED = (() => {
  const list = new BlockList();
  for (const [net, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const) {
    list.addSubnet(net, prefix, 'ipv4');
  }
  for (const [net, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8],
    ['2001:db8::', 32],
  ] as const) {
    list.addSubnet(net, prefix, 'ipv6');
  }
  return list;
})();

/** Ist die IP-Adresse lokal/privat (bzw. keine gültige Adresse)? IPv4-gemappte IPv6-Adressen zählen als IPv4. */
export function isBlockedAddress(address: string): boolean {
  const plain = address.replace(/^\[|\]$/g, '').split('%')[0]!;
  const family = isIP(plain);
  if (family === 4) return BLOCKED.check(plain, 'ipv4');
  if (family !== 6) return true;
  const lower = plain.toLowerCase();
  const mapped = /^(?:0{0,4}:){0,4}:?(?:0{0,4}:)?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isBlockedAddress(mapped[1]!);
  const hexMapped = /^(?:0{0,4}:){0,4}:?(?:0{0,4}:)?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16);
    const lo = parseInt(hexMapped[2]!, 16);
    return isBlockedAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return BLOCKED.check(plain, 'ipv6');
}

export interface WebPortOptions {
  /** Höchstgröße einer Datei (Standard 512 MB). */
  maxBytes?: number;
  /** Zeitlimit ohne Datenfluss (Standard 30 s). */
  timeoutMs?: number;
  /** Prüfung der Zieladresse (Standard {@link isBlockedAddress}); nur für Tests ersetzbar. */
  isBlocked?: (address: string) => boolean;
  /** DNS-Auflösung (Standard `dns.lookup`); nur für Tests ersetzbar. */
  lookup?: LookupFunction;
}

class WebImportError extends Error {
  override name = 'WebImportError';
}

/**
 * WebPort der App für `import_url`: lädt eine http(s)-Ressource in eine Datei. Jede Verbindung (auch nach
 * Weiterleitungen) wird beim Verbindungsaufbau gegen lokale/private Adressen geprüft – die Prüfung sitzt im
 * DNS-Lookup des Sockets, damit sich zwischen Prüfung und Verbindung keine andere Adresse einschieben kann
 * (DNS-Rebinding). Größe und Wartezeit sind begrenzt; Zugangsdaten in URLs werden abgelehnt.
 */
export function createWebPort(options: WebPortOptions = {}): WebPort {
  const maxBytes = options.maxBytes ?? DEFAULT_WEB_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const isBlocked = options.isBlocked ?? isBlockedAddress;
  const baseLookup: LookupFunction = options.lookup ?? (dnsLookup as unknown as LookupFunction);

  const guardedLookup: LookupFunction = (hostname, lookupOptions, callback) => {
    baseLookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
      if (error) return callback(error, '', 0);
      const list = (Array.isArray(addresses) ? addresses : [{ address: addresses as unknown as string, family: 4 }]) as Array<{ address: string; family: number }>;
      if (list.length === 0) return callback(new WebImportError(`${hostname} ist nicht auflösbar`), '', 0);
      const bad = list.find((a) => isBlocked(a.address));
      if (bad) return callback(new WebImportError(`Ziel ${hostname} (${bad.address}) ist eine lokale/private Adresse – nicht erlaubt`), '', 0);
      if (lookupOptions.all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
      return callback(null, list[0]!.address, list[0]!.family);
    });
  };

  const open = (url: URL, signal?: AbortSignal): Promise<IncomingMessage> =>
    new Promise((resolve, reject) => {
      const literal = url.hostname.replace(/^\[|\]$/g, '');
      // IP-Literale löst kein DNS auf – sie direkt prüfen.
      if (isIP(literal) && isBlocked(literal)) {
        reject(new WebImportError(`Ziel ${literal} ist eine lokale/private Adresse – nicht erlaubt`));
        return;
      }
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(
        url,
        {
          method: 'GET',
          lookup: guardedLookup,
          headers: { 'user-agent': 'DirectorStudio/0.1 (+import_url)', accept: '*/*', 'accept-encoding': 'identity' },
          ...(signal ? { signal } : {}),
        },
        resolve,
      );
      req.setTimeout(timeoutMs, () => req.destroy(new WebImportError(`Zeitüberschreitung beim Laden von ${url.host}`)));
      req.on('error', reject);
      req.end();
    });

  async function download(rawUrl: string, destDir: string, opts: { signal?: AbortSignal } = {}): Promise<WebDownload> {
    let url = checkUrl(rawUrl);
    let response: IncomingMessage | undefined;
    for (let hop = 0; ; hop++) {
      response = await open(url, opts.signal);
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (hop >= MAX_REDIRECTS) throw new WebImportError(`Zu viele Weiterleitungen (${rawUrl})`);
        url = checkUrl(new URL(response.headers.location, url).href);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        throw new WebImportError(`Download fehlgeschlagen (HTTP ${status}): ${url.host}${url.pathname}`);
      }
      break;
    }
    const length = Number(response.headers['content-length']);
    if (Number.isFinite(length) && length > maxBytes) {
      response.destroy();
      throw new WebImportError(`Datei zu groß (${formatMb(length)} MB, erlaubt ${formatMb(maxBytes)} MB)`);
    }
    const contentType = (response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase() || 'application/octet-stream';
    await mkdir(destDir, { recursive: true });
    const target = await uniquePath(destDir, fileNameFor(url, contentType, response.headers['content-disposition']));
    const tmp = `${target}.part`;
    let bytes = 0;
    let head = Buffer.alloc(0);
    const out = createWriteStream(tmp);
    const closed = new Promise<void>((resolve) => out.once('close', () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        let failed = false;
        const fail = (error: Error) => {
          if (failed) return;
          failed = true;
          // Erst ablehnen, dann abbauen: destroy() löst selbst noch „aborted“/„error“ aus.
          reject(error);
          response!.destroy();
          out.destroy();
        };
        response!.on('data', (chunk: Buffer) => {
          if (failed) return;
          bytes += chunk.length;
          if (bytes > maxBytes) return fail(new WebImportError(`Datei zu groß (über ${formatMb(maxBytes)} MB)`));
          if (head.length < TITLE_SCAN_BYTES) head = Buffer.concat([head, chunk.subarray(0, TITLE_SCAN_BYTES - head.length)]);
          if (!out.write(chunk)) {
            response!.pause();
            out.once('drain', () => response!.resume());
          }
        });
        response!.on('end', () => out.end());
        response!.on('aborted', () => fail(new WebImportError('Verbindung abgebrochen')));
        response!.on('error', fail);
        out.on('error', fail);
        out.on('finish', resolve);
      });
      if (Number.isFinite(length) && length > 0 && length !== bytes) throw new WebImportError(`Download unvollständig (${bytes} von ${length} Bytes)`);
      await rename(tmp, target);
    } catch (error) {
      // Erst warten, bis der Datei-Stream zu ist – sonst legt ein noch ausstehendes open() die Teildatei neu an.
      out.destroy();
      await closed;
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
    const title = contentType === 'text/html' || contentType === 'application/xhtml+xml' ? htmlTitle(head.toString('utf8')) : undefined;
    return { path: target, contentType, bytes, finalUrl: url.href, ...(title ? { title } : {}) };
  }

  return { download };
}

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebImportError(`Ungültige URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WebImportError(`Nur http(s)-URLs sind erlaubt, nicht ${url.protocol}`);
  if (url.username || url.password) throw new WebImportError('URLs mit Zugangsdaten werden nicht geladen');
  if (!url.hostname) throw new WebImportError(`Ungültige URL: ${raw}`);
  return url;
}

function htmlTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  const text = m[1]!
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 200) : undefined;
}

const EXT_BY_TYPE: Record<string, string> = {
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/plain': 'txt',
};

function fileNameFor(url: URL, contentType: string, disposition: string | undefined): string {
  const fromHeader = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] : undefined;
  let base = '';
  try {
    base = decodeURIComponent(fromHeader ?? url.pathname.split('/').filter(Boolean).at(-1) ?? '');
  } catch {
    base = fromHeader ?? '';
  }
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120);
  if (!base) base = url.hostname.replace(/[^a-z0-9.-]/gi, '_') || 'download';
  const ext = EXT_BY_TYPE[contentType];
  return extname(base) || !ext ? base : `${base}.${ext}`;
}

async function uniquePath(dir: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 0; ; i++) {
    const candidate = join(dir, i === 0 ? name : `${stem}-${i}${ext}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
}

function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0);
}
