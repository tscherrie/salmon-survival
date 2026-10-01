// Context mockups (final/mockups/): macOS Dock dark + light, Finder 128 px tile, Windows taskbar 24/32 px
// dark + light, and an overview sheet of every shipped size. Neutral placeholder icons only, no brands.
const fs = require('fs');
const path = require('path');
const { squircle } = require('./icon');
const { renderHtml, b64, close } = require('./render');
const { zoomSheet } = require('./zoomsheet');
const { execFileSync } = require('child_process');

const FINAL = path.resolve(__dirname, '..');
const OUT = path.join(FINAL, 'mockups');
fs.mkdirSync(OUT, { recursive: true });
const MAC = (n) => b64(path.join(__dirname, 'mac', `${n}.png`));
const WIN = (n) => b64(path.join(__dirname, 'win', `${n}.png`));

// Placeholder app tiles on the same macOS grid (body 824 at 100, baked contact shadow like ours).
const BODY = squircle(100, 100, 824, 824, 185);
const PH = [
  { bg: ['#FFFFFF', '#E7E7EA'], g: '<circle cx="512" cy="512" r="190" fill="none" stroke="#9A9AA0" stroke-width="56"/>' },
  { bg: ['#A2A2A8', '#7C7C82'], g: '<rect x="332" y="332" width="360" height="360" rx="70" fill="#F4F4F6"/>' },
  { bg: ['#3C3C40', '#262629'], g: '<rect x="300" y="360" width="424" height="40" rx="20" fill="#B8B8BE"/><rect x="300" y="492" width="424" height="40" rx="20" fill="#8E8E94"/><rect x="300" y="624" width="280" height="40" rx="20" fill="#8E8E94"/>' },
  { bg: ['#DADADF', '#C2C2C8'], g: '<path d="M512 300 L724 690 H300 Z" fill="#6E6E74"/>' },
  null,
  { bg: ['#F5F4F1', '#E0DFDB'], g: '<g fill="#A9A8A4"><rect x="300" y="300" width="180" height="180" rx="36"/><rect x="544" y="300" width="180" height="180" rx="36"/><rect x="300" y="544" width="180" height="180" rx="36"/><rect x="544" y="544" width="180" height="180" rx="36" fill="#7A7975"/></g>' },
  { bg: ['#1F1F22', '#111113'], g: '<circle cx="512" cy="512" r="170" fill="#55555B"/><circle cx="512" cy="512" r="70" fill="#1A1A1C"/>' },
  { bg: ['#6B6B70', '#525257'], g: '<rect x="290" y="420" width="444" height="184" rx="92" fill="#E6E6EA"/>' },
];
const phSvg = (p, i, size) => `<svg viewBox="0 0 1024 1024" width="${size}" height="${size}"><defs>` +
  `<linearGradient id="g${i}" x1="0" y1="100" x2="0" y2="924" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></linearGradient>` +
  `<clipPath id="c${i}"><path d="${BODY}"/></clipPath><filter id="f${i}" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="12"/><feOffset dy="10"/><feComponentTransfer><feFuncA type="linear" slope=".3"/></feComponentTransfer></filter></defs>` +
  `<path d="${BODY}" fill="#000" filter="url(#f${i})"/><path d="${BODY}" fill="url(#g${i})"/><g clip-path="url(#c${i})">${p.g}</g>` +
  `<path d="${BODY}" fill="none" stroke="rgba(0,0,0,.08)" stroke-width="3"/></svg>`;

// ---- macOS Dock (64 pt tiles at 2x: macOS samples the 128 px rendition) -------------------------
function dock(theme) {
  const dark = theme === 'dark';
  const wall = dark
    ? 'radial-gradient(120% 100% at 30% 0%, #2E3440 0%, #1A1D24 55%, #111317 100%)'
    : 'radial-gradient(120% 100% at 30% 0%, #F3EEE6 0%, #DCD8D0 60%, #C9C6BF 100%)';
  const tiles = PH.map((p, i) => (p ? `<div class="t">${phSvg(p, i, 64)}</div>`
    : `<div class="t me"><img src="${MAC(128)}" width="64" height="64"><i></i><span>Director Studio</span></div>`)).join('');
  return `<!doctype html><html><head><style>
    html,body{margin:0;width:760px;height:260px;background:${wall};overflow:hidden;font:500 12px -apple-system,system-ui,sans-serif}
    .win{position:absolute;left:70px;top:28px;width:620px;height:110px;border-radius:14px;background:${dark ? '#1C1C1E' : '#F6F5F2'};
      border:1px solid ${dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.12)'};box-shadow:0 18px 44px rgba(0,0,0,${dark ? .5 : .18})}
    .win b{position:absolute;left:14px;top:12px;display:flex;gap:8px}.win b u{width:12px;height:12px;border-radius:50%;background:${dark ? '#3A3A3C' : '#D5D3CF'}}
    .dock{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px;padding:7px 9px 9px;border-radius:24px;
      background:${dark ? 'rgba(40,40,44,.62)' : 'rgba(255,255,255,.5)'};border:1px solid ${dark ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.7)'};
      box-shadow:0 10px 30px rgba(0,0,0,${dark ? .45 : .16}), inset 0 1px 0 rgba(255,255,255,${dark ? .08 : .5});backdrop-filter:blur(20px)}
    .t{position:relative;width:64px;height:64px}.t svg,.t img{display:block}
    .me i{position:absolute;left:50%;bottom:-6px;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:${dark ? 'rgba(255,255,255,.8)' : 'rgba(0,0,0,.6)'}}
    .me span{position:absolute;bottom:80px;left:50%;transform:translateX(-50%);white-space:nowrap;padding:3px 9px;border-radius:7px;
      background:${dark ? 'rgba(50,50,54,.92)' : 'rgba(246,245,242,.95)'};color:${dark ? '#ECE9E4' : '#1A1A1B'};border:1px solid ${dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)'}}
  </style></head><body><div class="win"><b><u></u><u></u><u></u></b></div><div class="dock">${tiles}</div></body></html>`;
}

// ---- Finder icon view, 128 px tiles at 1x, light and dark appearance ---------------------------------
function finder() {
  const pane = (dark) => {
    const items = [
      ['Archive Utility', phSvg(PH[3], 13, 128)],
      ['Director Studio', `<img src="${MAC(128)}" width="128" height="128">`, true],
      ['Preview', phSvg(PH[5], 15, 128)],
    ].map(([n, img, sel]) => `<figure class="${sel ? 'sel' : ''}">${img}<figcaption>${n}</figcaption></figure>`).join('');
    return `<div class="fw ${dark ? 'd' : 'l'}"><header><b><u></u><u></u><u></u></b><span>Applications</span></header>
      <aside><p>Favorites</p><a>Applications</a><a>Desktop</a><a>Documents</a><a>Downloads</a></aside><main>${items}</main></div>`;
  };
  return `<!doctype html><html><head><style>
    html,body{margin:0;background:#8F8D88;font:500 12px -apple-system,system-ui,sans-serif}
    .wrap{display:flex;gap:24px;padding:24px}
    .fw{width:620px;height:300px;border-radius:12px;overflow:hidden;display:grid;grid-template-columns:150px 1fr;grid-template-rows:44px 1fr;box-shadow:0 16px 40px rgba(0,0,0,.3)}
    .fw header{grid-column:1/3;display:flex;align-items:center;gap:16px;padding:0 14px;font-weight:700}
    .fw header b{display:flex;gap:8px}.fw header u{width:12px;height:12px;border-radius:50%}
    .fw aside{padding:6px 10px;font-size:12px}.fw aside p{margin:6px 6px;font-size:11px;font-weight:700;opacity:.5}.fw aside a{display:block;padding:4px 8px;border-radius:6px}
    .fw aside a:first-of-type{background:var(--sb)}
    .fw main{display:flex;gap:18px;padding:22px 20px;align-items:flex-start}
    figure{margin:0;width:140px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:6px 0;border-radius:10px}
    figure svg,figure img{display:block}
    figcaption{padding:1px 6px;border-radius:5px}
    figure.sel{background:var(--selbg)}figure.sel figcaption{background:#2F6BD8;color:#fff}
    .l{background:#FFFFFF;color:#1D1D1F;--sb:rgba(0,0,0,.07);--selbg:rgba(0,0,0,.06)}.l header{background:#F4F4F4;border-bottom:1px solid #E2E2E2}.l aside{background:#EFEFEF}.l header u{background:#D3D3D3}
    .d{background:#1E1E1E;color:#E8E8E8;--sb:rgba(255,255,255,.09);--selbg:rgba(255,255,255,.08)}.d header{background:#2A2A2A;border-bottom:1px solid #111}.d aside{background:#252525}.d header u{background:#4A4A4A}
  </style></head><body><div class="wrap">${pane(false)}${pane(true)}</div></body></html>`;
}

// ---- Windows 11 taskbar: 24 px icons (100 %) and 32 px icons, dark and light ----------------------------
function taskbar() {
  const glyph = (kind, c) => ({
    search: `<svg width="S" height="S" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="${c}" stroke-width="2"/><path d="M15 15l5 5" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`,
    folder: '<svg width="S" height="S" viewBox="0 0 24 24"><path d="M2 6.5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#D9B45A"/><path d="M2 9h20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#EBC96E"/></svg>',
    globe: '<svg width="S" height="S" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#6E8FB3"/><path d="M2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20" stroke="#DCE6F0" stroke-width="1.4" fill="none"/></svg>',
    note: '<svg width="S" height="S" viewBox="0 0 24 24"><rect x="3" y="2" width="18" height="20" rx="3" fill="#8E9AA6"/><path d="M7 8h10M7 12h10M7 16h6" stroke="#F2F4F6" stroke-width="1.6"/></svg>',
    term: '<svg width="S" height="S" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="18" rx="3" fill="#3B3F45"/><path d="M6 9l3 3-3 3M11 15h6" stroke="#E6E6E6" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  })[kind];
  const bar = (dark, n, label) => {
    const k = n / 24, h = Math.round(48 * k), slot = Math.round(40 * k);
    const fg = dark ? '#FFFFFF' : '#1B1B1B';
    const icon = (kind) => `<div class="slot" style="width:${slot}px;height:${slot}px">${glyph(kind, fg).replace(/S/g, n)}</div>`;
    return `<div class="bar ${dark ? 'd' : 'l'}" style="height:${h}px"><div class="mid">
      ${icon('search')}${icon('folder')}${icon('globe')}
      <div class="slot on" style="width:${slot}px;height:${slot}px"><img src="${WIN(n)}" width="${n}" height="${n}"><i style="width:${Math.round(16 * k)}px;height:${Math.round(3 * k)}px;margin-left:-${Math.round(8 * k)}px"></i></div>
      ${icon('note')}${icon('term')}</div><div class="clock">${label} · ${n} px · ${dark ? 'dark' : 'light'}</div></div>`;
  };
  return `<!doctype html><html><head><style>
    html,body{margin:0;background:#777;font:400 12px 'Segoe UI',system-ui,sans-serif}
    .wall{width:640px;padding-top:18px}
    .wall.d{background:linear-gradient(160deg,#20324A,#0E1520)}.wall.l{background:linear-gradient(160deg,#C9D6E6,#EEF2F7)}
    .bar{position:relative;display:flex;align-items:center;justify-content:center;border-top:1px solid}
    .bar.d{background:rgba(32,32,32,.94);border-color:#3A3A3A;color:#fff}.bar.l{background:rgba(243,243,243,.95);border-color:#D8D8D8;color:#1B1B1B}
    .mid{display:flex;gap:2px}
    .slot{position:relative;display:flex;align-items:center;justify-content:center;border-radius:4px}
    .slot img,.slot svg{display:block}
    .bar.d .slot.on{background:rgba(255,255,255,.08)}.bar.l .slot.on{background:rgba(0,0,0,.05)}
    .slot.on i{position:absolute;bottom:2px;left:50%;border-radius:2px;background:#4CC2FF}
    .bar.l .slot.on i{background:#005FB8}
    .clock{position:absolute;right:12px;font-size:11px;opacity:.75}
  </style></head><body>
    ${[[24, '100 %'], [30, '125 %'], [36, '150 %'], [32, 'large']].map(([n, l]) => `<div class="wall d">${bar(true, n, l)}</div><div class="wall l">${bar(false, n, l)}</div>`).join('')}</body></html>`;
}

// ---- overview of every shipped rendition, at 1x, on dark and light ---------------------------------------
function overview() {
  const row = (bg, fg) => `<div class="row" style="background:${bg};color:${fg}">
    <div class="grp"><h4>macOS (.icns / iconset)</h4><div class="line">${[16, 32, 64, 128, 256].map((n) => `<figure><img src="${MAC(n)}" width="${n}" height="${n}"><figcaption>${n}</figcaption></figure>`).join('')}</div></div>
    <div class="grp"><h4>Windows (.ico) / Linux</h4><div class="line">${[16, 20, 24, 30, 32, 36, 40, 48, 64, 128].map((n) => `<figure><img src="${WIN(n)}" width="${n}" height="${n}"><figcaption>${n}</figcaption></figure>`).join('')}</div></div></div>`;
  return `<!doctype html><html><head><style>
    html,body{margin:0;font:600 11px ui-monospace,monospace}
    .row{display:flex;gap:40px;padding:18px 24px}.line{gap:14px!important}
    h4{margin:0 0 10px;font-size:11px;opacity:.7}.line{display:flex;align-items:flex-end;gap:18px}
    figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}img{display:block}
  </style></head><body>${row('#1E1F22', '#8C8881')}${row('#ECEBE7', '#615E59')}</body></html>`;
}

(async () => {
  await renderHtml(dock('dark'), path.join(OUT, 'dock-dark.png'), 760, 260, 2);
  await renderHtml(dock('light'), path.join(OUT, 'dock-light.png'), 760, 260, 2);
  await renderHtml(finder(), path.join(OUT, 'finder-128.png'), 1312, 348, 1);
  await renderHtml(taskbar(), path.join(OUT, 'windows-taskbar.png'), 640, 400, 1);
  execFileSync('convert', [path.join(OUT, 'windows-taskbar.png'), '-filter', 'point', '-resize', '200%', path.join(OUT, 'windows-taskbar-zoom2x.png')]);
  await renderHtml(overview(), path.join(OUT, 'sizes-overview.png'), 1240, 400, 1);
  const zi = [['mac', 16, 'icns 16'], ['win', 20, 'ico 20'], ['win', 24, 'ico 24'], ['win', 30, 'ico 30'], ['mac', 32, 'icns 32'],
    ['win', 32, 'ico 32'], ['win', 36, 'ico 36'], ['win', 40, 'ico 40'], ['win', 48, 'ico 48'], ['mac', 64, 'icns 64']]
    .map(([fam, n, label]) => ({ file: path.join(__dirname, fam, `${n}.png`), size: n, label }));
  await zoomSheet(zi, path.join(OUT, 'small-sizes-zoom.png'), { cell: 160, title: 'Hand-tuned small sizes: nearest-neighbour zoom and 1x, on #1E1F22 and #ECEBE7' });
  await close();
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
