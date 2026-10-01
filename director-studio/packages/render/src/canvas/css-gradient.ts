import { escapeAttr, round, sanitizeCssValue } from '../util/html.ts';

/**
 * CSS-Hintergründe (`canvas.background`) als SVG: Farben direkt als `fill`, `linear-gradient(…)` und
 * `radial-gradient(…)` als SVG-Verläufe (Winkel/`to …`, Farbstopps in % oder px, `at …`-Position).
 * Was sich nicht übersetzen lässt (z. B. `repeating-*`, `conic-gradient`, Bild-URLs), wird – sofern
 * erlaubt – als HTML-Fläche in `foreignObject` gezeichnet, sonst mit der ersten erkennbaren Farbe.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BackgroundSvgOptions {
  /** ID des Verlaufs in `<defs>`. */
  id: string;
  /** Hierhin werden Verläufe (`<linearGradient>`/`<radialGradient>`) geschrieben. */
  defs: string[];
  /** Zusätzliche Attribute des Elements (z. B. `data-sid="__background"`). */
  attrs?: string;
  /** Nicht übersetzbare Hintergründe als HTML-Fläche (`foreignObject`) zeichnen. Standard: true. */
  foreignObject?: boolean;
}

interface Stop {
  color: string;
  /** 0..1, `undefined` = gleichmäßig verteilen. */
  offset: number | undefined;
}

/** Teilt an Kommas der obersten Ebene (Kommas in `rgb(…)` bleiben). */
function splitTopLevel(value: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Leerzeichen-getrennte Teile auf oberster Ebene (`rgb(1, 2, 3) 40%` → 2 Teile). */
function splitSpaces(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function parseAngle(token: string): number | undefined {
  const m = /^(-?\d*\.?\d+)(deg|turn|rad|grad)$/i.exec(token.trim());
  if (!m) return undefined;
  const v = Number(m[1]);
  switch (m[2]!.toLowerCase()) {
    case 'turn':
      return v * 360;
    case 'rad':
      return (v * 180) / Math.PI;
    case 'grad':
      return v * 0.9;
    default:
      return v;
  }
}

function parseStops(parts: string[], lengthPx: number): Stop[] | undefined {
  const stops: Stop[] = [];
  for (const part of parts) {
    const tokens = splitSpaces(part);
    if (!tokens.length) return undefined;
    const color = tokens[0]!;
    if (/^-?\d/.test(color)) return undefined; // Farbhinweise (`50%` allein) nicht unterstützt
    const positions = tokens.slice(1).map((t) => {
      const m = /^(-?\d*\.?\d+)(%|px)?$/.exec(t);
      if (!m) return Number.NaN;
      const v = Number(m[1]);
      return m[2] === 'px' ? v / Math.max(1e-6, lengthPx) : v / 100;
    });
    if (positions.some((p) => Number.isNaN(p))) return undefined;
    if (positions.length === 0) stops.push({ color, offset: undefined });
    for (const p of positions) stops.push({ color, offset: p });
  }
  if (stops.length < 2) return stops.length === 1 ? [stops[0]!, { ...stops[0]! }] : undefined;
  // Fehlende Positionen: Anfang 0, Ende 1, dazwischen gleichmäßig; Positionen monoton machen.
  if (stops[0]!.offset === undefined) stops[0]!.offset = 0;
  if (stops.at(-1)!.offset === undefined) stops.at(-1)!.offset = 1;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i]!.offset !== undefined) continue;
    let j = i;
    while (stops[j]!.offset === undefined) j++;
    const a = stops[i - 1]!.offset!;
    const b = stops[j]!.offset!;
    for (let k = i; k < j; k++) stops[k]!.offset = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  let max = -Infinity;
  for (const s of stops) {
    s.offset = Math.max(max, s.offset!);
    max = s.offset;
  }
  return stops;
}

function stopsSvg(stops: Stop[]): string {
  return stops
    .map((s) => {
      const color = sanitizeCssValue(s.color);
      return `<stop offset="${round(Math.min(1, Math.max(0, s.offset ?? 0)), 4)}" stop-color="${escapeAttr(color)}"/>`;
    })
    .join('');
}

const SIDE_ANGLES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };

function linearAngle(first: string, box: Box): number | undefined {
  const angle = parseAngle(first);
  if (angle !== undefined) return angle;
  const m = /^to\s+(top|bottom|left|right)(?:\s+(top|bottom|left|right))?$/i.exec(first.trim());
  if (!m) return undefined;
  const a = m[1]!.toLowerCase();
  const b = m[2]?.toLowerCase();
  if (!b) return SIDE_ANGLES[a];
  const vertical = a === 'top' || a === 'bottom' ? a : b;
  const horizontal = a === 'left' || a === 'right' ? a : b;
  if (vertical === horizontal) return undefined;
  // Ecken: Verlaufslinie senkrecht zur Diagonale der beiden Nachbarecken (CSS Images 3).
  const base = (Math.atan2(box.height, box.width) * 180) / Math.PI;
  if (vertical === 'top') return horizontal === 'right' ? base : 360 - base;
  return horizontal === 'right' ? 180 - base : 180 + base;
}

function linearGradientSvg(args: string[], box: Box, id: string): string | undefined {
  let angle = 180;
  let stopArgs = args;
  const first = args[0] ?? '';
  const parsedAngle = linearAngle(first, box);
  if (parsedAngle !== undefined) {
    angle = parsedAngle;
    stopArgs = args.slice(1);
  } else if (/^to\s/i.test(first) || /^-?\d/.test(first)) return undefined;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const length = Math.abs(box.width * dx) + Math.abs(box.height * dy);
  const stops = parseStops(stopArgs, length);
  if (!stops) return undefined;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const half = length / 2;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${round(cx - dx * half)}" y1="${round(cy - dy * half)}" x2="${round(cx + dx * half)}" y2="${round(cy + dy * half)}">${stopsSvg(stops)}</linearGradient>`;
}

function positionComponent(token: string | undefined, horizontal: boolean): number | undefined {
  if (token === undefined) return 0.5;
  const t = token.toLowerCase();
  if (t === 'center') return 0.5;
  if (horizontal && (t === 'left' || t === 'right')) return t === 'left' ? 0 : 1;
  if (!horizontal && (t === 'top' || t === 'bottom')) return t === 'top' ? 0 : 1;
  const m = /^(-?\d*\.?\d+)%$/.exec(t);
  return m ? Number(m[1]) / 100 : undefined;
}

function radialGradientSvg(args: string[], box: Box, id: string): string | undefined {
  let stopArgs = args;
  let circle = false;
  let px = 0.5;
  let py = 0.5;
  const first = args[0] ?? '';
  const isShapeArg = /^(circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner)\b|^at\s/i.test(first.trim()) || /\sat\s/i.test(first);
  if (isShapeArg) {
    stopArgs = args.slice(1);
    const [shapePart, atPart] = first.split(/\bat\b/i).map((p) => p.trim());
    const shapeTokens = (shapePart ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (shapeTokens.some((t) => t !== 'circle' && t !== 'ellipse' && t !== 'farthest-corner')) return undefined; // andere Größen nicht unterstützt
    circle = shapeTokens.includes('circle');
    if (atPart) {
      const pos = atPart.split(/\s+/).filter(Boolean);
      // Reihenfolge `at top left` erlauben.
      let hx = pos[0];
      let vy = pos[1];
      if (hx && (hx === 'top' || hx === 'bottom')) [hx, vy] = [vy ?? 'center', hx];
      const x = positionComponent(hx, true);
      const y = positionComponent(vy, false);
      if (x === undefined || y === undefined) return undefined;
      px = x;
      py = y;
    }
  }
  const cx = box.x + box.width * px;
  const cy = box.y + box.height * py;
  const farX = Math.max(px, 1 - px) * box.width;
  const farY = Math.max(py, 1 - py) * box.height;
  if (circle) {
    const r = Math.hypot(farX, farY);
    const stops = parseStops(stopArgs, r);
    if (!stops) return undefined;
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}">${stopsSvg(stops)}</radialGradient>`;
  }
  // Ellipse (farthest-corner): Radien im Verhältnis der Abstände, skaliert per gradientTransform.
  const rx = farX * Math.SQRT2;
  const ry = farY * Math.SQRT2;
  if (!(rx > 0) || !(ry > 0)) return undefined;
  const stops = parseStops(stopArgs, rx);
  if (!stops) return undefined;
  const sy = ry / rx;
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${round(cx)}" cy="${round(cy)}" r="${round(rx)}" gradientTransform="translate(0 ${round(cy)}) scale(1 ${round(sy, 5)}) translate(0 ${round(-cy)})">${stopsSvg(stops)}</radialGradient>`;
}

/** Erste erkennbare Farbe in einem CSS-Wert (Fallback für reines SVG). */
function firstColor(value: string): string | undefined {
  const m = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)/i.exec(value);
  return m?.[0];
}

/** Ist der Wert ein (von uns verstandener) CSS-Verlauf? */
export function isCssGradient(value: string): boolean {
  return /gradient\s*\(/i.test(value);
}

/**
 * Fläche `box` mit einem CSS-Hintergrund füllen. Liefert das SVG-Element; Verläufe landen in `opts.defs`.
 */
export function cssBackgroundToSvg(value: string, box: Box, opts: BackgroundSvgOptions): string {
  const attrs = opts.attrs ? `${opts.attrs} ` : '';
  const rect = (fill: string) => `<rect ${attrs}x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}" fill="${escapeAttr(fill)}"/>`;
  const clean = sanitizeCssValue(value);
  if (!/(?:gradient|url)\s*\(/i.test(clean)) return rect(clean);
  // Mehrere Ebenen (`a, b`) werden nicht übersetzt; nur ein einzelner Verlauf.
  const m = /^(linear|radial)-gradient\s*\(([\s\S]*)\)$/i.exec(clean.trim());
  if (m && splitTopLevel(clean.trim()).length === 1) {
    const args = splitTopLevel(m[2]!);
    const def = m[1]!.toLowerCase() === 'linear' ? linearGradientSvg(args, box, opts.id) : radialGradientSvg(args, box, opts.id);
    if (def) {
      opts.defs.push(def);
      return rect(`url(#${opts.id})`);
    }
  }
  if (opts.foreignObject !== false && !/url\s*\(/i.test(clean)) {
    return `<foreignObject ${attrs}x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}"><div xmlns="http://www.w3.org/1999/xhtml" style="${escapeAttr(`width: 100%; height: 100%; background: ${clean}`)}"></div></foreignObject>`;
  }
  return rect(firstColor(clean) ?? '#000000');
}
