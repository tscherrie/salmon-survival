// The water round the fish, worked out off the main thread: a square of river centred on
// the fish, sized to it (a hand's breadth of cells for a fry, a couple of metres for a
// grown salmon), that follows it along; the river's own current laid into it from the
// course, the stones rasterised into it, and the eddy solver run over it. What comes back
// each step is what the stones change: the perturbation of the current in every cell, how
// high above the bed each wake reaches, the river's own speed there and the bed's height.
import { bed, current, level, locate } from "./course.js";
import { createSolver } from "./eddies.js";

const N = 128;
const C = 4; // fine cells to a coarse node
const M = N / C + 1; // coarse nodes to a side
const solver = createSolver(N);
const { BU, BV, SOLID, TU, TV, WALL, LAND, TOPSRC } = solver;

// The coarse lattice: the river's current, depth and bed, asked of the course at every
// fourth cell (the course is smooth at that scale) and eased between.
const cVX = new Float32Array(M * M),
  cVZ = new Float32Array(M * M),
  cDepth = new Float32Array(M * M),
  cBed = new Float32Array(M * M),
  cS = new Float64Array(M * M);
const BED = new Float32Array(N * N),
  DEPTH = new Float32Array(N * N);

let E = 0, // the square's side, units
  h = 0, // a cell's side
  oI = 0, // the square's corner, in coarse steps of the world lattice
  oJ = 0;
let stones = new Float32Array(0);
let stonesDirty = true;
let clock = 0;
let settings = { relax: 0.35, confine: 0.6, iterations: 14 };
const river = { s: 0, u: 0 };
const flow = {};

function node(I, J, hint) {
  const k = J * M + I;
  const x = (oI + I) * C * h,
    z = (oJ + J) * C * h;
  locate(x, z, hint, river);
  const s = river.s,
    u = river.u;
  cS[k] = s;
  const floor = bed(s, u);
  const depth = level(s) - floor;
  cBed[k] = floor;
  cDepth[k] = depth;
  if (depth <= 0.05) {
    cVX[k] = cVZ[k] = 0;
    return;
  }
  current(s, u, floor + depth * 0.5, flow, 0, true);
  cVX[k] = flow.vx;
  cVZ[k] = flow.vz;
}
// Every coarse node anew (a new square, or a jump): outward from the middle, each asking
// the course from its neighbour's place, as the river winds.
function allNodes(hintS) {
  const mid = (M - 1) >> 1;
  node(mid, mid, Number.isFinite(hintS) ? hintS : null);
  for (let ring = 1; ring <= mid; ring++)
    for (let J = mid - ring; J <= mid + ring; J++)
      for (let I = mid - ring; I <= mid + ring; I++) {
        if (Math.max(Math.abs(I - mid), Math.abs(J - mid)) !== ring) continue;
        const nI = I + Math.sign(mid - I),
          nJ = J + Math.sign(mid - J);
        node(I, J, cS[nJ * M + nI]);
      }
}
// The coarse lattice moved by (dI, dJ) steps: keep what stays, ask for what comes in.
function shiftNodes(dI, dJ) {
  for (const A of [cVX, cVZ, cDepth, cBed, cS]) {
    const copy = A.slice();
    for (let J = 0; J < M; J++)
      for (let I = 0; I < M; I++) {
        const sI = I + dI,
          sJ = J + dJ;
        if (sI >= 0 && sI < M && sJ >= 0 && sJ < M) A[J * M + I] = copy[sJ * M + sI];
        else A[J * M + I] = NaN;
      }
  }
  // New nodes from inside out, each from a neighbour already known.
  for (let pass = 0; pass < M; pass++) {
    let missing = 0;
    for (let J = 0; J < M; J++)
      for (let I = 0; I < M; I++) {
        const k = J * M + I;
        if (!Number.isNaN(cS[k])) continue;
        let hint = NaN;
        for (const [a, b] of [
          [I - 1, J],
          [I + 1, J],
          [I, J - 1],
          [I, J + 1],
        ])
          if (a >= 0 && a < M && b >= 0 && b < M && !Number.isNaN(cS[b * M + a])) hint = cS[b * M + a];
        if (Number.isNaN(hint)) {
          missing++;
          continue;
        }
        node(I, J, hint);
      }
    if (!missing) break;
  }
}
// The fine cells from the coarse lattice.
function fineBase() {
  for (let j = 0; j < N; j++) {
    const y = (j + 0.5) / C;
    const J = Math.min(M - 2, y | 0),
      fy = y - J;
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / C;
      const I = Math.min(M - 2, x | 0),
        fx = x - I;
      const a = J * M + I;
      const w00 = (1 - fx) * (1 - fy),
        w10 = fx * (1 - fy),
        w01 = (1 - fx) * fy,
        w11 = fx * fy;
      const k = j * N + i;
      BU[k] = cVX[a] * w00 + cVX[a + 1] * w10 + cVX[a + M] * w01 + cVX[a + M + 1] * w11;
      BV[k] = cVZ[a] * w00 + cVZ[a + 1] * w10 + cVZ[a + M] * w01 + cVZ[a + M + 1] * w11;
      const depth = cDepth[a] * w00 + cDepth[a + 1] * w10 + cDepth[a + M] * w01 + cDepth[a + M + 1] * w11;
      DEPTH[k] = depth;
      BED[k] = cBed[a] * w00 + cBed[a + 1] * w10 + cBed[a + M] * w01 + cBed[a + M + 1] * w11;
      LAND[k] = depth <= 0.08 ? 1 : 0;
      if (LAND[k]) BU[k] = BV[k] = 0;
    }
  }
  solver.baseChanged();
}

// The stones (and the banks) into the cells: how much of the water column each blocks.
// Stones come as [x, y, z, rx, rz, ry, cos, sin] each.
function rasterise() {
  SOLID.fill(0);
  TU.fill(0);
  TV.fill(0);
  TOPSRC.fill(0);
  WALL.set(LAND);
  const X0 = oI * C * h,
    Z0 = oJ * C * h;
  for (let q = 0; q + 7 < stones.length; q += 8) {
    const x = stones[q],
      y = stones[q + 1],
      z = stones[q + 2],
      rx = stones[q + 3],
      rz = stones[q + 4],
      ry = stones[q + 5],
      cs = stones[q + 6],
      sn = stones[q + 7];
    const reach = Math.max(rx, rz) * 1.05;
    // Gravel and small cobbles are the bed's roughness, already in the river's own current;
    // only stones a few cells across stand in the way of it.
    if (reach < h * 2.2) continue;
    const b = Math.min(1, (reach - h * 2.2) / (h * 3.8));
    const big = 0.5 + 0.5 * b * b * (3 - 2 * b);
    const i0 = Math.max(0, Math.floor((x - reach - X0) / h)),
      i1 = Math.min(N - 1, Math.ceil((x + reach - X0) / h)),
      j0 = Math.max(0, Math.floor((z - reach - Z0) / h)),
      j1 = Math.min(N - 1, Math.ceil((z + reach - Z0) / h));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const wx = X0 + (i + 0.5) * h - x,
          wz = Z0 + (j + 0.5) * h - z;
        const lx = (wx * cs - wz * sn) / rx,
          lz = (wx * sn + wz * cs) / rz;
        const r2 = lx * lx + lz * lz;
        if (r2 >= 1.1) continue;
        const k = j * N + i;
        if (LAND[k]) continue;
        const top = y + ry * Math.sqrt(Math.max(0, 1 - r2));
        const floor = BED[k],
          depth = Math.max(DEPTH[k], 0.05);
        const above = top - floor;
        if (above <= 0) continue;
        const edge = r2 < 0.85 ? 1 : (1.1 - r2) / 0.25;
        // The layer worked out is the lower half of the water, where the fish mostly keep
        // and the stones are: a stone low in it is mostly flowed over, one filling it is
        // flowed round (above its top the change fades out -- see TOP). Small stones only
        // half count: the water goes over them as much as round them.
        const share = Math.min(1, above / (0.55 * depth));
        const t = Math.min(1, Math.max(0, (share - 0.25) / 0.6));
        const cover = t * t * (3 - 2 * t) * edge * big;
        if (cover > SOLID[k]) SOLID[k] = cover;
        if (above > TOPSRC[k]) TOPSRC[k] = above;
        if (share > 0.9 && edge >= 1 && reach > h * 5) WALL[k] = 1;
      }
  }
}

// Place (or re-place) the square round the fish.
function follow(fish, gust) {
  const want = Math.min(240, Math.max(10, 8 + fish.L * 24));
  // In steps of a quarter octave, so a growing fish does not re-lay it every frame.
  const quantised = 2 ** (Math.round(Math.log2(want) * 4) / 4);
  const fresh = quantised !== E;
  if (fresh) {
    E = quantised;
    h = E / N;
  }
  const step = C * h;
  const wI = Math.round(fish.x / step) - ((M - 1) >> 1),
    wJ = Math.round(fish.z / step) - ((M - 1) >> 1);
  if (fresh || Math.abs(wI - oI) >= M - 2 || Math.abs(wJ - oJ) >= M - 2) {
    oI = wI;
    oJ = wJ;
    allNodes(fish.s);
    fineBase();
    solver.seed(gust, true);
    solver.P.fill(0);
    stonesDirty = true;
    return;
  }
  // Keep the fish within the middle half; move by whole coarse steps.
  const dI = Math.abs(wI - oI) > (M >> 2) ? wI - oI : 0,
    dJ = Math.abs(wJ - oJ) > (M >> 2) ? wJ - oJ : 0;
  if (dI || dJ) {
    oI += dI;
    oJ += dJ;
    shiftNodes(dI, dJ);
    fineBase();
    solver.shift(dI * C, dJ * C);
    solver.seed(gust);
    stonesDirty = true;
  }
}

let spare = [];
const timing = {};
function buffer(length = N * N) {
  const i = spare.findIndex((b) => b.length === length);
  return i >= 0 ? spare.splice(i, 1)[0] : new Float32Array(length);
}
// For the plants: the change of the current on a coarser grid, as the riverscape foliage
// reads it (rgb how far the water pushes a blade, a how much it stirs it), in two layers --
// on the bed, and above the highest wake, where nothing is left of it.
const FN = N / 2;

self.onmessage = (event) => {
  const m = event.data;
  if (m.recycle) spare.push(...m.recycle);
  if (m.settings) settings = { ...settings, ...m.settings };
  if (m.stones) {
    stones = m.stones;
    stonesDirty = true;
  }
  if (m.type !== "tick") return;
  const started = performance.now();
  const gust = m.gust ?? 1;
  follow(m.fish, gust);
  const followed = performance.now();
  if (stonesDirty) {
    rasterise();
    stonesDirty = false;
  }
  const rasterised = performance.now();
  timing.follow = followed - started;
  timing.raster = rasterised - followed;
  timing.stones = stones.length / 8;
  clock += Math.min(m.dt, 0.1);
  let steps = 0;
  while (clock >= 1 / 45 && steps < 2) {
    const dt = Math.min(clock, 1 / 30);
    solver.step(dt, h, { gust, ...settings });
    clock -= dt;
    steps++;
  }
  // What the stones change, the wakes' heights, the river's own speed, the bed.
  const PU = buffer(),
    PV = buffer(),
    TOP = buffer(),
    BASE = buffer(),
    FLOOR = buffer();
  const { U, V } = solver;
  for (let k = 0; k < N * N; k++) {
    const bu = BU[k] * gust,
      bv = BV[k] * gust;
    PU[k] = U[k] - bu;
    PV[k] = V[k] - bv;
    BASE[k] = Math.hypot(bu, bv);
  }
  TOP.set(solver.TOP);
  FLOOR.set(BED);
  // For the surface: the change, its spin, and how far up to the surface the stones
  // making it reach (a wake from a stone breaking the surface shows on it; one from a
  // cobble deep down does not).
  const SURF = buffer(N * N * 4);
  let lowest = Infinity,
    highest = -Infinity;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i,
        o = k * 4;
      SURF[o] = PU[k];
      SURF[o + 1] = PV[k];
      SURF[o + 2] = i > 0 && j > 0 && i < N - 1 && j < N - 1 ? (PV[k + 1] - PV[k - 1] - PU[k + N] + PU[k - N]) / (2 * h) : 0;
      SURF[o + 3] = LAND[k] ? 0 : Math.min(1, TOP[k] / Math.max(DEPTH[k], 0.1));
      if (!LAND[k]) {
        if (BED[k] < lowest) lowest = BED[k];
        if (BED[k] + TOP[k] > highest) highest = BED[k] + TOP[k];
      }
    }
  const PLANTS = buffer(FN * 2 * FN * 4);
  PLANTS.fill(0);
  for (let j = 0; j < FN; j++)
    for (let i = 0; i < FN; i++) {
      const k = 2 * j * N + 2 * i;
      const pu = (PU[k] + PU[k + 1] + PU[k + N] + PU[k + N + 1]) * 0.25,
        pv = (PV[k] + PV[k + 1] + PV[k + N] + PV[k + N + 1]) * 0.25;
      const spin = Math.abs(SURF[k * 4 + 2]);
      const o = (j * 2 * FN + i) * 4; // layer 0 (the bed) of an FN x 2 x FN texture
      PLANTS[o] = pu * 0.2;
      PLANTS[o + 2] = pv * 0.2;
      PLANTS[o + 3] = Math.min(1.5, spin * h * 0.8 + Math.hypot(pu, pv) * 0.15);
    }
  if (!Number.isFinite(lowest)) lowest = highest = 0;
  self.postMessage(
    {
      N,
      h,
      E,
      X0: oI * C * h,
      Z0: oJ * C * h,
      PU,
      PV,
      TOP,
      BASE,
      FLOOR,
      SURF,
      PLANTS,
      plantLow: lowest,
      plantHigh: Math.max(highest + 0.5, lowest + 2),
      wall: WALL.slice(),
      block: Uint8Array.from(SOLID, (v) => Math.round(v * 200)),
      cost: performance.now() - started,
      steps,
      timing: { ...timing, step: performance.now() - rasterised },
    },
    [PU.buffer, PV.buffer, TOP.buffer, BASE.buffer, FLOOR.buffer, SURF.buffer, PLANTS.buffer],
  );
};
