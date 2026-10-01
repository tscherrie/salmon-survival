// Preview of the Icon Composer layers: each layer alone on a checkerboard, and the flat composite (no glass)
// inside a full-canvas rounded-rect mask, next to the shipped icon.png for comparison.
const fs = require('fs');
const path = require('path');
const { squircle } = require('./icon');
const { renderHtml, b64, close } = require('./render');
const FINAL = path.resolve(__dirname, '..');
const LAYERS = path.join(FINAL, 'layers');
const url = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(LAYERS, f)).toString('base64');
const files = [['background.svg', 'background (fill)'], ['rule.svg', 'Timeline rule'], ['marker.svg', 'Marker'], ['drop-line.svg', 'Drop line · 50 %'], ['playhead.svg', 'Playhead']];
const mask = squircle(0, 0, 1024, 1024, 230);
const cell = (f, label) => `<figure><div class="ck"><img src="${url(f)}"></div><figcaption>${label}</figcaption></figure>`;
const comp = `<figure><svg viewBox="0 0 1024 1024" width="300" height="300"><defs><clipPath id="m"><path d="${mask}"/></clipPath></defs>
  <g clip-path="url(#m)">${files.map(([f]) => `<image href="${url(f)}" width="1024" height="1024"${f === 'drop-line.svg' ? ' opacity=".5"' : ''}/>`).join('')}</g></svg>
  <figcaption>flat composite, full-canvas mask</figcaption></figure>`;
const ref = `<figure><img src="${b64(path.join(FINAL, 'icon.png'))}" width="300" height="300"><figcaption>icon.png (legacy .icns master)</figcaption></figure>`;
const html = `<!doctype html><html><head><style>
  body{margin:0;background:#2A2B2E;color:#B9B5AE;font:600 12px ui-monospace,monospace}
  .r{display:flex;gap:18px;padding:18px;align-items:flex-end}
  figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:8px}
  .ck{width:180px;height:180px;background:repeating-conic-gradient(#3a3b3f 0 25%,#2f3034 0 50%) 0 0/20px 20px}
  .ck img{width:180px;height:180px;display:block}
</style></head><body><div class="r">${files.map(([f, l]) => cell(f, l)).join('')}</div><div class="r">${comp}${ref}</div></body></html>`;
renderHtml(html, path.join(LAYERS, 'layers-preview.png'), 1030, 600, 1).then(close).then(() => console.log('ok'));
