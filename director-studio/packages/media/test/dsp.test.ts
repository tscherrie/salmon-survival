import { describe, expect, it } from 'vitest';
import {
  FFT,
  PeakAccumulator,
  atempoChain,
  detectBeatsFromPcm,
  estimateOffset,
  movingAverage,
  resampleLinear,
  rmsEnvelope,
} from '../src/index.ts';
import { clickTrackPcm, drumPatternPcm, mean, seededRandom } from './helpers.ts';

/** Geglättetes Rauschen (zufällige, nicht periodische Struktur). */
function smoothNoise(n: number, seed: number, radius = 3): Float32Array {
  const rand = seededRandom(seed);
  const raw = Array.from({ length: n }, () => rand() * 2 - 1);
  const smoothed = movingAverage(raw, radius);
  return Float32Array.from(smoothed);
}

/** test[t] = ref[t − lag] (+ Rauschen) → positiver Lag = Test verspätet. */
function shifted(ref: Float32Array, lag: number, noise: number, seed: number): Float32Array {
  const rand = seededRandom(seed);
  const out = new Float32Array(ref.length);
  for (let t = 0; t < ref.length; t++) {
    const src = t - lag;
    const a = Math.floor(src);
    const f = src - a;
    const va = ref[Math.min(Math.max(a, 0), ref.length - 1)]!;
    const vb = ref[Math.min(Math.max(a + 1, 0), ref.length - 1)]!;
    out[t] = va + (vb - va) * f + noise * (rand() * 2 - 1);
  }
  return out;
}

describe('FFT', () => {
  it('stimmt mit der naiven DFT überein und invertiert sauber', () => {
    const n = 64;
    const rand = seededRandom(7);
    const xr = Float64Array.from({ length: n }, () => rand() - 0.5);
    const xi = Float64Array.from({ length: n }, () => rand() - 0.5);
    const re = xr.slice();
    const im = xi.slice();
    const fft = new FFT(n);
    fft.transform(re, im);
    for (const k of [0, 1, 5, 31, 32, 63]) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n;
        sr += xr[t]! * Math.cos(a) - xi[t]! * Math.sin(a);
        si += xr[t]! * Math.sin(a) + xi[t]! * Math.cos(a);
      }
      expect(re[k]).toBeCloseTo(sr, 9);
      expect(im[k]).toBeCloseTo(si, 9);
    }
    fft.transform(re, im, true);
    for (let t = 0; t < n; t++) {
      expect(re[t]).toBeCloseTo(xr[t]!, 12);
      expect(im[t]).toBeCloseTo(xi[t]!, 12);
    }
    expect(() => new FFT(100)).toThrow(/Zweierpotenz/);
  });
});

describe('estimateOffset', () => {
  const rate = 100; // 10 ms je Sample

  it('findet positive Verzögerung auf ±1 Sample genau', () => {
    const ref = smoothNoise(1500, 1);
    const test = shifted(ref, 7, 0.02, 2);
    const r = estimateOffset(ref, test, rate, 500);
    expect(Math.abs(r.offsetMs - 70)).toBeLessThanOrEqual(10);
    expect(r.confidence).toBeGreaterThan(0.7);
    expect(r.correlation).toBeGreaterThan(0.9);
  });

  it('findet negative Verzögerung (Test zu früh)', () => {
    const ref = smoothNoise(1500, 3);
    const test = shifted(ref, -12, 0.02, 4);
    const r = estimateOffset(ref, test, rate, 500);
    expect(Math.abs(r.offsetMs + 120)).toBeLessThanOrEqual(10);
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('löst Bruchteile eines Samples per Parabel-Interpolation auf', () => {
    const ref = smoothNoise(2000, 5, 4);
    const r = estimateOffset(ref, shifted(ref, 3.5, 0, 6), rate, 300);
    expect(Math.abs(r.offsetMs - 35)).toBeLessThanOrEqual(5);
  });

  it('nutzt für große Eingaben die FFT-Korrelation mit identischem Ergebnis', () => {
    const ref = smoothNoise(20000, 8);
    const test = shifted(ref, -250, 0.05, 9);
    const r = estimateOffset(ref, test, 1000, 2000); // 4001 Lags × 20000 → FFT-Pfad
    expect(Math.abs(r.offsetMs + 250)).toBeLessThanOrEqual(1);
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('meldet bei unabhängigem Rauschen niedrige Konfidenz', () => {
    const a = smoothNoise(1000, 11, 1);
    const b = smoothNoise(1000, 12, 1);
    const r = estimateOffset(a, b, rate, 500);
    expect(r.confidence).toBeLessThan(0.3);
  });

  it('meldet bei periodischen (mehrdeutigen) Signalen niedrige Konfidenz', () => {
    const period = 20;
    const ref = Float32Array.from({ length: 1000 }, (_, t) => Math.sin((2 * Math.PI * t) / period));
    const test = shifted(ref, 5, 0, 1);
    const r = estimateOffset(ref, test, rate, 1000);
    expect(r.confidence).toBeLessThan(0.3);
  });

  it('liefert 0/0 für konstante oder zu kurze Signale', () => {
    expect(estimateOffset(new Float32Array(500).fill(1), smoothNoise(500, 1), rate, 200)).toEqual({ offsetMs: 0, confidence: 0, correlation: 0 });
    expect(estimateOffset(new Float32Array(2), new Float32Array(2), rate, 200).confidence).toBe(0);
    expect(() => estimateOffset(new Float32Array(10), new Float32Array(10), 0, 100)).toThrow();
  });
});

describe('detectBeatsFromPcm', () => {
  const sr = 16000;

  it('erkennt 120 BPM (±2), Beat-Abstand ≈ 0,5 s und Downbeats an der Betonung', () => {
    const pcm = clickTrackPcm({ bpm: 120, durationSec: 16, sampleRate: sr, offsetSec: 0.25, accentIndex: 1, noise: 0.005 });
    const r = detectBeatsFromPcm(pcm, sr);
    expect(Math.abs(r.bpm - 120)).toBeLessThanOrEqual(2);
    expect(r.beats.length).toBeGreaterThanOrEqual(28);
    const ibis = r.beats.slice(1).map((b, i) => b - r.beats[i]!);
    expect(Math.abs(mean(ibis) - 0.5)).toBeLessThan(0.01);
    for (const ibi of ibis) expect(Math.abs(ibi - 0.5)).toBeLessThan(0.03);
    // Beats liegen auf den Klicks (±15 ms)
    for (const b of r.beats) {
      const k = Math.round((b - 0.25) / 0.5);
      expect(Math.abs(b - (0.25 + k * 0.5))).toBeLessThan(0.015);
    }
    // Betonung auf jedem 4. Klick ab Index 1 → 0,75 s, 2,75 s, …
    expect(r.downbeats.length).toBeGreaterThanOrEqual(6);
    for (const d of r.downbeats) {
      const k = Math.round((d - 0.25) / 0.5);
      expect(k % 4).toBe(1);
    }
    const dbi = r.downbeats.slice(1).map((d, i) => d - r.downbeats[i]!);
    for (const x of dbi) expect(Math.abs(x - 2)).toBeLessThan(0.05);
    expect(r.onsets.length).toBeGreaterThanOrEqual(30);
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  it('erkennt andere Tempi und faltet 200 BPM in den bevorzugten Bereich', () => {
    const at90 = detectBeatsFromPcm(clickTrackPcm({ bpm: 90, durationSec: 14, sampleRate: sr }), sr);
    expect(Math.abs(at90.bpm - 90)).toBeLessThanOrEqual(2);
    const at200 = detectBeatsFromPcm(clickTrackPcm({ bpm: 200, durationSec: 12, sampleRate: sr }), sr);
    expect(Math.abs(at200.bpm - 100)).toBeLessThanOrEqual(2);
  });

  it('erkennt ein Schlagzeug-Pattern (128 BPM) und legt Downbeats auf die Bassdrum', () => {
    const offset = 0.1;
    const period = 60 / 128;
    const r = detectBeatsFromPcm(drumPatternPcm({ bpm: 128, durationSec: 16, sampleRate: sr, offsetSec: offset }), sr);
    expect(Math.abs(r.bpm - 128)).toBeLessThanOrEqual(2);
    for (const b of r.beats) {
      const k = Math.round((b - offset) / period);
      expect(Math.abs(b - (offset + k * period))).toBeLessThan(0.015);
    }
    // Bassdrum auf Schlag 1 und 3 (gerade Indizes) – beide gleich stark, daher Phase 0 oder 2.
    for (const d of r.downbeats) expect(Math.round((d - offset) / period) % 2).toBe(0);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('meldet bei Rauschen niedrige Konfidenz und bei Stille/kurzen Signalen nichts', () => {
    const rand = seededRandom(99);
    const noise = Float32Array.from({ length: sr * 8 }, () => (rand() * 2 - 1) * 0.3);
    expect(detectBeatsFromPcm(noise, sr).confidence).toBeLessThan(0.4);
    expect(detectBeatsFromPcm(new Float32Array(sr * 4), sr)).toEqual({ bpm: 0, beats: [], downbeats: [], onsets: [], confidence: 0 });
    const short = detectBeatsFromPcm(clickTrackPcm({ bpm: 120, durationSec: 1.5, sampleRate: sr }), sr);
    expect(short.bpm).toBe(0);
    expect(short.onsets.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Signalhelfer', () => {
  it('RMS-Hüllkurve eines Sinus ≈ A/√2 mit korrekter Länge', () => {
    const sr = 8000;
    const x = Float32Array.from({ length: sr * 2 + 37 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr));
    const env = rmsEnvelope(x, sr, 100);
    expect(env.length).toBe(Math.ceil(((sr * 2 + 37) * 100) / sr));
    for (let i = 0; i < 200; i++) expect(env[i]).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('PeakAccumulator verdichtet Min/Max je Abschnitt (Stereo, interleaved)', () => {
    const acc = new PeakAccumulator(2, 10);
    const frames = 1000;
    const data = new Float32Array(frames * 2);
    for (let f = 0; f < frames; f++) {
      data[2 * f] = f < 500 ? 0.25 : -0.75;
      data[2 * f + 1] = f < 500 ? -0.1 : 1.5; // > 1 wird begrenzt
    }
    acc.push(data.subarray(0, 333));
    acc.push(data.subarray(333));
    const peaks = acc.finish(4);
    expect(peaks).toEqual([-0.1, 0.25, -0.1, 0.25, -0.75, 1, -0.75, 1]);
    expect(acc.frames).toBe(frames);
  });

  it('atempo-Kette bleibt im Bereich 0,5–2', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(1.5)).toEqual([1.5]);
    expect(atempoChain(3)).toEqual([2, 1.5]);
    expect(atempoChain(0.3)).toEqual([0.5, 0.6]);
    expect(atempoChain(0.25)).toEqual([0.5, 0.5]);
    expect(() => atempoChain(0)).toThrow();
  });

  it('resampleLinear tastet Wertefolgen um', () => {
    const v = Float32Array.from([0, 1, 2, 3]);
    expect(Array.from(resampleLinear(v, 2, 4))).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3]);
  });
});
