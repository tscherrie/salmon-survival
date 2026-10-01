import { createWriteStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { crc32 } from './crc32.ts';

/**
 * Minimaler ZIP-Schreiber (Deflate, ohne ZIP64): für den Export statischer Websites.
 * Grenzen: < 65 535 Einträge, Dateien und Archiv < 4 GiB.
 */

export interface ZipEntry {
  /** Pfad im Archiv (mit `/`). */
  name: string;
  data: Uint8Array;
  mtime?: Date;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f),
  };
}

/** Erzeugt ein ZIP-Archiv im Speicher. */
export function createZip(entries: ZipEntry[]): Buffer {
  if (entries.length > 0xfffe) throw new Error('Zu viele Dateien für ZIP (max. 65 534)');
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name || name.split('/').includes('..')) throw new Error(`Ungültiger Archivpfad: ${entry.name}`);
    if (seen.has(name)) throw new Error(`Doppelter Archivpfad: ${name}`);
    seen.add(name);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(entry.data);
    const deflated = deflateRawSync(entry.data, { level: 9 });
    const useDeflate = deflated.length < entry.data.length;
    const body = useDeflate ? deflated : Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    if (body.length >= 0xffffffff || entry.data.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('Datei zu groß für ZIP ohne ZIP64');
    const { time, date } = dosDateTime(entry.mtime ?? new Date(1980, 0, 1));
    const method = useDeflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8-Dateinamen
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // erstellt mit: Unix, Version 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.studio', '.vite', '.cache', '.DS_Store']);
const EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db', '.env', '.env.local', '.npmrc']);

async function collect(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.has(e.name)) continue;
      await collect(root, full, out);
    } else if (e.isFile()) {
      if (EXCLUDED_FILES.has(e.name) || e.name.startsWith('.env')) continue;
      out.push(full);
    }
    // Symlinks werden bewusst ausgelassen (könnten aus dem Projekt herausführen).
  }
}

/**
 * Packt einen Website-Ordner als ZIP (ohne `node_modules`, `.git`, `.env*`, Symlinks).
 * Für Vite-Projekte den Build-Ordner (`dist`) übergeben.
 */
export async function buildSiteZip(siteDir: string, out: string): Promise<{ path: string; files: number; bytes: number }> {
  const root = path.resolve(siteDir);
  const files: string[] = [];
  await collect(root, root, files);
  const resolvedOut = path.resolve(out);
  const entries: ZipEntry[] = [];
  for (const file of files) {
    if (file === resolvedOut) continue;
    const [data, info] = await Promise.all([readFile(file), stat(file)]);
    entries.push({ name: path.relative(root, file).split(path.sep).join('/'), data, mtime: info.mtime });
  }
  const zip = createZip(entries);
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(resolvedOut);
    ws.on('error', reject);
    ws.end(zip, () => resolve());
  });
  return { path: resolvedOut, files: entries.length, bytes: zip.length };
}
