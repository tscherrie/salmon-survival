import { canvasSchema, deckSchema } from '@studio/core';
import type { Page } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { BrowserPool, canvasToHtml, deckToHtml, parsePickConsoleMessage, pickPayloadToRef, PICKER_SCRIPT, type PickPayload } from '../src/index.ts';
import { HAS_CHROMIUM, testChromiumPath } from './helpers.ts';

const pool = new BrowserPool({ executablePath: testChromiumPath() });
afterAll(() => pool.close());

const SITE = `<!doctype html><html lang="de"><head><style>body{margin:0;font:16px sans-serif} .card{padding:20px;margin:10px} #spacer{height:1500px}</style></head><body>
<header data-src="src/Header.tsx:3:5"><nav><a id="home" href="https://example.invalid/">Start</a></nav></header>
<main>
  <section class="hero card" data-sid="hero" data-src="src/Hero.tsx:12:7">
    <h1>Willkommen bei   uns</h1>
    <button class="cta" onclick="window.__clicked = true">Los geht's</button>
  </section>
  <div id="spacer"></div>
  <ul class="list"><li>Eins</li><li>Zwei</li><li data-loc="src/List.tsx:8:3">Drei</li></ul>
</main></body></html>`;

async function setup(page: Page, html: string, inject = true): Promise<{ picks: PickPayload[]; consolePicks: PickPayload[] }> {
  const picks: PickPayload[] = [];
  const consolePicks: PickPayload[] = [];
  page.on('console', (msg) => {
    const p = parsePickConsoleMessage(msg.text());
    if (p) consolePicks.push(p);
  });
  await page.exposeFunction('__studioPickerReport', (p: PickPayload) => {
    picks.push(p);
  });
  await page.setContent(html);
  if (inject) {
    await page.evaluate(PICKER_SCRIPT);
    await page.evaluate(PICKER_SCRIPT); // idempotent
  }
  return { picks, consolePicks };
}

describe.skipIf(!HAS_CHROMIUM)('PICKER_SCRIPT in Chromium', () => {
  it('meldet Selektor, Box, Text, data-sid und Quelle; verhindert Aktionen', async () => {
    await pool.withPage({ width: 800, height: 600 }, async (page) => {
      const { picks, consolePicks } = await setup(page, SITE);
      expect(await page.evaluate(() => (window as unknown as { __studioPicker: { isEnabled(): boolean } }).__studioPicker.isEnabled())).toBe(false);
      await page.evaluate(() => (window as unknown as { __studioPicker: { enable(): void } }).__studioPicker.enable());
      await page.hover('h1');
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-studio-picker'))).toBe('on');
      await page.click('h1');
      await expect.poll(() => picks.length).toBe(1);
      const p = picks[0]!;
      expect(p.tag).toBe('h1');
      expect(p.text).toBe('Willkommen bei uns');
      expect(p.dataSid).toBe('hero');
      expect(p.dataSrc).toBe('src/Hero.tsx:12:7');
      expect(p.page).toBe('blank'); // about:blank
      expect(p.sidPath).toEqual(['hero']);
      expect(p.bbox.width).toBeGreaterThan(100);
      expect(p.bbox.height).toBeGreaterThan(10);
      const unique = await page.evaluate((sel) => {
        const all = document.querySelectorAll(sel);
        return all.length === 1 && all[0]!.tagName === 'H1';
      }, p.selector);
      expect(unique).toBe(true);
      await expect.poll(() => consolePicks.length).toBe(1);
      expect(consolePicks[0]).toEqual(p);

      // Button: onclick darf nicht laufen
      await page.click('button.cta');
      await expect.poll(() => picks.length).toBe(2);
      expect(await page.evaluate(() => (window as unknown as { __clicked?: boolean }).__clicked ?? false)).toBe(false);
      expect(picks[1]!.text).toBe("Los geht's");

      // Link: keine Navigation
      await page.click('#home');
      await expect.poll(() => picks.length).toBe(3);
      expect(page.url()).toBe('about:blank');
      expect(picks[2]!.selector).toBe('#home');
      expect(picks[2]!.dataSrc).toBe('src/Header.tsx:3:5');

      // gescrollt: Box in Seitenkoordinaten, data-loc als Quelle
      await page.locator('li[data-loc]').scrollIntoViewIfNeeded();
      await page.click('li[data-loc]');
      await expect.poll(() => picks.length).toBe(4);
      const li = picks[3]!;
      expect(li.dataSrc).toBe('src/List.tsx:8:3');
      expect(li.bbox.y).toBeGreaterThan(1500);
      expect(await page.evaluate((sel) => document.querySelector(sel)?.textContent, li.selector)).toBe('Drei');

      // Alt-Klick: übergeordnete Komponente
      await page.click('h1', { modifiers: ['Alt'] });
      await expect.poll(() => picks.length).toBe(5);
      expect(picks[4]!.tag).toBe('section');

      // Deaktivieren: Klicks wieder normal
      await page.evaluate(() => (window as unknown as { __studioPicker: { disable(): void } }).__studioPicker.disable());
      await page.click('button.cta');
      expect(await page.evaluate(() => (window as unknown as { __clicked?: boolean }).__clicked ?? false)).toBe(true);
      expect(picks.length).toBe(5);

      const ref = pickPayloadToRef(p, 'site');
      // Vertrag (B): Element-Referenzen tragen sichtbaren Text und Tag.
      expect(ref).toEqual({ kind: 'element', doc: 'site', page: 'blank', selector: p.selector, elementId: 'hero', source: { file: 'src/Hero.tsx', line: 12, column: 7 }, bbox: p.bbox, text: 'Willkommen bei uns', tag: 'h1' });
    });
  });

  it('synthetische Klicks von Seiten-Skripten lösen keinen Pick aus, bleiben aber blockiert', async () => {
    await pool.withPage({ width: 800, height: 600 }, async (page) => {
      const { picks, consolePicks } = await setup(page, SITE);
      await page.evaluate(() => (window as unknown as { __studioPicker: { enable(): void } }).__studioPicker.enable());
      await page.evaluate(() => {
        (document.querySelector('button.cta') as HTMLButtonElement).click();
        document.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      // Ein echter Klick danach kommt an – die synthetischen davor nicht.
      await page.click('h1');
      await expect.poll(() => picks.length).toBe(1);
      expect(picks[0]!.tag).toBe('h1');
      expect(consolePicks.length).toBe(1);
      expect(await page.evaluate(() => (window as unknown as { __clicked?: boolean }).__clicked ?? false)).toBe(false);
    });
  });

  it('Deck-Bühne (CSP + Nonce): Element- und Folienreferenzen', async () => {
    const deck = deckSchema.parse({
      kind: 'deck',
      width: 1280,
      height: 720,
      slides: [
        { id: 's1', elements: [{ id: 'e_title', type: 'text', x: 100, y: 100, width: 600, height: 120, text: 'Titel', style: { fontSize: 60 } }] },
        { id: 's2', elements: [] },
      ],
    });
    const html = deckToHtml(deck, { assetUrl: () => '', mode: 'stage', picker: true });
    await pool.withPage({ width: 1280, height: 720 }, async (page) => {
      const { picks } = await setup(page, html, false);
      await page.evaluate(() => (window as unknown as { __studioPicker: { enable(): void } }).__studioPicker.enable());
      await page.mouse.click(200, 150);
      await expect.poll(() => picks.length).toBe(1);
      expect(picks[0]!.slideId).toBe('s1');
      expect(pickPayloadToRef(picks[0]!, 'deck')).toMatchObject({ kind: 'element', doc: 'deck', slideId: 's1', elementId: 'e_title' });
      await page.mouse.click(1000, 600);
      await expect.poll(() => picks.length).toBe(2);
      expect(pickPayloadToRef(picks[1]!, 'deck')).toEqual({ kind: 'slide', slideId: 's1' });
    });
  });

  it('Leinwand-SVG: Ebene unter dem Cursor', async () => {
    const canvas = canvasSchema.parse({
      kind: 'canvas',
      width: 400,
      height: 300,
      layers: [
        { id: 'back', type: 'shape', x: 0, y: 0, width: 400, height: 300, style: { fill: '#eee' } },
        { id: 'front', type: 'shape', shape: 'ellipse', x: 100, y: 50, width: 200, height: 200, rotation: 20, style: { fill: '#f50' } },
      ],
    });
    await pool.withPage({ width: 400, height: 300 }, async (page) => {
      const { picks } = await setup(page, canvasToHtml(canvas, { assetUrl: () => '', picker: true }), false);
      await page.evaluate(() => (window as unknown as { __studioPicker: { enable(): void } }).__studioPicker.enable());
      await page.mouse.click(200, 150);
      await expect.poll(() => picks.length).toBe(1);
      expect(pickPayloadToRef(picks[0]!, 'canvas')).toMatchObject({ kind: 'element', doc: 'canvas', elementId: 'front' });
      await page.mouse.click(10, 10);
      await expect.poll(() => picks.length).toBe(2);
      expect(picks[1]!.dataSid).toBe('back');
    });
  });
});
