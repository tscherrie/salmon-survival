// Output size table: macOS grid (iconset/icns) and the fuller Windows/Linux tile (ico, linux PNGs).
const { pixelOne } = require('./icon');

// body px per canvas px. macOS keeps Apple's 824/1024 ratio (pixel-aligned); Windows/Linux fill ~7/8.
// The 13-px macOS 16 body cannot be centred on whole pixels; it sits at 1..13 (OFF) so every edge stays crisp.
const MAC = { 16: 13, 32: 26, 64: 52, 128: 104, 256: 206, 512: 412, 1024: 824 };
const OFF = { mac16: 1 };
const WIN = { 16: 14, 20: 18, 24: 22, 30: 26, 32: 28, 36: 32, 40: 36, 48: 42, 64: 56, 128: 112, 256: 224, 512: 448 };

// Hand-placed pixels for the smallest tiles, keyed by `${body}`. Coordinates are canvas px.
const HAND = require('./hand');

function opts(family, N) {
  const body = (family === 'mac' ? MAC : WIN)[N];
  const off = OFF[`${family}${N}`] ?? (N - body) / 2;
  const o = { N, body, off, shadow: family === 'mac' && N >= 128 };
  if (body < 96) {
    o.rim = [0.16, 0.07, 0.1];                       // small sizes: a clearer 1-px rim on dark backgrounds
    o.rimPx = 1;
  }
  // Hand-set columns, relative to the body's left edge, where plain rounding would let the tag touch the playhead
  // cap or leave the group off-centre. Each keeps a 2-px gap between tag and cap and equal left/right margins.
  const cols = {
    win24: { tagX: [2, 13], phX: 17 },   // margins 2/2, tag 11, gap 2, cap 5 (line at 17)
    win30: { tagX: [4, 15] },            // margins 4/4, tag 11, gap 2, cap 5
    mac32: { tagX: [4, 15] },            // margins 4/4, tag 11, gap 2, cap 5
    win36: { tagX: [4, 19] },            // margins 4/4, tag 15, gap 2, cap 7
  }[`${family}${N}`];
  if (cols) {
    if (cols.tagX) o.tagX = cols.tagX.map((v) => v + off);
    if (cols.phX != null) o.phX = cols.phX + off;
  }
  const h = HAND[`${family}${N}`] || HAND[`b${body}`];
  if (h) o.px = h;
  return o;
}

module.exports = { MAC, WIN, opts };
