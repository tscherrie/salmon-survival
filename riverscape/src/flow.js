import * as THREE from "three";
import { CURRENT_SPEED, FLOW_DIRECTION } from "./water.js";
import { CENTER } from "./layout.js";

// The water that moves because something moved it.
//
// The river's own current is a smooth analytic field (water.js). On top of it rides this
// one: a coarse grid of velocity over the part of the river the viewer can reach, into
// which everything that pushes water writes -- a fish's body and tail, the ray's wings,
// a hand stirring from above, a pellet hitting the film -- and out of which everything
// that is carried reads: the grass, the drifting motes, the bubbles, the food, and the
// fish themselves. Disturbances are carried downstream by the current, spread a little,
// and die away over a second or two, which is what water does.
//
// The grass does not follow the water instantly. Each cell also carries how far the
// foliage there has been pushed, a damped spring driven by the local flow, so a blade
// shoved aside by a passing fish swings back through its rest and settles, and that
// displacement is what goes to the GPU.

export const FLOW_BOX = Object.freeze({
  min: new THREE.Vector3(CENTER.x - 19, -0.2, CENTER.z - 19),
  max: new THREE.Vector3(CENTER.x + 19, 11.6, CENTER.z + 19),
  cells: [46, 15, 46],
});

const [NX, NY, NZ] = FLOW_BOX.cells;
const COUNT = NX * NY * NZ;
const LAYER = NX * NY;
const CELL = new THREE.Vector3(
  (FLOW_BOX.max.x - FLOW_BOX.min.x) / (NX - 1),
  (FLOW_BOX.max.y - FLOW_BOX.min.y) / (NY - 1),
  (FLOW_BOX.max.z - FLOW_BOX.min.z) / (NZ - 1),
);
// Cell centres run from min to max. The texture maps [0, 1] across its texels' outer
// edges, so the shader's box is half a cell larger on every side.
export const flowUniforms = {
  flowField: { value: null },
  flowMin: { value: FLOW_BOX.min.clone().addScaledVector(CELL, -0.5) },
  flowSize: {
    value: new THREE.Vector3(NX * CELL.x, NY * CELL.y, NZ * CELL.z),
  },
};

export const flowGLSL = /* glsl */ `
  uniform highp sampler3D flowField;
  uniform vec3 flowMin;
  uniform vec3 flowSize;
  // rgb: how far the foliage here has been pushed; a: how hard the water is moving.
  vec4 flowAt(vec3 p) {
    vec3 uvw = (p - flowMin) / flowSize;
    vec3 inside = smoothstep(vec3(0.0), vec3(0.04), uvw) * (1.0 - smoothstep(vec3(0.96), vec3(1.0), uvw));
    return texture(flowField, clamp(uvw, 0.0, 1.0)) * inside.x * inside.y * inside.z;
  }
`;

const RELAX = 1.35; // seconds for a disturbance to fall to a third
const SPREAD = 0.075; // share exchanged with neighbours per step
const SPRING = { frequency: 0.75, damping: 0.32, gain: 0.34 };

export function createFlowField() {
  const vx = new Float32Array(COUNT),
    vy = new Float32Array(COUNT),
    vz = new Float32Array(COUNT);
  const tx = new Float32Array(COUNT),
    ty = new Float32Array(COUNT),
    tz = new Float32Array(COUNT);
  const bx = new Float32Array(COUNT),
    by = new Float32Array(COUNT),
    bz = new Float32Array(COUNT);
  const sx = new Float32Array(COUNT),
    sy = new Float32Array(COUNT),
    sz = new Float32Array(COUNT);
  const qx = new Float32Array(COUNT),
    qy = new Float32Array(COUNT),
    qz = new Float32Array(COUNT),
    qs = new Float32Array(COUNT),
    speed = new Float32Array(COUNT);
  const packed = new Uint16Array(COUNT * 4);
  const texture = new THREE.Data3DTexture(packed, NX, NY, NZ);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.HalfFloatType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  flowUniforms.flowField.value = texture;

  const index = (i, j, k) => i + NX * (j + NY * k);
  let active = 0;
  let accumulator = 0;
  const STEP = 1 / 30;

  // Adds `velocity` to the water within `radius` of `p`, weighted by a Gaussian, so the
  // cells there move toward it by `strength` (0 to 1) this call.
  function inject(p, velocity, radius, strength = 1) {
    const r = Math.max(radius, CELL.x * 0.6);
    const i0 = Math.max(0, Math.floor((p.x - r - FLOW_BOX.min.x) / CELL.x));
    const i1 = Math.min(NX - 1, Math.ceil((p.x + r - FLOW_BOX.min.x) / CELL.x));
    const j0 = Math.max(0, Math.floor((p.y - r - FLOW_BOX.min.y) / CELL.y));
    const j1 = Math.min(NY - 1, Math.ceil((p.y + r - FLOW_BOX.min.y) / CELL.y));
    const k0 = Math.max(0, Math.floor((p.z - r - FLOW_BOX.min.z) / CELL.z));
    const k1 = Math.min(NZ - 1, Math.ceil((p.z + r - FLOW_BOX.min.z) / CELL.z));
    if (i0 > i1 || j0 > j1 || k0 > k1) return;
    const inverse = 1 / (r * r);
    for (let k = k0; k <= k1; k++) {
      const dz = FLOW_BOX.min.z + k * CELL.z - p.z;
      for (let j = j0; j <= j1; j++) {
        const dy = FLOW_BOX.min.y + j * CELL.y - p.y;
        for (let i = i0; i <= i1; i++) {
          const dx = FLOW_BOX.min.x + i * CELL.x - p.x;
          const d2 = (dx * dx + dy * dy + dz * dz) * inverse;
          if (d2 > 2.25) continue;
          const w = Math.exp(-d2 * 1.6) * strength;
          const c = index(i, j, k);
          vx[c] += (velocity.x - vx[c]) * w;
          vy[c] += (velocity.y - vy[c]) * w;
          vz[c] += (velocity.z - vz[c]) * w;
        }
      }
    }
    active = 2.5;
  }

  // Trilinear sample of the disturbance velocity.
  function sample(p, out) {
    const fx = (p.x - FLOW_BOX.min.x) / CELL.x,
      fy = (p.y - FLOW_BOX.min.y) / CELL.y,
      fz = (p.z - FLOW_BOX.min.z) / CELL.z;
    if (fx < 0 || fy < 0 || fz < 0 || fx > NX - 1 || fy > NY - 1 || fz > NZ - 1)
      return out.set(0, 0, 0);
    const i = Math.min(NX - 2, Math.floor(fx)),
      j = Math.min(NY - 2, Math.floor(fy)),
      k = Math.min(NZ - 2, Math.floor(fz));
    const u = fx - i,
      v = fy - j,
      w = fz - k;
    let x = 0,
      y = 0,
      z = 0;
    for (let c = 0; c < 8; c++) {
      const di = c & 1,
        dj = (c >> 1) & 1,
        dk = c >> 2;
      const weight = (di ? u : 1 - u) * (dj ? v : 1 - v) * (dk ? w : 1 - w);
      const n = index(i + di, j + dj, k + dk);
      x += vx[n] * weight;
      y += vy[n] * weight;
      z += vz[n] * weight;
    }
    return out.set(x, y, z);
  }

  function advect(dt) {
    // Semi-Lagrangian: each cell takes what the current carried to it from upstream.
    const ox = (FLOW_DIRECTION.x * CURRENT_SPEED * dt) / CELL.x;
    const oz = (FLOW_DIRECTION.z * CURRENT_SPEED * dt) / CELL.z;
    for (let k = 0; k < NZ; k++)
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++) {
          const c = index(i, j, k);
          const fx = Math.max(0, i - ox),
            fz = Math.min(NZ - 1, Math.max(0, k - oz));
          const i0 = Math.min(NX - 2, Math.floor(fx)),
            k0 = Math.min(NZ - 2, Math.floor(fz));
          const u = fx - i0,
            w = fz - k0;
          const a = index(i0, j, k0),
            b = index(i0 + 1, j, k0),
            d = index(i0, j, k0 + 1),
            e = index(i0 + 1, j, k0 + 1);
          const wa = (1 - u) * (1 - w),
            wb = u * (1 - w),
            wd = (1 - u) * w,
            we = u * w;
          tx[c] = vx[a] * wa + vx[b] * wb + vx[d] * wd + vx[e] * we;
          ty[c] = vy[a] * wa + vy[b] * wb + vy[d] * wd + vy[e] * we;
          tz[c] = vz[a] * wa + vz[b] * wb + vz[d] * wd + vz[e] * we;
        }
  }

  function relax(dt) {
    const keep = Math.exp(-dt / RELAX);
    for (let k = 0; k < NZ; k++)
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++) {
          const c = index(i, j, k);
          // Six-neighbour diffusion with the boundary as still water.
          let ax = 0,
            ay = 0,
            az = 0;
          if (i > 0) { ax += tx[c - 1]; ay += ty[c - 1]; az += tz[c - 1]; }
          if (i < NX - 1) { ax += tx[c + 1]; ay += ty[c + 1]; az += tz[c + 1]; }
          if (j > 0) { ax += tx[c - NX]; ay += ty[c - NX]; az += tz[c - NX]; }
          if (j < NY - 1) { ax += tx[c + NX]; ay += ty[c + NX]; az += tz[c + NX]; }
          if (k > 0) { ax += tx[c - LAYER]; ay += ty[c - LAYER]; az += tz[c - LAYER]; }
          if (k < NZ - 1) { ax += tx[c + LAYER]; ay += ty[c + LAYER]; az += tz[c + LAYER]; }
          vx[c] = (tx[c] * (1 - SPREAD) + (ax / 6) * SPREAD) * keep;
          vy[c] = (ty[c] * (1 - SPREAD) + (ay / 6) * SPREAD) * keep;
          vz[c] = (tz[c] * (1 - SPREAD) + (az / 6) * SPREAD) * keep;
        }
  }

  function bend(dt) {
    const omega = SPRING.frequency * Math.PI * 2;
    const stiffness = omega * omega;
    const damping = 2 * SPRING.damping * omega;
    // Kept so frames drawn between two steps can be blended rather than held.
    qx.set(bx);
    qy.set(by);
    qz.set(bz);
    qs.set(speed);
    for (let c = 0; c < COUNT; c++) {
      speed[c] = Math.min(4, Math.hypot(vx[c], vy[c], vz[c]));
      sx[c] += (stiffness * (vx[c] * SPRING.gain - bx[c]) - damping * sx[c]) * dt;
      sy[c] += (stiffness * (vy[c] * SPRING.gain - by[c]) - damping * sy[c]) * dt;
      sz[c] += (stiffness * (vz[c] * SPRING.gain - bz[c]) - damping * sz[c]) * dt;
      bx[c] += sx[c] * dt;
      by[c] += sy[c] * dt;
      bz[c] += sz[c] * dt;
    }
  }

  const toHalf = THREE.DataUtils.toHalfFloat;
  // What the grass is shown: the last two steps blended by how far the clock has run
  // between them, so a 60 Hz picture of a 30 Hz simulation moves smoothly instead of
  // standing still for a frame and then jumping.
  function upload(alpha) {
    const beta = 1 - alpha;
    for (let c = 0, o = 0; c < COUNT; c++, o += 4) {
      packed[o] = toHalf(qx[c] * beta + bx[c] * alpha);
      packed[o + 1] = toHalf(qy[c] * beta + by[c] * alpha);
      packed[o + 2] = toHalf(qz[c] * beta + bz[c] * alpha);
      packed[o + 3] = toHalf(qs[c] * beta + speed[c] * alpha);
    }
    texture.needsUpdate = true;
  }

  // Runs the water at a fixed 30 Hz whatever the frame rate, and stops doing any work at
  // all once everything in it has died away and the grass is at rest.
  let settled = true;
  function update(dt) {
    accumulator = Math.min(accumulator + dt, STEP * 3);
    while (accumulator >= STEP) {
      accumulator -= STEP;
      if (active <= 0) continue;
      advect(STEP);
      relax(STEP);
      bend(STEP);
      active -= STEP;
      settled = false;
    }
    if (settled) return;
    upload(active > 0 ? accumulator / STEP : 1);
    if (active <= 0) settled = true;
  }

  return { inject, sample, update, texture, cell: CELL };
}
