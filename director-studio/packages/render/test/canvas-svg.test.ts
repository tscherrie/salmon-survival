import { canvasSchema, type Canvas, type CanvasInput } from '@studio/core';
import { describe, expect, it } from 'vitest';
import { canvasPixelSize, canvasToHtml, canvasToSvg, estimateTextWidth, fitFontSizeToWords, hyphenationPoints, wrapText, wrapTextLines } from '../src/browser.ts';

function canvas(input: Partial<CanvasInput> = {}): Canvas {
  return canvasSchema.parse({
    kind: 'canvas',
    width: 1080,
    height: 1350,
    background: '#f4efe6',
    layers: [
      { id: 'bg', type: 'image', x: 0, y: 0, width: 1080, height: 1350, assetId: 'ast_bg', crop: { x: 0.1, y: 0, width: 0.8, height: 1 }, effects: [{ type: 'grain', params: { amount: 0.3 } }] },
      {
        id: 'cut',
        type: 'image',
        x: 200,
        y: 300,
        width: 600,
        height: 800,
        rotation: -8,
        opacity: 0.9,
        blend: 'multiply',
        assetId: 'ast_person',
        maskAssetId: 'ast_mask',
        effects: [{ type: 'shadow', params: { dx: 0, dy: 12, blur: 24, opacity: 0.4 } }, { type: 'outline', params: { width: 6, color: '#ffffff' } }],
      },
      {
        id: 'grp',
        type: 'group',
        x: 100,
        y: 100,
        width: 500,
        height: 200,
        rotation: 10,
        children: [
          { id: 'title', type: 'text', x: 100, y: 100, width: 500, height: 120, text: 'Sommer & <Sonne>', style: { fontFamily: 'Fraunces', fontSize: 64, color: '#1d1d1b', fontWeight: 700, align: 'center' } },
          { id: 'dot', type: 'shape', shape: 'ellipse', x: 520, y: 220, width: 60, height: 60, style: { fill: '#ff5a36' }, effects: [{ type: 'halftone', params: { size: 6 } }] },
        ],
      },
      { id: 'blob', type: 'shape', shape: 'path', x: 700, y: 1100, width: 200, height: 150, path: 'M0,0 L100,0 L100,100 Z" onload="alert(1)', style: { viewBox: '0 0 100 100', fill: '#222' }, effects: [{ type: 'paper', params: {} }, { type: 'tear', params: { amount: 10 } }, { type: 'blur', params: { radius: 2 } }] },
      { id: 'versteckt', type: 'shape', x: 0, y: 0, width: 10, height: 10, hidden: true },
    ],
    ...input,
  });
}

const assetUrl = (id: string) => `file:///assets/${id}.png`;

describe('canvasToSvg', () => {
  it('Ebenen als <g data-sid> mit Transformationen, Deckkraft und Mischmodus', () => {
    const svg = canvasToSvg(canvas(), { assetUrl });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[^>]*data-sid="__canvas" width="1080" height="1350" viewBox="0 0 1080 1350"/);
    expect(svg).toContain('<rect data-sid="__background" x="0" y="0" width="1080" height="1350" fill="#f4efe6"/>');
    expect(svg).toMatch(/<g data-sid="cut" data-layer-type="image" transform="translate\(200 300\) rotate\(-8 300 400\)" opacity="0.9" style="mix-blend-mode: multiply" filter="url\(#c-fx-cut\)">/);
    // Gruppe: Kinder absolut, Drehung um den Gruppenmittelpunkt
    expect(svg).toContain('<g data-sid="grp" data-layer-type="group" transform="rotate(10 350 200)">');
    expect(svg).toContain('<g data-sid="title" data-layer-type="text" transform="translate(100 100)">');
    expect(svg).not.toContain('versteckt');
    // Reihenfolge = Zeichenreihenfolge
    expect(svg.indexOf('data-sid="bg"')).toBeLessThan(svg.indexOf('data-sid="cut"'));
  });

  it('Zuschnitt per verschachteltem SVG/viewBox, Maske per maskAssetId', () => {
    const svg = canvasToSvg(canvas(), { assetUrl });
    expect(svg).toContain('<svg x="0" y="0" width="1080" height="1350" viewBox="0.1 0 0.8 1" preserveAspectRatio="none" overflow="hidden"><image href="file:///assets/ast_bg.png"');
    expect(svg).toMatch(/<mask id="c-mask-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="800" style="mask-type: luminance"><image href="file:\/\/\/assets\/ast_mask.png"/);
    expect(svg).toContain('<g mask="url(#c-mask-cut)"><image href="file:///assets/ast_person.png"');
    const exact = canvasToSvg(canvas(), { assetUrl, assetSize: (id) => (id === 'ast_bg' ? { width: 2000, height: 1500 } : undefined) });
    expect(exact).toContain('viewBox="200 0 1600 1500" preserveAspectRatio="xMidYMid slice"');
  });

  it('Effekte als SVG-Filter', () => {
    const svg = canvasToSvg(canvas(), { assetUrl });
    const filter = (id: string) => svg.slice(svg.indexOf(`<filter id="c-fx-${id}"`), svg.indexOf('</filter>', svg.indexOf(`<filter id="c-fx-${id}"`)));
    expect(filter('bg')).toContain('<feTurbulence type="fractalNoise"');
    expect(filter('bg')).toContain('mode="overlay"');
    expect(filter('cut')).toContain('<feDropShadow in="SourceGraphic" dx="0" dy="12" stdDeviation="12"');
    expect(filter('cut')).toContain('<feMorphology in="e0" operator="dilate" radius="6"');
    expect(filter('dot')).toContain('<feTile');
    expect(filter('dot')).toContain('type="discrete"');
    expect(filter('blob')).toContain('<feDiffuseLighting');
    expect(filter('blob')).toContain('<feDisplacementMap');
    expect(filter('blob')).toContain('<feGaussianBlur in="e1" stdDeviation="2"');
  });

  it('Text: foreignObject mit HTML (maskiert, Silbentrennung) oder tspans', () => {
    const svg = canvasToSvg(canvas(), { assetUrl });
    expect(svg).toContain('<foreignObject x="0" y="0" width="500" height="120" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml" lang="de"');
    expect(svg).toContain('Sommer &amp; &lt;Sonne&gt;');
    expect(svg).toContain('hyphens: auto');
    const plain = canvasToSvg(canvas(), { assetUrl, textMode: 'tspan' });
    expect(plain).toContain('text-anchor="middle"');
    expect(plain).toContain('<tspan x="250"');
    expect(plain).not.toContain('foreignObject');
    expect(wrapText('eins zwei drei vier', 100, 20)).toEqual(['eins zwei', 'drei vier']);
  });

  it('Pfade werden gesäubert; Beschnitt erweitert die viewBox; mm-Einheiten', () => {
    const svg = canvasToSvg(canvas(), { assetUrl });
    expect(svg).not.toContain('onload');
    expect(svg).toMatch(/<svg width="200" height="150" viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible"><path d="M0,0 L100,0 L100,100 Z[^"]*" fill="#222"/);
    const print = canvas({ unit: 'mm', width: 210, height: 297, bleed: 3, dpi: 300, layers: [] });
    const withBleed = canvasToSvg(print, { assetUrl, includeBleed: true });
    expect(withBleed).toContain('width="216mm" height="303mm" viewBox="-3 -3 216 303"');
    expect(withBleed).toContain('<rect data-sid="__background" x="-3" y="-3" width="216" height="303"');
    expect(canvasPixelSize(print)).toEqual({ width: 2480, height: 3508 });
    expect(canvasPixelSize(print, { includeBleed: true })).toEqual({ width: 2551, height: 3579 });
  });

  it('canvasToHtml bettet das SVG in Pixelgröße ein', () => {
    const html = canvasToHtml(canvas(), { assetUrl });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('width="1080" height="1350" viewBox="0 0 1080 1350"');
    expect(html).toContain(`script-src 'none'`);
  });
});

describe('Leinwand-Text: Umbruch nur an Leerzeichen/Trennstellen, Displaytexte schrumpfen', () => {
  const SHY = '\u00AD';
  function textCanvas(style: Record<string, string | number>, text: string, width = 400): Canvas {
    return canvasSchema.parse({ kind: 'canvas', width: 1000, height: 600, layers: [{ id: 't', type: 'text', x: 0, y: 0, width, height: 300, text, style }] });
  }
  const fontSizeOf = (svg: string) => Number(/font-size: ([\d.]+)px/.exec(svg)?.[1] ?? /font-size="([\d.]+)"/.exec(svg)?.[1]);

  it('Fließtext (de): bedingte Trennstriche, kein Notbruch mitten im Wort', () => {
    const svg = canvasToSvg(textCanvas({ fontSize: 48 }, 'Die Geschwindigkeitsbegrenzung gilt'), { assetUrl });
    expect(svg).toContain(`Ge${SHY}schwin${SHY}dig${SHY}keits${SHY}be${SHY}gren${SHY}zung`);
    expect(svg).toContain('overflow-wrap: normal');
    expect(svg).not.toContain('break-word');
    expect(svg).toContain('hyphens: auto');
    expect(fontSizeOf(svg)).toBe(48);
  });

  it('Displaytext (role title): keine Trennung, Schrift wird verkleinert, bis das längste Wort passt', () => {
    const svg = canvasToSvg(textCanvas({ fontSize: 120, role: 'title', fontWeight: 800 }, 'Geschwindigkeitsbegrenzung'), { assetUrl });
    expect(svg).not.toContain(SHY);
    expect(svg).toContain('hyphens: manual');
    const size = fontSizeOf(svg);
    expect(size).toBeLessThan(120);
    expect(size).toBeGreaterThan(20);
    expect(estimateTextWidth('Geschwindigkeitsbegrenzung', size, { bold: true })).toBeLessThanOrEqual(400);
    // textFit overflow: Größe bleibt, Wort ragt über
    const overflow = canvasToSvg(textCanvas({ fontSize: 120, role: 'title', textFit: 'overflow' }, 'Geschwindigkeitsbegrenzung'), { assetUrl });
    expect(fontSizeOf(overflow)).toBe(120);
    // hyphens auto erzwingt Trennung auch bei Displaytext
    const hyph = canvasToSvg(textCanvas({ fontSize: 120, role: 'title', hyphens: 'auto' }, 'Geschwindigkeitsbegrenzung'), { assetUrl });
    expect(hyph).toContain(SHY);
  });

  it('Sprache: lang en (Option oder Ebene) trennt nicht; hyphens none schaltet ab', () => {
    expect(canvasToSvg(textCanvas({ fontSize: 48 }, 'Geschwindigkeitsbegrenzung'), { assetUrl, lang: 'en' })).not.toContain(SHY);
    expect(canvasToSvg(textCanvas({ fontSize: 48, lang: 'en' }, 'Geschwindigkeitsbegrenzung'), { assetUrl })).not.toContain(SHY);
    expect(canvasToSvg(textCanvas({ fontSize: 48, hyphens: 'none' }, 'Geschwindigkeitsbegrenzung'), { assetUrl })).not.toContain(SHY);
    expect(canvasToHtml(textCanvas({}, 'x'), { assetUrl, lang: 'en' })).toContain('<html lang="en">');
  });

  it('tspan-Modus: Zeilen brechen nur an Leerzeichen bzw. mit sichtbarem Trennstrich an Silbengrenzen', () => {
    const svg = canvasToSvg(textCanvas({ fontSize: 40 }, 'Die Geschwindigkeitsbegrenzung im Morgengrauen', 300), { assetUrl, textMode: 'tspan' });
    const lines = Array.from(svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g), (m) => m[1]!);
    expect(lines.length).toBeGreaterThan(1);
    expect(svg).not.toContain(SHY);
    // Wieder zusammensetzen: Trennstrich am Zeilenende = Silbenfuge, sonst Leerzeichen.
    let joined = '';
    const breaks: number[] = [];
    lines.forEach((line, i) => {
      if (line.endsWith('-')) {
        joined += line.slice(0, -1);
        breaks.push(joined.length);
      } else joined += line + (i < lines.length - 1 ? ' ' : '');
    });
    expect(joined).toBe('Die Geschwindigkeitsbegrenzung im Morgengrauen');
    expect(breaks.length).toBeGreaterThan(0);
    for (const b of breaks) {
      const wordStart = joined.lastIndexOf(' ', b) + 1;
      const word = joined.slice(wordStart).split(' ')[0]!;
      expect(hyphenationPoints(word), `${word} bei ${b - wordStart}`).toContain(b - wordStart);
    }
    // Display-Rolle im tspan-Modus: verkleinert statt zu trennen
    const display = canvasToSvg(textCanvas({ fontSize: 120, role: 'display' }, 'Lichterkette', 300), { assetUrl, textMode: 'tspan' });
    expect(Array.from(display.matchAll(/<tspan/g)).length).toBe(1);
    expect(fontSizeOf(display)).toBeLessThan(120);
  });

  it('wrapText/wrapTextLines: nie mitten im Wort; zu lange Stücke ragen über', () => {
    expect(wrapText('Donaudampfschifffahrt', 50, 20)).toEqual(['Donaudampfschifffahrt']);
    expect(wrapTextLines(`Lich${SHY}ter${SHY}ket${SHY}te`, 70, 20)).toEqual(['Lichter-', 'kette']);
    expect(wrapTextLines('eins zwei\ndrei', 1000, 20)).toEqual(['eins zwei', 'drei']);
    expect(fitFontSizeToWords('kurz', 1000, 50)).toBe(50);
    expect(fitFontSizeToWords('Geschwindigkeitsbegrenzung', 200, 50)).toBeLessThan(20);
  });
});

describe('Leinwand-Hintergrund: CSS-Farbe oder -Verlauf', () => {
  it('linear-gradient → SVG-Verlauf mit Winkel und Stopps', () => {
    const svg = canvasToSvg(canvas({ background: 'linear-gradient(90deg, #ff0000 0%, rgb(0, 0, 255) 100%)', layers: [] }), { assetUrl });
    expect(svg).toContain('<linearGradient id="c-bg" gradientUnits="userSpaceOnUse" x1="0" y1="675" x2="1080" y2="675">');
    expect(svg).toContain('<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="rgb(0, 0, 255)"/>');
    expect(svg).toContain('<rect data-sid="__background" x="0" y="0" width="1080" height="1350" fill="url(#c-bg)"/>');
    const toBottom = canvasToSvg(canvas({ background: 'linear-gradient(#fff, #000)', layers: [] }), { assetUrl });
    expect(toBottom).toContain('x1="540" y1="0" x2="540" y2="1350"');
    const corner = canvasToSvg(canvas({ background: 'linear-gradient(to top right, red, blue 80%)', layers: [] }), { assetUrl });
    expect(corner).toContain('<stop offset="0.8" stop-color="blue"/>');
  });

  it('radial-gradient → radialGradient; Unbekanntes als HTML-Fläche bzw. erste Farbe (tspan)', () => {
    const radial = canvasToSvg(canvas({ background: 'radial-gradient(circle at 25% 50%, #fff, #000)', layers: [] }), { assetUrl });
    expect(radial).toMatch(/<radialGradient id="c-bg" gradientUnits="userSpaceOnUse" cx="270" cy="675" r="[\d.]+">/);
    const conic = canvasToSvg(canvas({ background: 'conic-gradient(#f00, #00f)', layers: [] }), { assetUrl });
    expect(conic).toContain('<foreignObject data-sid="__background"');
    expect(conic).toContain('background: conic-gradient(#f00, #00f)');
    const plain = canvasToSvg(canvas({ background: 'conic-gradient(#f00, #00f)', layers: [] }), { assetUrl, textMode: 'tspan' });
    expect(plain).toContain('fill="#f00"');
    expect(canvasToSvg(canvas({ background: 'transparent', layers: [] }), { assetUrl })).toContain('fill="transparent"');
  });
});
