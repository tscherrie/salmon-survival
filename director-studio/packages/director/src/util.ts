import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

/**
 * Prompt-Injection-Hygiene: Externe Inhalte (Webseiten, Transkripte, Dateitexte, DOM, Modell-
 * beschreibungen) gehen nur als markierte Daten an den Director. Der Systemprompt erklärt, dass
 * Anweisungen darin keine Anweisungen an ihn sind.
 */
export function wrapUntrusted(source: string, content: string): string {
  // Ein schließendes Tag im Inhalt darf den Block nicht vorzeitig beenden.
  const safe = content.replace(/<\/untrusted_data/gi, '<\\/untrusted_data');
  return `<untrusted_data source="${escapeXmlAttr(source)}">\n${safe}\n</untrusted_data>`;
}

export function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncate(text: string, max: number, note = '… [gekürzt]'): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - note.length))}${note}`;
}

export function firstLine(text: string, max = 140): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return truncate(line.trim(), max, '…');
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'APIUserAbortError';
}

export function abortError(message = 'Abgebrochen'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/** Wartet auf ein Promise, bricht aber bei `signal` ab (das Promise läuft ggf. weiter). */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Arbeitsordner innerhalb des Projekts (gleiches Laufwerk → `rename` statt Kopie beim Übernehmen). */
export async function projectTempDir(projectDir: string, prefix: string): Promise<string> {
  const base = join(projectDir, '.studio', 'tmp');
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, `${prefix}-`));
}

export function slugify(text: string, max = 48): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'asset';
}

export function formatSec(sec: number): string {
  return `${(Math.round(sec * 100) / 100).toFixed(2)} s`;
}

/** Stabile JSON-Darstellung (sortierte Schlüssel) – wichtig für byte-stabile Prompts. */
export function stableJson(value: unknown, indent = 0): string {
  return JSON.stringify(sortKeys(value), null, indent || undefined);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

// ───────────────────────── Bilder für den Director ─────────────────────────

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageBlockData {
  type: 'image';
  mediaType: ImageMediaType;
  data: string;
}

/** Maximale Rohgröße eines Bildes (Base64 bläht um 4/3 auf; API-Grenze ~5 MB je Bild). */
export const MAX_IMAGE_BYTES = 3_700_000;

export function imageMediaTypeFor(path: string): ImageMediaType | undefined {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

/** Liest eine Bilddatei als Bildblock; `undefined`, wenn Format oder Größe nicht passen. */
export async function readImageBlock(path: string): Promise<ImageBlockData | undefined> {
  const mediaType = imageMediaTypeFor(path);
  if (!mediaType) return undefined;
  const info = await stat(path);
  if (info.size > MAX_IMAGE_BYTES) return undefined;
  const data = (await readFile(path)).toString('base64');
  return { type: 'image', mediaType, data };
}

export function sniffImageMediaType(bytes: Uint8Array): ImageMediaType | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return undefined;
}

/**
 * Sammelt beim Rendern ausgelassene Medien (fehlende/defekte Dateien) und fasst sie für das Tool-Ergebnis
 * zusammen – damit der Director nicht ein Bild beurteilt, dem stillschweigend ein Clip fehlt.
 */
export function mediaIssueCollector(): { onMediaError: (issue: { clipId: string; assetId: string; message: string }) => void; summary: () => string | undefined } {
  const seen = new Map<string, string>();
  return {
    onMediaError: (issue) => {
      const key = `${issue.clipId}\u0000${issue.assetId}`;
      if (!seen.has(key)) seen.set(key, `Clip ${issue.clipId} (Asset ${issue.assetId}): ${truncate(issue.message, 300)}`);
    },
    summary: () =>
      seen.size === 0
        ? undefined
        : `Achtung – ${seen.size === 1 ? 'ein Medium fehlte oder war defekt und ist' : `${seen.size} Medien fehlten oder waren defekt und sind`} im Bild nicht zu sehen:\n${[...seen.values()].map((l) => `- ${l}`).join('\n')}`,
  };
}
