/**
 * Platzhalter-Medien für das Fake-Backend: SVG-Bilder als Data-URIs, kurze WAV-Dateien
 * (8-Bit-PCM, mit Beat-Klicks) und deterministische Wellenform-Daten.
 */

/** Deterministischer Pseudo-Zufall (Mulberry32) aus einem String-Seed. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface PlaceholderImageOptions {
  title: string;
  subtitle?: string | undefined;
  hue: number;
  width?: number | undefined;
  height?: number | undefined;
  /** Motiv: Horizont-Silhouette, Kreis (Porträt) oder Raster. */
  motif?: 'horizon' | 'portrait' | 'grid' | 'frame' | undefined;
}

/** Erzeugt ein SVG-Platzhalterbild als Data-URI. */
export function placeholderImage(options: PlaceholderImageOptions): string {
  const w = options.width ?? 640;
  const h = options.height ?? 360;
  const hue = options.hue;
  const bgTop = `hsl(${hue} 45% 22%)`;
  const bgBottom = `hsl(${(hue + 30) % 360} 55% 12%)`;
  const accent = `hsl(${(hue + 180) % 360} 70% 62%)`;
  const motif = options.motif ?? 'horizon';
  let shape = '';
  if (motif === 'horizon') {
    shape = `<circle cx="${w * 0.68}" cy="${h * 0.42}" r="${h * 0.16}" fill="${accent}" opacity="0.85"/>
      <path d="M0 ${h * 0.72} L${w * 0.18} ${h * 0.55} L${w * 0.34} ${h * 0.66} L${w * 0.52} ${h * 0.48} L${w * 0.74} ${h * 0.68} L${w} ${h * 0.56} L${w} ${h} L0 ${h} Z" fill="hsl(${hue} 40% 8%)" opacity="0.9"/>`;
  } else if (motif === 'portrait') {
    shape = `<circle cx="${w / 2}" cy="${h * 0.4}" r="${h * 0.17}" fill="${accent}" opacity="0.9"/>
      <rect x="${w / 2 - h * 0.28}" y="${h * 0.6}" width="${h * 0.56}" height="${h * 0.5}" rx="${h * 0.2}" fill="${accent}" opacity="0.6"/>`;
  } else if (motif === 'grid') {
    const lines: string[] = [];
    for (let i = 1; i < 6; i++) lines.push(`<line x1="${(w / 6) * i}" y1="0" x2="${(w / 6) * i}" y2="${h}" stroke="${accent}" stroke-opacity="0.25"/>`);
    for (let i = 1; i < 4; i++) lines.push(`<line x1="0" y1="${(h / 4) * i}" x2="${w}" y2="${(h / 4) * i}" stroke="${accent}" stroke-opacity="0.25"/>`);
    shape = lines.join('');
  } else {
    shape = `<rect x="${w * 0.08}" y="${h * 0.12}" width="${w * 0.84}" height="${h * 0.76}" fill="none" stroke="${accent}" stroke-width="${Math.max(2, w / 160)}" opacity="0.7"/>`;
  }
  const fontSize = Math.round(Math.min(w, h) / 9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bgTop}"/><stop offset="1" stop-color="${bgBottom}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    ${shape}
    <text x="${w * 0.06}" y="${h * 0.86}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="#f4f1ea">${escapeXml(options.title)}</text>
    ${options.subtitle ? `<text x="${w * 0.06}" y="${h * 0.86 + fontSize * 0.9}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${Math.round(fontSize * 0.55)}" fill="#f4f1ea" opacity="0.75">${escapeXml(options.subtitle)}</text>` : ''}
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Einfaches Symbolbild (für Text/Code/Daten/Schrift-Assets). */
export function placeholderGlyph(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <rect width="320" height="200" fill="hsl(${hue} 18% 18%)"/>
    <text x="160" y="118" text-anchor="middle" font-family="Menlo, Consolas, monospace" font-size="40" fill="hsl(${hue} 60% 72%)">${escapeXml(label)}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Erzeugt eine WAV-Datei (mono, 8 Bit) mit leisem Grundton und Klicks auf den Beats.
 * Klein genug für Data-URIs (60 s bei 8 kHz ≈ 480 kB).
 */
export function makeWavDataUri(options: { seconds: number; bpm?: number; sampleRate?: number; toneHz?: number; seed?: string }): string {
  const sampleRate = options.sampleRate ?? 8000;
  const samples = Math.max(1, Math.round(options.seconds * sampleRate));
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeStr(36, 'data');
  view.setUint32(40, samples, true);
  const beatSamples = options.bpm ? Math.round((60 / options.bpm) * sampleRate) : 0;
  const tone = options.toneHz ?? 110;
  const random = seededRandom(options.seed ?? 'wav');
  for (let i = 0; i < samples; i++) {
    let v = Math.sin((2 * Math.PI * tone * i) / sampleRate) * 0.12;
    if (beatSamples) {
      const sinceBeat = i % beatSamples;
      if (sinceBeat < sampleRate * 0.06) {
        const env = 1 - sinceBeat / (sampleRate * 0.06);
        v += (random() * 2 - 1) * 0.5 * env;
      }
    }
    bytes[44 + i] = Math.max(0, Math.min(255, Math.round(128 + v * 127)));
  }
  return `data:audio/wav;base64,${toBase64(bytes)}`;
}

/**
 * Deterministische Wellenform (min/max-Paare, −1..1). `bpm` erzeugt sichtbare Transienten.
 */
export function makePeaks(seed: string, durationMs: number, options: { bpm?: number; pointsPerSecond?: number; level?: number } = {}): number[] {
  const pps = options.pointsPerSecond ?? 50;
  const count = Math.max(2, Math.round((durationMs / 1000) * pps));
  const random = seededRandom(seed);
  const level = options.level ?? 0.7;
  const peaks: number[] = [];
  const beatEvery = options.bpm ? (60 / options.bpm) * pps : 0;
  for (let i = 0; i < count; i++) {
    // Langsame Hüllkurve (Phrasen) + Rauschen + Beat-Spitzen.
    const phrase = 0.55 + 0.45 * Math.sin((i / count) * Math.PI * 6 + random() * 0.3);
    let amp = level * phrase * (0.35 + random() * 0.4);
    if (beatEvery && i % Math.max(1, Math.round(beatEvery)) < 2) amp = Math.min(1, amp + 0.35);
    const max = Math.min(1, amp);
    const min = -Math.min(1, amp * (0.8 + random() * 0.2));
    peaks.push(min, max);
  }
  return peaks;
}

export function textDataUri(text: string, mime = 'text/plain'): string {
  return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
}
