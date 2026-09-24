// The river, from the spring where the salmon hatch to the open sea.
//
// One scene unit is ten centimetres. The river runs along a centreline measured by s (units
// downstream from the spring) and across it by u (signed distance from the centreline,
// positive to the left looking downstream). Everything about it -- how wide and deep it
// is, how steep, how fast, where it falls over a ledge, where it opens into the sea -- is a
// function of s, so it is the same river every time and can be asked about anywhere.
//
// It changes the way a real Nordic salmon river changes on its way down:
//
//   the spring and the redd     the source itself: water welling up through the gravel and
//                               spilling out of a cleft in the rock into a quiet spring pool
//                               with the gravel where the eggs lie -- slow, clear water full
//                               of drift, where a new fish finds its fins
//   the chute                   a narrow bedrock gully just below it, far too fast for
//                               anything but a grown salmon
//   the mountain brook          steep, shallow and fast, riffle after pool, boulders,
//                               a cascade of little steps and one small fall -- and
//                               between them quiet widenings where the fry grow up
//   the upper river             wider and deeper, a rock gorge, rapids, a still reach and
//                               the big salmon fall
//   the middle river            broad, a narrows and rapids, the still water of a weir
//                               pond and the stepped weir with its pool pass
//   the lower river             wide, deep and brown with peat water, but not dull: a
//                               rock narrows, rapids either side of a ledge fall, bends
//   the estuary                 opening out, brackish, silt and eelgrass
//   the sea                     a fjord mouth and open water, bounded only by the haze
//
// The water surface drops along the way (steeply over riffles, hardly at all in pools) and
// by whole steps at the falls; it reaches sea level at the coast.

// Bumped whenever the river is laid out anew, so saved places can be carried over.
export const COURSE_VERSION = 5;
export const STEP = 1;
let seasonFlow = 1;
const TAU = Math.PI * 2;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Places along the river.
export const S = {
  redd: 24,
  gate: [80, 106],
  straight: 15000,
  coast: 16000,
  // How far the open water reaches: out from the coast, and along it either way.
  seaReach: 3800,
  seaSide: 3000,
};

// The river as it was first laid out, and as it runs now: the long, even lower river was
// halved, and the length went into the upper river -- a new stretch below the salmon fall
// (a rapid, a still side arm, a step, a rock gorge). `relaid` takes a place on the old river
// to the same place on the new one (for the tables below, and for fish saved on the old).
const NEW_FROM = 6000,
  NEW_LENGTH = 1400,
  LOW_FROM = 12000,
  LOW_TO = 14800;
export function relaid(s) {
  if (s < NEW_FROM) return s;
  if (s < LOW_FROM) return s + NEW_LENGTH;
  if (s < LOW_TO) return LOW_FROM + NEW_LENGTH + ((s - LOW_FROM) * (LOW_TO - LOW_FROM - NEW_LENGTH)) / (LOW_TO - LOW_FROM);
  return s;
}

// The river's character at stations along it, eased between. Width at the surface, depth
// over the deepest line, mean current, water-surface gradient, how much of the sky the
// trees along the banks take, the cross-section's shape (higher is flatter-bottomed), how
// steeply the banks climb out, and how rough the bed is.
//            s      width depth speed  gradient canopy shape  bank  rough
const STATIONS = [
  [-200,         8,   3,   0.5,  0.02,   0.8,   1.8,  1.4,  0.9],
  [0,           10,   4,   0.5,  0.003,  0.8,   1.8,  1.4,  0.9],
  [24,          12,   5.5, 0.6,  0.003,  0.8,   1.9,  1.3,  0.8],
  [52,          11,   5,   1.1,  0.006,  0.78,  1.9,  1.3,  0.8],
  [66,          11,   5,   3.4,  0.014,  0.78,  1.9,  1.3,  0.8],
  [78,         9.5,   4.2, 11,   0.1,    0.75,  4.0,  2.2,  0.25],
  [104,        9.5,   4.2, 11,   0.1,    0.75,  4.0,  2.2,  0.25],
  [124,         14,   6,   3.2,  0.03,   0.75,  1.9,  1.2,  1.0],
  [700,         20,   7.5, 3.5,  0.03,   0.65,  1.9,  1.1,  1.0],
  [2400,        38,  11,   3.6,  0.025,  0.45,  2.0,  0.9,  1.0],
  [2800,        70,  16,   3.2,  0.012,  0.3,   2.2,  0.7,  0.9],
  [7200,       120,  22,   2.9,  0.008,  0.2,   2.4,  0.55, 0.8],
  [7800,       150,  26,   2.5,  0.003,  0.12,  2.6,  0.45, 0.6],
  [12000,      200,  32,   2.1,  0.002,  0.05,  2.8,  0.35, 0.5],
  [12600,      240,  36,   1.7,  0.0006, 0.02,  3.0,  0.3,  0.35],
  [14800,      300,  34,   1.3,  0.0002, 0,     3.2,  0.25, 0.3],
  [15200,      340,  26,   0.9,  0,      0,     3.2,  0.2,  0.3],
  [16000,      900,  28,   0.35, 0,      0,     3.4,  0.12, 0.3],
].map((row) => [relaid(row[0]), ...row.slice(1)]);
const FIELDS = ["width", "depth", "speed", "gradient", "canopy", "shape", "bank", "rough"];

// Rapids: steep, shallow, fast white water.
export const RAPIDS = [
  { from: 1960, to: 2140, strength: 1 },
  { from: 3380, to: 3640, strength: 1 },
  { from: 6560, to: 6820, strength: 0.9 },
  { from: 8200, to: 8420, strength: 0.8 },
  { from: 10050, to: 10230, strength: 0.65 },
  { from: 10820, to: 10980, strength: 0.8 },
  { from: 12620, to: 12880, strength: 0.85 },
  { from: 13010, to: 13170, strength: 0.6 },
  { from: 14000, to: 14180, strength: 0.5 },
]
  .map((r) => ({ ...r, from: relaid(r.from), to: relaid(r.to) }))
  // The new stretch of the upper river.
  .concat([{ from: 6120, to: 6330, strength: 0.9 }])
  .sort((a, b) => a.from - b.from);

// Reaches with a character of their own, so the river never runs the same for long:
//   calm      a widening where the water spreads out, slows and all but stops -- a
//             backwater for a fry to grow up in, a weir pond, a still reach in the big
//             river; shallow at the edges, the surface nearly level, no riffles
//   narrows   the banks close in -- a rock gorge in the brook, a narrows in the big
//             river -- and the same water runs through deep, fast and straight
export const REACHES = [
  { from: 8, to: 50, kind: "calm", strength: 0.6, name: "Quelltopf" },
  { from: 140, to: 330, kind: "calm", strength: 0.9, name: "Brutbecken" },
  { from: 510, to: 630, kind: "calm", strength: 0.8 },
  { from: 1130, to: 1390, kind: "calm", strength: 1, name: "Moorstrecke" },
  { from: 1620, to: 1820, kind: "calm", strength: 0.9 },
  { from: 2240, to: 2420, kind: "calm", strength: 0.85 },
  { from: 2980, to: 3260, kind: "narrows", strength: 0.9, name: "Klamm" },
  { from: 4050, to: 4450, kind: "calm", strength: 0.9, name: "Stillwasser" },
  { from: 4700, to: 5060, kind: "narrows", strength: 0.7 },
  { from: 5560, to: 5920, kind: "calm", strength: 0.85 },
  { from: 6280, to: 6520, kind: "narrows", strength: 0.8 },
  { from: 7000, to: 7320, kind: "calm", strength: 0.8 },
  { from: 7880, to: 8180, kind: "narrows", strength: 0.85, name: "Stromenge" },
  { from: 8950, to: 9640, kind: "calm", strength: 0.85, name: "Wehrstau" },
  { from: 10560, to: 10800, kind: "narrows", strength: 0.75 },
  { from: 11200, to: 11600, kind: "calm", strength: 0.8 },
  { from: 12280, to: 12600, kind: "narrows", strength: 0.9, name: "Felsenge" },
  { from: 13380, to: 13820, kind: "calm", strength: 0.75 },
]
  .map((r) => ({ ...r, from: relaid(r.from), to: relaid(r.to) }))
  .concat([
    { from: 6560, to: 6900, kind: "calm", strength: 0.95, name: "Altarm" },
    { from: 7080, to: 7330, kind: "narrows", strength: 0.9, name: "Felsschlucht" },
  ])
  .sort((a, b) => a.from - b.from);
// Islands: here and there the river parts round a long island and joins again below it --
// one arm (on `side`) shallow and quick over gravel, the other deep, slow and dark.
export const ISLANDS = [
  { from: 2530, to: 2870, side: 1, name: "Erleninsel" },
  { from: 7400, to: 7800, side: -1, name: "Weideninsel" },
  { from: 11700, to: 12150, side: 1, name: "Kiesinsel" },
].map((r) => ({ ...r, from: relaid(r.from), to: relaid(r.to) }));
// How much s lies in an island's reach (0..1, a lens: nothing at its ends, fullest in the
// middle), and on which side its quick arm runs.
function islandAt(s, out) {
  out.island = 0;
  out.islandSide = 1;
  for (const q of ISLANDS) {
    if (s <= q.from || s >= q.to) continue;
    const t = (s - q.from) / (q.to - q.from);
    out.island = Math.pow(Math.sin(Math.PI * t), 0.7);
    out.islandSide = q.side;
  }
  return out;
}

// Side brooks: a small stream comes in from the side, a dead end a little way up, closed by
// a fall over a rock step. `s` is where it joins the river, `side` which bank (+1 left),
// `length` how far it runs into the land, `drift` how far upriver its head lies, `drop`
// the height of its fall. Laid where the river runs straight, so the land beside it does
// not fold.
export const TRIBUTARIES = [{ s: 1022, side: 1, length: 55, width: 6.5, depth: 2.2, drift: -12, drop: 5, name: "Erlenbach" }];
// Where (s, u) lies in a side brook: `t` along it (0 at the river's bank, 1 at its fall),
// `d` across it from its middle (in s), `w` its half-width there; null when outside.
export function tributaryAt(s, u, out = {}) {
  for (const b of TRIBUTARIES) {
    if (Math.abs(s - b.s) > Math.abs(b.drift) + b.width * 3 + 4) continue;
    b.bank ??= section(b.s).half;
    const t = (b.side * u - b.bank + 1.5) / b.length;
    if (t < -0.2 || t > 1.4) continue;
    const middle = b.s + b.drift * Math.min(1, Math.max(0, t)) + 2.2 * Math.sin(t * 5.2 + 0.7) * Math.min(1, Math.max(0, t));
    const w = b.width * (1 - 0.35 * Math.min(1, Math.max(0, t)));
    const d = s - middle;
    if (Math.abs(d) > w * 1.8) continue;
    out.b = b;
    out.t = t;
    out.d = d;
    out.w = w;
    return out;
  }
  return null;
}
const tribScratch = {};

// Undercut banks: here and there the current has hollowed out a bank, and the turf and
// roots hang over a dark pocket of deep water (the overhang itself is built in
// features.js). `side` is the bank (+1 left), `length` how long the hollow runs.
export const UNDERCUTS = [
  { s: 560, side: 1, length: 30, name: "Wurzelufer" },
  { s: 1300, side: -1, length: 36, name: "Moorufer" },
  { s: 1745, side: 1, length: 28, name: "Erlenufer" },
  { s: 2330, side: -1, length: 34, name: "Kolkufer" },
  { s: 4250, side: 1, length: 44, name: "Weidenufer" },
];
// How far (s, u) lies in an undercut's hollow: 0..1, and e (1 at the bank's old edge).
export function undercutAt(s, u, c = section(s)) {
  for (const q of UNDERCUTS) {
    const ds = Math.abs(s - q.s);
    if (ds > q.length / 2) continue;
    const e = (q.side * (u - c.thalweg)) / c.half;
    if (e < 0.6 || e > 1.35) continue;
    const along = 1 - smooth(q.length / 2 - 6, q.length / 2, ds);
    return { q, e, along };
  }
  return null;
}

// The old mill: its race leaves the river at `from`, runs along beside it behind a strip of
// land, past the mill and its wheel (at `wheel`), and comes back in at `to`. Quicker than
// the river; the wheel's paddles dip into it.
export const MILLS = [{ from: 4095, to: 4405, side: -1, offset: 18, width: 7, depth: 5, wheel: 4255, name: "Alte Mühle" }];
// Where (s, u) lies in a mill race: d across from its middle, w its half-width; null outside.
export function millAt(s, u, c = section(s)) {
  for (const m of MILLS) {
    if (s < m.from - 6 || s > m.to + 6) continue;
    const ramp = smooth(m.from, m.from + 34, s) * (1 - smooth(m.to - 34, m.to, s));
    const centre = c.thalweg + m.side * (c.half - 3 + (m.offset + 3) * ramp);
    const d = u - centre;
    if (Math.abs(d) > m.width * 1.7) continue;
    return { m, d, w: m.width, ramp };
  }
  return null;
}
// Cold springs: groundwater welling up through the gravel, a patch of cool water all
// summer. `u` as a share of the half-width.
export const COLD_SPRINGS = [{ s: relaid(8700), u: -0.55, radius: 16, name: "Kaltwasserquelle" }];
// How much the water at (s, u) is cooled by a cold spring, 0..1.
export function coolingAt(s, u) {
  for (const q of COLD_SPRINGS) {
    if (Math.abs(s - q.s) > q.radius * 2.5) continue;
    const c = section(q.s);
    const d = Math.hypot(s - q.s, u - (c.thalweg + q.u * c.half));
    return 1 - smooth(q.radius * 0.5, q.radius * 2.5, d);
  }
  return 0;
}
// The king's pool: one pool in the brook is deeper and darker than any, and the old king of
// the trout lives in it.
export const KING_POOL = { s: 750, name: "Königsgumpe" };

// The crack behind the salmon fall: at one edge of the fall, hidden behind its curtain, a
// narrow flooded cleft goes up through the rock from the pool to the river above -- a way
// up for a fish too small to leap it. `u` is its place across (a share of the half-width).
export const CRACKS = [{ fall: "Lachsfall", side: -1, u: 0.8, width: 1.9, length: 14, name: "Felsspalt" }];
function crackAt(s, u, c) {
  for (const k of CRACKS) {
    const f = FALLS.find((q) => q.name === k.fall);
    if (!f || s < f.s - k.length - 2 || s > f.s + 1.5) continue;
    const centre = c.thalweg + k.side * k.u * c.half;
    const across = Math.abs(u - centre) / k.width;
    if (across > 1.6) continue;
    return { k, f, across, along: smooth(f.s - k.length - 2, f.s - k.length + 1, s) };
  }
  return null;
}

// How much s lies in a calm reach and in narrows, 0..1 each, eased in and out over a few
// widths of the river.
function reachAt(s, width, out) {
  out.calm = 0;
  out.narrows = 0;
  for (const r of REACHES) {
    const ease = Math.min((r.to - r.from) * 0.3, Math.max(24, width * 1.2));
    if (s < r.from - ease || s > r.to + ease) continue;
    const k = smooth(r.from - ease, r.from + ease * 0.5, s) * (1 - smooth(r.to - ease * 0.5, r.to + ease, s)) * r.strength;
    out[r.kind] = Math.max(out[r.kind], k);
  }
  return out;
}

// Falls: where the water surface drops by a step. `lip` is how deep the water runs over the
// ledge, `pool` how deep the plunge pool is below it. `head` marks the spring's rock, which
// has no river above it. A salmon can leap a fall of about three body lengths.
export const FALLS = [
  { s: 6, drop: 3.5, lip: 0, pool: 6, head: true, name: "Quelle" },
  { s: 1480, drop: 5, lip: 3, pool: 11, name: "Bachstufe" },
  { s: 5200, drop: 19, lip: 3.2, pool: 26, name: "Lachsfall" },
  // In the new stretch below the salmon fall, a step over a ledge of rock.
  { s: 6470, drop: 5.5, lip: 3, pool: 12, name: "Steinstufe" },
  { s: relaid(9800), drop: 2.6, lip: 0.6, pool: 9, name: "Fischtreppe", pass: true },
  { s: relaid(9816), drop: 2.6, lip: 0.6, pool: 9, name: "Fischtreppe", pass: true },
  { s: relaid(9832), drop: 2.6, lip: 0.6, pool: 9, name: "Fischtreppe", pass: true },
  { s: relaid(9848), drop: 2.6, lip: 0.6, pool: 9, name: "Fischtreppe", pass: true },
  // In the lower river the water breaks once more over a bar of rock between two rapids.
  { s: relaid(12950), drop: 4.5, lip: 3.4, pool: 14, name: "Felsschwelle" },
];
// Below the chute the little brook comes down a few steps over stones and roots, each with a
// small basin under it.
{
  let s = 170,
    k = 0;
  while (s < 900) {
    const h = Math.sin(k * 12.9898 + 4.1) * 43758.5453;
    const r = h - Math.floor(h);
    FALLS.push({ s, drop: 1.1 + 1.3 * r, lip: 2.4, pool: 3.2 + 1.5 * r, name: "Kaskade", step: true });
    s += 110 + 70 * ((r * 7.3) % 1);
    k++;
  }
  FALLS.sort((a, b) => a.s - b.s);
}
for (const f of FALLS) {
  f.poolLength = f.pass ? 11 : f.step ? 5 + 2 * f.drop : 12 + 2.6 * f.drop;
  f.sill = f.pass ? 4 : f.step ? 4 : 16;
}

// Pools ("Gumpen"): here and there the river widens and deepens and all but stops -- below
// every fall, where the plunge has scoured a basin, and now and then on its own along the
// brook and the river, away from the falls and the rapids. Places to rest.
export const POOLS = [];
{
  // A pool is a few widths long; between pools the river runs -- so a pool stays a place,
  // not the whole river.
  let s = 190,
    k = 0;
  const field = {};
  while (s < relaid(14400)) {
    const h = Math.sin(k * 78.233 + 1.7) * 43758.5453;
    const r = h - Math.floor(h);
    stationFields(s, field);
    const length = Math.min(field.width * (1.8 + 1.2 * r), 380);
    const clearOfFalls = FALLS.every((f) => Math.abs(s - f.s) > (f.step ? 40 : 100) + length * 0.5);
    const clearOfRapids = RAPIDS.every((q) => s < q.from - 40 - length * 0.6 || s > q.to + 40 + length * 0.6);
    const clearOfReaches = REACHES.every((q) => s < q.from - length * 0.7 || s > q.to + length * 0.7);
    const clearOfIslands = ISLANDS.every((q) => s < q.from - length * 0.8 - 40 || s > q.to + length * 0.8 + 40);
    let placed = false;
    if (clearOfFalls && clearOfRapids && clearOfReaches && clearOfIslands && s > 170) {
      POOLS.push({ s, length, strength: 0.7 + 0.3 * ((r * 5.1) % 1) });
      placed = true;
    }
    s += placed ? Math.max(s < 2500 ? 200 : 380, length * 2.6) + 200 * ((r * 3.7) % 1) : 40;
    k++;
  }
}
// The slot in each step of the fish pass: how much (s, u) lies in it, 0..1. It is cut near
// the left bank, a few body lengths of a big salmon wide.
export const PASS_SLOT = { side: 0.55, half: 2.4 };
export function passSlot(s, u, c = section(s)) {
  const centre = c.thalweg + c.half * PASS_SLOT.side;
  return 1 - smooth(PASS_SLOT.half * 0.7, PASS_SLOT.half * 1.15, Math.abs(u - centre));
}
// How much s lies in a pool, 0..1.
export function poolAt(s) {
  let p = 0;
  for (const f of FALLS) {
    if (f.head) continue;
    const d = s - f.s;
    const reach = f.poolLength * 1.6 + (f.step ? 8 : 20);
    if (d < -2 || d > reach) continue;
    p = Math.max(p, smooth(-2, f.poolLength * 0.2, d) * (1 - smooth(f.poolLength * 0.9, reach, d)) * (f.pass ? 0.3 : f.step ? 0.75 : 1));
  }
  for (const q of POOLS) {
    const d = Math.abs(s - q.s);
    if (d > q.length) continue;
    p = Math.max(p, (1 - smooth(q.length * 0.3, q.length, d)) * q.strength);
  }
  return p;
}

// ---------------------------------------------------------------------------------------
// Tables along the river, one sample per unit from S_MIN to the straight run into the sea.
const S_MIN = -200;
const N = S.straight - S_MIN + 1;
const T = {
  x: new Float64Array(N),
  z: new Float64Array(N),
  heading: new Float64Array(N),
  base: new Float64Array(N), // water level without the falls
  riffle: new Float32Array(N),
  rapid: new Float32Array(N),
  calm: new Float32Array(N),
  narrows: new Float32Array(N),
  island: new Float32Array(N),
  islandSide: new Float32Array(N),
};
for (const f of FIELDS) T[f] = new Float32Array(N);

function stationFields(s, out) {
  let k = 0;
  while (k < STATIONS.length - 2 && STATIONS[k + 1][0] <= s) k++;
  const a = STATIONS[k],
    b = STATIONS[k + 1];
  const t = smooth(a[0], b[0], s);
  for (let i = 0; i < FIELDS.length; i++) out[FIELDS[i]] = lerp(a[i + 1], b[i + 1], t);
  return out;
}
function rapidAt(s) {
  let k = 0;
  for (const r of RAPIDS) k = Math.max(k, smooth(r.from - 30, r.from + 30, s) * (1 - smooth(r.to - 30, r.to + 30, s)) * r.strength);
  return k;
}
// How straight the river is made to run: the chute and the gorges at the falls are cut
// straight through the rock, narrows run straighter, and the lower river runs straight out
// into the estuary. The straightening eases in over a few widths of the river, so a bend
// never tightens so far that its inside bank folds over itself.
function straightness(s, width = 20, narrows = 0, calm = 0) {
  let k = 1 - smooth(relaid(13300), 14900, s);
  k *= 1 - (smooth(40, 70, s) * (1 - smooth(110, 150, s)));
  const ease = 60 + Math.max(0, width - 30) * 2.5;
  for (const f of FALLS) if (!f.step) k *= 1 - (1 - smooth(f.poolLength + 20, f.poolLength + 20 + ease, Math.abs(s - f.s - f.poolLength * 0.3))) * 0.85;
  return k * (1 - 0.45 * narrows) * (1 - 0.35 * calm);
}
const P = [0.7, 2.3, 4.1];
{
  const fields = {};
  const reach = {};
  let meander = 0,
    phase = 0,
    level = 0;
  for (let i = 0; i < N; i++) {
    const s = S_MIN + i;
    stationFields(s, fields);
    // The course on the ground follows the river's usual width, pools or not.
    const baseWidth = fields.width;
    // A pool: wider, deeper, all but still, the surface nearly level.
    const pool = poolAt(s);
    fields.width *= 1 + 0.5 * pool;
    fields.depth *= 1 + 0.45 * pool;
    // The king's pool, deeper still.
    fields.depth *= 1 + 1.1 * pool * (1 - smooth(20, 60, Math.abs(s - KING_POOL.s)));
    fields.speed *= 1 - 0.5 * pool;
    fields.gradient *= 1 - 0.75 * pool;
    // A calm reach spreads out and slows; narrows close in, and the water runs deep and
    // fast between steep, rocky banks.
    reachAt(s, baseWidth, reach);
    const { calm, narrows } = reach;
    fields.width *= (1 + 0.85 * calm) * (1 - 0.5 * narrows);
    fields.depth *= (1 + 0.15 * calm) * (1 + 0.35 * narrows);
    fields.speed *= (1 - 0.6 * calm) * (1 + 1.1 * narrows);
    fields.gradient *= (1 - 0.85 * calm) * (1 + 1.5 * narrows);
    fields.bank *= 1 + 1.6 * narrows;
    fields.rough *= 1 + 0.6 * narrows;
    // Round an island the river is wider, room for both arms. (The course on the ground
    // bends as it would without it.)
    const courseWidth = fields.width;
    islandAt(s, reach);
    fields.width *= 1 + 0.85 * reach.island;
    fields.depth *= 1 + 0.1 * reach.island;
    for (const f of FIELDS) T[f][i] = fields[f];
    T.calm[i] = calm;
    T.narrows[i] = narrows;
    T.island[i] = reach.island;
    T.islandSide[i] = reach.islandSide;
    // Pools and riffles alternate every six or seven widths -- in the big lower river too,
    // if more gently; not in still water.
    phase += TAU / (6.5 * baseWidth);
    const inChute = smooth(60, 80, s) * (1 - smooth(104, 124, s));
    let nearFall = 0;
    for (const f of FALLS) if (!f.step) nearFall = Math.max(nearFall, 1 - smooth(f.poolLength, f.poolLength + 40, Math.abs(s - f.s - f.poolLength * 0.3)));
    const weight = (1 - 0.6 * smooth(relaid(10500), relaid(12500), s)) * (1 - smooth(relaid(14000), 14800, s)) * (1 - inChute) * (1 - nearFall) * smooth(50, 70, s) * (1 - pool) * (1 - calm) * (1 - T.island[i]);
    T.riffle[i] = (0.75 * Math.sin(phase) + 0.25 * Math.sin(2.13 * phase + 1.3)) * weight;
    T.rapid[i] = rapidAt(s);
    // The meanders scale with the river: a bend every dozen widths or so -- though the big
    // river still bends every couple of kilometres rather than running dead straight. The
    // little brook at the top winds tighter and more often.
    const small = 1 - smooth(700, 1300, s);
    meander += (38 / Math.min(baseWidth, 165)) * 0.9 * (1 + 0.35 * small);
    const m = meander;
    T.heading[i] =
      straightness(s, courseWidth, narrows, calm) * (1 + 0.22 * small) * (0.62 * Math.sin(m / 97 + P[0]) + 0.38 * Math.sin(m / 49 + P[1]) + 0.16 * Math.sin(m / 23 + P[2]));
    if (i > 0) {
      const h = (T.heading[i] + T.heading[i - 1]) / 2;
      T.x[i] = T.x[i - 1] + Math.cos(h) * STEP;
      T.z[i] = T.z[i - 1] + Math.sin(h) * STEP;
    }
    const gradient = fields.gradient * (1 + 0.9 * T.riffle[i] + 3 * T.rapid[i]);
    T.base[i] = level;
    level -= gradient * STEP;
  }
  // Put the origin at the spring and the sea at level zero.
  const i0 = -S_MIN;
  const x0 = T.x[i0],
    z0 = T.z[i0];
  let drops = 0;
  for (const f of FALLS) if (!f.head) drops += f.drop;
  const seaAt = T.base[N - 1] - drops;
  for (let i = 0; i < N; i++) {
    T.x[i] -= x0;
    T.z[i] -= z0;
    T.base[i] -= seaAt;
  }
}
const END = { x: T.x[N - 1], z: T.z[N - 1] };

function sample(array, s) {
  const f = clamp(s - S_MIN, 0, N - 1.0001);
  const i = Math.floor(f);
  const t = f - i;
  return array[i] + (array[i + 1] - array[i]) * t;
}

// ---------------------------------------------------------------------------------------
// The water surface.

// Height of the water surface at s: the running level less every fall already passed, and
// a little drawn down where it speeds up toward a lip.
export function level(s) {
  if (s >= S.straight) return 0;
  let y = sample(T.base, s);
  for (const f of FALLS) {
    if (f.head) continue;
    if (s >= f.s) y -= f.drop;
    else if (s > f.s - 12) y -= f.drop * 0.035 * smooth(f.s - 12, f.s, s);
  }
  return y;
}
// The fall whose lip is nearest s, within `reach`, or null.
export function fallNear(s, reach = 60) {
  let best = null,
    distance = reach;
  for (const f of FALLS) {
    const d = Math.abs(s - f.s);
    if (d < distance) {
      distance = d;
      best = f;
    }
  }
  return best;
}
export function levelsAt(f) {
  return { up: level(f.s - 0.01), down: level(f.s + 0.01) };
}

// ---------------------------------------------------------------------------------------
// The course on the ground.

export function heading(s) {
  if (s >= S.straight) return 0;
  return sample(T.heading, s);
}
export function curvature(s) {
  if (s >= S.straight || s <= S_MIN + 1) return 0;
  return (sample(T.heading, s + 1) - sample(T.heading, s - 1)) / 2;
}
// Position of the centreline, the downstream tangent and the leftward normal at s.
export function frame(s, out = {}) {
  if (s >= S.straight) {
    out.x = END.x + (s - S.straight);
    out.z = END.z;
    out.tx = 1;
    out.tz = 0;
  } else {
    out.x = sample(T.x, s);
    out.z = sample(T.z, s);
    const h = sample(T.heading, s);
    out.tx = Math.cos(h);
    out.tz = Math.sin(h);
  }
  out.nx = -out.tz;
  out.nz = out.tx;
  return out;
}
export function place(s, u, out = {}) {
  frame(s, out);
  out.x += out.nx * u;
  out.z += out.nz * u;
  return out;
}

// The river coordinates of a world point: past the start of the straight run the course is
// a plane; above it, the nearest point on the centreline, searched near `hint` (the s last
// found for the same thing) or, without one, along the whole river.
export function locate(x, z, hint = null, out = {}) {
  if (x >= END.x) {
    out.s = S.straight + (x - END.x);
    out.u = z - END.z;
    return out;
  }
  let lo, hi;
  if (hint === null || !Number.isFinite(hint)) {
    // Coarse pass over everything, then a fine one round the best.
    let best = Infinity,
      bestI = 0;
    for (let i = 0; i < N; i += 8) {
      const d = (T.x[i] - x) ** 2 + (T.z[i] - z) ** 2;
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    lo = bestI - 40;
    hi = bestI + 40;
  } else {
    const c = Math.round(clamp(hint, S_MIN, S.straight) - S_MIN);
    lo = c - 34;
    hi = c + 34;
  }
  lo = Math.max(0, lo);
  hi = Math.min(N - 2, hi);
  let best = Infinity,
    bestS = 0,
    bestU = 0;
  for (let i = lo; i <= hi; i++) {
    const ax = T.x[i],
      az = T.z[i];
    const dx = T.x[i + 1] - ax,
      dz = T.z[i + 1] - az;
    const len2 = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d2 = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
    if (d2 < best) {
      best = d2;
      bestS = S_MIN + i + t;
      bestU = (dx * (z - az) - dz * (x - ax)) / Math.sqrt(len2);
    }
  }
  out.s = bestS;
  out.u = bestU;
  return out;
}

// ---------------------------------------------------------------------------------------
// The river's cross-section at s, everything that does not depend on u, cached because
// every row of a mesh asks for the same s many times.
const sectionCache = new Map();
export function section(s) {
  const key = Math.round(s * 64);
  let c = sectionCache.get(key);
  if (c) return c;
  if (sectionCache.size > 20000) sectionCache.clear();
  c = {};
  if (s >= S.straight) {
    stationFields(Math.min(s, S.coast), c);
    c.riffle = 0;
    c.rapid = 0;
    c.calm = 0;
    c.narrows = 0;
    c.island = 0;
    c.islandSide = 1;
  } else {
    for (const f of FIELDS) c[f] = sample(T[f], s);
    c.riffle = sample(T.riffle, s);
    c.rapid = sample(T.rapid, s);
    c.calm = sample(T.calm, s);
    c.narrows = sample(T.narrows, s);
    c.island = sample(T.island, s);
    c.islandSide = sample(T.islandSide, s) < 0 ? -1 : 1;
  }
  const r = c.riffle,
    k = c.rapid;
  c.s = s;
  c.level = level(s);
  c.width = c.width * (1 + 0.12 * r + 0.25 * k);
  c.depth = c.depth * (1 - 0.3 * r - 0.42 * k);
  c.speed = c.speed * (1 + 0.42 * r + 1.25 * k);
  c.half = c.width * 0.5;
  // The deepest water is thrown to the outside of the bends.
  c.thalweg = clamp(-curvature(s) * c.width * 0.42, -0.3, 0.3) * c.half;
  // An island: its middle a little toward the quick arm's side (so that arm is the
  // narrower), its half-width growing to a third of the river's.
  c.islandHalf = c.island > 0 ? c.half * 0.3 * Math.sqrt(c.island) : 0;
  c.islandU = c.thalweg + c.islandSide * c.half * 0.07 * c.island;
  c.fall = fallNear(s, 140);
  const region = regionWeights(s);
  c.region = region;
  sectionCache.set(key, c);
  return c;
}

// How much of each stretch of river s belongs to, for looks and life.
// Where the upper river gives way to the middle, and the middle to the lower (see relaid).
const R_UPPER = relaid(7300),
  R_MIDDLE = relaid(11900);
export function regionWeights(s, out = {}) {
  const brook = 1 - smooth(2450, 2850, s);
  const upper = smooth(2450, 2850, s) * (1 - smooth(R_UPPER, R_UPPER + 600, s));
  const middle = smooth(R_UPPER, R_UPPER + 600, s) * (1 - smooth(R_MIDDLE, R_MIDDLE + 450, s));
  const lower = smooth(R_MIDDLE, R_MIDDLE + 450, s) * (1 - smooth(14800, 15400, s));
  const estuary = smooth(14800, 15400, s) * (1 - smooth(15900, 16500, s));
  const sea = smooth(15900, 16500, s);
  out.brook = brook;
  out.upper = upper;
  out.middle = middle;
  out.lower = lower;
  out.estuary = estuary;
  out.sea = sea;
  return out;
}
export function regionName(s) {
  const w = regionWeights(s);
  let best = "brook",
    v = -1;
  for (const k of ["brook", "upper", "middle", "lower", "estuary", "sea"])
    if (w[k] > v) {
      v = w[k];
      best = k;
    }
  return best;
}

// ---------------------------------------------------------------------------------------
// Small smooth noise for the bed's relief.
function hash2(i, j) {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}
export function noise2(x, y) {
  const i = Math.floor(x),
    j = Math.floor(y);
  let fx = x - i,
    fy = y - j;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j),
    b = hash2(i + 1, j),
    c = hash2(i, j + 1),
    d = hash2(i + 1, j + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y) {
  return noise2(x, y) * 0.55 + noise2(x * 2.07 + 5.2, y * 2.07 + 1.3) * 0.3 + noise2(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.15;
}

// Land beyond the water: a bank, then low rolling ground. Kept plain; it is seen only from
// a leap.
function land(c, s, beyond) {
  const rise = Math.min(beyond * c.bank, 3 + 5 * c.bank);
  const hills = (fbm(s * 0.012, beyond * 0.02 + 3.7) - 0.4) * 10 * smooth(10, 60, beyond);
  return c.level + rise + Math.max(0, hills);
}

// The coastline: where the land ends and the sea begins, as an s for each u.
export function coastAt(u) {
  return S.coast + 36 * Math.sin(u / 210 + 0.7) + 17 * Math.sin(u / 77 + 2.1) + 8 * Math.sin(u / 31);
}
const MOUTH_HALF = 450;

// ---------------------------------------------------------------------------------------
// Height of the bed at (s, u), and what the bed is made of there.
export function bed(s, u) {
  return bedDetail(s, u, null);
}
// `ground` (optional) receives the mix of bed material: gravel, sand, silt, rock (sum 1)
// and `wet` (1 under water, 0 on land).
export function bedDetail(s, u, ground) {
  if (s >= S.straight - 400) {
    const sea = seaBed(s, u, ground);
    if (s >= S.straight) return sea;
    const t = smooth(S.straight - 400, S.straight, s);
    const river = riverBed(s, u, null);
    return lerp(river, sea, t);
  }
  return riverBed(s, u, ground);
}

function riverBed(s, u, ground) {
  const c = section(s);
  const off = u - c.thalweg;
  // The inside of a bend shoals into a gravel bar sooner than the outside.
  const inner = Math.sign(off) === -Math.sign(c.thalweg) && c.thalweg !== 0 ? 1 + 0.9 * Math.abs(c.thalweg) / c.half : 1;
  const a = (Math.abs(off) / c.half) * inner;
  // The redd: a broad, flat-bottomed run of clean gravel, the stones heaped a little where
  // the eggs were buried.
  const redd = 1 - smooth(6, 16, Math.abs(s - S.redd));
  const p = c.shape + redd * 2.2;
  let y;
  if (a < 1) y = c.level - c.depth * (1 - Math.pow(a, p));
  else y = land(c, s, (a - 1) * c.half);
  let wet = 1 - smooth(0.92, 1.02, a);
  if (redd > 0 && a < 1) y += redd * 0.9 * Math.exp(-((s - S.redd) ** 2) / 18 - (off * off) / 10);
  // An island's reach: each arm its own channel, the quick one shallow, the slow one deep;
  // between them the island, a low hump of gravel and turf above the water.
  let isle = 0;
  if (c.island > 0.02 && a < 1.05) {
    const k = c.island;
    const side = u >= c.islandU ? 1 : -1;
    const inner = c.islandU + side * c.islandHalf,
      outer = c.thalweg + side * c.half;
    const armHalf = Math.max(0.5, Math.abs(outer - inner) / 2);
    const aa = Math.min(1, Math.abs(u - (inner + outer) / 2) / armHalf);
    const quick = side === c.islandSide;
    const armBed = c.level - c.depth * (quick ? 0.42 : 1.08) * (1 - Math.pow(aa, c.shape));
    y = lerp(y, armBed, smooth(0.02, 0.3, k));
    const q = Math.abs(u - c.islandU) / Math.max(c.islandHalf, 0.01);
    if (q < 1.7) {
      const top = c.level + (0.5 + 2.6 * k) * (1 - 0.6 * q * q);
      isle = smooth(1.7, 0.8, q);
      y = Math.max(y, lerp(y, top, isle));
    }
  }
  // Relief: boulder-scale lumps upstream, dunes across the flow downstream.
  const region = c.region;
  const lumps = (fbm(s * 0.23, u * 0.23) - 0.5) * c.depth * 0.34 * c.rough + (noise2(s * 0.9, u * 0.9) - 0.5) * 0.35 * c.rough;
  const dunes = (region.lower + region.middle * 0.5) * (0.45 * Math.sin(s * 0.19 + 0.6 * Math.sin(u * 0.04)) + 0.2 * Math.sin(s * 0.47 - u * 0.1));
  y += (lumps + dunes) * wet;

  // The spring's rock: the river begins at a wall, hollowed at its foot into a little cave
  // the spring wells up in (its roof is built in features.js).
  if (s < 16) {
    const wall = smooth(4, -1, s);
    y = lerp(y, c.level + 8 + fbm(u * 0.3, s * 0.3) * 3, wall);
    // The cave's sides: rock walls either side of the pool, closing in at the back.
    const side = smooth(4.2 + s * 0.12, 6.5 + s * 0.15, Math.abs(u)) * (1 - smooth(13, 17, s));
    y = Math.max(y, lerp(y, c.level + 5 + fbm(u * 0.4, s * 0.4) * 2, side));
  }
  // The chute: bedrock, ridged across the flow.
  const chute = smooth(70, 82, s) * (1 - smooth(102, 116, s));
  if (chute > 0 && a < 1) y += chute * 0.3 * Math.sin(s * 1.1 + u * 0.2) * wet;
  // Falls: a rock sill before the lip, then the plunge pool.
  const f = c.fall;
  if (f && !f.head) {
    const d = s - f.s;
    if (d < 0 && d > -f.sill - 4) {
      const up = level(f.s - 0.01);
      const sill = up - f.lip - (f.pass ? 0 : 0.6 * (fbm(u * 0.18, 3.1) - 0.5) * f.lip);
      const w = smooth(-f.sill, -1.5, d);
      // The fish pass: every step of the weir has a slot cut through it near one bank, right
      // down to the river's floor -- a gap of white water from one basin to the next that a
      // fish can swim up instead of leaping.
      const gap = f.pass ? passSlot(s, u, c) : 0;
      if (a < 1.05) y = lerp(y, Math.max(sill, y), w * (1 - gap));
    } else if (d >= 0 && d < f.poolLength + 30) {
      const down = level(f.s + 0.01);
      const bottom = down - f.pool;
      const t = d / f.poolLength;
      // A bowl, deepest a little way out from the face.
      const bowl = bottom + f.pool * 0.85 * Math.pow(Math.abs(t - 0.28) / 0.72, 1.6) * (t > 0.28 ? 1 : 0.35);
      const w = 1 - smooth(f.poolLength * 0.75, f.poolLength + 30, d);
      if (a < 1) y = lerp(y, Math.min(y, bowl), w * wet);
    }
    // The gorge: the banks round a fall are rock walls.
    if (!f.step && a >= 1 && Math.abs(d) < f.poolLength + 20) {
      const wall = 1 - smooth(f.poolLength * 0.6, f.poolLength + 20, Math.abs(d));
      y = Math.max(y, lerp(y, level(f.s - 0.01) + 4 + 3 * fbm(s * 0.2, u * 0.2), wall * smooth(1, 1.12, a)));
    }
  }
  // An undercut bank: a pocket of deep water hollowed in under the bank.
  const cut = s < 5000 ? undercutAt(s, u, c) : null;
  if (cut) {
    const pocket = c.level - Math.min(c.depth * 0.75, 3.2);
    const w = cut.along * smooth(0.72, 0.9, cut.e) * (1 - smooth(1.18, 1.3, cut.e));
    y = Math.min(y, lerp(y, pocket, w));
    wet = Math.max(wet, w);
  }
  // A mill race: a walled channel cut beside the river, with a strip of land between.
  const race = a > 0.7 ? millAt(s, u, c) : null;
  if (race) {
    const across = Math.abs(race.d) / race.w;
    const floor = c.level - race.m.depth * (1 - Math.min(1, across) ** 4);
    // Masonry: straight walls, the land right up to them.
    const wall = smooth(1.0, 1.12, across);
    const top = Math.max(y, c.level + 1.2);
    y = Math.min(y, lerp(floor, top, wall));
    wet = Math.max(wet, 1 - wall);
  }
  // The crack behind the salmon fall: a narrow cleft down to the pool's floor.
  const crack = c.fall && !c.fall.head ? crackAt(s, u, c) : null;
  if (crack) {
    const floor = level(crack.f.s + 0.02) - crack.f.pool * 0.55;
    const w = crack.along * (1 - smooth(0.8, 1.4, crack.across));
    y = Math.min(y, lerp(y, floor, w));
  }
  // A side brook cut into the land: a channel with the river's own water in it, shelving
  // up to a step of rock at its head, over which it falls; above the step it runs on,
  // small and shallow, into the forest.
  let brookWet = 0;
  const trib = a > 0.6 ? tributaryAt(s, u, tribScratch) : null;
  if (trib) {
    const { b, t, d, w } = trib;
    const lv = c.level;
    const across = Math.abs(d) / w;
    const tt = Math.min(1, Math.max(0, t));
    const depth = b.depth * (1 - 0.4 * tt);
    let channel = lv - depth * (1 - Math.min(1, across) ** 2.2);
    // The head: a rock step up to the brook above the fall.
    const step = smooth(0.97, 1.06, t);
    channel = lerp(channel, lv + b.drop - 0.5 * (1 - Math.min(1, across) ** 2), step);
    // Beyond the step the brook narrows to a trickle and fades into the forest floor.
    const fade = smooth(1.25, 1.4, t);
    const banks = smooth(0.85, 1.6, across);
    // Its little valley: the land slopes gently down to it rather than standing in walls.
    const valleyFloor = lv + 0.6 + b.drop * step + 1.2 * Math.max(0, across - 1.1);
    const valley = lerp(valleyFloor, y, Math.max(smooth(1.5, 5, across), fade));
    y = Math.min(y, valley);
    const cut = lerp(channel, y, Math.max(banks, fade));
    // Where the channel meets the river, it simply opens into it.
    y = t < 0.1 ? Math.min(y, lerp(y, cut, smooth(-0.2, 0.1, t))) : Math.min(y, cut);
    // The rock face of the step, left standing to either side of the fall.
    if (t > 0.95 && t < 1.1 && across > 0.9 && across < 1.8) y = Math.max(y, lv + b.drop + 0.8 * fbm(s * 0.4, u * 0.4));
    brookWet = (1 - banks) * (1 - step) * (t > -0.2 ? 1 : 0);
    wet = Math.max(wet, brookWet);
  }

  if (ground) {
    const r = c.region;
    // Gravel in the brook and in riffles; sand in pools and downstream; silt at the quiet
    // margins and in the lower river; bare rock in the chute, at falls and in rapids.
    let rock = Math.max(chute, c.rapid * 0.6, c.narrows * 0.7);
    if (f && !f.head && Math.abs(s - f.s) < f.sill) rock = Math.max(rock, f.step ? 0.5 : 0.85);
    const riffle = Math.max(0, c.riffle);
    let gravel = (r.brook * 0.9 + r.upper * 0.75 + r.middle * 0.45 + r.lower * 0.08) * (0.7 + 0.3 * riffle);
    gravel = Math.max(gravel, redd);
    let silt = (r.lower * 0.5 + r.middle * 0.12) * smooth(0.55, 0.95, a) + r.lower * 0.2;
    let sand = 1 - gravel - silt;
    const total = gravel + sand + silt;
    const k = (1 - rock) / Math.max(total, 1e-6);
    ground.gravel = Math.max(0, gravel * k);
    ground.sand = Math.max(0, sand * k);
    ground.silt = Math.max(0, silt * k);
    ground.rock = rock;
    // An island's top is land; a side brook's channel is river.
    ground.wet = Math.max(brookWet, wet * (1 - isle * smooth(c.level + 0.1, c.level + 0.7, y)));
    if (brookWet > 0.3) {
      ground.gravel = Math.max(ground.gravel, 0.7 * brookWet);
      ground.rock = Math.max(ground.rock, trib && trib.t > 0.9 ? 0.8 : 0);
    }
    ground.level = c.level;
  }
  return y;
}

function seaBed(s, u, ground) {
  const coast = coastAt(u);
  const absU = Math.abs(u);
  const c = section(Math.min(s, S.coast));
  const half = s < S.coast ? c.half : MOUTH_HALF;
  let y, wet, rock, sand, silt, gravel;
  // The estuary channel inland of the coast, with the land on either side.
  const channelA = absU / half;
  const channelDepth = c.depth * (1 - Math.pow(Math.min(channelA, 1), 3.2));
  if (s < coast) {
    if (channelA < 1) {
      y = -channelDepth;
      wet = 1;
    } else {
      y = land(c, s, (channelA - 1) * half);
      wet = 0;
    }
  }
  // The sea: shelving from the shore to the open deep.
  const out = s - coast;
  const lateral = smooth(MOUTH_HALF - 80, MOUTH_HALF + 200, absU);
  const deep = 28 + out * 0.03 + 120 * smooth(1400, 3600, out) + 90 * smooth(S.seaSide - 600, S.seaSide + 400, absU);
  const shore = Math.max(0, out) * 0.36 + (lateral > 0 ? 0 : 0);
  if (s >= coast) {
    // In the mouth, the channel runs on out and deepens; along the coast, a rocky shore.
    const depthHere = lerp(Math.max(channelDepth, 28 * (1 - smooth(0.6, 1.2, channelA)) + Math.min(deep, shore)), Math.min(deep, shore + 1), lateral);
    y = -Math.min(deep, Math.max(depthHere, Math.min(deep, shore)));
    wet = 1;
  }
  // Relief: rocky reefs near the coast and sand waves further out.
  const reef = smooth(0.55, 0.75, fbm(s * 0.012, u * 0.012)) * (1 - smooth(300, 1400, out)) * (s > coast - 40 ? 1 : 0);
  const reefHeight = reef * (6 + 10 * fbm(s * 0.06, u * 0.06));
  const waves = 0.8 * Math.sin(s * 0.05 + 0.8 * Math.sin(u * 0.013)) + 0.35 * Math.sin(s * 0.17 - u * 0.05);
  const lumps = (fbm(s * 0.08, u * 0.08) - 0.5) * 3;
  if (wet > 0) y += (reefHeight + waves * (1 - reef) + lumps) * wet;
  if (ground) {
    rock = Math.max(reef, s < coast ? 0 : (1 - smooth(4, 30, out)) * lateral * 0.8);
    silt = (1 - smooth(-200, 300, out)) * 0.6 * (1 - rock);
    gravel = 0.1 * (1 - rock);
    sand = Math.max(0, 1 - rock - silt - gravel);
    ground.gravel = gravel;
    ground.sand = sand;
    ground.silt = silt;
    ground.rock = rock;
    ground.wet = wet ?? 1;
    ground.level = 0;
  }
  return y;
}

// Depth of water at (s, u); negative on land.
export function depthAt(s, u) {
  return level(s) - bed(s, u);
}

// How rich the drift is here, 0..1: the shallow, quick water of a riffle, where the current
// brings the most larvae down over the gravel -- and where a fish feeding in it is in the
// open, bright and seen from far off. Only in the river (not the sea, not a deep pool).
export function driftRich(s, u) {
  if (s >= S.coast - 150) return 0;
  const c = section(s);
  const riffle = smooth(0.05, 0.55, c.riffle);
  if (riffle <= 0) return 0;
  const shallow = 1 - smooth(6, 16, level(s) - bed(s, u));
  return riffle * shallow;
}

// ---------------------------------------------------------------------------------------
// The current at (s, u) and height y, written into out as vx, vy, vz and speed. Fastest over
// the deep line and toward the surface, slowed near the bed where the stones break it, and
// in the sea only a slow drift and the river's plume off the mouth.
// `steady`: without the gusts and the season's flow (see gusts()), for the local flow field
// that lays its own unsteadiness over it.
export function current(s, u, y, out = {}, time = 0, steady = false) {
  if (s >= S.coast - 200) {
    const plume = (1 - smooth(0, 900, s - S.coast)) * (1 - smooth(MOUTH_HALF * 0.6, MOUTH_HALF * 2.2, Math.abs(u)));
    const tide = 0.22 * Math.sin(time / 190 + 1.1);
    const along = 0.12 + 0.08 * Math.sin(u / 400 + s / 700);
    out.vx = 0.35 * plume + along * 0.3;
    out.vz = tide * (1 - plume);
    out.vy = 0;
    out.speed = Math.hypot(out.vx, out.vz);
    // Near the estuary the river still runs.
    if (s < S.coast + 100) {
      const c = section(Math.min(s, S.coast));
      const t = 1 - smooth(S.coast - 200, S.coast + 100, s);
      out.vx = lerp(out.vx, c.speed, t * (1 - smooth(0.6, 1, Math.abs(u) / c.half)));
      out.speed = Math.hypot(out.vx, out.vz);
    }
    return out;
  }
  const c = section(s);
  const floor = bed(s, u);
  const depth = c.level - floor;
  const f = frame(s, frameScratch);
  if (depth <= 0.05) {
    out.vx = out.vy = out.vz = out.speed = 0;
    return out;
  }
  const eta = clamp((y - floor) / depth, 0, 1);
  // A side brook runs out into the river, faster toward its fall.
  const trib = Math.abs(u) > c.half * 0.6 ? tributaryAt(s, u, tribScratch) : null;
  if (trib && Math.abs(trib.d) < trib.w * 1.2 && trib.t > -0.1 && trib.t < 1.02) {
    const { b, t, d, w } = trib;
    const acrossB = 0.35 + 0.75 * Math.sqrt(Math.max(0, 1 - (d / w) ** 2));
    const vertical = 0.3 + 0.8 * (1 - Math.pow(1 - eta, 2.4));
    let speed = (1.6 + 2.2 * smooth(0.75, 1, t)) * acrossB * vertical * (1 - smooth(-0.1, 0.1, -t) * 0.5);
    speed *= steady ? 1 : gusts(s, u, time);
    // Down the brook: toward the river's bank, and a little downriver as it runs.
    const toward = -b.side;
    const along = -b.drift / b.length;
    let dx = f.nx * toward + f.tx * along,
      dz = f.nz * toward + f.tz * along;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    out.vx = dx * speed;
    out.vz = dz * speed;
    out.vy = 0;
    out.speed = speed;
    return out;
  }
  // A mill race runs quick and even, quickest under the wheel.
  const race = Math.abs(u - c.thalweg) > c.half * 0.7 ? millAt(s, u, c) : null;
  if (race && Math.abs(race.d) < race.w * 1.05) {
    const acrossR = 0.5 + 0.6 * Math.sqrt(Math.max(0, 1 - (race.d / race.w) ** 2));
    const vertical = 0.35 + 0.75 * (1 - Math.pow(1 - eta, 2.4));
    let speed = (3.2 + 2.2 * (1 - smooth(4, 14, Math.abs(s - race.m.wheel)))) * acrossR * vertical * (0.5 + 0.5 * race.ramp);
    speed *= steady ? 1 : gusts(s, u, time);
    out.vx = f.tx * speed;
    out.vz = f.tz * speed;
    out.vy = 0;
    out.speed = speed;
    return out;
  }
  // In the crack behind the fall the water barely moves: a gentle seep down through it.
  const crack = c.fall && !c.fall.head ? crackAt(s, u, c) : null;
  if (crack && crack.across < 1.1 && s < crack.f.s - 0.5) {
    const speed = 0.6 * (steady ? 1 : gusts(s, u, time));
    out.vx = f.tx * speed;
    out.vz = f.tz * speed;
    out.vy = 0;
    out.speed = speed;
    return out;
  }
  let a = Math.min(1, Math.abs(u - c.thalweg) / c.half);
  let across = 0.3 + 0.85 * Math.sqrt(Math.max(0, 1 - a * a));
  // Round an island each arm has its own current: quick in the shallow arm, slow in the
  // deep one.
  if (c.island > 0.02) {
    const k = c.island;
    const side = u >= c.islandU ? 1 : -1;
    const inner = c.islandU + side * c.islandHalf,
      outer = c.thalweg + side * c.half;
    const armHalf = Math.max(0.5, Math.abs(outer - inner) / 2);
    a = Math.min(1, Math.abs(u - (inner + outer) / 2) / armHalf);
    const arm = 0.3 + 0.85 * Math.sqrt(Math.max(0, 1 - a * a));
    across = lerp(across, arm, smooth(0.02, 0.3, k)) * (side === c.islandSide ? 1 + 0.65 * k : 1 - 0.5 * k);
  }
  const chute = smooth(70, 82, s) * (1 - smooth(102, 116, s));
  let vertical = 0.2 + 0.95 * (1 - Math.pow(1 - eta, 2.4));
  vertical = Math.max(vertical, 0.85 * chute);
  let speed = c.speed * across * vertical;
  // Toward a lip the water runs faster; below it, the jet off the fall.
  const fall = c.fall;
  if (fall && !fall.head) {
    const d = s - fall.s;
    if (d < 0 && d > -24) speed *= 1 + 1.1 * smooth(-24, 0, d);
    else if (d >= 0 && d < fall.poolLength) {
      const jet = (1 - smooth(0, fall.poolLength, d)) * (0.6 + 0.8 * eta);
      speed += jet * (3 + 0.35 * fall.drop);
    }
    // Through a slot of the fish pass the water shoots hard, top to bottom.
    if (fall.pass && Math.abs(d) < 5) speed = Math.max(speed, passSlot(s, u, c) * (5.5 + 1.5 * eta) * (1 - smooth(2, 5, Math.abs(d))));
  }
  // Gusts: the current is never steady. And the season: the snowmelt flood runs hard, the
  // low water of late summer slack.
  if (!steady) speed *= gusts(s, u, time);
  out.vx = f.tx * speed;
  out.vz = f.tz * speed;
  out.vy = 0;
  out.speed = speed;
  return out;
}
const frameScratch = {};
// How much harder or softer than its steady flow the river runs at (s, u) just now: the
// gusts, and the season.
export function gusts(s, u, time) {
  return (1 + 0.12 * Math.sin(time * 0.7 + s * 0.05) + 0.06 * Math.sin(time * 1.9 - s * 0.21 + u * 0.1)) * seasonFlow;
}
// How hard the river runs for the time of year (1 is its ordinary summer flow).
export function setSeasonFlow(value) {
  seasonFlow = value;
}

// ---------------------------------------------------------------------------------------
// Landmarks in world space.
export function worldPoint(s, u = 0) {
  const p = place(s, u, {});
  return { x: p.x, z: p.z, y: level(s) };
}
export const MOUTH = (() => {
  const p = place(S.coast, 0, {});
  return { x: p.x, z: p.z };
})();
export const REDD = (() => {
  const p = place(S.redd, 0, {});
  return { x: p.x, z: p.z };
})();

// Is (s, u, y) open water a body of this height can be in?
export function roomAt(s, u) {
  const floor = bed(s, u);
  return { floor, ceiling: level(s), depth: level(s) - floor };
}
