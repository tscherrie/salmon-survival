import type { Deck, DeckElement, Slide } from '@studio/core';
import { PICKER_SCRIPT } from '../picker/picker-script.ts';
import { cssFontFamily, escapeAttr, escapeHtml, escapeScriptContent, escapeStyleContent, kebabCase, round, sanitizeCssValue } from '../util/html.ts';
import { markdownToHtml } from '../util/markdown.ts';
import { isDangerousUrl, sanitizeHtml, scopeStyleBlocks } from '../util/sanitize.ts';
import { chartToSvg, DEFAULT_CHART_COLORS } from './chart-svg.ts';

/**
 * Deck → eigenständiges HTML-Dokument (Bühne, PNG, PDF). Jede Folie ist eine
 * `<section class="slide" data-sid="<slideId>">` in Deckgröße, Elemente sind absolut positioniert und
 * tragen `data-sid="<elementId>"`. Sprechernotizen werden nie ausgegeben.
 */

export interface DeckFontFace {
  family: string;
  /** URL der Schriftdatei (`studio-asset://…`, `file://…`, `http://127.0.0.1…`). */
  src: string;
  weight?: string | number;
  style?: 'normal' | 'italic';
}

export interface DeckHtmlOptions {
  /** Liefert die URL eines Assets (Renderer: `studio-asset://…`; Render-Worker: `file://`/`http://`). */
  assetUrl: (assetId: string) => string;
  /** `export`: Folien untereinander mit Seitenumbrüchen (PDF). `stage`: nur die Folien (Screenshots/Bühne). */
  mode: 'export' | 'stage';
  /** Nur diese Folien (Reihenfolge des Decks). Ausgeblendete Folien sind im Export sonst ausgelassen. */
  slideIds?: string[];
  /** Picker-Skript einbetten (mit Nonce in der CSP). Standard: false. */
  picker?: boolean;
  /** Content-Security-Policy `script-src 'none'` setzen. Standard: true. */
  csp?: boolean;
  /** Lokale Schriften (@font-face). */
  fontFaces?: DeckFontFace[];
  /** Hintergrund außerhalb der Folien (Standard: transparent). */
  pageBackground?: string;
}

const ROLE_SIZES: Record<string, number> = { title: 0.074, subtitle: 0.044, body: 0.033, caption: 0.022, kicker: 0.02, quote: 0.05, stat: 0.13 };

const SPECIAL_STYLE_KEYS = new Set([
  'role',
  'align',
  'textAlign',
  'valign',
  'verticalAlign',
  'fit',
  'objectFit',
  'objectPosition',
  'fill',
  'stroke',
  'strokeWidth',
  'radius',
  'shadow',
  'font',
  'fontFamily',
  'fontSize',
  'diagonal',
  'color',
  'background',
  'backgroundColor',
  'letterSpacing',
  'lineHeight',
]);

export function deckToHtml(deck: Deck, opts: DeckHtmlOptions): string {
  const slides = selectSlides(deck, opts);
  const nonce = opts.picker ? makeNonce() : undefined;
  const csp = opts.csp === false ? '' : `<meta http-equiv="Content-Security-Policy" content="script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">`;
  const css = buildCss(deck, opts);
  const body = slides.map((slide) => renderSlide(deck, slide, deck.slides.indexOf(slide), opts)).join('\n');
  const picker = nonce ? `<script nonce="${nonce}">${escapeScriptContent(PICKER_SCRIPT)}</script>` : '';
  const title = escapeHtml(deck.theme.name ?? 'Präsentation');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
${csp}
<meta name="viewport" content="width=${deck.width}">
<title>${title}</title>
<style>${escapeStyleContent(css)}</style>
</head>
<body class="mode-${opts.mode}">
${body}
${picker}
</body>
</html>`;
}

/** Eine einzelne Folie als vollständiges Dokument. */
export function slideToHtml(deck: Deck, slideId: string, opts: Omit<DeckHtmlOptions, 'slideIds'>): string {
  if (!deck.slides.some((s) => s.id === slideId)) throw new Error(`Folie "${slideId}" existiert nicht`);
  return deckToHtml(deck, { ...opts, slideIds: [slideId] });
}

/** Folien in Deck-Reihenfolge, gefiltert nach `slideIds` bzw. (im Export) ohne ausgeblendete. */
export function selectSlides(deck: Deck, opts: Pick<DeckHtmlOptions, 'slideIds' | 'mode'>): Slide[] {
  if (opts.slideIds) {
    const wanted = new Set(opts.slideIds);
    for (const id of wanted) if (!deck.slides.some((s) => s.id === id)) throw new Error(`Folie "${id}" existiert nicht`);
    return deck.slides.filter((s) => wanted.has(s.id));
  }
  return opts.mode === 'export' ? deck.slides.filter((s) => !s.hidden) : deck.slides;
}

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function cssVarName(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/** Farbe/Wert: Theme-Farbnamen (`accent`, `$accent`) werden zu CSS-Variablen. */
export function themeValue(deck: Deck, value: string | number): string {
  if (typeof value === 'number') return String(value);
  const key = value.startsWith('$') ? value.slice(1) : value;
  if (Object.prototype.hasOwnProperty.call(deck.theme.colors, key)) return `var(--color-${cssVarName(key)})`;
  return sanitizeCssValue(value);
}

function fontVar(deck: Deck, value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = String(value);
  if (v === 'heading' || v === 'body' || v === 'mono') return `var(--font-${v})`;
  return cssFontFamily(v, deck.theme.fonts.body ? 'var(--font-body)' : 'sans-serif');
}

function chartColors(deck: Deck): string[] {
  const c = deck.theme.colors;
  const numbered = Object.keys(c)
    .filter((k) => /^chart\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((k) => c[k]!);
  if (numbered.length) return numbered.map((v) => sanitizeCssValue(v));
  if (c.chart) return c.chart.split(',').map((v) => sanitizeCssValue(v.trim())).filter(Boolean);
  return DEFAULT_CHART_COLORS;
}

function buildCss(deck: Deck, opts: DeckHtmlOptions): string {
  const W = deck.width;
  const H = deck.height;
  const theme = deck.theme;
  const vars: string[] = [
    `--deck-width: ${W}px`,
    `--deck-height: ${H}px`,
    `--font-heading: ${cssFontFamily(theme.fonts.heading)}`,
    `--font-body: ${cssFontFamily(theme.fonts.body)}`,
    `--font-mono: ${cssFontFamily(theme.fonts.mono ?? 'ui-monospace', 'monospace')}`,
  ];
  for (const [key, value] of Object.entries(theme.colors)) vars.push(`--color-${cssVarName(key)}: ${sanitizeCssValue(value)}`);
  vars.push(`--slide-bg: ${theme.background ? sanitizeCssValue(theme.background) : 'var(--color-background, #ffffff)'}`);
  vars.push('--slide-fg: var(--color-text, var(--color-foreground, #141414))');
  vars.push('--accent: var(--color-accent, var(--color-primary, #2a78d6))');
  vars.push('--muted: var(--color-muted, #5b5b57)');
  const fontFaces = (opts.fontFaces ?? [])
    .filter((f) => !isDangerousUrl(f.src))
    .map((f) => `@font-face { font-family: "${f.family.replace(/["\\;{}<>]/g, '')}"; src: url("${cssUrl(f.src)}"); font-weight: ${sanitizeCssValue(f.weight ?? 'normal')}; font-style: ${f.style ?? 'normal'}; font-display: block; }`)
    .join('\n');
  const base = Math.round(H * ROLE_SIZES.body!);
  const roles = Object.entries(ROLE_SIZES)
    .map(([role, factor]) => `.role-${role} { font-size: ${Math.round(H * factor)}px; }`)
    .join('\n');
  const exportCss =
    opts.mode === 'export'
      ? `@page { size: ${W}px ${H}px; margin: 0; }
.slide { break-after: page; page-break-after: always; }
.slide:last-of-type { break-after: auto; page-break-after: auto; }`
      : '';
  const themeCss = theme.css ? `@scope (.slide) {\n${theme.css.replace(/@import[^;]*;?/gi, '')}\n}` : '';
  return `${fontFaces}
:root { ${vars.join('; ')}; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: ${opts.pageBackground ? sanitizeCssValue(opts.pageBackground) : 'transparent'}; -webkit-print-color-adjust: exact; print-color-adjust: exact; -webkit-font-smoothing: antialiased; }
.slide { position: relative; display: block; width: ${W}px; height: ${H}px; overflow: hidden; background: var(--slide-bg); color: var(--slide-fg); font-family: var(--font-body); font-size: ${base}px; line-height: 1.3; font-kerning: normal; text-rendering: optimizeLegibility; }
.slide-bg-image { position: absolute; inset: 0; background-size: cover; background-position: center; z-index: 0; }
.el { position: absolute; margin: 0; }
.el-text { display: flex; flex-direction: column; overflow-wrap: break-word; hyphens: auto; -webkit-hyphens: auto; text-wrap: pretty; }
.el-text p { margin: 0 0 0.45em; }
.el-text p:last-child, .el-text ul:last-child { margin-bottom: 0; }
.el-text ul { margin: 0 0 0.45em; padding-left: 1.15em; }
.el-text li { margin: 0 0 0.3em; }
.el-text li::marker { color: var(--accent); }
.el-text strong { font-weight: 700; }
.role-title, .role-subtitle, .role-stat, .role-quote { font-family: var(--font-heading); text-wrap: balance; }
.role-title { font-weight: 700; line-height: 1.05; letter-spacing: -0.015em; }
.role-subtitle { font-weight: 500; line-height: 1.15; color: var(--muted); }
.role-stat { font-weight: 800; line-height: 1; letter-spacing: -0.03em; font-variant-numeric: lining-nums; }
.role-caption { color: var(--muted); line-height: 1.35; }
.role-kicker { text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600; color: var(--accent); }
${roles}
.el-image, .el-video { overflow: hidden; }
.el-image img, .el-video video { display: block; width: 100%; height: 100%; object-fit: cover; }
.el-shape svg, .el-chart svg { display: block; width: 100%; height: 100%; overflow: visible; }
.el-html { overflow: hidden; contain: layout paint; }
.el-missing { display: flex; align-items: center; justify-content: center; border: 2px dashed rgba(127,127,127,0.6); color: rgba(127,127,127,0.9); font: 500 ${Math.round(H * 0.018)}px system-ui, sans-serif; background: repeating-linear-gradient(45deg, rgba(127,127,127,0.08) 0 12px, transparent 12px 24px); }
${exportCss}
${themeCss}`;
}

/** URL für `url("…")` in CSS (Anführungszeichen/Zeilenumbrüche maskiert). */
export function cssUrl(url: string): string {
  return url.replace(/["\\\n\r]/g, (ch) => `\\${ch === '\n' ? 'a ' : ch === '\r' ? 'd ' : ch}`);
}

function safeAssetUrl(opts: DeckHtmlOptions, assetId: string): string | undefined {
  try {
    const url = opts.assetUrl(assetId);
    if (!url || isDangerousUrl(url)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function renderSlide(deck: Deck, slide: Slide, index: number, opts: DeckHtmlOptions): string {
  const attrs = [
    `class="slide${slide.layout ? ` layout-${cssVarName(slide.layout)}` : ''}"`,
    `data-sid="${escapeAttr(slide.id)}"`,
    `data-slide-id="${escapeAttr(slide.id)}"`,
    `data-slide-index="${index + 1}"`,
  ];
  if (slide.layout) attrs.push(`data-layout="${escapeAttr(slide.layout)}"`);
  if (slide.transition) attrs.push(`data-transition="${escapeAttr(slide.transition)}"`);
  if (slide.hidden) attrs.push('data-hidden=""');
  if (slide.title) attrs.push(`aria-label="${escapeAttr(slide.title)}"`);
  let bgLayer = '';
  if (typeof slide.background === 'string') {
    attrs.push(`style="${escapeAttr(`background: ${themeValue(deck, slide.background)}`)}"`);
  } else if (slide.background && typeof slide.background === 'object') {
    const url = safeAssetUrl(opts, slide.background.assetId);
    if (url) bgLayer = `<div class="slide-bg-image" data-asset-id="${escapeAttr(slide.background.assetId)}" style="${escapeAttr(`background-image: url("${cssUrl(url)}")`)}"></div>`;
  }
  const elements = slide.elements
    .map((el, order) => ({ el, order }))
    .sort((a, b) => (a.el.z ?? 0) - (b.el.z ?? 0) || a.order - b.order)
    .map(({ el }) => renderElement(deck, el, opts))
    .join('\n');
  return `<section ${attrs.join(' ')}>${bgLayer}\n${elements}\n</section>`;
}

function geometry(el: DeckElement): string[] {
  const parts = [`left: ${round(el.x)}px`, `top: ${round(el.y)}px`, `width: ${round(el.width)}px`, `height: ${round(el.height)}px`];
  if (el.z !== undefined) parts.push(`z-index: ${Math.round(el.z) + 1}`);
  else parts.push('z-index: 1');
  if (el.rotation) parts.push(`transform: rotate(${round(el.rotation)}deg)`);
  return parts;
}

/** Stilangaben eines Elements → CSS-Deklarationen (Theme-Farben, Schriften, Ausrichtung, Durchreichung). */
export function elementCss(deck: Deck, el: DeckElement): string[] {
  const s = el.style ?? {};
  const out: string[] = [];
  const get = (k: string) => s[k];
  const color = get('color');
  if (color !== undefined) out.push(`color: ${themeValue(deck, color)}`);
  const bg = get('background') ?? get('backgroundColor');
  if (bg !== undefined && el.type !== 'shape') out.push(`background: ${themeValue(deck, bg)}`);
  const font = fontVar(deck, get('fontFamily') ?? get('font'));
  if (font) out.push(`font-family: ${font}`);
  const fontSize = get('fontSize');
  if (fontSize !== undefined) out.push(`font-size: ${typeof fontSize === 'number' ? `${round(fontSize)}px` : sanitizeCssValue(fontSize)}`);
  const lh = get('lineHeight');
  if (lh !== undefined) out.push(`line-height: ${sanitizeCssValue(lh)}`);
  const ls = get('letterSpacing');
  if (ls !== undefined) out.push(`letter-spacing: ${typeof ls === 'number' ? `${round(ls)}px` : sanitizeCssValue(ls)}`);
  const align = get('align') ?? get('textAlign');
  if (align !== undefined) out.push(`text-align: ${sanitizeCssValue(align)}`);
  const valign = get('valign') ?? get('verticalAlign');
  if (valign !== undefined && el.type === 'text') {
    const map: Record<string, string> = { top: 'flex-start', middle: 'center', center: 'center', bottom: 'flex-end' };
    out.push(`justify-content: ${map[String(valign)] ?? 'flex-start'}`);
  }
  const radius = get('radius') ?? get('borderRadius');
  if (radius !== undefined && el.type !== 'shape') out.push(`border-radius: ${typeof radius === 'number' ? `${round(radius)}px` : sanitizeCssValue(radius)}`);
  const shadow = get('shadow');
  if (shadow !== undefined && el.type !== 'shape') out.push(`box-shadow: ${shadow === 'true' || shadow === 1 ? '0 18px 48px rgba(0,0,0,0.18)' : sanitizeCssValue(shadow)}`);
  for (const [key, value] of Object.entries(s)) {
    if (SPECIAL_STYLE_KEYS.has(key) || key === 'borderRadius') continue;
    if (!/^[a-zA-Z][a-zA-Z-]*$/.test(key)) continue;
    const prop = kebabCase(key);
    const v = typeof value === 'number' && /(width|height|size|padding|margin|top|left|right|bottom|gap|indent)/i.test(prop) ? `${round(value)}px` : themeValue(deck, value);
    if (v) out.push(`${prop}: ${v}`);
  }
  return out;
}

function renderElement(deck: Deck, el: DeckElement, opts: DeckHtmlOptions): string {
  const role = typeof el.style?.role === 'string' ? cssVarName(el.style.role) : undefined;
  const classes = ['el', `el-${el.type}`, ...(role ? [`role-${role}`] : [])];
  const data = [`data-sid="${escapeAttr(el.id)}"`, `data-el-type="${el.type}"`];
  if (el.build !== undefined) data.push(`data-build="${el.build}"`);
  if (el.name) data.push(`data-name="${escapeAttr(el.name)}"`);
  const style = [...geometry(el), ...elementCss(deck, el)];
  const open = (extraClass = '') => `<div class="${classes.join(' ')}${extraClass}" ${data.join(' ')} style="${escapeAttr(style.join('; '))}">`;
  switch (el.type) {
    case 'text':
      return `${open()}${markdownToHtml(el.text ?? '')}</div>`;
    case 'image': {
      const url = el.assetId ? safeAssetUrl(opts, el.assetId) : undefined;
      if (!url) return `${open(' el-missing')}Bild fehlt</div>`;
      const fit = sanitizeCssValue(String(el.style?.fit ?? el.style?.objectFit ?? 'cover'));
      const pos = el.style?.objectPosition !== undefined ? `; object-position: ${sanitizeCssValue(el.style.objectPosition)}` : '';
      return `${open()}<img src="${escapeAttr(url)}" alt="${escapeAttr(el.name ?? '')}" data-asset-id="${escapeAttr(el.assetId!)}" style="object-fit: ${fit}${pos}" decoding="sync"></div>`;
    }
    case 'video': {
      const url = el.assetId ? safeAssetUrl(opts, el.assetId) : undefined;
      if (!url) return `${open(' el-missing')}Video fehlt</div>`;
      const fit = sanitizeCssValue(String(el.style?.fit ?? el.style?.objectFit ?? 'cover'));
      const src = url.includes('#') ? url : `${url}#t=0.001`;
      return `${open()}<video src="${escapeAttr(src)}" muted playsinline preload="auto" data-asset-id="${escapeAttr(el.assetId!)}" style="object-fit: ${fit}"></video></div>`;
    }
    case 'shape':
      return `${open()}${shapeSvg(deck, el)}</div>`;
    case 'chart': {
      if (!el.chart) return `${open(' el-missing')}Diagramm ohne Daten</div>`;
      const fontSize = typeof el.style?.fontSize === 'number' ? el.style.fontSize : Math.max(14, Math.round(deck.height * 0.02));
      const svg = chartToSvg(el.chart, {
        width: el.width,
        height: el.height,
        colors: chartColors(deck),
        fontFamily: deck.theme.fonts.body,
        fontSize,
        textColor: deck.theme.colors.text ?? '#0b0b0b',
        mutedTextColor: deck.theme.colors.muted ?? '#52514e',
        surfaceColor: deck.theme.colors.background ?? deck.theme.background ?? '#ffffff',
        ...(deck.theme.colors.grid ? { gridColor: deck.theme.colors.grid } : {}),
      });
      return `${open()}${svg}</div>`;
    }
    case 'html': {
      const scope = `[data-sid="${el.id.replace(/["\\]/g, '')}"]`;
      const safe = scopeStyleBlocks(sanitizeHtml(el.html ?? ''), scope);
      return `${open()}${safe}</div>`;
    }
  }
}

function shapeSvg(deck: Deck, el: DeckElement): string {
  const s = el.style ?? {};
  const w = el.width;
  const h = el.height;
  const fill = s.fill !== undefined ? themeValue(deck, s.fill) : s.background !== undefined ? themeValue(deck, s.background) : el.shape === 'line' ? 'none' : 'var(--accent)';
  const stroke = s.stroke !== undefined ? themeValue(deck, s.stroke) : el.shape === 'line' ? 'currentColor' : 'none';
  const sw = typeof s.strokeWidth === 'number' ? s.strokeWidth : el.shape === 'line' ? Math.max(2, Math.round(deck.height * 0.003)) : 0;
  const radius = typeof s.radius === 'number' ? s.radius : typeof s.borderRadius === 'number' ? s.borderRadius : 0;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(w)} ${round(h)}" preserveAspectRatio="none" aria-hidden="true">`;
  const paint = `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${round(sw)}"`;
  switch (el.shape ?? 'rect') {
    case 'ellipse':
      return `${head}<ellipse cx="${round(w / 2)}" cy="${round(h / 2)}" rx="${round(Math.max(0, w / 2 - sw / 2))}" ry="${round(Math.max(0, h / 2 - sw / 2))}" ${paint}/></svg>`;
    case 'line': {
      const diagonal = s.diagonal === 'true' || s.diagonal === 1;
      const [x1, y1, x2, y2] = diagonal ? [0, 0, w, h] : w >= h ? [0, h / 2, w, h / 2] : [w / 2, 0, w / 2, h];
      return `${head}<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${escapeAttr(stroke)}" stroke-width="${round(sw)}" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
    }
    case 'rect':
    default:
      return `${head}<rect x="${round(sw / 2)}" y="${round(sw / 2)}" width="${round(Math.max(0, w - sw))}" height="${round(Math.max(0, h - sw))}" rx="${round(radius)}" ${paint}/></svg>`;
  }
}
