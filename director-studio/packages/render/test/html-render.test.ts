import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canvasSchema, deckSchema } from '@studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserPool, readPngSize, renderCanvas, renderDeck, renderHtmlToPdf, renderHtmlToPng } from '../src/index.ts';
import { decodePng, HAS_CHROMIUM, pdfPageCount, solidPng, testChromiumPath, tmpDir } from './helpers.ts';

const pool = new BrowserPool({ executablePath: testChromiumPath() });
let dir: string;
let redUrl: string;

beforeAll(async () => {
  dir = await tmpDir();
  const red = path.join(dir, 'rot.png');
  await writeFile(red, solidPng(64, 64, [230, 20, 30]));
  redUrl = pathToFileURL(red).href;
});
afterAll(async () => {
  await pool.close();
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!HAS_CHROMIUM)('HTML → PNG/PDF', () => {
  it('renderHtmlToPng: Maße = Viewport × deviceScaleFactor, Inhalt gerendert', async () => {
    const html = '<!doctype html><html><body style="margin:0;background:#0000ff"><div style="width:50px;height:50px;background:#00ff00"></div></body></html>';
    const out = await renderHtmlToPng(html, { width: 320, height: 200, out: path.join(dir, 'a.png'), pool });
    const png = await readFile(out);
    expect(readPngSize(png)).toEqual({ width: 320, height: 200 });
    const img = decodePng(png);
    expect(img.pixel(10, 10).slice(0, 3)).toEqual([0, 255, 0]);
    expect(img.pixel(200, 100).slice(0, 3)).toEqual([0, 0, 255]);
    const hi = await renderHtmlToPng(html, { width: 320, height: 200, out: path.join(dir, 'b.png'), deviceScaleFactor: 2, pool });
    expect(readPngSize(await readFile(hi))).toEqual({ width: 640, height: 400 });
  });

  it('lädt lokale file://-Bilder und blockiert fremde Hosts', async () => {
    const html = `<!doctype html><html><body style="margin:0;background:#fff"><img src="${redUrl}" style="width:100px;height:100px;display:block"><img id="remote" src="https://example.com/x.png"></body></html>`;
    const out = await renderHtmlToPng(html, { width: 200, height: 200, out: path.join(dir, 'c.png'), pool });
    const img = decodePng(await readFile(out));
    expect(img.pixel(50, 50).slice(0, 3)).toEqual([230, 20, 30]);
    expect(img.pixel(150, 150).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it('renderHtmlToPdf schreibt ein PDF', async () => {
    const out = await renderHtmlToPdf('<!doctype html><html><body><h1>Hallo PDF</h1></body></html>', { width: 800, height: 600, out: path.join(dir, 'x.pdf'), pool });
    const pdf = await readFile(out);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfPageCount(pdf)).toBe(1);
  });
});

describe.skipIf(!HAS_CHROMIUM)('renderDeck / renderCanvas', () => {
  const deck = () =>
    deckSchema.parse({
      kind: 'deck',
      width: 960,
      height: 540,
      theme: { colors: { background: '#ffffff', accent: '#2a78d6' }, fonts: { heading: 'sans-serif', body: 'sans-serif' } },
      slides: [
        {
          id: 's1',
          elements: [
            { id: 'img', type: 'image', x: 0, y: 0, width: 200, height: 200, assetId: 'rot' },
            { id: 't', type: 'text', x: 300, y: 50, width: 600, height: 100, text: '**Folie 1**', style: { role: 'title' } },
          ],
        },
        { id: 's2', hidden: true, elements: [] },
        { id: 's3', background: '#2a78d6', elements: [{ id: 'c', type: 'chart', x: 50, y: 50, width: 500, height: 300, chart: { type: 'bar', labels: ['a', 'b'], series: [{ name: 'x', values: [1, 2] }] } }] },
      ],
    });

  it('PNG je sichtbarer Folie + mehrseitiges PDF', async () => {
    const outDir = path.join(dir, 'deck');
    const result = await renderDeck(deck(), { assetUrl: (id) => (id === 'rot' ? redUrl : ''), outDir, formats: ['png', 'pdf'], pool });
    expect(result.pngs.map((p) => path.basename(p))).toEqual(['slide-01-s1.png', 'slide-03-s3.png']);
    const first = decodePng(await readFile(result.pngs[0]!));
    expect([first.width, first.height]).toEqual([960, 540]);
    expect(first.pixel(100, 100).slice(0, 3)).toEqual([230, 20, 30]);
    expect(first.pixel(900, 500).slice(0, 3)).toEqual([255, 255, 255]);
    const third = decodePng(await readFile(result.pngs[1]!));
    expect(third.pixel(940, 520).slice(0, 3)).toEqual([42, 120, 214]);
    const pdf = await readFile(result.pdf!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfPageCount(pdf)).toBe(2);
  });

  it('Leinwand als PNG (skaliert), SVG und PDF', async () => {
    const canvas = canvasSchema.parse({
      kind: 'canvas',
      width: 300,
      height: 200,
      background: '#ffffff',
      layers: [
        { id: 'bild', type: 'image', x: 0, y: 0, width: 100, height: 100, assetId: 'rot', effects: [{ type: 'shadow', params: {} }] },
        { id: 'kreis', type: 'shape', shape: 'ellipse', x: 150, y: 50, width: 100, height: 100, blend: 'multiply', style: { fill: '#00ff00' } },
        { id: 'txt', type: 'text', x: 10, y: 120, width: 280, height: 60, text: 'Collage', style: { fontSize: 32, color: '#000000' } },
      ],
    });
    const assetUrl = (id: string) => (id === 'rot' ? redUrl : '');
    const png = await renderCanvas(canvas, { assetUrl, out: path.join(dir, 'leinwand.png'), format: 'png', scale: 2, pool });
    const img = decodePng(await readFile(png));
    expect([img.width, img.height]).toEqual([600, 400]);
    expect(img.pixel(100, 100).slice(0, 3)).toEqual([230, 20, 30]);
    expect(img.pixel(400, 200).slice(0, 3)).toEqual([0, 255, 0]);
    const svg = await renderCanvas(canvas, { assetUrl, out: path.join(dir, 'leinwand.svg'), format: 'svg' });
    const svgText = await readFile(svg, 'utf8');
    expect(svgText.startsWith('<?xml')).toBe(true);
    expect(svgText).toContain('data-sid="kreis"');
    const pdf = await renderCanvas(canvas, { assetUrl, out: path.join(dir, 'leinwand.pdf'), format: 'pdf', pool });
    const pdfBuf = await readFile(pdf);
    expect(pdfPageCount(pdfBuf)).toBe(1);
    // physische Größe: 300×200 CSS-px = 225×150 pt
    const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdfBuf.toString('latin1'));
    expect(Number(box?.[1])).toBeCloseTo(225, 0);
    expect(Number(box?.[2])).toBeCloseTo(150, 0);
  });
});
