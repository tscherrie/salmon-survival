import { FFT, nextPowerOfTwo } from './fft.ts';

export interface OffsetEstimate {
  /** Versatz in ms; positiv = `test` kommt später als `reference`. */
  offsetMs: number;
  /** 0..1 aus Höhe und Schärfe des Korrelationsmaximums. */
  confidence: number;
  /** Pearson-Korrelation am Maximum (−1..1). */
  correlation: number;
}

/** Ab dieser Rechenmenge (Überlappung × Lags) wird die Kreuzkorrelation per FFT berechnet. */
const DIRECT_LIMIT = 4_000_000;

/**
 * Schätzt den Versatz zwischen zwei gleich abgetasteten Signalen per normierter
 * Kreuzkorrelation (Pearson je Lag über den Überlappungsbereich) mit
 * Parabel-Interpolation für Sub-Sample-Genauigkeit.
 *
 * Konvention: `test[t] ≈ reference[t − lag]` → `offsetMs = lag / rateHz · 1000` (positiv = test verspätet).
 * Die Konfidenz kombiniert die Korrelationshöhe mit dem Abstand zum besten Nebenmaximum
 * außerhalb der Hauptkeule (mehrdeutige, periodische Signale → niedrige Konfidenz).
 */
export function estimateOffset(reference: Float32Array, test: Float32Array, rateHz: number, maxLagMs: number): OffsetEstimate {
  if (!(rateHz > 0) || !Number.isFinite(rateHz)) throw new Error(`Ungültige Abtastrate: ${rateHz}`);
  if (!(maxLagMs >= 0) || !Number.isFinite(maxLagMs)) throw new Error(`Ungültiger maximaler Versatz: ${maxLagMs}`);
  const nr = reference.length;
  const nt = test.length;
  const none: OffsetEstimate = { offsetMs: 0, confidence: 0, correlation: 0 };
  if (nr < 4 || nt < 4) return none;

  const x = centered(reference);
  const y = centered(test);
  const minOverlap = Math.max(4, Math.floor(0.25 * Math.min(nr, nt)));
  const requested = Math.round((maxLagMs * rateHz) / 1000);
  // Gültige Lags: Überlappung n(L) = min(nr, nt − L) − max(0, −L) ≥ minOverlap.
  const lagHi = Math.min(requested, nt - minOverlap);
  const lagLo = Math.max(-requested, minOverlap - nr);
  if (lagHi < lagLo) return none;
  const count = lagHi - lagLo + 1;

  const px = prefix(x);
  const pxx = prefixSquares(x);
  const py = prefix(y);
  const pyy = prefixSquares(y);
  const sxy = crossSums(x, y, lagLo, lagHi);

  const r = new Float64Array(count).fill(Number.NaN);
  for (let i = 0; i < count; i++) {
    const lag = lagLo + i;
    const t0 = Math.max(0, -lag);
    const t1 = Math.min(nr, nt - lag);
    const n = t1 - t0;
    if (n < minOverlap) continue;
    const sx = px[t1]! - px[t0]!;
    const sxx = pxx[t1]! - pxx[t0]!;
    const sy = py[t1 + lag]! - py[t0 + lag]!;
    const syy = pyy[t1 + lag]! - pyy[t0 + lag]!;
    const cov = sxy[i]! - (sx * sy) / n;
    const vx = sxx - (sx * sx) / n;
    const vy = syy - (sy * sy) / n;
    if (vx <= 1e-12 * n || vy <= 1e-12 * n) continue;
    r[i] = Math.max(-1, Math.min(1, cov / Math.sqrt(vx * vy)));
  }

  let best = -1;
  for (let i = 0; i < count; i++) {
    if (!Number.isNaN(r[i]!) && (best < 0 || r[i]! > r[best]!)) best = i;
  }
  if (best < 0) return none;
  const peak = r[best]!;

  // Sub-Sample-Verfeinerung per Parabel durch die Nachbarn.
  let delta = 0;
  const left = best > 0 ? r[best - 1]! : Number.NaN;
  const right = best < count - 1 ? r[best + 1]! : Number.NaN;
  if (!Number.isNaN(left) && !Number.isNaN(right)) {
    const denom = left - 2 * peak + right;
    if (denom < 0) delta = Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denom));
  }

  // Hauptkeule: vom Maximum aus abwärts laufen, solange die Korrelation fällt.
  let lobeL = best;
  while (lobeL > 0 && !Number.isNaN(r[lobeL - 1]!) && r[lobeL - 1]! <= r[lobeL]!) lobeL--;
  let lobeR = best;
  while (lobeR < count - 1 && !Number.isNaN(r[lobeR + 1]!) && r[lobeR + 1]! <= r[lobeR]!) lobeR++;
  let secondary = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    if ((i < lobeL || i > lobeR) && !Number.isNaN(r[i]!)) secondary = Math.max(secondary, r[i]!);
  }
  if (secondary === Number.NEGATIVE_INFINITY) {
    // Ganze Suchbreite ist eine Keule: Ränder als Vergleich.
    secondary = Math.max(Number.isNaN(r[0]!) ? -1 : r[0]!, Number.isNaN(r[count - 1]!) ? -1 : r[count - 1]!);
  }

  let confidence = 0;
  if (peak > 0) {
    const prominence = (peak - Math.max(0, secondary)) / peak;
    confidence = clamp01(peak) * clamp01(2 * prominence);
  }
  // Maximum am Rand der Suchbreite: echter Versatz liegt evtl. außerhalb.
  const atEdge = (best === 0 && lagLo === -requested) || (best === count - 1 && lagHi === requested);
  if (atEdge) confidence *= 0.5;

  const lag = lagLo + best + delta;
  return {
    offsetMs: round3((lag / rateHz) * 1000),
    confidence: round3(confidence),
    correlation: round3(peak),
  };
}

/** Σ_t x[t]·y[t+L] über den Überlappungsbereich, für L in [lagLo, lagHi]. */
function crossSums(x: Float64Array, y: Float64Array, lagLo: number, lagHi: number): Float64Array {
  const nr = x.length;
  const nt = y.length;
  const count = lagHi - lagLo + 1;
  const out = new Float64Array(count);
  if (count * Math.min(nr, nt) <= DIRECT_LIMIT) {
    for (let i = 0; i < count; i++) {
      const lag = lagLo + i;
      const t0 = Math.max(0, -lag);
      const t1 = Math.min(nr, nt - lag);
      let s = 0;
      for (let t = t0; t < t1; t++) s += x[t]! * y[t + lag]!;
      out[i] = s;
    }
    return out;
  }
  const size = nextPowerOfTwo(nr + nt);
  const fft = new FFT(size);
  const ar = new Float64Array(size);
  const ai = new Float64Array(size);
  const br = new Float64Array(size);
  const bi = new Float64Array(size);
  ar.set(x);
  br.set(y);
  fft.transform(ar, ai);
  fft.transform(br, bi);
  // conj(A)·B → Kreuzkorrelation c[L] = Σ x[t]·y[t+L]
  for (let k = 0; k < size; k++) {
    const re = ar[k]! * br[k]! + ai[k]! * bi[k]!;
    const im = ar[k]! * bi[k]! - ai[k]! * br[k]!;
    ar[k] = re;
    ai[k] = im;
  }
  fft.transform(ar, ai, true);
  for (let i = 0; i < count; i++) {
    const lag = lagLo + i;
    out[i] = ar[lag >= 0 ? lag : size + lag]!;
  }
  return out;
}

function centered(values: Float32Array): Float64Array {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]!;
  const mean = sum / values.length;
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    out[i] = Number.isFinite(v) ? v - mean : 0;
  }
  return out;
}

function prefix(values: Float64Array): Float64Array {
  const out = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) out[i + 1] = out[i]! + values[i]!;
  return out;
}

function prefixSquares(values: Float64Array): Float64Array {
  const out = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) out[i + 1] = out[i]! + values[i]! * values[i]!;
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
