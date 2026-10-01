import { execFileSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deckSchema } from '@studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserPool, deckToPptx, toPptxColor } from '../src/index.ts';
import { HAS_CHROMIUM, solidPng, testChromiumPath, tmpDir } from './helpers.ts';

interface ZipLike {
  files: Record<string, unknown>;
  file(name: string): { async(type: 'string'): Promise<string> } | null;
}

/** jszip ist eine (transitive) Abhängigkeit von pptxgenjs – nur nutzen, wenn auflösbar; sonst `unzip`. */
async function openZip(data: Uint8Array, file: string): Promise<{ names: string[]; read: (name: string) => Promise<string> }> {
  try {
    const mod = (await import('jszip')) as unknown as { default: { loadAsync(d: Uint8Array): Promise<ZipLike> } };
    const zip = await mod.default.loadAsync(data);
    return { names: Object.keys(zip.files), read: async (name) => (await zip.file(name)?.async('string')) ?? '' };
  } catch {
    const list = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' });
    return { names: list.split('\n').filter(Boolean), read: async (name) => execFileSync('unzip', ['-p', file, name], { encoding: 'utf8' }) };
  }
}

let dir: string;
let imgPath: string;
const pool = new BrowserPool({ executablePath: testChromiumPath() });

beforeAll(async () => {
  dir = await tmpDir();
  imgPath = path.join(dir, 'bild.png');
  await writeFile(imgPath, solidPng(400, 200, [20, 120, 220]));
});
afterAll(async () => {
  await pool.close();
  await rm(dir, { recursive: true, force: true });
});

const deck = () =>
  deckSchema.parse({
    kind: 'deck',
    theme: { name: 'Quartal', colors: { background: '#101820', text: '#F5F5F0', accent: '#FF5A36', muted: 'rgba(245,245,240,0.7)' }, fonts: { heading: 'Fraunces, serif', body: 'Inter' } },
    slides: [
      {
        id: 's1',
        notes: 'Begrüßung und Agenda',
        elements: [
          { id: 'title', type: 'text', x: 120, y: 80, width: 1200, height: 160, text: 'Quartals**bericht** *2026*', style: { role: 'title', color: 'accent', align: 'center' } },
          { id: 'body', type: 'text', x: 120, y: 300, width: 900, height: 400, text: '- Umsatz +12 %\n- Neue Märkte\n\nFazit: gut', style: { fontSize: 40 } },
          { id: 'img', type: 'image', x: 1100, y: 300, width: 600, height: 600, assetId: 'bild' },
          { id: 'missing', type: 'image', x: 0, y: 0, width: 100, height: 100, assetId: 'fehlt' },
        ],
      },
      {
        id: 's2',
        background: '#FFFFFF',
        elements: [
          { id: 'chart', type: 'chart', x: 100, y: 100, width: 1000, height: 600, chart: { type: 'bar', labels: ['Q1', 'Q2', 'Q3'], series: [{ name: 'Umsatz', values: [10, 14, 18] }, { name: 'Kosten', values: [7, 8, 9] }] } },
          { id: 'pie', type: 'chart', x: 1200, y: 100, width: 600, height: 600, chart: { type: 'pie', labels: ['A', 'B'], series: [{ name: 'Anteil', values: [60, 40] }] } },
          { id: 'line', type: 'shape', shape: 'line', x: 100, y: 800, width: 1700, height: 4, style: { stroke: '#FF5A36', strokeWidth: 4 } },
          { id: 'box', type: 'shape', shape: 'rect', x: 100, y: 900, width: 300, height: 100, style: { fill: '#FF5A36', radius: 16 } },
        ],
      },
      { id: 's3', hidden: true, background: { assetId: 'bild' }, elements: [{ id: 'h', type: 'html', x: 100, y: 100, width: 800, height: 300, html: '<h2>Hallo <em>HTML</em></h2><p>Absatz</p>' }] },
    ],
  });

describe('deckToPptx', () => {
  it('erzeugt eine gültige PPTX mit Folien, Notizen, Bildern und Diagrammen', async () => {
    const bytes = await deckToPptx(deck(), { assetPath: (id) => (id === 'bild' ? imgPath : undefined) });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const file = path.join(dir, 'deck.pptx');
    await writeFile(file, bytes);
    const zip = await openZip(bytes, file);
    const slides = zip.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(3);
    expect(zip.names.some((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))).toBe(true);
    expect(zip.names.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toHaveLength(2);
    expect(zip.names.some((n) => n.startsWith('ppt/media/'))).toBe(true);
    const s1 = await zip.read('ppt/slides/slide1.xml');
    expect(s1).toContain('Quartals');
    expect(s1).toContain('<a:t>bericht</a:t>');
    expect(s1).toMatch(/b="1"/);
    expect(s1).toContain('FF5A36');
    expect(s1).toContain('typeface="Fraunces"');
    expect(s1).toContain('Bild fehlt');
    expect(s1).toContain('<a:buChar');
    const notes = (await Promise.all(zip.names.filter((n) => n.startsWith('ppt/notesSlides/notesSlide')).map((n) => zip.read(n)))).join('\n');
    expect(notes).toContain('Begrüßung und Agenda');
    const pres = await zip.read('ppt/presentation.xml');
    expect(pres).toMatch(/<p:sldSz cx="12192000" cy="6858000"/);
    const s3 = await zip.read('ppt/slides/slide3.xml');
    expect(s3).toContain('show="0"');
    expect(s3).toContain('Hallo HTML');
  });

  it('Farben: Theme-Namen, rgba → Transparenz, 8-stelliges Hex wird entschärft', () => {
    const d = deck();
    expect(toPptxColor('accent', d)).toEqual({ color: 'FF5A36' });
    expect(toPptxColor('rgba(255, 0, 0, 0.5)')).toEqual({ color: 'FF0000', transparency: 50 });
    expect(toPptxColor('#11223380')).toEqual({ color: '112233', transparency: 50 });
    expect(toPptxColor('#abc')).toEqual({ color: 'AABBCC' });
    expect(toPptxColor('transparent')).toBeUndefined();
  });

  it.skipIf(!HAS_CHROMIUM)('HTML-Blöcke optional als Bild (Chromium)', async () => {
    const bytes = await deckToPptx(deck(), { assetPath: (id) => (id === 'bild' ? imgPath : undefined), rasterizeHtml: true, pool });
    const file = path.join(dir, 'deck-raster.pptx');
    await writeFile(file, bytes);
    const zip = await openZip(bytes, file);
    const s3 = await zip.read('ppt/slides/slide3.xml');
    expect(s3).not.toContain('Hallo HTML');
    expect(s3).toContain('<p:pic>');
  });
});
