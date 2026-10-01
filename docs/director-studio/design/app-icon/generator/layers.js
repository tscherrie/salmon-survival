// Icon Composer layers (macOS 26+ Liquid Glass) and a draft `.icon` package.
// Icon Composer's canvas is the icon body itself: 1024 x 1024, full bleed; the system applies the rounded-rect mask,
// glass, specular edge and shadow. So every element is mapped from the 824-px macOS body (G units, origin 100) onto
// the full 1024 canvas, drawn flat (no lip, no baked shadow, no highlight), one solid sRGB colour per layer.
// No two layers overlap (the numeral is knocked out of the tag, the rule is split where the playhead crosses it),
// so the composite is the same whatever stacking order or glass settings Icon Composer applies.
const fs = require('fs');
const path = require('path');
const { DESIGN: D, C } = require('./icon');

const FINAL = path.resolve(__dirname, '..');
const LAYERS = path.join(FINAL, 'layers');
const PKG = path.join(FINAL, 'icon.icon');
const ASSETS = path.join(PKG, 'Assets');
for (const d of [LAYERS, ASSETS]) fs.mkdirSync(d, { recursive: true });

const S = 1024 / 824;
const c = (g) => (g - 100) * S;                     // G units -> Icon Composer canvas
const n = (v) => +v.toFixed(2);
const rectPath = (x0, y0, x1, y1) => `M${n(x0)} ${n(y0)}H${n(x1)}V${n(y1)}H${n(x0)}Z`;   // clockwise (y down)
function roundRectPath(x0, y0, x1, y1, r) {                                                   // clockwise
  return `M${n(x0 + r)} ${n(y0)}H${n(x1 - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(y0 + r)}V${n(y1 - r)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(x1 - r)} ${n(y1)}H${n(x0 + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x0)} ${n(y1 - r)}` +
    `V${n(y0 + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x0 + r)} ${n(y0)}Z`;
}

// IBM Plex Mono SemiBold "1" (UPM 1000, y up), as in icon.js, flattened to a polygon in canvas units.
const ONE = 'M91 0V107H283V603H274L122 423L40 492L213 698H414V107H572V0Z';
function onePolygon(cxG, cyG, hG) {
  const k = hG / 698, gx = cxG - 306 * k, gy = cyG + 349 * k;
  const pts = [];
  let x = 0, y = 0;
  for (const [, cmd, args] of ONE.matchAll(/([MVHLZ])([^MVHLZ]*)/g)) {
    const v = args.trim().split(/[ ,]+/).filter(Boolean).map(Number);
    if (cmd === 'M' || cmd === 'L') { [x, y] = v; pts.push([x, y]); }
    if (cmd === 'H') { x = v[0]; pts.push([x, y]); }
    if (cmd === 'V') { y = v[0]; pts.push([x, y]); }
  }
  let poly = pts.map(([px, py]) => [c(gx + px * k), c(gy - py * k)]);
  const area = poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
  if (area > 0) poly = poly.reverse();               // counter-clockwise on screen: a hole under nonzero
  return 'M' + poly.map(([px, py]) => `${n(px)} ${n(py)}`).join('L') + 'Z';
}

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n${body}\n</svg>\n`;

// --- geometry (G units from DESIGN) ---------------------------------------------------------------------------
const tag = { x0: D.tag.cx - D.tag.w / 2, y0: D.tag.y, x1: D.tag.cx + D.tag.w / 2, y1: D.tag.y + D.tag.h };
const ruleY0 = D.rule.y, ruleY1 = D.rule.y + D.rule.h;
const phX0 = D.ph.x - D.ph.w / 2, phX1 = D.ph.x + D.ph.w / 2;
const cap = { l: D.ph.x - D.cap.w / 2, r: D.ph.x + D.cap.w / 2, top: D.cap.top, h: D.cap.h, tip: D.cap.tip };

// Marker: tag with the numeral knocked out, plus the post down to the rule (one Daylight shape).
const markerD = [
  roundRectPath(c(tag.x0), c(tag.y0), c(tag.x1), c(tag.y1), D.tag.r * S),
  onePolygon(D.tag.cx, (tag.y0 + tag.y1) / 2, D.num.h),
  rectPath(c(D.tag.cx - D.post.w / 2), c(tag.y1 - 8), c(D.tag.cx + D.post.w / 2), c(ruleY0)),
].join('');
// Drop line: the dashes below the rule (shown at 50 % via the layer's opacity, as in the marker strip).
const dashes = [];
for (let y = ruleY1 + D.drop.start; y < 924; y += D.drop.dash + D.drop.gap) {
  dashes.push(rectPath(c(D.tag.cx - D.drop.w / 2), c(y), c(D.tag.cx + D.drop.w / 2), c(Math.min(y + D.drop.dash, 924))));
}
// Playhead: one outline, the shield cap (flat top with small rounded corners) whose pointed bottom runs straight
// into the line, which bleeds off the bottom. Same construction as the legacy icon (icon.js playheadPath).
const q = 16 * S, L = c(cap.l), R = c(cap.r), T = c(cap.top), SH = c(cap.top + cap.h - cap.tip), B = c(cap.top + cap.h), CX = c(D.ph.x);
const LX0 = c(phX0), LX1 = c(phX1);
const yR = SH + ((R - LX1) / (R - CX)) * (B - SH), yL = SH + ((LX0 - L) / (CX - L)) * (B - SH);
const playheadD =
  `M${n(L + q)} ${n(T)}H${n(R - q)}Q${n(R)} ${n(T)} ${n(R)} ${n(T + q)}V${n(SH)}L${n(LX1)} ${n(yR)}V1040H${n(LX0)}V${n(yL)}` +
  `L${n(L)} ${n(SH)}V${n(T + q)}Q${n(L)} ${n(T)} ${n(L + q)} ${n(T)}Z`;
// Timeline rule: full bleed, split where the playhead crosses it.
const ruleD = rectPath(-16, c(ruleY0), c(phX0), c(ruleY1)) + rectPath(c(phX1), c(ruleY0), 1040, c(ruleY1));

const layers = [
  // file, name, colour, group
  ['playhead.svg', 'Playhead', C.accent, playheadD],
  ['marker.svg', 'Marker', C.ref, markerD],
  ['drop-line.svg', 'Drop line', C.ref, dashes.join('')],
  ['rule.svg', 'Timeline rule', C.rule, ruleD],
];
for (const [file, name, color, d] of layers) {
  const s = svg(`<title>Director Studio · ${name}</title>\n<path d="${d}" fill="${color}" fill-rule="nonzero"/>`);
  fs.writeFileSync(path.join(LAYERS, file), s);
  fs.writeFileSync(path.join(ASSETS, file), s);
}
// The well, as a layer too (for tools other than Icon Composer; the .icon uses its own background fill instead).
fs.writeFileSync(path.join(LAYERS, 'background.svg'), svg(
  `<title>Director Studio · Background (well)</title>\n<defs><linearGradient id="well" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse">` +
  `<stop offset="0" stop-color="${C.wellTop}"/><stop offset="1" stop-color="${C.wellBot}"/></linearGradient></defs>\n<rect width="1024" height="1024" fill="url(#well)"/>`));

// --- icon.json (draft; schema is Apple-internal, written after files Icon Composer itself saves) ---------------
const srgb = (hex) => 'srgb:' + [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(',') + ',1.00000';
const well = { 'automatic-gradient': srgb('#18181A') };
const group = (name, layerList, extra = {}) => ({
  layers: layerList,
  name,
  shadow: { kind: 'neutral', opacity: 0.5 },
  specular: true,
  translucency: { enabled: true, value: 0.3 },
  ...extra,
});
const icon = {
  'color-space-for-untagged-svg-colors': 'srgb',
  'fill-specializations': [{ value: well }, { appearance: 'dark', value: well }],
  groups: [
    group('Playhead', [{ 'image-name': 'playhead.svg', name: 'Playhead' }]),
    group('Marker', [
      { 'image-name': 'marker.svg', name: 'Marker' },
      { 'image-name': 'drop-line.svg', name: 'Drop line', opacity: 0.5, glass: false },
    ]),
    group('Timeline', [{ 'image-name': 'rule.svg', name: 'Timeline rule' }], { shadow: { kind: 'neutral', opacity: 0.3 } }),
  ],
  'supported-platforms': { squares: 'shared' },
};
fs.writeFileSync(path.join(PKG, 'icon.json'), JSON.stringify(icon, null, 2) + '\n');
console.log('layers ok');
module.exports = { layers };
