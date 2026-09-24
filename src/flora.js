import * as THREE from "three";
import { blade, stem } from "../../riverscape/src/foliage.js";

// What grows in a northern river and the sea beyond it, built from the aquarium's blade
// and stem generators so it sways in the same current:
//
//   fontinalis moss      dark trailing tufts on the stones of the brook
//   water crowfoot       long green tresses streaming in the riffles, white flowers at the
//                        surface in summer
//   pondweed             stems of broad translucent leaves in the pools and slow reaches
//   sedges               tufts at the shallow margins, leaning out through the surface
//   reeds                stands of stems in the quiet water of the lower river and estuary
//   eelgrass             meadows of long ribbons on the estuary's sand
//   kelp                 forests of stiff stalks crowned with brown fronds on the sea's rocks
//   sugar kelp           single long wavy blades
//   green algae          fine threads streaming from the stones in the riffles
//   water starwort       slender stems with pale leaf pairs and floating rosettes
//   water-milfoil        green bottle brushes in the slack water
//   turf                 bulbous rush and moss low over the gravel
//   bank grass           hanging in from the banks, trailing downstream
//   fallen leaves        alder, birch and willow on the bed of the quiet water
//
// and, above the water, the forest along the banks, kept simple: it is seen only in a leap.

const TAU = Math.PI * 2;
const vec = (x, y, z) => new THREE.Vector3(x, y, z);

// Every generator takes `random`, a seeded source, so a stretch of river grows the same
// plants every time it is built.
function ranger(random) {
  return (a, b) => a + (b - a) * random();
}

// Fontinalis: short dark strands trailing downstream from a point on a stone.
// A dense tuft: a mound of short shoots round the point and the long ones trailing.
export function mossTuft(batch, at, flow, random, size = 1) {
  const range = ranger(random);
  const count = Math.floor(range(12, 22));
  const root = at.clone();
  const hue = range(0.17, 0.24);
  for (let i = 0; i < count; i++) {
    const trailing = i % 3 === 0;
    const a = trailing ? flow + range(-0.5, 0.5) : range(0, TAU);
    const d = vec(Math.cos(a), 0, Math.sin(a));
    const length = (trailing ? range(0.6, 1.6) : range(0.25, 0.6)) * size;
    const base = at.clone().add(vec(range(-0.25, 0.25) * size, 0, range(-0.25, 0.25) * size));
    const points = [
      base,
      base.clone().addScaledVector(d, length * 0.35).add(vec(0, length * (trailing ? 0.18 : 0.5), 0)),
      base.clone().addScaledVector(d, length).add(vec(0, length * (trailing ? range(-0.15, 0.05) : range(0.2, 0.5)), 0)),
    ];
    const color = new THREE.Color().setHSL(hue + range(-0.02, 0.02), range(0.45, 0.65), range(0.09, 0.19));
    blade(batch, points, range(0.05, 0.09) * size, color, root, 1.1, { rows: trailing ? 5 : 3, cols: 1, ribbon: true, thin: 0.9 });
  }
}

// Moss and weed hanging from the roof of a cave or an overhang: dark strands down from the
// rock, their ends drawn a little way downstream.
export function hangingMoss(batch, at, flow, random, size = 1) {
  const range = ranger(random);
  const count = Math.floor(range(8, 15));
  const hue = range(0.18, 0.25);
  for (let i = 0; i < count; i++) {
    const a = flow + range(-0.6, 0.6);
    const d = vec(Math.cos(a), 0, Math.sin(a));
    const length = range(0.4, 1.5) * size;
    const base = at.clone().add(vec(range(-0.35, 0.35) * size, range(-0.05, 0.05), range(-0.35, 0.35) * size));
    const points = [base, base.clone().addScaledVector(d, length * 0.12).add(vec(0, -length * 0.5, 0)), base.clone().addScaledVector(d, length * 0.4).add(vec(0, -length, 0))];
    const color = new THREE.Color().setHSL(hue + range(-0.02, 0.02), range(0.4, 0.6), range(0.08, 0.16));
    blade(batch, points, range(0.04, 0.08) * size, color, at, 1.2, { rows: 4, cols: 1, ribbon: true, thin: 0.9 });
  }
}

// Water crowfoot: a clump of long tresses rising at a low angle and streaming out down the
// current, the longest reaching up under the surface.
export function crowfoot(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const depth = surface - ground;
  const root = vec(x, ground - 0.05, z);
  const count = Math.floor(range(18, 34));
  const d = vec(Math.cos(flow), 0, Math.sin(flow));
  const side = vec(-d.z, 0, d.x);
  for (let i = 0; i < count; i++) {
    const length = range(0.45, 1) * Math.min(28, depth * 2.6 + 6) * scale;
    const rise = Math.min(depth * range(0.55, 0.95), length * 0.45);
    const drift = range(-1, 1) * length * 0.08;
    const base = root.clone().addScaledVector(side, range(-0.4, 0.4)).addScaledVector(d, range(-0.3, 0.3));
    const points = [
      base,
      base.clone().addScaledVector(d, length * 0.18).add(vec(0, rise * 0.55, 0)).addScaledVector(side, drift * 0.3),
      base.clone().addScaledVector(d, length * 0.55).add(vec(0, rise * 0.92, 0)).addScaledVector(side, drift),
      base.clone().addScaledVector(d, length).add(vec(0, rise, 0)).addScaledVector(side, drift * 1.4),
    ];
    for (const p of points) p.y = Math.min(p.y, surface - 0.15);
    const color = new THREE.Color().setHSL(range(0.24, 0.29), range(0.55, 0.75), range(0.14, 0.24));
    blade(batch, points, range(0.03, 0.07) * scale, color, root, 1.3, { rows: 18, cols: 2, ribbon: true, thin: 1, twist: flow + Math.PI / 2 });
  }
  // A few flowers held at the surface: five white petals round a yellow eye.
  const flowers = Math.floor(range(0, 5));
  for (let k = 0; k < flowers; k++) {
    const at = root.clone().addScaledVector(d, range(4, 14) * scale).addScaledVector(side, range(-1.2, 1.2));
    at.y = surface - 0.03;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * TAU + range(-0.1, 0.1);
      const tip = at.clone().add(vec(Math.cos(a) * 0.14, 0.01, Math.sin(a) * 0.14));
      const mid = at.clone().add(vec(Math.cos(a) * 0.08, 0.015, Math.sin(a) * 0.08));
      blade(batch, [at, mid, tip], 0.06, new THREE.Color(0.95, 0.95, 0.9), root, 0.4, { rows: 2, cols: 2, thin: 1 });
    }
  }
}

// Pondweed: a stem up through the water column with broad, translucent, wavy leaves.
export function pondweed(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const stems = Math.floor(range(3, 7));
  const root = vec(x, ground - 0.05, z);
  const d = vec(Math.cos(flow), 0, Math.sin(flow));
  for (let k = 0; k < stems; k++) {
    const height = Math.min(surface - ground - 0.3, range(6, 16) * scale);
    if (height < 1.5) continue;
    const lean = range(0.2, 0.5) * height;
    const base = root.clone().add(vec(range(-0.6, 0.6), 0, range(-0.6, 0.6)));
    const points = [
      base,
      base.clone().addScaledVector(d, lean * 0.2).add(vec(0, height * 0.4, 0)),
      base.clone().addScaledVector(d, lean * 0.6).add(vec(0, height * 0.78, 0)),
      base.clone().addScaledVector(d, lean).add(vec(0, height, 0)),
    ];
    const { curve, length } = stem(batch, points, 0.035 * scale, new THREE.Color().setHSL(0.2, 0.4, 0.2), root, 0.9);
    const nodes = Math.floor(length / (0.9 * scale));
    for (let n = 1; n <= nodes; n++) {
      const t = n / (nodes + 0.3);
      const node = curve.getPoint(t);
      const a = flow + (n % 2 ? 1 : -1) * range(0.5, 1.1);
      const out = vec(Math.cos(a), range(0.1, 0.35), Math.sin(a)).normalize();
      const leaf = range(1.1, 2.1) * scale * (0.6 + 0.4 * Math.sin(Math.PI * t));
      const tip = node.clone().addScaledVector(out, leaf);
      tip.addScaledVector(d, leaf * 0.35);
      const mid = node.clone().addScaledVector(out, leaf * 0.5).add(vec(0, leaf * 0.08, 0));
      const color = new THREE.Color().setHSL(range(0.19, 0.24), range(0.5, 0.7), range(0.2, 0.3));
      blade(batch, [node, mid, tip], range(0.18, 0.3) * scale, color, root, 0.8, { rows: 6, cols: 3, thin: 1, browning: random() < 0.2 ? 0.3 : 0 });
    }
  }
}

// Sedges: a tuft of leaves from a shallow margin, arching out and up through the surface.
export function sedge(batch, x, z, ground, surface, random, scale = 1) {
  const range = ranger(random);
  const root = vec(x, ground - 0.03, z);
  const count = Math.floor(range(10, 20));
  for (let i = 0; i < count; i++) {
    const a = range(0, TAU);
    const h = range(5, 12) * scale;
    const out = range(0.8, 2.6) * scale;
    const dir = vec(Math.cos(a), 0, Math.sin(a));
    const points = [
      root.clone(),
      root.clone().addScaledVector(dir, out * 0.15).add(vec(0, h * 0.55, 0)),
      root.clone().addScaledVector(dir, out * 0.55).add(vec(0, h * 0.95, 0)),
      root.clone().addScaledVector(dir, out).add(vec(0, h * 0.8, 0)),
    ];
    const above = points[2].y > surface;
    const color = new THREE.Color().setHSL(range(0.18, 0.24), range(0.4, 0.6), above ? range(0.25, 0.35) : range(0.16, 0.24));
    blade(batch, points, range(0.05, 0.09) * scale, color, root, 0.25, { rows: 10, cols: 1, ribbon: true, thin: 0.7, browning: range(0, 0.3) });
  }
}

// Reeds: stiff stems from the bed up past the surface.
export function reeds(batch, x, z, ground, surface, random, scale = 1) {
  const range = ranger(random);
  const count = Math.floor(range(18, 40));
  const root = vec(x, ground - 0.05, z);
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(random()) * 3.2 * scale;
    const a = range(0, TAU);
    const base = vec(x + Math.cos(a) * r, ground - 0.05, z + Math.sin(a) * r);
    const top = surface + range(6, 16) * scale;
    const lean = vec(range(-1, 1), 0, range(-1, 1)).multiplyScalar(0.8);
    const points = [base, base.clone().add(vec(lean.x * 0.2, (top - base.y) * 0.5, lean.z * 0.2)), base.clone().add(vec(lean.x, top - base.y, lean.z))];
    const color = new THREE.Color().setHSL(range(0.12, 0.18), range(0.35, 0.5), range(0.22, 0.32));
    stem(batch, points, range(0.05, 0.09) * scale, color, root, 0.12);
  }
}

// Eelgrass: a tuft of long bright ribbons.
export function eelgrass(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const count = Math.floor(range(4, 9));
  const root = vec(x, ground - 0.03, z);
  for (let i = 0; i < count; i++) {
    const a = flow + range(-0.8, 0.8);
    const dir = vec(Math.cos(a), 0, Math.sin(a));
    const length = range(3, 10) * scale;
    const h = Math.min(length * range(0.55, 0.8), surface - ground - 0.3);
    const points = [
      root.clone(),
      root.clone().addScaledVector(dir, length * 0.08).add(vec(0, h * 0.55, 0)),
      root.clone().addScaledVector(dir, length * 0.4).add(vec(0, h * 0.95, 0)),
      root.clone().addScaledVector(dir, length * 0.8).add(vec(0, h * 0.85, 0)),
    ];
    const color = new THREE.Color().setHSL(range(0.22, 0.27), range(0.55, 0.75), range(0.2, 0.3));
    blade(batch, points, range(0.05, 0.09) * scale, color, root, 1.1, { rows: 14, cols: 1, ribbon: true, thin: 1, browning: random() < 0.3 ? range(0.1, 0.3) : 0 });
  }
}

// Kelp: a stiff stalk and a crown of brown straps.
export function kelp(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const root = vec(x, ground - 0.05, z);
  const height = Math.min(surface - ground - 2, range(8, 18) * scale);
  if (height < 3) return;
  const d = vec(Math.cos(flow), 0, Math.sin(flow));
  const lean = range(0.05, 0.25) * height;
  const points = [
    root.clone(),
    root.clone().addScaledVector(d, lean * 0.3).add(vec(0, height * 0.5, 0)),
    root.clone().addScaledVector(d, lean).add(vec(0, height, 0)),
  ];
  const brown = new THREE.Color().setHSL(0.09, 0.45, 0.16);
  const { curve } = stem(batch, points, range(0.1, 0.18) * scale, brown, root, 0.25);
  const top = curve.getPoint(1);
  const straps = Math.floor(range(5, 10));
  for (let i = 0; i < straps; i++) {
    const a = flow + range(-1.2, 1.2);
    const dir = vec(Math.cos(a), 0, Math.sin(a));
    const length = range(4, 11) * scale;
    const p = [
      top.clone(),
      top.clone().addScaledVector(dir, length * 0.3).add(vec(0, length * 0.25, 0)),
      top.clone().addScaledVector(dir, length * 0.7).add(vec(0, length * 0.2, 0)),
      top.clone().addScaledVector(dir, length).add(vec(0, length * range(-0.05, 0.15), 0)),
    ];
    for (const q of p) q.y = Math.min(q.y, surface - 0.3);
    const color = new THREE.Color().setHSL(range(0.07, 0.11), range(0.5, 0.65), range(0.08, 0.13));
    blade(batch, p, range(0.35, 0.7) * scale, color, root, 1.0, { rows: 12, cols: 3, ribbon: true, thin: 0.9, twist: a + Math.PI / 2 });
  }
}

// Sugar kelp: one long crinkled blade on a short stalk.
export function sugarKelp(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const root = vec(x, ground - 0.05, z);
  const a = flow + range(-0.6, 0.6);
  const dir = vec(Math.cos(a), 0, Math.sin(a));
  const length = range(10, 22) * scale;
  const h = Math.min(surface - ground - 0.5, length * range(0.3, 0.6));
  const p = [
    root.clone(),
    root.clone().addScaledVector(dir, length * 0.1).add(vec(0, h * 0.6, 0)),
    root.clone().addScaledVector(dir, length * 0.5).add(vec(0, h, 0)),
    root.clone().addScaledVector(dir, length).add(vec(0, h * 0.7, 0)),
  ];
  const color = new THREE.Color().setHSL(range(0.08, 0.12), range(0.5, 0.65), range(0.1, 0.16));
  blade(batch, p, range(0.8, 1.3) * scale, color, root, 1.0, { rows: 22, cols: 4, ribbon: true, thin: 1, twist: a + Math.PI / 2 });
}

// ---------------------------------------------------------------------------------------
// Five more of the river's and the shore's plants.

// A floating leaf: a flat round pad with its notch, the rim turned up a little, lying on
// the surface; it hardly sways, only rides the ripples. From below it is a dark disc against
// the light, veined, reddish where the sun comes through.
function pad(batch, centre, radius, notch, color, root, random) {
  const range = ranger(random);
  const rings = 3,
    segments = 16;
  const start = batch.positions.length / 3;
  const strand = { direction: vec(0, 1, 0), tangent: vec(1, 0, 0), distance: 0.2, compliance: 0.05 };
  const gap = 0.32;
  for (let r = 0; r <= rings; r++) {
    const f = r / rings;
    for (let k = 0; k <= segments; k++) {
      const a = notch + gap / 2 + (k / segments) * (TAU - gap);
      const rr = radius * f * (1 + 0.04 * Math.sin(a * 5 + radius));
      const p = centre.clone().add(vec(Math.cos(a) * rr, 0.08 * f * f * radius * 0.4, Math.sin(a) * rr));
      const c = color.clone().multiplyScalar(0.82 + 0.25 * f + 0.06 * Math.sin(a * 11));
      batch.vertex(p, [k / segments, f], c, root, strand, 0.45);
      if (r < rings && k < segments) {
        const i = start + r * (segments + 1) + k;
        batch.quad(i, i + 1, i + segments + 1, i + segments + 2);
      }
    }
  }
  void range;
}

// The yellow water-lily: pads on the slack water of the pools and the lower river, each on
// its long stalk from the mud; lettuce-like leaves under water at the foot; a yellow cup of
// a flower held just above the surface in summer.
export function waterLily(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const root = vec(x, ground - 0.05, z);
  const depth = surface - ground;
  if (depth < 1.2) return;
  const stalk = new THREE.Color().setHSL(0.16, 0.35, 0.28);
  const pads = Math.floor(range(3, 7));
  for (let k = 0; k < pads; k++) {
    const a = range(0, TAU);
    const out = range(0.5, 2.5) * scale + depth * 0.25;
    const at = vec(x + Math.cos(a) * out, surface - 0.02, z + Math.sin(a) * out);
    const mid = root.clone().lerp(at, 0.5).add(vec(range(-0.4, 0.4), 0, range(-0.4, 0.4)));
    stem(batch, [root.clone(), mid, at.clone().add(vec(0, -0.05, 0))], 0.035 * scale, stalk, root, 0.35);
    const green = new THREE.Color().setHSL(range(0.22, 0.28), range(0.45, 0.6), range(0.17, 0.24));
    if (random() < 0.2) green.lerp(new THREE.Color(0.45, 0.32, 0.1), 0.5);
    pad(batch, at, range(1.1, 2.1) * scale, range(0, TAU), green, root, random);
  }
  // The submerged leaves: thin, wavy, pale.
  for (let k = 0; k < 4; k++) {
    const a = range(0, TAU);
    const dir = vec(Math.cos(a), 0, Math.sin(a));
    const length = Math.min(depth * 0.6, range(1.2, 2.4) * scale);
    const tip = root.clone().addScaledVector(dir, length * 0.8).add(vec(0, length * 0.7, 0));
    blade(batch, [root.clone(), root.clone().addScaledVector(dir, length * 0.3).add(vec(0, length * 0.4, 0)), tip], range(0.5, 0.8) * scale, new THREE.Color().setHSL(0.2, 0.45, 0.3), root, 0.9, { rows: 8, cols: 4, thin: 1 });
  }
  // A flower or two: five yellow sepals cupped round the centre, just clear of the water.
  const flowers = random() < 0.6 ? Math.floor(range(1, 3)) : 0;
  for (let k = 0; k < flowers; k++) {
    const a = range(0, TAU);
    const out = range(0.3, 1.8) * scale;
    const at = vec(x + Math.cos(a) * out, surface + 0.35 * scale, z + Math.sin(a) * out);
    stem(batch, [root.clone(), root.clone().lerp(at, 0.5), at], 0.03 * scale, stalk, root, 0.3);
    const yellow = new THREE.Color().setHSL(0.13, 0.9, 0.5);
    for (let q = 0; q < 5; q++) {
      const b = (q / 5) * TAU + range(-0.1, 0.1);
      const dir = vec(Math.cos(b), 0, Math.sin(b));
      const r = 0.3 * scale;
      blade(batch, [at.clone(), at.clone().addScaledVector(dir, r * 0.7).add(vec(0, r * 0.45, 0)), at.clone().addScaledVector(dir, r * 0.9).add(vec(0, r * 1.1, 0))], r * 0.55, yellow, root, 0.2, { rows: 4, cols: 2, thin: 0.6, twist: b + Math.PI / 2 });
    }
  }
}

// Bladderwrack: olive-brown fronds forking again and again from a holdfast on the rocks of
// the shore, a pair of air bladders at each fork, lifting them toward the light.
export function bladderwrack(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const root = vec(x, ground - 0.03, z);
  const olive = new THREE.Color().setHSL(range(0.075, 0.1), range(0.55, 0.7), range(0.13, 0.19));
  const bladder = olive.clone().multiplyScalar(1.3);
  const fork = (from, dir, length, depth) => {
    const to = from.clone().addScaledVector(dir, length);
    to.y = Math.min(to.y, surface - 0.2);
    const mid = from.clone().lerp(to, 0.5).add(vec(0, length * 0.05, 0));
    const c = olive.clone().multiplyScalar(range(0.85, 1.15));
    blade(batch, [from, mid, to], length * 0.18 * scale, c, root, 0.7, { rows: 4, cols: 2, thin: 0.8, twist: Math.atan2(dir.z, dir.x) + Math.PI / 2 });
    if (depth > 0) {
      // The bladders, a pair of small swellings just below the fork.
      for (const side of [-1, 1]) {
        const at = from.clone().lerp(to, 0.8).add(vec(-dir.z * side * length * 0.08, 0, dir.x * side * length * 0.08));
        blade(batch, [at.clone().addScaledVector(dir, -length * 0.07), at, at.clone().addScaledVector(dir, length * 0.07)], length * 0.09, bladder, root, 0.7, { rows: 3, cols: 2, thin: 0.5 });
      }
      for (const turn of [-0.45, 0.45]) {
        const d = dir.clone().applyAxisAngle(vec(0, 1, 0), turn + range(-0.15, 0.15)).add(vec(0, range(0.05, 0.25), 0)).normalize();
        fork(to, d, length * range(0.7, 0.85), depth - 1);
      }
    }
  };
  const fronds = Math.floor(range(4, 7));
  for (let k = 0; k < fronds; k++) {
    const a = flow + range(-1.4, 1.4);
    const dir = vec(Math.cos(a), range(0.5, 1.1), Math.sin(a)).normalize();
    fork(root.clone(), dir, range(1.4, 2.4) * scale, 3);
  }
}

// Dulse and other red weeds: frilled wine-red blades in the shade of the kelp.
export function redWeed(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const root = vec(x, ground - 0.03, z);
  const count = Math.floor(range(4, 8));
  for (let i = 0; i < count; i++) {
    const a = flow + range(-1.5, 1.5);
    const dir = vec(Math.cos(a), 0, Math.sin(a));
    const length = range(1.5, 4) * scale;
    const h = Math.min(surface - ground - 0.4, length * range(0.5, 0.9));
    const points = [root.clone(), root.clone().addScaledVector(dir, length * 0.2).add(vec(0, h * 0.6, 0)), root.clone().addScaledVector(dir, length * 0.6).add(vec(0, h, 0)), root.clone().addScaledVector(dir, length).add(vec(0, h * 0.8, 0))];
    const color = new THREE.Color().setHSL(range(0.95, 1.0), range(0.45, 0.65), range(0.14, 0.22));
    blade(batch, points, range(0.35, 0.6) * scale, color, root, 1.0, { rows: 10, cols: 3, ribbon: true, thin: 1, twist: a + Math.PI / 2 });
  }
}

// Water horsetail: a stand of hollow jointed stems in the shallows of the brook, dark
// bands at the joints, straight up through the surface.
export function horsetail(batch, x, z, ground, surface, random, scale = 1) {
  const range = ranger(random);
  const count = Math.floor(range(10, 22));
  const root = vec(x, ground - 0.05, z);
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(random()) * 1.8 * scale;
    const a = range(0, TAU);
    const base = vec(x + Math.cos(a) * r, ground - 0.05, z + Math.sin(a) * r);
    const top = Math.max(surface + range(1, 6) * scale, ground + range(3, 8) * scale);
    const lean = vec(range(-1, 1), 0, range(-1, 1)).multiplyScalar(0.3);
    const joints = Math.max(3, Math.floor((top - base.y) / (0.9 * scale)));
    let from = base;
    for (let j = 1; j <= joints; j++) {
      const t = j / joints;
      const to = base.clone().add(vec(lean.x * t, (top - base.y) * t, lean.z * t));
      const c = j % 2 ? new THREE.Color().setHSL(range(0.26, 0.3), 0.45, 0.28) : new THREE.Color().setHSL(0.27, 0.4, 0.24);
      stem(batch, [from, from.clone().lerp(to, 0.9), to], 0.045 * scale, c, root, 0.12);
      from = to;
    }
  }
}

// Bur-reed: long soft ribbons rising from the bed of the slow river and trailing out
// along the surface downstream.
export function burReed(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const root = vec(x, ground - 0.03, z);
  const count = Math.floor(range(5, 10));
  const depth = surface - ground;
  for (let i = 0; i < count; i++) {
    const a = flow + range(-0.4, 0.4);
    const dir = vec(Math.cos(a), 0, Math.sin(a));
    const float = range(3, 9) * scale;
    const points = [root.clone(), root.clone().addScaledVector(dir, depth * 0.3).add(vec(0, depth * 0.6, 0)), root.clone().addScaledVector(dir, depth * 0.7 + float * 0.3).add(vec(0, depth - 0.08, 0)), root.clone().addScaledVector(dir, depth * 0.7 + float).add(vec(0, depth - 0.05, 0))];
    const color = new THREE.Color().setHSL(range(0.2, 0.25), range(0.5, 0.65), range(0.2, 0.28));
    blade(batch, points, range(0.1, 0.16) * scale, color, root, 1.1, { rows: 16, cols: 1, ribbon: true, thin: 1, twist: a + Math.PI / 2, browning: random() < 0.3 ? 0.25 : 0 });
  }
}

// ---------------------------------------------------------------------------------------
// The small green life of a clear northern river, what makes it a garden and not a
// quarry: filamentous algae streaming from the stones in the riffles, water starwort and
// alternate water-milfoil in the slack water, low turf of bulbous rush and moss over the
// gravel, grass and sedge hanging in from the banks, and the leaves the trees drop.

// Filamentous green algae (Cladophora): fine bright threads streaming from a stone.
export function algae(batch, at, flow, random, size = 1) {
  const range = ranger(random);
  const count = Math.floor(range(7, 14));
  for (let i = 0; i < count; i++) {
    const a = flow + range(-0.35, 0.35);
    const d = vec(Math.cos(a), 0, Math.sin(a));
    const length = range(0.8, 2.6) * size;
    const base = at.clone().add(vec(range(-0.2, 0.2) * size, range(-0.05, 0.05), range(-0.2, 0.2) * size));
    const points = [
      base,
      base.clone().addScaledVector(d, length * 0.3).add(vec(0, length * 0.08, 0)),
      base.clone().addScaledVector(d, length).add(vec(0, length * range(-0.12, 0.04), 0)),
    ];
    const color = new THREE.Color().setHSL(range(0.22, 0.27), range(0.55, 0.75), range(0.2, 0.3));
    blade(batch, points, range(0.018, 0.035) * size, color, at, 1.4, { rows: 6, cols: 1, ribbon: true, thin: 1, browning: random() < 0.25 ? 0.25 : 0 });
  }
}

// Water starwort (Callitriche): slender stems rising and leaning with the current, pairs of
// small pale leaves at each node, and where a stem reaches the surface a floating rosette.
export function starwort(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const root = vec(x, ground - 0.03, z);
  const d = vec(Math.cos(flow), 0, Math.sin(flow));
  const stems = Math.floor(range(8, 16));
  const depth = surface - ground;
  for (let k = 0; k < stems; k++) {
    const height = Math.min(depth - 0.08, range(1.2, 4.5) * scale);
    if (height < 0.4) continue;
    const base = root.clone().add(vec(range(-0.5, 0.5) * scale, 0, range(-0.5, 0.5) * scale));
    const lean = range(0.2, 0.7) * height;
    const points = [
      base,
      base.clone().addScaledVector(d, lean * 0.25).add(vec(0, height * 0.5, 0)),
      base.clone().addScaledVector(d, lean * 0.7).add(vec(0, height * 0.88, 0)),
      base.clone().addScaledVector(d, lean).add(vec(0, height, 0)),
    ];
    const stemColor = new THREE.Color().setHSL(range(0.22, 0.26), 0.5, 0.2);
    blade(batch, points, 0.04 * scale, stemColor, root, 1, { rows: 6, cols: 1, ribbon: true, thin: 1 });
    const curve = new THREE.CubicBezierCurve3(...points);
    const nodes = Math.max(2, Math.floor(height / (0.45 * scale)));
    const leafColor = new THREE.Color().setHSL(range(0.23, 0.28), range(0.55, 0.7), range(0.26, 0.36));
    for (let n = 1; n <= nodes; n++) {
      const node = curve.getPoint(n / (nodes + 0.5));
      const a0 = range(0, TAU);
      for (const side of [0, Math.PI]) {
        const a = a0 + side;
        const leaf = range(0.25, 0.45) * scale;
        const tip = node.clone().add(vec(Math.cos(a) * leaf, leaf * 0.35, Math.sin(a) * leaf)).addScaledVector(d, leaf * 0.3);
        const mid = node.clone().lerp(tip, 0.5).add(vec(0, leaf * 0.12, 0));
        blade(batch, [node, mid, tip], 0.14 * scale, leafColor, root, 0.9, { rows: 2, cols: 1, thin: 1 });
      }
    }
    // The rosette on the surface.
    if (height > depth - 0.4) {
      const top = points[3].clone();
      top.y = surface - 0.04;
      const leaves = Math.floor(range(6, 10));
      for (let i = 0; i < leaves; i++) {
        const a = (i / leaves) * TAU + range(-0.2, 0.2);
        const leaf = range(0.3, 0.5) * scale;
        const tip = top.clone().add(vec(Math.cos(a) * leaf, 0.01, Math.sin(a) * leaf));
        const mid = top.clone().lerp(tip, 0.5).add(vec(0, 0.02, 0));
        blade(batch, [top, mid, tip], 0.2 * scale, leafColor.clone().offsetHSL(0, 0, 0.06), root, 0.5, { rows: 2, cols: 1, thin: 1 });
      }
    }
  }
}

// Alternate water-milfoil (Myriophyllum alterniflorum), the milfoil of clear, soft northern
// water: stems with whorls of fine, feathery leaves, like green bottle brushes.
export function milfoil(batch, x, z, ground, surface, flow, random, scale = 1) {
  const range = ranger(random);
  const root = vec(x, ground - 0.03, z);
  const d = vec(Math.cos(flow), 0, Math.sin(flow));
  const stems = Math.floor(range(5, 10));
  const depth = surface - ground;
  for (let k = 0; k < stems; k++) {
    const height = Math.min(depth - 0.2, range(2, 7) * scale);
    if (height < 0.8) continue;
    const base = root.clone().add(vec(range(-0.6, 0.6) * scale, 0, range(-0.6, 0.6) * scale));
    const lean = range(0.3, 0.8) * height;
    const points = [
      base,
      base.clone().addScaledVector(d, lean * 0.2).add(vec(0, height * 0.45, 0)),
      base.clone().addScaledVector(d, lean * 0.65).add(vec(0, height * 0.85, 0)),
      base.clone().addScaledVector(d, lean).add(vec(0, height, 0)),
    ];
    const green = new THREE.Color().setHSL(range(0.2, 0.25), range(0.45, 0.6), range(0.15, 0.22));
    blade(batch, points, 0.045 * scale, green.clone().multiplyScalar(0.8), root, 1.1, { rows: 7, cols: 1, ribbon: true, thin: 1 });
    const curve = new THREE.CubicBezierCurve3(...points);
    const whorls = Math.max(3, Math.floor(height / (0.28 * scale)));
    for (let n = 1; n <= whorls; n++) {
      const t = n / (whorls + 0.3);
      const node = curve.getPoint(t);
      const a0 = range(0, TAU);
      const leaf = range(0.35, 0.6) * scale * (1 - 0.35 * t);
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i / 4) * TAU;
        const tip = node.clone().add(vec(Math.cos(a) * leaf, leaf * 0.45, Math.sin(a) * leaf)).addScaledVector(d, leaf * 0.4);
        blade(batch, [node, node.clone().lerp(tip, 0.5).add(vec(0, leaf * 0.1, 0)), tip], 0.09 * scale, green, root, 1, { rows: 2, cols: 1, thin: 1 });
      }
    }
  }
}

// A tuft of the low turf over the gravel: bulbous rush, reddish-green in soft water, or a
// cushion of moss, a handful of short blades.
export function turfTuft(batch, x, z, ground, flow, random, scale = 1, hue = 0.22) {
  const range = ranger(random);
  const root = vec(x, ground - 0.02, z);
  const count = Math.floor(range(5, 9));
  for (let i = 0; i < count; i++) {
    const a = flow + range(-1.6, 1.6);
    const dir = vec(Math.cos(a), 0, Math.sin(a));
    const h = range(0.35, 1.3) * scale;
    const out = range(0.15, 0.6) * scale;
    const points = [root.clone(), root.clone().addScaledVector(dir, out * 0.3).add(vec(0, h * 0.7, 0)), root.clone().addScaledVector(dir, out).add(vec(0, h, 0))];
    const color = new THREE.Color().setHSL(hue + range(-0.03, 0.03), range(0.4, 0.6), range(0.13, 0.22));
    blade(batch, points, range(0.05, 0.1) * scale, color, root, 0.8, { rows: 3, cols: 1, ribbon: true, thin: 0.8, browning: random() < 0.3 ? range(0.2, 0.5) : 0 });
  }
}

// Grass and sedge from the bank, arching out over the water and hanging into it, the ends
// trailing downstream.
export function bankGrass(batch, x, z, ground, surface, out, flow, random, scale = 1) {
  const range = ranger(random);
  const root = vec(x, ground - 0.02, z);
  const d = vec(Math.cos(flow), 0, Math.sin(flow));
  const count = Math.floor(range(8, 16));
  for (let i = 0; i < count; i++) {
    const a = Math.atan2(out.z, out.x) + range(-0.7, 0.7);
    const dir = vec(Math.cos(a), 0, Math.sin(a));
    const reach = range(1.2, 3.5) * scale;
    const rise = range(0.5, 1.6) * scale;
    const hang = range(0.2, 1.2) * scale;
    const p1 = root.clone().addScaledVector(dir, reach * 0.3).add(vec(0, rise, 0));
    const p2 = root.clone().addScaledVector(dir, reach * 0.75).add(vec(0, rise * 0.7, 0));
    const p3 = root.clone().addScaledVector(dir, reach).addScaledVector(d, hang * 0.8);
    p3.y = Math.min(p2.y, surface - hang);
    const wet = p3.y < surface;
    const color = new THREE.Color().setHSL(range(0.18, 0.25), range(0.4, 0.6), wet ? range(0.14, 0.22) : range(0.22, 0.32));
    blade(batch, [root.clone(), p1, p2, p3], range(0.04, 0.08) * scale, color, root, 0.5, { rows: 8, cols: 1, ribbon: true, thin: 0.7, browning: range(0, 0.35) });
  }
}

// A fallen leaf on the bed: alder, birch or willow, soaked dark -- brown and rust, the odd
// one still a dull yellow. Leaf-shaped (pointed at both ends, widest a little below the
// middle, the edges curling up), and opaque: a leaf lying on the stones is not lit through.
const LEAF_COLORS = [
  [0.07, 0.45, 0.1],
  [0.08, 0.5, 0.13],
  [0.1, 0.5, 0.16],
  [0.05, 0.4, 0.08],
  [0.12, 0.42, 0.14],
];
export function fallenLeaf(batch, x, z, ground, random, scale = 1) {
  const range = ranger(random);
  const a = range(0, TAU);
  const length = range(0.35, 0.7) * scale;
  const dir = vec(Math.cos(a), 0, Math.sin(a));
  const base = vec(x, ground + 0.02, z);
  const tip = base.clone().addScaledVector(dir, length);
  const mid = base.clone().lerp(tip, 0.5).add(vec(0, range(0.005, 0.03), 0));
  const [h, sat, l] = LEAF_COLORS[Math.floor(random() * LEAF_COLORS.length)];
  const color = new THREE.Color().setHSL(h + range(-0.01, 0.01), sat, l * range(0.6, 0.85));
  // Laid flat: its width across the direction it points, never along it.
  blade(batch, [base, mid, tip], length * range(0.28, 0.4), color, base, 0.02, { rows: 6, cols: 2, thin: 0.12, twist: a + Math.PI / 2 });
}

// A spray of living leaves on the end of a branch that hangs over the water: alder and
// willow, some of it dipping under the surface.
export function leafSpray(batch, at, random, scale = 1) {
  const range = ranger(random);
  const count = Math.floor(range(10, 16));
  const hue = range(0.24, 0.3);
  for (let i = 0; i < count; i++) {
    const a = range(0, TAU);
    const dir = vec(Math.cos(a), range(-0.6, 0.3), Math.sin(a)).normalize();
    const length = range(0.7, 1.3) * scale;
    const base = at.clone().add(vec(range(-0.6, 0.6), range(-0.4, 0.3), range(-0.6, 0.6)).multiplyScalar(scale));
    const tip = base.clone().addScaledVector(dir, length);
    const mid = base.clone().lerp(tip, 0.5).add(vec(0, length * 0.08, 0));
    const color = new THREE.Color().setHSL(hue + range(-0.02, 0.02), range(0.4, 0.6), range(0.16, 0.26));
    blade(batch, [base, mid, tip], length * range(0.3, 0.42), color, at, 0.35, { rows: 5, cols: 2, thin: 0.8, twist: a + Math.PI / 2 });
  }
}

// ---------------------------------------------------------------------------------------
// The forest above the banks: spruce, pine and birch, each a handful of simple solids.
export class SolidBatch {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
  }
  add(geometry, matrix, color, shade = null) {
    const g = geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const offset = this.positions.length / 3;
    const p = new THREE.Vector3(),
      n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
      const k = shade ? shade(p, n, i) : 1;
      this.colors.push(color.r * k, color.g * k, color.b * k);
    }
    const index = g.index;
    if (index) for (let i = 0; i < index.count; i++) this.indices.push(offset + index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.indices.push(offset + i);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    return g;
  }
  get empty() {
    return this.positions.length === 0;
  }
}

