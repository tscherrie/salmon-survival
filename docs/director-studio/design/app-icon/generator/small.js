// Small-size inspection sheet: every size <= 128 of both families, at 1x and 8x nearest-neighbour,
// on a dark (#1E1F22) and a light (#ECEBE7) background.
const path = require('path');
const { build } = require('./icon');
const { MAC, WIN, opts } = require('./sizes');
const { renderSvgs, renderHtml, b64, close } = require('./render');
const W = path.join(__dirname, 'small');
require('fs').mkdirSync(W, { recursive: true });

const list = (process.argv[2] || 'mac16,win20,win24,win30,mac32,win32,win36,win40,win48,mac64').split(',').map((k) => [k.slice(0, 3), +k.slice(3)]);
const zoom = (N) => (N <= 32 ? 8 : N <= 48 ? 6 : 4);

(async () => {
  await renderSvgs(list.map(([fam, N]) => ({ svg: build(opts(fam, N)), size: N, out: path.join(W, `${fam}-${N}.png`) })));
  const cell = ([fam, N], bg) => `<figure style="background:${bg}"><img class="z" src="${b64(path.join(W, `${fam}-${N}.png`))}" width="${N * zoom(N)}" height="${N * zoom(N)}">` +
    `<img src="${b64(path.join(W, `${fam}-${N}.png`))}" width="${N}" height="${N}"><figcaption>${fam} ${N}</figcaption></figure>`;
  const html = `<!doctype html><html><head><style>body{margin:0;font:600 12px monospace;color:#888;background:#777}
    .row{display:flex;flex-wrap:wrap;gap:0}figure{margin:0;padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px}
    img.z{image-rendering:pixelated}</style></head><body>
    <div class="row">${list.map((x) => cell(x, '#1E1F22')).join('')}</div>
    <div class="row">${list.map((x) => cell(x, '#ECEBE7')).join('')}</div></body></html>`;
  await renderHtml(html, path.join(__dirname, process.argv[3] || 'small-sheet.png'), 2400, 600, 1);
  await close();
})().catch((e) => { console.error(e); process.exit(1); });
