import * as THREE from "three";
import { ROCKS } from "./layout.js";
import {
  groundHeight,
  noise,
  randomGenerator,
  smoothstep,
  vec,
} from "./math.js";
import { TAU, stemStrand } from "./foliage.js";

// Broad-leaved rosettes: Echinodorus, the Amazon sword, native to these rivers.
//
// Every leaf is built from its anatomy. A sheathed petiole leaves the rhizome or the crown,
// arches until it carries its blade clear of the leaves below, and the blade is a surface
// swept along its midrib, keeled and lanceolate. Submerged tissue is close to
// neutrally buoyant, so the petiole holds the blade up and out instead of letting it flop
// the way an emersed leaf does, and the stiffness of the tissue shows in how little the
// leaf answers the current: the grass streams, these only nod.

// A generator of its own keeps this planting stable whatever else draws from the scene's
// shared sequence.
const rand = randomGenerator(52711);
const between = (a, b) => a + (b - a) * rand();
const UP = vec(0, 1, 0);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// Nothing may root inside a stone. Each is a rounded sphere cut back by soft planes and
// noise, which leaves its surface never much past 0.95 of its radii.
const ROCK_CLEAR = 0.95;

// How far a point on the sand is from the nearest rock, in units of that rock's footprint:
// above 1 the plant is clear of every rock.
export function rockClearance(x, z) {
  let nearest = Infinity;
  for (const rock of ROCKS) {
    const radius = ROCK_CLEAR * Math.max(rock.rx, rock.rz);
    nearest = Math.min(nearest, Math.hypot(x - rock.x, z - rock.z) / radius);
  }
  return nearest;
}

// ---------------------------------------------------------------------------
// Leaf outlines: half-width as a fraction of the widest point, at ten equal steps from the
// base of the blade to its apex, read back through a Catmull-Rom so the margin stays a
// smooth curve however few rows the blade is built from.
const OUTLINES = {
  // Broad lanceolate running down into its petiole, shouldered, with a short point.
  echinodorus: [0.11, 0.42, 0.7, 0.88, 0.97, 1, 0.95, 0.85, 0.66, 0.38, 0.02],
};

function outlineWidth(table, v) {
  const n = table.length - 1;
  const x = clamp01(v) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const t = x - i;
  const y0 = table[i],
    y1 = table[i + 1];
  const ym = i > 0 ? table[i - 1] : 2 * y0 - y1;
  const yp = i + 2 <= n ? table[i + 2] : 2 * y1 - y0;
  return (
    y0 +
    0.5 *
      t *
      (y1 -
        ym +
        t * (2 * ym - 5 * y0 + 4 * y1 - yp + t * (3 * (y0 - y1) + yp - ym)))
  );
}

// A frame that rolls as little as possible along a curve, so a blade or a stalk built on it
// does not twist except where the plant itself twists.
function sweptFrames(curve, count, normal0, extend = 0) {
  const frames = [];
  const speed = curve.getPoint(0.01).distanceTo(curve.getPoint(0)) * 100;
  const start = curve.getPoint(0);
  const first = curve.getTangent(0);
  const normal = normal0.clone();
  let arc = 0;
  let previous = null;
  for (let k = 0; k <= count; k++) {
    const v = -extend + ((1 + extend) * k) / count;
    const point =
      v >= 0
        ? curve.getPoint(v)
        : start.clone().addScaledVector(first, v * speed);
    const tangent = v >= 0 ? curve.getTangent(v) : first.clone();
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-8) normal.crossVectors(tangent, UP);
    normal.normalize();
    if (previous) arc += point.distanceTo(previous);
    previous = point;
    frames.push({
      v,
      point,
      tangent,
      normal: normal.clone(),
      side: new THREE.Vector3().crossVectors(normal, tangent).normalize(),
      arc,
    });
  }
  const zero = extend ? (extend / (1 + extend)) * count : 0;
  const offset = frames[Math.round(zero)].arc;
  for (const frame of frames) frame.arc -= offset;
  return frames;
}

function frameAt(frames, v) {
  const count = frames.length - 1;
  const first = frames[0].v;
  const span = frames[count].v - first;
  const x = clamp01((v - first) / span) * count;
  const i = Math.min(Math.floor(x), count - 1);
  const t = x - i;
  const a = frames[i],
    b = frames[i + 1];
  return {
    point: a.point.clone().lerp(b.point, t),
    tangent: a.tangent.clone().lerp(b.tangent, t).normalize(),
    normal: a.normal.clone().lerp(b.normal, t).normalize(),
    side: a.side.clone().lerp(b.side, t).normalize(),
    arc: a.arc + (b.arc - a.arc) * t,
  };
}

// ---------------------------------------------------------------------------
// A stalk: petiole, rhizome, crown or root. The cross-section is an ellipse wider than it
// is deep, optionally grooved along its upper face and flared into a sheath at the base,
// which is what a petiole leaving a rhizome or a crown actually looks like.
function stalk(
  batch,
  {
    curve,
    root,
    radius,
    color,
    tipColor = null,
    rows,
    cols = 7,
    flat = 1.2,
    groove = 0,
    sheath = 0,
    taper = 0.2,
    knuckle = null,
    compliance,
    distance0 = 0,
    attached = null,
  },
) {
  const length = curve.getLength();
  const frames = sweptFrames(curve, rows, UP);
  const start = batch.positions.length / 3;
  const tint = new THREE.Color();
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const { point, normal, side } = frames[i];
    const swell = sheath * Math.exp(-((t / 0.19) ** 2));
    // A rhizome is knuckled: it swells at every node it has carried a leaf from.
    const node = knuckle
      ? 1 + knuckle.depth * Math.cos(t * knuckle.count * TAU)
      : 1;
    const scale = radius * (1 - taper * t) * node;
    const rx = scale * (flat + 1.5 * swell);
    const ry = scale * (1 + 0.35 * swell);
    const strand = attached ?? stemStrand(curve, t, length, compliance);
    const carry = { ...strand, distance: distance0 + t * length };
    tint.copy(color);
    if (tipColor) tint.lerp(tipColor, t);
    for (let j = 0; j <= cols; j++) {
      const angle = (j / cols) * TAU;
      const ca = Math.cos(angle),
        sa = Math.sin(angle);
      let depth = ry * sa;
      if (groove && sa > 0)
        depth -= groove * ry * Math.max(0, 1 - (ca / 0.72) ** 2);
      const p = point
        .clone()
        .addScaledVector(side, rx * ca)
        .addScaledVector(normal, depth);
      // uv.x puts the shader's midrib highlight along the top and bottom of the stalk and
      // its edge shading down the flanks; uv.y barely moves, so the venation reads as the
      // faint lengthwise ribbing a petiole has rather than as cross-banding.
      batch.vertex(
        p,
        [0.5 - 0.42 * ca, 0.0064 + t * 0.008],
        tint,
        root,
        carry,
        0,
      );
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  const last = frames[rows];
  return {
    length,
    tip: last.point,
    tangent: last.tangent,
    normal: last.normal,
    strand: {
      ...stemStrand(curve, 1, length, compliance),
      distance: distance0 + length,
    },
  };
}

// Mesh density follows the blade: a young leaf, or one in the midground, does not need the
// rows a foreground leaf needs to hold a smooth margin.
function density(size) {
  return {
    rows: Math.max(12, Math.min(22, Math.round(8 + 14 * size))),
    cols: 2 * Math.max(4, Math.min(7, Math.round(2 + 5 * size))),
  };
}

// ---------------------------------------------------------------------------
// A blade. The midrib is a cubic that leaves the petiole along its tangent and lets the
// apex hang a little; the lamina is the surface swept across it.
//
// The vein pattern comes from the shared material, which draws it at a fixed slope in uv
// space. Giving uv.y a span of one vein period per vein pair therefore lands the veins
// where the species keeps them: a broad leaf gets steep pinnate veins, a narrow one the
// shallow near-parallel veins of a Cryptocoryne or an Echinodorus.
const VEIN_PERIOD = TAU / 155;

function bladeSurface(batch, spec) {
  const {
    base,
    tangent,
    face,
    length,
    width,
    outline,
    root,
    color,
    distance0,
    parent = null,
    compliance = 0.3,
    thin = 0.2,
    rows = 20,
    cols = 12,
    veinPairs = 9,
    arch = 0.06,
    droop = 0.16,
    sweep = 0,
    cordate = null,
    cup = 0.2,
    keel = 0.03,
    twist = 0,
    undulate = 0,
    undulateWaves = 5,
    bullate = 0,
    furl = 0,
    age = 0.5,
    bites = [],
    holes = [],
    spots = [],
    seed = 0,
  } = spec;

  const side0 = new THREE.Vector3().crossVectors(face, tangent).normalize();
  const curve = new THREE.CubicBezierCurve3(
    base.clone(),
    base
      .clone()
      .addScaledVector(tangent, length * 0.34)
      .addScaledVector(face, length * arch),
    base
      .clone()
      .addScaledVector(tangent, length * 0.72)
      .addScaledVector(UP, -length * droop * 0.3)
      .addScaledVector(side0, length * sweep * 0.45),
    base
      .clone()
      .addScaledVector(tangent, length)
      .addScaledVector(UP, -length * droop)
      .addScaledVector(side0, length * sweep),
  );
  const reach = cordate ? cordate.reach : 0;
  const frames = sweptFrames(curve, rows * 3 + 6, face, reach);
  const start = batch.positions.length / 3;

  const brown = new THREE.Color("#5f4c1c");
  const algae = new THREE.Color("#16180d");
  const tint = new THREE.Color();
  const bite = (v, u) => {
    let loss = 0;
    for (const b of bites)
      if (u * b.side > 0)
        loss += b.depth * Math.max(0, 1 - Math.abs(v - b.v) / b.span) ** 0.55;
    return Math.min(0.85, loss);
  };

  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    const half = width * outlineWidth(outline, v);
    const basal = cordate ? clamp01(1 - v / cordate.span) ** 1.45 : 0;
    const roll = furl * smoothstep(0.04, 0.42, v);
    const attach = smoothstep(0, 0.16, v);
    // The margin waves die out where the lamina is held: at the base by the petiole and at
    // the apex by the midrib running into it.
    const wave =
      undulate *
      (Math.sin(v * undulateWaves * TAU + seed * 5.3) +
        0.42 * Math.sin(v * undulateWaves * 1.73 * TAU + seed * 11.1)) *
      Math.sin(Math.PI * v) ** 0.7;
    const pucker = Math.sin(v * veinPairs * Math.PI + 1.1 + seed * 2.1);
    const uvy = 0.02 + v * veinPairs * VEIN_PERIOD;
    for (let j = 0; j <= cols; j++) {
      const u = (2 * j) / cols - 1;
      const edge = half * (1 - bite(v, u));
      const pinch = bullate * width * Math.cos(u * 7.2) * (1 - u ** 4);
      const lobe = Math.abs(u) ** 1.3 * (1 - 0.32 * Math.abs(u) ** 8);
      const frame = frameAt(frames, v - reach * basal * lobe);
      const spin = twist * v;
      const side = frame.side
        .clone()
        .multiplyScalar(Math.cos(spin))
        .addScaledVector(frame.normal, Math.sin(spin));
      const normal = frame.normal
        .clone()
        .multiplyScalar(Math.cos(spin))
        .addScaledVector(frame.side, -Math.sin(spin));
      let across = u * edge;
      let out = 0;
      if (roll > 0.02) {
        // A leaf that has not finished opening is still rolled about its midrib: the
        // lamina keeps its width but wraps it into an arc.
        const k = (roll * Math.PI) / Math.max(edge, 1e-4);
        across = Math.sin(k * across) / k;
        out = (1 - Math.cos(k * u * edge)) / k;
      } else {
        out =
          cup * edge * u * u +
          wave * edge * Math.abs(u) ** 2.2 +
          pucker * pinch;
        if (cordate) out += cordate.lift * edge * u * u * basal;
      }
      // One surface carries both sides of the midrib: a groove above, a raised rib below.
      out -= keel * width * Math.exp(-((u / 0.11) ** 2));
      const p = frame.point
        .clone()
        .addScaledVector(side, across)
        .addScaledVector(normal, out);

      // The blade's base is held by the petiole and answers the current with it; the free
      // lamina bends along its own face. Blending the two over the first sixth of the
      // blade keeps the junction watertight while it moves.
      const direction = parent
        ? parent.direction.clone().lerp(normal, attach)
        : normal.clone();
      if (direction.lengthSq() < 1e-6) direction.copy(normal);
      const strand = {
        direction: direction.normalize(),
        tangent: parent
          ? parent.tangent.clone().lerp(frame.tangent, attach).normalize()
          : frame.tangent,
        distance: distance0 + frame.arc,
        compliance: parent
          ? parent.compliance + (compliance - parent.compliance) * attach
          : compliance,
      };

      tint.copy(color);
      const blotch =
        0.93 + 0.14 * noise(v * 4.3 + seed * 7.1, u * 2.1, seed * 3.7);
      const vein =
        0.5 + 0.5 * Math.cos((uvy - Math.abs(j / cols - 0.5) * 0.32) * 155);
      tint.multiplyScalar(
        blotch *
          (0.84 + 0.16 * smoothstep(0, 0.28, v)) *
          (0.9 + 0.1 * vein ** 5),
      );
      if (age > 0.78)
        tint.lerp(brown, smoothstep(0.66, 1, v) * (age - 0.78) * 1.5);
      for (const spot of spots) {
        const d = Math.hypot((v - spot.v) * length, (u - spot.u) * width * 1.3);
        tint.lerp(algae, 0.6 * Math.max(0, 1 - d / spot.r) ** 0.8);
      }
      batch.vertex(
        p,
        [j / cols, uvy],
        tint,
        root,
        strand,
        thin * (1 + 0.5 * Math.abs(u) ** 3),
      );
      if (i < rows && j < cols) {
        // A snail hole is a pinhole whatever the leaf: one or two faces of the mesh.
        const cv = v + 0.5 / rows,
          cu = u + 1 / cols;
        let open = true;
        for (const hole of holes)
          if (
            Math.hypot((cv - hole.v) * length, (cu - hole.u) * width) <
            (0.9 * width) / cols
          )
            open = false;
        if (open) {
          const k = start + i * (cols + 1) + j;
          batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Wear. Old leaves carry algae along the margins where flow is slowest, snail pinholes and
// torn edges; young ones are clean.
function wear(age, count) {
  const spots = [],
    holes = [],
    bites = [];
  if (age < 0.45) return { spots, holes, bites };
  const load = (age - 0.45) / 0.55;
  for (let i = 0; i < Math.round(load * count * 2.4); i++)
    spots.push({
      v: between(0.15, 0.97),
      u: (rand() < 0.5 ? -1 : 1) * between(0.5, 1.05),
      r: between(0.02, 0.07),
    });
  if (rand() < load * 0.45) {
    const hole = { v: between(0.3, 0.85), u: between(-0.7, 0.7) };
    holes.push(hole);
    spots.push({ ...hole, r: 0.055 });
  }
  if (rand() < load * 0.6)
    bites.push({
      v: between(0.35, 0.78),
      side: rand() < 0.5 ? -1 : 1,
      depth: between(0.08, 0.22),
      span: between(0.06, 0.15),
    });
  return { spots, holes, bites };
}

// A blade can turn about its midrib but not off it. It rolls to the attitude that gives its
// face the most light: from overhead, plus whatever comes across the open water in front of
// the clump, where nothing shades it. A crowded leaf settles wherever there is room instead.
function faceToLight(lamina, upright, open, jitter) {
  const side = new THREE.Vector3().crossVectors(lamina, upright);
  const preferred = UP.clone().multiplyScalar(0.6).addScaledVector(open, 0.9);
  const theta = Math.atan2(preferred.dot(side), preferred.dot(upright));
  return spun(upright, lamina, theta + jitter);
}

// Rotate `v` about a unit axis.
function spun(v, axis, angle) {
  return v.clone().applyAxisAngle(axis, angle);
}

// The roots a rosette shows where it meets the sand: pale, creeping just under the surface
// so only their backs are visible, the way a crown's anchor roots sit in fine gravel.
function crownRoots(batch, { x, z, root, blade: bladeLength, count, groundAt = groundHeight }) {
  for (let k = 0; k < count; k++) {
    const a = between(0, TAU);
    const reach = between(0.3, 0.62) * bladeLength;
    const point = (f, sink) => {
      const px = x + Math.cos(a) * reach * f,
        pz = z + Math.sin(a) * reach * f;
      return vec(px, groundAt(px, pz) - sink * bladeLength, pz);
    };
    stalk(batch, {
      curve: new THREE.CatmullRomCurve3([
        point(0, 0.02),
        point(0.45, 0.035),
        point(0.8, 0.06),
        point(1, 0.14),
      ]),
      root,
      radius: 0.016 * bladeLength,
      rows: 6,
      cols: 5,
      flat: 1.15,
      taper: 0.45,
      color: new THREE.Color().setHSL(0.11, 0.16, 0.2),
      tipColor: new THREE.Color().setHSL(0.1, 0.14, 0.11),
      compliance: 0,
      attached: { direction: UP, tangent: UP, distance: 0, compliance: 0 },
    });
  }
}

// ---------------------------------------------------------------------------
// Echinodorus. A rosette on a short crown at the sand, broad lanceolate blades folded along
// the midrib and carried up and out on ribbed petioles; the youngest leaves stand almost
// upright in the middle, the oldest lie nearly flat around the outside.
export function echinodorus(
  batch,
  { x, z, blade: bladeLength, leaves, hue = 0.26, open = vec(0, 0, 1), groundAt = groundHeight },
) {
  const ground = groundAt(x, z);
  const root = vec(x, ground - 0.04, z);
  const crownTop = vec(x, ground + 0.1 * bladeLength, z);
  stalk(batch, {
    curve: new THREE.CatmullRomCurve3([
      vec(x, ground - 0.16 * bladeLength, z),
      crownTop.clone().lerp(root, 0.45),
      crownTop,
    ]),
    root,
    radius: 0.062 * bladeLength,
    rows: 5,
    cols: 8,
    flat: 1,
    taper: 0.3,
    color: new THREE.Color().setHSL(0.1, 0.28, 0.1),
    tipColor: new THREE.Color().setHSL(0.19, 0.34, 0.09),
    compliance: 0.03,
  });
  crownRoots(batch, { x, z, root, blade: bladeLength, count: 3, groundAt });
  for (let k = 0; k < leaves; k++) {
    const t = (k + 0.5) / leaves;
    const age = 1 - t;
    const angle = k * 2.39996 + between(-0.35, 0.35);
    // Older leaves sit lower on the crown and lean out much further.
    const lift = between(1.32, 1.5) - 0.95 * age * between(0.7, 1.15);
    const flat = vec(Math.cos(angle), 0, Math.sin(angle));
    const outward = flat
      .clone()
      .multiplyScalar(Math.cos(lift))
      .addScaledVector(UP, Math.sin(lift))
      .normalize();
    const young = age < 0.18;
    const size =
      bladeLength * (young ? between(0.45, 0.62) : between(0.8, 1.08));
    const stalkLength = size * between(0.4, 0.68);
    const node = vec(
      x + Math.cos(angle) * 0.06 * bladeLength,
      ground + between(0.02, 0.12) * bladeLength,
      z + Math.sin(angle) * 0.06 * bladeLength,
    );
    const rise = UP.clone()
      .multiplyScalar(2.2)
      .addScaledVector(flat, 0.5)
      .normalize();
    const petiole = stalk(batch, {
      curve: new THREE.CubicBezierCurve3(
        node,
        node.clone().addScaledVector(rise, stalkLength * 0.5),
        node
          .clone()
          .addScaledVector(rise, stalkLength * 0.55)
          .addScaledVector(outward, stalkLength * 0.34),
        node
          .clone()
          .addScaledVector(rise, stalkLength * 0.42)
          .addScaledVector(outward, stalkLength * 0.72),
      ),
      root,
      radius: 0.023 * size,
      rows: 9,
      cols: 7,
      flat: 1.4,
      groove: 0.55,
      sheath: 0.85,
      taper: 0.1,
      color: new THREE.Color().setHSL(
        hue - 0.045,
        between(0.38, 0.52),
        between(0.075, 0.115),
      ),
      compliance: 0.26,
    });
    const hinge = new THREE.Vector3()
      .crossVectors(UP, petiole.tangent)
      .normalize();
    const lamina = spun(
      petiole.tangent,
      hinge,
      0.24 + 0.5 * Math.max(0, petiole.tangent.y),
    );
    const upright = UP.clone()
      .addScaledVector(lamina, -UP.dot(lamina))
      .normalize();
    const face =
      rand() < 0.14
        ? spun(upright, lamina, between(-1.5, 1.5))
        : faceToLight(lamina, upright, open, between(-0.5, 0.5));
    const damage = wear(age * 0.85, 2);
    bladeSurface(batch, {
      base: petiole.tip,
      tangent: lamina,
      face,
      length: size,
      width: size * between(0.15, 0.19),
      outline: OUTLINES.echinodorus,
      root,
      color: new THREE.Color().setHSL(
        hue + between(-0.02, 0.03) - (young ? 0.02 : 0),
        between(0.6, 0.8),
        (young ? between(0.17, 0.23) : between(0.11, 0.19)) * (0.85 + 0.3 * t),
      ),
      distance0: petiole.strand.distance,
      parent: petiole.strand,
      compliance: 0.4,
      thin: 0.32,
      ...density(size * 0.85),
      veinPairs: 6,
      arch: between(0.04, 0.12),
      droop: between(0.12, 0.3),
      sweep: between(-0.15, 0.15),
      cup: between(0.22, 0.42),
      keel: 0.03,
      twist: between(-0.25, 0.25),
      undulate: between(0.05, 0.12),
      undulateWaves: 2,
      bullate: 0.02,
      furl: young && rand() < 0.5 ? between(0.45, 0.8) : 0,
      age,
      seed: rand(),
      ...damage,
    });
  }
}
