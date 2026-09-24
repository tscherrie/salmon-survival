import * as THREE from "three";
import {
  GeometryBatch,
  channel,
  groundHeight,
  randomGenerator,
  smoothstep,
  vec,
} from "./math.js";
import { FLOW_DIRECTION } from "./water.js";
import { CENTER, MEADOWS, ORBIT, ROCKS, SURFACE_Y, THICKETS, rockCenterY } from "./layout.js";
import { TAU, blade, foliageDepth, foliageMaterial, stem, stemStrand } from "./foliage.js";
import { echinodorus, rockClearance } from "./broadleaf.js";

const FLOW_ANGLE = Math.atan2(FLOW_DIRECTION.z, FLOW_DIRECTION.x);
// The planting draws from its own stream, so other modules keep their numbers.
const random = randomGenerator(34191);
const range = (a, b) => a + (b - a) * random();

// Whether a point on the bed is clear of every stone, with `margin` in stone radii.
function clearOfStones(x, z, margin = 1) {
  for (const rock of ROCKS) {
    const d = Math.hypot((x - rock.x) / rock.rx, (z - rock.z) / rock.rz);
    if (d < 0.95 * margin) return false;
  }
  return true;
}

// Ribbon grass: a rosette of long, thin, strap-shaped leaves, Vallisneria-like. In a
// running river the leaves do not stand: they rise from the crown and then lie over and
// stream downstream, the taller the further, with their tips trailing near the surface.
// Older outer leaves are longer, paler and lean further; the oldest tips have browned.
function ribbonRosette(batch, x, z, height, count, lod = {}) {
  const root = vec(x, groundHeight(x, z) - 0.03, z);
  for (let i = 0; i < count; i++) {
    const age = random();
    const theta =
      random() < 0.82 ? FLOW_ANGLE + range(-0.75, 0.75) : range(0, TAU);
    const h = height * (0.5 + 0.65 * age) * range(0.92, 1.08);
    const sweep = range(1.1, 3.4) * (0.6 + 0.6 * age) * (0.75 + 0.07 * h);
    const direction = vec(Math.cos(theta), 0, Math.sin(theta));
    const base = root.clone().addScaledVector(direction, range(0, 0.08));
    const points = [
      base,
      base.clone().add(vec(direction.x * 0.08, h * 0.62, direction.z * 0.08)),
      base.clone().add(vec(direction.x * sweep * 0.35, h * 1.1, direction.z * sweep * 0.35)),
      base.clone().add(vec(direction.x * sweep, h * range(0.82, 0.96), direction.z * sweep)),
    ];
    const color = new THREE.Color().setHSL(
      0.225 + 0.06 * (1 - age) + range(-0.012, 0.012),
      range(0.6, 0.82),
      0.23 + 0.16 * age,
    );
    blade(batch, points, range(0.05, 0.12), color, root, range(0.85, 1.2), {
      rows: lod.rows ?? 30,
      cols: lod.cols ?? 6,
      emit: lod.keep ? lod.keep() : true,
      twist: theta + Math.PI / 2,
      ribbon: true,
      thin: 1,
      browning: age > 0.8 ? range(0.08, 0.22) : 0,
    });
  }
}

// Pygmy chain sword: a lawn of tiny grass-like rosettes spreading by runners over the
// lit sand of the bar. Each plant is a handful of narrow leaves a few centimetres long.
function lawn(batch, cx, cz, radius, density, lod) {
  const plants = Math.round(Math.PI * radius * radius * density);
  for (let i = 0; i < plants; i++) {
    const a = range(0, TAU),
      d = radius * Math.sqrt(random());
    const x = cx + Math.cos(a) * d,
      z = cz + Math.sin(a) * d * 0.8;
    // The lawn thins toward its edge and never grows on the swept corridor or on a stone.
    const edge = d / radius;
    if (random() < smoothstep(0.55, 1, edge) * 0.8) continue;
    if (channel(x, z) > 0.6 || !clearOfStones(x, z, 1.05)) continue;
    const root = vec(x, groundHeight(x, z) - 0.01, z);
    const leaves = 3 + Math.floor(random() * 4);
    const size = range(0.22, 0.5) * (1.05 - 0.35 * edge);
    for (let k = 0; k < leaves; k++) {
      const theta = random() < 0.6 ? FLOW_ANGLE + range(-1.1, 1.1) : range(0, TAU);
      const lean = range(0.15, 0.55);
      const dir = vec(Math.cos(theta), 0, Math.sin(theta));
      const tip = root
        .clone()
        .addScaledVector(dir, size * lean)
        .add(vec(0, size * (1 - lean * 0.5), 0));
      const mid = root.clone().lerp(tip, 0.5).add(vec(0, size * 0.12, 0));
      const color = new THREE.Color().setHSL(
        range(0.23, 0.29),
        range(0.6, 0.8),
        range(0.2, 0.32),
      );
      blade(batch, [root, mid, tip], range(0.018, 0.032), color, root, 0.35, {
        rows: lod.rows,
        cols: 2,
        twist: theta + Math.PI / 2,
        thin: 0.8,
      });
    }
  }
}

// A water lily, Nymphaea: a rhizome in the sand sending long, supple leaf stalks up
// through the whole depth of the water to round pads lying on the film. From below the
// pads are dark discs against the bright surface, each with the slit that runs in to its
// stalk, and their shadows move over the sand as the stalks sway.
function waterLily(batch, x, z, pads) {
  const ground = groundHeight(x, z);
  const root = vec(x, ground - 0.05, z);
  const film = SURFACE_Y - 0.06;
  for (let k = 0; k < pads; k++) {
    const a = k * 2.39996 + range(-0.4, 0.4);
    const reach = range(0.4, 1.6);
    const top = vec(x + Math.cos(a) * reach + FLOW_DIRECTION.x * 0.6, film, z + Math.sin(a) * reach + FLOW_DIRECTION.z * 0.6);
    const height = film - ground;
    // The stalk rises nearly straight, bowed a little downstream, and turns out flat under
    // the pad for its last few centimetres.
    const points = [
      root.clone(),
      vec(x + (top.x - x) * 0.2, ground + height * 0.35, z + (top.z - z) * 0.2),
      vec(x + (top.x - x) * 0.7, ground + height * 0.8, z + (top.z - z) * 0.7),
      top.clone().add(vec(0, -0.18, 0)),
      top.clone(),
    ];
    const stalkColour = new THREE.Color().setHSL(range(0.1, 0.17), range(0.35, 0.5), range(0.34, 0.42));
    const { curve, length } = stem(batch, points, 0.016, stalkColour, root, 0.5);
    // The pad, riding on the top of its stalk.
    const strand = stemStrand(curve, 1, length, 0.5);
    const radius = range(0.45, 0.75);
    const notch = range(0, TAU);
    const RINGS = 5,
      SEGMENTS = 26;
    // Upper side green, underside wine-red: the side the viewer sees is the underside.
    const colour = new THREE.Color().setHSL(range(0.97, 1.02) % 1, range(0.35, 0.5), range(0.2, 0.27));
    const start = batch.positions.length / 3;
    for (let i = 0; i <= RINGS; i++) {
      const r = (i / RINGS) * radius;
      for (let j = 0; j <= SEGMENTS; j++) {
        // The slit: the pad's circle stops a little short either side of it.
        const theta = notch + 0.12 + (j / SEGMENTS) * (TAU - 0.24);
        const edge = i / RINGS;
        const p = vec(top.x + Math.cos(theta) * r, film - 0.01 * edge * edge, top.z + Math.sin(theta) * r);
        const tint = colour.clone().multiplyScalar(0.85 + 0.25 * edge);
        batch.vertex(p, [j / SEGMENTS, 0.5 + edge * 0.5], tint, root, strand, 0.35);
        if (i < RINGS && j < SEGMENTS) {
          const q = start + i * (SEGMENTS + 1) + j;
          batch.quad(q, q + 1, q + SEGMENTS + 1, q + SEGMENTS + 2);
        }
      }
    }
  }
}

// Fanwort, Cabomba: soft stems rising in stands, with a pair of feathery fans at every
// node -- each leaf split again and again into threads. The lower whorls are green; toward
// the light the tops flush red, as the red form in the clear rivers does.
function cabomba(batch, x, z, stems, height) {
  const ground = groundHeight(x, z);
  const root = vec(x, ground - 0.04, z);
  for (let k = 0; k < stems; k++) {
    const a = range(0, TAU),
      d = range(0, 0.35);
    const base = vec(x + Math.cos(a) * d, ground - 0.03, z + Math.sin(a) * d);
    const h = height * range(0.6, 1.05);
    const lean = range(0.1, 0.45);
    const points = [
      base,
      base.clone().add(vec(FLOW_DIRECTION.x * lean * 0.2, h * 0.35, FLOW_DIRECTION.z * lean * 0.2 + range(-0.1, 0.1))),
      base.clone().add(vec(FLOW_DIRECTION.x * lean * 0.6, h * 0.72, FLOW_DIRECTION.z * lean * 0.6 + range(-0.15, 0.15))),
      base.clone().add(vec(FLOW_DIRECTION.x * lean, h, FLOW_DIRECTION.z * lean)),
    ];
    const { curve, length } = stem(batch, points, 0.014, new THREE.Color().setHSL(0.2, 0.4, 0.2), root, 0.8);
    const nodes = Math.floor(length / 0.17);
    for (let n = 1; n <= nodes; n++) {
      const t = n / (nodes + 0.5);
      const node = curve.getPoint(t);
      const strand = stemStrand(curve, t, length, 0.8);
      const red = smoothstep(0.45, 0.95, t);
      const size = 0.24 * (1 - 0.45 * t * t);
      const turn = n * 1.5708 + range(-0.2, 0.2);
      for (const side of [0, Math.PI]) {
        // One fan: threads spread over a half-circle, reaching out and a little up.
        for (let f = 0; f < 5; f++) {
          const spread = turn + side + (f - 2) * 0.32;
          const dir = vec(Math.cos(spread), 0.35 + 0.15 * Math.abs(f - 2) * 0.3, Math.sin(spread)).normalize();
          const tip = node.clone().addScaledVector(dir, size);
          const mid = node.clone().addScaledVector(dir, size * 0.5).add(vec(0, size * 0.12, 0));
          const colour = new THREE.Color().setHSL(0.26 - 0.26 * red + range(-0.01, 0.01), 0.55 + 0.1 * red, 0.2 + 0.06 * red);
          blade(batch, [node, mid, tip], 0.012, colour, root, 0.8, {
            rows: 3,
            cols: 1,
            attached: strand,
            thin: 0.9,
          });
        }
      }
    }
  }
}

// A dead leaf on the sand, browned and curling, caught where the current let it go.
function fallenLeaf(batch, x, z, length, heading) {
  const direction = vec(Math.cos(heading), 0, Math.sin(heading));
  const root = vec(x, groundHeight(x, z) + 0.014, z);
  const points = [
    root,
    root.clone().addScaledVector(direction, length * 0.5).add(vec(0, 0.04, 0)),
    root.clone().addScaledVector(direction, length).add(vec(0, 0.08, 0)),
  ];
  const color = new THREE.Color().setHSL(range(0.06, 0.12), range(0.35, 0.55), range(0.18, 0.3));
  blade(batch, points, length * range(0.16, 0.24), color, root, 0.04, {
    rows: 14,
    cols: 6,
    twist: heading + Math.PI / 2,
    thin: 0.25,
    browning: 0.8,
  });
}

// Detail budgets for the grass, from the beds just behind the fish to the far bank.
const LOD = {
  near: { rows: 28, cols: 5 },
  far: { rows: 14, cols: 2 },
  haze: { rows: 8, cols: 2 },
};

export function createPlants(scene, {
  backgroundDensity = 0.7,
  backgroundRows = 20,
  backgroundCols = 2,
  lawnDensity = 20,
  animatedShadows = true,
} = {}) {
  const batch = new GeometryBatch();
  const density = Number.isFinite(backgroundDensity)
    ? Math.max(0, Math.min(1, backgroundDensity))
    : 0.7;
  const stats = { backgroundCandidates: 0, backgroundKept: 0 };
  // Distributed, deterministic thinning of the distant grass, not clump removal. A
  // thinned leaf still draws its random numbers, so everything nearer keeps its shape.
  const keep = () => {
    const i = stats.backgroundCandidates++;
    const kept = Math.floor((i + 1) * density + 1e-9) > Math.floor(i * density + 1e-9);
    if (kept) stats.backgroundKept++;
    return kept;
  };
  const rowsScale = Math.max(0.5, Math.min(1.6, backgroundRows / 20));
  const colsFar = Math.max(2, Math.round(backgroundCols));

  // Where a clump of a bed may stand: anywhere in a box, or anywhere in a ring sector with
  // a few gaps left open, so the ring is broken into stands with sand lanes between.
  const clumpSite = (bed) => {
    if (bed.box) return [range(bed.box[0], bed.box[1]), range(bed.box[2], bed.box[3])];
    for (;;) {
      const a = range(0, TAU);
      const r = Math.sqrt(range(bed.ring[0] ** 2, bed.ring[1] ** 2));
      if (Math.sin(a * 3 + 1.3) > 0.82 && random() < 0.8) continue;
      return [CENTER.x + Math.cos(a) * r, CENTER.z + Math.sin(a) * r];
    }
  };

  // Distant beds first, so the near planting's geometry sits after the thinned block.
  for (const bed of MEADOWS.filter((m) => m.detail !== "near")) {
    const lod = {
      rows: Math.max(4, Math.round(LOD[bed.detail].rows * rowsScale)),
      cols: colsFar,
      keep,
    };
    for (let c = 0; c < bed.clumps; c++) {
      const [cx, cz] = clumpSite(bed);
      const spread = range(0.9, 2.2);
      const rosettes = Math.floor(range(4, 7));
      for (let i = 0; i < rosettes; i++) {
        const a = range(0, TAU),
          d = spread * Math.sqrt(random());
        const x = cx + Math.cos(a) * d,
          z = cz + Math.sin(a) * d * 0.7;
        if (!clearOfStones(x, z)) continue;
        ribbonRosette(batch, x, z, bed.height * range(0.62, 1.05), Math.floor(range(9, 15)), lod);
      }
    }
  }
  stats.backgroundVertices = batch.positions.length / 3;
  stats.backgroundTriangles = batch.indices.length / 3;

  for (const bed of MEADOWS.filter((m) => m.detail === "near")) {
    const [minX, maxX, minZ, maxZ] = bed.box;
    for (let c = 0; c < bed.clumps; c++) {
      const [cx, cz] = clumpSite(bed);
      const spread = range(0.5, 1.2);
      const rosettes = Math.floor(range(4, 7));
      for (let i = 0; i < rosettes; i++) {
        const a = range(0, TAU),
          d = spread * Math.sqrt(random());
        const x = cx + Math.cos(a) * d,
          z = cz + Math.sin(a) * d * 0.7;
        if (!clearOfStones(x, z)) continue;
        ribbonRosette(batch, x, z, bed.height * range(0.6, 1.05), Math.floor(range(10, 16)), LOD.near);
      }
    }
    // Runners have set young plants out on their own at the edges of the bed.
    for (let i = 0; i < 5; i++) {
      const x = range(minX - 0.8, maxX + 0.8),
        z = range(minZ - 0.8, maxZ + 0.8);
      if (!clearOfStones(x, z)) continue;
      ribbonRosette(batch, x, z, bed.height * range(0.35, 0.6), Math.floor(range(5, 8)), LOD.near);
    }
  }

  // Tufts of grass at the feet of the stones and along the edges of the thalweg break the
  // line where stone meets sand. Out in the viewer's band they stay short.
  for (const [x, z, h, n] of [
    [-10.9, 0.4, 2.2, 10],
    [-6.2, -2.9, 2.8, 12],
    [-4.4, 0.2, 1.4, 8],
    [3.6, -3.4, 2.4, 11],
    [9.8, -0.6, 2.6, 12],
    [12.2, 1.2, 1.8, 9],
    [-2.9, -7.6, 3.2, 12],
    [6.4, -9.8, 3.4, 13],
    [-12.6, 2.6, 1.6, 8],
    [4.9, -14.6, 2.6, 11],
    [-12.4, -9.8, 2.6, 10],
    [10.4, -11.8, 2.0, 10],
    [-3.4, 10.4, 1.8, 9],
    [9.8, 9.8, 1.6, 8],
    [-14.6, 8.6, 1.4, 8],
    [15.2, 3.2, 1.3, 8],
  ])
    ribbonRosette(batch, x, z, h, n, LOD.near);
  for (let i = 0; i < 26; i++) {
    const a = range(0, TAU),
      r = range(ORBIT.clearInner - 1, ORBIT.clearOuter + 1);
    const x = CENTER.x + Math.cos(a) * r,
      z = CENTER.z + Math.sin(a) * r;
    if (!clearOfStones(x, z)) continue;
    ribbonRosette(batch, x, z, range(0.8, 1.5), Math.floor(range(5, 9)), LOD.near);
  }

  // Amazon swords round the clearing, at the feet of the stones and the wood.
  for (const [x, z, bladeLength, leaves, hue] of [
    [-5.3, 3.4, 1.55, 12, 0.25],
    [-5.0, 5.9, 1.05, 9, 0.26],
    [-9.2, 5.6, 0.9, 8, 0.24],
    [6.8, 4.2, 1.45, 11, 0.245],
    [8.3, 3.4, 1.1, 9, 0.255],
    [-0.8, -6.4, 1.9, 12, 0.24],
    [1.2, -2.6, 1.5, 11, 0.25],
    [-11.8, -1.8, 1.7, 11, 0.245],
    [3.4, -11.4, 1.6, 11, 0.25],
    [-6.2, -9.4, 1.4, 10, 0.245],
    [12.8, -2.0, 1.3, 10, 0.25],
    [8.2, -14.2, 1.2, 9, 0.24],
    [-9.4, 7.8, 1.2, 9, 0.255],
    [2.6, 10.2, 1.3, 10, 0.25],
    [-14.2, -3.8, 1.2, 9, 0.245],
  ]) {
    if (rockClearance(x, z) < 1) continue;
    const toward = vec(CENTER.x - x, 0, CENTER.z - z);
    echinodorus(batch, {
      x,
      z,
      blade: bladeLength,
      leaves,
      hue,
      open: toward.lengthSq() > 0.01 ? toward.normalize().negate() : vec(0, 0, 1),
    });
  }

  // The chain-sword lawn: patches all round the clearing and out through the viewer's
  // band, where the sand is lit and nothing taller grows.
  const lawnLod = { rows: lawnDensity > 24 ? 6 : 5 };
  for (const [x, z, r] of [
    [-3.6, 7.6, 2.3],
    [5.4, 8.6, 1.9],
    [-8.6, 7.4, 1.5],
    [1.9, 1.4, 1.1],
    [-1.8, -2.6, 1.4],
    [10.4, 0.2, 1.3],
    [-9.4, 2.5, 1.2],
    [11.6, 5.8, 1.6],
  ])
    lawn(batch, x, z, r, lawnDensity, lawnLod);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + range(-0.2, 0.2),
      r = range(9, ORBIT.clearOuter);
    lawn(batch, CENTER.x + Math.cos(a) * r, CENTER.z + Math.sin(a) * r, range(1.1, 2.0), lawnDensity, lawnLod);
  }

  // Water lilies out beyond the stones, their pads on the film, and stands of fanwort at
  // the feet of the rocks.
  for (const [x, z, pads] of [
    [4.6, 10.6, 6],
    [8.4, -13.4, 5],
    [-13.6, 0.6, 7],
    [-3.6, -14.6, 4],
  ])
    if (clearOfStones(x, z, 1.3)) waterLily(batch, x, z, pads);
  for (const [x, z, stems, height] of [
    [-3.2, 7.4, 7, 2.6],
    [9.8, -6.4, 6, 3.2],
    [-11.8, 3.2, 6, 2.4],
    [0.6, -14.0, 5, 2.8],
    [11.6, 4.8, 5, 2.2],
  ])
    if (clearOfStones(x, z, 1.2)) cabomba(batch, x, z, stems, height);

  // Litter: leaves from the gallery forest overhead, settled on the sand.
  for (let i = 0; i < 34; i++) {
    const a = range(0, TAU),
      r = Math.sqrt(random()) * 23;
    const x = CENTER.x + Math.cos(a) * r,
      z = CENTER.z + Math.sin(a) * r;
    if (!clearOfStones(x, z, 1.1)) continue;
    fallenLeaf(batch, x, z, range(0.6, 1.2), range(0, TAU));
  }

  // One set of buffers, drawn as two meshes: the distant meadow, whose shadows would fall
  // beyond the sun's shadow map anyway and so casts none, and everything near, which does.
  const geometry = batch.geometry();
  const material = foliageMaterial();
  const split = stats.backgroundTriangles * 3;
  const part = (start, count) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) g.setAttribute(name, attribute);
    g.setIndex(geometry.index);
    g.setDrawRange(start, count);
    return g;
  };
  const far = new THREE.Mesh(part(0, split), material);
  far.name = "Distant meadow";
  far.receiveShadow = true;
  far.frustumCulled = false;
  const mesh = new THREE.Mesh(part(split, Infinity), material);
  mesh.name = "Aquatic planting";
  mesh.customDepthMaterial = foliageDepth({ animated: animatedShadows });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(far, mesh);
  stats.vertices = geometry.attributes.position.count;
  stats.triangles = geometry.index.count / 3;
  return { mesh, meshes: [far, mesh], thickets: THICKETS, stats };
}

export { THICKETS, rockCenterY };
