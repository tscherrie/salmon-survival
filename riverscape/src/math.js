import * as THREE from "three";

import { randomGenerator } from "../../shared/random.js";
export { randomGenerator };

export const random = randomGenerator(34191);
export const range = (a, b) => a + (b - a) * random();
export const vec = (x, y, z) => new THREE.Vector3(x, y, z);

function hash(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

export function noise(x, y, z) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  let fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  fx *= fx * (3 - 2 * fx);
  fy *= fy * (3 - 2 * fy);
  fz *= fz * (3 - 2 * fz);
  const mix = THREE.MathUtils.lerp;
  return mix(
    mix(
      mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx),
      mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx),
      fy,
    ),
    mix(
      mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx),
      mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx),
      fy,
    ),
    fz,
  );
}

// The shape of the bed lives with the rest of the layout.
export { bedHeight, channel, groundHeight } from "./layout.js";

export const smoothstep = (edge0, edge1, x) => {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Foliage vertices carry how they answer the current: `direction` is the way the strand
// can bend (a blade bends across its face, a stem across its axis), `tangent` runs along
// the strand, `distance` is how far along it the vertex sits, and `compliance` is how
// readily the strand yields. `thin` is how much light the tissue lets through.
export class GeometryBatch {
  constructor() {
    this.positions = [];
    this.uvs = [];
    this.colors = [];
    this.indices = [];
    this.anchors = [];
    this.bend = [];
    this.along = [];
    this.thin = [];
  }
  vertex(p, uv, color, anchor, strand, thin = 0) {
    const i = this.positions.length / 3;
    this.positions.push(p.x, p.y, p.z);
    this.uvs.push(...uv);
    this.colors.push(color.r, color.g, color.b);
    this.anchors.push(anchor.x, anchor.y, anchor.z);
    const { direction, tangent, distance, compliance } = strand;
    this.bend.push(direction.x, direction.y, direction.z, compliance);
    this.along.push(tangent.x, tangent.y, tangent.z, distance);
    this.thin.push(thin);
    return i;
  }
  quad(a, b, c, d) {
    this.indices.push(a, c, b, b, c, d);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute("anchor", new THREE.Float32BufferAttribute(this.anchors, 3));
    g.setAttribute("bend", new THREE.Float32BufferAttribute(this.bend, 4));
    g.setAttribute("along", new THREE.Float32BufferAttribute(this.along, 4));
    g.setAttribute("thin", new THREE.Float32BufferAttribute(this.thin, 1));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    return g;
  }
}
