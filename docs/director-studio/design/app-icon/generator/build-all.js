// Builds every raster/vector deliverable into ../ (final/):
//   icon.svg (1024 macOS master), icon.png, icon.iconset/, linux/, svg/ (hand-tuned small masters),
//   work/win/*.png (inputs for icon.ico: 16, 20, 24, 30, 32, 36, 40, 48, 64, 128, 256). icns + ico are packed by pack.py, mockups by mockups.js.
const fs = require('fs');
const path = require('path');
const { build } = require('./icon');
const { MAC, WIN, opts } = require('./sizes');
const { renderSvgs, close } = require('./render');
const { execFileSync } = require('child_process');

const FINAL = path.resolve(__dirname, '..');
const dir = (p) => { fs.mkdirSync(p, { recursive: true }); return p; };
const ICONSET = dir(path.join(FINAL, 'icon.iconset'));
const LINUX = dir(path.join(FINAL, 'linux'));
const SVGS = dir(path.join(FINAL, 'svg'));
const MACDIR = dir(path.join(__dirname, 'mac'));
const WINDIR = dir(path.join(__dirname, 'win'));

(async () => {
  const jobs = [];
  const macSvg = {}, winSvg = {};
  for (const N of Object.keys(MAC).map(Number)) {
    macSvg[N] = build(opts('mac', N));
    jobs.push({ svg: macSvg[N], size: N, out: path.join(MACDIR, `${N}.png`) });
  }
  for (const N of Object.keys(WIN).map(Number)) {
    winSvg[N] = build(opts('win', N));
    jobs.push({ svg: winSvg[N], size: N, out: path.join(WINDIR, `${N}.png`) });
  }
  await renderSvgs(jobs);
  // Pin the colour space: sRGB + gAMA + cHRM chunks on every rendition (pixels unchanged).
  execFileSync('python3', [path.join(__dirname, 'srgb.py'), ...jobs.map((j) => j.out)], { stdio: 'inherit' });

  // Master and per-size SVG sources
  fs.writeFileSync(path.join(FINAL, 'icon.svg'), macSvg[1024] + '\n');
  fs.copyFileSync(path.join(MACDIR, '1024.png'), path.join(FINAL, 'icon.png'));
  for (const N of [16, 32, 64, 128]) fs.writeFileSync(path.join(SVGS, `mac-${N}.svg`), macSvg[N] + '\n');
  for (const N of [16, 20, 24, 30, 32, 36, 40, 48, 64]) fs.writeFileSync(path.join(SVGS, `win-${N}.svg`), winSvg[N] + '\n');
  fs.writeFileSync(path.join(SVGS, 'tile-512.svg'), winSvg[512] + '\n');

  // macOS iconset, exact Apple names
  const map = {
    'icon_16x16.png': 16, 'icon_16x16@2x.png': 32, 'icon_32x32.png': 32, 'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128, 'icon_128x128@2x.png': 256, 'icon_256x256.png': 256, 'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512, 'icon_512x512@2x.png': 1024,
  };
  for (const [name, N] of Object.entries(map)) fs.copyFileSync(path.join(MACDIR, `${N}.png`), path.join(ICONSET, name));

  // Linux (electron-builder icon directory: NxN.png) uses the fuller tile, like Windows
  for (const N of [16, 24, 32, 48, 64, 128, 256, 512]) fs.copyFileSync(path.join(WINDIR, `${N}.png`), path.join(LINUX, `${N}x${N}.png`));
  await close();
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
