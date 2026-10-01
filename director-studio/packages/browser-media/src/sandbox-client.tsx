import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { materializeAssets, blobToDataUrl } from './assets.ts';
import { mixTimelineAudio } from './audio.ts';
import { muxVideo } from './timeline.tsx';
import { BrowserCapabilityError, checkAbort, type ExportRequest, type ExportResult } from './types.ts';
import { hasBrowserRuntimeReader, loadMediaSandbox, ownedRuntimePath, readRuntimeFile } from './runtime.ts';

type SerializableRequest = Omit<ExportRequest, 'onProgress' | 'signal'>;
/** The MessagePort is a capability bound to one iframe. Window messages never trigger a render. */
export class MediaSandboxClient extends EventTarget {
  private port: MessagePort | null = null;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; progress?: ExportRequest['onProgress'] }>();
  private playing = false;
  private frame = 0;
  private ready: Promise<void>;
  private readyCleanup?: () => void;
  private readyReject?: (error: Error) => void;
  private runtimeAbort = new AbortController();
  constructor(readonly iframe: HTMLIFrameElement) {
    super();
    this.ready = new Promise((resolve, reject) => {
      this.readyReject = reject;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = () => reject(new BrowserCapabilityError('media-sandbox', 'Isolierte Medienvorschau konnte nach dem Laden der Laufzeit nicht starten. Native Host-Verbindung und Sandbox-CSP prüfen.'));
      // Native transfer has its own bounded/abortable host requests; the boot deadline starts
      // only when the complete srcdoc has loaded, independent of real host network latency.
      if (!hasBrowserRuntimeReader()) timer = setTimeout(timeout, 15000);
      const connect = () => {
        if (hasBrowserRuntimeReader() ? !iframe.hasAttribute('srcdoc') : !iframe.getAttribute('src')) return;
        iframe.removeEventListener('load', connect);
        clearTimeout(timer); timer = setTimeout(timeout, 15000);
        const channel = new MessageChannel(); this.port = channel.port1;
        this.port.onmessage = (event) => {
          const data = event.data;
          if (data?.type === 'runtime-file' && hasBrowserRuntimeReader()) {
            // A runtime-only capability: generated code never receives the editor's host bridge.
            void (async () => {
              try { const file = await readRuntimeFile(ownedRuntimePath(data.path), this.runtimeAbort.signal); const bytes = new Uint8Array(file.bytes); this.port?.postMessage({ type: 'runtime-file-result', id: data.id, bytes, mime: file.mime }, [bytes.buffer]); }
              catch (error) { this.port?.postMessage({ type: 'runtime-file-result', id: data.id, error: error instanceof Error ? error.message : String(error) }); }
            })();
          } else if (data?.type === 'ready') { clearTimeout(timer); resolve(); }
          else if (data?.type === 'event') {
            if (data.name === 'frameupdate' || data.name === 'seeked') this.frame = data.frame;
            if (data.name === 'play') this.playing = true;
            if (data.name === 'pause' || data.name === 'ended') this.playing = false;
            this.dispatchEvent(new CustomEvent(data.name, { detail: { frame: data.frame, message: data.message } }));
          } else if (data?.id && this.pending.has(data.id)) {
            const p = this.pending.get(data.id)!;
            if (data.type === 'progress') p.progress?.(data.phase, data.progress);
            else { this.pending.delete(data.id); data.type === 'error' ? p.reject(new Error(data.error)) : p.resolve(data.value); }
          }
        };
        iframe.contentWindow!.postMessage({ type: 'director-media-connect', runtimeBridge: hasBrowserRuntimeReader() }, '*', [channel.port2]);
      };
      iframe.addEventListener('load', connect); this.readyCleanup = () => { clearTimeout(timer); iframe.removeEventListener('load', connect); };
    }); void this.ready.catch(() => undefined);
  }
  async request<T>(method: string, request?: unknown, progress?: ExportRequest['onProgress'], signal?: AbortSignal): Promise<T> {
    checkAbort(signal);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { cleanup(); reject(new DOMException('Abgebrochen', 'AbortError')); };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true }); this.ready.then(() => { cleanup(); resolve(); }, (error) => { cleanup(); reject(error); });
    });
    checkAbort(signal); const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id); };
      const abort = () => { cleanup(); reject(new DOMException('Abgebrochen', 'AbortError')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Medienlauf ${method}: Zeitlimit überschritten. Job kann erneut gestartet werden.`)); }, method === 'preview' ? 120000 : 600000);
      this.pending.set(id, { resolve: (value) => { cleanup(); resolve(value as T); }, reject: (error) => { cleanup(); reject(error); }, progress });
      signal?.addEventListener('abort', abort, { once: true }); this.port!.postMessage({ id, method, request });
    });
  }
  async export(request: ExportRequest): Promise<ExportResult> {
    const serializable: SerializableRequest = { ...request, assets: await materializeAssets(request.document, request.assets, request.signal) }; delete (serializable as ExportRequest).onProgress; delete (serializable as ExportRequest).signal;
    return this.request<ExportResult>('export', serializable, request.onProgress, request.signal);
  }
  async preview(request: ExportRequest, playbackRate = 1): Promise<void> {
    const snapshot: SerializableRequest = { ...request, assets: await materializeAssets(request.document, request.assets, request.signal) }; delete (snapshot as ExportRequest).onProgress; delete (snapshot as ExportRequest).signal;
    if (request.document.kind !== 'timeline') throw new Error('Timeline erforderlich');
    // Codec workers run in the editor, where the static runtime has an ordinary origin. The
    // code sandbox receives only finished audio and media data; it never gains host access.
    const audio = await mixTimelineAudio(request.document, request.assets, { normalizeLufs: request.options?.normalizeLufs ?? -14, signal: request.signal });
    await this.request('preview', { ...snapshot, playbackRate, audioUrl: await blobToDataUrl(audio) }, undefined, request.signal);
  }
  private control(action: string, value?: number) { void this.ready.then(() => this.port?.postMessage({ method: 'control', request: { action, value } })); }
  play() { this.control('play'); } pause() { this.control('pause'); } toggle() { this.playing ? this.pause() : this.play(); }
  seekTo(frame: number) { this.frame = frame; this.control('seek', frame); } getCurrentFrame() { return this.frame; } isPlaying() { return this.playing; }
  mute() { this.control('mute'); } unmute() { this.control('unmute'); }
  dispose() { this.runtimeAbort.abort(); this.readyCleanup?.(); this.readyReject?.(new Error('Medienframe geschlossen')); this.port?.close(); for (const p of this.pending.values()) p.reject(new Error('Medienframe geschlossen')); this.pending.clear(); }
}
export async function exportInSandbox(request: ExportRequest, sandboxUrl = '/media-sandbox.html'): Promise<ExportResult> {
  // Chromium suspends requestAnimationFrame for offscreen iframes. Remotion needs animation
  // ticks even for a still export; keep a tiny inert processing surface inside the viewport.
  const frame = document.createElement('iframe'); frame.sandbox.add('allow-scripts'); frame.style.cssText = 'position:fixed;width:2px;height:2px;left:0;top:0;border:0;opacity:0.001;pointer-events:none';
  const client = new MediaSandboxClient(frame);
  try {
    await loadMediaSandbox(frame, sandboxUrl, request.signal); document.body.append(frame);
    if (request.document.kind === 'timeline' && (request.format === 'mp4' || request.format === 'mov')) {
      const audio = await mixTimelineAudio(request.document, request.assets, { normalizeLufs: request.options?.normalizeLufs ?? -14, sampleRate: request.options?.sampleRate, signal: request.signal, onProgress: request.onProgress });
      const visual = await client.export({ ...request, options: { ...request.options, visualOnly: true } });
      const blob = await muxVideo(visual.blob, audio, request.format, request.signal); return { ...visual, blob, mimeType: blob.type };
    }
    return await client.export(request);
  } finally { client.dispose(); frame.remove(); }
}
export const SandboxTimelinePreview = forwardRef<PlayerRef, { request: ExportRequest; sandboxUrl?: string; playbackRate?: number; style?: React.CSSProperties; onReady?: () => void; onError?: (error: Error) => void }>(function SandboxTimelinePreview({ request, sandboxUrl = '/media-sandbox.html', playbackRate = 1, style, onReady, onError }, ref) {
  const frame = useRef<HTMLIFrameElement>(null), client = useRef<MediaSandboxClient | null>(null), [ready, setReady] = useState(false);
  useImperativeHandle(ref, () => client.current as unknown as PlayerRef, [ready]);
  useEffect(() => { const c = new MediaSandboxClient(frame.current!); client.current = c; const abort = new AbortController(); let alive = true; void loadMediaSandbox(frame.current!, sandboxUrl, abort.signal).then(() => { if (alive) setReady(true); }).catch((error) => { if (alive) onError?.(error as Error); }); return () => { alive = false; abort.abort(); c.dispose(); client.current = null; setReady(false); }; }, [sandboxUrl]);
  useEffect(() => { if (!ready || !client.current) return; let alive = true; const abort = new AbortController(); const c = client.current; const fail = (event: Event) => { if (alive) onError?.(new Error((event as CustomEvent<{message?:string}>).detail?.message ?? 'Medium in der Vorschau nicht dekodierbar')); }; c.addEventListener('error', fail); void c.preview({ ...request, signal: abort.signal }, playbackRate).then(() => { if (alive) onReady?.(); }).catch((error) => { if (alive) onError?.(error as Error); }); return () => { alive = false; abort.abort(); c.removeEventListener('error', fail); }; }, [request, playbackRate, ready]);
  return <iframe ref={frame} title="Director media preview" sandbox="allow-scripts" allow="autoplay" style={{ border: 0, ...style }} />;
});
