// Quick comparison sheet: variants at 512 + 128 + 64 on dark and light.
const path = require('path');
const { build, DESIGN } = require('./icon');
const { renderSvgs, renderHtml, b64, close } = require('./render');
const W = __dirname;

const mac = (N) => {
  const body = { 16: 14, 32: 26, 64: 52, 128: 104, 256: 206, 512: 412 }[N];
  return { N, body, off: (N - body) / 2, shadow: N >= 128 };
};

const variants = {};
const merge = (a, b) => Object.assign(JSON.parse(JSON.stringify(a)), b);
variants.final = DESIGN;

for (const [k, v] of Object.entries(JSON.parse(process.argv[2] || '{}'))) variants[k] = merge(DESIGN, v);

(async () => {
  const jobs = [];
  for (const [k, d] of Object.entries(variants)) {
    for (const N of [512, 128, 64]) jobs.push({ svg: build(mac(N), d), size: N, out: path.join(W, `pv-${k}-${N}.png`) });
  }
  await renderSvgs(jobs);
  const row = (bg) => `<div class="row" style="background:${bg}">` + Object.keys(variants).map((k) =>
    `<figure><img src="${b64(path.join(W, `pv-${k}-512.png`))}" width="256" height="256"><div class="sm"><img src="${b64(path.join(W, `pv-${k}-128.png`))}" width="64" height="64"><img src="${b64(path.join(W, `pv-${k}-64.png`))}" width="32" height="32"></div><figcaption>${k}</figcaption></figure>`).join('') + '</div>';
  const html = `<!doctype html><html><head><style>body{margin:0;font:600 13px monospace;color:#888}.row{display:flex;gap:16px;padding:16px}figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}.sm{display:flex;gap:12px;align-items:center}</style></head><body>${row('#1E1F22')}${row('#ECEBE7')}</body></html>`;
  await renderHtml(html, path.join(W, 'preview.png'), 300 * Object.keys(variants).length, 400, 1);
  await close();
})().catch((e) => { console.error(e); process.exit(1); });
