// Director Studio app icon, concept "Marker" (final). Pure geometry -> SVG string, no dependencies.
//
// All design coordinates are on Apple's 1024 grid ("G units"): body 824 x 824 at (100, 100), r 185.
// Every output maps that grid into its own body box (the macOS grid, or a fuller Windows/Linux tile)
// and, from 256 px down, snaps each edge to the target pixel grid, so 1-px lines stay 1 px.
// The smallest sizes can override any element with hand-placed pixels (opts.px).

// Colours. Flat fills are Grading Suite tokens (apps/desktop/DESIGN.md 3.1, dark theme), used verbatim.
// The only non-token values are the master's shading of the Daylight tag (refTop, refBot, lip): light and shade
// derived from --ref so the tag reads as a plate. Hand-tuned small sizes (no shading) use plain --ref.
const C = {
  wellTop: '#222224',   // --hover: the well, lit from above ...
  wellBot: '#0B0B0C',   // ... down to --sunken
  rule: '#8C8881',      // --text-3: the timeline rule (secondary to tag and playhead)
  ref: '#9DBDD8',       // --ref, Daylight: what you point at
  refTop: '#ABC9E1',    // derived: tag face, lit from above (--ref + light)
  refBot: '#93B4D0',    // derived: tag face, lower edge (--ref - light)
  lip: '#5F7F9C',       // derived: tag edge (--ref in shade), gives the plate its thickness
  onRef: '#0B1620',     // --on-ref
  accent: '#F0A458',    // --accent, Tungsten: live / now
};

// IBM Plex Mono SemiBold "1" (UPM 1000, y up): the glyph the UI uses for marker numbers.
const ONE = 'M91 0V107H283V603H274L122 423L40 492L213 698H414V107H572V0Z';
const ONE_B = [40, 0, 572, 698];

// Continuous-curvature rounded square (iOS/macOS style corner), radius r.
const K = [1.52866483, 1.08849323, 0.86840689, 0.63149399, 0.074911, 0.37282392, 0.16905899];
function squircle(x0, y0, w, h, r) {
  const [a, b, c, d, e, f, g] = K, x1 = x0 + w, y1 = y0 + h;
  const P = {
    TR: (X, Y) => [x1 - X * r, y0 + Y * r], BR: (X, Y) => [x1 - X * r, y1 - Y * r],
    BL: (X, Y) => [x0 + X * r, y1 - Y * r], TL: (X, Y) => [x0 + X * r, y0 + Y * r],
  };
  const n = (v) => +v.toFixed(3);
  let s = '';
  [['TR', 1], ['BR', 0], ['BL', 1], ['TL', 0]].forEach(([k, onX], i) => {
    const p = P[k];
    const pts = onX
      ? [p(a, 0), p(b, 0), p(c, 0), p(d, e), p(f, g), p(g, f), p(e, d), p(0, c), p(0, b), p(0, a)]
      : [p(0, a), p(0, b), p(0, c), p(e, d), p(g, f), p(f, g), p(d, e), p(c, 0), p(b, 0), p(a, 0)];
    s += (i ? ' L ' : 'M ') + pts[0].map(n).join(' ');
    for (let j = 1; j < 10; j += 3) s += ' C ' + pts.slice(j, j + 3).map((q) => q.map(n).join(' ')).join(' ');
  });
  return s + ' Z';
}

// The design, in G units.
const DESIGN = {
  rule: { y: 600, h: 22 },                                   // full-bleed horizon (the timeline rule)
  tag: { cx: 412, y: 228, w: 380, h: 292, r: 64, lip: 16 }, // marker tag, Daylight, with thickness
  num: { h: 186 },                                           // Plex Mono "1", cap height
  post: { w: 22 },                                           // solid post from tag to rule
  drop: { w: 18, dash: 40, gap: 32, start: 36, op: 0.5, bleed: true }, // dashed drop line, down through the timeline
  ph: { x: 728, w: 28, y0: 240, bleed: true },               // playhead line, Tungsten, down through the timeline
  cap: { w: 148, h: 190, tip: 56, top: 228 },                // playhead shield cap (as in the UI), top-aligned with the tag
  floor: [0.05, 0.012],                                      // white veil below the rule: stage floor
  rim: [0.17, 0.035, 0.07],                                  // top-lit bezel: top, middle, bottom
};

// Plex-like pixel "1": stem width sw, total height h, centred on (cx, cy). Returns [x, y, w, h] rects.
function pixelOne(cx, cy, h, sw, opt = {}) {
  const flag = opt.flag ?? (sw === 1 ? (h >= 7 ? 2 : 1) : h >= 10 ? 3 : 2);
  const footW = opt.footW ?? (sw === 1 ? (h >= 7 ? 5 : 3) : h >= 11 ? 8 : 6);
  const footH = opt.footH ?? (h >= 11 ? 2 : 1);
  const bboxL = Math.min(-flag, -(footW - sw) / 2), bboxR = sw + (footW - sw) / 2;
  const sl = Math.round(cx - (bboxL + bboxR) / 2);           // stem left
  const top = Math.round(cy - h / 2);
  const r = [[sl, top, sw, h]];
  for (let k = 1; k <= flag; k++) r.push([sl - k, top + k, 1, sw === 1 ? 1 : 2]);
  r.push([sl - (footW - sw) / 2, top + h - footH, footW, footH]);
  return r;
}

/**
 * opts: { N: canvas px, body: body px, off: body offset px, shadow: bool (outer drop shadow, macOS),
 *         snap?: bool, detail?: 'full'|'small', rimPx?: number, rim?: [t,m,b], px?: {...} hand overrides }
 */
function geometry(opts, D = DESIGN) {
  const { N, body, off } = opts;
  const s = body / 824;
  const X = (g) => off + (g - 100) * s;                       // G -> px (same for x and y)
  const snap = opts.snap ?? N <= 256;
  const R = (v) => (snap ? Math.round(v) : v);
  const W = (g, min = 1) => (snap ? Math.max(min, Math.round(g * s)) : g * s);
  const span = (a, b, min = 1) => {
    let p = R(X(a)), q = R(X(b));
    if (q - p < min) { const c = (X(a) + X(b)) / 2; p = Math.round(c - min / 2); q = p + min; }
    return [p, q];
  };
  const centredOn = (cpx, w) => { const l = snap ? Math.round(cpx - w / 2) : cpx - w / 2; return [l, l + w]; };

  const G = { N, off, body, s, snap };
  G.detail = opts.detail ?? (body >= 96 ? 'full' : 'small');
  G.bodyR = 185 * s;
  const [ry0, ry1] = span(D.rule.y, D.rule.y + D.rule.h);
  G.rule = [off - 2, ry0, off + body + 2, ry1];
  const small = snap && (opts.detail ?? (body >= 96 ? 'full' : 'small')) === 'small';
  G.numH = D.num.h * s;
  const sw = snap && G.numH < (opts.glyphMin ?? 14) ? (G.numH >= 8.5 ? 2 : 1) : 0;   // pixel numeral stem width (0 = glyph)
  let postW = W(D.post.w);
  if (sw && (postW - sw) % 2) postW = sw;                    // post and numeral stem share one axis
  let [tx0, tx1] = span(D.tag.cx - D.tag.w / 2, D.tag.cx + D.tag.w / 2);
  if (snap && (tx1 - tx0 - postW) % 2) tx1 += 1;             // tag width parity = post parity: centred post
  if (opts.tagX) [tx0, tx1] = opts.tagX;                     // hand-set tag columns (keeps a gap to the cap)
  const [ty0, ty1] = span(D.tag.y, D.tag.y + D.tag.h);
  G.tag = [tx0, ty0, tx1, ty1];
  G.tagR = snap ? Math.max(0.75, D.tag.r * s) : D.tag.r * s;
  G.lip = snap ? (D.tag.lip * s >= 1.25 ? Math.round(D.tag.lip * s) : small && body >= 40 ? 1 : 0) : D.tag.lip * s;
  const tagCx = (tx0 + tx1) / 2;
  const [p0, p1] = centredOn(tagCx, postW);
  G.post = [p0, ty1 + G.lip - 1, p1, ry0 + 1];
  G.drop = [];
  {
    const dw = snap ? postW : W(D.drop.w);
    const [d0, d1] = centredOn(tagCx, dw);
    if (snap) {
      const dash = Math.max(1, Math.round(D.drop.dash * s)), gap = Math.max(1, Math.round(D.drop.gap * s));
      let y = ry1 + Math.max(1, Math.round(D.drop.start * s));
      const lim = D.drop.bleed ? off + body - (small ? 1 : 0) : Infinity;   // small: stop 1 px inside the edge
      for (let i = 0; D.drop.bleed ? y + dash <= lim : i < D.drop.n; i++) { G.drop.push([d0, y, d1, y + dash]); y += dash + gap; }
    } else {
      let y = D.rule.y + D.rule.h + D.drop.start;
      for (let i = 0; D.drop.bleed ? y < 924 : i < D.drop.n; i++) { G.drop.push([d0, X(y), d1, X(y + D.drop.dash)]); y += D.drop.dash + D.drop.gap; }
    }
  }
  G.dropOp = D.drop.op;
  let [hx0, hx1] = centredOn(X(D.ph.x), W(D.ph.w));
  if (opts.phX != null) { hx1 = opts.phX + (hx1 - hx0); hx0 = opts.phX; }   // hand-set playhead column
  let [hy0, hy1] = span(D.ph.y0, D.ph.y1);
  if (D.ph.bleed) hy1 = small ? off + body - 1 : off + body + 2;  // runs off the bottom; small: 1 px inside
  G.ph = [hx0, hy0, hx1, hy1];
  {
    let cw = W(D.cap.w, 3);
    if (snap && (cw - (hx1 - hx0)) % 2) cw += 1;             // keep the cap centred on the line
    const cx = (hx0 + hx1) / 2, top = R(X(D.cap.top));
    G.cap = { cx, x0: cx - cw / 2, x1: cx + cw / 2, top, h: W(D.cap.h, 2), tip: snap ? Math.round(D.cap.tip * s) : D.cap.tip * s };
    if (small && cw <= 7) {                                 // pixel-stepped point instead of AA diagonals
      const lw = hx1 - hx0, steps = (cw - lw) / 2, rows = [];
      const fullRows = Math.max(1, G.cap.h - steps + 1);
      for (let i = 0; i < fullRows; i++) rows.push([G.cap.x0, top + i, cw, 1]);
      for (let k = 1; k < steps; k++) rows.push([G.cap.x0 + k, top + fullRows - 1 + k, cw - 2 * k, 1]);
      G.capPx = rows;
    }
  }
  G.num = sw ? pixelOne(tagCx, (ty0 + ty1) / 2, Math.round(G.numH), sw) : null;  // else the Plex glyph
  G.rimPx = opts.rimPx ?? Math.max(1, N / 512);
  G.rim = opts.rim ?? D.rim;
  G.floor = D.floor;
  G.shadow = !!opts.shadow;
  if (opts.px) Object.assign(G, typeof opts.px === 'function' ? opts.px(G) : opts.px);
  return G;
}

// The playhead as one outline: flat-topped shield cap (small rounded top corners in the master) whose pointed bottom
// runs straight into the line, which continues down off the tile. Returns null when the cap is hand-placed pixels.
function playheadPath(G, full) {
  if (G.capPx) return null;
  const f = (v) => +(+v).toFixed(3);
  const c = G.cap, l = c.x0, r = c.x1, top = c.top, sh2 = top + c.h - c.tip, bot = top + c.h;
  const [lx0, , lx1, ly1] = G.ph;
  const q = full ? Math.min(16 * G.s, (r - l) * 0.14) : 0;
  const yR = sh2 + ((r - lx1) / (r - c.cx)) * (bot - sh2);   // where the cap's diagonals meet the line's edges
  const yL = sh2 + ((lx0 - l) / (c.cx - l)) * (bot - sh2);
  const topEdge = q
    ? `M ${f(l + q)} ${f(top)} H ${f(r - q)} Q ${f(r)} ${f(top)} ${f(r)} ${f(top + q)}`
    : `M ${f(l)} ${f(top)} H ${f(r)}`;
  const close = q ? `V ${f(top + q)} Q ${f(l)} ${f(top)} ${f(l + q)} ${f(top)} Z` : 'Z';
  return `${topEdge} V ${f(sh2)} L ${f(lx1)} ${f(yR)} V ${f(ly1)} H ${f(lx0)} V ${f(yL)} L ${f(l)} ${f(sh2)} ${close}`;
}

function svg(G) {
  const { N, off, body, s } = G;
  const f = (v) => +(+v).toFixed(3);
  const rect = (r, attrs) => `<rect x="${f(r[0])}" y="${f(r[1])}" width="${f(r[2] - r[0])}" height="${f(r[3] - r[1])}" ${attrs}/>`;
  const BODY = squircle(off, off, body, body, G.bodyR);
  const full = G.detail === 'full';
  const [tx0, ty0, tx1, ty1] = G.tag;
  const tagCx = (tx0 + tx1) / 2;
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" viewBox="0 0 ${N} ${N}">`);
  o.push('<title>Director Studio</title>');
  o.push('<defs>');
  o.push(`<clipPath id="body"><path d="${BODY}"/></clipPath>`);
  o.push(`<linearGradient id="well" x1="0" y1="${f(off)}" x2="0" y2="${f(off + body)}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${C.wellTop}"/><stop offset="1" stop-color="${C.wellBot}"/></linearGradient>`);
  o.push(`<linearGradient id="rim" x1="0" y1="${f(off)}" x2="0" y2="${f(off + body)}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="${G.rim[0]}"/><stop offset=".5" stop-color="#fff" stop-opacity="${G.rim[1]}"/>` +
    `<stop offset="1" stop-color="#fff" stop-opacity="${G.rim[2]}"/></linearGradient>`);
  if (G.floor) {
    o.push(`<linearGradient id="floor" x1="0" y1="${f(G.rule[3])}" x2="0" y2="${f(off + body)}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="#fff" stop-opacity="${G.floor[0]}"/><stop offset="1" stop-color="#fff" stop-opacity="${G.floor[1]}"/></linearGradient>`);
  }
  if (full) {
    o.push(`<linearGradient id="face" x1="0" y1="${f(ty0)}" x2="0" y2="${f(ty1)}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="${C.refTop}"/><stop offset="1" stop-color="${C.refBot}"/></linearGradient>`);
    o.push(`<linearGradient id="hi" x1="0" y1="${f(ty0)}" x2="0" y2="${f(ty1)}" gradientUnits="userSpaceOnUse">` +
      '<stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/></linearGradient>');
    o.push(`<linearGradient id="caphi" x1="0" y1="${f(G.cap.top)}" x2="0" y2="${f(G.cap.top + G.cap.h)}" gradientUnits="userSpaceOnUse">` +
      '<stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/></linearGradient>');
    // Shadow-only filters (no source graphic in the output). Each object's shadow is drawn in its own pass *below*
    // the fills, so no object darkens itself (cap onto its line, tag onto its post) and the playhead's shadow does
    // not smudge the rule it crosses. Filter region = whole canvas, so no shadow is cut off at a bounding box.
    const sh = (id, dy, sd, op) => `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${N}" height="${N}" color-interpolation-filters="sRGB">` +
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${f(sd * s)}"/><feOffset dy="${f(dy * s)}" result="b"/>` +
      `<feFlood flood-color="#000" flood-opacity="${op}"/><feComposite in2="b" operator="in"/></filter>`;
    o.push(sh('sTag', 22, 26, 0.6), sh('sPh', 10, 12, 0.5), sh('sRule', 6, 6, 0.55));
    o.push(`<clipPath id="tagc"><rect x="${f(tx0)}" y="${f(ty0)}" width="${f(tx1 - tx0)}" height="${f(ty1 - ty0)}" rx="${f(G.tagR)}"/></clipPath>`);
  }
  if (G.shadow) {
    o.push('<filter id="sOuter" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB">' +
      `<feGaussianBlur stdDeviation="${f(12 * s)}"/><feOffset dy="${f(10 * s)}"/>` +
      '<feComponentTransfer><feFuncA type="linear" slope=".3"/></feComponentTransfer></filter>');
  }
  o.push('</defs>');

  if (G.shadow) o.push(`<path d="${BODY}" fill="#000" filter="url(#sOuter)"/>`);
  o.push(`<path d="${BODY}" fill="url(#well)"/>`);
  o.push('<g clip-path="url(#body)">');
  // stage floor below the horizon
  if (G.floor) o.push(rect([0, G.rule[3], N, N], 'fill="url(#floor)"'));
  // marker drop line (dashed, 50 %, as in the marker strip)
  for (const d of G.drop) o.push(rect(d, `fill="${C.ref}" fill-opacity="${G.dropOp}"`));
  const tagRect = (dy, attrs) => `<rect x="${f(tx0)}" y="${f(ty0 + dy)}" width="${f(tx1 - tx0)}" height="${f(ty1 - ty0)}" rx="${f(G.tagR)}" ${attrs}/>`;
  // The playhead is one object: shield cap and line as a single outline (master and large sizes).
  const capD = playheadPath(G, full);
  if (full) {
    // shadow pass: marker (tag + post) and playhead (cap + line), each as one silhouette, under everything else
    o.push(`<g filter="url(#sTag)">${tagRect(0, '')}${G.lip ? tagRect(G.lip, '') : ''}${rect(G.post, '')}</g>`);
    o.push(`<path d="${capD}" filter="url(#sPh)"/>`);
    o.push(rect(G.rule, 'filter="url(#sRule)"'));
  }
  // timeline rule, full bleed
  o.push(rect(G.rule, `fill="${C.rule}"`));
  // playhead line (Tungsten), in front of the rule; small sizes draw it as a crisp rect plus a pixel cap
  if (!capD) o.push(rect(G.ph, `fill="${C.accent}"`));
  // marker post
  o.push(rect(G.post, `fill="${C.ref}"`));
  // marker tag: edge (thickness) + face + top light
  if (G.lip) o.push(tagRect(G.lip, `fill="${C.lip}"`));
  o.push(tagRect(0, `fill="${full ? 'url(#face)' : C.ref}"`));
  if (full) o.push(tagRect(0, `fill="none" stroke="url(#hi)" stroke-width="${f(Math.max(1, 5 * s) * 2)}" clip-path="url(#tagc)"`));
  // the numeral
  if (G.num) {
    for (const [x, y, w, h] of G.num) o.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.onRef}"/>`);
  } else if (G.numH) {
    const [bx0, by0, bx1, by1] = ONE_B;
    const k = G.numH / (by1 - by0);
    const gx = tagCx - ((bx0 + bx1) / 2) * k, gy = (ty0 + ty1) / 2 + ((by1 - by0) / 2) * k;
    o.push(`<path d="${ONE}" fill="${C.onRef}" transform="translate(${f(gx)} ${f(gy)}) scale(${f(k)} ${f(-k)})"/>`);
  }
  // playhead: flat-topped shield cap with a pointed bottom (as in the UI) running into the line, one fill
  if (G.capPx) {
    for (const [x, y, w, h] of G.capPx) o.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.accent}"/>`);
  } else {
    o.push(`<path d="${capD}" fill="${C.accent}"/>`);
    if (full) {
      o.push(`<clipPath id="capc"><path d="${capD}"/></clipPath>`);
      o.push(`<path d="${capD}" fill="none" stroke="url(#caphi)" stroke-width="${f(Math.max(1, 5 * s) * 2)}" clip-path="url(#capc)"/>`);
    }
  }
  o.push('</g>');
  // bezel: top-lit inner rim
  if (G.rimPx) o.push(`<path d="${BODY}" fill="none" stroke="url(#rim)" stroke-width="${f(G.rimPx * 2)}" clip-path="url(#body)"/>`);
  o.push('</svg>');
  return o.join('\n');
}

const build = (opts, D) => svg(geometry(opts, D));
module.exports = { build, geometry, svg, pixelOne, DESIGN, C, squircle };
