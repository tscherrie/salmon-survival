import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from 'playwright';
import type { Canvas, Deck } from '@studio/core';
import { canvasCssSize, canvasPixelSize, canvasToHtml, canvasToSvg, type CanvasSvgOptions } from '../canvas/canvas-svg.ts';
import { deckToHtml, selectSlides, type DeckFontFace } from '../deck/deck-html.ts';
import { safeId } from '../util/html.ts';
import { getDefaultBrowserPool, type BrowserPool } from './chromium.ts';

/**
 * HTML → PNG/PDF über Chromium (Playwright). Das HTML wird in eine temporäre Datei geschrieben und
 * per `file://` geladen, damit lokale Asset-URLs (`file://…`) und relative Pfade funktionieren.
 * Fremde Hosts werden standardmäßig blockiert (local-first).
 */

export interface HtmlRenderBase {
  /** Eigener Browser-Pool (Standard: geteilter Pool). */
  pool?: BrowserPool;
  /** Basisverzeichnis für relative URLs (Standard: temporäres Verzeichnis). */
  baseDir?: string;
  /** Anfragen an fremde Hosts erlauben (Standard: false). */
  allowRemote?: boolean;
  /** Maximale Wartezeit auf Schriften/Bilder/Videos in ms (Standard 8000). */
  assetTimeoutMs?: number;
}

export interface HtmlToPngOptions extends HtmlRenderBase {
  width: number;
  height: number;
  out: string;
  deviceScaleFactor?: number;
  /** Ganze Seite statt Viewport. */
  fullPage?: boolean;
  /** Transparenter Hintergrund (nur PNG). */
  transparent?: boolean;
  /** Bildformat (Standard: aus der Dateiendung, sonst PNG). */
  type?: 'png' | 'jpeg';
  quality?: number;
}

export interface HtmlToPdfOptions extends HtmlRenderBase {
  /** Seitengröße in CSS-Pixeln (96 px/inch). `@page` im HTML hat Vorrang. */
  width: number;
  height: number;
  out: string;
}

async function withHtmlFile<T>(html: string, baseDir: string | undefined, fn: (url: string) => Promise<T>): Promise<T> {
  const dir = baseDir ?? (await mkdtemp(path.join(os.tmpdir(), 'studio-render-')));
  const file = path.join(dir, `.studio-render-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await writeFile(file, html, 'utf8');
  try {
    return await fn(pathToFileURL(file).href);
  } finally {
    if (baseDir) await rm(file, { force: true });
    else await rm(dir, { recursive: true, force: true });
  }
}

/** Wartet auf Schriften, Bilder und Videos (erstes Bild) – mit Zeitlimit. */
export async function waitForPageAssets(page: Page, timeoutMs = 8000): Promise<void> {
  await page
    .evaluate(async (timeout: number) => {
      const deadline = new Promise<void>((resolve) => setTimeout(resolve, timeout));
      const work = (async () => {
        await document.fonts?.ready;
        const images = Array.from(document.images).map((img) =>
          img.complete ? img.decode().catch(() => undefined) : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
        );
        const videos = Array.from(document.querySelectorAll('video')).map((v) =>
          v.readyState >= 2 ? undefined : new Promise<void>((resolve) => {
            v.addEventListener('loadeddata', () => resolve(), { once: true });
            v.addEventListener('error', () => resolve(), { once: true });
          }),
        );
        await Promise.all([...images, ...videos]);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      })();
      await Promise.race([work, deadline]);
    }, timeoutMs)
    .catch(() => undefined);
}

/** Rendert HTML zu PNG (oder JPEG) in Viewport-Größe × `deviceScaleFactor`. */
export async function renderHtmlToPng(html: string, opts: HtmlToPngOptions): Promise<string> {
  const pool = opts.pool ?? getDefaultBrowserPool();
  await mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
  const type = opts.type ?? (/\.jpe?g$/i.test(opts.out) ? 'jpeg' : 'png');
  return withHtmlFile(html, opts.baseDir, (url) =>
    pool.withPage({ width: opts.width, height: opts.height, deviceScaleFactor: opts.deviceScaleFactor ?? 1, blockRemote: !opts.allowRemote }, async (page) => {
      await page.goto(url, { waitUntil: 'load' });
      await waitForPageAssets(page, opts.assetTimeoutMs);
      await page.screenshot({
        path: opts.out,
        type,
        fullPage: opts.fullPage ?? false,
        ...(type === 'png' && opts.transparent ? { omitBackground: true } : {}),
        ...(type === 'jpeg' ? { quality: opts.quality ?? 92 } : {}),
        animations: 'disabled',
        caret: 'hide',
      });
      return opts.out;
    }),
  );
}

/** Rendert HTML zu PDF (Seitengröße aus `@page` bzw. `width`×`height`). */
export async function renderHtmlToPdf(html: string, opts: HtmlToPdfOptions): Promise<string> {
  const pool = opts.pool ?? getDefaultBrowserPool();
  await mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
  return withHtmlFile(html, opts.baseDir, (url) =>
    pool.withPage({ width: opts.width, height: opts.height, blockRemote: !opts.allowRemote }, async (page) => {
      await page.goto(url, { waitUntil: 'load' });
      await page.emulateMedia({ media: 'print' });
      await waitForPageAssets(page, opts.assetTimeoutMs);
      await page.pdf({
        path: opts.out,
        width: `${opts.width}px`,
        height: `${opts.height}px`,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return opts.out;
    }),
  );
}

export interface RenderDeckOptions extends HtmlRenderBase {
  assetUrl: (assetId: string) => string;
  outDir: string;
  formats: Array<'png' | 'pdf'>;
  /** Nur diese Folien. */
  slideIds?: string[];
  deviceScaleFactor?: number;
  fontFaces?: DeckFontFace[];
  /** Dateiname des PDFs (Standard `deck.pdf`). */
  pdfName?: string;
}

/** Rendert ein Deck: ein PNG je Folie (`slide-01-<id>.png`) und/oder ein PDF mit einer Seite je Folie. */
export async function renderDeck(deck: Deck, opts: RenderDeckOptions): Promise<{ pngs: string[]; pdf?: string }> {
  await mkdir(opts.outDir, { recursive: true });
  const pool = opts.pool ?? getDefaultBrowserPool();
  const result: { pngs: string[]; pdf?: string } = { pngs: [] };
  const common = { assetUrl: opts.assetUrl, ...(opts.slideIds ? { slideIds: opts.slideIds } : {}), ...(opts.fontFaces ? { fontFaces: opts.fontFaces } : {}) };
  if (opts.formats.includes('png')) {
    const slides = selectSlides(deck, { mode: 'export', ...(opts.slideIds ? { slideIds: opts.slideIds } : {}) });
    const html = deckToHtml(deck, { ...common, mode: 'stage', slideIds: slides.map((s) => s.id) });
    await withHtmlFile(html, opts.baseDir, (url) =>
      pool.withPage({ width: deck.width, height: deck.height, deviceScaleFactor: opts.deviceScaleFactor ?? 1, blockRemote: !opts.allowRemote }, async (page) => {
        await page.goto(url, { waitUntil: 'load' });
        await waitForPageAssets(page, opts.assetTimeoutMs);
        for (const slide of slides) {
          const index = deck.slides.indexOf(slide) + 1;
          const file = path.join(opts.outDir, `slide-${String(index).padStart(2, '0')}-${safeId(slide.id)}.png`);
          await page.locator(`section.slide[data-slide-id="${slide.id.replace(/["\\]/g, '\\$&')}"]`).screenshot({ path: file, animations: 'disabled', caret: 'hide' });
          result.pngs.push(file);
        }
      }),
    );
  }
  if (opts.formats.includes('pdf')) {
    const html = deckToHtml(deck, { ...common, mode: 'export' });
    const out = path.join(opts.outDir, opts.pdfName ?? 'deck.pdf');
    await renderHtmlToPdf(html, { width: deck.width, height: deck.height, out, pool, ...(opts.baseDir ? { baseDir: opts.baseDir } : {}), ...(opts.allowRemote ? { allowRemote: true } : {}) });
    result.pdf = out;
  }
  return result;
}

export interface RenderCanvasOptions extends HtmlRenderBase, Omit<CanvasSvgOptions, 'size'> {
  out: string;
  format: 'png' | 'pdf' | 'svg' | 'jpeg';
  /** Pixel-Faktor für PNG/JPEG (Standard 1 = Leinwand-Pixel bzw. mm @ dpi). */
  scale?: number;
}

/** Rendert eine Leinwand als PNG/JPEG (Pixel nach `dpi`), PDF (physische Größe) oder SVG. */
export async function renderCanvas(canvas: Canvas, opts: RenderCanvasOptions): Promise<string> {
  await mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
  const { out, format, scale, pool, baseDir, allowRemote, assetTimeoutMs, ...svgOpts } = opts;
  const base = { ...(pool ? { pool } : {}), ...(baseDir ? { baseDir } : {}), ...(allowRemote ? { allowRemote } : {}), ...(assetTimeoutMs ? { assetTimeoutMs } : {}) };
  if (format === 'svg') {
    await writeFile(out, `<?xml version="1.0" encoding="UTF-8"?>\n${canvasToSvg(canvas, svgOpts)}`, 'utf8');
    return out;
  }
  if (format === 'pdf') {
    const size = canvasCssSize(canvas, { includeBleed: !!svgOpts.includeBleed });
    const html = canvasToHtml(canvas, { ...svgOpts, cssSize: size, pageSize: size });
    return renderHtmlToPdf(html, { width: size.width, height: size.height, out, ...base });
  }
  const px = canvasPixelSize(canvas, { includeBleed: !!svgOpts.includeBleed });
  const html = canvasToHtml(canvas, { ...svgOpts, cssSize: px });
  const transparent = /^(transparent|none)$/i.test(canvas.background.trim());
  return renderHtmlToPng(html, { width: px.width, height: px.height, out, deviceScaleFactor: scale ?? 1, transparent, type: format === 'jpeg' ? 'jpeg' : 'png', ...base });
}
