import { BrowserCapabilityError, checkAbort, type MediaProbe } from './types.ts';
import { withFFmpeg } from './ffmpeg.ts';

export async function decodeAudio(blob: Blob, sampleRate = 48000, signal?: AbortSignal): Promise<AudioBuffer> {
  checkAbort(signal);
  const ctx = new AudioContext({ sampleRate });
  try { const decoded = await ctx.decodeAudioData(await blob.arrayBuffer()); checkAbort(signal); return decoded; }
  catch {
    const wav = await withFFmpeg(async (ff) => { await ff.writeFile('input', new Uint8Array(await blob.arrayBuffer())); const code = await ff.exec(['-i', 'input', '-vn', '-ac', '2', '-ar', String(sampleRate), '-c:a', 'pcm_s16le', 'decoded.wav']); if (code) throw new Error('Audio nicht dekodierbar'); const bytes = await ff.readFile('decoded.wav'); if (typeof bytes === 'string') throw new Error('Ungültiges Audio'); return new Uint8Array(bytes).buffer; }, signal);
    const decoded = await ctx.decodeAudioData(wav); checkAbort(signal); return decoded;
  } finally { await ctx.close(); }
}
function waitEvent(target: EventTarget, event: string, timeout = 15000, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const finish = () => done(), fail = () => done(new Error('Medium nicht dekodierbar')), abort = () => done(new DOMException('Abgebrochen', 'AbortError'));
    const timer = setTimeout(() => done(new Error(`Zeitlimit: ${event}`)), timeout);
    const done = (error?: Error) => { clearTimeout(timer); target.removeEventListener(event, finish); target.removeEventListener('error', fail); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    target.addEventListener(event, finish, { once: true }); target.addEventListener('error', fail, { once: true }); signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function probeMedia(blob: Blob, signal?: AbortSignal): Promise<MediaProbe> {
  checkAbort(signal);
  if (blob.type.startsWith('image/')) {
    const image = await createImageBitmap(blob);
    const result: MediaProbe = { kind: 'image', mime: blob.type, bytes: blob.size, width: image.width, height: image.height }; image.close(); return result;
  }
  const url = URL.createObjectURL(blob);
  const el = document.createElement(blob.type.startsWith('audio/') ? 'audio' : 'video'); el.preload = 'metadata';
  try { const ready = waitEvent(el, 'loadedmetadata', 15000, signal); el.src = url; await ready; return { kind: el instanceof HTMLVideoElement && el.videoWidth ? 'video' : 'audio', mime: blob.type, bytes: blob.size, durationMs: Number.isFinite(el.duration) ? el.duration * 1000 : undefined, ...(el instanceof HTMLVideoElement && el.videoWidth ? { width: el.videoWidth, height: el.videoHeight } : {}) }; }
  catch { checkAbort(signal); const audio = await decodeAudio(blob, 48000, signal); return { kind: 'audio', mime: blob.type, bytes: blob.size, durationMs: audio.duration * 1000, channels: audio.numberOfChannels, sampleRate: audio.sampleRate }; }
  finally { el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); }
}
export async function frames(blob: Blob, options: { times: number[]; width?: number; signal?: AbortSignal }): Promise<Array<{ time: number; blob: Blob }>> {
  const video = document.createElement('video'); video.muted = true; video.preload = 'auto'; video.playsInline = true;
  const url = URL.createObjectURL(blob); const out: Array<{ time: number; blob: Blob }> = [];
  try {
    const ready = waitEvent(video, 'loadeddata', 15000, options.signal); video.src = url; await ready;
    const width = Math.min(options.width ?? video.videoWidth, video.videoWidth), height = Math.round(width * video.videoHeight / video.videoWidth);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d')!;
    for (const requested of options.times) {
      checkAbort(options.signal); const time = Math.max(0, Math.min(requested, Math.max(0, video.duration - 0.001)));
      if (Math.abs(video.currentTime - time) > 0.0001) { const seeked = waitEvent(video, 'seeked', 15000, options.signal); video.currentTime = time; await seeked; }
      ctx.drawImage(video, 0, 0, width, height); out.push({ time, blob: await canvasBlob(canvas) });
    }
    return out;
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
export function canvasBlob(canvas: HTMLCanvasElement, mime = 'image/png', quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new BrowserCapabilityError('canvas-encode', `Bildformat ${mime} nicht verfügbar`)), mime, quality));
}
export async function contactSheet(blob: Blob, options: { count?: number; columns?: number; tileWidth?: number; signal?: AbortSignal } = {}): Promise<Blob> {
  const probe = await probeMedia(blob, options.signal), count = Math.min(100, Math.max(1, options.count ?? 12)), columns = Math.max(1, options.columns ?? 4), width = options.tileWidth ?? 240;
  const extracted = await frames(blob, { times: Array.from({ length: count }, (_, i) => ((probe.durationMs ?? 0) / 1000) * i / count), width, signal: options.signal });
  const height = Math.round(width * (probe.height ?? 9) / (probe.width ?? 16));
  const canvas = document.createElement('canvas'); canvas.width = width * columns; canvas.height = (height + 24) * Math.ceil(count / columns); const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111318'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.font = '14px monospace';
  for (const [i, frame] of extracted.entries()) { const bitmap = await createImageBitmap(frame.blob); const x = (i % columns) * width, y = Math.floor(i / columns) * (height + 24); ctx.drawImage(bitmap, x, y, width, height); bitmap.close(); ctx.fillStyle = '#fff'; ctx.fillText(`${frame.time.toFixed(2)}s`, x + 6, y + height + 17); }
  return canvasBlob(canvas);
}
/** PCM WAV, interoperable with every export codec. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Blob {
  if (!channels.length || channels.some((c) => c.length !== channels[0]!.length)) throw new Error('Ungleiche Audiokanäle');
  const samples = channels[0]!.length, bytes = new Uint8Array(44 + samples * channels.length * 2), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels.length * 2, true); view.setUint16(32, channels.length * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < samples; i++) for (let c = 0; c < channels.length; c++) { const sample = Math.max(-1, Math.min(1, channels[c]![i]!)); view.setInt16(44 + (i * channels.length + c) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true); }
  return new Blob([bytes], { type: 'audio/wav' });
}
export async function cutAudio(blob: Blob, options: { start: number; end: number; sampleRate?: number; signal?: AbortSignal }): Promise<Blob> {
  const buffer = await decodeAudio(blob, options.sampleRate, options.signal); if (options.start < 0 || options.end <= options.start || options.end > buffer.duration + 0.01) throw new Error('Ungültiger Audioabschnitt');
  return encodeWav(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(Math.round(options.start * buffer.sampleRate), Math.round(options.end * buffer.sampleRate))), buffer.sampleRate);
}
