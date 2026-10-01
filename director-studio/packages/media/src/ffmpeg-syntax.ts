/** Hilfen für ffmpeg-Argumente: Zeitangaben, Escaping von Filtergraphen, Codec-Wahl. */

/**
 * Sekunden → `HH:MM:SS.mmm` (mindestens Millisekunden, bei Bedarf bis Mikrosekunden),
 * z. B. `1.5` → `00:00:01.500`, `3661.000021` → `01:01:01.000021`.
 */
export function formatFfmpegTime(sec: number): string {
  if (!Number.isFinite(sec)) throw new Error(`Ungültige Zeitangabe: ${sec}`);
  const sign = sec < 0 ? '-' : '';
  let us = Math.round(Math.abs(sec) * 1e6);
  const hours = Math.floor(us / 3_600_000_000);
  us -= hours * 3_600_000_000;
  const minutes = Math.floor(us / 60_000_000);
  us -= minutes * 60_000_000;
  const seconds = Math.floor(us / 1_000_000);
  us -= seconds * 1_000_000;
  let frac = String(us).padStart(6, '0');
  frac = frac.replace(/0+$/, '').padEnd(3, '0');
  return `${sign}${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${frac}`;
}

/** Sekunden als Dezimalzahl ohne Exponentialschreibweise (für Filteroptionen), max. 6 Nachkommastellen. */
export function formatSecondsArg(sec: number): string {
  if (!Number.isFinite(sec)) throw new Error(`Ungültige Zeitangabe: ${sec}`);
  const fixed = sec.toFixed(6).replace(/\.?0+$/, '');
  return fixed === '-0' ? '0' : fixed;
}

/** Zahl für Filteroptionen (keine Exponentialschreibweise, deterministisch gerundet). */
export function num(value: number, digits = 6): string {
  if (!Number.isFinite(value)) throw new Error(`Ungültige Zahl: ${value}`);
  const fixed = value.toFixed(digits).replace(/\.?0+$/, '');
  return fixed === '-0' || fixed === '' ? '0' : fixed;
}

/**
 * Ebene 1: Wert einer Filteroption (Trenner `:`; Sonderzeichen `\` `'` `:`).
 * Siehe ffmpeg-utils „Quoting and escaping“.
 */
export function escapeFilterOptionValue(value: string): string {
  return value.replace(/[\\':]/g, (c) => `\\${c}`);
}

/** Ebene 2: Filtergraph (Sonderzeichen `\` `'` `[` `]` `,` `;`). */
export function escapeFilterGraph(value: string): string {
  return value.replace(/[\\'[\],;]/g, (c) => `\\${c}`);
}

/** Beide Ebenen: beliebiger Text als Optionswert innerhalb von `-filter_complex`/`-vf`. */
export function filterValue(value: string): string {
  return escapeFilterGraph(escapeFilterOptionValue(value));
}

/** Dateiendung in Kleinbuchstaben ohne Punkt. */
export function extensionOf(path: string): string {
  const m = /\.([^./\\]+)$/.exec(path);
  return m ? m[1]!.toLowerCase() : '';
}

/** Audio-Codec-Argumente passend zur Ausgabe-Endung. */
export function audioCodecArgs(outPath: string, opts: { bitrateK?: number } = {}): string[] {
  const ext = extensionOf(outPath);
  const br = `${opts.bitrateK ?? 192}k`;
  switch (ext) {
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', br];
    case 'ogg':
    case 'opus':
    case 'webm':
      return ['-c:a', 'libopus', '-b:a', br];
    case 'm4a':
    case 'aac':
    case 'mp4':
    case 'mov':
    case 'mkv':
      return ['-c:a', 'aac', '-b:a', br];
    default:
      throw new Error(`Nicht unterstütztes Audioformat ".${ext || '?'}" (wav, flac, mp3, m4a, aac, ogg, opus)`);
  }
}

/** Container-Argumente für Audio-Ausgaben (z. B. ADTS für `.aac`, faststart für m4a). */
export function audioContainerArgs(outPath: string): string[] {
  const ext = extensionOf(outPath);
  if (ext === 'aac') return ['-f', 'adts'];
  if (ext === 'm4a' || ext === 'mp4' || ext === 'mov') return ['-movflags', '+faststart'];
  return [];
}

/** Bild-Encoder-Argumente nach Endung (JPEG mit guter Qualität, PNG/WebP Standard). */
export function imageCodecArgs(outPath: string): string[] {
  const ext = extensionOf(outPath);
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return ['-q:v', '3'];
    case 'png':
      return [];
    case 'webp':
      return ['-quality', '85'];
    default:
      throw new Error(`Nicht unterstütztes Bildformat ".${ext || '?'}" (png, jpg, webp)`);
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
