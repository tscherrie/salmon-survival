// Playwright Chromium helpers: render SVG strings to exact-size transparent PNGs, and HTML pages to PNGs.
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require(require.resolve('playwright', { paths: ['/home/user/salmon-survival/director-studio'] }));

let browserP = null;
const browser = () => (browserP ||= chromium.launch({ executablePath: CHROME }));

async function renderSvgs(jobs) {
  const b = await browser();
  const page = await b.newPage({ deviceScaleFactor: 1 });
  for (const j of jobs) {
    await page.setViewportSize({ width: j.size, height: j.size });
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style></head><body>${j.svg}</body></html>`);
    await page.screenshot({ path: j.out, omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  }
  await page.close();
}

async function renderHtml(html, out, width, height, scale = 1, transparent = false) {
  const b = await browser();
  const page = await b.newPage({ deviceScaleFactor: scale, viewport: { width, height } });
  await page.setContent(html);
  await page.waitForTimeout(50);
  await page.screenshot({ path: out, fullPage: true, omitBackground: transparent });
  await page.close();
}

const b64 = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
const close = async () => { if (browserP) (await browserP).close(); };

module.exports = { renderSvgs, renderHtml, b64, close };
