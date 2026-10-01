import type { Canvas, Deck, DeckElement } from '@studio/core';
import { canvasToHtml, canvasPixelSize, canvasToSvg, deckToHtml, selectSlides, portableDeckToPptx } from '@studio/render/browser';
import { toBlob } from 'html-to-image';
import { PDFDocument } from 'pdf-lib';
import PptxGenJS from 'pptxgenjs';
import type { AssetMedia } from '@studio/render/browser';
import { blobToDataUrl } from './assets.ts';
import { assertComponentSandbox } from './timeline.tsx';
import { checkAbort } from './types.ts';

/** Rasterizes trusted, sanitized document HTML. Scripts and embedded frames never execute. */
export async function rasterizeHtml(html: string, width: number, height: number, mime = 'image/png', quality = 0.95): Promise<Blob> {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const el of parsed.querySelectorAll('script,iframe,object,embed,base,meta[http-equiv]')) el.remove();
  const host = document.createElement('div'); host.style.cssText = `position:fixed;left:-${width + 20}px;top:0;width:${width}px;height:${height}px;overflow:hidden;pointer-events:none;`;
  // Scope styles to the temporary export root by isolating them in Shadow DOM.
  const shadow = host.attachShadow({ mode: 'open' }), stage = document.createElement('div'); stage.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;`;
  for (const style of parsed.head.querySelectorAll('style')) { const scoped = document.createElement('style'); scoped.textContent = (style.textContent ?? '').replace(/:root\b/g, ':host'); shadow.append(scoped); } stage.className = parsed.body.className; stage.innerHTML = parsed.body.innerHTML; shadow.append(stage); document.body.append(host);
  try {
    await document.fonts.ready; await Promise.all(Array.from(stage.querySelectorAll('img')).map((img) => img.decode()));
    const blob = await toBlob(stage, { width, height, pixelRatio: 1, cacheBust: false, backgroundColor: 'transparent', skipAutoScale: true });
    if (!blob) throw new Error('Rasterisierung hat kein Bild geliefert');
    if (mime === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Bildencoder nicht verfügbar')), mime, quality));
  } finally { host.remove(); }
}
export async function canvasImage(doc: Canvas, assets: Record<string, AssetMedia>, mime = 'image/png', quality = 0.95): Promise<Blob> {
  // Encode the same SVG used by the preview directly. Nesting an SVG foreignObject inside a
  // screenshot's foreignObject changes inherited text colors in Chromium.
  const size = canvasPixelSize(doc), svg = canvasToSvg(doc, { assetUrl: (id) => assets[id]!.url, textMode: 'foreignObject', size });
  const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height; const ctx = canvas.getContext('2d')!;
  if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); } ctx.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Grafikencoder nicht verfügbar')), mime, quality));
}
export function canvasSvg(doc: Canvas, assets: Record<string, AssetMedia>): Blob {
  return new Blob([canvasToSvg(doc, { assetUrl: (id) => assets[id]!.url, textMode: 'foreignObject' })], { type: 'image/svg+xml' });
}
export async function deckImages(deck: Deck, assets: Record<string, AssetMedia>, slideIds?: string[]): Promise<Array<{ id: string; blob: Blob }>> {
  const slides = selectSlides(deck, { slideIds, mode: 'export' }); const out: Array<{ id: string; blob: Blob }> = [];
  for (const slide of slides) out.push({ id: slide.id, blob: await rasterizeHtml(deckToHtml(deck, { assetUrl: (id) => assets[id]!.url, mode: 'stage', slideIds: [slide.id], csp: true }), deck.width, deck.height) });
  return out;
}
export async function imagesPdf(images: Array<{ blob: Blob; width: number; height: number }>): Promise<Blob> {
  const pdf = await PDFDocument.create(); pdf.setCreator('AI Director Studio');
  for (const image of images) { const embedded = await pdf.embedPng(await image.blob.arrayBuffer()); const page = pdf.addPage([image.width * 0.75, image.height * 0.75]); page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() }); }
  return new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' });
}
/** Shared editable mapping: Markdown runs, theme colors/alpha, image fit, shapes, charts, notes. */
export async function browserDeckPptx(deck: Deck, assets: Record<string, AssetMedia>): Promise<Blob> {
  const bytes = await portableDeckToPptx(deck, {
    assetMode: 'data', assetPath: (id) => assets[id]?.url,
    imageSize: async (id) => { const image = new Image(); image.src = assets[id]!.url; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; },
    mediaExtension: (id) => /data:video\/webm/.test(assets[id]!.url) ? 'webm' : 'mp4',
    rasterizeElement: async (source, element) => {
      const mini: Deck = { ...source, theme: { ...source.theme, background: 'transparent' }, slides: [{ id: '__html', elements: [{ ...element, x: 0, y: 0, rotation: undefined }] }], width: Math.max(1, Math.round(element.width)), height: Math.max(1, Math.round(element.height)) };
      return await blobToDataUrl(await rasterizeHtml(deckToHtml(mini, { assetUrl: (id) => assets[id]!.url, mode: 'stage', pageBackground: 'transparent', csp: true }), mini.width, mini.height));
    },
  }, new PptxGenJS());
  return new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

/** Executes a site only inside the disposable opaque media frame, then captures its own DOM. */
export async function renderOpaqueSiteHtml(html: string, options: { width: number; height: number; signal?: AbortSignal }): Promise<Blob> {
  assertComponentSandbox(); checkAbort(options.signal);
  const parsed = new DOMParser().parseFromString(html, 'text/html'), scripts = [...parsed.querySelectorAll('script')];
  for (const script of scripts) script.remove();
  document.documentElement.style.cssText = parsed.documentElement.style.cssText;
  document.body.style.cssText = parsed.body.style.cssText;
  document.body.className = parsed.body.className; document.body.replaceChildren(...Array.from(parsed.body.childNodes));
  document.head.replaceChildren(...Array.from(parsed.head.childNodes, (node) => node.cloneNode(true)));
  for (const source of scripts) {
    checkAbort(options.signal); const script = document.createElement('script'); for (const attr of source.attributes) script.setAttribute(attr.name, attr.value); script.textContent = source.textContent;
    if (script.type === 'module' || script.src) {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Website-Skript konnte nicht starten')), 15000); script.onload = () => { clearTimeout(timer); resolve(); }; script.onerror = () => { clearTimeout(timer); reject(new Error('Website-Skript nicht ausführbar')); }; document.body.append(script); });
    } else document.body.append(script);
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode())); checkAbort(options.signal);
  const blob = await toBlob(document.documentElement, { width: options.width, height: options.height, pixelRatio: 1, skipAutoScale: true });
  checkAbort(options.signal); if (!blob) throw new Error('Website-Screenshot leer');
  // A normal browser page paints a white viewport behind transparent html/body. Preserve
  // source backgrounds while compositing transparent regions onto that same viewport.
  const image = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = options.width; canvas.height = options.height; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0); image.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Website-Screenshot nicht kodierbar')), 'image/png'));
}
