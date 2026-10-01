import type { Canvas, Layer } from '@studio/core';
import { hashString } from '../composition/random.ts';
import { PICKER_SCRIPT } from '../picker/picker-script.ts';
import { cssFontFamily, escapeAttr, escapeHtml, escapeScriptContent, normalizeBlendMode, round, safeId, sanitizeCssValue } from '../util/html.ts';
import { markdownToHtml, markdownToPlain } from '../util/markdown.ts';
import { isDangerousUrl } from '../util/sanitize.ts';

/**
 * Leinwand (Collage/Grafik) → geschichtetes SVG. Jede Ebene ist eine `<g data-sid="<layerId>">`.
 * Koordinaten in Leinwand-Einheiten (`px` oder `mm`); Kinder einer Gruppe haben absolute
 * Leinwandkoordinaten (wie in `@studio/core`), die Gruppe rotiert um ihren Mittelpunkt.
 *
 * Effekte werden als SVG-Filter angenähert: `shadow` (feDropShadow), `blur`, `outline`
 * (feMorphology), `grain` (feTurbulence + overlay), `paper` (Relief-Licht + multiply), `halftone`
 * (Punktraster per feImage/feTile + Schwellwert), `tear` (verschobene Alpha-Kante).
 */

export interface CanvasSvgOptions {
  /** URL eines Assets (Renderer: `studio-asset://…`; Render-Worker: `file://`/`http://`). */
  assetUrl: (assetId: string) => string;
  /** Beschnittzugabe (`canvas.bleed`) einbeziehen (Druck). Standard: false. */
  includeBleed?: boolean;
  /** Text als HTML in `foreignObject` (Standard; echter Umbruch, Silbentrennung) oder als reines SVG (`tspan`, geschätzter Umbruch). */
  textMode?: 'foreignObject' | 'tspan';
  /** Eigenmaße von Bild-Assets (Pixel) für exakten, unverzerrten Zuschnitt bei `crop`. */
  assetSize?: (assetId: string) => { width: number; height: number } | undefined;
  /** Präfix für interne IDs (mehrere SVGs auf einer Seite). */
  idPrefix?: string;
  /** Größenangabe des SVG-Elements: in Leinwand-Einheit (Standard) oder explizit (z. B. Pixel beim Rendern). */
  size?: { width: number | string; height: number | string };
}

interface Ctx {
  canvas: Canvas;
  opts: CanvasSvgOptions;
  defs: string[];
  prefix: string;
}

/** Pixelmaße der Leinwand (mm → px über `dpi`). */
export function canvasPixelSize(canvas: Pick<Canvas, 'width' | 'height' | 'unit' | 'dpi' | 'bleed'>, opts: { includeBleed?: boolean; dpi?: number } = {}): { width: number; height: number } {
  const b = opts.includeBleed ? canvas.bleed : 0;
  const w = canvas.width + 2 * b;
  const h = canvas.height + 2 * b;
  if (canvas.unit === 'mm') {
    const dpi = opts.dpi ?? canvas.dpi;
    return { width: Math.round((w / 25.4) * dpi), height: Math.round((h / 25.4) * dpi) };
  }
  return { width: Math.round(w), height: Math.round(h) };
}

/** Physische Größe in CSS-Pixeln (96 px/inch) – für PDF-Seitengrößen. */
export function canvasCssSize(canvas: Pick<Canvas, 'width' | 'height' | 'unit' | 'dpi' | 'bleed'>, opts: { includeBleed?: boolean } = {}): { width: number; height: number } {
  const b = opts.includeBleed ? canvas.bleed : 0;
  const w = canvas.width + 2 * b;
  const h = canvas.height + 2 * b;
  if (canvas.unit === 'mm') return { width: round((w / 25.4) * 96, 2), height: round((h / 25.4) * 96, 2) };
  return { width: w, height: h };
}

export function canvasToSvg(canvas: Canvas, opts: CanvasSvgOptions): string {
  const ctx: Ctx = { canvas, opts, defs: [], prefix: opts.idPrefix ?? 'c' };
  const b = opts.includeBleed ? canvas.bleed : 0;
  const vbW = canvas.width + 2 * b;
  const vbH = canvas.height + 2 * b;
  const unit = canvas.unit === 'mm' ? 'mm' : '';
  const width = opts.size ? String(opts.size.width) : `${round(vbW)}${unit}`;
  const height = opts.size ? String(opts.size.height) : `${round(vbH)}${unit}`;
  const layers = canvas.layers.map((l) => renderLayer(ctx, l)).join('\n');
  const background = `<rect data-sid="__background" x="${round(-b)}" y="${round(-b)}" width="${round(vbW)}" height="${round(vbH)}" fill="${escapeAttr(sanitizeCssValue(canvas.background))}"/>`;
  const defs = ctx.defs.length ? `<defs>\n${ctx.defs.join('\n')}\n</defs>\n` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-sid="__canvas" width="${escapeAttr(width)}" height="${escapeAttr(height)}" viewBox="${round(-b)} ${round(-b)} ${round(vbW)} ${round(vbH)}" style="isolation: isolate">
${defs}${background}
${layers}
</svg>`;
}

export interface CanvasHtmlOptions extends CanvasSvgOptions {
  /** Picker-Skript einbetten (Bühne). */
  picker?: boolean;
  /** CSP `script-src 'none'` (bzw. Nonce für den Picker). Standard: true. */
  csp?: boolean;
  /** Anzeigegröße des SVG in CSS-Pixeln (Standard: Pixelmaße nach `dpi`). */
  cssSize?: { width: number; height: number };
  /** Zusätzliches CSS für `@page` (PDF): Seitengröße in CSS-Pixeln. */
  pageSize?: { width: number; height: number };
}

/** Leinwand als vollständiges HTML-Dokument (SVG inline). */
export function canvasToHtml(canvas: Canvas, opts: CanvasHtmlOptions): string {
  const css = opts.cssSize ?? canvasPixelSize(canvas, { includeBleed: !!opts.includeBleed });
  const svg = canvasToSvg(canvas, { ...opts, size: { width: css.width, height: css.height } });
  const nonce = opts.picker ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('') : undefined;
  const csp = opts.csp === false ? '' : `<meta http-equiv="Content-Security-Policy" content="script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; object-src 'none'; base-uri 'none'">`;
  const page = opts.pageSize ? `@page { size: ${opts.pageSize.width}px ${opts.pageSize.height}px; margin: 0; }` : '';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
${csp}
<title>Leinwand</title>
<style>${page}
html, body { margin: 0; padding: 0; background: transparent; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body > svg { display: block; }
</style>
</head>
<body>
${svg}
${nonce ? `<script nonce="${nonce}">${escapeScriptContent(PICKER_SCRIPT)}</script>` : ''}
</body>
</html>`;
}

function assetUrlSafe(ctx: Ctx, assetId: string): string | undefined {
  try {
    const url = ctx.opts.assetUrl(assetId);
    if (!url || isDangerousUrl(url)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function num(style: Layer['style'], key: string): number | undefined {
  const v = style?.[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function str(style: Layer['style'], key: string): string | undefined {
  const v = style?.[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

function renderLayer(ctx: Ctx, layer: Layer): string {
  if (layer.hidden) return '';
  const id = safeId(layer.id);
  const isGroup = layer.type === 'group';
  const attrs: string[] = [`data-sid="${escapeAttr(layer.id)}"`, `data-layer-type="${layer.type}"`];
  if (layer.name) attrs.push(`data-name="${escapeAttr(layer.name)}"`);
  const transforms: string[] = [];
  if (!isGroup && (layer.x || layer.y)) transforms.push(`translate(${round(layer.x)} ${round(layer.y)})`);
  if (layer.rotation) {
    const cx = isGroup ? layer.x + layer.width / 2 : layer.width / 2;
    const cy = isGroup ? layer.y + layer.height / 2 : layer.height / 2;
    transforms.push(`rotate(${round(layer.rotation)} ${round(cx)} ${round(cy)})`);
  }
  if (transforms.length) attrs.push(`transform="${transforms.join(' ')}"`);
  if (layer.opacity !== undefined && layer.opacity < 1) attrs.push(`opacity="${round(layer.opacity)}"`);
  const blend = normalizeBlendMode(layer.blend);
  if (blend) attrs.push(`style="mix-blend-mode: ${blend}"`);
  if (layer.effects?.length) {
    const box = isGroup ? { x: layer.x, y: layer.y, w: layer.width, h: layer.height } : { x: 0, y: 0, w: layer.width, h: layer.height };
    const filterId = `${ctx.prefix}-fx-${id}`;
    ctx.defs.push(buildFilter(filterId, layer, box));
    attrs.push(`filter="url(#${filterId})"`);
  }
  let content: string;
  if (isGroup) content = (layer.children ?? []).map((c) => renderLayer(ctx, c)).join('\n');
  else if (layer.type === 'image') content = imageContent(ctx, layer);
  else if (layer.type === 'text') content = textContent(ctx, layer);
  else content = shapeContent(layer);
  if (layer.maskAssetId) {
    const maskUrl = assetUrlSafe(ctx, layer.maskAssetId);
    if (maskUrl) {
      const maskId = `${ctx.prefix}-mask-${id}`;
      const box = isGroup ? { x: layer.x, y: layer.y } : { x: 0, y: 0 };
      const mode = str(layer.style, 'maskMode') === 'alpha' ? 'alpha' : 'luminance';
      const maskImage = imageMarkup(maskUrl, layer.width, layer.height, layer.crop, ctx.opts.assetSize?.(layer.maskAssetId), 'none', box);
      ctx.defs.push(`<mask id="${maskId}" maskUnits="userSpaceOnUse" x="${round(box.x)}" y="${round(box.y)}" width="${round(layer.width)}" height="${round(layer.height)}" style="mask-type: ${mode}">${maskImage}</mask>`);
      content = `<g mask="url(#${maskId})">${content}</g>`;
    }
  }
  return `<g ${attrs.join(' ')}>${content}</g>`;
}

const ALIGN: Record<string, string> = {
  center: 'xMidYMid',
  top: 'xMidYMin',
  bottom: 'xMidYMax',
  left: 'xMinYMid',
  right: 'xMaxYMid',
  'top-left': 'xMinYMin',
  'top-right': 'xMaxYMin',
  'bottom-left': 'xMinYMax',
  'bottom-right': 'xMaxYMax',
};

function imageMarkup(
  url: string,
  w: number,
  h: number,
  crop: Layer['crop'],
  size: { width: number; height: number } | undefined,
  fit: 'cover' | 'contain' | 'fill' | 'none',
  offset: { x: number; y: number } = { x: 0, y: 0 },
  align = 'xMidYMid',
): string {
  const href = `href="${escapeAttr(url)}" xlink:href="${escapeAttr(url)}"`;
  if (crop) {
    if (size && size.width > 0 && size.height > 0) {
      const vb = `${round(crop.x * size.width)} ${round(crop.y * size.height)} ${round(crop.width * size.width)} ${round(crop.height * size.height)}`;
      return `<svg x="${round(offset.x)}" y="${round(offset.y)}" width="${round(w)}" height="${round(h)}" viewBox="${vb}" preserveAspectRatio="${align} slice" overflow="hidden"><image ${href} x="0" y="0" width="${size.width}" height="${size.height}" preserveAspectRatio="none"/></svg>`;
    }
    const vb = `${round(crop.x, 5)} ${round(crop.y, 5)} ${round(crop.width, 5)} ${round(crop.height, 5)}`;
    return `<svg x="${round(offset.x)}" y="${round(offset.y)}" width="${round(w)}" height="${round(h)}" viewBox="${vb}" preserveAspectRatio="none" overflow="hidden"><image ${href} x="0" y="0" width="1" height="1" preserveAspectRatio="none"/></svg>`;
  }
  const par = fit === 'fill' ? 'none' : fit === 'contain' ? `${align} meet` : fit === 'none' ? `${align} meet` : `${align} slice`;
  return `<image ${href} x="${round(offset.x)}" y="${round(offset.y)}" width="${round(w)}" height="${round(h)}" preserveAspectRatio="${par}"/>`;
}

function imageContent(ctx: Ctx, layer: Layer): string {
  const url = layer.assetId ? assetUrlSafe(ctx, layer.assetId) : undefined;
  if (!url) {
    return `<rect width="${round(layer.width)}" height="${round(layer.height)}" fill="none" stroke="#888" stroke-dasharray="8 6" stroke-width="2"/><text x="${round(layer.width / 2)}" y="${round(layer.height / 2)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="#888">Bild fehlt</text>`;
  }
  const fitRaw = str(layer.style, 'fit') ?? str(layer.style, 'objectFit') ?? 'cover';
  const fit = (['cover', 'contain', 'fill', 'none'] as const).find((f) => f === fitRaw) ?? 'cover';
  const align = ALIGN[str(layer.style, 'position') ?? 'center'] ?? 'xMidYMid';
  const radius = num(layer.style, 'radius') ?? num(layer.style, 'borderRadius');
  const markup = imageMarkup(url, layer.width, layer.height, layer.crop, layer.assetId ? ctx.opts.assetSize?.(layer.assetId) : undefined, fit, { x: 0, y: 0 }, align);
  if (radius) {
    const clipId = `${ctx.prefix}-clip-${safeId(layer.id)}`;
    ctx.defs.push(`<clipPath id="${clipId}"><rect width="${round(layer.width)}" height="${round(layer.height)}" rx="${round(radius)}"/></clipPath>`);
    return `<g clip-path="url(#${clipId})">${markup}</g>`;
  }
  return markup;
}

function fontFamilyOf(layer: Layer): string {
  return cssFontFamily(str(layer.style, 'fontFamily') ?? str(layer.style, 'font') ?? 'Inter', 'system-ui, sans-serif');
}

function textContent(ctx: Ctx, layer: Layer): string {
  const s = layer.style;
  const fontSize = num(s, 'fontSize') ?? Math.max(8, Math.round(Math.min(layer.height, layer.width) * 0.2));
  const color = sanitizeCssValue(str(s, 'color') ?? '#111111');
  const weight = sanitizeCssValue(str(s, 'fontWeight') ?? '400');
  const italic = str(s, 'fontStyle') === 'italic';
  const lineHeight = num(s, 'lineHeight') ?? 1.2;
  const align = (str(s, 'align') ?? str(s, 'textAlign') ?? 'left') as 'left' | 'center' | 'right' | 'justify';
  const valign = str(s, 'valign') ?? str(s, 'verticalAlign') ?? 'top';
  const letterSpacing = num(s, 'letterSpacing');
  const transform = str(s, 'textTransform');
  const background = str(s, 'background');
  const padding = num(s, 'padding') ?? 0;
  const stroke = str(s, 'stroke');
  const strokeWidth = num(s, 'strokeWidth') ?? 0;
  const family = fontFamilyOf(layer);
  const text = layer.text ?? '';
  const bg = background ? `<rect width="${round(layer.width)}" height="${round(layer.height)}" fill="${escapeAttr(sanitizeCssValue(background))}" rx="${round(num(s, 'radius') ?? 0)}"/>` : '';
  if ((ctx.opts.textMode ?? 'foreignObject') === 'foreignObject') {
    const justify = valign === 'middle' || valign === 'center' ? 'center' : valign === 'bottom' ? 'flex-end' : 'flex-start';
    const css = [
      'width: 100%',
      'height: 100%',
      'box-sizing: border-box',
      'display: flex',
      'flex-direction: column',
      `justify-content: ${justify}`,
      `padding: ${round(padding)}px`,
      `font-family: ${family}`,
      `font-size: ${round(fontSize)}px`,
      `font-weight: ${weight}`,
      `font-style: ${italic ? 'italic' : 'normal'}`,
      `line-height: ${lineHeight}`,
      `color: ${color}`,
      `text-align: ${sanitizeCssValue(align)}`,
      'hyphens: auto',
      '-webkit-hyphens: auto',
      'overflow-wrap: break-word',
      'text-wrap: pretty',
      'overflow: visible',
      ...(letterSpacing !== undefined ? [`letter-spacing: ${round(letterSpacing)}px`] : []),
      ...(transform ? [`text-transform: ${sanitizeCssValue(transform)}`] : []),
      ...(stroke && strokeWidth ? [`-webkit-text-stroke: ${round(strokeWidth)}px ${sanitizeCssValue(stroke)}`, 'paint-order: stroke fill'] : []),
    ].join('; ');
    const html = markdownToHtml(text).replace(/<br>/g, '<br/>').replace(/<p>/g, '<p style="margin: 0 0 0.35em">');
    return `${bg}<foreignObject x="0" y="0" width="${round(layer.width)}" height="${round(layer.height)}" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml" lang="de" style="${escapeAttr(css)}">${html}</div></foreignObject>`;
  }
  // Reines SVG: Zeilen nach geschätzter Breite umbrechen.
  const plain = markdownToPlain(text);
  const transformed = transform === 'uppercase' ? plain.toLocaleUpperCase('de-DE') : transform === 'lowercase' ? plain.toLocaleLowerCase('de-DE') : plain;
  const lines = wrapText(transformed, Math.max(1, layer.width - 2 * padding), fontSize, letterSpacing ?? 0);
  const lh = fontSize * lineHeight;
  const blockH = lines.length * lh;
  const top = valign === 'middle' || valign === 'center' ? (layer.height - blockH) / 2 : valign === 'bottom' ? layer.height - padding - blockH : padding;
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const x = align === 'center' ? layer.width / 2 : align === 'right' ? layer.width - padding : padding;
  const tspans = lines
    .map((line, i) => `<tspan x="${round(x)}" y="${round(top + fontSize * 0.8 + i * lh)}">${escapeHtml(line)}</tspan>`)
    .join('');
  const strokeAttrs = stroke && strokeWidth ? ` stroke="${escapeAttr(sanitizeCssValue(stroke))}" stroke-width="${round(strokeWidth)}" paint-order="stroke"` : '';
  return `${bg}<text font-family="${escapeAttr(family)}" font-size="${round(fontSize)}" font-weight="${escapeAttr(weight)}"${italic ? ' font-style="italic"' : ''} fill="${escapeAttr(color)}" text-anchor="${anchor}"${letterSpacing !== undefined ? ` letter-spacing="${round(letterSpacing)}"` : ''}${strokeAttrs} xml:space="preserve">${tspans}</text>`;
}

/** Greedy-Umbruch nach geschätzter Zeichenbreite (0,55 em). */
export function wrapText(text: string, width: number, fontSize: number, letterSpacing = 0): string[] {
  const charW = fontSize * 0.55 + letterSpacing;
  const maxChars = Math.max(1, Math.floor(width / charW));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= maxChars) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > maxChars) {
        out.push(`${line.slice(0, maxChars - 1)}-`);
        line = line.slice(maxChars - 1);
      }
    }
    out.push(line);
  }
  return out;
}

function shapeContent(layer: Layer): string {
  const s = layer.style;
  const fill = sanitizeCssValue(str(s, 'fill') ?? str(s, 'background') ?? '#000000');
  const stroke = str(s, 'stroke');
  const sw = num(s, 'strokeWidth') ?? (stroke ? 1 : 0);
  const paint = `fill="${escapeAttr(fill)}"${stroke ? ` stroke="${escapeAttr(sanitizeCssValue(stroke))}" stroke-width="${round(sw)}"` : ''}`;
  const w = layer.width;
  const h = layer.height;
  switch (layer.shape ?? 'rect') {
    case 'ellipse':
      return `<ellipse cx="${round(w / 2)}" cy="${round(h / 2)}" rx="${round(w / 2)}" ry="${round(h / 2)}" ${paint}/>`;
    case 'path': {
      const d = (layer.path ?? '').replace(/[^MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]/g, '');
      const viewBox = str(s, 'viewBox');
      if (viewBox && /^[\d.\s,-]+$/.test(viewBox)) {
        return `<svg width="${round(w)}" height="${round(h)}" viewBox="${escapeAttr(viewBox)}" preserveAspectRatio="none" overflow="visible"><path d="${escapeAttr(d)}" ${paint} vector-effect="non-scaling-stroke"/></svg>`;
      }
      return `<path d="${escapeAttr(d)}" ${paint}/>`;
    }
    case 'rect':
    default: {
      const r = num(s, 'radius') ?? num(s, 'borderRadius') ?? 0;
      return `<rect width="${round(w)}" height="${round(h)}"${r ? ` rx="${round(r)}"` : ''} ${paint}/>`;
    }
  }
}

function p(effect: { params: Record<string, string | number | boolean> }, key: string, fallback: number): number {
  const v = effect.params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function pc(effect: { params: Record<string, string | number | boolean> }, key: string, fallback: string): string {
  const v = effect.params[key];
  return typeof v === 'string' ? sanitizeCssValue(v) : fallback;
}

/** Baut einen Filter aus der Effektkette einer Ebene (Reihenfolge wie im Dokument). */
function buildFilter(id: string, layer: Layer, box: { x: number; y: number; w: number; h: number }): string {
  const effects = layer.effects ?? [];
  const seedBase = hashString(layer.id) % 10000;
  const prims: string[] = [];
  let cur = 'SourceGraphic';
  let margin = 2;
  effects.forEach((effect, i) => {
    const r = `e${i}`;
    const seed = Math.round(p(effect, 'seed', seedBase + i));
    switch (effect.type) {
      case 'shadow': {
        const dx = p(effect, 'dx', 0);
        const dy = p(effect, 'dy', Math.max(2, Math.min(box.w, box.h) * 0.02));
        const blur = p(effect, 'blur', Math.max(2, Math.min(box.w, box.h) * 0.03));
        const color = pc(effect, 'color', '#000000');
        const opacity = p(effect, 'opacity', 0.35);
        prims.push(`<feDropShadow in="${cur}" dx="${round(dx)}" dy="${round(dy)}" stdDeviation="${round(blur / 2)}" flood-color="${escapeAttr(color)}" flood-opacity="${round(opacity)}" result="${r}"/>`);
        margin += Math.abs(dx) + Math.abs(dy) + blur * 2;
        break;
      }
      case 'blur': {
        const radius = p(effect, 'radius', p(effect, 'amount', 4));
        prims.push(`<feGaussianBlur in="${cur}" stdDeviation="${round(radius)}" result="${r}"/>`);
        margin += radius * 3;
        break;
      }
      case 'outline': {
        const width = p(effect, 'width', 4);
        const color = pc(effect, 'color', '#ffffff');
        prims.push(
          `<feMorphology in="${cur}" operator="dilate" radius="${round(width)}" result="${r}d"/>`,
          `<feFlood flood-color="${escapeAttr(color)}" result="${r}f"/>`,
          `<feComposite in="${r}f" in2="${r}d" operator="in" result="${r}o"/>`,
          `<feMerge result="${r}"><feMergeNode in="${r}o"/><feMergeNode in="${cur}"/></feMerge>`,
        );
        margin += width + 2;
        break;
      }
      case 'grain': {
        const amount = Math.min(1, Math.max(0, p(effect, 'amount', 0.25)));
        const size = p(effect, 'size', 0.9);
        prims.push(
          `<feTurbulence type="fractalNoise" baseFrequency="${round(size)}" numOctaves="2" seed="${seed}" stitchTiles="stitch" result="${r}n"/>`,
          `<feColorMatrix in="${r}n" type="matrix" values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1" result="${r}g"/>`,
          `<feBlend in="${cur}" in2="${r}g" mode="overlay" result="${r}b"/>`,
          `<feComposite in="${r}b" in2="${cur}" operator="arithmetic" k1="0" k2="${round(amount)}" k3="${round(1 - amount)}" k4="0" result="${r}m"/>`,
          `<feComposite in="${r}m" in2="${cur}" operator="in" result="${r}"/>`,
        );
        break;
      }
      case 'paper': {
        const amount = Math.min(1, Math.max(0, p(effect, 'amount', 0.35)));
        const scale = p(effect, 'scale', 0.04);
        const tint = pc(effect, 'color', '#ffffff');
        prims.push(
          `<feTurbulence type="fractalNoise" baseFrequency="${round(scale, 4)}" numOctaves="4" seed="${seed}" result="${r}n"/>`,
          `<feDiffuseLighting in="${r}n" lighting-color="${escapeAttr(tint)}" surfaceScale="2" result="${r}l"><feDistantLight azimuth="45" elevation="60"/></feDiffuseLighting>`,
          `<feBlend in="${cur}" in2="${r}l" mode="multiply" result="${r}b"/>`,
          `<feComposite in="${r}b" in2="${cur}" operator="arithmetic" k1="0" k2="${round(amount)}" k3="${round(1 - amount)}" k4="0" result="${r}m"/>`,
          `<feComposite in="${r}m" in2="${cur}" operator="in" result="${r}"/>`,
        );
        break;
      }
      case 'halftone': {
        const size = Math.max(2, p(effect, 'size', 8));
        // Ohne `color`: Punkte in der Farbe der Quelle; mit `color`: einfarbige Druckfarbe.
        const inkColor = typeof effect.params.color === 'string' ? hexToRgb01(pc(effect, 'color', '#000000')) : undefined;
        const tile = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><defs><radialGradient id='g'><stop offset='0' stop-color='black'/><stop offset='1' stop-color='white'/></radialGradient></defs><rect width='${size}' height='${size}' fill='url(#g)'/></svg>`;
        const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tile)}`;
        prims.push(
          `<feColorMatrix in="${cur}" type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 0 1" result="${r}g"/>`,
          `<feImage href="${escapeAttr(href)}" xlink:href="${escapeAttr(href)}" x="${round(box.x)}" y="${round(box.y)}" width="${size}" height="${size}" result="${r}t"/>`,
          `<feTile in="${r}t" result="${r}d"/>`,
          `<feComposite in="${r}g" in2="${r}d" operator="arithmetic" k1="0" k2="1" k3="1" k4="-0.5" result="${r}s"/>`,
          `<feComponentTransfer in="${r}s" result="${r}w"><feFuncR type="discrete" tableValues="0 1"/><feFuncG type="discrete" tableValues="0 1"/><feFuncB type="discrete" tableValues="0 1"/></feComponentTransfer>`,
          // Maske: Deckkraft = 1 − Helligkeit (Punkt = deckend)
          `<feColorMatrix in="${r}w" type="matrix" values="0 0 0 0 ${inkColor?.r ?? 0} 0 0 0 0 ${inkColor?.g ?? 0} 0 0 0 0 ${inkColor?.b ?? 0} -1 0 0 0 1" result="${r}i"/>`,
          inkColor
            ? `<feComposite in="${r}i" in2="${cur}" operator="in" result="${r}"/>`
            : `<feComposite in="${cur}" in2="${r}i" operator="in" result="${r}"/>`,
        );
        break;
      }
      case 'tear': {
        const amount = p(effect, 'amount', 12);
        const freq = p(effect, 'frequency', 0.05);
        prims.push(
          `<feTurbulence type="fractalNoise" baseFrequency="${round(freq, 4)}" numOctaves="3" seed="${seed}" result="${r}n"/>`,
          `<feColorMatrix in="${cur}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="${r}a"/>`,
          `<feDisplacementMap in="${r}a" in2="${r}n" scale="${round(amount)}" xChannelSelector="R" yChannelSelector="G" result="${r}r"/>`,
          `<feComposite in="${cur}" in2="${r}r" operator="in" result="${r}"/>`,
        );
        margin += amount;
        break;
      }
    }
    cur = r;
  });
  const fx = round(box.x - margin);
  const fy = round(box.y - margin);
  return `<filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="${fx}" y="${fy}" width="${round(box.w + 2 * margin)}" height="${round(box.h + 2 * margin)}" color-interpolation-filters="sRGB">${prims.join('')}</filter>`;
}

function hexToRgb01(color: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return {
    r: round(parseInt(hex.slice(0, 2), 16) / 255),
    g: round(parseInt(hex.slice(2, 4), 16) / 255),
    b: round(parseInt(hex.slice(4, 6), 16) / 255),
  };
}
