import { configureBrowserRuntime, ownedRuntimePath, type RuntimeFile, type RuntimeFileReader } from '@studio/browser-media';
import type { DirectorHostBridge } from './hostBridge.ts';

export interface NativeRuntimeResponse { base64: string; mime: string; bytes: number; totalBytes: number; offset: number }
type RuntimeHost = Pick<DirectorHostBridge, 'request'>;
const CHUNK_BYTES = 262144;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
function abortCheck(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError'); }
async function requestChunk(host: RuntimeHost, path: string, offset: number, signal?: AbortSignal): Promise<NativeRuntimeResponse> {
  abortCheck(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); };
    const aborted = () => { cleanup(); reject(new DOMException('Abgebrochen', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Native Runtime-Datei: Host-Anfrage nach 60 Sekunden abgebrochen')); }, 60000);
    signal?.addEventListener('abort', aborted, { once: true });
    void host.request<NativeRuntimeResponse>(`/api/runtime-file?path=${encodeURIComponent(path)}&offset=${offset}&length=${CHUNK_BYTES}`).then((result) => { cleanup(); resolve(result); }, (error) => { cleanup(); reject(error); });
  });
}
/** Fetches no HTTP URL: each bounded byte range goes through the authenticated app-only MCP tool. */
export function createNativeRuntimeReader(host: RuntimeHost): RuntimeFileReader {
  const cache = new Map<string, RuntimeFile>();
  return async (raw, signal) => {
    const path = ownedRuntimePath(raw); abortCheck(signal);
    const cached = cache.get(path); if (cached) return cached;
    let output: Uint8Array | undefined, mime = '', offset = 0;
    do {
      const chunk = await requestChunk(host, path, offset, signal); abortCheck(signal);
      if (!Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes <= 0 || chunk.totalBytes > MAX_FILE_BYTES || chunk.offset !== offset || !Number.isSafeInteger(chunk.bytes) || chunk.bytes !== Math.min(CHUNK_BYTES, chunk.totalBytes - offset) || typeof chunk.mime !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.base64)) throw new Error('Native Runtime-Datei: ungültige Bereichsantwort');
      if (!output) { output = new Uint8Array(chunk.totalBytes); mime = chunk.mime; }
      if (output.byteLength !== chunk.totalBytes || chunk.mime !== mime) throw new Error('Native Runtime-Datei wurde während des Ladens verändert');
      const decoded = atob(chunk.base64); if (decoded.length !== chunk.bytes) throw new Error('Native Runtime-Datei: Byteanzahl stimmt nicht überein');
      for (let i = 0; i < decoded.length; i++) output[offset + i] = decoded.charCodeAt(i);
      offset += chunk.bytes;
    } while (offset < output.byteLength);
    abortCheck(signal); const file = { bytes: output, mime }; cache.set(path, file); return file;
  };
}
/** Install before rendering. Loading stays lazy and waits for the real native host handshake. */
export function installNativeRuntime(host: Pick<DirectorHostBridge, 'request' | 'connect' | 'getStatus'>): void {
  if (window.parent === window) return;
  const read = createNativeRuntimeReader(host);
  configureBrowserRuntime(async (path, signal) => {
    await host.connect(); abortCheck(signal);
    if (!host.getStatus().connected) throw new Error('Native Runtime: der Plugin-Host ist nicht verbunden');
    return read(path, signal);
  });
}
