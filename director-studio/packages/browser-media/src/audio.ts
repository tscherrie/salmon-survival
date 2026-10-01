import type { Timeline } from '@studio/core';
import type { AssetMedia } from '@studio/render/browser';
import { buildAudioMixGraph, clipContributesAudio } from '../../media/src/mix.ts';
import { fetchAsset } from './assets.ts';
import { decodeAudio } from './media.ts';
import { withFFmpeg } from './ffmpeg.ts';
import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { checkAbort, MediaRepairError } from './types.ts';

export interface Loudness { integratedLufs: number | null; truePeakDb: number | null; rangeLu: number | null }
function finite(value: unknown): number | null { const v = Number(value); return Number.isFinite(v) ? v : null; }
export function parseLoudness(log: string): Loudness & { raw?: Record<string, string> } {
  const blocks = log.match(/\{\s*"input_i"[\s\S]*?\}/g); const block = blocks?.at(-1);
  if (!block) return { integratedLufs: null, truePeakDb: null, rangeLu: null };
  const raw = JSON.parse(block) as Record<string, string>;
  return { integratedLufs: finite(raw.input_i), truePeakDb: finite(raw.input_tp), rangeLu: finite(raw.input_lra), raw };
}
export async function measureLoudness(blob: Blob, targetLufs = -14, signal?: AbortSignal): Promise<Loudness> {
  return withFFmpeg(async (ff) => {
    let logs = ''; ff.on('log', ({ message }) => { logs += `${message}\n`; }); await ff.writeFile('input', new Uint8Array(await blob.arrayBuffer()));
    const code = await ff.exec(['-i', 'input', '-vn', '-af', `loudnorm=I=${targetLufs}:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-']);
    if (code) throw new Error(`Lautheitsmessung ${code}`); return parseLoudness(logs);
  }, signal);
}
/** Two pass EBU R128 normalization; both passes use the real decoded mix. */
export async function normalizeAudio(blob: Blob, targetLufs = -14, signal?: AbortSignal): Promise<{ blob: Blob; measured: Loudness }> {
  return withFFmpeg(async (ff) => {
    let logs = ''; ff.on('log', ({ message }) => { logs += `${message}\n`; }); await ff.writeFile('input', new Uint8Array(await blob.arrayBuffer()));
    if (await ff.exec(['-i', 'input', '-vn', '-af', `loudnorm=I=${targetLufs}:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-'])) throw new Error('Lautheitsanalyse fehlgeschlagen');
    const measured = parseLoudness(logs), r = measured.raw;
    const filter = r && measured.integratedLufs !== null ? `loudnorm=I=${targetLufs}:TP=-1:LRA=11:measured_I=${r.input_i}:measured_TP=${r.input_tp}:measured_LRA=${r.input_lra}:measured_thresh=${r.input_thresh}:offset=${r.target_offset}:linear=true` : `alimiter=limit=0.891251:level=0`;
    if (await ff.exec(['-i', 'input', '-vn', '-af', filter, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', 'normal.wav'])) throw new Error('Normalisierung fehlgeschlagen');
    const bytes = await ff.readFile('normal.wav'); if (typeof bytes === 'string') throw new Error('Ungültiges Audio');
    return { blob: new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), measured };
  }, signal);
}
export async function mixTimelineAudio(timeline: Timeline, assets: Record<string, AssetMedia>, options: { sampleRate?: number; normalizeLufs?: number; signal?: AbortSignal; onProgress?: (phase: string, progress: number) => void } = {}): Promise<Blob> {
  if (timeline.durationFrames <= 0) throw new Error('Leere Timeline');
  const ids = [...new Set(timeline.tracks.filter((t) => !t.muted).flatMap((t) => t.clips.filter((c) => clipContributesAudio(t, c)).map((c) => c.assetId).filter((id): id is string => !!id)))];
  const missing = ids.filter((id) => !assets[id]); if (missing.length) throw new MediaRepairError(missing.map((assetId) => ({ assetId, reason: 'Audio-Asset fehlt' })));
  const blobs = new Map<string, Blob>(), silentIds = new Set<string>();
  for (const id of ids) {
    checkAbort(options.signal); const blob = await fetchAsset(assets[id]!, options.signal); blobs.set(id, blob);
    if (assets[id]!.kind === 'video') {
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      try { if ((await input.getAudioTracks()).length === 0) silentIds.add(id); }
      catch (error) { throw new MediaRepairError([{ assetId: id, reason: `Tonspuren nicht lesbar: ${String(error)}` }]); }
      finally { input.dispose(); }
    }
  }
  const mix = await withFFmpeg(async (ff) => {
    const paths = new Map<string, string>(); for (const [id, blob] of blobs) { const filename = `asset-${paths.size}`; paths.set(id, filename); await ff.writeFile(filename, new Uint8Array(await blob.arrayBuffer())); }
    const graph = buildAudioMixGraph(timeline, (id) => paths.get(id), { sampleRate: options.sampleRate, silentPaths: new Set([...silentIds].map((id) => paths.get(id)!)) });
    if (graph.warnings.some((w) => /kein Asset|nicht auffindbar/.test(w))) throw new MediaRepairError(graph.warnings.map((reason) => ({ assetId: '', reason })));
    const args = graph.inputs.flatMap((i) => ['-ss', String(i.seekSec), '-t', String(i.durationSec), '-i', i.path]);
    ff.on('progress', ({ progress }) => options.onProgress?.('Audiomix', progress));
    if (await ff.exec([...args, '-filter_complex', graph.filterComplex, '-map', `[${graph.outputLabel}]`, '-ar', String(graph.sampleRate), '-c:a', 'pcm_s16le', 'mix.wav'])) throw new Error('Audiomix fehlgeschlagen; Originalton und Quellformate prüfen');
    const bytes = await ff.readFile('mix.wav'); if (typeof bytes === 'string') throw new Error('Ungültiges Audio'); return new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
  }, options.signal);
  return options.normalizeLufs === undefined ? mix : (await normalizeAudio(mix, options.normalizeLufs, options.signal)).blob;
}
export interface AudioAnalysis {
  durationMs: number; sampleRate: number; channels: number; peaks: number[]; rmsDb: number; samplePeakDb: number;
  beats: number[]; bpm: number | null; loudness: Loudness;
}
/** Waveform and onset estimates are labelled estimates; loudness is measured with EBU R128. */
export async function analyzeAudio(blob: Blob, options: { buckets?: number; measureLufs?: boolean; signal?: AbortSignal } = {}): Promise<AudioAnalysis> {
  const buffer = await decodeAudio(blob, 48000, options.signal), channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const buckets = Math.max(1, Math.min(options.buckets ?? 2000, buffer.length)), block = Math.ceil(buffer.length / buckets), peaks: number[] = [];
  let sumSquares = 0, peak = 0;
  for (let from = 0; from < buffer.length; from += block) { let lo = 1, hi = -1; for (let i = from; i < Math.min(from + block, buffer.length); i++) for (const c of channels) { const v = c[i]!; lo = Math.min(lo, v); hi = Math.max(hi, v); sumSquares += v * v; peak = Math.max(peak, Math.abs(v)); } peaks.push(lo, hi); }
  const hop = Math.max(1, Math.round(buffer.sampleRate * 0.02)), energies: number[] = [];
  for (let from = 0; from < buffer.length; from += hop) { let energy = 0; for (let i = from; i < Math.min(from + hop, buffer.length); i++) { const v = channels[0]![i]!; energy += v * v; } energies.push(energy / hop); }
  const beats: number[] = []; let last = -Infinity;
  for (let i = 2; i < energies.length - 1; i++) { const baseline = energies.slice(Math.max(0, i - 25), i).reduce((a, b) => a + b, 0) / Math.min(i, 25); const time = i * hop / buffer.sampleRate; if (energies[i]! > Math.max(1e-5, baseline * 1.7) && energies[i]! > energies[i - 1]! && energies[i]! >= energies[i + 1]! && time - last > 0.2) { beats.push(time); last = time; } }
  const intervals = beats.slice(1).map((t, i) => t - beats[i]!).filter((d) => d < 2).sort((a, b) => a - b); const interval = intervals[Math.floor(intervals.length / 2)];
  return { durationMs: buffer.duration * 1000, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, peaks, rmsDb: 10 * Math.log10(Math.max(1e-12, sumSquares / (buffer.length * buffer.numberOfChannels))), samplePeakDb: 20 * Math.log10(Math.max(1e-12, peak)), beats, bpm: interval ? Math.round(60 / interval) : null, loudness: options.measureLufs === false ? { integratedLufs: null, truePeakDb: null, rangeLu: null } : await measureLoudness(blob, -14, options.signal) };
}
