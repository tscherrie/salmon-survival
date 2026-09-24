// The river. Riverscape is a clear, spring-fed river run in the Paraguay basin. The viewer
// drifts slowly round a clearing in it: sunlight comes down through a moving surface, the
// current runs one way across the clearing, a drowned tree leans out of the middle of it,
// and a meadow of ribbon grass rings it and fades into blue-green haze on every side, up
// the run, down it, and toward both banks.
//
// Everything that has a place lives here: the shape of the bed, the stones, the wood, the
// plant beds, the path the viewer drifts along and the water the fish may use. One scene
// unit is about six centimetres, so the water is roughly sixty-five centimetres deep and a
// bloodfin tetra is two thirds of a unit long.
//
// The layout is planned in rings round the centre of the clearing, because it is seen from
// every side. The middle is open sand, the tree and the log. Everything tall -- the big
// stones and the three beds of grass -- stands within about ten units of it, so from
// wherever the viewer is it is at least as far away again: a bed may stand between the
// viewer and the tree, but never right in front of the lens. Grass leaves stream a few
// units downstream, so the bed on that side sits further in. Out to the viewer's band only
// small stones, swords, lawns and short tufts; the band itself is kept low. Outside it, the
// tall meadow and more stones, which from across the clearing are the far background.

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const SURFACE_Y = 11;

// The centre of the clearing, on the bed, and the circle the viewer drifts round.
export const CENTER = Object.freeze({ x: 0, z: -2.5 });
export const ORBIT = Object.freeze({
  radius: 21.5,
  height: 3.4,
  // Where the lens looks: the middle of the clearing, a little above the sand.
  lookHeight: 2.4,
  // Seconds for one full turn: slow in the browser, slower still on the desktop.
  period: 360,
  wallpaperPeriod: 600,
  // The band kept clear of anything tall.
  clearInner: 17.5,
  clearOuter: 25.5,
});

// The viewer at angle 0 is where the scene was first composed: looking across the
// current, with the flow running from left to right.
export const CAMERA = Object.freeze({
  position: [CENTER.x, ORBIT.height, CENTER.z + ORBIT.radius],
  target: [CENTER.x, ORBIT.lookHeight, CENTER.z],
  fov: 36,
  near: 0.3,
  far: 150,
});

export const radial = (x, z) => Math.hypot(x - CENTER.x, z - CENTER.z);

// The swept lane of the thalweg: the current's own path across the clearing, following
// the flow and wandering a little. 1 on its centreline, 0 on the banks. Plants and
// sediment keep off it; the fish use it as a road, and the ray rests on it.
export function channel(x, z) {
  const centre = CENTER.z + 0.6 + 1.6 * Math.sin(x * 0.075 + 0.4);
  const halfWidth = 2.5 + 0.6 * Math.sin(x * 0.05 + 1.3);
  const open = Math.exp(-(((z - centre) / halfWidth) ** 2));
  return open * (1 - smooth(20, 32, Math.abs(x - CENTER.x)));
}

// The bed: broad current-built dunes, the thalweg scoured slightly lower, scour pools
// beside the big stones, the spring boils, and far off on both sides the banks climbing
// out of the haze toward the surface. Up and down the run the river simply goes on.
export function groundHeight(x, z) {
  const dunes =
    0.32 * Math.sin(x * 0.16 + z * 0.07 + 0.6) +
    0.2 * Math.sin(-x * 0.1 + z * 0.21 + 1.9) +
    0.07 * Math.sin(x * 0.43 - z * 0.31 + 0.3);
  const farBank = 9.2 * Math.pow(smooth(-44, -84, z), 1.4);
  const nearBank = 9.2 * Math.pow(smooth(38, 78, z), 1.4);
  let scour = 0;
  for (const rock of BIG_ROCKS) {
    const dx = x - rock.x - rock.rx * 0.9,
      dz = z - rock.z;
    scour += 0.22 * Math.exp(-(dx * dx) / 6 - (dz * dz) / 4);
  }
  // Spring boils: where the groundwater that feeds the river wells up through the bed it
  // keeps a shallow bowl open with a low rim of the sand it throws out.
  let boil = 0;
  for (const spring of SPRINGS) {
    const d = Math.hypot(x - spring.x, z - spring.z) / spring.radius;
    if (d > 3) continue;
    boil += spring.depth * (0.35 * Math.exp(-((d - 1.25) ** 2) * 5) - Math.exp(-d * d * 1.6));
  }
  return 0.25 + dunes + farBank + nearBank - 0.22 * channel(x, z) - scour + boil;
}

// The same bed for everything that asks every frame -- drifting motes, fish keeping off
// the sand, the ray lying on it -- read from a table filled on first use, a quarter of a
// unit apart, instead of summing the whole shape again each time.
const TABLE = { minX: -42, maxX: 42, minZ: -45, maxZ: 40, step: 0.25 };
let table = null;
let columns = 0;
export function bedHeight(x, z) {
  if (!table) {
    columns = Math.round((TABLE.maxX - TABLE.minX) / TABLE.step) + 1;
    const rows = Math.round((TABLE.maxZ - TABLE.minZ) / TABLE.step) + 1;
    table = new Float32Array(columns * rows);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < columns; i++)
        table[j * columns + i] = groundHeight(TABLE.minX + i * TABLE.step, TABLE.minZ + j * TABLE.step);
  }
  const fx = (x - TABLE.minX) / TABLE.step,
    fz = (z - TABLE.minZ) / TABLE.step;
  const i = Math.floor(fx),
    j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= columns - 1 || (j + 1) * columns + i + 1 >= table.length)
    return groundHeight(x, z);
  const u = fx - i,
    v = fz - j;
  const a = table[j * columns + i],
    b = table[j * columns + i + 1],
    c = table[(j + 1) * columns + i],
    d = table[(j + 1) * columns + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// The spring boils ("olhos d'agua"): the sand in them never settles, lifted and dropped
// again by the water rising through it.
export const SPRINGS = [
  { x: -1.9, z: 5.4, radius: 0.62, depth: 0.16, strength: 1 },
  { x: 2.5, z: 0.2, radius: 0.42, depth: 0.1, strength: 0.6 },
  { x: -3.6, z: -2.0, radius: 0.5, depth: 0.12, strength: 0.8 },
  { x: 5.6, z: -12.2, radius: 0.5, depth: 0.12, strength: 0.8 },
];

// Limestone boulders, rounded by the water, and their companions. `lean` tips a stone
// about the flow axis. The first group stands in the clearing; the second rings it beyond
// the viewer's path and is mostly seen from across the water, in the haze.
export const ROCKS = [
  { x: -8.3, z: -1.4, rx: 2.3, ry: 1.75, rz: 1.8, lean: -0.1 },
  { x: -5.8, z: 0.7, rx: 1.0, ry: 0.72, rz: 0.9, lean: -0.18 },
  { x: 7.4, z: -3.2, rx: 2.6, ry: 2.0, rz: 2.0, lean: 0.12 },
  { x: 4.9, z: -1.5, rx: 1.05, ry: 0.8, rz: 0.95, lean: 0.2 },
  { x: 10.6, z: 2.3, rx: 1.3, ry: 0.9, rz: 1.1, lean: 0.1 },
  { x: 0.4, z: -10.8, rx: 1.9, ry: 1.5, rz: 1.6, lean: -0.05 },
  { x: 3.0, z: -13.0, rx: 1.4, ry: 1.05, rz: 1.2, lean: 0.08 },
  { x: -6.9, z: 4.4, rx: 1.6, ry: 1.25, rz: 1.4, lean: -0.08 },
  { x: 1.9, z: 4.4, rx: 0.55, ry: 0.38, rz: 0.5, lean: 0.25 },
  { x: -3.9, z: 3.2, rx: 0.42, ry: 0.3, rz: 0.4, lean: -0.2 },
  { x: -1.4, z: -8.4, rx: 0.9, ry: 0.65, rz: 0.8, lean: 0.15 },
  { x: -8.2, z: -11.2, rx: 1.2, ry: 0.9, rz: 1.1, lean: -0.12 },
  { x: 5.4, z: 8.6, rx: 1.1, ry: 0.8, rz: 1.0, lean: 0.14 },
  { x: -6.8, z: 9.2, rx: 0.9, ry: 0.65, rz: 0.8, lean: -0.1 },
  { x: 13.4, z: -4.4, rx: 1.2, ry: 0.9, rz: 1.1, lean: 0.1 },
  { x: -1.4, z: -15.2, rx: 0.7, ry: 0.5, rz: 0.6, lean: 0.05 },
  // Beyond the viewer's path.
  { x: -27.5, z: -1, rx: 2.1, ry: 1.6, rz: 1.7, lean: -0.1 },
  { x: 27.5, z: -4, rx: 1.9, ry: 1.5, rz: 1.6, lean: 0.1 },
  { x: -1.5, z: -31, rx: 3.2, ry: 2.4, rz: 2.6, lean: 0.05 },
  { x: -15.5, z: -28, rx: 2.2, ry: 1.7, rz: 1.9, lean: -0.12 },
  { x: 14.5, z: -30, rx: 2.6, ry: 2.0, rz: 2.1, lean: 0.1 },
  { x: 4, z: 27.5, rx: 2.4, ry: 1.8, rz: 2.0, lean: 0.06 },
  { x: -19.5, z: 20.5, rx: 2.6, ry: 2.0, rz: 2.1, lean: -0.08 },
  { x: 21.5, z: 18.5, rx: 2.2, ry: 1.7, rz: 1.9, lean: 0.1 },
  { x: -29.5, z: -15, rx: 2.4, ry: 1.8, rz: 2.0, lean: -0.1 },
  { x: 29.5, z: 12, rx: 2.3, ry: 1.7, rz: 1.9, lean: 0.08 },
  { x: -8.5, z: 29.5, rx: 1.8, ry: 1.4, rz: 1.6, lean: -0.06 },
  { x: 27.5, z: -21, rx: 2.0, ry: 1.5, rz: 1.7, lean: 0.12 },
];
const BIG_ROCKS = ROCKS.filter((rock) => rock.rx >= 1.5);

// A stone is buried to a little under half its height, and deeper the more it leans.
export function rockCenterY(rock) {
  return (
    groundHeight(rock.x, rock.z) +
    rock.ry * 0.55 -
    Math.abs(rock.lean) * rock.rx * 0.45
  );
}

// The drowned tree in the middle of the clearing, an older log lying along the bed, and
// a fallen branch half buried on the bar. Points are [x, y, z].
export const WOOD = [
  {
    // The snag: a drowned tree still rooted in the bed, leaning downstream and away until
    // it breaks the surface. Fish hang in its lee and its shadow cuts the sun's shafts.
    p: [
      [3.5, -0.4, -5.9],
      [5.1, 2.1, -6.8],
      [7.0, 4.9, -7.9],
      [8.9, 7.7, -9.0],
      [10.7, 10.3, -10.1],
      [11.9, 12.3, -10.8],
    ],
    r: 0.95,
    t: 0.6,
    obstacle: true,
    landmarks: true,
  },
  {
    // A limb reaching back up-current from the snag, bleached where it catches the light.
    p: [
      [6.8, 4.9, -7.8],
      [5.9, 6.7, -7.5],
      [5.2, 8.2, -7.9],
      [4.9, 9.4, -8.3],
    ],
    r: 0.3,
    t: 0.06,
    obstacle: true,
    landmarks: true,
  },
  {
    // A broken stub on the downstream side.
    p: [
      [8.8, 7.6, -9.0],
      [10.1, 8.3, -8.2],
      [10.8, 8.5, -7.7],
    ],
    r: 0.24,
    t: 0.11,
  },
  // Roots of the snag breaking out of the sand.
  { p: [[3.8, 0.3, -5.9], [2.4, 0.75, -5.3], [1.3, 0.2, -4.6]], r: 0.32, t: 0.06 },
  { p: [[3.9, 0.2, -6.1], [3.3, 0.55, -7.4], [2.8, 0.1, -8.5]], r: 0.3, t: 0.06 },
  { p: [[4.0, 0.3, -5.8], [4.9, 0.6, -4.9], [5.6, 0.1, -4.2]], r: 0.26, t: 0.05 },
  {
    // An older log lying half sunk in the sand between two beds of grass, its root plate
    // toward the middle of the clearing and its crown end out toward the meadow.
    p: [
      [-5.94, 1.12, -6.21],
      [-7.63, 1.0, -7.27],
      [-9.33, 0.93, -8.33],
      [-11.02, 0.98, -9.39],
    ],
    r: 0.66,
    t: 0.42,
    obstacle: true,
    landmarks: true,
  },
  // The log's root plate.
  { p: [[-6.11, 1.45, -6.32], [-4.8, 2.4, -6.33], [-3.65, 1.9, -6.67], [-2.9, 0.5, -6.91]], r: 0.25, t: 0.05 },
  { p: [[-6.13, 1.25, -6.09], [-5.37, 2.7, -5.03], [-5.26, 2.9, -3.9], [-5.34, 1.6, -3.01]], r: 0.24, t: 0.05 },
  { p: [[-6.07, 1.6, -6.18], [-5.57, 3.2, -5.86], [-5.71, 4.0, -5.24]], r: 0.15, t: 0.04 },
  {
    // A fallen branch half buried on the bar.
    p: [
      [3.8, 0.55, 7.2],
      [5.6, 0.62, 6.3],
      [7.6, 0.66, 5.6],
      [9.6, 0.8, 4.4],
    ],
    r: 0.2,
    t: 0.1,
  },
];

// Where moss and a green algal turf have taken hold: sheltered, lit places on the wood and
// the shoulders of the stones.
export const MOSS_COLONIES = [
  { center: [-7.8, 1.7, -7.4], radius: 1.6, strength: 0.55 },
  { center: [-9.7, 1.6, -8.5], radius: 1.4, strength: 0.45 },
  { center: [-5.9, 2.0, -6.2], radius: 1.4, strength: 0.6 },
  { center: [4.6, 1.8, -6.5], radius: 1.5, strength: 0.55 },
  { center: [6.3, 4.2, -7.5], radius: 1.1, strength: 0.4 },
  { center: [8.2, 7.0, -8.6], radius: 0.8, strength: 0.25 },
  { center: [-7.6, 2.9, -1.2], radius: 1.1, strength: 0.35 },
  { center: [7.8, 3.6, -3.4], radius: 1.2, strength: 0.3 },
  { center: [-6.9, 2.4, 4.4], radius: 1.1, strength: 0.4 },
  { center: [0.4, 2.7, -10.8], radius: 1.2, strength: 0.4 },
  { center: [3.0, 2.0, -13.0], radius: 0.9, strength: 0.3 },
];

// Ribbon grass (a Vallisneria / Sagittaria meadow). A bed is either a box in the clearing
// or a sector of a ring round it. `height` is the tallest leaf there; `detail` picks the
// mesh budget, the distant ring being cheaper.
export const MEADOWS = [
  // Beds in the clearing: upstream behind the big stone, across the current behind the
  // log, and downstream, where the leaves stream out and the bed is set further in. From
  // any side some grass frames the view and one bed at most stands in front of the tree.
  { box: [-10.4, -6.6, -5.8, -2.2], clumps: 7, height: 7.0, detail: "near" },
  { box: [-6.0, -2.4, -12.0, -8.6], clumps: 6, height: 6.6, detail: "near" },
  { box: [4.4, 7.6, -0.6, 2.8], clumps: 5, height: 5.6, detail: "near" },
  // The meadow ringing the clearing beyond the viewer's path, and patches further out.
  { ring: [27, 42], clumps: 64, height: 9.4, detail: "far" },
  { ring: [44, 62], clumps: 44, height: 7.5, detail: "haze" },
];

// The volumes of grass a fish can swim into and hide in: the clearing's four beds.
export const THICKETS = MEADOWS.filter((bed) => bed.box).map(({ box, height }) => ({
  minX: box[0],
  maxX: box[1],
  minZ: box[2],
  maxZ: box[3],
  minY: 0.8,
  maxY: Math.min(6.5, height * 0.85),
}));

// Water the tetras may use, and the open lanes they travel through: the clearing.
export const TETRA_BOUNDS = Object.freeze({
  minX: -13,
  maxX: 13,
  minY: 0.9,
  maxY: 10.75,
  minZ: -15,
  maxZ: 10,
});
export const TETRA_OPEN = Object.freeze({
  minX: -10,
  maxX: 10,
  minY: 2.2,
  maxY: 8.4,
  minZ: -11,
  maxZ: 6,
});

// The bigger fish cruise the whole run, above the viewer's eye line, out into the haze
// and back.
export const CRUISER_BOUNDS = Object.freeze({
  minX: -34,
  maxX: 34,
  minY: 4.6,
  maxY: 9.6,
  minZ: -32,
  maxZ: 26,
});

// The ray keeps to the sand of the clearing.
export const RAY_BOUNDS = Object.freeze({
  minX: -12,
  maxX: 12,
  minZ: -13,
  maxZ: 8,
});
