/** Kleine, browser-sichere Helfer zum sicheren Erzeugen von HTML/SVG/CSS-Strings. */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Maskiert Text für HTML-Inhalt und Attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Alias für Attributwerte (gleiche Maskierung, eigener Name für Lesbarkeit). */
export const escapeAttr = escapeHtml;

/** camelCase → kebab-case (für CSS-Eigenschaften). */
export function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/**
 * Säubert einen CSS-Wert, damit er keine weiteren Deklarationen, Regeln oder Tags einschleusen kann.
 * Entfernt `; { } < >` und Backslashes sowie `expression(`/`javascript:`.
 */
export function sanitizeCssValue(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  return value
    .replace(/[;{}<>\\]/g, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/@import/gi, '')
    .trim();
}

/** Zahl → `Npx`, String bleibt (gesäubert). */
export function cssLength(value: string | number | undefined, fallback?: string): string | undefined {
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'number') return `${round(value)}px`;
  return sanitizeCssValue(value);
}

/** Schriftname für CSS `font-family` (Anführungszeichen entfernt, generische Familien unverändert). */
export function cssFontFamily(name: string, fallback = 'system-ui, sans-serif'): string {
  const parts = name
    .split(',')
    .map((p) => p.trim().replace(/["'`;{}<>\\]/g, ''))
    .filter(Boolean);
  const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace']);
  const quoted = parts.map((p) => (generic.has(p) ? p : `"${p}"`));
  return [...quoted, fallback].join(', ');
}

/** Verhindert, dass Inhalt eines `<style>`-Blocks das Tag vorzeitig schließt. */
export function escapeStyleContent(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** Verhindert, dass Inhalt eines `<script>`-Blocks das Tag vorzeitig schließt. */
export function escapeScriptContent(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** Rundet auf max. 3 Nachkommastellen (stabile, kompakte Ausgabe). */
export function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Erlaubte Mischmodi (CSS `mix-blend-mode`). */
export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'plus-lighter',
] as const;

export function normalizeBlendMode(blend: string | undefined): string | undefined {
  if (!blend) return undefined;
  const value = kebabCase(blend.trim()).toLowerCase();
  return (BLEND_MODES as readonly string[]).includes(value) && value !== 'normal' ? value : undefined;
}

/** Sichere ID für CSS-Selektoren/SVG-IDs aus beliebigen Strings. */
export function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `_${ch.charCodeAt(0).toString(16)}`);
}

/** Entfernt Steuerzeichen, die in Attributen/Text nichts verloren haben. */
export function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
