import { FFmpeg } from '@ffmpeg/ffmpeg';
import { BrowserCapabilityError, checkAbort } from './types.ts';
import { hasBrowserRuntimeReader, readRuntimeFile } from './runtime.ts';
import { ClassicFFmpeg, type MediaProcessor } from './classic-ffmpeg.ts';

let runtime = { coreURL: '/runtime/ffmpeg/ffmpeg-core.js', classicCoreURL: '/runtime/ffmpeg/ffmpeg-core-classic.js', wasmURL: '/runtime/ffmpeg/ffmpeg-core.wasm.json', classicWasmURL: '/runtime/ffmpeg/ffmpeg-core-classic.wasm.json', classWorkerURL: '/runtime/ffmpeg/worker.js' };
/** The app ships these runtime assets on its own origin. No credential or CDN dependency. */
export function configureMediaRuntime(value: Partial<typeof runtime>): void {
  runtime = { ...runtime, ...value, ...(value.wasmURL !== undefined && value.classicWasmURL === undefined ? { classicWasmURL: value.wasmURL } : {}) };
}
interface WasmChunk { url: string; bytes: number; sha256: string }
interface WasmManifest { version: 1; bytes: number; sha256: string; chunks: WasmChunk[] }
const hashPattern = /^[a-f0-9]{64}$/i;
async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function checkedManifest(raw: unknown): WasmManifest {
  const value = raw as Partial<WasmManifest> | null;
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.bytes) || value.bytes! <= 0 || value.bytes! > 256 * 1024 * 1024 || typeof value.sha256 !== 'string' || !hashPattern.test(value.sha256) || !Array.isArray(value.chunks) || !value.chunks.length || value.chunks.length > 64) throw new Error('Ungültiges WASM-Manifest');
  let bytes = 0;
  for (const chunk of value.chunks) {
    if (!chunk || typeof chunk.url !== 'string' || !/^[\w.-]+$/.test(chunk.url) || chunk.url === '.' || chunk.url === '..' || !Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || chunk.bytes > 25 * 1024 * 1024 || typeof chunk.sha256 !== 'string' || !hashPattern.test(chunk.sha256)) throw new Error('Ungültiges WASM-Teilstück im Manifest');
    bytes += chunk.bytes;
  }
  if (bytes !== value.bytes) throw new Error('WASM-Manifest: Gesamtgröße stimmt nicht mit Teilstücken überein');
  return value as WasmManifest;
}
/** Assemble the bundled runtime, verifying every chunk and the complete binary before execution. */
export async function loadWasmRuntime(manifestUrl: URL, signal?: AbortSignal): Promise<Blob> {
  checkAbort(signal);
  const response = await readRuntimeFile(manifestUrl, signal);
  const manifest = checkedManifest(JSON.parse(new TextDecoder().decode(response.bytes))), bytes = new Uint8Array(manifest.bytes); let offset = 0;
  for (const chunk of manifest.chunks) {
    checkAbort(signal); const url = new URL(chunk.url, manifestUrl);
    const part = await readRuntimeFile(url, signal);
    const content = part.bytes; checkAbort(signal);
    if (content.byteLength !== chunk.bytes) throw new Error(`WASM-Teilstück ${chunk.url}: Länge ${content.byteLength} statt ${chunk.bytes}`);
    if (await sha256(content) !== chunk.sha256.toLowerCase()) throw new Error(`WASM-Teilstück ${chunk.url}: SHA-256 stimmt nicht überein`);
    checkAbort(signal); bytes.set(content, offset); offset += content.byteLength;
  }
  if (offset !== manifest.bytes || await sha256(bytes) !== manifest.sha256.toLowerCase()) throw new Error('WASM-Laufzeit: SHA-256 oder Gesamtlänge stimmt nicht überein');
  checkAbort(signal); return new Blob([bytes], { type: 'application/wasm' });
}
let queue: Promise<unknown> = Promise.resolve();
export async function withFFmpeg<T>(task: (ffmpeg: MediaProcessor) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => { release = r; });
  await previous.catch(() => undefined);
  const classic = hasBrowserRuntimeReader() || window.origin === 'null';
  const ff: MediaProcessor = classic ? new ClassicFFmpeg() : new FFmpeg();
  const abort = () => ff.terminate();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    checkAbort(signal);
    // A blob URL permits the same single-thread runtime inside an opaque-origin sandbox.
    const urls: string[] = [];
    const loadUrl = async (url: string, mime: string) => { const res = await readRuntimeFile(url, signal); const blob = new Blob([new Uint8Array(res.bytes)], { type: mime }); const objectUrl = URL.createObjectURL(blob); urls.push(objectUrl); return objectUrl; };
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    const guardedLoad = (options: Parameters<FFmpeg['load']>[0]) => Promise.race([ff.load(options), new Promise<never>((_, reject) => { loadTimer = setTimeout(() => { reject(new Error('FFmpeg-Runtime konnte nach 30 Sekunden nicht starten (Worker-CSP, CORS oder WASM)')); ff.terminate(); }, 30000); })]);
    try {
      const wasmBlob = await loadWasmRuntime(new URL(classic ? runtime.classicWasmURL : runtime.wasmURL, document.baseURI), signal), wasmUrl = URL.createObjectURL(wasmBlob); urls.push(wasmUrl);
      if (classic || new URL(runtime.classWorkerURL, document.baseURI).origin !== location.origin) await guardedLoad({ classWorkerURL: await loadUrl(runtime.classWorkerURL, 'text/javascript'), coreURL: await loadUrl(classic ? runtime.classicCoreURL : runtime.coreURL, 'text/javascript'), wasmURL: wasmUrl });
      else await guardedLoad({ classWorkerURL: new URL(runtime.classWorkerURL, document.baseURI).href, coreURL: new URL(runtime.coreURL, document.baseURI).href, wasmURL: wasmUrl });
    }
    finally { clearTimeout(loadTimer); for (const url of urls) URL.revokeObjectURL(url); }
    return await task(ff);
  } catch (error) {
    checkAbort(signal);
    if (error instanceof BrowserCapabilityError) throw error;
    throw new BrowserCapabilityError('ffmpeg-wasm', `Browser-Medienprozessor: ${error instanceof Error ? error.message : String(error)}. Runtime-Dateien /runtime/ffmpeg prüfen; große Exporte benötigen ausreichend Browser-Arbeitsspeicher.`);
  } finally { signal?.removeEventListener('abort', abort); ff.terminate(); release(); }
}
export async function transcodeBlob(blob: Blob, format: 'mp3' | 'm4a' | 'flac' | 'mov' | 'mp4', signal?: AbortSignal): Promise<Blob> {
  return withFFmpeg(async (ff) => {
    await ff.writeFile('input', new Uint8Array(await blob.arrayBuffer()));
    const audio = format === 'mp3' ? ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'] : format === 'm4a' ? ['-vn', '-c:a', 'aac', '-b:a', '192k'] : format === 'flac' ? ['-vn', '-c:a', 'flac'] : ['-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart'];
    const code = await ff.exec(['-i', 'input', ...audio, `output.${format}`]);
    if (code !== 0) throw new Error(`Codec ${format} nicht verfügbar (FFmpeg ${code})`);
    const bytes = await ff.readFile(`output.${format}`);
    if (typeof bytes === 'string') throw new Error('Kein binärer Export');
    return new Blob([new Uint8Array(bytes)], { type: format === 'mp3' ? 'audio/mpeg' : format === 'm4a' ? 'audio/mp4' : format === 'flac' ? 'audio/flac' : format === 'mov' ? 'video/quicktime' : 'video/mp4' });
  }, signal);
}
