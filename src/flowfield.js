// The eddies round the fish, as the game asks for them. The work is done in a worker
// (eddies-worker.js); here the stones near the fish are sent to it, a tick goes each frame,
// and the last picture it sent back is sampled: how the stones change the current at a
// point -- the slack water and the back eddy behind them, the water parting round them,
// the whirls drifting off -- and how high above the bed that reaches.
//
// sample(x, y, z, out) writes
//   out.vx, out.vz   the change to the current at that point, as the layer of stones has it
//   out.base         the river's own speed there (what the change is measured against)
//   out.w            0..1, how much of that reaches up to y
// A consumer with a current of its own at that point (at its height) scales the change by
// its own speed over out.base; one without (the specks) adds it as it is.

import * as THREE from "three";
import { flowUniforms } from "../../riverscape/src/flow.js";

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// For the water's surface (materials.js): the change of the current, its spin, and how far
// up to the surface the stones making it reach, over the square round the fish.
const EDDY_N = 128;
function floatTexture(data, width, height, depth) {
  const texture = depth ? new THREE.Data3DTexture(data, width, height, depth) : new THREE.DataTexture(data, width, height);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.FloatType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  if (depth) texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}
export const eddyUniforms = {
  eddyMap: { value: floatTexture(new Float32Array(EDDY_N * EDDY_N * 4), EDDY_N, EDDY_N) },
  eddyOrigin: { value: new THREE.Vector2() },
  eddySize: { value: 1 },
  eddyOn: { value: 0 },
};
export const eddyGLSL = /* glsl */ `
  uniform sampler2D eddyMap;
  uniform vec2 eddyOrigin;
  uniform float eddySize;
  uniform float eddyOn;
  // xy: how the stones change the current here; z: its spin; w: how far up to the surface
  // the stones making it reach. Nothing outside the square round the fish.
  vec4 eddyAt(vec2 q) {
    vec2 uv = (q - eddyOrigin) / eddySize;
    vec2 inside = smoothstep(vec2(0.0), vec2(0.08), uv) * (1.0 - smoothstep(vec2(0.92), vec2(1.0), uv));
    return texture2D(eddyMap, clamp(uv, 0.0, 1.0)) * inside.x * inside.y * eddyOn;
  }
`;
// For the plants: the riverscape foliage's own flow texture, pointed at the square.
const PLANT_N = EDDY_N / 2;
const plantTexture = floatTexture(new Float32Array(PLANT_N * 2 * PLANT_N * 4), PLANT_N, 2, PLANT_N);

export function createFlowField({ query } = {}) {
  let worker = null;
  try {
    worker = new Worker(new URL("./eddies-worker.js", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  let snap = null;
  let busy = false;
  let owed = 0;
  let stonesClock = 1e9;
  const lastSent = { x: Infinity, z: Infinity };
  const recycle = [];
  const scratch = {};
  let failed = !worker;
  const stats = { cost: 0, steps: 0, E: 0 };
  if (worker) {
    worker.onmessage = (event) => {
      if (snap) recycle.push(snap.PU, snap.PV, snap.TOP, snap.BASE, snap.FLOOR, snap.SURF, snap.PLANTS);
      snap = event.data;
      busy = false;
      stats.cost = snap.cost;
      stats.steps = snap.steps;
      stats.E = snap.E;
      // The surface's and the plants' pictures of it.
      const surface = eddyUniforms.eddyMap.value;
      surface.image.data = snap.SURF;
      surface.needsUpdate = true;
      eddyUniforms.eddyOrigin.value.set(snap.X0, snap.Z0);
      eddyUniforms.eddySize.value = snap.E;
      eddyUniforms.eddyOn.value = 1;
      plantTexture.image.data = snap.PLANTS;
      plantTexture.needsUpdate = true;
      flowUniforms.flowField.value = plantTexture;
      const span = snap.plantHigh - snap.plantLow;
      flowUniforms.flowMin.value.set(snap.X0, snap.plantLow - span * 0.5, snap.Z0);
      flowUniforms.flowSize.value.set(snap.E, span * 2, snap.E);
    };
    worker.onerror = (error) => {
      console.warn("Eddies worker failed:", error.message ?? error);
      failed = true;
      snap = null;
      eddyUniforms.eddyOn.value = 0;
      flowUniforms.flowField.value = null;
    };
    const tune = {};
    for (const key of ["relax", "confine", "iterations"]) if (query?.has(key)) tune[key] = Number(query.get(key));
    if (Object.keys(tune).length) worker.postMessage({ settings: tune });
  }

  // The stones within the square, packed as [x, y, z, rx, rz, ry, cos, sin].
  function pack(stones) {
    const out = new Float32Array(stones.length * 8);
    let q = 0;
    for (const c of stones) {
      out[q++] = c.x;
      out[q++] = c.y;
      out[q++] = c.z;
      out[q++] = c.rx ?? c.r;
      out[q++] = c.rz ?? c.r;
      out[q++] = c.ry ?? c.r;
      out[q++] = c.cos ?? 1;
      out[q++] = c.sin ?? 0;
    }
    return out;
  }

  const api = {
    stats,
    get ready() {
      return !!snap && !failed;
    },
    get snapshot() {
      return snap;
    },
    // How far round the fish the stones are wanted.
    reach(length) {
      return Math.min(240, Math.max(10, 8 + length * 24)) * 0.75;
    },
    // Each frame: dt (0 while the game stands still), the fish, the stones round it (a
    // function, asked only when they are due), the river's gusts just now.
    update(dt, fish, gatherStones, gust) {
      if (failed || !worker) return;
      owed += dt;
      stonesClock += dt;
      if (busy || owed <= 0) return;
      const message = { type: "tick", dt: owed, gust, fish: { x: fish.position.x, y: fish.position.y, z: fish.position.z, s: fish.river.s, L: fish.length } };
      const transfer = [];
      const reach = api.reach(fish.length);
      if (stonesClock > 0.8 || Math.hypot(fish.position.x - lastSent.x, fish.position.z - lastSent.z) > reach * 0.2) {
        const packed = pack(gatherStones(reach));
        message.stones = packed;
        transfer.push(packed.buffer);
        stonesClock = 0;
        lastSent.x = fish.position.x;
        lastSent.z = fish.position.z;
      }
      if (recycle.length) {
        message.recycle = recycle.splice(0);
        for (const b of message.recycle) transfer.push(b.buffer);
      }
      worker.postMessage(message, transfer);
      owed = 0;
      busy = true;
    },
    sample(x, y, z, out) {
      out.vx = out.vz = 0;
      out.base = 0;
      out.w = 0;
      if (!snap) return out;
      const { N, h, X0, Z0, PU, PV, TOP, BASE, FLOOR } = snap;
      let fx = (x - X0) / h - 0.5,
        fz = (z - Z0) / h - 0.5;
      if (fx < 0 || fz < 0 || fx > N - 1.001 || fz > N - 1.001) return out;
      const i = fx | 0,
        j = fz | 0;
      fx -= i;
      fz -= j;
      const k = j * N + i;
      const w11 = fx * fz,
        w10 = fx - w11,
        w01 = fz - w11,
        w00 = 1 - fx - fz + w11;
      const mix = (A) => A[k] * w00 + A[k + 1] * w10 + A[k + N] * w01 + A[k + N + 1] * w11;
      const top = mix(TOP),
        floor = mix(FLOOR);
      // A wake reaches as high as what made it, and thins out above that.
      const w = 1 - smooth(top * 0.85, top * 1.5 + h, y - floor);
      if (w <= 0) return out;
      const pu = mix(PU),
        pv = mix(PV),
        base = mix(BASE);
      out.vx = pu * w;
      out.vz = pv * w;
      out.base = base;
      out.w = w;
      return out;
    },
    // Development (?eddies=debug): the square drawn into a canvas -- the river's own speed
    // in blue, the slack water dark, faster water bright, the whirls red and green, the
    // banks and big stones grey, the fish white.
    debug(canvas, fish) {
      if (!snap) return;
      const { N, h, X0, Z0, PU, PV, BASE, wall } = snap;
      if (canvas.width !== N) canvas.width = canvas.height = N;
      const g = canvas.getContext("2d");
      const image = g.createImageData(N, N);
      const px = image.data;
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const k = j * N + i;
          const o = ((N - 1 - j) * N + i) * 4;
          if (wall[k]) {
            px[o] = px[o + 1] = px[o + 2] = 90;
            px[o + 3] = 255;
            continue;
          }
          const b = BASE[k];
          // Spin of the change, from the neighbours.
          let spin = 0;
          if (i > 0 && j > 0 && i < N - 1 && j < N - 1) spin = (PV[k + 1] - PV[k - 1] - PU[k + N] + PU[k - N]) / (2 * h);
          const along = b > 0.01 ? Math.hypot(PU[k] + 0, PV[k]) / b : 0;
          const s = Math.max(-1, Math.min(1, spin / 4));
          px[o] = 30 + 200 * Math.max(0, s);
          px[o + 1] = 30 + 200 * Math.max(0, -s);
          px[o + 2] = Math.min(255, 60 + 60 * b + 120 * along);
          px[o + 3] = 255;
        }
      g.putImageData(image, 0, 0);
      if (fish) {
        const i = (fish.position.x - X0) / h,
          j = N - (fish.position.z - Z0) / h;
        g.fillStyle = "#fff";
        g.fillRect(i - 1.5, j - 1.5, 3, 3);
      }
    },
    // Add the stones' doing to a current `flow` (vx, vz, speed) felt at (x, y, z), scaled to
    // that current's own speed; returns how much slacker it has become (0..1).
    apply(x, y, z, flow) {
      api.sample(x, y, z, scratch);
      if (!scratch.w) return 0;
      const own = flow.speed;
      const k = Math.min(2, own / Math.max(scratch.base, 0.25));
      flow.vx += scratch.vx * k;
      flow.vz += scratch.vz * k;
      const speed = Math.hypot(flow.vx, flow.vz);
      flow.speed = speed;
      return own > 0.05 ? Math.min(1, Math.max(0, 1 - speed / own)) : 0;
    },
  };
  return api;
}
