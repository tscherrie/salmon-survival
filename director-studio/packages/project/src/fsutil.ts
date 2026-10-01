import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Schreibt atomar (tmp + rename), damit ein Absturz nie eine halbe Datei hinterlässt. */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = tmpPathFor(path);
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
}

function tmpPathFor(path: string): string {
  return `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Kopiert atomar: erst in eine temporäre Datei daneben (mit fsync), dann per rename an das Ziel. Ein
 * abgebrochener Kopiervorgang hinterlässt so nie eine halbe Datei unter dem Zielnamen.
 */
export async function copyFileAtomic(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const tmp = tmpPathFor(target);
  try {
    await copyFileSynced(source, tmp);
    await rename(tmp, target);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/** Kopiert und synchronisiert die Kopie auf die Platte (ohne rename). */
export async function copyFileSynced(source: string, target: string): Promise<void> {
  await copyFile(source, target);
  const handle = await open(target, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** `true`, wenn `path` eine reguläre Datei ist (und, falls angegeben, genau `size` Bytes hat). */
export async function isRegularFile(path: string, size?: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && (size === undefined || info.size === size);
  } catch {
    return false;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

/**
 * Hängt eine Zeile an und synchronisiert sie auf die Platte (Journal-Semantik). Endet die Datei nicht mit
 * einem Zeilenumbruch (Absturz mitten im Schreiben), wird vorher einer ergänzt – sonst würde der neue
 * Eintrag mit dem abgerissenen Rest zu einer unlesbaren Zeile verschmelzen.
 */
export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await appendJsonLines(path, [value]);
}

/** Wie {@link appendJsonLine} für mehrere Einträge in einem Schreibvorgang (ein fsync). */
export async function appendJsonLines(path: string, values: readonly unknown[]): Promise<void> {
  if (values.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  const payload = values.map((value) => `${JSON.stringify(value)}\n`).join('');
  const handle = await open(path, 'a+');
  try {
    const { size } = await handle.stat();
    let prefix = '';
    if (size > 0) {
      const last = Buffer.alloc(1);
      await handle.read(last, 0, 1, size - 1);
      if (last[0] !== 0x0a) prefix = '\n';
    }
    await handle.appendFile(prefix + payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Eine beim Lesen übersprungene, nicht parsebare JSONL-Zeile. */
export interface CorruptJsonLine {
  path: string;
  /** 1-basiert. */
  line: number;
  /** `true`, wenn es die letzte Zeile ist (typisch: Absturz beim Schreiben). */
  last: boolean;
  error: string;
}

export interface ReadJsonLinesOptions {
  /** Wird für jede übersprungene Zeile aufgerufen; ohne Rückruf wird auf der Konsole gewarnt. */
  onCorruptLine?: (info: CorruptJsonLine) => void;
}

/** Lesbare Warnung zu einer übersprungenen JSONL-Zeile. */
export function describeCorruptLine(info: CorruptJsonLine): string {
  return info.last
    ? `Unvollständige letzte Zeile ${info.line} in ${info.path} übersprungen (vermutlich Absturz beim Schreiben): ${info.error}`
    : `Beschädigte Zeile ${info.line} in ${info.path} übersprungen: ${info.error}`;
}

/**
 * Liest JSONL. Nicht parsebare Zeilen (abgerissene letzte Zeile nach einem Absturz, aber auch eine beschädigte
 * Zeile mittendrin) werden übersprungen und gemeldet – das Öffnen eines Projekts scheitert nie daran. Jede
 * gültige Zeile wird gelesen, auch eine letzte ohne abschließenden Zeilenumbruch.
 */
export async function readJsonLines<T>(path: string, options: ReadJsonLinesOptions = {}): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const report = options.onCorruptLine ?? ((info: CorruptJsonLine) => console.warn(describeCorruptLine(info)));
  const out: T[] = [];
  const lines = text.split('\n');
  let lastContent = lines.length - 1;
  while (lastContent >= 0 && !lines[lastContent]!.trim()) lastContent--;
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line) as T);
    } catch (error) {
      report({ path, line: index + 1, last: index === lastContent, error: (error as Error).message });
    }
  });
  return out;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

export function sha256Buffer(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/** Macht einen Titel dateisystemtauglich (macOS/Windows). */
export function safeFileName(title: string): string {
  const cleaned = title
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  const base = cleaned.slice(0, 80) || 'Projekt';
  return reserved.test(base) ? `${base}-projekt` : base;
}
