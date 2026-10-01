import { SOFT_HYPHEN } from './hyphenate-de.ts';

/**
 * Geschätzte Textbreiten ohne Layout-Engine (Node, SVG ohne `foreignObject`). Grundlage sind die
 * Zeichenbreiten einer Grotesk (Helvetica-Metriken, Einheit: em); fette Schnitte sind ~7 % breiter.
 * Ziel ist ein robuster Zeilenumbruch und eine Schriftgrößen-Anpassung für Displaytexte – keine
 * pixelgenaue Messung.
 */

const WIDTHS: Record<string, number> = {
  ' ': 0.278, '!': 0.278, '"': 0.355, '#': 0.556, $: 0.556, '%': 0.889, '&': 0.667, "'": 0.191, '(': 0.333, ')': 0.333,
  '*': 0.389, '+': 0.584, ',': 0.278, '-': 0.333, '.': 0.278, '/': 0.278, ':': 0.278, ';': 0.278, '<': 0.584, '=': 0.584,
  '>': 0.584, '?': 0.556, '@': 1.015, '[': 0.278, '\\': 0.278, ']': 0.278, '^': 0.469, _: 0.556, '`': 0.333, '{': 0.334,
  '|': 0.26, '}': 0.334, '~': 0.584, '„': 0.333, '“': 0.333, '”': 0.333, '‚': 0.222, '‘': 0.222, '’': 0.222, '«': 0.556,
  '»': 0.556, '–': 0.556, '—': 1, '…': 1, '€': 0.556,
  a: 0.556, b: 0.556, c: 0.5, d: 0.556, e: 0.556, f: 0.278, g: 0.556, h: 0.556, i: 0.222, j: 0.222, k: 0.5, l: 0.222,
  m: 0.833, n: 0.556, o: 0.556, p: 0.556, q: 0.556, r: 0.333, s: 0.5, t: 0.278, u: 0.556, v: 0.5, w: 0.722, x: 0.5,
  y: 0.5, z: 0.5, ä: 0.556, ö: 0.556, ü: 0.556, ß: 0.611,
  A: 0.667, B: 0.667, C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722, I: 0.278, J: 0.5, K: 0.667, L: 0.556,
  M: 0.833, N: 0.722, O: 0.778, P: 0.667, Q: 0.778, R: 0.722, S: 0.667, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667,
  Y: 0.667, Z: 0.611, Ä: 0.667, Ö: 0.778, Ü: 0.722, ẞ: 0.722,
};

export interface MeasureOptions {
  /** Zusätzlicher Zeichenabstand in px (CSS `letter-spacing`). */
  letterSpacing?: number;
  /** Fetter Schnitt (font-weight ≥ 600). */
  bold?: boolean;
}

function charWidthEm(ch: string): number {
  if (ch === SOFT_HYPHEN) return 0;
  const w = WIDTHS[ch];
  if (w !== undefined) return w;
  if (/\d/.test(ch)) return 0.556;
  if (/\p{Lu}/u.test(ch)) return 0.7;
  if (/\p{L}/u.test(ch)) return 0.556;
  if (/\s/.test(ch)) return 0.278;
  return 0.6;
}

/** Geschätzte Breite in em (ohne Zeichenabstand); bedingte Trennstriche zählen nicht. */
export function textWidthEm(text: string, bold = false): number {
  let em = 0;
  for (const ch of text) em += charWidthEm(ch);
  return bold ? em * 1.07 : em;
}

/** Anzahl sichtbarer Zeichen (für `letter-spacing`). */
function visibleChars(text: string): number {
  let n = 0;
  for (const ch of text) if (ch !== SOFT_HYPHEN) n++;
  return n;
}

/** Geschätzte Breite in px. */
export function estimateTextWidth(text: string, fontSize: number, opts: MeasureOptions = {}): number {
  return textWidthEm(text, opts.bold) * fontSize + visibleChars(text) * (opts.letterSpacing ?? 0);
}

/** `font-weight` (Zahl oder Schlüsselwort) → fett? */
export function isBoldWeight(weight: string | number | undefined): boolean {
  if (weight === undefined) return false;
  if (typeof weight === 'number') return weight >= 600;
  const v = weight.trim().toLowerCase();
  if (v === 'bold' || v === 'bolder') return true;
  const n = Number(v);
  return Number.isFinite(n) && n >= 600;
}

/**
 * Bricht Text in Zeilen um – NUR an Leerzeichen und bedingten Trennstrichen (U+00AD, dann mit
 * sichtbarem `-`), nie mitten im Wort. Passt ein Wort- bzw. Silbenstück allein nicht in die Zeile,
 * ragt es über (keine Notbrüche). `\n` erzwingt einen Umbruch. Rückgabe ohne U+00AD.
 */
export function wrapTextLines(text: string, width: number, fontSize: number, opts: MeasureOptions = {}): string[] {
  const fits = (line: string) => estimateTextWidth(line, fontSize, opts) <= width + 0.01;
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/[ \t\f\v\u00a0]+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      let parts = word.split(SOFT_HYPHEN).filter(Boolean);
      while (parts.length) {
        const sep = line ? ' ' : '';
        const whole = parts.join('');
        if (fits(line + sep + whole)) {
          line += sep + whole;
          break;
        }
        // Längstes Silbenstück, das mit Trennstrich noch passt.
        let k = parts.length - 1;
        while (k >= 1 && !fits(`${line}${sep}${parts.slice(0, k).join('')}-`)) k--;
        if (k >= 1) {
          out.push(`${line}${sep}${parts.slice(0, k).join('')}-`);
          line = '';
          parts = parts.slice(k);
          continue;
        }
        if (line) {
          out.push(line);
          line = '';
          continue;
        }
        // Leere Zeile und nicht einmal das erste Stück passt: überragen lassen.
        if (parts.length > 1) {
          out.push(`${parts[0]}-`);
          parts = parts.slice(1);
          continue;
        }
        line = parts[0]!;
        parts = [];
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Schriftgröße, bei der das breiteste unteilbare Stück (Wort bzw. – wenn `allowHyphens` – Silbenstück
 * mit Trennstrich) in `width` passt. Nie größer als `fontSize`.
 */
export function fitFontSizeToWords(text: string, width: number, fontSize: number, opts: MeasureOptions & { allowHyphens?: boolean } = {}): number {
  if (!(width > 0) || !(fontSize > 0)) return fontSize;
  const ls = opts.letterSpacing ?? 0;
  let best = fontSize;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const pieces = opts.allowHyphens ? word.split(SOFT_HYPHEN).map((p, i, all) => (i < all.length - 1 ? `${p}-` : p)) : [word.replaceAll(SOFT_HYPHEN, '')];
    for (const piece of pieces) {
      const em = textWidthEm(piece, opts.bold);
      if (!(em > 0)) continue;
      const n = visibleChars(piece);
      if (em * best + n * ls <= width) continue;
      const size = (width - n * ls) / em;
      best = Math.max(1, Math.min(best, size));
    }
  }
  return best < fontSize ? Math.floor(best * 0.98 * 10) / 10 : fontSize;
}
