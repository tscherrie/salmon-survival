import * as THREE from "three";
import { photo } from "./materials.js";

// The forest above the banks: Norway spruce, Scots pine and downy birch, and under them
// juniper, bilberry, ferns, old stumps and fallen trunks.
//
// Trunks and limbs are solids. Needles and leaves are cards, cut to their shape in the
// shader rather than modelled (a spruce's drooping sprays, a pine's tufts, a birch's
// leaves, a fern's fronds), and lit as one rounded crown rather than as flat pieces, so a
// tree costs a few hundred triangles and still has a ragged, see-through edge. The cards
// carry what they are (`leaf`: along, across, kind, a random seed) and how far out on the
// tree they sit (`sway`, for the wind); the season is laid on in the shader: birch leaves
// turn yellow and fall, ferns brown, and snow settles on the tops of the conifers.

const TAU = Math.PI * 2;
const vec = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = vec(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ranger = (random) => (a, b) => a + (b - a) * random();

// The kinds of card, as the shader knows them.
export const SOLID = 0,
  SPRAY = 1,
  LEAVES = 2,
  TUFT = 3,
  FROND = 4;

const NONE = [0, 0, 0, 0];
export class TreeBatch {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.leaf = [];
    this.sway = [];
    this.indices = [];
  }
  get empty() {
    return this.positions.length === 0;
  }
  vertex(p, n, c, leaf = NONE, sway = 0) {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.colors.push(c.r, c.g, c.b);
    this.leaf.push(leaf[0], leaf[1], leaf[2], leaf[3]);
    this.sway.push(sway);
    return this.positions.length / 3 - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute("leaf", new THREE.Float32BufferAttribute(this.leaf, 4));
    g.setAttribute("sway", new THREE.Float32BufferAttribute(this.sway, 1));
    g.setIndex(this.indices);
    return g;
  }
}

// A tapering limb from a to b: a trunk, a branch, a stump. `shade(p, t, a)` darkens or
// marks the bark (t along the limb, a round it); the sway rises from sway0 to sway1.
const _side = vec(0, 0, 0),
  _side2 = vec(0, 0, 0),
  _axis = vec(0, 0, 0);
function limb(batch, a, b, r0, r1, color, { sides = 6, shade = null, sway0 = 0, sway1 = 0, cap = false } = {}) {
  _axis.subVectors(b, a).normalize();
  _side.crossVectors(_axis, Math.abs(_axis.y) > 0.9 ? vec(1, 0, 0) : UP).normalize();
  _side2.crossVectors(_axis, _side).normalize();
  const first = batch.positions.length / 3;
  const c = new THREE.Color();
  for (let end = 0; end < 2; end++) {
    const at = end ? b : a,
      r = end ? r1 : r0;
    for (let j = 0; j < sides; j++) {
      const ang = (j / sides) * TAU;
      const n = _side.clone().multiplyScalar(Math.cos(ang)).addScaledVector(_side2, Math.sin(ang));
      const p = at.clone().addScaledVector(n, r);
      c.copy(color).multiplyScalar(shade ? shade(p, end, ang) : 1);
      batch.vertex(p, n, c, NONE, end ? sway1 : sway0);
    }
  }
  for (let j = 0; j < sides; j++) {
    const j1 = (j + 1) % sides;
    batch.indices.push(first + j, first + j1, first + sides + j, first + j1, first + sides + j1, first + sides + j);
  }
  if (cap) {
    const centre = batch.vertex(b, _axis, color, NONE, sway1);
    for (let j = 0; j < sides; j++) batch.indices.push(first + sides + j, first + sides + ((j + 1) % sides), centre);
  }
}

// The light on foliage: as if the whole crown were one soft rounded body (its centre and
// how squat it is), the tops brighter than the underside.
function crownNormal(p, crown) {
  return vec(p.x - crown.x, (p.y - crown.y) * crown.k + crown.lift, p.z - crown.z).normalize();
}

// A card along a spine of points, `across` the unit vector to its sides, w its half width,
// the sides dropped by `fold` (a shallow roof); u runs along it, v across (-1..1).
function sheet(batch, spine, across, w, fold, color, kind, seed, crown, sway0, swayGain, inner = 0.5) {
  const rows = spine.length;
  const first = batch.positions.length / 3;
  const c = new THREE.Color();
  for (let i = 0; i < rows; i++) {
    const u = i / (rows - 1);
    for (let v = -1; v <= 1; v++) {
      const p = spine[i].clone().addScaledVector(across, v * w);
      p.y -= Math.abs(v) * fold;
      c.copy(color).multiplyScalar(inner + (1 - inner) * u);
      batch.vertex(p, crownNormal(p, crown), c, [u, v, kind, seed], sway0 + swayGain * u);
    }
  }
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < 2; j++) {
      const a = first + i * 3 + j;
      batch.indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
}

// A flat card round a centre (a pine's tuft, a clump of leaves): axes du, dv, half sizes.
function pad(batch, centre, du, dv, su, sv, color, kind, seed, crown, sway) {
  const first = batch.positions.length / 3;
  for (const [u, v] of [
    [0, -1],
    [1, -1],
    [0, 1],
    [1, 1],
  ]) {
    const p = centre.clone().addScaledVector(du, (u * 2 - 1) * su).addScaledVector(dv, v * sv);
    batch.vertex(p, crownNormal(p, crown), color, [u, v, kind, seed], sway);
  }
  batch.indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
}

// Bark: darker at the foot, streaked.
const barkShade = (p, end, a) => (end ? 1 : 0.7) * (0.85 + 0.15 * Math.sin(a * 3 + p.y));

// ---------------------------------------------------------------------------------------
// Norway spruce: a tall narrow spire of drooping branches in whorls from low down, a
// grey-brown trunk hardly seen.
export function spruce(batch, x, y, z, height, random, { small = false } = {}) {
  const range = ranger(random);
  const base = vec(x, y - 1, z);
  const top = vec(x + range(-1, 1) * height * 0.012, y + height, z + range(-1, 1) * height * 0.012);
  const bark = new THREE.Color().setHSL(range(0.06, 0.09), range(0.07, 0.14), range(0.12, 0.17));
  const needles = new THREE.Color().setHSL(range(0.36, 0.41), range(0.3, 0.42), range(0.075, 0.11));
  const lowest = small ? 0.02 : range(0.05, 0.18);
  // The trunk: stout below the crown, thin inside it, where it is only glimpsed.
  const knee = base.clone().lerp(top, lowest + 0.12);
  limb(batch, base, knee, height * 0.022, height * 0.014, bark, { sides: small ? 5 : 7, shade: barkShade, sway1: 0.05 });
  limb(batch, knee, top, height * 0.007, height * 0.002, bark.clone().lerp(needles, 0.5).multiplyScalar(0.6), { sides: 4, sway0: 0.05, sway1: 0.35 });
  const R = height * range(0.15, 0.2);
  const whorls = Math.round(clamp(height / 4.5, small ? 6 : 12, 22));
  const crown = { x, y: y + height * 0.35, z, k: 0.45, lift: height * 0.14 };
  const c = new THREE.Color();
  for (let w = 0; w < whorls; w++) {
    const t = lowest + (1 - lowest) * clamp((w + range(-0.3, 0.3)) / whorls, 0, 0.97);
    const at = base.clone().lerp(top, t);
    const r = R * Math.pow(1 - t, 0.9) + height * 0.012;
    const n = Math.floor(range(6, 8.99));
    const a0 = range(0, TAU);
    for (let j = 0; j < n; j++) {
      const a = a0 + (j / n) * TAU + range(-0.3, 0.3);
      const dir = vec(Math.cos(a), 0, Math.sin(a));
      const length = r * range(0.85, 1.2);
      const lift = lerp(-0.2, 0.4, t) * length;
      const droop = length * lerp(0.45, 0.12, t);
      const spine = [0, 0.5, 1].map((u) => at.clone().addScaledVector(dir, length * u).addScaledVector(UP, lift * u - droop * u * u));
      c.copy(needles).multiplyScalar(range(0.85, 1.2));
      const across = vec(-dir.z, 0, dir.x);
      const w = length * range(0.36, 0.46);
      sheet(batch, spine, across, w, length * 0.12, c, SPRAY, random(), crown, 0.1 + 0.4 * t, 0.5, 0.45);
      // The side shoots hanging from it like a comb: a second spray, near upright, below.
      if (!small || w > 0.4) {
        const hang = across.clone().multiplyScalar(0.35).addScaledVector(UP, 0.94).normalize();
        const below = spine.map((q, i) => q.clone().addScaledVector(UP, -w * 0.45 * (0.4 + 0.6 * (i / 2))));
        c.multiplyScalar(0.85);
        sheet(batch, below, hang, w * 0.6, 0, c, SPRAY, random(), crown, 0.1 + 0.4 * t, 0.55, 0.45);
      }
    }
  }
  // The dark heart of the crown, so it is never seen through to the trunk: three upright
  // sprays crossing on the trunk, broad at the foot of the crown, narrowing to the top.
  const foot = base.clone().lerp(top, lowest + 0.02);
  const core = [0, 0.33, 0.66, 1].map((f) => foot.clone().lerp(top, f * 0.96));
  for (let q = 0; q < 3; q++) {
    const a = (q / 3) * Math.PI + range(-0.2, 0.2);
    c.copy(needles).multiplyScalar(0.7);
    sheet(batch, core, vec(Math.cos(a), 0, Math.sin(a)), R * 0.62 * (1 - lowest), 0, c, SPRAY, random(), crown, 0.05, 0.35, 0.6);
  }
  // The leader: a short upright shoot at the very top.
  const leader = [top.clone().addScaledVector(UP, -height * 0.07), top.clone().addScaledVector(UP, height * 0.02)];
  for (const a of [0, Math.PI / 2]) sheet(batch, leader, vec(Math.cos(a), 0, Math.sin(a)), height * 0.025, 0, needles, SPRAY, random(), crown, 0.6, 0.2, 0.8);
}

// Scots pine: a long bare trunk, grey below and fox-red above, a little crooked; a flat,
// open crown of crooked limbs ending in tufts of needles.
export function pine(batch, x, y, z, height, random) {
  const range = ranger(random);
  const lower = new THREE.Color().setHSL(range(0.05, 0.07), range(0.18, 0.28), range(0.16, 0.2));
  const upper = new THREE.Color().setHSL(range(0.05, 0.07), range(0.45, 0.55), range(0.3, 0.36));
  // The trunk in three bends.
  const lean = vec(range(-1, 1), 0, range(-1, 1)).multiplyScalar(height * 0.03);
  const points = [0, 0.35, 0.7, 1].map((t, i) => vec(x + lean.x * t * t + (i % 2 ? range(-1, 1) * height * 0.008 : 0), y - 1 + (height + 1) * t, z + lean.z * t * t + (i % 2 ? range(-1, 1) * height * 0.008 : 0)));
  for (let i = 0; i < 3; i++) {
    const t0 = i / 3,
      t1 = (i + 1) / 3;
    const colour = lower.clone().lerp(upper, clamp(t0 * 1.6 - 0.3, 0, 1));
    limb(batch, points[i], points[i + 1], height * lerp(0.02, 0.006, t0), height * lerp(0.02, 0.006, t1), colour, { shade: barkShade, sway0: t0 * 0.3, sway1: t1 * 0.3 });
  }
  const needles = new THREE.Color().setHSL(range(0.24, 0.3), range(0.3, 0.42), range(0.13, 0.18));
  const trunkAt = (t) => {
    const f = t * 3,
      i = Math.min(2, Math.floor(f));
    return points[i].clone().lerp(points[i + 1], f - i);
  };
  const crown = { x: x + lean.x, y: y + height * 0.82, z: z + lean.z, k: 1.4, lift: height * 0.08 };
  const c = new THREE.Color();
  // A clump of tufts, tipped this way and that.
  const tuft = (at, size, sway, count = 3) => {
    for (let q = 0; q < count; q++) {
      const tilt = range(-0.45, 0.45),
        spin = range(0, TAU);
      const du = vec(Math.cos(spin), tilt, Math.sin(spin)).normalize();
      const dv = vec(-Math.sin(spin), range(-0.35, 0.35), Math.cos(spin)).normalize();
      c.copy(needles).multiplyScalar(range(0.8, 1.2));
      pad(batch, at.clone().add(vec(range(-1, 1), range(-0.35, 0.35), range(-1, 1)).multiplyScalar(size * 0.45)), du, dv, size, size, c, TUFT, random(), crown, sway);
    }
  };
  // A few dead stubs down the trunk, where the lower limbs broke off.
  for (let k = 0; k < 4; k++) {
    const from = trunkAt(range(0.3, 0.6));
    const a = range(0, TAU);
    limb(batch, from, from.clone().add(vec(Math.cos(a), range(-0.2, 0.1), Math.sin(a)).multiplyScalar(height * range(0.02, 0.05))), height * 0.004, height * 0.0015, lower, { sides: 3 });
  }
  // The crown: crooked limbs spreading out and up from the top third, each with its
  // tufts along it and at its end; a flat, open, uneven top.
  const limbs = Math.floor(range(8, 12));
  for (let k = 0; k < limbs; k++) {
    const t = range(0.58, 0.95);
    const from = trunkAt(t);
    const a = (k / limbs) * TAU + range(-0.4, 0.4);
    const length = height * range(0.14, 0.24) * (1.25 - t);
    const bend = a + range(-0.6, 0.6);
    const mid = from.clone().add(vec(Math.cos(a) * length * 0.55, length * range(0.05, 0.3), Math.sin(a) * length * 0.55));
    const end = mid.clone().add(vec(Math.cos(bend) * length * 0.5, length * range(0.05, 0.3), Math.sin(bend) * length * 0.5));
    limb(batch, from, mid, height * 0.006, height * 0.0045, upper, { sides: 4, sway0: 0.3, sway1: 0.5 });
    limb(batch, mid, end, height * 0.0045, height * 0.0025, upper, { sides: 4, sway0: 0.5, sway1: 0.7 });
    tuft(end, height * range(0.055, 0.08), 0.8, 4);
    tuft(mid.clone().lerp(end, 0.5), height * range(0.045, 0.06), 0.7);
    tuft(mid, height * range(0.035, 0.05), 0.6, 2);
  }
  tuft(points[3], height * 0.065, 0.6, 4);
}

// Downy birch: a slender white trunk marked with black, often a second stem from the same
// foot; branches reaching up and out, the twigs and their small leaves hanging from them.
export function birch(batch, x, y, z, height, random) {
  const range = ranger(random);
  const white = new THREE.Color(0.78, 0.77, 0.72);
  const marks = (p, end, a) => {
    const band = Math.sin(p.y * 2.3 + a * 0.7) * Math.sin(p.y * 0.9 + 1.3 * a);
    return (band > 0.55 ? 0.22 : 1) * (end ? 1 : 0.55);
  };
  const leaves = new THREE.Color().setHSL(range(0.19, 0.24), range(0.45, 0.6), range(0.2, 0.26));
  const c = new THREE.Color();
  const stems = random() < 0.35 ? 2 : 1;
  for (let s = 0; s < stems; s++) {
    const h = height * (s ? range(0.65, 0.85) : 1);
    const lean = vec(range(-1, 1), 0, range(-1, 1)).multiplyScalar(h * (s ? 0.12 : 0.05));
    const foot = vec(x + (s ? range(-0.6, 0.6) : 0), y - 1, z + (s ? range(-0.6, 0.6) : 0));
    const points = [0, 0.45, 1].map((t, i) => foot.clone().add(vec(lean.x * t + (i === 1 ? range(-1, 1) * h * 0.02 : 0), (h + 1) * t, lean.z * t + (i === 1 ? range(-1, 1) * h * 0.02 : 0))));
    limb(batch, points[0], points[1], h * 0.017, h * 0.011, white, { sides: 6, shade: marks, sway1: 0.2 });
    limb(batch, points[1], points[2], h * 0.011, h * 0.003, white, { sides: 5, shade: marks, sway0: 0.2, sway1: 0.55 });
    const crown = { x: foot.x + lean.x * 0.7, y: y + h * 0.62, z: foot.z + lean.z * 0.7, k: 0.8, lift: h * 0.1 };
    const branches = Math.floor(range(7, 11));
    for (let k = 0; k < branches; k++) {
      const t = range(0.3, 0.88);
      const from = t < 0.45 ? points[0].clone().lerp(points[1], t / 0.45) : points[1].clone().lerp(points[2], (t - 0.45) / 0.55);
      const a = (k / branches) * TAU + range(-0.4, 0.4);
      const length = h * range(0.22, 0.34) * (1.2 - t);
      // Up and out, then arching over at the end.
      const mid = from.clone().add(vec(Math.cos(a) * length * 0.45, length * range(0.45, 0.65), Math.sin(a) * length * 0.45));
      const end = mid.clone().add(vec(Math.cos(a) * length * 0.45, length * range(-0.05, 0.2), Math.sin(a) * length * 0.45));
      const twig = white.clone().multiplyScalar(0.4);
      limb(batch, from, mid, h * 0.006, h * 0.004, twig, { sides: 4, sway0: 0.3, sway1: 0.5 });
      limb(batch, mid, end, h * 0.004, h * 0.0015, twig, { sides: 3, sway0: 0.5, sway1: 0.75 });
      // Hanging twigs of leaves along the branch and at its end.
      for (let q = 0; q < 5; q++) {
        const f = 0.3 + 0.7 * (q / 4);
        const at = f < 0.5 ? from.clone().lerp(mid, f / 0.5) : mid.clone().lerp(end, (f - 0.5) / 0.5);
        const spin = range(0, TAU);
        const du = vec(Math.cos(spin) * 0.35, -1, Math.sin(spin) * 0.35).normalize();
        const dv = vec(-Math.sin(spin), 0, Math.cos(spin));
        const size = h * range(0.07, 0.1) * (0.75 + 0.45 * f);
        c.copy(leaves).multiplyScalar(range(0.85, 1.2));
        pad(batch, at.clone().addScaledVector(du, size * 0.7), du, dv, size, size * 0.9, c, LEAVES, random(), crown, 0.5 + 0.4 * f);
        pad(batch, at.clone().addScaledVector(du, size * 0.6), du, dv.clone().cross(du).normalize(), size * 0.9, size * 0.8, c, LEAVES, random(), crown, 0.5 + 0.4 * f);
      }
    }
    // Round the top of the stem.
    for (let q = 0; q < 6; q++) {
      const spin = range(0, TAU);
      const du = vec(Math.cos(spin) * 0.4, -1, Math.sin(spin) * 0.4).normalize();
      const size = h * range(0.07, 0.09);
      const at = points[1].clone().lerp(points[2], range(0.6, 1));
      c.copy(leaves).multiplyScalar(range(0.85, 1.2));
      pad(batch, at.addScaledVector(du, size * 0.4).add(vec(Math.cos(spin), 0, Math.sin(spin)).multiplyScalar(size * 0.5)), du, vec(-Math.sin(spin), 0, Math.cos(spin)), size, size, c, LEAVES, random(), crown, 0.8);
    }
  }
}

// Grey alder, the tree of river islands and wet banks: a few dark grey stems from one
// foot, branches going out almost level, a dense rounded crown of dark leaves.
export function alder(batch, x, y, z, height, random) {
  const range = ranger(random);
  const bark = new THREE.Color(0.3, 0.29, 0.27);
  const leaves = new THREE.Color().setHSL(range(0.24, 0.29), range(0.4, 0.55), range(0.13, 0.18));
  const c = new THREE.Color();
  const stems = Math.floor(range(1, 3.6));
  for (let s = 0; s < stems; s++) {
    const h = height * (s ? range(0.7, 0.9) : 1);
    const lean = vec(range(-1, 1), 0, range(-1, 1)).multiplyScalar(h * (s ? 0.14 : 0.05));
    const foot = vec(x + (s ? range(-0.8, 0.8) : 0), y - 1, z + (s ? range(-0.8, 0.8) : 0));
    const top = foot.clone().add(vec(lean.x, h + 1, lean.z));
    const mid = foot.clone().lerp(top, 0.5).add(vec(range(-1, 1) * h * 0.02, 0, range(-1, 1) * h * 0.02));
    limb(batch, foot, mid, h * 0.02, h * 0.014, bark, { sides: 6, shade: barkShade, sway1: 0.15 });
    limb(batch, mid, top, h * 0.014, h * 0.004, bark, { sides: 5, shade: barkShade, sway0: 0.15, sway1: 0.5 });
    const crown = { x: foot.x + lean.x * 0.6, y: y + h * 0.6, z: foot.z + lean.z * 0.6, k: 1.1, lift: h * 0.08 };
    const branches = Math.floor(range(8, 12));
    for (let k = 0; k < branches; k++) {
      const t = range(0.35, 0.95);
      const from = foot.clone().lerp(top, t);
      const a = (k / branches) * TAU + range(-0.4, 0.4);
      const length = h * range(0.18, 0.3) * (1.15 - t * 0.6);
      const end = from.clone().add(vec(Math.cos(a) * length, length * range(0.1, 0.45), Math.sin(a) * length));
      limb(batch, from, end, h * 0.006, h * 0.002, bark, { sides: 3, sway0: 0.3, sway1: 0.7 });
      // Clumps of leaves along it and round its end: a rounded, closed crown.
      for (let q = 0; q < 4; q++) {
        const f = 0.35 + 0.65 * (q / 3);
        const at = from.clone().lerp(end, f);
        const spin = range(0, TAU);
        const du = vec(Math.cos(spin), range(-0.3, 0.5), Math.sin(spin)).normalize();
        const dv = du.clone().cross(UP).normalize();
        const size = h * range(0.08, 0.12);
        c.copy(leaves).multiplyScalar(range(0.8, 1.25));
        pad(batch, at.clone().addScaledVector(du, -size * 0.5), du, dv, size, size * 0.8, c, LEAVES, random(), crown, 0.5 + 0.4 * f);
        pad(batch, at, dv, vec(0, 1, 0).addScaledVector(du, 0.3).normalize(), size * 0.9, size * 0.8, c, LEAVES, random(), crown, 0.5 + 0.4 * f);
      }
    }
  }
}

// A willow at the water: several stems from one stool, leaning out over the water (`out`,
// a horizontal direction toward it), long slender twigs of narrow grey-green leaves hanging
// from them toward the surface.
export function willow(batch, x, y, z, height, random, out = null) {
  const range = ranger(random);
  const bark = new THREE.Color(0.33, 0.3, 0.24);
  const leaves = new THREE.Color().setHSL(range(0.2, 0.25), range(0.25, 0.38), range(0.2, 0.27));
  const c = new THREE.Color();
  const dir = out ? out.clone().setY(0).normalize() : vec(range(-1, 1), 0, range(-1, 1)).normalize();
  const stems = Math.floor(range(3, 6));
  for (let s = 0; s < stems; s++) {
    const h = height * range(0.65, 1);
    // Out over the water, fanning.
    const spread = range(-0.9, 0.9);
    const lean = dir.clone().applyAxisAngle(UP, spread).multiplyScalar(h * range(0.25, 0.55) * (out ? 1 : 0.5));
    const foot = vec(x + range(-0.6, 0.6), y - 0.6, z + range(-0.6, 0.6));
    const mid = foot.clone().add(vec(lean.x * 0.45, h * 0.55, lean.z * 0.45));
    const top = foot.clone().add(vec(lean.x, h, lean.z));
    limb(batch, foot, mid, h * 0.022, h * 0.014, bark, { sides: 5, shade: barkShade, sway1: 0.2 });
    limb(batch, mid, top, h * 0.014, h * 0.004, bark, { sides: 4, shade: barkShade, sway0: 0.2, sway1: 0.6 });
    const crown = { x: foot.x + lean.x * 0.7, y: y + h * 0.7, z: foot.z + lean.z * 0.7, k: 0.9, lift: h * 0.12 };
    const twigs = Math.floor(range(8, 12));
    for (let k = 0; k < twigs; k++) {
      const from = mid.clone().lerp(top, range(0.1, 1));
      const a = range(0, TAU);
      const reach = h * range(0.1, 0.22);
      const tip = from.clone().add(vec(Math.cos(a) * reach, h * range(0.02, 0.1), Math.sin(a) * reach));
      limb(batch, from, tip, h * 0.004, h * 0.0015, bark, { sides: 3, sway0: 0.4, sway1: 0.8 });
      // Hanging sprays of narrow leaves, drooping toward the water.
      for (let q = 0; q < 3; q++) {
        const at = from.clone().lerp(tip, 0.4 + 0.3 * q);
        const length = h * range(0.14, 0.26);
        const sway = vec(range(-0.2, 0.2), 0, range(-0.2, 0.2));
        const spine = [0, 0.33, 0.66, 1].map((u) => at.clone().add(vec(sway.x * u * length, -length * u, sway.z * u * length)));
        c.copy(leaves).multiplyScalar(range(0.85, 1.2));
        const spin = range(0, TAU);
        sheet(batch, spine, vec(Math.cos(spin), 0, Math.sin(spin)), length * 0.18, 0, c, LEAVES, random(), crown, 0.6, 0.35, 0.75);
        sheet(batch, spine, vec(-Math.sin(spin), 0, Math.cos(spin)), length * 0.15, 0, c, LEAVES, random(), crown, 0.6, 0.35, 0.75);
      }
    }
  }
}

// Roots hanging out of a cut bank into the water: the undercut earth washed out from
// round them. From (x, y, z) at the top of the bank, down and out along `out`.
export function roots(batch, x, y, z, out, drop, random) {
  const range = ranger(random);
  const wood = new THREE.Color(0.2, 0.15, 0.1);
  const count = Math.floor(range(4, 8));
  for (let k = 0; k < count; k++) {
    const a = vec(x + range(-1, 1), y - range(0, 0.4), z + range(-1, 1));
    const b = a.clone().addScaledVector(out, range(0.3, 1.2)).add(vec(range(-0.4, 0.4), -drop * range(0.4, 0.7), range(-0.4, 0.4)));
    const e = b.clone().addScaledVector(out, range(-0.3, 0.5)).add(vec(range(-0.5, 0.5), -drop * range(0.3, 0.6), range(-0.5, 0.5)));
    const r = range(0.05, 0.14);
    limb(batch, a, b, r, r * 0.7, wood, { sides: 4 });
    limb(batch, b, e, r * 0.7, r * 0.2, wood, { sides: 3, cap: true });
  }
}

// ---------------------------------------------------------------------------------------
// Under the trees.

// Juniper: a dense, dark little column of prickly sprays.
export function juniper(batch, x, y, z, height, random) {
  spruce(batch, x, y + 0.5, z, height, random, { small: true });
}

// A fern: a shuttlecock of arching fronds.
export function fern(batch, x, y, z, size, random) {
  const range = ranger(random);
  const green = new THREE.Color().setHSL(range(0.22, 0.27), range(0.45, 0.6), range(0.16, 0.22));
  const crown = { x, y: y - size * 0.3, z, k: 1, lift: size * 0.4 };
  const fronds = Math.floor(range(6, 10));
  const c = new THREE.Color();
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * TAU + range(-0.3, 0.3);
    const dir = vec(Math.cos(a), 0, Math.sin(a));
    const length = size * range(0.8, 1.2);
    const rise = range(0.5, 0.9);
    const spine = [0, 0.33, 0.66, 1].map((u) => vec(x, y - 0.05, z).addScaledVector(dir, length * u * 0.8).addScaledVector(UP, length * (rise * u - 0.75 * u * u)));
    c.copy(green).multiplyScalar(range(0.85, 1.15));
    sheet(batch, spine, vec(-dir.z, 0, dir.x), length * 0.2, length * 0.03, c, FROND, random(), crown, 0.05, 0.35, 0.6);
  }
}

// Bilberry and heather: a low mound of small leafy cards.
export function shrub(batch, x, y, z, size, random) {
  const range = ranger(random);
  const green = new THREE.Color().setHSL(range(0.2, 0.3), range(0.4, 0.55), range(0.13, 0.2));
  const crown = { x, y: y - size * 0.2, z, k: 1, lift: size * 0.3 };
  const c = new THREE.Color();
  for (let k = 0; k < 5; k++) {
    const spin = range(0, TAU);
    const du = vec(Math.cos(spin), range(-0.2, 0.4), Math.sin(spin)).normalize();
    const dv = vec(-Math.sin(spin) * 0.6, 0.8, Math.cos(spin) * 0.6).normalize();
    c.copy(green).multiplyScalar(range(0.8, 1.2));
    pad(batch, vec(x + range(-0.4, 0.4) * size, y + size * range(0.25, 0.5), z + range(-0.4, 0.4) * size), du, dv, size * range(0.6, 0.9), size * range(0.35, 0.5), c, LEAVES, random(), crown, 0.15);
  }
}

// An old stump, sawn or snapped, and a fallen trunk rotting on the moss.
export function stump(batch, x, y, z, size, random) {
  const range = ranger(random);
  const wood = new THREE.Color().setHSL(range(0.06, 0.09), range(0.2, 0.3), range(0.13, 0.18));
  limb(batch, vec(x, y - 0.8, z), vec(x, y + size * range(1, 2.2), z), size * 0.55, size * 0.45, wood, { sides: 7, shade: barkShade, cap: true });
}
export function fallenTrunk(batch, x, y, z, length, random) {
  const range = ranger(random);
  const a = range(0, TAU);
  const d = vec(Math.cos(a), 0, Math.sin(a));
  const side = vec(-d.z, 0, d.x);
  const r = length * range(0.025, 0.04);
  const wood = new THREE.Color().setHSL(range(0.07, 0.1), range(0.15, 0.25), range(0.1, 0.15));
  // Weathered pale on top, damp and dark underneath.
  const weathered = (p, end, ang) => (Math.sin(ang) > 0.35 ? 1.5 : 0.75);
  // Lying in three pieces of a gentle bend, sagging where it rests.
  const bend = range(-1, 1) * length * 0.04;
  const points = [0, 0.33, 0.66, 1].map((t) => vec(x, y + r * 0.55, z).addScaledVector(d, (t - 0.5) * length).addScaledVector(side, Math.sin(Math.PI * t) * bend));
  for (let i = 0; i < 3; i++) limb(batch, points[i], points[i + 1], r * (1 - i * 0.1), r * (0.9 - i * 0.1), wood, { sides: 8, cap: i === 2, shade: weathered });
  // The root plate torn up at the foot, earth still in it.
  const foot = points[0].clone().addScaledVector(d, -r * 0.3);
  const earth = new THREE.Color(0.14, 0.11, 0.08);
  for (let k = 0; k < 7; k++) {
    const ang = (k / 7) * TAU + range(-0.3, 0.3);
    const out = side.clone().multiplyScalar(Math.cos(ang)).add(vec(0, Math.sin(ang), 0)).normalize();
    limb(batch, foot, foot.clone().addScaledVector(out, r * range(2.2, 3.4)).addScaledVector(d, -r * range(0.2, 0.8)), r * 0.35, r * 0.08, earth, { sides: 4 });
  }
  // The stubs of its branches.
  for (let k = 0; k < 5; k++) {
    const at = points[0].clone().lerp(points[3], range(0.25, 0.9));
    const out = side.clone().multiplyScalar(range(-1, 1)).add(vec(0, range(0.2, 1), 0)).addScaledVector(d, range(0.2, 0.6)).normalize();
    limb(batch, at, at.clone().addScaledVector(out, r * range(1.5, 4)), r * 0.28, r * 0.12, wood, { sides: 4, cap: true });
  }
}

// ---------------------------------------------------------------------------------------
// The material: shared by every block's forest.
export const treeUniforms = {
  treeTime: { value: 0 },
  treeWind: { value: 0.25 },
  treeAutumn: { value: 0 },
  treeBare: { value: 0 },
  treeSnow: { value: 0 },
};

export function createTreeMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide, emissive: 0x0a1307, emissiveIntensity: 1 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, treeUniforms);
    shader.uniforms.barkMap = { value: photo("pine_bark_diff", true) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTreeWorld;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvTreeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 leaf;
        attribute float sway;
        varying vec4 vLeaf;
        uniform float treeTime, treeWind, treeAutumn, treeBare, treeSnow;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vLeaf = leaf;
        float swayPhase = dot(position.xz, vec2(0.043, 0.061));
        transformed.xz += vec2(sin(treeTime * 1.3 + swayPhase), cos(treeTime * 1.05 + swayPhase * 1.7)) * sway * treeWind;`,
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
        #ifdef USE_COLOR
          float kind = leaf.z;
          if (kind > 1.5 && kind < 2.5) {
            // Birch and bilberry in autumn: yellow, some of it rust.
            vec3 fall = mix(vec3(0.6, 0.46, 0.08), vec3(0.5, 0.2, 0.05), step(0.78, leaf.w));
            vColor.rgb = mix(vColor.rgb, fall, treeAutumn * smoothstep(0.0, 0.5, leaf.w + 0.25));
          } else if (kind > 3.5) {
            vColor.rgb = mix(vColor.rgb, vec3(0.32, 0.2, 0.09), max(treeAutumn * 0.8, treeBare));
          } else if (kind > 0.5) {
            // Snow lies on the tops of the sprays and tufts.
            vColor.rgb = mix(vColor.rgb, vec3(0.85, 0.88, 0.92), treeSnow * smoothstep(0.15, 0.6, normal.y) * step(0.3, fract(leaf.w * 7.3)));
          }
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec4 vLeaf;
        varying vec3 vTreeWorld;
        uniform float treeBare;
        uniform sampler2D barkMap;
        float leafHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // Whether this point of a card is needle or leaf (and how light), or the gap
        // between (-1).
        float foliage(vec4 l) {
          float kind = l.z;
          if (kind < 0.5) return 1.0;
          float u = clamp(l.x, 0.0, 1.0), v = l.y, av = abs(v);
          if (kind < 1.5) {
            // A spruce spray: a feather of side shoots, ragged at the edge.
            // Broad from where it leaves the trunk (so the trunk is hidden), tapering out.
            float env = mix(0.55, 1.0, smoothstep(0.0, 0.3, u)) * (1.0 - 0.85 * smoothstep(0.55, 1.0, u));
            if (av > env) return -1.0;
            float twig = fract(u * 13.0 - av * 2.6 + l.w * 3.0);
            if (av > 0.08 && twig > 0.76) return -1.0;
            float edge = leafHash(floor(vec2(u * 70.0, v * 14.0)) + l.w * 17.0);
            if (av > env * 0.72 && edge < 0.35) return -1.0;
            return 0.8 + 0.25 * edge + 0.2 * smoothstep(0.5, 1.0, av / env);
          }
          if (kind < 2.5) {
            // Leaves: small ovals scattered thick over a rounded clump.
            vec2 q = vec2(u * 2.0 - 1.0, v);
            float r = length(q);
            if (r > 1.0) return -1.0;
            vec2 g = q * 5.5 + l.w * 7.0;
            vec2 cell = floor(g);
            float h = leafHash(cell);
            vec2 f = fract(g) - 0.5 - (vec2(h, leafHash(cell + 3.1)) - 0.5) * 0.5;
            if (length(f * vec2(1.0, 1.45)) > 0.5 || h < 0.08 + 0.55 * smoothstep(0.5, 1.0, r)) return -1.0;
            return 0.75 + 0.5 * h;
          }
          if (kind < 3.5) {
            // A pine's tuft: needles bursting from a point.
            vec2 q = vec2(u * 2.0 - 1.0, v);
            float r = length(q), a = atan(q.y, q.x);
            float ray = abs(fract(a * 2.5 + l.w * 5.0) - 0.5) * 2.0;
            float reach = 0.65 + 0.35 * leafHash(vec2(floor(a * 5.0 + l.w * 9.0), l.w));
            if (r > reach * (1.0 - 0.6 * ray) + 0.12) return -1.0;
            return 0.8 + 0.35 * r;
          }
          // A fern's frond: a stalk and its rows of leaflets.
          float env = pow(sin(3.1416 * u), 0.7) * (1.0 - 0.35 * u);
          if (av > env) return -1.0;
          if (av > 0.08 && fract(u * 14.0 - av * 1.4) > 0.6) return -1.0;
          return 0.85 + 0.3 * u;
        }`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        float leafTone = foliage(vLeaf);
        if (leafTone < 0.0) discard;
        if (vLeaf.z > 1.5 && vLeaf.z < 2.5 && vLeaf.w < treeBare) discard;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb *= leafTone;
        if (vLeaf.z < 0.5) {
          // Bark on the trunks, limbs, stumps: the photograph wrapped round from the sides.
          vec3 Nw = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
          vec3 b = pow(abs(Nw), vec3(4.0));
          b /= dot(b, vec3(1.0));
          vec3 P = vTreeWorld * vec3(0.55, 0.16, 0.55);
          vec3 bark = texture2D(barkMap, P.zy).rgb * b.x + texture2D(barkMap, P.xz * 2.0).rgb * b.y + texture2D(barkMap, P.xy).rgb * b.z;
          diffuseColor.rgb *= 0.45 + 1.35 * dot(bark, vec3(0.3, 0.55, 0.15));
        }`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        // Foliage is lit as its crown, from whichever side the card is seen.
        if (vLeaf.z > 0.5) normal = normalize(vNormal);`,
      );
  };
  material.customProgramCacheKey = () => "salmon-forest-v1";
  return material;
}
let shared = null;
export const forestMaterial = () => (shared ??= createTreeMaterial());
