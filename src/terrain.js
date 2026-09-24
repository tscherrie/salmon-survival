import * as THREE from "three";
import { rockGeometry } from "../../riverscape/src/environment.js";
import { GeometryBatch, randomGenerator } from "../../riverscape/src/math.js";
import { foliageDepth, foliageMaterial } from "../../riverscape/src/foliage.js";
import { FALLS, MILLS, S, TRIBUTARIES, bedDetail, current, frame, level, passSlot, place, section, smooth, tributaryAt } from "./course.js";
import { SolidBatch, birch, pine, spruce } from "./flora.js";
import * as flora from "./flora.js";

// Every plant put into a block's batch is remembered as a piece -- its run of indices -- so
// that a block far off can draw only some of its plants (plantLod below): the weed thins out
// with distance, where the haze hides it anyway, and the nearest blocks keep every blade.
const piece =
  (fn) =>
  (batch, ...args) => {
    const start = batch.indices.length;
    const result = fn(batch, ...args);
    (batch.pieces ??= []).push(start, batch.indices.length);
    return result;
  };
const algae = piece(flora.algae),
  bankGrass = piece(flora.bankGrass),
  leafSpray = piece(flora.leafSpray),
  crowfoot = piece(flora.crowfoot),
  eelgrass = piece(flora.eelgrass),
  fallenLeaf = piece(flora.fallenLeaf),
  kelp = piece(flora.kelp),
  milfoil = piece(flora.milfoil),
  mossTuft = piece(flora.mossTuft),
  pondweed = piece(flora.pondweed),
  reeds = piece(flora.reeds),
  sedge = piece(flora.sedge),
  starwort = piece(flora.starwort),
  sugarKelp = piece(flora.sugarKelp),
  turfTuft = piece(flora.turfTuft);
// Reorders a batch's indices so that its plants come in a random order, the big ones early,
// and returns how many indices hold the first 30 % and the first 60 % of them.
const PLANT_LOD = [0.3, 0.6];
function plantLod(batch) {
  const pieces = batch.pieces ?? [];
  const src = batch.indices;
  const n = pieces.length / 2;
  const order = [];
  for (let k = 0; k < n; k++) {
    const length = pieces[2 * k + 1] - pieces[2 * k];
    const h = Math.abs(Math.sin((k + 1) * 12.9898 + pieces[2 * k] * 0.013) * 43758.5453) % 1;
    order.push([length > 600 ? h * 0.35 : h, k]);
  }
  order.sort((a, b) => a[0] - b[0]);
  const out = [];
  const marks = [];
  const covered = new Uint8Array(src.length);
  for (let i = 0; i < order.length; i++) {
    const k = order[i][1];
    for (let j = pieces[2 * k]; j < pieces[2 * k + 1]; j++) {
      out.push(src[j]);
      covered[j] = 1;
    }
    while (marks.length < PLANT_LOD.length && (i + 1) / order.length >= PLANT_LOD[marks.length]) marks.push(out.length);
  }
  while (marks.length < PLANT_LOD.length) marks.push(out.length);
  for (let j = 0; j < src.length; j++) if (!covered[j]) out.push(src[j]);
  batch.indices = out;
  return marks;
}
// How much of a block's weed to draw at a distance (from the block's edge).
function lodPlants(mesh, d) {
  const marks = mesh.userData.lod;
  if (!marks) return;
  const count = d < 45 ? Infinity : d < 90 ? marks[1] : marks[0];
  if (mesh.geometry.drawRange.count !== count) mesh.geometry.setDrawRange(0, count);
}

// The world round the fish, built a block at a time and dropped again once it is far
// behind. Blocks are laid out in river coordinates -- so many units along the river, so many
// across -- which makes them follow the bends and meet exactly; in the sea, where the course
// runs straight, the same grid is simply a grid. Each block has
//
//   the bed         a height field from the course, finer the nearer it is to the fish,
//                   with a skirt so blocks of different detail never show a crack
//   the surface     a sheet at the water's level, stepped at the falls, white where the
//                   river breaks
//   its contents    boulders and cobbles, moss and weed, drowned trunks, reeds, eelgrass
//                   and kelp; and on the land above, a plain northern forest
//
// Building is split into small steps and run a few milliseconds a frame, nearest first, so
// the river is always ready before the fish gets there and a frame never stalls.

const TAU = Math.PI * 2;
const brookSpot = {};
const PASS_STEPS = FALLS.filter((f) => f.pass);
const inPassSlot = (s, u) => PASS_STEPS.some((f) => Math.abs(s - f.s) < 9) && passSlot(s, u) > 0.05;
const BIG_FROM = 14976;
const BIG_INDEX = BIG_FROM / 32;
function blockRange(i) {
  return i < BIG_INDEX ? [i * 32, 32] : [BIG_FROM + (i - BIG_INDEX) * 64, 64];
}
function blockIndex(s) {
  return s < BIG_FROM ? Math.floor(s / 32) : BIG_INDEX + Math.floor((s - BIG_FROM) / 64);
}

export function createTerrain(scene, { bedMaterial, surfaceMaterial, rocks, detail = true } = {}) {
  const leaves = foliageMaterial();
  const leafShadow = foliageDepth({ animated: true });
  // The forest is seen from the water in a leap: lit from above and from the bright sky all
  // round, so its shade sides stay green rather than going brown.
  const treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: 0x0b1408, emissiveIntensity: 1 });

  // Shared stone shapes.
  const shapes = {
    large: Array.from({ length: 6 }, (_, i) => withMossChannel(rockGeometry(i * 3.17 + 0.4, detail ? 44 : 30, 1))),
    small: Array.from({ length: 5 }, (_, i) => withMossChannel(rockGeometry(i * 5.3 + 11.1, 18, 0.8))),
  };
  const cobble = withMossChannel(rockGeometry(37, 12, 1));

  const blocks = new Map();
  const queue = [];
  const stats = { built: 0, longest: 0, blocks: 0, byStep: {} };
  const probe = {};

  // ------------------------------------------------------------------------------------
  // The bed and surface of a block at a given cell size.
  function* buildGround(block, cell) {
    const { s0, u0, size } = block;
    const n = Math.max(2, Math.round(size / cell));
    // Rows along s, with extra rows either side of any fall's lip so the ledge is sharp.
    const rows = [];
    for (let i = 0; i <= n; i++) rows.push(s0 + (i / n) * size);
    for (const f of FALLS) {
      for (const d of [-0.04, 0.04, -1.2, 1.2]) {
        const s = f.s + d;
        if (s > s0 && s < s0 + size) rows.push(s);
      }
    }
    rows.sort((a, b) => a - b);
    const cols = [];
    for (let j = 0; j <= n; j++) cols.push(u0 + (j / n) * size);
    const R = rows.length,
      C = cols.length;
    // Heights with a one-cell border for the normals.
    const H = new Float32Array((R + 2) * (C + 2));
    const X = new Float32Array(R * C),
      Z = new Float32Array(R * C);
    const ground = new Float32Array(R * C * 4);
    const extra = new Float32Array(R * C * 3);
    const g = {};
    const at = {};
    const rowS = (i) => (i < 0 ? rows[0] - (rows[1] - rows[0]) : i >= R ? rows[R - 1] + (rows[R - 1] - rows[R - 2]) : rows[i]);
    const colU = (j) => (j < 0 ? cols[0] - (cols[1] - cols[0]) : j >= C ? cols[C - 1] + (cols[C - 1] - cols[C - 2]) : cols[j]);
    let wet = false,
      dry = false,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = -1; i <= R; i++) {
      const s = rowS(i);
      const c = section(Math.min(s, S.coast));
      const lv = level(s);
      for (let j = -1; j <= C; j++) {
        const u = colU(j);
        const inside = i >= 0 && i < R && j >= 0 && j < C;
        const y = bedDetail(s, u, inside ? g : null);
        H[(i + 1) * (C + 2) + (j + 1)] = y;
        if (!inside) continue;
        const k = i * C + j;
        place(s, u, at);
        X[k] = at.x;
        Z[k] = at.z;
        ground[k * 4] = g.gravel;
        ground[k * 4 + 1] = g.sand;
        ground[k * 4 + 2] = g.silt;
        ground[k * 4 + 3] = g.rock;
        const shore = y - lv;
        extra[k * 3] = shore;
        // Moss and green algae grow thick in the brook and thin downstream.
        extra[k * 3 + 1] = c.region.brook * 1.0 + c.region.upper * 0.8 + c.region.middle * 0.45 + c.region.lower * 0.25;
        // Broken, angular stone where the water is rough.
        extra[k * 3 + 2] = Math.min(1, c.rapid * 1.2 + c.region.brook * 0.35 + Math.max(0, c.riffle) * 0.3);
        if (shore < -0.05) wet = true;
        else dry = true;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      if (i % 6 === 5) yield "ground";
    }
    // Vertices, normals from the heights round each, and a skirt round the edge.
    const count = R * C + 2 * (R + C) - 4 + 4;
    const positions = new Float32Array((R * C + 2 * (R + C)) * 3);
    const normals = new Float32Array(positions.length);
    const grounds = new Float32Array((positions.length / 3) * 4);
    const extras = new Float32Array(positions.length);
    const tangent = {},
      normal = new THREE.Vector3();
    for (let i = 0; i < R; i++) {
      const sPrev = rowS(i - 1),
        sNext = rowS(i + 1);
      frame(rows[i], tangent);
      for (let j = 0; j < C; j++) {
        const k = i * C + j;
        const h = (ii, jj) => H[(ii + 1) * (C + 2) + (jj + 1)];
        const dyds = (h(i + 1, j) - h(i - 1, j)) / (sNext - sPrev);
        const dydu = (h(i, j + 1) - h(i, j - 1)) / (colU(j + 1) - colU(j - 1));
        // World slope: along the tangent and along the normal.
        const gx = dyds * tangent.tx + dydu * tangent.nx;
        const gz = dyds * tangent.tz + dydu * tangent.nz;
        normal.set(-gx, 1, -gz).normalize();
        positions[k * 3] = X[k];
        positions[k * 3 + 1] = h(i, j);
        positions[k * 3 + 2] = Z[k];
        normals[k * 3] = normal.x;
        normals[k * 3 + 1] = normal.y;
        normals[k * 3 + 2] = normal.z;
        for (let q = 0; q < 4; q++) grounds[k * 4 + q] = ground[k * 4 + q];
        for (let q = 0; q < 3; q++) extras[k * 3 + q] = extra[k * 3 + q];
      }
    }
    yield "normals";
    const indices = [];
    for (let i = 0; i < R - 1; i++)
      for (let j = 0; j < C - 1; j++) {
        const a = i * C + j;
        indices.push(a, a + 1, a + C, a + 1, a + C + 1, a + C);
      }
    // The skirt: the edge ring again, dropped, joined to the edge.
    const ring = [];
    for (let j = 0; j < C; j++) ring.push(j);
    for (let i = 1; i < R; i++) ring.push(i * C + C - 1);
    for (let j = C - 2; j >= 0; j--) ring.push((R - 1) * C + j);
    for (let i = R - 2; i >= 1; i--) ring.push(i * C);
    const drop = cell * 1.5 + 0.6;
    const skirtStart = R * C;
    ring.forEach((k, r) => {
      const v = skirtStart + r;
      positions[v * 3] = positions[k * 3];
      positions[v * 3 + 1] = positions[k * 3 + 1] - drop;
      positions[v * 3 + 2] = positions[k * 3 + 2];
      for (let q = 0; q < 3; q++) normals[v * 3 + q] = normals[k * 3 + q];
      for (let q = 0; q < 4; q++) grounds[v * 4 + q] = grounds[k * 4 + q];
      for (let q = 0; q < 3; q++) extras[v * 3 + q] = extras[k * 3 + q];
    });
    for (let r = 0; r < ring.length; r++) {
      const a = ring[r],
        b = ring[(r + 1) % ring.length];
      const a2 = skirtStart + r,
        b2 = skirtStart + ((r + 1) % ring.length);
      indices.push(a, a2, b, b, a2, b2);
      indices.push(a, b, a2, b, b2, a2);
    }
    const used = (skirtStart + ring.length) * 3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions.subarray(0, used), 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals.subarray(0, used), 3));
    geometry.setAttribute("ground", new THREE.BufferAttribute(grounds.subarray(0, (used / 3) * 4), 4));
    geometry.setAttribute("bedExtra", new THREE.BufferAttribute(extras.subarray(0, used), 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    void count;
    const bedMesh = new THREE.Mesh(geometry, bedMaterial);
    bedMesh.receiveShadow = true;
    bedMesh.castShadow = cell <= 1.01;
    bedMesh.name = `Bed ${block.key}`;
    bedMesh.matrixAutoUpdate = false;
    yield "bed";

    // The surface, only where there is water.
    let surfaceMesh = null;
    if (wet) {
      const sRows = [];
      const step = Math.max(1, Math.min(4, cell * 2));
      const m = Math.max(1, Math.round(size / step));
      for (let i = 0; i <= m; i++) sRows.push(s0 + (i / m) * size);
      const steps = [];
      for (const f of FALLS) {
        if (f.head) continue;
        if (f.s - 0.05 > s0 && f.s + 0.05 < s0 + size) {
          sRows.push(f.s - 0.05, f.s + 0.05);
          steps.push(f.s);
        }
      }
      sRows.sort((a, b) => a - b);
      const sc = Math.max(1, Math.round(size / Math.max(4, cell * 4)));
      const sCols = [];
      for (let j = 0; j <= sc; j++) sCols.push(u0 + (j / sc) * size);
      const sp = [],
        foam = [],
        flow = [],
        si = [];
      const wetAt = [];
      const cur = {};
      for (let i = 0; i < sRows.length; i++) {
        const s = sRows[i];
        const lv = level(s);
        const c = section(Math.min(s, S.coast));
        const f = c.fall;
        for (let j = 0; j < sCols.length; j++) {
          const u = sCols[j];
          place(s, u, at);
          sp.push(at.x, lv, at.z);
          // White water: rapids, the lip of a fall and the churned pool below it.
          const small = 1 - smooth(500, 900, s);
          let white = c.rapid * 0.9 + Math.max(0, c.riffle) * (0.12 + 0.3 * small) * c.region.brook + small * 0.12;
          if (f && !f.head) {
            const d = s - f.s;
            if (d > 0 && d < f.poolLength) white = Math.max(white, (1 - smooth(0, f.poolLength * 0.7, d)) * Math.min(1, 0.4 + f.drop / 10));
            if (d < 0 && d > -5) white = Math.max(white, 0.35 * smooth(-5, 0, d));
            // The fish pass's slot: a tongue of white water through each step.
            if (f.pass && Math.abs(d) < 6) white = Math.max(white, passSlot(s, u, c) * (1 - smooth(1, 6, Math.abs(d))));
          }
          if (s < 14) white = Math.max(white, 1 - smooth(4, 14, s));
          // Under a side brook's fall.
          const tb = tributaryAt(s, u, brookSpot);
          if (tb && tb.t > 0.7) white = Math.max(white, smooth(0.7, 0.96, tb.t) * (1 - smooth(0.6, 1.3, Math.abs(tb.d) / tb.w)) * 0.9);
          foam.push(Math.min(1, white));
          current(s, u, lv - 0.2, cur);
          flow.push(cur.vx, cur.vz);
          const floor = bedDetail(s, u, null);
          wetAt.push(floor < lv + 0.4);
        }
      }
      const W = sCols.length;
      for (let i = 0; i < sRows.length - 1; i++) {
        const mid = (sRows[i] + sRows[i + 1]) / 2;
        if (steps.some((fs) => Math.abs(mid - fs) < 0.06)) continue;
        for (let j = 0; j < W - 1; j++) {
          const a = i * W + j;
          if (!(wetAt[a] || wetAt[a + 1] || wetAt[a + W] || wetAt[a + W + 1])) continue;
          si.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
        }
      }
      if (si.length) {
        const sg = new THREE.BufferGeometry();
        sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
        sg.setAttribute("foam", new THREE.Float32BufferAttribute(foam, 1));
        sg.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 2));
        sg.setIndex(si);
        sg.computeBoundingSphere();
        surfaceMesh = new THREE.Mesh(sg, surfaceMaterial);
        surfaceMesh.name = `Surface ${block.key}`;
        surfaceMesh.matrixAutoUpdate = false;
      }
    }
    yield "surface";
    return { bedMesh, surfaceMesh, wet, dry, minY, maxY };
  }

  // ------------------------------------------------------------------------------------
  // Everything that stands on the bed, built once per block.
  function* buildContent(block) {
    const { s0, u0, size } = block;
    const random = randomGenerator(19937 + block.i * 7919 + block.j * 104729);
    const range = (a, b) => a + (b - a) * random();
    const group = new THREE.Group();
    group.name = `Contents ${block.key}`;
    const colliders = [];
    const cover = [];
    const area = size * size;
    const mid = section(Math.min(s0 + size / 2, S.coast));
    const r = mid.region;
    const g = {};
    const at = {};
    const flowAngle = (s) => {
      frame(s, at);
      return Math.atan2(at.tz, at.tx);
    };
    const pick = () => {
      const s = s0 + random() * size,
        u = u0 + random() * size;
      const y = bedDetail(s, u, g);
      const lv = level(s);
      place(s, u, at);
      return { s, u, x: at.x, z: at.z, y, level: lv, depth: lv - y, ground: { ...g } };
    };
    // A point in the water: the plants are sown where the river runs, not on the land.
    const pickWet = () => {
      for (let t = 0; t < 4; t++) {
        const s = s0 + random() * size;
        if (s >= S.straight) break;
        const c = section(Math.min(s, S.coast));
        const lo = Math.max(u0, c.thalweg - c.half * 1.05),
          hi = Math.min(u0 + size, c.thalweg + c.half * 1.05);
        if (hi <= lo) continue;
        const u = lo + random() * (hi - lo);
        const y = bedDetail(s, u, g);
        const lv = level(s);
        place(s, u, at);
        return { s, u, x: at.x, z: at.z, y, level: lv, depth: lv - y, ground: { ...g } };
      }
      return pick();
    };
    // How much of the block is river, for sowing by the water's area.
    let wetShare = 1;
    if (s0 < S.straight) {
      const c = section(Math.min(s0 + size / 2, S.coast));
      wetShare = Math.max(0, Math.min(u0 + size, c.thalweg + c.half) - Math.max(u0, c.thalweg - c.half)) / size;
    }
    // Where a stone of this radius comes to rest: on the lowest of the ground round it, so
    // on a slope it sits into the bank rather than hanging off its downhill side. Also how
    // steep the ground is there.
    const seat = (p, radius) => {
      const a = bedDetail(p.s + radius, p.u, null),
        b = bedDetail(p.s - radius, p.u, null),
        c = bedDetail(p.s, p.u + radius, null),
        d = bedDetail(p.s, p.u - radius, null);
      return { y: Math.min(p.y, a, b, c, d), slope: Math.max(Math.abs(a - b), Math.abs(c - d)) / (2 * radius) };
    };
    const poisson = (mean) => {
      let k = 0,
        p = Math.exp(-mean),
        sum = p;
      const x = random();
      while (x > sum && k < 200) {
        k++;
        p *= mean / k;
        sum += p;
      }
      return k;
    };

    // Boulders.
    const stones = { brook: new SolidBatch(), river: new SolidBatch(), sea: new SolidBatch() };
    const kind = r.sea + r.estuary * 0.5 > 0.5 ? "sea" : r.brook + r.upper > 0.5 ? "brook" : "river";
    const moss = r.brook * 1 + r.upper * 0.7 + r.middle * 0.35 + r.lower * 0.2 + (r.sea + r.estuary) * 0.3;
    const density = r.brook * 9 + r.upper * 5 + r.middle * 1.4 + r.lower * 0.3 + r.estuary * 0.15 + r.sea * 0.8;
    const boulderCount = poisson((area / 1000) * density);
    const batch = new GeometryBatch();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const tops = [];
    for (let k = 0; k < boulderCount; k++) {
      const p = pick();
      const rocky = p.ground.rock;
      if (p.depth < -3 && random() > 0.15) continue;
      const scaleBase = r.brook * range(0.6, 5) + r.upper * range(1.2, 10) + r.middle * range(1.5, 9) + r.lower * range(1.5, 7) + (r.sea + r.estuary) * range(2.5, 22);
      // Never so big it closes the channel: a stone at most a third of the river's width.
      const channel = section(Math.min(p.s, S.coast));
      if (p.s > 60 && p.s < 120 && Math.abs(p.u - channel.thalweg) < channel.half * 1.1) continue;
      // Nothing may block a slot of the fish pass.
      if (inPassSlot(p.s, p.u)) continue;
      const size = Math.min(channel.width * 0.17, Math.max(0.5, scaleBase * (0.5 + random() * random()) * (1 + rocky * 0.6)));
      const rx = size * range(0.8, 1.3),
        ry = size * range(0.5, 0.85),
        rz = size * range(0.8, 1.2);
      const shape = size > 2.5 ? shapes.large[Math.floor(random() * shapes.large.length)] : shapes.small[Math.floor(random() * shapes.small.length)];
      euler.set(range(-0.2, 0.2), range(0, TAU), range(-0.2, 0.2));
      quaternion.setFromEuler(euler);
      const rest = seat(p, Math.max(rx, rz) * 0.7);
      const cy = rest.y + ry * range(0.1, 0.4);
      matrix.compose(new THREE.Vector3(p.x, cy, p.z), quaternion, new THREE.Vector3(rx, ry, rz));
      const bright = range(0.75, 1.1);
      stones[kind].add(shape, matrix, new THREE.Color(bright, moss * range(0.6, 1.1), 0), (q, nrm, i) => shape.attributes.color.getX(i));
      // The collider is the stone's own ellipsoid, turned as the stone is turned, a shade
      // larger than its middle so the knobbly surface is inside it.
      colliders.push({ x: p.x, y: cy, z: p.z, r: Math.max(rx, rz) * 1.05, rx: rx * 1.05, rz: rz * 1.05, ry: ry * 1.05, cos: Math.cos(euler.y), sin: Math.sin(euler.y), s: p.s, u: p.u });
      // Moss and algae on the stones: nearly every one in the brook, more of them the
      // further up the river.
      const overgrown = kind === "brook" ? 0.92 : kind === "river" ? 0.2 + 0.7 * moss : 0;
      if (p.depth > 0.6 && random() < overgrown) tops.push({ x: p.x, y: cy + ry * 0.85, z: p.z, cy, r: Math.min(rx, rz), ry, s: p.s, level: p.level });
      if (k % 3 === 2) yield "boulders";
    }
    for (const [name, b] of Object.entries(stones)) {
      if (b.empty) continue;
      const mesh = new THREE.Mesh(b.geometry(), rocks[name]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `Boulders ${name}`;
      group.add(mesh);
    }
    yield "boulders";

    // Cobbles scattered over gravel.
    {
      const want = Math.floor((area / 1000) * (r.brook * 70 + r.upper * 45 + r.middle * 18 + r.lower * 3 + r.sea * 4 + r.estuary * 2));
      if (want > 0) {
        const mesh = new THREE.InstancedMesh(cobble, rocks[kind], want);
        const object = new THREE.Object3D();
        const color = new THREE.Color();
        let used = 0;
        for (let k = 0; k < want; k++) {
          const p = pick();
          if (p.depth < -0.5 || p.ground.gravel + p.ground.rock < 0.25 || inPassSlot(p.s, p.u)) continue;
          const size = 0.15 + (r.brook * 0.9 + r.upper * 1.4 + r.middle * 1.1 + (r.sea + r.lower + r.estuary) * 1.6) * random() ** 2.2;
          const rest = seat(p, size * 0.8);
          // Cobbles do not stay on steep banks; the current has rolled them down.
          if (rest.slope > 0.7) continue;
          object.position.set(p.x, rest.y + size * 0.12, p.z);
          object.scale.set(size * range(0.9, 1.4), size * range(0.45, 0.75), size * range(0.8, 1.1));
          object.rotation.set(range(-0.25, 0.25), range(0, TAU), range(-0.25, 0.25));
          object.updateMatrix();
          const { x: sx, y: sy, z: sz } = object.scale;
          colliders.push({ x: p.x, y: object.position.y, z: p.z, r: Math.max(sx, sz) * 1.05, rx: sx * 1.05, rz: sz * 1.05, ry: sy * 1.05, cos: Math.cos(object.rotation.y), sin: Math.sin(object.rotation.y), s: p.s, u: p.u });
          mesh.setMatrixAt(used, object.matrix);
          // The bigger cobbles in the brook and upper river carry a tuft of moss.
          if (size > 0.45 && p.depth > 0.4 && random() < moss * 0.45) tops.push({ x: p.x, y: object.position.y + sy * 0.8, z: p.z, cy: object.position.y, r: Math.min(sx, sz), ry: sy, s: p.s, level: p.level, small: true });
          color.setRGB(range(0.65, 1.15), moss * range(0.3, 1), 1);
          mesh.setColorAt(used, color);
          used++;
        }
        mesh.count = used;
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.name = "Cobbles";
        if (used) group.add(mesh);
      }
    }
    yield "cobbles";

    // A drowned trunk now and then, in the brook and the river.
    if (random() < (r.brook + r.upper) * 0.3 + r.middle * 0.25 + r.lower * 0.3 + r.estuary * 0.1) {
      const p = pick();
      if (p.depth > 2) {
        const a = flowAngle(p.s) + range(-1.2, 1.2);
        const length = range(20, 60) * (0.5 + r.upper + r.middle);
        const points = [];
        for (let k = 0; k < 4; k++) {
          const t = k / 3;
          const x = p.x + Math.cos(a) * length * (t - 0.5),
            z = p.z + Math.sin(a) * length * (t - 0.5);
          const probeS = p.s + (t - 0.5) * length * 0.8;
          const floor = bedDetail(probeS, p.u, null);
          points.push(new THREE.Vector3(x, Math.min(level(probeS) - 0.8, floor + range(0.6, 2.2)), z));
        }
        const radius = range(0.7, 1.6) * (0.6 + 0.6 * (r.upper + r.middle));
        const geometry = trunkGeometry(points, radius, radius * 0.6, block.i * 1.7 + block.j);
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        for (let k = 0; k < colors.length; k += 3) {
          colors[k] = range(0.55, 0.8);
          colors[k + 1] = 0.9;
          colors[k + 2] = 0;
        }
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const mesh = new THREE.Mesh(geometry, rocks.wood);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.name = "Drowned trunk";
        group.add(mesh);
        for (const q of points) colliders.push({ x: q.x, y: q.y, z: q.z, r: radius * 1.2, ry: radius * 1.2, s: p.s, u: p.u });
        cover.push({ x: p.x, z: p.z, radius: length * 0.45, top: p.y + 4 });
      }
    }
    yield "trunk";

    // Plants.
    const plants = new GeometryBatch();
    for (let n = 0; n < tops.length; n++) {
      const top = tops[n];
      if (n % 6 === 5) yield "moss";
      const flow = flowAngle(top.s);
      const cs = section(Math.min(top.s, S.coast));
      const riffle = cs.speed > 2.6 || cs.riffle > 0.2;
      // Over the crown and down the flanks; in fast water, green threads streaming off it.
      const tufts = top.small ? 1 : Math.floor(range(3, 5 + Math.min(5, top.r * 1.5)));
      for (let t = 0; t < tufts; t++) {
        const a = range(0, TAU);
        const h = t === 0 ? 1 : range(0.25, 0.95);
        const out = top.r * (0.25 + 0.6 * Math.sqrt(1 - h * h));
        const q = new THREE.Vector3(top.x + Math.cos(a) * out, top.cy + top.ry * 0.85 * h, top.z + Math.sin(a) * out);
        if (q.y > top.level - 0.25) continue;
        if (riffle && random() < 0.45) algae(plants, q, flow, random, 0.7 + top.r * 0.25);
        else mossTuft(plants, q, flow, random, 0.8 + top.r * 0.35);
      }
    }
    yield "moss";
    const marine = r.sea + r.estuary * 0.5 > 0.5;
    const clumps = marine
      ? poisson((area / 1000) * (r.estuary * 8 + r.sea * 6))
      : poisson((area / 1000) * wetShare * (r.brook * 22 + r.upper * 18 + r.middle * 14 + r.lower * 11 + r.estuary * 8));
    for (let k = 0; k < clumps; k++) {
      const p = marine ? pick() : pickWet();
      if (p.depth < 0.6) continue;
      const flow = flowAngle(p.s);
      const c = section(Math.min(p.s, S.coast));
      const margin = Math.abs(p.u - c.thalweg) / c.half;
      const fast = c.speed > 3.2 || c.riffle > 0.25;
      const roll = random();
      const sea = r.sea + r.estuary * 0.5;
      if (sea > 0.5) {
        if (p.ground.rock > 0.35 && p.depth < 90) {
          if (roll < 0.7) kelp(plants, p.x, p.z, p.y, p.level, flow, random, 1);
          else sugarKelp(plants, p.x, p.z, p.y, p.level, flow, random, 1);
          cover.push({ x: p.x, z: p.z, radius: 6, top: p.y + 14 });
        } else if (p.depth < 40 && p.ground.sand > 0.4) {
          for (let e = 0; e < 8; e++) eelgrass(plants, p.x + range(-5, 5), p.z + range(-5, 5), p.y, p.level, flow, random, 1);
          cover.push({ x: p.x, z: p.z, radius: 6, top: p.y + 5 });
        }
      } else if (r.estuary > 0.4) {
        if (margin > 0.8 && p.depth < 8) reeds(plants, p.x, p.z, p.y, p.level, random, 1.2);
        else if (p.depth < 30) for (let e = 0; e < 6; e++) eelgrass(plants, p.x + range(-4, 4), p.z + range(-4, 4), p.y, p.level, flow, random, 0.9);
        cover.push({ x: p.x, z: p.z, radius: 5, top: p.y + 6 });
      } else {
        // The river's own garden: what grows depends on how fast the water runs and how
        // deep it is. Crowfoot and green algae where it runs; starwort, milfoil and, in the
        // bigger river, pondweed where it is slack.
        const big = r.middle + r.lower;
        if (margin > 0.78 && p.depth < 3) {
          if (big > 0.5 && roll < 0.6) reeds(plants, p.x, p.z, p.y, p.level, random, 1);
          else sedge(plants, p.x, p.z, p.y, p.level, random, 0.6 + 0.6 * (r.upper + r.middle));
          cover.push({ x: p.x, z: p.z, radius: 3, top: p.level });
        } else if (fast && p.depth > 2.5 && r.brook < 0.6 && roll < 0.8) {
          crowfoot(plants, p.x, p.z, p.y, p.level, flow, random, 0.7 + 0.5 * big);
          cover.push({ x: p.x, z: p.z, radius: 5, top: p.y + Math.min(p.depth, 8) });
        } else if (fast) {
          // A patch of stones furred with moss and streaming threads.
          const size = 0.8 + 0.6 * (r.upper + big);
          for (let e = 0; e < 3; e++) {
            const q = new THREE.Vector3(p.x + range(-1, 1) * size, p.y + 0.04, p.z + range(-1, 1) * size);
            if (random() < 0.55) algae(plants, q, flow, random, size);
            else mossTuft(plants, q, flow, random, size * 1.1);
          }
        } else if (p.depth > 2 && big > 0.3 && roll < 0.4) {
          pondweed(plants, p.x, p.z, p.y, p.level, flow, random, 0.6 + 0.6 * (r.upper + big));
          cover.push({ x: p.x, z: p.z, radius: 3, top: p.y + Math.min(p.depth, 10) });
        } else if (p.depth > 1.4 && roll < 0.7) {
          milfoil(plants, p.x, p.z, p.y, p.level, flow, random, 0.8 + 0.5 * (r.upper + big));
          cover.push({ x: p.x, z: p.z, radius: 2, top: p.y + Math.min(p.depth, 6) });
        } else {
          starwort(plants, p.x, p.z, p.y, p.level, flow, random, 0.8 + 0.5 * (r.upper + big));
          cover.push({ x: p.x, z: p.z, radius: 1.8, top: p.y + Math.min(p.depth, 4) });
        }
      }
      yield "plants";
    }
    // Low turf over the gravel: patches of bulbous rush and moss cushions.
    if (r.sea + r.estuary < 0.5) {
      const patches = poisson((area / 1000) * wetShare * (r.brook * 22 + r.upper * 24 + r.middle * 10 + r.lower * 4));
      const turfScale = 0.8 + 0.8 * (r.middle + r.lower);
      for (let k = 0; k < patches; k++) {
        const p = pickWet();
        if (p.depth < 0.25 || p.ground.silt > 0.6) continue;
        const flow = flowAngle(p.s);
        const radius = range(0.8, 2.6) * (1 + 0.3 * r.upper + r.middle + r.lower);
        const hue = random() < 0.5 ? range(0.15, 0.18) : range(0.22, 0.26);
        const n = Math.min(48, Math.floor(radius * radius * 5 + 4));
        for (let i = 0; i < n; i++) {
          const a = range(0, TAU),
            rr = radius * Math.sqrt(random());
          const ts = p.s + Math.cos(a) * rr,
            tu = p.u + Math.sin(a) * rr;
          if (tu < u0 || tu > u0 + size) continue;
          const y = bedDetail(ts, tu, null);
          if (level(ts) - y < 0.2) continue;
          place(ts, tu, at);
          turfTuft(plants, at.x, at.z, y, flow, random, turfScale * range(0.7, 1.2), hue);
        }
        yield "turf";
      }
      // Leaves the trees have dropped, lying where the water is quiet enough to let them.
      const leafCount = poisson((area / 1000) * wetShare * (r.brook * 110 + r.upper * 60 + r.middle * 20 + r.lower * 8));
      for (let k = 0; k < leafCount; k++) {
        const p = pickWet();
        if (p.depth < 0.15) continue;
        const cs = section(Math.min(p.s, S.coast));
        if ((cs.speed > 3 || cs.riffle > 0.3) && random() < 0.75) continue;
        fallenLeaf(plants, p.x, p.z, p.y, random, 1 + 0.5 * (r.middle + r.lower));
        if (k % 25 === 24) yield "leaves";
      }
      // Grass and sedge from both banks, hanging into the water.
      const banks = r.brook + r.upper * 0.9 + r.middle * 0.7 + r.lower * 0.5;
      const bankScale = 0.7 + 0.5 * (r.upper + r.middle + r.lower);
      const bankTufts = Math.floor(banks * (size / 1.3));
      for (let k = 0; k < bankTufts * 2; k++) {
        const s = s0 + random() * size;
        const cs = section(s);
        const side = k % 2 ? 1 : -1;
        const rough = cs.thalweg + side * cs.half;
        if (rough < u0 - cs.half * 0.6 - 4 || rough > u0 + size + cs.half * 0.6 + 4) continue;
        const lv = level(s);
        let edge = cs.half;
        const stepE = Math.max(0.2, cs.half * 0.03);
        for (let e = cs.half * 0.6; e < cs.half * 1.6; e += stepE)
          if (bedDetail(s, cs.thalweg + side * e, null) > lv - 0.05) {
            edge = e;
            break;
          }
        const u = cs.thalweg + side * (edge + range(0.05, 0.9));
        if (u < u0 || u > u0 + size) continue;
        const y = bedDetail(s, u, null);
        if (y < lv - 0.3 || y > lv + 3) continue;
        place(s, u, at);
        const out = new THREE.Vector3(-side * at.nx, 0, -side * at.nz);
        bankGrass(plants, at.x, at.z, y, lv, out, flowAngle(s), random, bankScale * range(0.7, 1.3));
        cover.push({ x: at.x - side * at.nx, z: at.z - side * at.nz, radius: 1.8 * bankScale, top: lv });
        if (k % 8 === 7) yield "banks";
      }
      // Alder and willow branches reaching out over the water from the bank, the leafy
      // ends hanging into it: from under the surface, the forest leaning in.
      const branches = poisson(((r.brook + r.upper * 0.7 + r.middle * 0.35) * size) / 22);
      const wood = [];
      for (let k = 0; k < branches; k++) {
        const s = s0 + range(2, size - 2);
        const cs = section(s);
        const side = random() < 0.5 ? -1 : 1;
        const lv = level(s);
        let edge = cs.half;
        const stepE = Math.max(0.2, cs.half * 0.03);
        for (let e = cs.half * 0.6; e < cs.half * 1.6; e += stepE)
          if (bedDetail(s, cs.thalweg + side * e, null) > lv - 0.05) {
            edge = e;
            break;
          }
        const uBank = cs.thalweg + side * (edge + range(0.5, 2));
        if (uBank < u0 - 2 || uBank > u0 + size + 2) continue;
        const scale = 0.8 + 0.8 * (r.upper + r.middle);
        const reach = range(3, 8) * scale;
        const rise = range(1.2, 3.5) * scale;
        const points = [];
        for (let t = 0; t <= 4; t++) {
          const f = t / 4;
          const uu = uBank - side * reach * f;
          const ss = s + range(-0.3, 0.3) * f + reach * 0.25 * f * f;
          place(ss, uu, at);
          // Up from the bank, then bowing down until the tip trails in the water.
          const y = Math.max(bedDetail(ss, uu, null) + 0.2, lv + rise * Math.sin(Math.PI * (0.25 + 0.6 * f)) * (1 - f) - 0.35 * f * f);
          points.push(new THREE.Vector3(at.x, y, at.z));
        }
        const radius = range(0.07, 0.16) * scale;
        wood.push(trunkGeometry(points, radius, radius * 0.3, block.i * 5.3 + k * 1.7));
        const curve = new THREE.CatmullRomCurve3(points);
        const sprays = Math.floor(range(6, 11));
        for (let q = 0; q < sprays; q++) {
          const t = range(0.5, 1);
          leafSpray(plants, curve.getPoint(t), random, scale * range(0.8, 1.2));
        }
        cover.push({ x: points[3].x, z: points[3].z, radius: 2.5 * scale, top: lv });
        yield "branches";
      }
      for (const geometry of wood) {
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        for (let v = 0; v < colors.length; v += 3) {
          colors[v] = 0.55;
          colors[v + 1] = 0.4;
          colors[v + 2] = 0;
        }
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const mesh = new THREE.Mesh(geometry, rocks.wood);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.name = "Branch";
        group.add(mesh);
      }
    }
    // The little brook at the spring: close and overgrown. Sedge and grass hang in from both
    // banks, roots reach out of the undercut earth, twigs lie in the water.
    const small = 1 - smooth(500, 900, s0 + size / 2);
    if (small > 0 && r.sea < 0.1) {
      const c = section(s0 + size / 2);
      const tufts = Math.floor(small * (area / 1000) * 26);
      for (let k = 0; k < tufts; k++) {
        const s = s0 + random() * size;
        const cs = section(s);
        const side = random() < 0.5 ? -1 : 1;
        // Find the water's edge on this side and stand the tuft on it.
        let edge = cs.half;
        for (let e = cs.half * 0.6; e < cs.half * 1.6; e += 0.2)
          if (bedDetail(s, cs.thalweg + side * e, null) > level(s) - 0.4) {
            edge = e;
            break;
          }
        const u = cs.thalweg + side * (edge + range(-0.8, 0.6));
        if (u < u0 || u > u0 + size) continue;
        place(s, u, at);
        const y = bedDetail(s, u, null);
        sedge(plants, at.x, at.z, y, level(s), random, range(0.5, 1.1));
        cover.push({ x: at.x, z: at.z, radius: 2.2, top: level(s) });
      }
      // Roots out of the bank.
      const tubes = [];
      const clusters = Math.floor(small * range(1, 4));
      for (let k = 0; k < clusters; k++) {
        const s = s0 + range(2, size - 2);
        const cs = section(s);
        const side = random() < 0.5 ? -1 : 1;
        const edgeU = cs.thalweg + side * cs.half * 0.95;
        if (edgeU < u0 - 4 || edgeU > u0 + size + 4) continue;
        const roots = Math.floor(range(4, 9));
        for (let q = 0; q < roots; q++) {
          const ss = s + range(-1.5, 1.5);
          const lv = level(ss);
          const reach = range(1, 3.5);
          const drop = range(1.5, 4.5);
          const points = [];
          for (let t = 0; t <= 4; t++) {
            const f = t / 4;
            const uu = edgeU - side * reach * f * (0.6 + 0.4 * f);
            place(ss + range(-0.2, 0.2) * f, uu, at);
            points.push(new THREE.Vector3(at.x, Math.max(bedDetail(ss, uu, null) + 0.08, lv + 0.6 - drop * f * f), at.z));
          }
          tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 14, range(0.03, 0.11), 5, false));
        }
        yield "roots";
      }
      if (tubes.length) {
        const merged = mergeTubes(tubes);
        const mesh = new THREE.Mesh(merged, rocks.wood);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.name = "Roots";
        group.add(mesh);
      }
      // Twigs and small branches on the bed.
      const twigs = Math.floor(small * range(1, 5));
      for (let k = 0; k < twigs; k++) {
        const p = pick();
        if (p.depth < 0.5) continue;
        const a = range(0, TAU);
        const length = range(2, 7);
        const points = [0, 1, 2].map((q) => {
          const t = q / 2 - 0.5;
          return new THREE.Vector3(p.x + Math.cos(a) * length * t, p.y + 0.12 + Math.abs(t) * range(0, 0.4), p.z + Math.sin(a) * length * t);
        });
        const radius = range(0.05, 0.16);
        const geometry = trunkGeometry(points, radius, radius * 0.5, block.i * 3.1 + k);
        const colors = new Float32Array(geometry.attributes.position.count * 3).fill(0.6);
        for (let v = 1; v < colors.length; v += 3) colors[v] = 0.8;
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const mesh = new THREE.Mesh(geometry, rocks.wood);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.name = "Twig";
        group.add(mesh);
      }
      void c;
    }
    let plantMesh = null;
    if (plants.positions.length) {
      const lod = plantLod(plants);
      const geometry = plants.geometry();
      // Culled like anything else, with room for the sway: a block's weed behind the
      // camera, or outside the sun's shadow box, is not drawn at all.
      geometry.computeBoundingSphere();
      geometry.boundingSphere.radius += 8;
      const mesh = new THREE.Mesh(geometry, leaves);
      mesh.customDepthMaterial = leafShadow;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = "Plants";
      mesh.userData.lod = lod;
      plantMesh = mesh;
      group.add(mesh);
    }
    yield "plants";

    // The forest on the land either side.
    if (r.sea < 0.5) {
      const trees = new SolidBatch();
      const want = Math.floor((area / 1000) * (r.brook * 5 + r.upper * 3.5 + r.middle * 2.2 + r.lower * 1.5 + r.estuary * 0.6));
      for (let k = 0; k < want; k++) {
        const p = pick();
        if (p.y < p.level + 1.5) continue;
        const h = range(60, 150) * (0.8 + 0.3 * r.brook);
        const which = random();
        if (which < 0.55) spruce(trees, p.x, p.y, p.z, h, random);
        else if (which < 0.8) pine(trees, p.x, p.y, p.z, h, random);
        else birch(trees, p.x, p.y, p.z, h * 0.7, random);
        if (k % 4 === 3) yield "forest";
      }
      if (!trees.empty) {
        const mesh = new THREE.Mesh(trees.geometry(), treeMaterial);
        mesh.name = "Forest";
        group.add(mesh);
      }
    }
    yield "forest";

    group.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    group.updateMatrixWorld(true);
    return { group, colliders, cover, plants: plantMesh };
  }

  // ------------------------------------------------------------------------------------
  function* buildBlock(block, cell) {
    if (!block.content) {
      const content = yield* buildContent(block);
      block.content = content;
      scene.add(content.group);
    }
    const ground = yield* buildGround(block, cell);
    if (block.bedMesh) {
      scene.remove(block.bedMesh);
      block.bedMesh.geometry.dispose();
    }
    if (block.surfaceMesh) {
      scene.remove(block.surfaceMesh);
      block.surfaceMesh.geometry.dispose();
    }
    block.bedMesh = ground.bedMesh;
    block.surfaceMesh = ground.surfaceMesh;
    block.wet = ground.wet;
    block.cell = cell;
    block.bedMesh.updateMatrixWorld();
    scene.add(block.bedMesh);
    if (block.surfaceMesh) {
      block.surfaceMesh.updateMatrixWorld();
      scene.add(block.surfaceMesh);
    }
    block.ready = true;
    stats.built++;
  }

  function release(block) {
    for (const mesh of [block.bedMesh, block.surfaceMesh]) {
      if (!mesh) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    if (block.content) {
      scene.remove(block.content.group);
      block.content.group.traverse((o) => {
        if (o.geometry && !isShared(o.geometry)) o.geometry.dispose();
      });
    }
  }
  const isShared = (geometry) => geometry === cobble || shapes.large.includes(geometry) || shapes.small.includes(geometry);

  // The cell size a block should be built at, from its distance to the viewer.
  function cellFor(distance, size, near) {
    if (distance < 34) return Math.max(near, size > 32 ? 1 : near);
    if (distance < 80) return size > 32 ? 2 : 1;
    if (distance < 150) return size > 32 ? 4 : 2;
    return 4;
  }

  const centre = {};
  return {
    blocks,
    stats,
    // Keep the blocks within `radius` of the viewer built; `near` is the finest cell.
    update(viewer, { radius = 140, near = 0.5, budget = 5, land = 60 } = {}) {
      const want = new Map();
      const sLo = viewer.s - radius,
        sHi = viewer.s + radius;
      for (let i = blockIndex(Math.max(-190, sLo)); i <= blockIndex(sHi); i++) {
        const [s0, size] = blockRange(i);
        const sMid = s0 + size / 2;
        let uLo, uHi;
        if (s0 >= S.straight) {
          uLo = viewer.u - radius;
          uHi = viewer.u + radius;
        } else {
          const c = section(Math.min(sMid, S.coast));
          const reach = c.half + Math.abs(c.thalweg) + land;
          uLo = Math.max(-reach, viewer.u - radius);
          uHi = Math.min(reach, viewer.u + radius);
        }
        for (let j = Math.floor(uLo / size); j <= Math.floor(uHi / size); j++) {
          const u0 = j * size;
          place(sMid, u0 + size / 2, centre);
          const d = Math.hypot(centre.x - viewer.x, centre.z - viewer.z) - size * 0.5;
          if (d > radius) continue;
          // Land far from the water is kept only close by.
          if (s0 < S.straight) {
            const c = section(Math.min(sMid, S.coast));
            let beyond = Math.max(0, Math.abs(u0 + size / 2 - c.thalweg) - size * 0.7 - c.half);
            // A side brook's channel is water, seen from as far as the river is.
            for (const b of TRIBUTARIES)
              if (Math.abs(sMid - b.s) < size + Math.abs(b.drift) && Math.sign(u0 + size / 2) === b.side && Math.abs(u0 + size / 2) < c.half + b.length + size) beyond = 0;
            // So is a mill race.
            for (const m of MILLS)
              if (sMid > m.from - size && sMid < m.to + size && Math.abs(u0 + size / 2 - (c.thalweg + m.side * (c.half + m.offset))) < size) beyond = 0;
            if (beyond > 0 && d > land) continue;
          }
          want.set(`${i}|${j}`, { i, j, s0, u0, size, cell: cellFor(Math.max(0, d), size, near), d });
        }
      }
      for (const [key, w] of want) {
        let block = blocks.get(key);
        if (!block) {
          block = { key, i: w.i, j: w.j, s0: w.s0, u0: w.u0, size: w.size, ready: false, job: null, cell: 0 };
          blocks.set(key, block);
        }
        block.distance = w.d;
        if (block.content?.plants) lodPlants(block.content.plants, w.d);
        if (!block.job && block.cell !== w.cell) {
          // Only rebuild for detail when the change is worth it.
          if (!block.ready || w.cell < block.cell || w.cell > block.cell * 1.9) {
            block.job = { steps: buildBlock(block, w.cell), cell: w.cell };
            queue.push(block);
          }
        }
      }
      for (const [key, block] of blocks)
        if (!want.has(key) && (block.distance ?? 0) > -1) {
          const [s0, size] = blockRange(block.i);
          place(s0 + size / 2, block.u0 + size / 2, centre);
          const d = Math.hypot(centre.x - viewer.x, centre.z - viewer.z) - size * 0.5;
          if (d > radius + 40) {
            release(block);
            const q = queue.indexOf(block);
            if (q >= 0) queue.splice(q, 1);
            blocks.delete(key);
          }
        }
      queue.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
      const start = performance.now();
      while (queue.length && performance.now() - start < budget) {
        const block = queue[0];
        const before = performance.now();
        const step = block.job.steps.next();
        const took = performance.now() - before;
        stats.longest = Math.max(stats.longest, took);
        const label = step.done ? "done" : step.value;
        stats.byStep[label] = Math.max(stats.byStep[label] ?? 0, took);
        if (step.done) {
          block.job = null;
          queue.shift();
        }
      }
      stats.blocks = blocks.size;
      stats.pending = queue.length;
    },
    // Build everything round the viewer now.
    prime(viewer, options) {
      this.update(viewer, { ...options, budget: Infinity });
    },
    get pending() {
      return queue.length;
    },
    // Others that stand in the river (the special places, features.js): asked along with
    // the blocks for stones and for cover.
    extras: [],
    // Stones near a point, for collisions and for shelter from the current.
    collidersNear(x, z, reach = 30, out = []) {
      out.length = 0;
      for (const block of blocks.values()) {
        if (!block.content) continue;
        for (const c of block.content.colliders) if (Math.abs(c.x - x) < reach + c.r && Math.abs(c.z - z) < reach + c.r) out.push(c);
      }
      for (const e of this.extras) e.collidersNear(x, z, reach, out);
      return out;
    },
    // Is (x, y, z) in weed, reeds or kelp, or under a trunk?
    covered(x, y, z) {
      for (const block of blocks.values()) {
        if (!block.content) continue;
        for (const c of block.content.cover) if (Math.hypot(c.x - x, c.z - z) < c.radius && y < c.top) return true;
      }
      for (const e of this.extras) if (e.covered(x, y, z)) return true;
      return false;
    },
  };
}

// Tubes (roots) into one geometry, with the colour channels the wood material reads.
export function mergeTubes(list) {
  let vertices = 0,
    count = 0;
  for (const g of list) {
    vertices += g.attributes.position.count;
    count += g.index.count;
  }
  const positions = new Float32Array(vertices * 3),
    normals = new Float32Array(vertices * 3),
    colors = new Float32Array(vertices * 3),
    indices = new Uint32Array(count);
  let v = 0,
    i = 0;
  for (const g of list) {
    positions.set(g.attributes.position.array, v * 3);
    normals.set(g.attributes.normal.array, v * 3);
    const index = g.index.array;
    for (let k = 0; k < index.length; k++) indices[i + k] = index[k] + v;
    v += g.attributes.position.count;
    i += index.length;
    g.dispose();
  }
  for (let k = 0; k < colors.length; k += 3) {
    colors[k] = 0.45;
    colors[k + 1] = 0.6;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

// Stone shapes carry their shade in a colour attribute; the rock material reads red as
// brightness and green as the share of moss, so both are kept in the shape's own colour.
export function withMossChannel(geometry) {
  const color = geometry.attributes.color;
  for (let i = 0; i < color.count; i++) color.setXYZ(i, color.getX(i), 1, 0);
  return geometry;
}

// A drowned trunk or a twig: a tapering tube along a curve, its bark roughened, cheap
// enough to build in a frame.
export function trunkGeometry(points, r0, r1, seed) {
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const rows = Math.max(6, Math.min(48, Math.ceil(length * 1.2)));
  const cols = r0 > 0.4 ? 14 : 8;
  const frames = curve.computeFrenetFrames(rows, false);
  const positions = [],
    normals = [],
    indices = [];
  const p = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    curve.getPointAt(t, p);
    const radius = r0 + (r1 - r0) * t;
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * Math.PI * 2;
      const bark = 1 + 0.08 * Math.sin(a * 5 + seed + t * 9) + 0.05 * Math.sin(t * length * 3 + a * 2 + seed);
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      positions.push(p.x + n.x * radius * bark, p.y + n.y * radius * bark, p.z + n.z * radius * bark);
      normals.push(n.x, n.y, n.z);
      if (i < rows && j < cols) {
        const k = i * (cols + 1) + j;
        indices.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}
