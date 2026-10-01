import type { BeatAnalysis } from '../types.ts';
import { FFT, hannWindow } from './fft.ts';
import { movingAverage } from './signal.ts';

/**
 * Beat-/Tempo-Analyse in reinem JS:
 * 1. Onset-Hüllkurve per Spectral Flux (STFT, logarithmisch komprimierte Beträge, ~100 Hz).
 * 2. Tempo per Autokorrelation der Hüllkurve mit log-Gauß-Gewichtung um 120 BPM
 *    (Bevorzugung 70–180 BPM über Oktavfaltung).
 * 3. Beat-Tracking per dynamischer Programmierung (Ellis 2007).
 * 4. Downbeats = jeder 4. Beat in der Phase mit der stärksten Betonung (Tiefton-gewichtet).
 */

const ENVELOPE_RATE_HZ = 100;
/** Log-Kompression der Beträge: log(1 + γ·|X|). */
const LOG_GAMMA = 1000;
/** DP-Strenge (librosa: tightness). */
const TIGHTNESS = 100;
const MIN_BPM = 40;
const MAX_BPM = 240;
const PREFERRED_MIN_BPM = 70;
const PREFERRED_MAX_BPM = 180;
/** Obergrenze des Tieftonbands für die Downbeat-Betonung. */
const LOW_BAND_HZ = 200;
/**
 * Spectral Flux meldet Einsätze systematisch zu früh, weil das Fenster vorausgreift;
 * Korrektur als Anteil der Fensterlänge (empirisch an Klick-/Rausch-Impulsen kalibriert).
 */
const ONSET_LATENCY_FACTOR = 0.2;

export interface OnsetEnvelope {
  /** Spectral-Flux-Werte je Frame (≥ 0). */
  values: Float64Array;
  /** Spectral Flux nur im Tieftonbereich (< 200 Hz: Bassdrum, Bass) – Grundlage der Downbeat-Betonung. */
  low: Float64Array;
  /** Frames pro Sekunde (sampleRate / hop). */
  rateHz: number;
  /** Zeit (s) des Frame-Mittelpunkts von Frame 0. */
  offsetSec: number;
}

/** Fensterlänge: größte Zweierpotenz ≤ 50 ms (also 25–50 ms). */
export function onsetFrameSize(sampleRate: number): number {
  return 2 ** Math.max(6, Math.floor(Math.log2(0.05 * sampleRate)));
}

/**
 * Spectral-Flux-Onset-Hüllkurve (zentrierte Frames, Hann-Fenster, ~100 Hz).
 * Zwei reelle Frames werden gemeinsam in einer komplexen FFT berechnet.
 */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): OnsetEnvelope {
  if (!(sampleRate > 0)) throw new Error(`Ungültige Abtastrate: ${sampleRate}`);
  const frameSize = onsetFrameSize(sampleRate);
  const hop = Math.max(1, Math.round(sampleRate / ENVELOPE_RATE_HZ));
  const half = frameSize / 2;
  const frames = Math.floor(samples.length / hop) + 1;
  const fft = new FFT(frameSize);
  const window = hannWindow(frameSize);
  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);
  const bins = frameSize / 2 + 1;
  const prev = new Float64Array(bins);
  const magA = new Float64Array(bins);
  const magB = new Float64Array(bins);
  // Sinus mit Amplitude A → Betrag ≈ A; der Faktor 1/2 stammt aus der Trennung der Frame-Paare.
  const scale = 2 / frameSize;
  const values = new Float64Array(frames);
  const low = new Float64Array(frames);
  const lowBins = Math.max(2, Math.ceil((LOW_BAND_HZ * frameSize) / sampleRate));

  const fill = (target: Float64Array, frame: number) => {
    const start = frame * hop - half;
    for (let k = 0; k < frameSize; k++) {
      const idx = start + k;
      target[k] = idx >= 0 && idx < samples.length ? samples[idx]! * window[k]! : 0;
    }
  };
  const flux = (mags: Float64Array, frame: number) => {
    let sum = 0;
    let lowSum = 0;
    for (let k = 0; k < bins; k++) {
      const v = Math.log1p(LOG_GAMMA * mags[k]!);
      if (frame > 0) {
        const d = v - prev[k]!;
        if (d > 0) {
          sum += d;
          if (k > 0 && k <= lowBins) lowSum += d;
        }
      }
      prev[k] = v;
    }
    values[frame] = sum;
    low[frame] = lowSum;
  };

  for (let f = 0; f < frames; f += 2) {
    const pair = f + 1 < frames;
    fill(re, f);
    if (pair) fill(im, f + 1);
    else im.fill(0);
    fft.transform(re, im);
    // Z = A + iB → A[k] = (Z[k] + conj(Z[N−k]))/2, B[k] = (Z[k] − conj(Z[N−k]))/(2i)
    for (let k = 0; k < bins; k++) {
      const nk = (frameSize - k) % frameSize;
      const zr = re[k]!;
      const zi = im[k]!;
      const cr = re[nk]!;
      const ci = -im[nk]!;
      const ar = zr + cr;
      const ai = zi + ci;
      const br = zi - ci;
      const bi = cr - zr;
      magA[k] = Math.sqrt(ar * ar + ai * ai) * scale;
      magB[k] = Math.sqrt(br * br + bi * bi) * scale;
    }
    flux(magA, f);
    if (pair) flux(magB, f + 1);
  }
  // Flux erreicht sein Maximum, bevor der Einsatz die Fenstermitte erreicht (≈ 0,2 × Fensterlänge).
  return { values, low, rateHz: sampleRate / hop, offsetSec: ONSET_LATENCY_FACTOR * (frameSize / sampleRate) };
}

/** Beat-Analyse eines Mono-Signals. */
export function detectBeatsFromPcm(samples: Float32Array, sampleRate: number): BeatAnalysis {
  const empty: BeatAnalysis = { bpm: 0, beats: [], downbeats: [], onsets: [], confidence: 0 };
  if (samples.length === 0) return empty;
  const env = onsetEnvelope(samples, sampleRate);
  const o = env.values;
  const rate = env.rateHz;
  const frameToSec = (f: number) => Math.max(0, f / rate + env.offsetSec);

  let maxO = 0;
  for (let i = 0; i < o.length; i++) maxO = Math.max(maxO, o[i]!);
  if (maxO < 1e-6) return empty;

  const onsets = pickOnsets(o, rate).map((f) => round3(frameToSec(refinePeak(o, f, 0))));
  const durationSec = samples.length / sampleRate;
  if (durationSec < 2) return { ...empty, onsets };

  // Normierte Hüllkurve (Standardabweichung 1) für Tempo und DP.
  const norm = normalizeByStd(o);
  const tempo = estimateTempo(norm, rate);
  if (!tempo) return { ...empty, onsets };

  const period = tempo.periodFrames;
  const local = localScore(norm, period);
  const beatFrames = trackBeats(local, period);
  if (beatFrames.length < 2) return { ...empty, onsets, confidence: 0 };

  const refined = beatFrames.map((f) => refinePeak(local, f));
  const beats = refined.map((f) => round3(frameToSec(f)));

  const bpm = beats.length >= 4 ? tempoFromBeats(beats) ?? 60 / (period / rate) : 60 / (period / rate);

  // Downbeats: Phase (mod 4) mit der stärksten mittleren Betonung an den Beats.
  // Betonung = Tiefton-Flux (Bassdrum/Bass, Gewicht 1) + Breitband-Flux (Gewicht 0,5), je auf das Maximum normiert.
  const lowMax = maxOf(env.low) || 1;
  const accents = beatFrames.map((f) => {
    let broad = 0;
    let lowPeak = 0;
    for (let d = -2; d <= 2; d++) {
      const v = o[f + d];
      if (v !== undefined && v > broad) broad = v;
      const l = env.low[f + d];
      if (l !== undefined && l > lowPeak) lowPeak = l;
    }
    return lowPeak / lowMax + (0.5 * broad) / maxO;
  });
  let bestPhase = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let phase = 0; phase < 4; phase++) {
    let sum = 0;
    let n = 0;
    for (let i = phase; i < accents.length; i += 4) {
      sum += accents[i]!;
      n++;
    }
    const score = n ? sum / n : Number.NEGATIVE_INFINITY;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  const downbeats = beats.filter((_, i) => i % 4 === bestPhase);

  return {
    bpm: Math.round(bpm * 100) / 100,
    beats,
    downbeats,
    onsets,
    confidence: round3(Math.max(0, Math.min(1, tempo.strength))),
  };
}

function maxOf(values: Float64Array): number {
  let m = 0;
  for (let i = 0; i < values.length; i++) if (values[i]! > m) m = values[i]!;
  return m;
}

function normalizeByStd(values: Float64Array): Float64Array {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]!;
  const mean = sum / values.length;
  let sq = 0;
  for (let i = 0; i < values.length; i++) sq += (values[i]! - mean) ** 2;
  const std = Math.sqrt(sq / Math.max(1, values.length - 1)) || 1;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i]! / std;
  return out;
}

/** Tempo per gewichteter Autokorrelation; liefert Periode in Frames (Sub-Frame genau) und Stärke 0..1. */
function estimateTempo(env: Float64Array, rate: number): { periodFrames: number; strength: number } | undefined {
  const n = env.length;
  // Gleitenden Mittelwert (≈ 1 s) abziehen: entfernt Gleichanteil und langsame Lautstärkeverläufe.
  const trend = movingAverage(env, Math.round(rate / 2));
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = env[i]! - trend[i]!;
  const minLag = Math.max(1, Math.floor((60 / MAX_BPM) * rate));
  const maxLag = Math.min(n - 2, Math.ceil((60 / MIN_BPM) * rate));
  if (maxLag <= minLag + 2) return undefined;
  const acLimit = Math.min(n - 2, 2 * maxLag + 2);
  const ac = new Float64Array(acLimit + 1);
  for (let lag = 0; lag <= acLimit; lag++) {
    let s = 0;
    for (let t = 0; t + lag < n; t++) s += x[t]! * x[t + lag]!;
    // Unverzerrte Schätzung: kürzere Überlappung bei großen Lags ausgleichen.
    ac[lag] = s / (n - lag);
  }
  const ac0 = ac[0]!;
  if (!(ac0 > 0)) return undefined;
  for (let lag = 0; lag <= acLimit; lag++) ac[lag] = ac[lag]! / ac0;

  const at = (lag: number) => (lag >= 0 && lag <= acLimit ? ac[lag]! : 0);
  const tau0 = (60 / 120) * rate;
  let bestLag = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Nur lokale Maxima der Autokorrelation sind Kandidaten.
    if (!(at(lag) >= at(lag - 1) && at(lag) >= at(lag + 1))) continue;
    const weight = Math.exp(-0.5 * Math.log2(lag / tau0) ** 2);
    // Harmonische Verstärkung (Ellis 2007, TPS2): Puls auch bei doppelter Periode.
    const enhanced = at(lag) + 0.5 * at(2 * lag) + 0.25 * at(2 * lag - 1) + 0.25 * at(2 * lag + 1);
    const score = weight * enhanced;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || at(bestLag) <= 0) return undefined;

  // Bevorzugten Bereich 70–180 BPM per Oktavfaltung erreichen, wenn die Autokorrelation es trägt.
  let lag = bestLag;
  const bpmOf = (l: number) => (60 * rate) / l;
  while (bpmOf(lag) < PREFERRED_MIN_BPM) {
    const cand = nearestPeak(at, Math.round(lag / 2), 2);
    if (cand < minLag || at(cand) <= 0.1 * at(lag)) break;
    lag = cand;
  }
  while (bpmOf(lag) > PREFERRED_MAX_BPM) {
    const cand = nearestPeak(at, lag * 2, 2);
    if (cand > acLimit - 1 || at(cand) <= 0.1 * at(lag)) break;
    lag = cand;
  }

  // Parabel-Interpolation für Sub-Frame-Periode.
  const a = at(lag - 1);
  const b = at(lag);
  const c = at(lag + 1);
  const denom = a - 2 * b + c;
  const delta = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return { periodFrames: lag + delta, strength: b };
}

function nearestPeak(at: (lag: number) => number, center: number, radius: number): number {
  let best = center;
  for (let l = center - radius; l <= center + radius; l++) if (at(l) > at(best)) best = l;
  return best;
}

/** Lokaler Score: normierte Hüllkurve, mit schmalem Gauß (σ = Periode/32) geglättet (wie librosa). */
function localScore(env: Float64Array, period: number): Float64Array {
  const half = Math.max(1, Math.round(period));
  const kernel = new Float64Array(2 * half + 1);
  for (let i = -half; i <= half; i++) kernel[i + half] = Math.exp(-0.5 * ((i * 32) / period) ** 2);
  const out = new Float64Array(env.length);
  for (let t = 0; t < env.length; t++) {
    let s = 0;
    const from = Math.max(0, t - half);
    const to = Math.min(env.length - 1, t + half);
    for (let u = from; u <= to; u++) s += env[u]! * kernel[u - t + half]!;
    out[t] = s;
  }
  return out;
}

/** Beat-Tracking per dynamischer Programmierung (Ellis 2007). Liefert Frame-Indizes. */
function trackBeats(local: Float64Array, period: number): number[] {
  const n = local.length;
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const maxLagBack = Math.round(2 * period);
  const minLagBack = Math.max(1, Math.round(period / 2));
  let localMax = 0;
  for (let i = 0; i < n; i++) localMax = Math.max(localMax, local[i]!);
  const txwt = new Float64Array(maxLagBack + 1);
  for (let lag = minLagBack; lag <= maxLagBack; lag++) txwt[lag] = -TIGHTNESS * Math.log(lag / period) ** 2;

  let firstBeat = true;
  for (let i = 0; i < n; i++) {
    let bestVal = Number.NEGATIVE_INFINITY;
    let bestPrev = -1;
    for (let lag = minLagBack; lag <= maxLagBack; lag++) {
      const prev = i - lag;
      // Vor dem Anfang: nur die Übergangsgewichtung (kumulierter Score 0).
      const val = txwt[lag]! + (prev >= 0 ? cum[prev]! : 0);
      if (val > bestVal) {
        bestVal = val;
        bestPrev = prev;
      }
    }
    cum[i] = local[i]! + bestVal;
    if (firstBeat && local[i]! < 0.01 * localMax) {
      back[i] = -1;
    } else {
      back[i] = bestPrev;
      firstBeat = false;
    }
  }

  // Letzter Beat: spätestes lokales Maximum des kumulierten Scores über dem halben Median.
  const maxima: number[] = [];
  for (let i = 0; i < n; i++) {
    const l = i > 0 ? cum[i - 1]! : Number.NEGATIVE_INFINITY;
    const r = i < n - 1 ? cum[i + 1]! : Number.NEGATIVE_INFINITY;
    if (cum[i]! > l && cum[i]! >= r) maxima.push(i);
  }
  if (maxima.length === 0) return [];
  const sorted = maxima.map((i) => cum[i]!).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  let last = maxima[maxima.length - 1]!;
  for (let k = maxima.length - 1; k >= 0; k--) {
    if (2 * cum[maxima[k]!]! > median) {
      last = maxima[k]!;
      break;
    }
  }

  const beats: number[] = [];
  for (let b = last; b >= 0; b = back[b]!) {
    beats.push(b);
    if (back[b]! >= b) break;
  }
  beats.reverse();

  // Schwache Beats am Anfang/Ende entfernen (Stille, Ein-/Ausklang).
  if (beats.length === 0) return beats;
  let sq = 0;
  for (const b of beats) sq += local[b]! ** 2;
  const threshold = 0.5 * Math.sqrt(sq / beats.length);
  let from = 0;
  let to = beats.length;
  while (from < to && local[beats[from]!]! < threshold) from++;
  while (to > from && local[beats[to - 1]!]! < threshold) to--;
  return beats.slice(from, to);
}

/** Parabel-Interpolation um ein lokales Maximum (Sub-Frame); sucht vorher ±`radius` Frames nach dem Maximum. */
function refinePeak(values: Float64Array, f: number, radius = 2): number {
  let best = f;
  for (let d = -radius; d <= radius; d++) {
    const v = values[f + d];
    if (v !== undefined && v > values[best]!) best = f + d;
  }
  const a = values[best - 1];
  const b = values[best]!;
  const c = values[best + 1];
  if (a === undefined || c === undefined) return best;
  const denom = a - 2 * b + c;
  if (denom >= 0) return best;
  return best + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
}

/** Tempo aus Beat-Zeiten: lineare Regression über (Beat-Index, Zeit); Lücken zählen als mehrere Beats. */
function tempoFromBeats(beats: number[]): number | undefined {
  const ibis: number[] = [];
  for (let i = 1; i < beats.length; i++) ibis.push(beats[i]! - beats[i - 1]!);
  const sorted = [...ibis].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  if (!(median > 0)) return undefined;
  const idx: number[] = [0];
  for (let i = 1; i < beats.length; i++) idx.push(idx[i - 1]! + Math.max(1, Math.round(ibis[i - 1]! / median)));
  const n = beats.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += idx[i]!;
    sy += beats[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (idx[i]! - mx) * (beats[i]! - my);
    sxx += (idx[i]! - mx) ** 2;
  }
  if (!(sxx > 0)) return undefined;
  const slope = sxy / sxx;
  return slope > 0 ? 60 / slope : undefined;
}

/** Onset-Peaks nach librosa-Art (lokales Maximum, über gleitendem Mittel + δ, Mindestabstand). */
function pickOnsets(o: Float64Array, rate: number): number[] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < o.length; i++) {
    min = Math.min(min, o[i]!);
    max = Math.max(max, o[i]!);
  }
  const range = max - min;
  if (!(range > 0)) return [];
  const x = new Float64Array(o.length);
  for (let i = 0; i < o.length; i++) x[i] = (o[i]! - min) / range;
  const preMax = Math.max(1, Math.round(0.03 * rate));
  const postMax = 1;
  const preAvg = Math.max(1, Math.round(0.1 * rate));
  const postAvg = Math.max(1, Math.round(0.1 * rate)) + 1;
  const wait = Math.max(1, Math.round(0.03 * rate));
  const delta = 0.07;
  const prefix = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) prefix[i + 1] = prefix[i]! + x[i]!;
  const out: number[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < x.length; i++) {
    const v = x[i]!;
    let isMax = true;
    for (let j = Math.max(0, i - preMax); j <= Math.min(x.length - 1, i + postMax); j++) {
      if (x[j]! > v) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    const a = Math.max(0, i - preAvg);
    const b = Math.min(x.length, i + postAvg);
    const avg = (prefix[b]! - prefix[a]!) / (b - a);
    if (v < avg + delta) continue;
    if (i - last <= wait) continue;
    out.push(i);
    last = i;
  }
  return out;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
