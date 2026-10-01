// Pixel-inspection sheet: each tile nearest-neighbour zoomed to one common cell, plus its 1x rendition, on a dark
// (#1E1F22) and a light (#ECEBE7) row. A fixed CSS grid keeps every row aligned (no staggering, no filler blocks).
const { renderHtml, b64 } = require('./render');

/** items: [{ file, size, label }]; cell: zoomed edge in CSS px. */
function zoomSheetHtml(items, { cell = 192, title = '' } = {}) {
  const fig = (it, bg, fg) => {
    const z = Math.max(1, Math.floor(cell / it.size));
    const src = b64(it.file);
    return `<figure style="background:${bg};color:${fg}">
      <div class="z"><img src="${src}" width="${it.size * z}" height="${it.size * z}"></div>
      <div class="one"><img src="${src}" width="${it.size}" height="${it.size}"></div>
      <figcaption>${it.label} · ${z}x</figcaption></figure>`;
  };
  const row = (bg, fg) => items.map((it) => fig(it, bg, fg)).join('');
  return `<!doctype html><html><head><style>
    html,body{margin:0;background:#1E1F22;font:600 11px ui-monospace,monospace}
    h1{margin:0;padding:14px 16px 0;font-size:12px;color:#8C8881;font-weight:600}
    .g{display:grid;grid-template-columns:repeat(${items.length},${cell + 24}px);grid-auto-rows:auto}
    figure{margin:0;padding:12px;display:grid;grid-template-rows:${cell}px 72px 16px;justify-items:center;align-items:center}
    .z img{image-rendering:pixelated;display:block}.one{display:grid;place-items:center}.one img{display:block}
    figcaption{opacity:.75}
  </style></head><body>${title ? `<h1>${title}</h1>` : ''}<div class="g">${row('#1E1F22', '#8C8881')}${row('#ECEBE7', '#615E59')}</div></body></html>`;
}

async function zoomSheet(items, out, opts = {}) {
  const cell = opts.cell || 192;
  await renderHtml(zoomSheetHtml(items, opts), out, items.length * (cell + 24), 2 * (cell + 24 + 88 + 16) + 40, 1);
}

module.exports = { zoomSheet, zoomSheetHtml };

if (require.main === module) {
  const path = require('path');
  const { close } = require('./render');
  const [out, ...rest] = process.argv.slice(2);
  const items = rest.map((s) => { const [file, label] = s.split('='); const size = require('fs').readFileSync(file).readUInt32BE(16); return { file, size, label: label || path.basename(file) }; });
  zoomSheet(items, out).then(close).catch((e) => { console.error(e); process.exit(1); });
}
