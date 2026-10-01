/** Streaming-fähige Signalhelfer (Peaks, RMS-Hüllkurve) und kleine Filter. */

/** Wachsendes Float32-Array ohne ständiges Umkopieren. */
export class GrowableFloat32 {
  private data: Float32Array;
  length = 0;
  constructor(initial = 4096) {
    this.data = new Float32Array(Math.max(16, initial));
  }
  push(value: number): void {
    if (this.length === this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = value;
  }
  pushAll(values: Float32Array): void {
    if (this.length + values.length > this.data.length) {
      let cap = this.data.length;
      while (cap < this.length + values.length) cap *= 2;
      const next = new Float32Array(cap);
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    this.data.set(values, this.length);
    this.length += values.length;
  }
  toArray(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

/**
 * Sammelt Min/Max je Block von `blockFrames` Frames (interleaved, `channels` Kanäle)
 * und verdichtet am Ende auf `points` Paare [min, max, min, max, …].
 */
export class PeakAccumulator {
  private readonly mins = new GrowableFloat32();
  private readonly maxs = new GrowableFloat32();
  private curMin = Number.POSITIVE_INFINITY;
  private curMax = Number.NEGATIVE_INFINITY;
  private inBlock = 0;
  private pending = 0;
  frames = 0;

  constructor(
    private readonly channels: number,
    private readonly blockFrames: number,
  ) {
    if (channels < 1 || blockFrames < 1) throw new Error('PeakAccumulator: ungültige Parameter');
  }

  push(samples: Float32Array): void {
    const ch = this.channels;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i]!;
      if (v < this.curMin) this.curMin = v;
      if (v > this.curMax) this.curMax = v;
      if (++this.pending === ch) {
        this.pending = 0;
        this.frames++;
        if (++this.inBlock === this.blockFrames) this.flushBlock();
      }
    }
  }

  private flushBlock(): void {
    if (this.inBlock === 0) return;
    this.mins.push(this.curMin);
    this.maxs.push(this.curMax);
    this.curMin = Number.POSITIVE_INFINITY;
    this.curMax = Number.NEGATIVE_INFINITY;
    this.inBlock = 0;
  }

  /** Ergebnis mit genau `min(points, Blöcke)` Paaren, Werte auf −1..1 begrenzt (4 Nachkommastellen). */
  finish(points: number): number[] {
    this.flushBlock();
    const mins = this.mins.toArray();
    const maxs = this.maxs.toArray();
    const blocks = mins.length;
    const n = Math.min(Math.max(1, Math.floor(points)), blocks);
    const out: number[] = new Array(n * 2);
    for (let j = 0; j < n; j++) {
      const from = Math.floor((j * blocks) / n);
      const to = Math.max(from + 1, Math.floor(((j + 1) * blocks) / n));
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let b = from; b < to; b++) {
        if (mins[b]! < lo) lo = mins[b]!;
        if (maxs[b]! > hi) hi = maxs[b]!;
      }
      out[2 * j] = roundPeak(lo);
      out[2 * j + 1] = roundPeak(hi);
    }
    return out;
  }
}

function roundPeak(v: number): number {
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  const r = Math.round(c * 10000) / 10000;
  return r === 0 ? 0 : r; // kein -0
}

/**
 * RMS-Hüllkurve mit `rateHz` Werten pro Sekunde aus Mono-Samples (streamingfähig).
 * Fenster i umfasst die Samples [⌊i·sr/rate⌋, ⌊(i+1)·sr/rate⌋).
 */
export class RmsEnvelopeAccumulator {
  private readonly values = new GrowableFloat32();
  private sum = 0;
  private count = 0;
  private index = 0;
  private nextBoundary: number;
  private sample = 0;

  constructor(
    private readonly sampleRate: number,
    private readonly rateHz: number,
  ) {
    if (!(sampleRate > 0) || !(rateHz > 0)) throw new Error('RmsEnvelopeAccumulator: ungültige Raten');
    this.nextBoundary = this.boundary(1);
  }

  private boundary(i: number): number {
    return Math.floor((i * this.sampleRate) / this.rateHz);
  }

  push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i]!;
      this.sum += v * v;
      this.count++;
      this.sample++;
      if (this.sample >= this.nextBoundary) {
        this.values.push(Math.sqrt(this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.index++;
        this.nextBoundary = this.boundary(this.index + 1);
      }
    }
  }

  finish(): Float32Array {
    if (this.count > 0) {
      this.values.push(Math.sqrt(this.sum / this.count));
      this.sum = 0;
      this.count = 0;
    }
    return this.values.toArray();
  }
}

/** RMS-Hüllkurve eines kompletten Mono-Signals. */
export function rmsEnvelope(samples: Float32Array, sampleRate: number, rateHz: number): Float32Array {
  const acc = new RmsEnvelopeAccumulator(sampleRate, rateHz);
  acc.push(samples);
  return acc.finish();
}

/** Gleitender Mittelwert mit zentriertem Fenster der Breite 2·radius+1 (Ränder verkürzt). */
export function movingAverage(values: ArrayLike<number>, radius: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const r = Math.max(0, Math.floor(radius));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + values[i]!;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r);
    const b = Math.min(n, i + r + 1);
    out[i] = (prefix[b]! - prefix[a]!) / (b - a);
  }
  return out;
}

/**
 * Merkmal für Synchronprüfungen: logarithmierte Hüllkurve, um einen gleitenden Mittelwert
 * (≈ `detrendSec`) bereinigt, damit langsame Pegeländerungen das Maximum nicht dominieren.
 */
export function syncFeature(envelope: Float32Array, rateHz: number, detrendSec = 1): Float32Array {
  const logEnv = new Float64Array(envelope.length);
  for (let i = 0; i < envelope.length; i++) logEnv[i] = Math.log10(envelope[i]! + 1e-4);
  const trend = movingAverage(logEnv, Math.round((detrendSec * rateHz) / 2));
  const out = new Float32Array(envelope.length);
  for (let i = 0; i < envelope.length; i++) out[i] = logEnv[i]! - trend[i]!;
  return out;
}

/** Betrag der ersten Differenz (Änderungsrate), erster Wert 0. */
export function absDiff(values: Float32Array): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 1; i < values.length; i++) out[i] = Math.abs(values[i]! - values[i - 1]!);
  return out;
}

/** Lineare Umtastung einer Wertefolge von `fromHz` auf `toHz`. */
export function resampleLinear(values: Float32Array, fromHz: number, toHz: number): Float32Array {
  if (fromHz === toHz) return values.slice();
  const n = Math.max(0, Math.floor((values.length * toHz) / fromHz));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i * fromHz) / toHz;
    const a = Math.floor(pos);
    const f = pos - a;
    const va = values[Math.min(a, values.length - 1)]!;
    const vb = values[Math.min(a + 1, values.length - 1)]!;
    out[i] = va + (vb - va) * f;
  }
  return out;
}
