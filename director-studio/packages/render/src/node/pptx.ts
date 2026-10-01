import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import type { Deck, DeckElement, Slide } from '@studio/core';
import { parseBlocks } from '../util/markdown.ts';
import { deckToHtml } from '../deck/deck-html.ts';
import { DEFAULT_CHART_COLORS } from '../deck/chart-svg.ts';
import type { BrowserPool } from './chromium.ts';
import { renderHtmlToPng } from './html-render.ts';
import { readImageSize } from './image-size.ts';

/**
 * Deck → editierbares PPTX über pptxgenjs: Foliengröße (16:9 → 13,333 × 7,5 Zoll), Text mit
 * Schrift/Größe/Farbe/fett/kursiv/Ausrichtung, Bilder (cover/contain), Videos, Formen, native
 * Diagramme, Sprechernotizen, Hintergründe, ausgeblendete Folien. HTML-Blöcke lassen sich nicht nativ
 * abbilden: mit `rasterizeHtml` werden sie als Bild gerendert (Chromium), sonst als reiner Text.
 * Hinweis: Schriften werden nur benannt, nicht eingebettet (Empfänger brauchen sie installiert).
 */

export interface DeckToPptxOptions {
  /** Lokaler Dateipfad eines Assets (Bild/Video) oder `undefined`, wenn nicht verfügbar. */
  assetPath: (assetId: string) => string | undefined;
  /** HTML-Elemente als Bild rendern (braucht Chromium). Standard: false (Text-Fallback). */
  rasterizeHtml?: boolean;
  /** Browser-Pool für `rasterizeHtml`. */
  pool?: BrowserPool;
  /** Folienbreite in Zoll (Standard 13,333 = PowerPoint-Breitbild). */
  slideWidthInches?: number;
}

const ROLE_SIZES: Record<string, number> = { title: 0.074, subtitle: 0.044, body: 0.033, caption: 0.022, kicker: 0.02, quote: 0.05, stat: 0.13 };
const HEADING_ROLES = new Set(['title', 'subtitle', 'stat', 'quote']);

const NAMED: Record<string, string> = {
  white: 'FFFFFF',
  black: '000000',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  gray: '808080',
  grey: '808080',
  yellow: 'FFFF00',
  orange: 'FFA500',
};

/** CSS-Farbe → pptx-Hex (6-stellig, ohne #) + Transparenz in Prozent. 8-stelliges Hex würde PPTX beschädigen. */
export function toPptxColor(value: string | number | undefined, deck?: Deck): { color: string; transparency?: number } | undefined {
  if (value === undefined) return undefined;
  let v = String(value).trim();
  if (deck) {
    const key = v.startsWith('$') ? v.slice(1) : v;
    if (Object.prototype.hasOwnProperty.call(deck.theme.colors, key)) v = deck.theme.colors[key]!.trim();
    const varMatch = /^var\(--color-([\w-]+)\)$/.exec(v);
    if (varMatch && deck.theme.colors[varMatch[1]!]) v = deck.theme.colors[varMatch[1]!]!.trim();
  }
  const lower = v.toLowerCase();
  if (lower === 'transparent' || lower === 'none') return undefined;
  if (NAMED[lower]) return { color: NAMED[lower]! };
  let m = /^#?([0-9a-f]{3,4})$/i.exec(v);
  if (m) {
    const hex = m[1]!.split('').map((c) => c + c).join('');
    return withAlpha(hex.slice(0, 6), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1);
  }
  m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (m) return withAlpha(m[1]!.toUpperCase(), m[2] ? parseInt(m[2], 16) / 255 : 1);
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v);
  if (m) {
    const hex = [m[1], m[2], m[3]].map((c) => Math.max(0, Math.min(255, Math.round(Number(c)))).toString(16).padStart(2, '0')).join('').toUpperCase();
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    return withAlpha(hex, a);
  }
  return undefined;
}

function withAlpha(hex: string, alpha: number): { color: string; transparency?: number } {
  const t = Math.round((1 - Math.max(0, Math.min(1, alpha))) * 100);
  return t > 0 ? { color: hex.toUpperCase(), transparency: t } : { color: hex.toUpperCase() };
}

function firstFamily(value: string): string {
  return value.split(',')[0]!.trim().replace(/["']/g, '');
}

function fontFace(deck: Deck, el: DeckElement): string {
  const s = el.style ?? {};
  const raw = s.fontFamily ?? s.font;
  if (raw === 'heading') return firstFamily(deck.theme.fonts.heading);
  if (raw === 'body') return firstFamily(deck.theme.fonts.body);
  if (raw === 'mono') return firstFamily(deck.theme.fonts.mono ?? 'Consolas');
  if (typeof raw === 'string' && raw) return firstFamily(raw);
  const role = typeof s.role === 'string' ? s.role : undefined;
  return firstFamily(role && HEADING_ROLES.has(role) ? deck.theme.fonts.heading : deck.theme.fonts.body);
}

export async function deckToPptx(deck: Deck, opts: DeckToPptxOptions): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  // 12 192 000 EMU = Standardbreite von PowerPoint (16:9 → 13,333 × 7,5 Zoll)
  const slideW = opts.slideWidthInches ?? 12192000 / 914400;
  const inPerPx = slideW / deck.width;
  const ptPerPx = inPerPx * 72;
  pptx.defineLayout({ name: 'STUDIO', width: slideW, height: round(deck.height * inPerPx, 6) });
  pptx.layout = 'STUDIO';
  pptx.author = 'Director Studio';
  pptx.company = 'Director Studio';
  pptx.title = deck.theme.name ?? 'Präsentation';
  pptx.theme = { headFontFace: firstFamily(deck.theme.fonts.heading), bodyFontFace: firstFamily(deck.theme.fonts.body) };
  const tmpDir = opts.rasterizeHtml ? await mkdtemp(path.join(os.tmpdir(), 'studio-pptx-')) : undefined;
  try {
    for (const slide of deck.slides) {
      const s = pptx.addSlide();
      if (slide.hidden) (s as unknown as { hidden: boolean }).hidden = true;
      applyBackground(deck, slide, s, opts);
      const elements = slide.elements
        .map((el, order) => ({ el, order }))
        .sort((a, b) => (a.el.z ?? 0) - (b.el.z ?? 0) || a.order - b.order)
        .map(({ el }) => el);
      for (const el of elements) await addElement(pptx, s, deck, el, { ...opts, inPerPx, ptPerPx, tmpDir });
      if (slide.notes) s.addNotes(slide.notes);
    }
    const out = await pptx.write({ outputType: 'uint8array', compression: true });
    if (out instanceof Uint8Array) return out;
    if (out instanceof ArrayBuffer) return new Uint8Array(out);
    throw new Error('pptxgenjs lieferte kein Binärformat');
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  }
}

function applyBackground(deck: Deck, slide: Slide, s: PptxGenJS.Slide, opts: DeckToPptxOptions): void {
  if (slide.background && typeof slide.background === 'object') {
    const p = opts.assetPath(slide.background.assetId);
    if (p) {
      s.background = { path: p };
      return;
    }
  }
  const color = toPptxColor(typeof slide.background === 'string' ? slide.background : (deck.theme.background ?? deck.theme.colors.background ?? '#FFFFFF'), deck);
  if (color) s.background = { color: color.color, ...(color.transparency ? { transparency: color.transparency } : {}) };
}

interface Ctx extends DeckToPptxOptions {
  inPerPx: number;
  ptPerPx: number;
  tmpDir: string | undefined;
}

function round(v: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

async function addElement(pptx: PptxGenJS, s: PptxGenJS.Slide, deck: Deck, el: DeckElement, ctx: Ctx): Promise<void> {
  const box = { x: round(el.x * ctx.inPerPx), y: round(el.y * ctx.inPerPx), w: round(el.width * ctx.inPerPx), h: round(el.height * ctx.inPerPx) };
  const rotate = el.rotation ? Math.round(el.rotation) : undefined;
  const style = el.style ?? {};
  switch (el.type) {
    case 'text':
      addTextElement(s, deck, el, el.text ?? '', box, ctx);
      return;
    case 'image': {
      const p = el.assetId ? ctx.assetPath(el.assetId) : undefined;
      if (!p) return addPlaceholder(pptx, s, box, 'Bild fehlt');
      const size = await readImageSize(p).catch(() => undefined);
      const fit = String(style.fit ?? style.objectFit ?? 'cover');
      if (size && (fit === 'cover' || fit === 'contain')) {
        const aspect = size.height / size.width;
        s.addImage({ path: p, x: box.x, y: box.y, w: box.w, h: round(box.w * aspect), sizing: { type: fit, w: box.w, h: box.h }, ...(rotate ? { rotate } : {}), altText: el.name ?? '' });
      } else {
        s.addImage({ path: p, ...box, ...(rotate ? { rotate } : {}), altText: el.name ?? '' });
      }
      return;
    }
    case 'video': {
      const p = el.assetId ? ctx.assetPath(el.assetId) : undefined;
      if (!p) return addPlaceholder(pptx, s, box, 'Video fehlt');
      s.addMedia({ type: 'video', path: p, ...box });
      return;
    }
    case 'shape': {
      const fill = toPptxColor(style.fill ?? style.background ?? (el.shape === 'line' ? undefined : (deck.theme.colors.accent ?? deck.theme.colors.primary ?? '#2A78D6')), deck);
      const stroke = toPptxColor(style.stroke ?? (el.shape === 'line' ? (deck.theme.colors.text ?? '#141414') : undefined), deck);
      const strokeWidth = typeof style.strokeWidth === 'number' ? style.strokeWidth * ctx.ptPerPx : el.shape === 'line' ? Math.max(1, 3 * ctx.ptPerPx) : 0;
      const radius = typeof style.radius === 'number' ? style.radius : typeof style.borderRadius === 'number' ? style.borderRadius : 0;
      const shapeType = el.shape === 'ellipse' ? pptx.ShapeType.ellipse : el.shape === 'line' ? pptx.ShapeType.line : radius > 0 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
      const lineBox = el.shape === 'line' ? (el.width >= el.height ? { ...box, y: round(box.y + box.h / 2), h: 0 } : { ...box, x: round(box.x + box.w / 2), w: 0 }) : box;
      s.addShape(shapeType, {
        ...lineBox,
        ...(fill && el.shape !== 'line' ? { fill: { color: fill.color, ...(fill.transparency ? { transparency: fill.transparency } : {}) } } : { fill: { type: 'none' } }),
        ...(stroke && strokeWidth > 0 ? { line: { color: stroke.color, width: round(strokeWidth, 2) } } : { line: { type: 'none' } }),
        ...(radius > 0 && el.shape !== 'ellipse' && el.shape !== 'line' ? { rectRadius: round(Math.min(0.5, radius / Math.min(el.width, el.height)), 3) } : {}),
        ...(rotate ? { rotate } : {}),
      });
      return;
    }
    case 'chart': {
      const chart = el.chart;
      if (!chart) return;
      const colors = chartColors(deck);
      const data = chart.type === 'pie' ? [{ name: chart.series[0]?.name ?? '', labels: chart.labels, values: chart.series[0]?.values ?? [] }] : chart.series.map((sr) => ({ name: sr.name, labels: chart.labels, values: sr.values }));
      const fontSize = Math.max(8, Math.round((typeof style.fontSize === 'number' ? style.fontSize : deck.height * 0.02) * ctx.ptPerPx));
      const text = toPptxColor(deck.theme.colors.muted ?? '#52514E', deck)?.color ?? '52514E';
      const type = chart.type === 'bar' ? pptx.ChartType.bar : chart.type === 'line' ? pptx.ChartType.line : pptx.ChartType.pie;
      s.addChart(type, data, {
        ...box,
        chartColors: colors,
        showLegend: chart.type === 'pie' || chart.series.length > 1,
        legendPos: chart.type === 'pie' ? 'r' : 't',
        legendFontSize: fontSize,
        legendFontFace: firstFamily(deck.theme.fonts.body),
        legendColor: text,
        catAxisLabelColor: text,
        valAxisLabelColor: text,
        catAxisLabelFontSize: fontSize,
        valAxisLabelFontSize: fontSize,
        catAxisLabelFontFace: firstFamily(deck.theme.fonts.body),
        valAxisLabelFontFace: firstFamily(deck.theme.fonts.body),
        valGridLine: { color: 'E4E2DD', size: 0.75 },
        catGridLine: { style: 'none' },
        ...(chart.type === 'bar' ? { barDir: 'col', barGrouping: 'clustered', barGapWidthPct: 60 } : {}),
        ...(chart.type === 'line' ? { lineSize: 2, lineDataSymbolSize: 7 } : {}),
        ...(chart.type === 'pie' ? { showPercent: true, dataLabelColor: 'FFFFFF', dataLabelFontSize: fontSize } : {}),
      });
      return;
    }
    case 'html': {
      if (ctx.rasterizeHtml && ctx.tmpDir) {
        const mini: Deck = {
          ...deck,
          theme: { ...deck.theme, background: 'transparent' },
          width: Math.max(1, Math.round(el.width)),
          height: Math.max(1, Math.round(el.height)),
          slides: [{ id: '__html', elements: [{ ...el, x: 0, y: 0, rotation: undefined }] }],
        } as Deck;
        const html = deckToHtml(mini, { mode: 'stage', assetUrl: () => '', pageBackground: 'transparent' });
        const file = path.join(ctx.tmpDir, `${el.id.replace(/[^\w-]/g, '_')}.png`);
        await renderHtmlToPng(html, { width: mini.width, height: mini.height, out: file, deviceScaleFactor: 2, transparent: true, ...(ctx.pool ? { pool: ctx.pool } : {}) });
        const data = (await readFile(file)).toString('base64');
        s.addImage({ data: `image/png;base64,${data}`, ...box, ...(rotate ? { rotate } : {}) });
        return;
      }
      const plain = (el.html ?? '')
        .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h\d|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      addTextElement(s, deck, el, plain, box, ctx);
      return;
    }
  }
}

function chartColors(deck: Deck): string[] {
  const c = deck.theme.colors;
  const numbered = Object.keys(c)
    .filter((k) => /^chart\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((k) => c[k]!);
  const list = numbered.length ? numbered : c.chart ? c.chart.split(',') : DEFAULT_CHART_COLORS;
  return list.map((v) => toPptxColor(v.trim(), deck)?.color).filter((v): v is string => !!v);
}

function addTextElement(s: PptxGenJS.Slide, deck: Deck, el: DeckElement, text: string, box: { x: number; y: number; w: number; h: number }, ctx: Ctx): void {
  const style = el.style ?? {};
  const role = typeof style.role === 'string' ? style.role : 'body';
  const sizePx = typeof style.fontSize === 'number' ? style.fontSize : deck.height * (ROLE_SIZES[role] ?? ROLE_SIZES.body!);
  const fontSize = Math.max(4, round(sizePx * ctx.ptPerPx, 1));
  const weight = style.fontWeight;
  const bold = weight === 'bold' || (typeof weight === 'number' && weight >= 600) || (typeof weight === 'string' && Number(weight) >= 600) || (weight === undefined && (role === 'title' || role === 'stat'));
  const italic = style.fontStyle === 'italic';
  const color = toPptxColor(style.color ?? (role === 'subtitle' || role === 'caption' ? (deck.theme.colors.muted ?? deck.theme.colors.text) : role === 'kicker' ? (deck.theme.colors.accent ?? deck.theme.colors.text) : deck.theme.colors.text) ?? '#141414', deck);
  const alignRaw = String(style.align ?? style.textAlign ?? 'left');
  const align = (['left', 'center', 'right', 'justify'] as const).find((a) => a === alignRaw) ?? 'left';
  const valignRaw = String(style.valign ?? style.verticalAlign ?? 'top');
  const valign = valignRaw === 'middle' || valignRaw === 'center' ? 'middle' : valignRaw === 'bottom' ? 'bottom' : 'top';
  const bg = toPptxColor(style.background ?? style.backgroundColor, deck);
  const runs: PptxGenJS.TextProps[] = [];
  const upper = role === 'kicker' || style.textTransform === 'uppercase';
  for (const block of parseBlocks(text)) {
    block.lines.forEach((line, li) => {
      const lineRuns = line.length ? line : [{ text: '' }];
      lineRuns.forEach((r, ri) => {
        const last = ri === lineRuns.length - 1;
        runs.push({
          text: upper ? r.text.toLocaleUpperCase('de-DE') : r.text,
          options: {
            ...(r.bold || bold ? { bold: true } : {}),
            ...(r.italic || italic ? { italic: true } : {}),
            ...(block.kind === 'bullet' && li === 0 ? { bullet: { indent: Math.round(fontSize * 1.1) } } : {}),
            ...(last ? { breakLine: true } : {}),
          },
        });
      });
    });
  }
  if (runs.length) {
    const lastRun = runs[runs.length - 1]!;
    if (lastRun.options) delete lastRun.options.breakLine;
  }
  const lineHeight = typeof style.lineHeight === 'number' ? style.lineHeight : HEADING_ROLES.has(role) ? 1.05 : 1.3;
  const letterSpacing = typeof style.letterSpacing === 'number' ? round(style.letterSpacing * ctx.ptPerPx, 2) : undefined;
  s.addText(runs.length ? runs : [{ text: '' }], {
    ...box,
    fontFace: fontFace(deck, el),
    fontSize,
    ...(color ? { color: color.color } : {}),
    align,
    valign,
    margin: 0,
    isTextBox: true,
    fit: 'none',
    lineSpacingMultiple: lineHeight,
    paraSpaceAfter: round(fontSize * 0.35, 1),
    ...(letterSpacing !== undefined ? { charSpacing: letterSpacing } : {}),
    ...(bg ? { fill: { color: bg.color, ...(bg.transparency ? { transparency: bg.transparency } : {}) } } : {}),
    ...(el.rotation ? { rotate: Math.round(el.rotation) } : {}),
  });
}

function addPlaceholder(pptx: PptxGenJS, s: PptxGenJS.Slide, box: { x: number; y: number; w: number; h: number }, label: string): void {
  s.addShape(pptx.ShapeType.rect, { ...box, fill: { color: 'F0EFEC' }, line: { color: '9A9893', width: 1, dashType: 'dash' } });
  s.addText(label, { ...box, align: 'center', valign: 'middle', fontSize: 12, color: '6B6A66', margin: 0 });
}
