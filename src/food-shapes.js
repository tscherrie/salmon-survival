import * as THREE from "three";

// The little animals and morsels in the drift, each modelled a unit long along +x (its head
// at +x, its back up) and painted vertex by vertex: banded bodies, dark backs and pale
// bellies, black eyes, the grains of a caddis case, a snail's striped shell, a fly's
// glassy wings, an earthworm's saddle, the eyes showing in a trout egg. Each vertex also
// says how it moves (`motion`: how far, how fast): a bloodworm lashes, a nymph's abdomen
// and gills beat, a shrimp's legs paddle, a leech undulates, a fly's wings buzz.
//
// Attributes: position, normal, paint (rgb, and how much it replaces the kind's colour),
// shade (a multiplier on the kind's colour), motion (amplitude, frequency).

const v3 =(x, y, z) => new THREE.Vector3(x, y, z);
const hash = (x, y, z) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};
const NONE = [0, 0, 0, 0];
const BLACK = [0.02, 0.02, 0.02, 1];

// A part: its geometry and how to dress each of its vertices, dress(p) -> { paint, shade, amp, freq }.
function part(geometry, dress) {
  return { geometry, dress };
}

function build(parts) {
  const positions = [],
    normals = [],
    paints = [],
    shades = [],
    motions = [],
    indices = [];
  let offset = 0;
  const p = v3(0, 0, 0);
  for (const { geometry, dress } of parts) {
    const pos = geometry.attributes.position,
      nor = geometry.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      positions.push(p.x, p.y, p.z);
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      const d = dress(p) ?? {};
      const paint = d.paint ?? NONE;
      paints.push(paint[0], paint[1], paint[2], paint[3]);
      shades.push(d.shade ?? 1);
      motions.push(d.amp ?? 0, d.freq ?? 0);
    }
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++) indices.push(geometry.index.getX(i) + offset);
    else for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    offset += pos.count;
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("paint", new THREE.Float32BufferAttribute(paints, 4));
  merged.setAttribute("shade", new THREE.Float32BufferAttribute(shades, 1));
  merged.setAttribute("motion", new THREE.Float32BufferAttribute(motions, 2));
  merged.setIndex(indices);
  return merged;
}

const eye = (x, y, z, r = 0.035) => part(new THREE.SphereGeometry(r, 6, 4).translate(x, y, z), () => ({ paint: BLACK }));
const legPair = (xs, y, spread, length, r, dress) => {
  const parts = [];
  for (const z of [-1, 1]) for (const x of xs) parts.push(part(new THREE.CylinderGeometry(r, r * 0.7, length, 3).rotateX(z * 1.15).translate(x, y, z * spread), dress));
  return parts;
};

export function foodGeometry(shape) {
  const parts = [];
  if (shape === "worm") {
    // A bloodworm (a midge larva): red, finely ringed, the head a dark bead; it lashes.
    const curve = new THREE.CatmullRomCurve3([v3(-0.5, 0, 0), v3(-0.2, 0.08, 0.02), v3(0.15, -0.05, -0.02), v3(0.5, 0.03, 0)]);
    parts.push(part(new THREE.TubeGeometry(curve, 20, 0.07, 6, false), (p) => ({ shade: 0.78 + 0.28 * Math.pow(Math.abs(Math.sin(p.x * 42)), 3), paint: p.x > 0.44 ? [0.18, 0.08, 0.05, 0.8] : NONE, amp: 0.05 + 0.14 * Math.abs(p.x), freq: 8 })));
  } else if (shape === "nymph" || shape === "larva") {
    const larva = shape === "larva";
    // A mayfly or stonefly nymph: dark on the back, pale beneath, the abdomen ringed; black
    // eyes, three pale tails, gills beating along the abdomen. A blackfly larva: a pale
    // club, fatter behind, a dark head with its fans.
    const body = new THREE.CapsuleGeometry(larva ? 0.12 : 0.1, 0.55, 4, 10).rotateZ(Math.PI / 2).scale(1, 0.75, 1);
    if (larva) {
      const q = body.attributes.position;
      for (let i = 0; i < q.count; i++) {
        const k = 1 + 0.45 * Math.max(0, -q.getX(i) - 0.05);
        q.setY(i, q.getY(i) * k);
        q.setZ(i, q.getZ(i) * k);
      }
      body.computeVertexNormals();
    }
    parts.push(part(body, (p) => ({ shade: (p.y > 0.015 ? 0.55 : 1.2) * (p.x < 0.1 ? 0.78 + 0.22 * Math.sin(p.x * 52) : 1), amp: p.x < 0 ? -p.x * (larva ? 0.05 : 0.07) : 0, freq: larva ? 3 : 9 })));
    parts.push(part(new THREE.SphereGeometry(0.1, 8, 6).translate(0.42, 0.02, 0), () => ({ shade: 0.55 })));
    parts.push(eye(0.47, 0.06, 0.065), eye(0.47, 0.06, -0.065));
    if (larva) {
      for (const z of [-1, 1]) parts.push(part(new THREE.ConeGeometry(0.06, 0.12, 5).rotateZ(-Math.PI / 2).translate(0.54, 0.04, z * 0.06), () => ({ paint: [0.4, 0.35, 0.25, 0.6], amp: 0.02, freq: 12 })));
    } else {
      for (const z of [-0.06, 0, 0.06]) parts.push(part(new THREE.CylinderGeometry(0.008, 0.012, 0.35, 4).rotateZ(Math.PI / 2 + 0.1).translate(-0.55, 0.02, z * 1.5), (p) => ({ paint: [0.8, 0.74, 0.58, 0.5], amp: 0.03 + (-p.x - 0.4) * 0.1, freq: 9 })));
      for (let x = -0.36; x <= 0.0; x += 0.09)
        for (const z of [-1, 1]) parts.push(part(new THREE.SphereGeometry(0.05, 5, 3).scale(0.9, 0.2, 1).translate(x, 0.03, z * 0.11), () => ({ paint: [0.78, 0.62, 0.46, 0.45], amp: 0.02, freq: 16 })));
    }
    parts.push(...legPair([-0.05, 0.1, 0.25], -0.04, 0.1, 0.2, 0.012, () => ({ shade: 0.6, amp: 0.01, freq: 6 })));
  } else if (shape === "shrimp") {
    // A freshwater shrimp or krill: a curled, glassy body ringed by its segments, a black
    // eye, long feelers; the swimming legs underneath paddle.
    const curve = new THREE.CatmullRomCurve3([v3(-0.5, 0.05, 0), v3(-0.2, 0.14, 0), v3(0.15, 0.12, 0), v3(0.45, 0.0, 0)]);
    parts.push(part(new THREE.TubeGeometry(curve, 22, 0.1, 8, false).scale(1, 1, 0.7), (p) => ({ shade: (0.8 + 0.4 * Math.pow(Math.abs(Math.sin(p.x * 26)), 6)) * (p.y > 0.14 ? 0.85 : 1.1), amp: 0.025 * (0.4 + Math.abs(p.x)), freq: 10 })));
    parts.push(eye(0.38, 0.1, 0.055, 0.04), eye(0.38, 0.1, -0.055, 0.04));
    for (const z of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(0.008, 0.005, 0.5, 3).rotateZ(-0.9).translate(0.62, 0.14, z * 0.04), (p) => ({ shade: 1.15, amp: 0.02 + (p.x - 0.45) * 0.1, freq: 4 })));
    for (let k = 0; k < 6; k++) parts.push(part(new THREE.CylinderGeometry(0.012, 0.008, 0.16, 3).translate(-0.25 + k * 0.1, -0.03, 0), () => ({ shade: 1.1, amp: 0.025, freq: 18 })));
  } else if (shape === "cased") {
    // A caddis larva in its case of sand grains and tiny stones -- each grain its own shade
    // -- its yellow-brown head and legs out in front, feeling about.
    const tube = new THREE.CylinderGeometry(0.13, 0.1, 0.8, 12, 8).rotateZ(Math.PI / 2);
    const q = tube.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const bump = 1 + 0.2 * Math.sin(q.getX(i) * 31 + Math.atan2(q.getZ(i), q.getY(i)) * 5) * Math.sin(q.getX(i) * 13);
      q.setY(i, q.getY(i) * bump);
      q.setZ(i, q.getZ(i) * bump);
    }
    tube.computeVertexNormals();
    const grains = [
      [0.56, 0.5, 0.42],
      [0.33, 0.3, 0.27],
      [0.64, 0.56, 0.4],
      [0.24, 0.21, 0.17],
      [0.48, 0.44, 0.38],
    ];
    parts.push(part(tube.translate(-0.05, 0, 0), (p) => ({ paint: [...grains[Math.floor(hash(Math.floor(p.x * 28), Math.floor(p.y * 28), Math.floor(p.z * 28)) * grains.length)], 0.9] })));
    parts.push(part(new THREE.SphereGeometry(0.075, 8, 6).translate(0.4, 0, 0), (p) => ({ paint: p.y > 0.03 && hash(Math.round(p.x * 60), Math.round(p.z * 60), 1) > 0.6 ? [0.18, 0.12, 0.05, 0.9] : [0.62, 0.46, 0.16, 0.85], amp: 0.015, freq: 5 })));
    parts.push(...legPair([0.3, 0.38], -0.04, 0.06, 0.16, 0.01, () => ({ paint: [0.4, 0.3, 0.12, 0.8], amp: 0.02, freq: 7 })));
  } else if (shape === "snail") {
    // A pond snail: a pointed shell coiled round, banded along the whorls; the pale grey
    // foot beneath, feelers out in front.
    parts.push(part(new THREE.SphereGeometry(0.32, 14, 10).scale(1, 0.85, 0.9), (p) => ({ shade: 0.72 + 0.4 * (Math.sin(p.x * 16 + Math.atan2(p.z, p.y) * 2) > 0.3 ? 1 : 0) })));
    parts.push(part(new THREE.ConeGeometry(0.2, 0.45, 12).rotateZ(Math.PI / 2 + 0.5).translate(-0.3, 0.2, 0), (p) => ({ shade: 0.7 + 0.35 * (Math.sin(p.x * 40 + p.y * 30) > 0 ? 1 : 0) })));
    parts.push(part(new THREE.TorusGeometry(0.2, 0.06, 6, 14).rotateY(Math.PI / 2).translate(0.02, 0.05, 0), () => ({ shade: 1.3 })));
    parts.push(part(new THREE.SphereGeometry(0.2, 10, 6).scale(2, 0.35, 0.8).translate(0.12, -0.26, 0), () => ({ paint: [0.44, 0.42, 0.38, 0.75], amp: 0.008, freq: 2 })));
    for (const z of [-1, 1]) parts.push(part(new THREE.ConeGeometry(0.025, 0.2, 4).rotateZ(-Math.PI / 2 - 0.4).translate(0.5, -0.18, z * 0.07), () => ({ paint: [0.4, 0.38, 0.34, 0.7], amp: 0.015, freq: 3 })));
  } else if (shape === "leech") {
    // A leech: flat, long, tapering at both ends; dark olive above with rows of orange
    // dots, paler beneath; it swims in slow waves.
    const curve = new THREE.CatmullRomCurve3([v3(-0.5, 0, 0), v3(-0.2, 0.04, 0.03), v3(0.15, -0.03, -0.03), v3(0.5, 0.02, 0)]);
    const tube = new THREE.TubeGeometry(curve, 28, 0.09, 8, false);
    const q = tube.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const taper = 0.45 + 0.55 * Math.sin(Math.PI * (q.getX(i) + 0.5));
      q.setY(i, q.getY(i) * 0.45 * taper + q.getY(i) * 0.1);
      q.setZ(i, q.getZ(i) * taper);
    }
    tube.computeVertexNormals();
    parts.push(part(tube, (p) => ({ shade: p.y > 0 ? 0.85 : 1.4, paint: p.y > 0.005 && Math.abs(Math.abs(p.z) - 0.035) < 0.015 && Math.sin(p.x * 70) > 0.2 ? [0.75, 0.42, 0.12, 0.8] : NONE, amp: 0.08, freq: 5 })));
  } else if (shape === "earthworm") {
    // An earthworm washed in: pink, ringed, darker toward the head, with its pale saddle.
    const curve = new THREE.CatmullRomCurve3([v3(-0.5, 0, 0), v3(-0.3, 0.06, 0.05), v3(-0.05, -0.04, -0.04), v3(0.2, 0.05, 0.03), v3(0.5, 0, 0)]);
    const tube = new THREE.TubeGeometry(curve, 48, 0.035, 7, false);
    const q = tube.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const ring = 1 + 0.12 * Math.sin(i * 0.9);
      q.setY(i, q.getY(i) * ring);
    }
    tube.computeVertexNormals();
    parts.push(part(tube, (p) => ({ shade: (p.x > 0.2 ? 0.82 : 1) * (0.9 + 0.12 * Math.sin(p.x * 140)), amp: 0.06 + 0.06 * Math.abs(p.x), freq: 4 })));
    parts.push(part(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 8).rotateZ(Math.PI / 2).translate(0.13, 0, 0), () => ({ paint: [0.92, 0.58, 0.5, 0.6], amp: 0.07, freq: 4 })));
  } else if (shape === "egg") {
    // A trout egg: clear orange, a darker oil drop inside, and -- it is eyed -- the two
    // black eyes of the little fish curled in it.
    parts.push(
      part(new THREE.SphereGeometry(0.5, 16, 12), (p) => {
        const e1 = p.distanceTo(v3(0.28, 0.2, 0.33)),
          e2 = p.distanceTo(v3(0.36, 0.2, 0.2));
        if (Math.min(e1, e2) < 0.1) return { paint: [0.04, 0.03, 0.03, 0.9] };
        const oil = p.distanceTo(v3(-0.2, 0.35, -0.25));
        return { shade: oil < 0.2 ? 0.7 : 1 + 0.2 * Math.max(0, p.y) };
      }),
    );
  } else if (shape === "pellet") {
    // Farm feed: a short round pellet, pressed and flecked.
    const g = new THREE.CylinderGeometry(0.34, 0.36, 0.8, 12, 3).rotateZ(Math.PI / 2);
    parts.push(part(g, (p) => ({ shade: 0.8 + 0.45 * hash(Math.floor(p.x * 20), Math.floor(p.y * 20), Math.floor(p.z * 20)) * (Math.abs(p.x) > 0.38 ? 0.6 : 1) })));
  } else if (shape === "crumb") {
    // A crumb of bread: a soft, torn lump, the crust browner.
    const lump = new THREE.IcosahedronGeometry(0.42, 2);
    const q = lump.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const k = 0.8 + 0.3 * Math.sin(q.getX(i) * 9.1 + q.getY(i) * 5.3) * Math.cos(q.getZ(i) * 7.7);
      q.setXYZ(i, q.getX(i) * k * 1.2, q.getY(i) * k * 0.7, q.getZ(i) * k);
    }
    lump.computeVertexNormals();
    parts.push(part(lump, (p) => ({ shade: p.y > 0.12 ? 0.72 : 1.08 + 0.1 * hash(Math.floor(p.x * 30), Math.floor(p.z * 30), 3), amp: 0.004, freq: 2 })));
  } else if (shape === "fly") {
    // A fly caught in the surface film: dark body, big red-brown eyes, glassy veined
    // wings that buzz as it struggles.
    parts.push(part(new THREE.CapsuleGeometry(0.1, 0.35, 4, 8).rotateZ(Math.PI / 2), (p) => ({ shade: p.x < 0 ? 0.85 + 0.15 * Math.sin(p.x * 60) : 1 })));
    parts.push(part(new THREE.SphereGeometry(0.1, 8, 6).translate(0.3, 0.02, 0), () => ({ shade: 0.8 })));
    for (const z of [-1, 1]) parts.push(part(new THREE.SphereGeometry(0.055, 6, 4).translate(0.36, 0.06, z * 0.065), () => ({ paint: [0.5, 0.13, 0.06, 1] })));
    for (const z of [-1, 1]) parts.push(part(new THREE.SphereGeometry(0.2, 10, 4).scale(1.4, 0.05, 0.5).translate(-0.1, 0.1, z * 0.22), (p) => ({ paint: [0.78, 0.82, 0.86, Math.abs(Math.sin(p.x * 30 + p.z * 20)) > 0.9 ? 0.4 : 0.75], amp: 0.035, freq: 38 })));
    parts.push(...legPair([-0.1, 0.05, 0.2], -0.05, 0.12, 0.28, 0.008, () => ({ shade: 0.6, amp: 0.02, freq: 14 })));
  } else {
    // A beetle or an ant: a glossy dark shell parted down the middle, a narrow neck, the
    // head; legs paddling at the film.
    parts.push(part(new THREE.SphereGeometry(0.28, 12, 8).scale(1.4, 0.6, 1), (p) => ({ shade: Math.abs(p.z) < 0.02 && p.y > 0 ? 0.45 : 1 + 0.5 * Math.max(0, p.y * 3 - 0.2) })));
    parts.push(part(new THREE.SphereGeometry(0.14, 8, 6).scale(1, 0.7, 1).translate(0.36, 0, 0), () => ({ shade: 0.9 })));
    parts.push(part(new THREE.SphereGeometry(0.1, 8, 6).translate(0.5, 0, 0), () => ({ shade: 0.8 })));
    for (const z of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(0.008, 0.006, 0.22, 3).rotateZ(-0.7).rotateX(z * 0.5).translate(0.62, 0.06, z * 0.06), () => ({ shade: 0.7, amp: 0.02, freq: 6 })));
    parts.push(...legPair([-0.15, 0.05, 0.25], -0.05, 0.18, 0.32, 0.012, () => ({ shade: 0.7, amp: 0.025, freq: 12 })));
  }
  return build(parts);
}

// The shader side: the paint and shade laid on the kind's colour, and the motion.
export function dressFoodShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
      attribute vec4 paint;
      attribute float shade;
      attribute vec2 motion;
      uniform float foodTime;
      varying vec4 vPaint;
      varying float vShade;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vPaint = paint;
      vShade = shade;
      {
        float ph = 0.0;
        #ifdef USE_INSTANCING
          ph = dot(instanceMatrix[3].xyz, vec3(1.7, 0.9, 2.3));
        #endif
        float t = foodTime * motion.y + position.x * 6.0 + ph;
        transformed.y += sin(t) * motion.x;
        transformed.z += cos(t * 0.73 + 1.3) * motion.x * 0.6;
      }`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
      varying vec4 vPaint;
      varying float vShade;`,
    )
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb * vShade, vPaint.rgb, vPaint.a);`,
    );
}
