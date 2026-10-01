import { deckSchema, type Deck, type DeckInput } from '@studio/core';
import { describe, expect, it } from 'vitest';
import { chartToSvg, deckFontFaces, deckToHtml, markdownToHtml, niceTicks, sanitizeHtml, slideToHtml } from '../src/browser.ts';

function deck(input: Partial<DeckInput> = {}): Deck {
  return deckSchema.parse({
    kind: 'deck',
    theme: { name: 'Test', colors: { background: '#101820', text: '#f5f5f0', accent: '#ff5a36' }, fonts: { heading: 'Fraunces', body: 'Inter' } },
    slides: [
      {
        id: 's1',
        title: 'Start',
        notes: 'GEHEIME SPRECHERNOTIZ',
        elements: [
          { id: 'e_title', type: 'text', x: 120, y: 80, width: 1200, height: 200, text: 'Hallo **Welt** <script>alert(1)</script>', style: { role: 'title', color: 'accent' } },
          { id: 'e_img', type: 'image', x: 1300, y: 200, width: 500, height: 400, rotation: 5, z: 2, assetId: 'ast_1', style: { fit: 'contain' } },
          { id: 'e_shape', type: 'shape', x: 0, y: 1000, width: 1920, height: 80, shape: 'rect', style: { fill: 'accent', radius: 12 } },
          { id: 'e_html', type: 'html', x: 100, y: 500, width: 600, height: 300, html: '<div onclick="steal()" class="box">Box<img src="x" onerror="alert(2)"><a href="javascript:alert(3)">Link</a><script>evil()</script><style>.box{color:red}</style><iframe src="https://evil.example"></iframe></div>' },
          { id: 'e_chart', type: 'chart', x: 800, y: 500, width: 800, height: 400, chart: { type: 'bar', labels: ['Q1', 'Q2', 'Q3'], series: [{ name: 'Umsatz', values: [10, 25, 18] }, { name: 'Kosten', values: [8, 12, 9] }] } },
        ],
      },
      { id: 's2', hidden: true, background: { assetId: 'ast_bg' }, elements: [{ id: 'e_v', type: 'video', x: 0, y: 0, width: 1920, height: 1080, assetId: 'ast_vid' }] },
      { id: 's3', background: '#ffffff', elements: [] },
    ],
    ...input,
  });
}

const assetUrl = (id: string) => `file:///assets/${id}.bin`;

describe('deckToHtml', () => {
  it('erzeugt ein vollständiges Dokument mit Folien, data-sid und Positionen', () => {
    const html = deckToHtml(deck(), { assetUrl, mode: 'stage' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('<section class="slide" data-sid="s1" data-slide-id="s1" data-slide-index="1" aria-label="Start">');
    expect(html).toMatch(/data-sid="e_title"[^>]*style="left: 120px; top: 80px; width: 1200px; height: 200px; z-index: 1; color: var\(--color-accent\)"/);
    expect(html).toMatch(/data-sid="e_img"[^>]*style="left: 1300px; top: 200px; width: 500px; height: 400px; z-index: 3; transform: rotate\(5deg\)"/);
    expect(html).toContain('src="file:///assets/ast_1.bin"');
    expect(html).toContain('object-fit: contain');
    expect(html).toContain('--color-accent: #ff5a36');
    expect(html).toContain('--font-heading: "Fraunces", system-ui, sans-serif');
    // Bühne: alle Folien inkl. ausgeblendeter
    expect(html).toContain('data-sid="s2"');
    expect(html).toContain('data-hidden=""');
    expect(html).toContain('background-image: url(&quot;file:///assets/ast_bg.bin&quot;)');
    expect(html).toContain('src="file:///assets/ast_vid.bin#t=0.001"');
  });

  it('maskiert Text, wandelt Markdown und gibt nie Sprechernotizen aus', () => {
    const html = deckToHtml(deck(), { assetUrl, mode: 'stage' });
    expect(html).toContain('<p>Hallo <strong>Welt</strong> &lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(html).not.toContain('GEHEIME SPRECHERNOTIZ');
    expect(markdownToHtml('Eins *kursiv*\nZwei\n\n- Punkt **A**\n- Punkt B')).toBe('<p>Eins <em>kursiv</em><br>Zwei</p><ul><li>Punkt <strong>A</strong></li><li>Punkt B</li></ul>');
    expect(markdownToHtml('2 * 3 = 6 und a*b')).toBe('<p>2 * 3 = 6 und a*b</p>');
  });

  it('entfernt Skripte, on*-Attribute, javascript:-URLs und iframes aus HTML-Blöcken; CSS wird gekapselt', () => {
    const html = deckToHtml(deck(), { assetUrl, mode: 'stage' });
    const block = html.slice(html.indexOf('data-sid="e_html"'), html.indexOf('data-sid="e_chart"'));
    expect(block).not.toMatch(/<script/i);
    expect(block).not.toMatch(/\son\w+=/i);
    expect(block).not.toContain('javascript:');
    expect(block).not.toContain('<iframe');
    expect(block).toContain('class="box"');
    expect(block).toContain('<style>@scope ([data-sid="e_html"]) { .box{color:red} }</style>');
    // Seite selbst: CSP ohne Skripte
    expect(html).toContain(`content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"`);
    expect(html.match(/<script/gi)).toBeNull();
    expect(sanitizeHtml('<svg><script>x()</script><a xlink:href="java&#x73;cript:alert(1)">x</a></svg>')).toBe('<svg><a>x</a></svg>');
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).toBe('<img src="x">');
  });

  it('Diagramme als Inline-SVG mit Legende ab zwei Reihen', () => {
    const html = deckToHtml(deck(), { assetUrl, mode: 'stage' });
    const chart = html.slice(html.indexOf('data-sid="e_chart"'));
    expect(chart).toContain('<svg xmlns="http://www.w3.org/2000/svg" class="chart chart-bar"');
    expect(chart).toContain('>Umsatz</text>');
    expect(chart).toContain('>Kosten</text>');
    expect((chart.match(/<path d="M/g) ?? []).length).toBe(6);
    expect(niceTicks(0, 25)).toEqual([0, 10, 20, 30]);
    expect(niceTicks(-3, 7)).toEqual([-4, -2, 0, 2, 4, 6, 8]);
    const pie = chartToSvg({ type: 'pie', labels: ['A', 'B'], series: [{ name: 'Anteil', values: [3, 1] }] }, { width: 400, height: 300 });
    expect(pie).toContain('75 %');
    const line = chartToSvg({ type: 'line', labels: ['a', 'b', 'c'], series: [{ name: 'x', values: [1, 3, 2] }] }, { width: 400, height: 300 });
    expect(line).toContain('<polyline');
    expect(line).not.toContain('>x</text>');
  });

  it('Export-Modus: Seitenumbrüche, @page in Deckgröße, ausgeblendete Folien ausgelassen', () => {
    const html = deckToHtml(deck(), { assetUrl, mode: 'export' });
    expect(html).toContain('@page { size: 1920px 1080px; margin: 0; }');
    expect(html).toContain('break-after: page');
    expect(html).not.toContain('data-sid="s2"');
    expect(html).toContain('data-sid="s3"');
    const only = deckToHtml(deck(), { assetUrl, mode: 'export', slideIds: ['s2'] });
    expect(only).toContain('data-sid="s2"');
    expect(only).not.toContain('data-sid="s1"');
  });

  it('slideToHtml und Picker mit Nonce', () => {
    const html = slideToHtml(deck(), 's3', { assetUrl, mode: 'stage', picker: true });
    expect(html).toContain('data-sid="s3"');
    expect(html).not.toContain('data-sid="s1"');
    const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(html)?.[1];
    expect(nonce).toBeDefined();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(() => slideToHtml(deck(), 'gibtsnicht', { assetUrl, mode: 'stage' })).toThrow('Folie "gibtsnicht" existiert nicht');
  });

  it('Theme-CSS wird auf Folien begrenzt und kann das style-Tag nicht verlassen', () => {
    const d = deck({ theme: { colors: {}, fonts: { heading: 'A', body: 'B' }, css: '.x { color: red } </style><script>alert(1)</script>' } });
    const html = deckToHtml(d, { assetUrl, mode: 'stage' });
    expect(html).toContain('@scope (.slide) {');
    expect(html).not.toContain('</style><script>');
  });
});

describe('deckToHtml: Schrift-Assets und Silbentrennung', () => {
  const SHY = '\u00AD';

  it('theme.fontAssets → @font-face über assetUrl; explizite fontFaces haben Vorrang; gefährliche URLs entfallen', () => {
    const d = deck({ theme: { colors: {}, fonts: { heading: 'Fraunces', body: 'Inter' }, fontAssets: { Fraunces: 'ast_font_f', Inter: 'ast_font_i', Böse: 'ast_evil' } } });
    const urls: Record<string, string> = { ast_font_f: 'file:///fonts/Fraunces.woff2', ast_font_i: 'file:///fonts/Inter.ttf', ast_evil: 'javascript:alert(1)' };
    const html = deckToHtml(d, { assetUrl: (id) => urls[id] ?? '', mode: 'stage' });
    expect(html).toContain('@font-face { font-family: "Fraunces"; src: url("file:///fonts/Fraunces.woff2"); font-style: normal; font-display: block; }');
    expect(html).toContain('src: url("file:///fonts/Inter.ttf")');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('"Böse"');
    const explicit = deckToHtml(d, { assetUrl: (id) => urls[id] ?? '', mode: 'stage', fontFaces: [{ family: 'Inter', src: 'file:///fonts/Inter-Bold.woff2', weight: 700 }] });
    expect(explicit).toContain('src: url("file:///fonts/Inter-Bold.woff2"); font-weight: 700');
    expect(explicit).not.toContain('Inter.ttf');
    expect(explicit).toContain('Fraunces.woff2');
    expect(deckFontFaces(d, { assetUrl: () => { throw new Error('kein Asset'); } })).toEqual([]);
  });

  it('deutsche Texte bekommen bedingte Trennstriche (nur im Text, nicht in Attributen); abschaltbar', () => {
    const d = deck({
      slides: [
        {
          id: 's1',
          title: 'Geschwindigkeitsbegrenzung',
          elements: [
            { id: 'a', type: 'text', x: 0, y: 0, width: 300, height: 200, name: 'Geschwindigkeitsbegrenzung', text: '**Geschwindigkeitsbegrenzung** im Morgengrauen', style: { role: 'title' } },
            { id: 'b', type: 'text', x: 0, y: 300, width: 300, height: 200, text: 'Lichterkette', style: { hyphens: 'none' } },
          ],
        },
      ],
    });
    const html = deckToHtml(d, { assetUrl, mode: 'stage' });
    expect(html).toContain(`<strong>Ge${SHY}schwin${SHY}dig${SHY}keits${SHY}be${SHY}gren${SHY}zung</strong> im Mor${SHY}gen${SHY}grau${SHY}en`);
    expect(html).toContain('aria-label="Geschwindigkeitsbegrenzung"');
    expect(html).toContain('data-name="Geschwindigkeitsbegrenzung"');
    const b = html.slice(html.indexOf('data-sid="b"'));
    expect(b.slice(0, b.indexOf('</div>'))).toContain('>Lichterkette');
    const en = deckToHtml(d, { assetUrl, mode: 'stage', lang: 'en' });
    expect(en).toContain('<html lang="en">');
    expect(en).not.toContain(SHY);
    expect(deckToHtml(d, { assetUrl, mode: 'stage', hyphenate: false })).not.toContain(SHY);
  });
});
