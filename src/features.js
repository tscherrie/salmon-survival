import * as THREE from "three";
import { rockGeometry } from "../../riverscape/src/environment.js";
import { GeometryBatch, randomGenerator } from "../../riverscape/src/math.js";
import { foliageDepth, foliageMaterial } from "../../riverscape/src/foliage.js";
import { waterLitShader } from "../../riverscape/src/water.js";
import { COLD_SPRINGS, CRACKS, FALLS, ISLANDS, KING_POOL, MILLS, S, TRIBUTARIES, UNDERCUTS, bed, frame, level, place, section, smooth } from "./course.js";
import { MODEL_LENGTH, createFishMesh } from "./anatomy.js";
import { SolidBatch, bankGrass, birch, fallenLeaf, leafSpray, mossTuft, reeds, sedge, turfTuft } from "./flora.js";
import { trunkGeometry, withMossChannel } from "./terrain.js";
import { addPlace } from "./places.js";

// The special places built into the river -- islands, side brooks, and (added by later
// parts) caves, a mill, a bridge, a wreck: each dressed with what belongs to it (stones,
// plants, trees, drift wood), built when the fish comes within reach and dropped again when
// it is far away, like the terrain's blocks. They add their stones to the collisions and
// the eddies, and their weed and overhangs to the cover a fish can hide in (the terrain
// asks them: terrain.extras).
//
// A feature is { id, s, reach, build(ctx) } -- build a generator that fills ctx.group,
// ctx.plants (a GeometryBatch of foliage), ctx.trees (a SolidBatch), ctx.stones (a SolidBatch
// of rock), ctx.wood (trunk geometries) and ctx.colliders / ctx.cover, yielding now and then
// so a frame never stalls.

export const FEATURES = [];
export function addFeature(f) {
  FEATURES.push({ reach: 420, ...f });
}

const TAU = Math.PI * 2;
const at = {};

// ---------------------------------------------------------------------------------------
// Islands: their shores fringed with sedge and grass, reeds at the tips, a few birches and
// alders on top, and drift wood piled against the upstream tip.
for (const q of ISLANDS) {
  addPlace({ id: `island-${q.name.toLowerCase()}`, name: q.name, line: "Der Fluss teilt sich um eine Insel", from: q.from + (q.to - q.from) * 0.1, to: q.to - (q.to - q.from) * 0.1, s: (q.from + q.to) / 2, icon: "place", tier: "silver" });
  addFeature({
    id: `island-${q.name}`,
    s: (q.from + q.to) / 2,
    reach: (q.to - q.from) / 2 + 380,
    *build(ctx) {
      const { random, range } = ctx;
      // The waterline either side of the island, every few units along it.
      const edge = (s, side) => {
        const c = section(s);
        const lv = level(s);
        for (let e = 0; e < c.islandHalf * 1.8; e += 0.4) if (bed(s, c.islandU + side * e) < lv - 0.05) return c.islandU + side * e;
        return null;
      };
      const step = 5;
      for (let s = q.from + 20; s < q.to - 20; s += step) {
        const c = section(s);
        if (c.island < 0.15) continue;
        const lv = level(s);
        for (const side of [-1, 1]) {
          const u = edge(s + range(-1, 1), side);
          if (u === null) continue;
          place(s, u, at);
          const y = bed(s, u);
          const fs = frame(s, {});
          const out = new THREE.Vector3(side * fs.nx, 0, side * fs.nz);
          const flow = Math.atan2(fs.tz, fs.tx);
          if (random() < 0.6) bankGrass(ctx.plants, at.x, at.z, y + 0.2, lv, out, flow, random, range(0.8, 1.3));
          else sedge(ctx.plants, at.x, at.z, y, lv, random, range(0.6, 1.1));
          ctx.cover.push({ x: at.x, z: at.z, radius: 2, top: lv });
        }
        // Turf and trees on top.
        if (random() < 0.5) {
          const u = c.islandU + range(-0.6, 0.6) * c.islandHalf;
          const y = bed(s, u);
          if (y > lv + 0.4) {
            place(s, u, at);
            for (let k = 0; k < 6; k++) turfTuft(ctx.plants, at.x + range(-1.5, 1.5), at.z + range(-1.5, 1.5), y, flow0(s), random, range(1, 1.6), range(0.18, 0.26));
          }
        }
        if (random() < 0.12 * c.island) {
          const u = c.islandU + range(-0.4, 0.4) * c.islandHalf;
          const y = bed(s, u);
          if (y > lv + 0.8) {
            place(s, u, at);
            birch(ctx.trees, at.x, y, at.z, range(35, 70), random);
          }
        }
        yield "island";
      }
      // Reeds at both tips.
      for (const tip of [q.from + (q.to - q.from) * 0.12, q.to - (q.to - q.from) * 0.12]) {
        const c = section(tip);
        const lv = level(tip);
        for (let k = 0; k < 3; k++) {
          const s = tip + range(-6, 6);
          const u = c.islandU + range(-1, 1) * c.islandHalf * 1.2;
          const y = bed(s, u);
          if (y > lv - 1.5 && y < lv + 0.3) {
            place(s, u, at);
            reeds(ctx.plants, at.x, at.z, y, lv, random, 1);
            ctx.cover.push({ x: at.x, z: at.z, radius: 3.2, top: lv });
          }
        }
      }
      // Drift wood piled against the head of the island: trunks and branches the floods
      // brought down, lying across the flow -- and room under them to hide.
      const head = q.from + (q.to - q.from) * 0.1;
      const c = section(head);
      const lv = level(head);
      const logs = Math.floor(range(4, 7));
      for (let k = 0; k < logs; k++) {
        const s = head + range(-4, 10);
        const u = c.islandU + range(-1.3, 1.3) * Math.max(3, c.islandHalf);
        const a = Math.atan2(frame(s, at).tz, at.tx) + Math.PI / 2 + range(-0.6, 0.6);
        const length = range(10, 26) * (0.6 + 0.4 * c.island);
        place(s, u, at);
        const cx = at.x,
          cz = at.z;
        const points = [];
        for (let t = 0; t < 4; t++) {
          const f = t / 3 - 0.5;
          const x = cx + Math.cos(a) * length * f,
            z = cz + Math.sin(a) * length * f;
          points.push(new THREE.Vector3(x, 0, z));
        }
        // Resting on whatever is under each end, half in the water.
        const radius = range(0.5, 1.1);
        for (const p of points) {
          const r = {};
          ctx.locate(p.x, p.z, s, r);
          p.y = Math.max(bed(r.s, r.u) + radius * 0.7, Math.min(lv - radius * 0.2, bed(r.s, r.u) + radius * 2.5));
        }
        ctx.wood.push(trunkGeometry(points, radius, radius * 0.7, q.from + k * 3.1));
        for (const p of points) ctx.colliders.push({ x: p.x, y: p.y, z: p.z, r: radius * 1.2, ry: radius * 1.2 });
        ctx.cover.push({ x: cx, z: cz, radius: length * 0.35, top: lv });
        yield "drift";
      }
    },
  });
}
function flow0(s) {
  frame(s, at);
  return Math.atan2(at.tz, at.tx);
}

// ---------------------------------------------------------------------------------------
// Side brooks: grass and sedge hanging in from both banks, alder branches over it, stones
// in its bed, mossy rocks either side of its fall, leaves in the quiet water.
for (const b of TRIBUTARIES) {
  addPlace({ id: `brook-${b.name.toLowerCase()}`, name: b.name, line: "Ein kleiner Seitenbach mit einem Wasserfall", s: b.s + b.drift * 0.5, u: b.side * (section(b.s).half + b.length * 0.5), radius: b.length * 0.5, icon: "place", tier: "silver" });
  addFeature({
    id: `brook-${b.name}`,
    s: b.s,
    reach: 360,
    *build(ctx) {
      const { random, range } = ctx;
      const bank = section(b.s).half;
      const point = (t, across) => {
        const tt = Math.min(1, Math.max(0, t));
        const middle = b.s + b.drift * tt + 2.2 * Math.sin(t * 5.2 + 0.7) * tt;
        const w = b.width * (1 - 0.35 * tt);
        return { s: middle + across * w, u: b.side * (bank - 1.5 + b.length * t), w };
      };
      // Banks.
      for (let t = 0.05; t < 0.97; t += 0.035) {
        for (const side of [-1, 1]) {
          const p = point(t + range(-0.01, 0.01), side * range(0.95, 1.1));
          const lv = level(p.s);
          const y = bed(p.s, p.u);
          place(p.s, p.u, at);
          frame(p.s, ctx.f);
          // Out over the brook: along s, toward its middle.
          const out = new THREE.Vector3(-side * ctx.f.tx, 0, -side * ctx.f.tz);
          const flow = Math.atan2(-b.side * ctx.f.nz, -b.side * ctx.f.nx);
          if (random() < 0.55) bankGrass(ctx.plants, at.x, at.z, Math.max(y, lv - 0.2) + 0.1, lv, out, flow, random, range(0.6, 1));
          else sedge(ctx.plants, at.x, at.z, y, lv, random, range(0.45, 0.8));
          ctx.cover.push({ x: at.x, z: at.z, radius: 1.8, top: lv });
        }
        yield "banks";
      }
      // Stones in the bed.
      for (let k = 0; k < 9; k++) {
        const p = point(range(0.05, 0.9), range(-0.7, 0.7));
        const r = range(0.35, 1.1);
        ctx.stone(p.s, p.u, r, r * range(0.5, 0.8));
      }
      // The rocks either side of the fall, and a few in its pool.
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const p = point(range(0.94, 1.02), side * range(0.75, 1.25));
          const r = range(1.1, 2.1);
          ctx.stone(p.s, p.u, r, r * range(0.8, 1.3), level(p.s) + b.drop * range(0.3, 0.8));
        }
      }
      for (let k = 0; k < 3; k++) {
        const p = point(range(0.8, 0.92), range(-0.6, 0.6));
        ctx.stone(p.s, p.u, range(0.5, 0.9), range(0.35, 0.6));
      }
      yield "stones";
      // Alder branches out over it.
      for (let k = 0; k < 4; k++) {
        const side = k % 2 ? 1 : -1;
        const p = point(range(0.15, 0.85), side * 1.2);
        const lv = level(p.s);
        const reach = range(2.5, 5);
        const points = [];
        for (let t = 0; t <= 4; t++) {
          const f = t / 4;
          const q = point(0, 0);
          void q;
          const ss = p.s - side * reach * f * 0.9;
          place(ss, p.u + range(-0.3, 0.3), at);
          const y = Math.max(bed(ss, p.u) + 0.2, lv + 2.2 * Math.sin(Math.PI * (0.25 + 0.6 * f)) * (1 - f) - 0.3 * f * f);
          points.push(new THREE.Vector3(at.x, y, at.z));
        }
        ctx.wood.push(trunkGeometry(points, range(0.06, 0.12), 0.03, b.s + k));
        const curve = new THREE.CatmullRomCurve3(points);
        for (let q = 0; q < 7; q++) leafSpray(ctx.plants, curve.getPoint(range(0.5, 1)), random, range(0.7, 1));
        ctx.cover.push({ x: points[3].x, z: points[3].z, radius: 2.2, top: lv });
      }
      yield "branches";
      // Leaves on the bed, and moss on the stones by the fall.
      for (let k = 0; k < 30; k++) {
        const p = point(range(0, 0.85), range(-0.8, 0.8));
        place(p.s, p.u, at);
        fallenLeaf(ctx.plants, at.x, at.z, bed(p.s, p.u), random, 1);
      }
      for (let k = 0; k < 10; k++) {
        const p = point(range(0.85, 1.0), range(-1.2, 1.2));
        place(p.s, p.u, at);
        mossTuft(ctx.plants, new THREE.Vector3(at.x, bed(p.s, p.u) + 0.05, at.z), flow0(p.s), random, range(0.6, 1));
      }
      // Above the fall the brook runs on, shallow, over its step: its own strip of water.
      if (ctx.surface) {
        const pos = [],
          foam = [],
          flow = [],
          idx = [];
        const cols = 5;
        let rows = 0;
        for (let t = 0.99; t <= 1.33; t += 0.03, rows++) {
          for (let j = 0; j <= cols; j++) {
            const p = point(t, (j / cols) * 2 - 1);
            const lv = level(p.s) + b.drop - 0.12;
            place(p.s, p.u, at);
            pos.push(at.x, lv, at.z);
            foam.push(0.25 + 0.5 * (1 - Math.min(1, (t - 0.99) / 0.12)));
            flow.push(-b.side * at.nx * 1.6, -b.side * at.nz * 1.6);
          }
        }
        for (let i = 0; i < rows - 1; i++)
          for (let j = 0; j < cols; j++) {
            const a = i * (cols + 1) + j;
            idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
          }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("foam", new THREE.Float32BufferAttribute(foam, 1));
        g.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 2));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, ctx.surface);
        mesh.name = "Brook above the fall";
        ctx.group.add(mesh);
      }
      // Birches along it.
      for (let k = 0; k < 6; k++) {
        const side = k % 2 ? 1 : -1;
        const p = point(range(0.1, 1.1), side * range(1.8, 3));
        const y = bed(p.s, p.u);
        if (y < level(p.s) + 1) continue;
        place(p.s, p.u, at);
        birch(ctx.trees, at.x, y, at.z, range(35, 60), random);
      }
      yield "trees";
    },
  });
}

// ---------------------------------------------------------------------------------------
// Caves and hiding places. Each shelters a fish: a hunter cannot see into it (cover), and
// the water in it is slack (its rocks are in the eddies' way).

// The spring cave: the spring wells up under a roof of rock at the head of the river; the
// back of it open to a cleft the spring water spills down through.
addPlace({ id: "cave-spring", name: "Quellhöhle", line: "Wo die Quelle aus dem Fels kommt", s: 10, u: 0, radius: 6.5, icon: "place", tier: "silver" });
addFeature({
  id: "cave-spring",
  s: 10,
  reach: 520,
  *build(ctx) {
    const { range } = ctx;
    const lv = level(10);
    // The roof: slabs of rock laid over the pool from wall to wall, their undersides a
    // little under the water; the mouth's lintel lower still.
    const slabs = [
      [9, -3.2, 5.2, 2.6, 3.4, 1.5],
      [9.5, 3.0, 5.0, 2.4, 3.2, 1.4],
      [12.2, -1.0, 5.6, 2.2, 3.0, 1.2],
      [14.6, 0.4, 6.2, 1.8, 2.2, 0.9],
      [11, 4.8, 3.5, 3.4, 4.5, 1.8],
      [11, -5.0, 3.5, 3.4, 4.5, 1.8],
    ];
    for (const [s, u, rx, ry, rz, over] of slabs) {
      place(s, u, at);
      ctx.rock(at.x, lv + over, at.z, rx, ry, rz, range(0, TAU));
    }
    yield "roof";
    // Moss over the roof and ferny tufts on top; roots through the cleft at the back.
    for (let k = 0; k < 16; k++) {
      const s = range(7, 15),
        u = range(-5, 5);
      place(s, u, at);
      turfTuft(ctx.plants, at.x, at.z, lv + range(2.4, 3.2), flow0(s), ctx.random, range(0.8, 1.4), range(0.2, 0.27));
    }
    for (let k = 0; k < 8; k++) {
      place(range(7, 15), range(-4, 4), at);
      mossTuft(ctx.plants, new THREE.Vector3(at.x, lv - range(0.8, 1.4), at.z), flow0(10), ctx.random, range(0.5, 0.9));
    }
    // Inside: shelter.
    for (let s = 8; s <= 15; s += 2) {
      place(s, 0, at);
      ctx.cover.push({ x: at.x, z: at.z, radius: 4.5, top: lv });
    }
  },
});

// The block cave: great boulders piled in a pool of the upper river, two leaning together
// over a gap -- a short tunnel to swim through -- and the rest round it.
addPlace({ id: "cave-blocks", name: "Blockhöhle", line: "Ein Tunnel unter aufgetürmten Felsen", s: 3835, u: 0, radius: 16, icon: "place", tier: "silver" });
addFeature({
  id: "cave-blocks",
  s: 3835,
  reach: 420,
  *build(ctx) {
    const { range } = ctx;
    const c = section(3835);
    const u0 = c.thalweg - c.half * 0.35;
    const lv = level(3835);
    const floor = bed(3835, u0);
    const depth = lv - floor;
    const H = Math.min(depth * 0.7, 9);
    frame(3835, ctx.f);
    const t = ctx.f;
    // Two pillars either side of the tunnel (which runs with the current), a lintel over it.
    const at2 = (along, across, y) => {
      place(3835 + along, u0 + across, at);
      return { x: at.x, y, z: at.z };
    };
    for (const side of [-1, 1]) {
      for (const along of [-3.5, 3.5]) {
        const p = at2(along, side * 4.6, floor + H * 0.45);
        ctx.rock(p.x, p.y, p.z, range(2.8, 3.6), H * 0.55, range(3.2, 4.2), range(0, TAU));
      }
    }
    const top = at2(0, 0, floor + H * 0.95);
    ctx.rock(top.x, top.y, top.z, 5.6, H * 0.22, 7.2, Math.atan2(t.tz, t.tx) + Math.PI / 2);
    const top2 = at2(-4.5, 1.5, floor + H * 0.82);
    ctx.rock(top2.x, top2.y, top2.z, 4.2, H * 0.2, 4.8, range(0, TAU));
    yield "tunnel";
    // Boulders round it.
    for (let k = 0; k < 7; k++) {
      const a = range(0, TAU),
        r = range(9, 16);
      const p = at2(Math.cos(a) * r, Math.sin(a) * r, 0);
      const size = range(2, 4.5);
      const ss = 3835 + Math.cos(a) * r,
        uu = u0 + Math.sin(a) * r;
      ctx.rock(p.x, bed(ss, uu) + size * 0.4, p.z, size, size * range(0.6, 0.9), size * range(0.8, 1.2), range(0, TAU));
    }
    for (let k = 0; k < 14; k++) {
      const p = at2(range(-8, 8), range(-8, 8), 0);
      mossTuft(ctx.plants, new THREE.Vector3(p.x, floor + range(0.2, H), p.z), Math.atan2(t.tz, t.tx), ctx.random, range(0.8, 1.4));
    }
    for (let along = -4; along <= 4; along += 2) {
      const p = at2(along, 0, 0);
      ctx.cover.push({ x: p.x, z: p.z, radius: 3.2, top: floor + H * 0.8 });
    }
  },
});

// Undercut banks: an overhang of turf and earth over a pocket of deep water, roots and
// grass hanging from its edge.
for (const q of UNDERCUTS) {
  addPlace({ id: `undercut-${q.name.toLowerCase()}`, name: q.name, line: "Ein unterspültes Ufer – ein Versteck", s: q.s, u: q.side * section(q.s).half * 1.02, radius: q.length * 0.45, icon: "place", tier: "bronze" });
  addFeature({
    id: `undercut-${q.name}`,
    s: q.s,
    reach: 380,
    *build(ctx) {
      const { range, random } = ctx;
      const s0 = q.s - q.length / 2 + 2,
        s1 = q.s + q.length / 2 - 2;
      // The overhang: lumps of earth held together by roots, jutting out over the pocket,
      // their undersides a hand under the water, turf on top.
      for (let s = s0; s <= s1; s += range(1.8, 2.6)) {
        const c = section(s);
        const lv = level(s);
        const reach = c.half * 0.22;
        for (const [e, lift, size] of [
          [1.02, 0.15, 1],
          [1.22, 0.45, 1.15],
        ]) {
          const u = c.thalweg + q.side * e * c.half;
          place(s, u, at);
          const shade = range(0.8, 1.1);
          ctx.lump(at.x, lv + lift, at.z, reach * size * range(0.8, 1.1), range(0.55, 0.8), range(1.6, 2.4), flow0(s) + Math.PI / 2 + range(-0.2, 0.2), new THREE.Color(0.3 * shade, 0.22 * shade, 0.14 * shade));
        }
        const top = c.thalweg + q.side * 1.1 * c.half;
        place(s, top, at);
        for (let k = 0; k < 3; k++) turfTuft(ctx.plants, at.x + range(-1, 1), at.z + range(-1, 1), lv + 0.75, flow0(s), random, range(0.9, 1.4), range(0.2, 0.26));
      }
      yield "lid";
      // Its edge: grass hanging over, roots down into the water; the lid as colliders; the
      // pocket as cover.
      const tubes = [];
      for (let s = s0; s <= s1; s += 1.4) {
        const c = section(s);
        const lv = level(s);
        const u = c.thalweg + q.side * 0.92 * c.half;
        place(s, u, at);
        frame(s, ctx.f);
        const out = new THREE.Vector3(-q.side * ctx.f.nx, 0, -q.side * ctx.f.nz);
        bankGrass(ctx.plants, at.x, at.z, lv + 0.3, lv, out, flow0(s), random, range(0.7, 1.1));
        if (random() < 0.7) {
          const points = [];
          const drop = range(0.8, Math.min(2.6, lv - bed(s, u) - 0.2));
          for (let k = 0; k <= 3; k++) {
            const f = k / 3;
            place(s + range(-0.2, 0.2), u - q.side * f * 0.4, at);
            points.push(new THREE.Vector3(at.x, lv - 0.5 - drop * f, at.z));
          }
          tubes.push(trunkGeometry(points, range(0.03, 0.07), 0.015, s));
        }
        const mid = c.thalweg + q.side * 1.12 * c.half;
        place(s, mid, at);
        ctx.colliders.push({ x: at.x, y: lv + 0.1, z: at.z, r: c.half * 0.22, rx: c.half * 0.22, rz: 1, ry: 0.55, cos: 1, sin: 0 });
        ctx.cover.push({ x: at.x, z: at.z, radius: Math.max(2.5, c.half * 0.2), top: lv });
        if (Math.round(s * 10) % 3 === 0) yield "edge";
      }
      ctx.wood.push(...tubes);
    },
  });
}

// The salmon fall's secret: a grotto behind the curtain, and the crack up from it.
for (const k of CRACKS) {
  const f = FALLS.find((q) => q.name === k.fall);
  const cAt = (s) => {
    const c = section(s);
    return c.thalweg + k.side * k.u * c.half;
  };
  addPlace({ id: "grotto-lachsfall", name: "Grotte am Lachsfall", line: "Hinter dem Vorhang des Wasserfalls", s: f.s + 2, u: cAt(f.s + 2), radius: 7, icon: "place", tier: "silver" });
  addPlace({ id: "crack-lachsfall", name: k.name, line: "Ein geheimer Weg am Fall vorbei", s: f.s - k.length * 0.6, u: cAt(f.s - 6), radius: 4, icon: "feat", tier: "gold" });
  addFeature({
    id: "crack-lachsfall",
    s: f.s,
    reach: 420,
    *build(ctx) {
      const { range } = ctx;
      const low = level(f.s + 0.02),
        high = level(f.s - 0.02);
      // Rock framing the crack's mouth under the curtain, and a lip of rock over the grotto.
      for (const side of [-1, 1]) {
        const s = f.s + 0.8;
        const u = cAt(s) + side * (k.width + 1.4);
        place(s, u, at);
        ctx.rock(at.x, low - f.pool * 0.3, at.z, 1.6, f.pool * 0.35, 2.2, range(0, TAU));
      }
      place(f.s + 1.2, cAt(f.s + 1.2), at);
      ctx.rock(at.x, low - 1.2, at.z, k.width * 1.8, 1.1, 1.6, range(0, TAU));
      for (let n = 0; n < 12; n++) {
        const s = f.s - range(0, k.length),
          u = cAt(s) + range(-1, 1) * k.width;
        place(s, u, at);
        mossTuft(ctx.plants, new THREE.Vector3(at.x, range(bed(s, u), high - 2), at.z), flow0(s), ctx.random, range(0.5, 0.9));
      }
      yield "mouth";
      // All of it out of a hunter's sight.
      for (let s = f.s - k.length; s <= f.s + 3; s += 2) {
        place(s, cAt(s), at);
        ctx.cover.push({ x: at.x, z: at.z, radius: k.width * 1.6, top: high });
      }
    },
  });
}

// Drift wood jammed in the upper river: trunks piled across each other, gaps between.
addPlace({ id: "logjam", name: "Totholzverhau", line: "Ein Gewirr aus Stämmen", s: 4620, u: 0, radius: 18, icon: "place", tier: "bronze" });
addFeature({
  id: "logjam",
  s: 4620,
  reach: 420,
  *build(ctx) {
    const { range } = ctx;
    const c = section(4620);
    const uc = c.thalweg + c.half * 0.5;
    const lv = level(4620);
    for (let k = 0; k < 11; k++) {
      const s = 4620 + range(-9, 9),
        u = uc + range(-7, 7);
      const a = flow0(s) + Math.PI / 2 + range(-0.9, 0.9);
      const length = range(12, 24);
      const radius = range(0.5, 1.2);
      place(s, u, at);
      const points = [];
      for (let t = 0; t < 4; t++) {
        const f = t / 3 - 0.5;
        const x = at.x + Math.cos(a) * length * f,
          z = at.z + Math.sin(a) * length * f;
        const r = {};
        ctx.locate(x, z, s, r);
        const floor = bed(r.s, r.u);
        points.push(new THREE.Vector3(x, Math.min(lv + radius * 0.3, floor + radius + range(0, 4) * (k / 11)), z));
      }
      ctx.wood.push(trunkGeometry(points, radius, radius * 0.6, 4620 + k));
      for (const p of points) ctx.colliders.push({ x: p.x, y: p.y, z: p.z, r: radius * 1.15, ry: radius * 1.15 });
      yield "log";
    }
    place(4620, uc, at);
    ctx.cover.push({ x: at.x, z: at.z, radius: 9, top: lv });
    void c;
  },
});

// The beavers of the Erlenbach: a dam of sticks and mud across the brook, a hole through it
// near the bottom, and their lodge on the bank above it, entered from under the water.
for (const b of TRIBUTARIES) {
  const bank = section(b.s).half;
  const point = (t, across) => {
    const tt = Math.min(1, Math.max(0, t));
    const middle = b.s + b.drift * tt + 2.2 * Math.sin(t * 5.2 + 0.7) * tt;
    const w = b.width * (1 - 0.35 * tt);
    return { s: middle + across * w, u: b.side * (bank - 1.5 + b.length * t), w };
  };
  const damT = 0.5,
    lodgeT = 0.68;
  const dam = point(damT, 0);
  const lodge = point(lodgeT, 0.95);
  addPlace({ id: "beaver-dam", name: "Biberdamm", line: "Ein Damm aus Ästen – mit einem Durchschlupf", s: dam.s, u: dam.u, radius: 5, icon: "place", tier: "silver" });
  addPlace({ id: "beaver-lodge", name: "Biberburg", line: "Die Burg der Biber, von unten zu erreichen", s: lodge.s, u: lodge.u, radius: 4, icon: "place", tier: "silver" });
  addFeature({
    id: `beavers-${b.name}`,
    s: b.s,
    reach: 360,
    *build(ctx) {
      const { range } = ctx;
      const lv = level(dam.s);
      // The dam: sticks laid across, piled from the bed to above the water, leaving a hole
      // low down near one side.
      const hole = { across: 0.35, y: bed(dam.s, dam.u) + 0.9 };
      for (let k = 0; k < 70; k++) {
        const across = range(-1.15, 1.15);
        const p = point(damT + range(-0.012, 0.012), across);
        const floor = bed(p.s, p.u);
        const y = range(floor + 0.1, lv + 0.35);
        if (Math.abs(across - hole.across) < 0.2 && Math.abs(y - hole.y) < 0.6) continue;
        const len = range(1.5, 4);
        const q1 = point(damT + range(-0.02, 0.02), across - len / (2 * p.w));
        const q2 = point(damT + range(-0.02, 0.02), across + len / (2 * p.w));
        place(q1.s, q1.u, at);
        const a = new THREE.Vector3(at.x, y + range(-0.1, 0.1), at.z);
        place(q2.s, q2.u, at);
        const c2 = new THREE.Vector3(at.x, y + range(-0.1, 0.1), at.z);
        ctx.wood.push(trunkGeometry([a, a.clone().lerp(c2, 0.5).add(new THREE.Vector3(0, range(-0.05, 0.08), 0)), c2], range(0.05, 0.11), 0.04, k));
        if (k % 10 === 9) yield "dam";
      }
      // The dam as colliders, all but the hole.
      for (let across = -1.1; across <= 1.1; across += 0.22) {
        const p = point(damT, across);
        place(p.s, p.u, at);
        const floor = bed(p.s, p.u);
        for (let y = floor + 0.35; y < lv + 0.3; y += 0.6) {
          if (Math.abs(across - hole.across) < 0.22 && Math.abs(y - hole.y) < 0.55) continue;
          ctx.colliders.push({ x: at.x, y, z: at.z, r: 0.45, ry: 0.4 });
        }
      }
      // The lodge: a dome of sticks on the bank, its way in from under the water.
      const lp = point(lodgeT, 1.35);
      place(lp.s, lp.u, at);
      const base = Math.max(bed(lp.s, lp.u), level(lp.s) - 0.6);
      const R = 3.2;
      for (let k = 0; k < 90; k++) {
        const theta = range(0, TAU),
          phi = range(0.1, 1.3);
        const x = at.x + Math.cos(theta) * Math.cos(phi) * R,
          z = at.z + Math.sin(theta) * Math.cos(phi) * R,
          y = base + Math.sin(phi) * R * 0.8;
        const d = new THREE.Vector3(-Math.sin(theta), range(-0.3, 0.3), Math.cos(theta)).multiplyScalar(range(0.8, 1.8));
        const p = new THREE.Vector3(x, y, z);
        ctx.wood.push(trunkGeometry([p.clone().sub(d), p, p.clone().add(d)], range(0.05, 0.1), 0.04, 500 + k));
        if (k % 15 === 14) yield "lodge";
      }
      ctx.colliders.push({ x: at.x, y: base + R * 0.4, z: at.z, r: R * 0.9, ry: R * 0.7 });
      ctx.cover.push({ x: at.x, z: at.z, radius: R + 1.5, top: level(lp.s) });
      place(dam.s, dam.u, at);
      ctx.cover.push({ x: at.x, z: at.z, radius: 3, top: lv });
    },
  });
}

// ---------------------------------------------------------------------------------------
// Places people made, and a few of nature's.

// Boxes, cones and cylinders into a SolidBatch, for the buildings.
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
// A mussel's valve: half an ellipsoid, open to one side (+z), its lower edge drawn in a
// little so the shell is kidney-shaped; and its mirror image, open to -z.
const VALVE = (() => {
  const g = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i);
    if (y < 0) p.setY(i, y * (0.75 + 0.25 * Math.abs(x)));
  }
  g.computeVertexNormals();
  return g;
})();
const VALVE_B = VALVE.clone().scale(1, 1, -1);
VALVE_B.index.array.reverse();
VALVE_B.computeVertexNormals();
function solid(batch, geometry, x, y, z, sx, sy, sz, yaw, color, pitch = 0, roll = 0) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ")), new THREE.Vector3(sx, sy, sz));
  batch.add(geometry, m, color, (p, n) => 0.8 + 0.25 * Math.max(0, n.y));
}

// The old mill: the race walled in stone, the mill house of timber on a stone footing, and
// the wheel turning in the race, its paddles dipping deep into the water.
for (const m of MILLS) {
  addPlace({ id: "mill", name: m.name, line: "Das Mühlrad dreht sich im Mühlgraben", s: m.wheel, u: m.side * (section(m.wheel).half + m.offset), radius: 16, icon: "place", tier: "silver" });
  addFeature({
    id: "mill",
    s: (m.from + m.to) / 2,
    reach: (m.to - m.from) / 2 + 380,
    *build(ctx) {
      const { range } = ctx;
      const stone = new THREE.Color(0.52, 0.5, 0.46),
        timber = new THREE.Color(0.36, 0.25, 0.16),
        roof = new THREE.Color(0.25, 0.18, 0.15);
      // The race's walls: dressed stone blocks along both sides.
      for (let s = m.from + 30; s < m.to - 30; s += 3.2) {
        const c = section(s);
        const ramp = 1;
        const centre = c.thalweg + m.side * (c.half - 3 + (m.offset + 3) * ramp);
        const lv = level(s);
        const yaw = -flow0(s);
        for (const side of [-1, 1]) {
          place(s, centre + side * (m.width + 0.6), at);
          solid(ctx.masonry, BOX, at.x, lv - m.depth / 2 + 0.6, at.z, 3.1, m.depth + 1.3, 1.2, yaw, stone.clone().multiplyScalar(range(0.85, 1.1)));
        }
        if (Math.round(s) % 5 === 0) yield "walls";
      }
      // The mill house on the outer bank by the wheel.
      const c = section(m.wheel);
      const lv = level(m.wheel);
      const centre = c.thalweg + m.side * (c.half + m.offset);
      const yaw = -flow0(m.wheel);
      place(m.wheel, centre + m.side * (m.width + 9), at);
      const hx = at.x,
        hz = at.z;
      solid(ctx.masonry, BOX, hx, lv + 1.5, hz, 22, 3, 14, yaw, stone);
      solid(ctx.masonry, BOX, hx, lv + 9, hz, 21, 12, 13, yaw, timber);
      // A pitched roof: two slabs.
      for (const side of [-1, 1]) {
        const off = new THREE.Vector3(0, 0, side * 3.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        solid(ctx.masonry, BOX, hx + off.x, lv + 18.2, hz + off.z, 24, 0.8, 8.6, yaw, roof, side * 0.62, 0);
      }
      // The wheel: two rims, spokes and paddles, on an axle across the race.
      const wheel = new THREE.Group();
      place(m.wheel, centre, at);
      const R = m.depth + 2.2;
      wheel.position.set(at.x, lv + 2.2, at.z);
      frame(m.wheel, ctx.f);
      // The axle runs across the race (along the normal); the wheel turns with the water.
      wheel.rotation.y = Math.atan2(-ctx.f.nz, ctx.f.nx);
      // (In the wheel's own frame: x along the axle; a box turned by -a about x has its
      // y along the rim and its z out along the radius.)
      const parts = new SolidBatch();
      for (const side of [-1, 1]) {
        for (let k = 0; k < 24; k++) {
          const a0 = (k / 24) * TAU;
          solid(parts, BOX, side * m.width * 0.8, Math.sin(a0) * R, Math.cos(a0) * R, 0.4, R * 0.28, 0.5, 0, timber, -a0, 0);
        }
      }
      const paddles = 12;
      for (let k = 0; k < paddles; k++) {
        const a0 = (k / paddles) * TAU;
        for (const side of [-1, 1]) solid(parts, BOX, side * m.width * 0.8, Math.sin(a0) * R * 0.5, Math.cos(a0) * R * 0.5, 0.35, 0.3, R, 0, timber, -a0, 0);
        solid(parts, BOX, 0, Math.sin(a0) * (R - 0.9), Math.cos(a0) * (R - 0.9), m.width * 1.55, 0.18, 1.8, 0, timber.clone().multiplyScalar(0.85), -a0, 0);
      }
      solid(parts, CYL, 0, 0, 0, 0.5, m.width * 2.2 + 8, 0.5, 0, timber, 0, Math.PI / 2);
      const mesh = new THREE.Mesh(parts.geometry(), ctx.woodSolid);
      mesh.castShadow = mesh.receiveShadow = true;
      wheel.add(mesh);
      wheel.name = "Mill wheel";
      ctx.group.add(wheel);
      ctx.animated.push(wheel);
      // It turns with the water, and a fish under it is struck by its paddles.
      const spin = { angle: 0, hitAt: -10 };
      const local = new THREE.Vector3();
      ctx.animate.push((dt) => {
        spin.angle += dt * 0.45;
        wheel.children[0].rotation.x = spin.angle;
      });
      ctx.hazards.push((fish, time) => {
        local.copy(fish.position).sub(wheel.position);
        local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -wheel.rotation.y);
        if (Math.abs(local.x) > m.width) return null;
        const r = Math.hypot(local.y, local.z);
        if (r < R - 2.2 || r > R + 0.3) return null;
        // The paddle nearest the fish, in the wheel's turn.
        const a = Math.atan2(local.y, local.z) + spin.angle;
        const step = TAU / paddles;
        const off = Math.abs(((a % step) + step) % step - step / 2) - step / 2;
        if (Math.abs(off) * r > 0.6 + fish.length * 0.3 || time - spin.hitAt < 0.8) return null;
        spin.hitAt = time;
        frame(m.wheel, ctx.f);
        return { strength: 0.08, push: new THREE.Vector3(ctx.f.tx, -0.3, ctx.f.tz).multiplyScalar(4), title: "Mühlrad" };
      });
      yield "wheel";
      void range;
    },
  });
}

// The stone bridge: three piers in the river, the deck high over the water with its
// parapets, and people on it -- who now and then throw bread to the fish.
export const BRIDGES = [{ s: 10400, name: "Steinbrücke" }];
for (const b of BRIDGES) {
  addPlace({ id: "bridge", name: b.name, line: "Leute auf der Brücke – manchmal fällt Brot ins Wasser", s: b.s, u: 0, radius: 26, icon: "place", tier: "bronze" });
  addFeature({
    id: "bridge",
    s: b.s,
    reach: 520,
    *build(ctx) {
      const { range, random } = ctx;
      const c = section(b.s);
      const lv = level(b.s);
      const yaw = -flow0(b.s);
      frame(b.s, ctx.f);
      const stone = new THREE.Color(0.55, 0.52, 0.47);
      const deck = lv + 22;
      // Piers, each with a pointed cutwater upstream.
      for (const k of [-0.5, 0, 0.5]) {
        const u = c.thalweg + k * c.half;
        place(b.s, u, at);
        const floor = bed(b.s, u);
        const h = deck - floor;
        solid(ctx.masonry, BOX, at.x, floor + h / 2, at.z, 9, h, 6.5, yaw, stone.clone().multiplyScalar(range(0.9, 1.05)));
        place(b.s - 5.5, u, at);
        solid(ctx.masonry, BOX, at.x, floor + (lv + 2 - floor) / 2, at.z, 3.6, lv + 2 - floor, 3.6, yaw + Math.PI / 4, stone);
        place(b.s, u, at);
        ctx.colliders.push({ x: at.x, y: floor + h / 2, z: at.z, r: 5, rx: 4.8, rz: 2.8, ry: h / 2, cos: Math.cos(yaw), sin: Math.sin(yaw) });
      }
      // The deck and its parapets, from bank to bank.
      const span = c.half * 1.35;
      for (let u = -span; u < span; u += 6) {
        place(b.s, c.thalweg + u + 3, at);
        solid(ctx.masonry, BOX, at.x, deck + 1, at.z, 10, 2.2, 6.2, yaw, stone);
        for (const side of [-1, 1]) {
          place(b.s + side * 4.4, c.thalweg + u + 3, at);
          solid(ctx.masonry, BOX, at.x, deck + 3.4, at.z, 1, 2.8, 6.2, yaw, stone.clone().multiplyScalar(0.92));
        }
        yield "deck";
      }
      // Arches under the deck between the piers: a row of blocks along each arc.
      for (const [a0, a1] of [
        [-1.35, -0.5],
        [-0.5, 0],
        [0, 0.5],
        [0.5, 1.35],
      ]) {
        const u0 = c.thalweg + a0 * c.half + 2.5,
          u1 = c.thalweg + a1 * c.half - 2.5;
        const rise = Math.min(12, Math.abs(u1 - u0) * 0.3);
        for (let t = 0; t <= 1.001; t += 0.04) {
          const u = u0 + (u1 - u0) * t;
          place(b.s, u, at);
          const y = deck - 1 - (1 - Math.sin(Math.PI * t)) * rise;
          // Each voussoir turned along the arc.
          const slope = Math.atan2(rise * Math.PI * Math.cos(Math.PI * t), u1 - u0);
          solid(ctx.masonry, BOX, at.x, y, at.z, 9, 1.6, Math.abs(u1 - u0) * 0.045 + 0.4, yaw, stone.clone().multiplyScalar(0.86), -slope, 0);
        }
      }
      // People: a coat, a head, standing at the parapet.
      const people = [];
      const coats = [new THREE.Color(0.6, 0.18, 0.12), new THREE.Color(0.15, 0.25, 0.45), new THREE.Color(0.3, 0.35, 0.2), new THREE.Color(0.55, 0.45, 0.2)];
      for (let k = 0; k < 4; k++) {
        const u = c.thalweg + range(-0.9, 0.9) * c.half;
        const side = random() < 0.5 ? -1 : 1;
        place(b.s + side * 3.6, u, at);
        solid(ctx.masonry, CYL, at.x, deck + 2.2 + 4.2, at.z, 1.1, 8.4, 1.1, 0, coats[k]);
        solid(ctx.masonry, CYL, at.x, deck + 2.2 + 9.4, at.z, 0.8, 1.6, 0.8, 0, new THREE.Color(0.85, 0.66, 0.52));
        people.push({ x: at.x, z: at.z, side });
      }
      // Bread, now and then, when a fish is near and it is day.
      let next = 6;
      ctx.animate.push((dt, env) => {
        if (!env || !env.fish) return;
        next -= dt;
        if (next > 0) return;
        next = range(18, 40);
        const fish = env.fish;
        if (env.light < 0.4 || Math.abs(fish.river.s - b.s) > 45) return;
        const who = people[Math.floor(random() * people.length)];
        const n = Math.floor(range(3, 7));
        for (let k = 0; k < n; k++) env.toss?.("bread", who.x + range(-3, 3) - ctx.f.tx * 4, who.z + range(-3, 3) - ctx.f.tz * 4);
        env.events?.push("bread");
      });
    },
  });
}

// A cold spring in the middle river: groundwater welling up through a patch of pale gravel,
// the water over it cool all summer -- a refuge on a hot day. And a bank of freshwater
// pearl mussels, which need the young salmon: their larvae ride on its gills for a while.
for (const q of COLD_SPRINGS) {
  const c = section(q.s);
  addPlace({ id: "cold-spring", name: q.name, line: "Kühles Grundwasser – Zuflucht an heißen Tagen", s: q.s, u: c.thalweg + q.u * c.half, radius: q.radius, icon: "place", tier: "silver" });
  addFeature({
    id: "cold-spring",
    s: q.s,
    reach: 380,
    *build(ctx) {
      const { range, random } = ctx;
      const uc = c.thalweg + q.u * c.half;
      for (let k = 0; k < 40; k++) {
        const s = q.s + range(-1, 1) * q.radius * 0.6,
          u = uc + range(-1, 1) * q.radius * 0.6;
        place(s, u, at);
        const floor = bed(s, u);
        ctx.stone(s, u, range(0.25, 0.6), range(0.15, 0.3), floor + 0.05);
      }
      yield "gravel";
      // The upwelling: a slow shimmer of fine sand and bubbles rising from the gravel.
      const count = 160;
      const pos = new Float32Array(count * 3);
      const seeds = Array.from({ length: count }, () => ({ s: q.s + range(-1, 1) * q.radius * 0.45, u: uc + range(-1, 1) * q.radius * 0.45, t: random(), speed: range(0.3, 0.8) }));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.12, color: 0xd8e8e8, transparent: true, opacity: 0.55, depthWrite: false }));
      points.frustumCulled = false;
      points.name = "Upwelling";
      ctx.group.add(points);
      const lv = level(q.s);
      for (const p of seeds) {
        place(p.s, p.u, at);
        p.x = at.x;
        p.z = at.z;
        p.floor = bed(p.s, p.u);
      }
      ctx.animate.push((dt) => {
        for (let i = 0; i < count; i++) {
          const p = seeds[i];
          p.t += dt * p.speed * 0.15;
          if (p.t > 1) p.t -= 1;
          pos[i * 3] = p.x + Math.sin(p.t * 9 + i) * 0.3;
          pos[i * 3 + 1] = p.floor + (lv - p.floor) * p.t * 0.6;
          pos[i * 3 + 2] = p.z + Math.cos(p.t * 7 + i) * 0.3;
        }
        g.attributes.position.needsUpdate = true;
      });
    },
  });
}
addPlace({ id: "mussels", name: "Muschelbank", line: "Flussperlmuscheln – ihre Larven reisen an Lachskiemen mit", s: 4520, u: 0, radius: 14, icon: "place", tier: "silver" });
addFeature({
  id: "mussels",
  s: 4520,
  reach: 380,
  *build(ctx) {
    const { range } = ctx;
    const c = section(4520);
    const uc = c.thalweg + c.half * 0.3;
    // Freshwater pearl mussels: long, kidney-shaped, dark brown to black, a hand long; they
    // stand in the gravel on end, a little more than half of them sunk in it, the two
    // valves gaping a little at the top where the water goes in and out. A bed of them,
    // close together, and here and there an empty valve lying on the gravel.
    for (let k = 0; k < 150; k++) {
      const r = Math.sqrt(ctx.random()) * 9,
        a = range(0, TAU);
      const s = 4520 + Math.cos(a) * r * 1.4,
        u = uc + Math.sin(a) * r;
      place(s, u, at);
      const floor = bed(s, u);
      const size = range(0.8, 1.25);
      const yaw = range(0, TAU);
      // Dark brown to olive-black, lighter towards the rim, with growth rings round the beak.
      const shell = new THREE.Color(0.075, 0.052, 0.032).lerp(new THREE.Color(0.1, 0.09, 0.048), ctx.random()).multiplyScalar(range(0.85, 1.35));
      const valve = (geometry, x, y, z, sx, sy, sz, pitch, roll) => {
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ")), new THREE.Vector3(sx, sy, sz));
        const local = geometry.attributes.position;
        ctx.masonry.add(geometry, m, shell, (p, n, i) => {
          const d = Math.hypot(local.getX(i) + 0.45, local.getY(i) - 0.55, local.getZ(i) * 0.5);
          return (0.75 + 0.25 * Math.max(0, n.y)) * (0.85 + 0.35 * Math.min(1, d * 0.8)) * (0.9 + 0.12 * Math.sin(d * 22));
        });
      };
      if (k % 12 === 11) {
        // An empty valve, lying on its back.
        valve(VALVE, at.x, floor + 0.02, at.z, 0.6 * size, 0.26 * size, 0.14 * size, -Math.PI / 2, 0);
        continue;
      }
      const tilt = range(0.75, 1.25); // long axis raised from the bed
      for (const side of [-1, 1]) valve(side < 0 ? VALVE : VALVE_B, at.x, floor + 0.04 * size, at.z, 0.6 * size, 0.26 * size, 0.15 * size, side * 0.07, tilt);
      if (k % 25 === 24) yield "mussels";
    }
    void c;
  },
});

// The king's pool: dark, deep, ringed with old boulders, a sunken trunk across it.
addPlace({ id: "king-pool", name: KING_POOL.name, line: "Hier wohnt der alte König der Forellen", s: KING_POOL.s, u: 0, radius: 20, icon: "hunter", tier: "gold" });
addFeature({
  id: "king-pool",
  s: KING_POOL.s,
  reach: 420,
  *build(ctx) {
    const { range } = ctx;
    const c = section(KING_POOL.s);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU + range(-0.2, 0.2);
      const s = KING_POOL.s + Math.cos(a) * 26,
        u = c.thalweg + Math.sin(a) * c.half * 0.8;
      const r = range(2, 3.8);
      ctx.stone(s, u, r, r * range(0.7, 1));
    }
    yield "stones";
    // A drowned trunk across the deep end.
    const pts = [];
    for (let t = 0; t < 4; t++) {
      const f = t / 3 - 0.5;
      const s = KING_POOL.s + 8 + f * 6,
        u = c.thalweg + f * c.half * 1.6;
      place(s, u, at);
      pts.push(new THREE.Vector3(at.x, bed(s, u) + 1.2, at.z));
    }
    ctx.wood.push(trunkGeometry(pts, 1.1, 0.7, 7));
    for (const p of pts) ctx.colliders.push({ x: p.x, y: p.y, z: p.z, r: 1.3, ry: 1.3 });
  },
});

// ---------------------------------------------------------------------------------------
// The fjord and the weir.

// A fishing boat sunk long ago, lying on its side on the bed of the fjord, a hole stove in
// its hull: a cave of rotten planks, overgrown, where the cod keep.
export const WRECK = { s: S.coast + 900, u: 380, length: 90, beam: 26, name: "Wrack" };
addPlace({ id: "wreck", name: "Wrack", line: "Ein alter Fischkutter auf dem Grund des Fjords", s: WRECK.s, u: WRECK.u, radius: 55, icon: "place", tier: "gold" });
addFeature({
  id: "wreck",
  s: WRECK.s,
  reach: 700,
  *build(ctx) {
    const { range } = ctx;
    const { s: s0, u: u0, length, beam } = WRECK;
    place(s0, u0, at);
    const cx = at.x,
      cz = at.z;
    const floor = bed(s0, u0);
    const heading = 0.7; // lying across the current
    const roll = 0.55; // heeled over onto one side
    const ax = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    const side = new THREE.Vector3(-Math.sin(heading), 0, Math.cos(heading));
    const D = beam * 0.42; // depth of the hull below the deck
    const base = floor + D * 0.72; // the keel sunk a little into the bed
    // A point in the boat's own frame (along from midships, across, up from the deck), heeled.
    const boat = (along, across, up, out = new THREE.Vector3()) => {
      const x = across * Math.cos(roll) - up * Math.sin(roll);
      const y = across * Math.sin(roll) + up * Math.cos(roll);
      return out.set(cx + ax.x * along + side.x * x, base + y, cz + ax.z * along + side.z * x);
    };
    // Half-beam along the hull: a square stern, full midships, a sharp bow; the sheer rising
    // to the bow.
    const halfBeam = (t) => beam * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(0.999, 0.12 + t * 0.87)), 0.6) * (t > 0.78 ? Math.max(0.02, 1 - (t - 0.78) * 4.4) : 1);
    const sheer = (t) => 5 * Math.pow(t, 4) + 1.5 * Math.pow(1 - t, 4);
    const point = (t, a) => {
      // t along (0 stern .. 1 bow), a round the U (0 one gunwale .. 1 the other).
      const theta = Math.PI * (a - 0.5);
      const depth = D * (1 - 0.3 * smooth(0.7, 1, t));
      return boat((t - 0.5) * length, Math.sin(theta) * halfBeam(t), sheer(t) - Math.cos(theta) * depth);
    };
    const hash = (i, j) => Math.abs((Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1);
    // Stove in on the side that lies uppermost: the way in.
    const hole = { from: 0.4, to: 0.58, a0: 0.6, a1: 0.86 };
    const inHole = (t, a, pad = 0) => t > hole.from - pad && t < hole.to + pad && a > hole.a0 - pad && a < hole.a1 + pad;
    function sheet(rows, cols, at, keep, color) {
      const pos = [],
        col = [],
        idx = [];
      for (let i = 0; i <= rows; i++)
        for (let j = 0; j <= cols; j++) {
          const p = at(i / rows, j / cols);
          pos.push(p.x, p.y, p.z);
          const k = (0.72 + 0.28 * hash(i, j)) * (j % 2 ? 0.88 : 1);
          col.push(color.r * k, color.g * k, color.b * k);
        }
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          if (!keep(i, j, (i + 0.5) / rows, (j + 0.5) / cols)) continue;
          const k = i * (cols + 1) + j;
          idx.push(k, k + cols + 1, k + 1, k + 1, k + cols + 1, k + cols + 2);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, ctx.earth);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = "Wreck";
      ctx.group.add(mesh);
    }
    // The hull, planked, a few planks rotted away.
    sheet(34, 16, point, (i, j, t, a) => !inHole(t, a) && hash(i, j) < 0.94, new THREE.Color(0.2, 0.16, 0.11));
    yield "hull";
    // The deck, planks missing here and there, the fish hold's hatch open.
    const deckAt = (t, a) => {
      const tt = 0.02 + t * 0.95;
      return boat((tt - 0.5) * length, (a * 2 - 1) * halfBeam(tt) * 0.97, sheer(tt) - 0.5);
    };
    sheet(38, 10, deckAt, (i, j, t, a) => !(t > 0.62 && t < 0.74 && a > 0.3 && a < 0.7) && hash(j, Math.floor(i / 5)) < 0.86, new THREE.Color(0.15, 0.15, 0.1));
    yield "deck";
    // The wheelhouse aft, its windows black; a rudder at the stern.
    const hullColor = new THREE.Color(0.2, 0.19, 0.16);
    const whAt = boat(-length * 0.28, 0, sheer(0.22) + 4.5);
    solid(ctx.masonry, BOX, whAt.x, whAt.y, whAt.z, 13, 9, 11, -heading, hullColor, -roll);
    const roofAt = boat(-length * 0.28, 0, sheer(0.22) + 9.3);
    solid(ctx.masonry, BOX, roofAt.x, roofAt.y, roofAt.z, 14.5, 0.8, 12.5, -heading, new THREE.Color(0.12, 0.13, 0.09), -roll);
    for (const k of [-1, 1]) {
      const winAt = boat(-length * 0.28 + 6.6, k * 2.8, sheer(0.22) + 6);
      solid(ctx.masonry, BOX, winAt.x, winAt.y, winAt.z, 0.3, 2.6, 3.6, -heading, new THREE.Color(0.02, 0.03, 0.03), -roll);
    }
    for (const [dx, dy] of [
      [-3, 3],
      [3, 3],
      [0, 6],
    ]) {
      const p = boat(-length * 0.28 + dx, 0, sheer(0.22) + dy);
      ctx.colliders.push({ x: p.x, y: p.y, z: p.z, r: 5.5, ry: 5.5 });
    }
    const rudder = boat(-length * 0.5 - 1.2, 0, -D * 0.6);
    solid(ctx.masonry, BOX, rudder.x, rudder.y, rudder.z, 5, 7, 0.6, -heading, hullColor, -roll);
    // Its walls and deck as colliders, all but the hole and the hatch.
    for (let i = 1; i < 34; i += 1)
      for (let j = 0; j <= 16; j += 2) {
        const t = i / 34,
          a = j / 16;
        if (inHole(t, a, 0.03)) continue;
        const p = point(t, a);
        ctx.colliders.push({ x: p.x, y: p.y, z: p.z, r: 2.4, ry: 2.4 });
      }
    for (let i = 1; i < 19; i++)
      for (let j = 0; j <= 4; j++) {
        const t = i / 19,
          a = j / 4;
        if (t > 0.6 && t < 0.76 && a > 0.25 && a < 0.75) continue;
        const p = deckAt(t, a);
        ctx.colliders.push({ x: p.x, y: p.y, z: p.z, r: 2.4, ry: 2.4 });
      }
    // The mast, still standing though leaning with the hull, broken off; its top lying on the
    // bed beside it.
    const up = boat(0, 0, 1).sub(boat(0, 0, 0));
    const foot = boat(length * 0.12, 0, sheer(0.62) - 0.5);
    const top = foot.clone().addScaledVector(up, 24);
    ctx.wood.push(trunkGeometry([foot, foot.clone().lerp(top, 0.5), top], 0.9, 0.7, 3));
    const lie0 = top.clone().addScaledVector(ax, 3).setY(0);
    const lie1 = lie0.clone().addScaledVector(ax, 20).addScaledVector(side, -6);
    const l0 = ctx.locate(lie0.x, lie0.z),
      l1 = ctx.locate(lie1.x, lie1.z);
    lie0.y = bed(l0.s, l0.u) + 0.6;
    lie1.y = bed(l1.s, l1.u) + 0.6;
    ctx.wood.push(trunkGeometry([lie0, lie0.clone().lerp(lie1, 0.5), lie1], 0.7, 0.55, 4));
    // Kelp and weed on the hull and deck.
    for (let k = 0; k < 26; k++) {
      const p = k % 2 ? point(range(0.1, 0.9), range(0.5, 1)) : deckAt(range(0, 1), range(0, 1));
      mossTuft(ctx.plants, p, range(0, TAU), ctx.random, range(1.2, 2.4));
    }
    // Inside: out of sight.
    for (let t = 0.2; t <= 0.8; t += 0.15) {
      const p = point(t, 0.5);
      ctx.cover.push({ x: p.x, z: p.z, radius: beam * 0.4, top: base + 1 });
    }
    void u0;
  },
});

// The salmon farm: round net pens hanging from floating rings in a sheltered corner of the
// fjord, crowded with farmed salmon going round and round. Feed drifts out through the nets
// -- and the pens breed sea lice, which a wild fish lingering by them picks up.
export const FARM = { s: S.coast + 380, u: -720, pens: 3, radius: 22, depth: 26, name: "Lachsfarm" };
addPlace({ id: "farm", name: FARM.name, line: "Netzgehege voller Zuchtlachse – Futter, aber auch Lachsläuse", s: FARM.s, u: FARM.u, radius: 80, icon: "place", tier: "silver" });
let farmFish = null;
addFeature({
  id: "farm",
  s: FARM.s,
  reach: 700,
  *build(ctx) {
    const { range, random } = ctx;
    const lv = level(FARM.s);
    const pens = [];
    for (let k = 0; k < FARM.pens; k++) {
      const s = FARM.s + (k - 1) * FARM.radius * 2.6,
        u = FARM.u + (k % 2 ? 12 : -12);
      place(s, u, at);
      pens.push({ x: at.x, z: at.z });
    }
    // Floating rings, walkway posts, and the nets.
    const netCanvas = document.createElement("canvas");
    netCanvas.width = netCanvas.height = 64;
    const nc = netCanvas.getContext("2d");
    nc.strokeStyle = "rgba(40, 50, 45, 0.85)";
    nc.lineWidth = 3;
    for (let i = 0; i <= 64; i += 16) {
      nc.beginPath();
      nc.moveTo(i, 0);
      nc.lineTo(i, 64);
      nc.moveTo(0, i);
      nc.lineTo(64, i);
      nc.stroke();
    }
    const netTexture = new THREE.CanvasTexture(netCanvas);
    netTexture.wrapS = netTexture.wrapT = THREE.RepeatWrapping;
    netTexture.repeat.set(40, 8);
    const netMaterial = new THREE.MeshStandardMaterial({ map: netTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1, alphaTest: 0.05 });
    netMaterial.onBeforeCompile = (shader) => waterLitShader(shader);
    const ring = new THREE.Color(0.12, 0.12, 0.12);
    for (const p of pens) {
      const net = new THREE.Mesh(new THREE.CylinderGeometry(FARM.radius, FARM.radius * 0.85, FARM.depth, 40, 1, true), netMaterial);
      net.position.set(p.x, lv - FARM.depth / 2 + 0.3, p.z);
      net.name = "Net pen";
      ctx.group.add(net);
      const torus = new THREE.TorusGeometry(FARM.radius, 0.7, 8, 48).rotateX(Math.PI / 2);
      const m = new THREE.Matrix4().makeTranslation(p.x, lv + 0.2, p.z);
      ctx.masonry.add(torus, m, ring);
      const m2 = new THREE.Matrix4().makeTranslation(p.x, lv + 1.8, p.z);
      ctx.masonry.add(new THREE.TorusGeometry(FARM.radius, 0.25, 6, 48).rotateX(Math.PI / 2), m2, ring);
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * TAU;
        solid(ctx.masonry, CYL, p.x + Math.cos(a) * FARM.radius, lv + 1, p.z + Math.sin(a) * FARM.radius, 0.18, 1.8, 0.18, 0, ring);
      }
      yield "pen";
    }
    // The farmed fish, going round.
    if (!farmFish) farmFish = createFishMesh(scene0, "salmon", "sea", 72, { name: "Farm salmon", cacheKey: "farm-salmon", detail: 0.5, castShadow: false });
    const fish = Array.from({ length: 72 }, (_, i) => ({ pen: i % pens.length, r: range(0.3, 0.85) * FARM.radius, y: range(2, FARM.depth - 4), a: range(0, TAU), speed: range(0.08, 0.16), size: range(5.5, 7.5), phase: range(0, TAU) }));
    const matrix = new THREE.Matrix4(),
      quaternion = new THREE.Quaternion(),
      scaleV = new THREE.Vector3(),
      position = new THREE.Vector3(),
      heading = new THREE.Vector3(),
      axisY = new THREE.Vector3(),
      axisZ = new THREE.Vector3(),
      basis = new THREE.Matrix4();
    const UP = new THREE.Vector3(0, 1, 0);
    let pelletClock = 3;
    ctx.animate.push((dt, env) => {
      farmFish.begin();
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i];
        f.a += f.speed * dt * (10 / Math.max(4, f.r));
        f.phase += dt * 7;
        const p = pens[f.pen];
        position.set(p.x + Math.cos(f.a) * f.r, lv - f.y, p.z + Math.sin(f.a) * f.r);
        heading.set(-Math.sin(f.a), 0, Math.cos(f.a));
        axisZ.crossVectors(heading, UP).normalize();
        axisY.crossVectors(axisZ, heading).normalize();
        basis.makeBasis(heading, axisY, axisZ);
        quaternion.setFromRotationMatrix(basis);
        const k = f.size / MODEL_LENGTH;
        matrix.compose(position, quaternion, scaleV.set(k, k, k));
        farmFish.body.setMatrixAt(i, matrix);
        farmFish.swim.setXYZW(i, f.phase, 0.35, 0, 0.2);
        farmFish.fin.setX(i, f.phase);
        farmFish.mouth.setX(i, 0);
      }
      farmFish.finish();
      // Feed drifting out through the nets, when a wild fish is about.
      pelletClock -= dt;
      if (pelletClock <= 0 && env?.fish && env.toss) {
        pelletClock = range(2, 5);
        // Out through the side of the nearest pen that faces the fish.
        const fp = env.fish.position;
        let pen = pens[0],
          best = Infinity;
        for (const p of pens) {
          const d = Math.hypot(fp.x - p.x, fp.z - p.z);
          if (d < best) (best = d), (pen = p);
        }
        if (best < FARM.radius + 45) {
          const a = Math.atan2(fp.z - pen.z, fp.x - pen.x) + range(-0.5, 0.5);
          const r = FARM.radius * range(1.06, 1.25);
          for (let k = 0; k < 3; k++) env.toss("pellet", pen.x + Math.cos(a) * r + range(-1.5, 1.5), pen.z + Math.sin(a) * r + range(-1.5, 1.5));
        }
      }
    });
    ctx.release.push(() => {
      farmFish.begin();
      farmFish.finish();
      delete ctx.marks.farm;
    });
    // The nets keep a wild fish out.
    ctx.hazards.push((f) => {
      for (const p of pens) {
        const dx = f.position.x - p.x,
          dz = f.position.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < FARM.radius + 1.2 && f.position.y > lv - FARM.depth) {
          const push = (FARM.radius + 1.3 - d) * 4;
          return { strength: 0, push: new THREE.Vector3((dx / (d || 1)) * push, 0, (dz / (d || 1)) * push), quiet: true };
        }
      }
      return null;
    });
    // For the sea lice: where the pens are.
    ctx.marks.farm = pens;
  },
});

// The fish counter at the weir: over the slot of the top step of the pass, a frame with a
// light and a camera; every fish that swims up through it is counted.
const PASS_TOP = FALLS.filter((f) => f.pass).reduce((a, b) => (a.s < b.s ? a : b), { s: Infinity });
export const COUNTER = { s: PASS_TOP.s, name: "Zählstation" };
addPlace({ id: "counter", name: "Zählstation", line: "Hier wird jeder Lachs gezählt, der hinaufschwimmt", s: PASS_TOP.s + 1, u: 0, radius: 18, icon: "place", tier: "bronze" });
addFeature({
  id: "counter",
  s: PASS_TOP.s,
  reach: 420,
  *build(ctx) {
    const c = section(PASS_TOP.s);
    const slot = c.thalweg + c.half * 0.55;
    const lv = level(PASS_TOP.s - 0.1);
    const metal = new THREE.Color(0.55, 0.58, 0.6);
    const yaw = -flow0(PASS_TOP.s);
    // A frame round the slot: two posts, a lintel, a light panel on one side, a camera box
    // on the other; a hut on the bank.
    for (const side of [-1, 1]) {
      place(PASS_TOP.s - 0.5, slot + side * 2.9, at);
      const floor = bed(PASS_TOP.s - 1, slot);
      solid(ctx.masonry, BOX, at.x, (floor + lv + 3) / 2, at.z, 0.6, lv + 3 - floor, 0.6, yaw, metal);
      solid(ctx.masonry, BOX, at.x, (floor + lv) / 2, at.z, 0.3, lv - floor, 2.2, yaw, side < 0 ? new THREE.Color(1.6, 1.6, 1.5) : new THREE.Color(0.08, 0.08, 0.09));
    }
    place(PASS_TOP.s - 0.5, slot, at);
    solid(ctx.masonry, BOX, at.x, lv + 3, at.z, 0.6, 0.6, 6.4, yaw, metal);
    place(PASS_TOP.s - 6, c.thalweg + c.half * 1.12, at);
    solid(ctx.masonry, BOX, at.x, lv + 5, at.z, 9, 7, 7, yaw, new THREE.Color(0.55, 0.2, 0.15));
    solid(ctx.masonry, BOX, at.x, lv + 9, at.z, 10, 0.8, 8, yaw, new THREE.Color(0.2, 0.2, 0.22));
    yield "counter";
  },
});

// ---------------------------------------------------------------------------------------
let scene0 = null;
export function createFeatures(scene, { rocks, locate, surfaceMaterial = null }) {
  scene0 = scene;
  const leaves = foliageMaterial();
  const leafShadow = foliageDepth({ animated: true });
  const treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: 0x0b1408, emissiveIntensity: 1 });
  const shapes = Array.from({ length: 5 }, (_, i) => withMossChannel(rockGeometry(i * 4.1 + 2.3, 30, 1)));
  // Earth and turf, for the overhanging banks; stone and timber for what people built.
  const earth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const masonry = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const woodSolid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  // Lit like everything else under water: through the surface, with the caustics, dimming
  // with depth.
  for (const m of [earth, masonry, woodSolid]) m.onBeforeCompile = (shader) => waterLitShader(shader);
  const built = new Map(); // id -> { group, colliders, cover }
  const queue = [];
  // What some places tell the rest of the game (the farm's pens, for the sea lice).
  const marks = {};

  function* job(feature) {
    const random = randomGenerator(7331 + feature.s * 13.1);
    const range = (a, b) => a + (b - a) * random();
    const group = new THREE.Group();
    group.name = `Feature ${feature.id}`;
    const ctx = {
      random,
      range,
      locate,
      group,
      surface: surfaceMaterial,
      plants: new GeometryBatch(),
      trees: new SolidBatch(),
      stones: new SolidBatch(),
      wood: [],
      colliders: [],
      cover: [],
      f: {},
      earth,
      earthBatch: new SolidBatch(),
      masonry: new SolidBatch(),
      woodSolid,
      animated: [],
      animate: [],
      hazards: [],
      release: [],
      marks,
      // A lump of earth (for overhanging banks), coloured as given.
      lump(x, y, z, rx, ry, rz, yaw, color) {
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(range(-0.1, 0.1), yaw, range(-0.1, 0.1))), new THREE.Vector3(rx, ry, rz));
        ctx.earthBatch.add(shapes[Math.floor(random() * shapes.length)], m, color, (p, n) => 0.75 + 0.35 * Math.max(0, n.y));
      },
      // A rock at a world point, its radii and its turn about the vertical.
      rock(x, y, z, rx, ry, rz, yaw) {
        const euler = new THREE.Euler(range(-0.12, 0.12), yaw, range(-0.12, 0.12));
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(euler), new THREE.Vector3(rx, ry, rz));
        const shape = shapes[Math.floor(random() * shapes.length)];
        ctx.stones.add(shape, m, new THREE.Color(range(0.7, 1), range(0.6, 1), 0), (q, n, i) => shape.attributes.color.getX(i));
        ctx.colliders.push({ x, y, z, r: Math.max(rx, rz) * 1.05, rx: rx * 1.05, rz: rz * 1.05, ry: ry * 1.05, cos: Math.cos(yaw), sin: Math.sin(yaw) });
      },
      // A stone at (s, u): radius r across, ry high; set on the bed, or at y if given.
      stone(s, u, r, ry, y = null) {
        place(s, u, at);
        const floor = bed(s, u);
        const cy = y ?? floor + ry * 0.35;
        const euler = new THREE.Euler(range(-0.2, 0.2), range(0, TAU), range(-0.2, 0.2));
        const m = new THREE.Matrix4().compose(new THREE.Vector3(at.x, cy, at.z), new THREE.Quaternion().setFromEuler(euler), new THREE.Vector3(r, ry, r * range(0.8, 1.2)));
        const shape = shapes[Math.floor(random() * shapes.length)];
        ctx.stones.add(shape, m, new THREE.Color(range(0.75, 1.05), range(0.5, 1), 0), (q, n, i) => shape.attributes.color.getX(i));
        ctx.colliders.push({ x: at.x, y: cy, z: at.z, r: r * 1.05, rx: r * 1.05, rz: r * 1.05, ry: ry * 1.05, cos: Math.cos(euler.y), sin: Math.sin(euler.y) });
      },
    };
    yield* feature.build(ctx);
    if (ctx.plants.positions.length) {
      const geometry = ctx.plants.geometry();
      geometry.computeBoundingSphere();
      geometry.boundingSphere.radius += 8;
      const mesh = new THREE.Mesh(geometry, leaves);
      mesh.customDepthMaterial = leafShadow;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = "Plants";
      group.add(mesh);
    }
    if (!ctx.trees.empty) {
      const mesh = new THREE.Mesh(ctx.trees.geometry(), treeMaterial);
      mesh.name = "Trees";
      group.add(mesh);
    }
    if (!ctx.masonry.empty) {
      const g = ctx.masonry.geometry();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, masonry);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = "Masonry";
      group.add(mesh);
    }
    if (!ctx.earthBatch.empty) {
      const g = ctx.earthBatch.geometry();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, earth);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = "Earth";
      group.add(mesh);
    }
    if (!ctx.stones.empty) {
      const g = ctx.stones.geometry();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, rocks.brook ?? rocks.river);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = "Stones";
      group.add(mesh);
    }
    for (const g of ctx.wood) {
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let v = 0; v < colors.length; v += 3) {
        colors[v] = 0.55;
        colors[v + 1] = 0.45;
        colors[v + 2] = 0;
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(g, rocks.wood);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = "Wood";
      group.add(mesh);
    }
    // Everything stands still but what turns (the mill wheel).
    const moving = new Set();
    for (const a of ctx.animated) a.traverse((o) => moving.add(o));
    group.traverse((o) => {
      o.updateMatrix();
      if (!moving.has(o)) o.matrixAutoUpdate = false;
    });
    group.updateMatrixWorld(true);
    scene.add(group);
    built.set(feature.id, { group, colliders: ctx.colliders, cover: ctx.cover, feature, animate: ctx.animate, hazards: ctx.hazards, release: ctx.release });
  }

  function release(id) {
    const b = built.get(id);
    if (!b) return;
    for (const r of b.release) r();
    scene.remove(b.group);
    b.group.traverse((o) => o.geometry?.dispose?.());
    built.delete(id);
  }

  return {
    built,
    marks,
    // Build what is within reach of the fish (a few milliseconds a frame), drop what is far;
    // and move what moves (env: { dt, time, fish, light, toss, events }).
    update(s, budget = 3, env = null) {
      for (const f of FEATURES) {
        const d = Math.abs(f.s - s);
        if (d < f.reach && !built.has(f.id) && !queue.some((q) => q.feature === f)) queue.push({ feature: f, steps: job(f) });
        else if (d > f.reach + 200 && built.has(f.id)) release(f.id);
      }
      const start = performance.now();
      while (queue.length && performance.now() - start < budget) {
        const q = queue[0];
        if (q.steps.next().done) queue.shift();
      }
      if (env && env.dt > 0) for (const b of built.values()) if (Math.abs(b.feature.s - s) < 400) for (const a of b.animate) a(env.dt, env);
    },
    // Whether something built strikes the fish just now (the mill wheel's paddles).
    hazard(fish, time) {
      for (const b of built.values()) for (const h of b.hazards) {
        const hit = h(fish, time);
        if (hit) return hit;
      }
      return null;
    },
    // Everything at once (a start, a jump).
    prime(s) {
      this.update(s, Infinity);
    },
    collidersNear(x, z, reach, out) {
      for (const b of built.values()) for (const c of b.colliders) if (Math.abs(c.x - x) < reach + c.r && Math.abs(c.z - z) < reach + c.r) out.push(c);
      return out;
    },
    covered(x, y, z) {
      for (const b of built.values()) for (const c of b.cover) if (Math.hypot(c.x - x, c.z - z) < c.radius && y < c.top) return true;
      return false;
    },
  };
}
