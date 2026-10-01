/** Kleine Radix-2-FFT (iterativ, in place) mit vorberechneten Drehfaktoren. */

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export class FFT {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;

  constructor(size: number) {
    if (!isPowerOfTwo(size)) throw new Error(`FFT-Größe muss eine Zweierpotenz sein (erhalten: ${size})`);
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** Vorwärts-FFT (Exponent −i) in place. `inverse` = true: inverse FFT inkl. 1/N-Skalierung. */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = this.size;
    if (re.length !== n || im.length !== n) throw new Error('FFT: Arraylänge passt nicht zur Größe');
    const rev = this.rev;
    const cosT = this.cos;
    const sinT = this.sin;
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let k = 0; k < half; k++) {
        const wr = cosT[k * step]!;
        const wi = sign * sinT[k * step]!;
        for (let a = k; a < n; a += len) {
          const b = a + half;
          const rb = re[b]!;
          const ib = im[b]!;
          const xr = rb * wr - ib * wi;
          const xi = rb * wi + ib * wr;
          const ra = re[a]!;
          const ia = im[a]!;
          re[b] = ra - xr;
          im[b] = ia - xi;
          re[a] = ra + xr;
          im[a] = ia + xi;
        }
      }
    }
    if (inverse) {
      const inv = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] = re[i]! * inv;
        im[i] = im[i]! * inv;
      }
    }
  }
}

/** Hann-Fenster der Länge n (periodisch, wie für STFT üblich). */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
