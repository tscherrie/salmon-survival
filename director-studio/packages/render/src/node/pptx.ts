import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import type { Deck } from '@studio/core';
import type { BrowserPool } from './chromium.ts';
import { renderHtmlToPng } from './html-render.ts';
import { readImageSize } from './image-size.ts';
import { deckToHtml } from '../deck/deck-html.ts';
import { portableDeckToPptx } from '../deck/pptx.ts';
export { toPptxColor } from '../deck/pptx.ts';
export interface DeckToPptxOptions {
  assetPath: (assetId: string) => string | undefined;
  rasterizeHtml?: boolean;
  pool?: BrowserPool;
  slideWidthInches?: number;
}
/** Desktop resolver for the same editable PPTX mapper used in the browser. */
export async function deckToPptx(deck: Deck, opts: DeckToPptxOptions): Promise<Uint8Array> {
  const tmp = opts.rasterizeHtml ? await mkdtemp(path.join(os.tmpdir(), 'studio-pptx-')) : undefined;
  try {
    return await portableDeckToPptx(deck, {
      ...opts, assetMode: 'path',
      imageSize: async (id) => { const file = opts.assetPath(id); return file ? await readImageSize(file) : undefined; },
      ...(tmp ? { rasterizeElement: async (source, el) => {
        const mini: Deck = { ...source, theme: { ...source.theme, background: 'transparent' }, width: Math.max(1, Math.round(el.width)), height: Math.max(1, Math.round(el.height)), slides: [{ id: '__html', elements: [{ ...el, x: 0, y: 0, rotation: undefined }] }] };
        const html = deckToHtml(mini, { mode: 'stage', assetUrl: () => '', pageBackground: 'transparent' });
        const file = path.join(tmp, `${el.id.replace(/[^\w-]/g, '_')}.png`);
        await renderHtmlToPng(html, { width: mini.width, height: mini.height, out: file, deviceScaleFactor: 2, transparent: true, ...(opts.pool ? { pool: opts.pool } : {}) });
        return `image/png;base64,${(await readFile(file)).toString('base64')}`;
      } } : {}),
    }, new PptxGenJS());
  } finally { if (tmp) await rm(tmp, { recursive: true, force: true }); }
}
