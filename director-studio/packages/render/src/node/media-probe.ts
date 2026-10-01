import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetKind } from '@studio/core';

/**
 * Vorabprüfung von Medien für den Render-Worker: Existiert die Datei, passt ihr Inhalt zur Asset-Art
 * (Bild/Video), ist ein MP4 vollständig (`moov`) und hat es eine Videospur? Ohne ffmpeg – nur
 * Dateisignaturen und die MP4-Box-Struktur. So lässt die Komposition kaputte Medien beim Rendern aus,
 * statt an Remotions `delayRender`-Zeitlimit zu scheitern. Unbekannte Formate gelten als ladbar.
 */

export type SniffedMediaType =
  | 'mp4'
  | 'webm'
  | 'avi'
  | 'ogg'
  | 'mpegts'
  | 'mpegps'
  | 'flv'
  | 'asf'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'avif'
  | 'heic'
  | 'bmp'
  | 'tiff'
  | 'ico'
  | 'svg'
  | 'audio'
  | 'html'
  | 'json'
  | 'text'
  | 'empty'
  | 'unknown';

const IMAGE_TYPES = new Set<SniffedMediaType>(['png', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'bmp', 'tiff', 'ico', 'svg']);
const VIDEO_TYPES = new Set<SniffedMediaType>(['mp4', 'webm', 'avi', 'ogg', 'mpegts', 'mpegps', 'flv', 'asf']);
/** Bildformate, die Chromium nicht dekodiert. */
const UNSUPPORTED_IMAGES = new Set<SniffedMediaType>(['heic', 'tiff']);

const TYPE_LABELS: Partial<Record<SniffedMediaType, string>> = {
  html: 'eine HTML-Seite (z. B. Fehlerseite statt Datei)',
  json: 'JSON-Text',
  text: 'Text',
  audio: 'eine reine Tondatei',
  empty: 'leer',
};

function ascii(buf: Uint8Array, from: number, to: number): string {
  let s = '';
  for (let i = from; i < Math.min(to, buf.length); i++) s += String.fromCharCode(buf[i]!);
  return s;
}

/** Erkennt das Format an den ersten Bytes (mind. ~512 Byte übergeben). */
export function sniffMediaType(head: Uint8Array): SniffedMediaType {
  if (head.length === 0) return 'empty';
  const b = head;
  const at = (i: number) => b[i] ?? -1;
  if (at(0) === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF') {
    const form = ascii(b, 8, 12);
    if (form === 'WEBP') return 'webp';
    if (form === 'AVI ') return 'avi';
    if (form === 'WAVE') return 'audio';
  }
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
    if (brand === 'M4A ' || brand === 'M4B ' || brand === 'M4P ') return 'audio';
    return 'mp4';
  }
  if (['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(ascii(b, 4, 8))) return 'mp4';
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return 'webm';
  if (ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (ascii(b, 0, 3) === 'FLV') return 'flv';
  if (at(0) === 0x30 && at(1) === 0x26 && at(2) === 0xb2 && at(3) === 0x75) return 'asf';
  if (at(0) === 0 && at(1) === 0 && at(2) === 1 && at(3) === 0xba) return 'mpegps';
  if (at(0) === 0x47 && at(188) === 0x47 && (b.length < 377 || at(376) === 0x47)) return 'mpegts';
  if (ascii(b, 0, 4) === 'fLaC' || ascii(b, 0, 3) === 'ID3') return 'audio';
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return 'audio'; // MP3/AAC-Frame-Sync
  if (ascii(b, 0, 2) === 'BM' && [12, 40, 52, 56, 64, 108, 124].includes(at(14)) && at(15) === 0 && at(16) === 0 && at(17) === 0) return 'bmp';
  if (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*') return 'tiff';
  if (at(0) === 0 && at(1) === 0 && at(2) === 1 && at(3) === 0) return 'ico';
  // Textformate (BOM/Leerraum überspringen).
  const text = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, Math.min(b.length, 1024))).replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'svg';
  if (/^<(?:!doctype html|html|head|body|title|meta|\?xml)/.test(text)) return 'html';
  if (text.startsWith('{') || text.startsWith('[')) return 'json';
  let printable = 0;
  const sample = b.subarray(0, Math.min(b.length, 512));
  for (const byte of sample) if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 0xc2) printable++;
  if (sample.length > 0 && printable / sample.length > 0.97) return 'text';
  return 'unknown';
}

/** Prüft, ob der erkannte Typ zur Asset-Art passt; liefert eine deutsche Fehlermeldung oder `undefined`. */
export function checkSniffedKind(type: SniffedMediaType, kind: AssetKind): string | undefined {
  if (type === 'unknown') return undefined;
  if (type === 'empty') return 'Datei ist leer';
  if (kind === 'image') {
    if (UNSUPPORTED_IMAGES.has(type)) return `Bildformat ${type.toUpperCase()} kann der Browser nicht darstellen`;
    if (IMAGE_TYPES.has(type)) return undefined;
    if (VIDEO_TYPES.has(type)) return `Datei ist ein Video (${type}), kein Bild`;
    return `Datei ist ${TYPE_LABELS[type] ?? type}, kein Bild`;
  }
  if (kind === 'video') {
    if (VIDEO_TYPES.has(type)) return undefined;
    if (IMAGE_TYPES.has(type)) return `Datei ist ein Bild (${type}), kein Video`;
    return `Datei ist ${TYPE_LABELS[type] ?? type}, kein Video`;
  }
  return undefined;
}

interface Mp4Info {
  hasMoov: boolean;
  hasVideoTrack: boolean | undefined;
  /** Box-Struktur vollständig gelesen (kein Abbruch durch defekte Größen). */
  complete: boolean;
}

/** Liest die MP4-Top-Level-Boxen; prüft `moov` und eine Videospur (`hdlr` = `vide`). */
async function inspectMp4(file: string, size: number): Promise<Mp4Info> {
  const fh = await open(file, 'r');
  try {
    let offset = 0;
    let hasMoov = false;
    let hasVideoTrack: boolean | undefined;
    const header = Buffer.alloc(16);
    for (let guard = 0; offset + 8 <= size && guard < 10000; guard++) {
      const { bytesRead } = await fh.read(header, 0, 16, offset);
      if (bytesRead < 8) break;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        if (bytesRead < 16) break;
        boxSize = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (boxSize === 0) boxSize = size - offset;
      if (boxSize < headerSize || offset + boxSize > size + 8) return { hasMoov, hasVideoTrack, complete: false };
      if (type === 'moov') {
        hasMoov = true;
        const len = Math.min(boxSize - headerSize, 64 * 1024 * 1024);
        const moov = Buffer.alloc(len);
        await fh.read(moov, 0, len, offset + headerSize);
        hasVideoTrack = findHandler(moov, 'vide');
      }
      offset += boxSize;
    }
    return { hasMoov, hasVideoTrack, complete: offset >= size };
  } finally {
    await fh.close();
  }
}

function findHandler(moov: Buffer, handler: string): boolean {
  for (let i = moov.indexOf('hdlr', 0, 'latin1'); i >= 0; i = moov.indexOf('hdlr', i + 4, 'latin1')) {
    // hdlr: Typ(4) Version/Flags(4) pre_defined(4) handler_type(4)
    if (moov.toString('latin1', i + 12, i + 16) === handler) return true;
  }
  return false;
}

/** Lokaler Pfad aus `file://`-URL oder absolutem Pfad; sonst `undefined`. */
export function localPathOf(url: string): string | undefined {
  if (url.startsWith('file:')) {
    try {
      return fileURLToPath(url);
    } catch {
      return undefined;
    }
  }
  return path.isAbsolute(url) ? url : undefined;
}

export interface ProbeOptions {
  /** Zeitlimit für entfernte URLs (ms, Standard 10000). */
  timeoutMs?: number;
}

/**
 * Prüft ein Bild-/Video-Medium. Liefert `undefined` (ladbar oder unbekannt) oder eine deutsche
 * Fehlerbeschreibung. Andere Asset-Arten und `data:`-URLs werden nicht geprüft.
 */
export async function probeMedia(url: string, kind: AssetKind, opts: ProbeOptions = {}): Promise<string | undefined> {
  if (kind !== 'image' && kind !== 'video') return undefined;
  if (!url) return 'keine Datei angegeben';
  if (url.startsWith('data:')) return undefined;
  const local = localPathOf(url);
  if (local) return probeLocal(local, kind);
  if (/^https?:\/\//i.test(url)) return probeRemote(url, kind, opts.timeoutMs ?? 10000);
  return undefined;
}

async function probeLocal(file: string, kind: AssetKind): Promise<string | undefined> {
  let size: number;
  try {
    const st = await stat(file);
    if (!st.isFile()) return 'Pfad ist keine Datei';
    size = st.size;
  } catch {
    return 'Datei fehlt';
  }
  if (size === 0) return 'Datei ist leer';
  let head: Buffer;
  try {
    const fh = await open(file, 'r');
    try {
      head = Buffer.alloc(Math.min(size, 4096));
      await fh.read(head, 0, head.length, 0);
    } finally {
      await fh.close();
    }
  } catch {
    return 'Datei nicht lesbar';
  }
  const type = sniffMediaType(head);
  const mismatch = checkSniffedKind(type, kind);
  if (mismatch) return mismatch;
  if (kind === 'video' && type === 'mp4') {
    try {
      const info = await inspectMp4(file, size);
      if (!info.hasMoov) return info.complete ? 'Video unvollständig (moov-Box fehlt – Download abgebrochen?)' : 'Video beschädigt (ungültige MP4-Struktur)';
      if (info.hasVideoTrack === false) return 'Datei enthält keine Videospur';
    } catch {
      return 'Video nicht lesbar';
    }
  }
  return undefined;
}

async function probeRemote(url: string, kind: AssetKind, timeoutMs: number): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-4095' }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return `HTTP ${res.status} beim Laden`;
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (reader && total < 4096) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    await reader?.cancel().catch(() => undefined);
    const head = new Uint8Array(Math.min(total, 4096));
    let pos = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, head.length - pos);
      head.set(c.subarray(0, take), pos);
      pos += take;
      if (pos >= head.length) break;
    }
    return checkSniffedKind(sniffMediaType(head), kind);
  } catch (error) {
    return controller.signal.aborted ? 'Zeitüberschreitung beim Laden' : `nicht erreichbar (${error instanceof Error ? error.message : String(error)})`;
  } finally {
    clearTimeout(timer);
  }
}
