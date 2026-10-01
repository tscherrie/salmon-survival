import type { Clip, Timeline, Track } from '@studio/core';
import { filterValue, num } from './ffmpeg-syntax.ts';

/**
 * Übersetzt eine Timeline in einen ffmpeg-`filter_complex`-Graphen für den Audiomix
 * („render-to-preview“: Vorschau und Export hören dasselbe).
 *
 * Pro Clip: Eingabe mit `-ss`/`-t` (Quell-Ausschnitt ab `clip.in`), Resampling auf Stereo,
 * Tempo per `atempo`-Kette, Gain (Clip + Spur), Fades (`afade`), samplegenauer Zuschnitt,
 * Verzögerung auf die Timeline-Position (`adelay`). Pro Spur: Summe der Clips (`amix`,
 * `normalize=0`). Ducking per `sidechaincompress`. Master: `amix` + `alimiter`.
 */

export interface AudioMixInput {
  path: string;
  /** Startposition in der Quelle (s), wird als `-ss` vor `-i` übergeben. */
  seekSec: number;
  /** Zu lesende Quelldauer (s), wird als `-t` vor `-i` übergeben. */
  durationSec: number;
  clipId: string;
  trackId: string;
}

export interface AudioMixGraph {
  inputs: AudioMixInput[];
  filterComplex: string;
  /** Label des Ausgangs (ohne Klammern), für `-map [label]`. */
  outputLabel: string;
  durationSec: number;
  sampleRate: number;
  /** Exakte Länge der Ausgabe in Samples. */
  totalSamples: number;
  /** Hinweise zu übersprungenen Clips/Spuren (deutsch). */
  warnings: string[];
}

export interface AudioMixOptions {
  /** Abtastrate des Mixes (Standard 48000). */
  sampleRate?: number;
  /** Bereich in Timeline-Ticks; Ausgabe beginnt bei `fromFrame` (Standard 0 bis Timeline-Ende). */
  fromFrame?: number;
  toFrame?: number;
  /**
   * `clips` (Standard): Spur wird um genau `duck.db` abgesenkt, solange auf der Schlüsselspur
   * Clips liegen (Schlüsselsignal aus den Clip-Bereichen, deterministisch).
   * `signal`: der tatsächliche Pegel der Schlüsselspur steuert den Kompressor (Absenkung ≈ `duck.db`).
   */
  ducking?: 'clips' | 'signal';
  /** Dateien ohne Audiospur; ihre Clips werden übersprungen. */
  silentPaths?: ReadonlySet<string>;
  /** Abschließender Limiter (Standard true, −1 dBFS). */
  limiter?: boolean;
}

/** Ducking-Parameter (Engineering-Defaults). */
export const DUCKING = {
  /** Ratio des Kompressors (Maximum von sidechaincompress). */
  ratio: 20,
  /** Absenkung beginnt so viel vor dem Clip der Schlüsselspur (s). */
  leadSec: 0.15,
  /** Lücken unter dieser Dauer (s) werden überbrückt, damit die Musik nicht „pumpt“. */
  mergeGapSec: 0.5,
  attackMs: 200,
  releaseMs: 1200,
  /** Annahme für den Pegel einer Stimme im Modus `signal` (dBFS RMS). */
  assumedKeyLevelDb: -20,
  /** Größte erreichbare Absenkung (Schwellwert-Untergrenze von sidechaincompress). */
  maxDb: 57,
} as const;

const LIMIT_LINEAR = 0.891251; // −1 dBFS
/** Zusätzliche Quelldauer, damit Rundung nie die letzten Samples abschneidet (wird exakt zugeschnitten). */
const READ_MARGIN_SEC = 0.1;

export function buildAudioMixGraph(
  timeline: Timeline,
  resolveAssetPath: (assetId: string) => string | undefined,
  opts: AudioMixOptions = {},
): AudioMixGraph {
  const fps = timeline.fps;
  if (!(fps > 0)) throw new Error(`Ungültige Timeline-Rate: ${fps}`);
  const sr = Math.round(opts.sampleRate ?? 48000);
  if (!(sr >= 8000 && sr <= 384000)) throw new Error(`Ungültige Abtastrate: ${sr}`);

  const contentEndFrame = timeline.tracks.reduce((m, t) => t.clips.reduce((mm, c) => Math.max(mm, c.start + c.duration), m), 0);
  const endFrame = timeline.durationFrames > 0 ? timeline.durationFrames : contentEndFrame;
  const from = clampNum(opts.fromFrame ?? 0, 0, endFrame);
  const to = clampNum(opts.toFrame ?? endFrame, 0, endFrame);
  if (to < from) throw new Error(`Ungültiger Bereich: toFrame (${to}) liegt vor fromFrame (${from})`);

  const sampleAt = (frame: number) => Math.round(((frame - from) / fps) * sr);
  const totalSamples = sampleAt(to);
  const durationSec = (to - from) / fps;
  const warnings: string[] = [];
  const inputs: AudioMixInput[] = [];
  const chains: string[] = [];
  const outputLabel = 'mix';

  interface Bus {
    track: Track;
    label: string;
  }
  const buses: Bus[] = [];

  timeline.tracks.forEach((track, trackIndex) => {
    if (track.kind !== 'audio') return;
    if (track.muted) return;
    const clipLabels: string[] = [];
    const clips = [...track.clips].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (const clip of clips) {
      const clipEnd = clip.start + clip.duration;
      if (clipEnd <= from || clip.start >= to) continue;
      if (!clip.assetId) {
        warnings.push(`Clip "${clip.id}" auf Spur "${track.id}" hat kein Asset – übersprungen.`);
        continue;
      }
      const path = resolveAssetPath(clip.assetId);
      if (!path) {
        warnings.push(`Clip "${clip.id}": Asset "${clip.assetId}" nicht auffindbar – übersprungen.`);
        continue;
      }
      if (opts.silentPaths?.has(path)) {
        warnings.push(`Clip "${clip.id}": Asset "${clip.assetId}" hat keine Audiospur – übersprungen.`);
        continue;
      }
      const visStart = Math.max(clip.start, from);
      const visEnd = Math.min(clipEnd, to);
      const outStart = sampleAt(visStart);
      const lenSamples = sampleAt(visEnd) - outStart;
      if (lenSamples <= 0) continue;

      const plan = planClip(clip, fps, sr, visStart, lenSamples, track.gainDb);
      const inputIndex = inputs.length;
      inputs.push({ path, seekSec: plan.seekSec, durationSec: plan.readSec, clipId: clip.id, trackId: track.id });
      const filters = [
        `aresample=${sr}`,
        'aformat=sample_fmts=fltp:channel_layouts=stereo',
        ...atempoChain(plan.speed).map((f) => `atempo=${num(f)}`),
        ...(plan.gainDb !== 0 ? [`volume=${num(plan.gainDb, 3)}dB`] : []),
        `apad=whole_len=${plan.preSamples + lenSamples}`,
        ...(plan.fadeIn ? [`afade=t=in:st=${num(plan.fadeIn.st)}:d=${num(plan.fadeIn.d)}`] : []),
        ...(plan.fadeOut ? [`afade=t=out:st=${num(plan.fadeOut.st)}:d=${num(plan.fadeOut.d)}`] : []),
        `atrim=start_sample=${plan.preSamples}:end_sample=${plan.preSamples + lenSamples}`,
        'asetpts=PTS-STARTPTS',
        ...(outStart > 0 ? [`adelay=delays=${outStart}S:all=1`] : []),
      ];
      const label = `c${inputIndex}`;
      chains.push(`[${inputIndex}:a:0]${filters.join(',')}[${label}]`);
      clipLabels.push(label);
    }
    if (clipLabels.length === 0) return;
    const busLabel = `b${trackIndex}`;
    const pad = `apad=whole_len=${totalSamples},atrim=end_sample=${totalSamples}`;
    if (clipLabels.length === 1) chains.push(`[${clipLabels[0]}]${pad}[${busLabel}]`);
    else chains.push(`${clipLabels.map((l) => `[${l}]`).join('')}amix=inputs=${clipLabels.length}:normalize=0:duration=longest,${pad}[${busLabel}]`);
    buses.push({ track, label: busLabel });
  });

  // ── Ducking ──
  const mode = opts.ducking ?? 'clips';
  const finalLabels = new Map<Track, string>(buses.map((b) => [b.track, b.label]));
  const signalKeys = new Map<string, Array<{ ducked: Track }>>();
  const duckPlans: Array<{ bus: Bus; keyTrack: Track; db: number; viaSignal: boolean }> = [];
  for (const bus of buses) {
    const duck = bus.track.duck;
    if (!duck || !(duck.db < 0)) continue;
    const keyTrack = timeline.tracks.find((t) => t.id === duck.byTrackId);
    if (!keyTrack) {
      warnings.push(`Ducking von Spur "${bus.track.id}": Schlüsselspur "${duck.byTrackId}" existiert nicht.`);
      continue;
    }
    if (keyTrack === bus.track || keyTrack.muted) continue;
    const db = Math.max(-DUCKING.maxDb, duck.db);
    const keyBus = buses.find((b) => b.track === keyTrack);
    const viaSignal = mode === 'signal' && !!keyBus;
    if (mode === 'signal' && !keyBus) {
      warnings.push(`Ducking von Spur "${bus.track.id}": Spur "${keyTrack.id}" liefert kein Audio – Clip-Bereiche als Schlüssel verwendet.`);
    }
    if (viaSignal) {
      const list = signalKeys.get(keyTrack.id) ?? [];
      list.push({ ducked: bus.track });
      signalKeys.set(keyTrack.id, list);
    }
    duckPlans.push({ bus, keyTrack, db, viaSignal });
  }

  // Schlüsselspuren im Modus `signal` aufteilen (eine Kopie für den Mix, je eine pro geduckter Spur).
  const signalKeyLabels = new Map<Track, string>();
  for (const [keyId, users] of signalKeys) {
    const keyBus = buses.find((b) => b.track.id === keyId)!;
    const outs = [`${keyBus.label}m`, ...users.map((_, i) => `${keyBus.label}k${i}`)];
    chains.push(`[${keyBus.label}]asplit=${outs.length}${outs.map((o) => `[${o}]`).join('')}`);
    finalLabels.set(keyBus.track, outs[0]!);
    users.forEach((u, i) => signalKeyLabels.set(u.ducked, outs[i + 1]!));
  }

  for (const plan of duckPlans) {
    const { bus, keyTrack, db, viaSignal } = plan;
    const trackIndex = timeline.tracks.indexOf(bus.track);
    let keyLabel: string;
    let keyLevelDb: number;
    if (viaSignal) {
      keyLabel = signalKeyLabels.get(bus.track)!;
      keyLevelDb = DUCKING.assumedKeyLevelDb;
    } else {
      const ranges = keyRanges(keyTrack, from, to, fps, durationSec);
      if (ranges.length === 0) continue;
      const expr = ranges.map(([a, b]) => `between(t,${num(a)},${num(b)})`).join('+');
      keyLabel = `k${trackIndex}`;
      keyLevelDb = 0; // Schlüssel = Gleichspannung 1,0 (0 dBFS RMS)
      chains.push(`aevalsrc=exprs=${filterValue(expr)}:c=stereo:s=${sr}:d=${num(durationSec + 1)},atrim=end_sample=${totalSamples}[${keyLabel}]`);
    }
    // Absenkung = (Pegel − Schwelle)·(1 − 1/ratio) → Schwelle so wählen, dass genau |db| herauskommt.
    const thresholdDb = keyLevelDb + db / (1 - 1 / DUCKING.ratio);
    const threshold = Math.max(0.000976563, Math.min(1, 10 ** (thresholdDb / 20)));
    const attack = viaSignal ? 20 : DUCKING.attackMs;
    const release = viaSignal ? 400 : DUCKING.releaseMs;
    const out = `d${trackIndex}`;
    chains.push(
      `[${finalLabels.get(bus.track)!}][${keyLabel}]sidechaincompress=threshold=${num(threshold)}:ratio=${DUCKING.ratio}:attack=${attack}:release=${release}:knee=1:detection=rms:link=maximum:makeup=1[${out}]`,
    );
    finalLabels.set(bus.track, out);
  }

  // ── Master ──
  const finals = buses.map((b) => finalLabels.get(b.track)!);
  const tail = [
    ...(opts.limiter === false ? [] : [`alimiter=limit=${LIMIT_LINEAR}:attack=5:release=50:level=0:latency=1`]),
    `apad=whole_len=${totalSamples}`,
    `atrim=end_sample=${totalSamples}`,
  ].join(',');
  if (finals.length === 0) {
    chains.push(`anullsrc=r=${sr}:cl=stereo,atrim=end_sample=${totalSamples}[${outputLabel}]`);
  } else if (finals.length === 1) {
    chains.push(`[${finals[0]}]${tail}[${outputLabel}]`);
  } else {
    chains.push(`${finals.map((l) => `[${l}]`).join('')}amix=inputs=${finals.length}:normalize=0:duration=longest,${tail}[${outputLabel}]`);
  }

  return { inputs, filterComplex: chains.join(';'), outputLabel, durationSec, sampleRate: sr, totalSamples, warnings };
}

interface ClipPlan {
  speed: number;
  gainDb: number;
  seekSec: number;
  readSec: number;
  /** Samples zwischen Dekodierbeginn und sichtbarem Anfang (werden per atrim verworfen). */
  preSamples: number;
  fadeIn?: { st: number; d: number };
  fadeOut?: { st: number; d: number };
}

/**
 * Plant einen Clip in clip-lokaler Timeline-Zeit τ (0 = Clipanfang):
 * Dekodiert wird ab τ = a (0, falls der sichtbare Teil im Fade-in beginnt), damit Fades
 * korrekt verlaufen, wenn nur ein Ausschnitt gerendert wird.
 */
function planClip(clip: Clip, fps: number, sr: number, visStartFrame: number, lenSamples: number, trackGainDb: number | undefined): ClipPlan {
  const speed = clip.speed > 0 ? clip.speed : 1;
  const L = clip.duration / fps;
  const skip = (visStartFrame - clip.start) / fps;
  const visSec = lenSamples / sr;
  const fi = Math.min(L, Math.max(0, (clip.fadeInFrames ?? 0) / fps));
  const fo = Math.min(L, Math.max(0, (clip.fadeOutFrames ?? 0) / fps));
  let a = skip;
  if (fi > 0 && skip < fi) a = 0;
  if (fo > 0 && a > L - fo) a = Math.max(0, L - fo);
  const preSamples = Math.max(0, Math.round((skip - a) * sr));
  const plan: ClipPlan = {
    speed,
    gainDb: (clip.gainDb ?? 0) + (trackGainDb ?? 0),
    seekSec: round6((clip.in ?? 0) / fps + a * speed),
    readSec: round6((skip - a + visSec) * speed + READ_MARGIN_SEC * speed),
    preSamples,
  };
  if (fi > 0 && a === 0) plan.fadeIn = { st: 0, d: fi };
  if (fo > 0 && skip + visSec > L - fo) plan.fadeOut = { st: Math.max(0, L - fo - a), d: fo };
  return plan;
}

/** Zerlegt einen Tempo-Faktor in `atempo`-Stufen im sicheren Bereich 0,5–2. */
export function atempoChain(speed: number): number[] {
  if (!(speed > 0) || !Number.isFinite(speed)) throw new Error(`Ungültige Geschwindigkeit: ${speed}`);
  if (Math.abs(speed - 1) < 1e-9) return [];
  const out: number[] = [];
  let s = speed;
  while (s > 2) {
    out.push(2);
    s /= 2;
  }
  while (s < 0.5) {
    out.push(0.5);
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-9) out.push(round6(s));
  return out;
}

/** Bereiche (s, relativ zum Renderbeginn), in denen die Schlüsselspur Clips hat – mit Vorlauf, Lücken überbrückt. */
export function keyRanges(keyTrack: Track, from: number, to: number, fps: number, durationSec: number): Array<[number, number]> {
  const raw = keyTrack.clips
    .filter((c) => c.start < to && c.start + c.duration > from)
    .map((c) => [(c.start - from) / fps - DUCKING.leadSec, (c.start + c.duration - from) / fps] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of raw) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] < DUCKING.mergeGapSec) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged
    .map(([a, b]) => [Math.max(0, a), Math.min(durationSec, b)] as [number, number])
    .filter(([a, b]) => b > a)
    .map(([a, b]) => [round6(a), round6(b)]);
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
