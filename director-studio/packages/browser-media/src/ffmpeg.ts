import { FFmpeg } from '@ffmpeg/ffmpeg';
import { BrowserCapabilityError, checkAbort } from './types.ts';

let runtime = { coreURL: '/runtime/ffmpeg/ffmpeg-core.js', wasmURL: '/runtime/ffmpeg/ffmpeg-core.wasm', classWorkerURL: '/runtime/ffmpeg/worker.js' };
/** The app ships these runtime assets on its own origin. No credential or CDN dependency. */
export function configureMediaRuntime(value: Partial<typeof runtime>): void { runtime = { ...runtime, ...value }; }
let queue: Promise<unknown> = Promise.resolve();
export async function withFFmpeg<T>(task: (ffmpeg: FFmpeg) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => { release = r; });
  await previous.catch(() => undefined);
  const ff = new FFmpeg();
  const abort = () => ff.terminate();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    checkAbort(signal);
    // A blob URL permits the same single-thread runtime inside an opaque-origin sandbox.
    const urls: string[] = [];
    const loadUrl = async (url: string, mime: string) => { const res = await fetch(new URL(url, document.baseURI), { credentials: 'omit', signal }); if (!res.ok) throw new Error(`Runtime ${res.status}`); const blob = new Blob([await res.arrayBuffer()], { type: mime }); const objectUrl = URL.createObjectURL(blob); urls.push(objectUrl); return objectUrl; };
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    const guardedLoad = (options: Parameters<FFmpeg['load']>[0]) => Promise.race([ff.load(options), new Promise<never>((_, reject) => { loadTimer = setTimeout(() => { ff.terminate(); reject(new Error('FFmpeg-Runtime konnte nach 30 Sekunden nicht starten (Worker-CSP, CORS oder WASM)')); }, 30000); })]);
    try {
      if (window.origin === 'null' || new URL(runtime.classWorkerURL, document.baseURI).origin !== location.origin) await guardedLoad({ classWorkerURL: await loadUrl(runtime.classWorkerURL, 'text/javascript'), coreURL: await loadUrl(runtime.coreURL, 'text/javascript'), wasmURL: await loadUrl(runtime.wasmURL, 'application/wasm') });
      else await guardedLoad({ classWorkerURL: new URL(runtime.classWorkerURL, document.baseURI).href, coreURL: new URL(runtime.coreURL, document.baseURI).href, wasmURL: new URL(runtime.wasmURL, document.baseURI).href });
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
