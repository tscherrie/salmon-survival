import type { FFmpeg, LogEventCallback, ProgressEventCallback } from '@ffmpeg/ffmpeg';
import { checkAbort } from './types.ts';

export type MediaProcessor = Pick<FFmpeg, 'load' | 'exec' | 'ffprobe' | 'writeFile' | 'readFile' | 'on' | 'off' | 'terminate'>;
/** Chromium opaque frames support classic Blob workers; module Blob workers fail their origin check. */
export class ClassicFFmpeg implements MediaProcessor {
  private worker?: Worker;
  private serial = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private logs = new Set<LogEventCallback>();
  private progress = new Set<ProgressEventCallback>();
  private send<T>(type: string, data: unknown, signal?: AbortSignal, transfers: Transferable[] = []): Promise<T> {
    checkAbort(signal); if (!this.worker) return Promise.reject(new Error('FFmpeg-Worker ist nicht gestartet'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener('abort', aborted); this.pending.delete(id); };
      const aborted = () => { cleanup(); reject(new DOMException('Abgebrochen', 'AbortError')); };
      this.pending.set(id, { resolve: (value) => { cleanup(); resolve(value as T); }, reject: (error) => { cleanup(); reject(error); } });
      signal?.addEventListener('abort', aborted, { once: true });
      try { this.worker!.postMessage({ id, type, data }, transfers); } catch (error) { cleanup(); reject(error); }
    });
  }
  load: MediaProcessor['load'] = async ({ classWorkerURL, ...config } = {}, { signal } = {}) => {
    if (!classWorkerURL) throw new Error('Eigene klassische FFmpeg-Worker-Datei fehlt');
    this.worker = new Worker(classWorkerURL);
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'LOG') { for (const callback of this.logs) callback(data.data); return; }
      if (data.type === 'PROGRESS') { for (const callback of this.progress) callback(data.data); return; }
      const pending = this.pending.get(data.id); if (!pending) return;
      data.type === 'ERROR' ? pending.reject(new Error(String(data.data))) : pending.resolve(data.data);
    };
    this.worker.onerror = (event) => { const error = new Error(`Klassischer FFmpeg-Worker konnte nicht starten: ${event.message || 'Worker-CSP oder Script-Laufzeit prüfen'}`); for (const pending of this.pending.values()) pending.reject(error); this.worker?.terminate(); this.worker = undefined; };
    return this.send<boolean>('LOAD', config, signal);
  };
  exec: MediaProcessor['exec'] = (args, timeout = -1, { signal } = {}) => this.send<number>('EXEC', { args, timeout }, signal);
  ffprobe: MediaProcessor['ffprobe'] = (args, timeout = -1, { signal } = {}) => this.send<number>('FFPROBE', { args, timeout }, signal);
  writeFile: MediaProcessor['writeFile'] = (path, data, { signal } = {}) => { const copy = typeof data === 'string' ? data : new Uint8Array(data); return this.send<boolean>('WRITE_FILE', { path, data: copy }, signal, typeof copy === 'string' ? [] : [copy.buffer]); };
  readFile: MediaProcessor['readFile'] = (path, encoding = 'binary', { signal } = {}) => this.send<Uint8Array | string>('READ_FILE', { path, encoding }, signal);
  on(event: 'log', callback: LogEventCallback): void;
  on(event: 'progress', callback: ProgressEventCallback): void;
  on(event: 'log' | 'progress', callback: LogEventCallback | ProgressEventCallback): void { if (event === 'log') this.logs.add(callback as LogEventCallback); else this.progress.add(callback as ProgressEventCallback); }
  off(event: 'log', callback: LogEventCallback): void;
  off(event: 'progress', callback: ProgressEventCallback): void;
  off(event: 'log' | 'progress', callback: LogEventCallback | ProgressEventCallback): void { if (event === 'log') this.logs.delete(callback as LogEventCallback); else this.progress.delete(callback as ProgressEventCallback); }
  terminate(): void { this.worker?.terminate(); this.worker = undefined; for (const pending of this.pending.values()) pending.reject(new Error('FFmpeg-Worker beendet')); this.pending.clear(); }
}
