import * as THREE from "three";
import { bedHeight as groundHeight, smoothstep } from "./math.js";
import { ROCKS, SURFACE_Y, rockCenterY } from "./layout.js";

export { SURFACE_Y };

// One clock and one water model for everything the water touches: the current that bends
// the grass, carries the drift and pushes the fish; the light the moving surface focuses
// onto everything beneath it; and the rings that spread from anything that breaks it.
export const waterTime = { value: 0 };

// A river runs one way. The current comes from the left of the view and leaves on the
// right, drifting very slightly toward the viewer where the bed shelves up to the bar.
export const FLOW_DIRECTION = new THREE.Vector3(1, 0, 0.1).normalize();
// Scene units a second at the design flow: a little over two centimetres a second in
// open water, the slow glide of a spring run in which a tetra holds station without
// effort and a pellet stays in reach long enough to be caught.
export const CURRENT_SPEED = 0.38;

// The sun, high and a little behind the run, so the shafts lean toward the viewer and the
// surface glows where it is. SUN_DIRECTION points at the sun in air; LIGHT_DIRECTION is
// the same light after refraction into the water, which is the direction every shadow,
// shaft and caustic below the surface actually follows.
export const SUN_DIRECTION = new THREE.Vector3(-0.34, 1, -0.52).normalize();
const WATER_IOR = 1.333;
export const LIGHT_DIRECTION = (() => {
  const zenith = Math.acos(SUN_DIRECTION.y);
  const refracted = Math.asin(Math.sin(zenith) / WATER_IOR);
  const flat = new THREE.Vector3(SUN_DIRECTION.x, 0, SUN_DIRECTION.z).normalize();
  return flat
    .multiplyScalar(Math.sin(refracted))
    .setY(Math.cos(refracted))
    .normalize();
})();

// The flow's strength, a multiple of the design flow. Pressure waves travel down the run
// so neighbouring strands answer in turn; smaller eddies keep any two from moving in
// lockstep. It never slackens: this is a spring, and it never stops running.
const GUSTS = [
  { amplitude: 0.2, rate: 0.061, kx: 0.045, kz: 0.0 },
  { amplitude: 0.11, rate: 0.17, kx: 0.21, kz: -0.09 },
  { amplitude: 0.05, rate: 0.47, kx: 0.8, kz: 0.45 },
  { amplitude: 0.035, rate: 0.83, kx: 1.3, kz: -0.7 },
];

const number = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const vec3 = (v) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;

export const currentGLSL = /* glsl */ `
  uniform float waterTime;
  const vec3 FLOW_DIRECTION = ${vec3(FLOW_DIRECTION)};
  float currentStrength(vec3 p, float t) {
    return 1.0
      ${GUSTS.map(
        (g) =>
          `+ ${number(g.amplitude)} * sin(t * ${number(g.rate)} - p.x * ${number(g.kx)} + p.z * ${number(g.kz)})`,
      ).join("\n      ")};
  }
`;

// The same field on the CPU: the open-water velocity at p, written into `out`.
export function currentVelocity(p, t, out) {
  let strength = 1;
  for (const { amplitude, rate, kx, kz } of GUSTS)
    strength += amplitude * Math.sin(t * rate - p.x * kx + p.z * kz);
  return out.copy(FLOW_DIRECTION).multiplyScalar(strength * CURRENT_SPEED);
}

// Which way the water is running at p, as a unit vector. In a river that is always
// downstream; the function stays so callers need not know that.
export function flowDirectionAt(p, t, out) {
  currentVelocity(p, t, out);
  return out.lengthSq() > 1e-6 ? out.normalize() : out.copy(FLOW_DIRECTION);
}

export const thicketAt = (thickets, p) =>
  thickets.find(
    (bed) =>
      p.x > bed.minX &&
      p.x < bed.maxX &&
      p.z > bed.minZ &&
      p.z < bed.maxZ &&
      p.y < bed.maxY,
  );

// Slack water behind the big stones: fish hold here, food lingers here.
const LEE = ROCKS.filter((rock) => rock.rx >= 1).map((rock) => ({
  x: rock.x,
  z: rock.z,
  top: rockCenterY(rock) + rock.ry * 0.8,
  length: rock.rx * 3.2,
  width: rock.rz * 1.25,
}));
export function leeShelter(p) {
  let shelter = 0;
  for (const lee of LEE) {
    const dx = p.x - lee.x;
    if (dx < 0) continue;
    const dz = (p.z - lee.z) / lee.width;
    const under = 1 - smoothstep(lee.top - 0.2, lee.top + 1.2, p.y);
    shelter = Math.max(shelter, Math.exp(-dz * dz - dx / lee.length) * under);
  }
  return shelter;
}

// The current anything drifting actually feels: slowed in the boundary layer over the
// sand, again inside the grass, and in the lee of the stones.
export function shelteredVelocity(p, t, out, thickets = []) {
  currentVelocity(p, t, out);
  const height = p.y - groundHeight(p.x, p.z);
  let shelter = 0.3 + 0.7 * smoothstep(0, 1.6, height);
  if (thicketAt(thickets, p)) shelter *= 0.4;
  shelter *= 1 - 0.75 * leeShelter(p);
  return out.multiplyScalar(shelter);
}

// ---------------------------------------------------------------------------------------
// Light through the surface.
//
// The sun's shafts, its caustic net on the bed and the shimmer on every leaf are one
// field: the moving surface focuses the light, and wherever something sits beneath it,
// that thing is lit by the part of the surface straight up the light path from it. The
// focusing pattern is rendered each frame into `causticMap` (see caustics.js) for one
// tile of surface. Rings spreading from a pellet, a bubble or a fingertip bend the
// pattern locally on the way down.
export const RIPPLE_COUNT = 10;
export const STRIDER_SLOTS = 8;
export const RIPPLE_SPEED = 2.2;
export const river = {
  causticMap: { value: null },
  // x: tile size in scene units, y: sun (1 in full sun, lower under cloud),
  // z: focal depth of the caustic map, w: overall caustic contrast.
  causticParams: { value: new THREE.Vector4(7.5, 1, 9, 1) },
  ripples: { value: Array.from({ length: RIPPLE_COUNT }, () => new THREE.Vector4(0, 0, 0, 0)) },
  // The gallery forest over the river: its crowns shade the water in broad moving patches,
  // and the sun comes down in shafts through the gaps between them.
  canopyMap: { value: canopyTexture() },
  // x, y: sway of the crowns; z, w: flutter of the leaves, in texture units.
  canopyShift: { value: new THREE.Vector4() },
  // x: canopy tile in scene units, y: light that gets through the leaves, z: how much of
  // the sky the crowns fill, w: softness of their edges.
  canopyParams: { value: new THREE.Vector4(26, 0.2, 0.43, 0.05) },
  // Water striders on the film: x, z, heading, size (0 for none). Their feet dimple the
  // surface, and each dimple throws a round shadow with a bright rim on the bed.
  striders: { value: Array.from({ length: STRIDER_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  // The height of the water surface near the viewer, for scenes where it is not level: x, z
  // of a reference point, the surface height there, and w unused.
  waterLevel: { value: new THREE.Vector4(0, 0, SURFACE_Y, 0) },
  // x, y: how much the surface falls per unit of x and z; z: the drop of a step (a fall) in
  // it, 0 for none; w: half the width over which the step is eased.
  waterShape: { value: new THREE.Vector4(0, 0, 0, 1) },
  // The step's line: a point on it (x, y as world x, z) and the downstream normal (z, w).
  waterStep: { value: new THREE.Vector4(0, 0, 1, 0) },
};

// Tileable fractal value noise for the crowns, made once.
function canopyTexture(size = 256) {
  const data = new Uint8Array(size * size);
  const lattice = (n, seed) => {
    const values = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < values.length; i++) {
      s = (s * 16807) % 2147483647;
      values[i] = s / 2147483647;
    }
    return values;
  };
  const octaves = [
    { n: 5, w: 0.5, v: lattice(5, 1234) },
    { n: 11, w: 0.28, v: lattice(11, 777) },
    { n: 23, w: 0.15, v: lattice(23, 4242) },
    { n: 47, w: 0.07, v: lattice(47, 99) },
  ];
  const fade = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (const { n, w, v } of octaves) {
        const fx = (x / size) * n,
          fy = (y / size) * n;
        const ix = Math.floor(fx),
          iy = Math.floor(fy);
        const tx = fade(fx - ix),
          ty = fade(fy - iy);
        const at = (i, j) => v[((j % n) + n) % n * n + (((i % n) + n) % n)];
        const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
        const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
        sum += w * (top * (1 - ty) + bottom * ty);
      }
      data[y * size + x] = Math.round(Math.min(1, Math.max(0, sum)) * 255);
    }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// The crowns sway slowly and their leaves flutter; called once a frame.
export function swayCanopy(t) {
  river.canopyShift.value.set(
    0.004 * Math.sin(t * 0.23) + 0.002 * Math.sin(t * 0.61 + 1.3),
    0.003 * Math.cos(t * 0.19 + 0.4),
    0.006 * Math.sin(t * 0.9 + 2.1) + t * 0.0004,
    0.005 * Math.cos(t * 1.1),
  );
}

export const lightDriftGLSL = /* glsl */ `
  // Broad, slow changes are smooth enough to evaluate at vertices and interpolate.
  float waterLightDrift(vec3 p, float t) {
    return 1.0
      + 0.05 * sin(t * 0.145 + p.x * 0.23 + p.z * 0.12)
      + 0.03 * sin(t * 0.073 - p.x * 0.16 + p.z * 0.21 + 1.7);
  }
`;

export const causticGLSL = /* glsl */ `
  uniform sampler2D causticMap;
  uniform vec4 causticParams;
  uniform vec4 ripples[${RIPPLE_COUNT}];
  uniform sampler2D canopyMap;
  uniform vec4 canopyShift;
  uniform vec4 canopyParams;
  uniform vec4 striders[${STRIDER_SLOTS}];
  uniform vec4 waterLevel;
  uniform vec4 waterShape;
  uniform vec4 waterStep;
  const vec3 LIGHT_DIRECTION = ${vec3(LIGHT_DIRECTION)};
  // The height of the water surface above p: level in the aquarium, sloping and stepped in
  // a river that runs downhill.
  float surfaceLevelAt(vec3 p) {
    float y = waterLevel.z + dot(waterShape.xy, p.xz - waterLevel.xy);
    if (waterShape.z > 0.0)
      y -= waterShape.z * smoothstep(-waterShape.w, waterShape.w, dot(p.xz - waterStep.xy, waterStep.zw));
    return y;
  }
  // Where the light reaching p came through the surface.
  vec2 surfacePoint(vec3 p) {
    return p.xz + LIGHT_DIRECTION.xz / LIGHT_DIRECTION.y * max(surfaceLevelAt(p) - p.y, 0.0);
  }
  // Rings on the surface: each one a short wave train spreading from its centre and
  // dying away. They bend the light (the offset) and focus it in a travelling ring.
  vec3 rippleField(vec2 q) {
    vec3 field = vec3(0.0);
    for (int i = 0; i < ${RIPPLE_COUNT}; i++) {
      vec4 r = ripples[i];
      if (r.w <= 0.0) continue;
      vec2 d = q - r.xy;
      float dist = length(d);
      float x = dist - r.z * ${RIPPLE_SPEED.toFixed(2)};
      float envelope = r.w * exp(-x * x * 1.6) * (x < 0.0 ? 1.0 : exp(-x * 4.0)) / (1.0 + dist * 0.45);
      float wave = sin(x * 9.0);
      field.xy += d / max(dist, 1e-3) * envelope * cos(x * 9.0) * 0.12;
      field.z += envelope * wave;
    }
    return field;
  }
  // A strider's six feet, each pressing a dimple into the film: the dimple is a small
  // diverging lens, so under it on the bed is a round shadow ringed with the light it
  // turned aside. The shadows spread with depth.
  float striderShade(vec2 q, float depth) {
    float shade = 1.0;
    float radius = 0.055 + depth * 0.005;
    for (int i = 0; i < ${STRIDER_SLOTS}; i++) {
      vec4 s = striders[i];
      if (s.w <= 0.0) continue;
      vec2 d = q - s.xy;
      if (dot(d, d) > 0.36 * s.w * s.w + 0.1) continue;
      float c = cos(s.z), sn = sin(s.z);
      vec2 local = vec2(d.x * c + d.y * sn, -d.x * sn + d.y * c) / s.w;
      vec2 feet[6];
      feet[0] = vec2(0.18, 0.08); feet[1] = vec2(0.18, -0.08);
      feet[2] = vec2(-0.1, 0.42); feet[3] = vec2(-0.1, -0.42);
      feet[4] = vec2(-0.36, 0.26); feet[5] = vec2(-0.36, -0.26);
      for (int k = 0; k < 6; k++) {
        float r = length(local - feet[k]) * s.w / radius;
        shade *= mix(0.12, 1.0, smoothstep(0.75, 1.0, r)) + 0.9 * exp(-pow((r - 1.08) / 0.1, 2.0));
      }
    }
    return shade;
  }
  // Focusing factor at p: 1 on average, bright along the caustic net, softer where p is
  // far from the depth the net comes into focus, and flat under cloud.
  float causticLight(vec3 p) {
    float depth = max(surfaceLevelAt(p) - p.y, 0.0);
    vec3 ring = rippleField(surfacePoint(p));
    vec2 uv = (surfacePoint(p) + ring.xy) / causticParams.x;
    float blur = abs(depth - causticParams.z) * 0.22 + 0.4;
    float net = textureLod(causticMap, uv, blur).r;
    float formed = smoothstep(0.3, 4.5, depth) * causticParams.y * causticParams.w;
    float dimples = striderShade(surfacePoint(p), depth);
    return max(0.0, mix(1.0, net, formed) * (1.0 + ring.z * 1.5 * formed)) * mix(1.0, dimples, causticParams.y);
  }
  // How open the forest canopy is above the surface point q: 1 in a gap, 0 under a
  // crown. The shade's edge is soft and grows softer with depth, as a penumbra does.
  float canopyOpen(vec2 q, float depth) {
    vec2 uv = q / canopyParams.x;
    float blur = 0.6 + depth * 0.1;
    float crowns = textureLod(canopyMap, uv + canopyShift.xy, blur).r * 0.72
      + textureLod(canopyMap, uv * 2.7 + canopyShift.zw, blur + 0.8).r * 0.28;
    return 1.0 - smoothstep(canopyParams.z - canopyParams.w, canopyParams.z + canopyParams.w, crowns);
  }
  // What reaches p of the sun: through the canopy, focused by the surface, and with its
  // red taken out on the way down. Under a crown the light is the leaves' diffuse glow,
  // and the net is gone.
  vec3 waterLight(vec3 p) {
    float depth = max(surfaceLevelAt(p) - p.y, 0.0);
    float open = canopyOpen(surfacePoint(p), depth);
    vec3 absorption = exp(-vec3(0.030, 0.0085, 0.013) * depth / LIGHT_DIRECTION.y);
    float light = mix(canopyParams.y, 1.0, open) * mix(1.0, causticLight(p), open);
    return light * absorption;
  }
`;

// Wraps a Three.js lit material so every direct light arrives through the water model.
// `perLight` may add GLSL that runs once per light with `lit` (the shadowed, water-modulated
// light), `geometryNormal`, `material` and `reflectedLight` in scope.
export function waterLitShader(shader, { perLight = "" } = {}) {
  if (shader.fragmentShader.includes("RE_Direct_Water")) return shader;
  shader.uniforms.waterTime = waterTime;
  // A separate vertex uniform name avoids redeclaring the foliage's current clock.
  shader.uniforms.waterLightTime = waterTime;
  shader.uniforms.causticMap = river.causticMap;
  shader.uniforms.causticParams = river.causticParams;
  shader.uniforms.striders = river.striders;
  shader.uniforms.ripples = river.ripples;
  shader.uniforms.canopyMap = river.canopyMap;
  shader.uniforms.canopyShift = river.canopyShift;
  shader.uniforms.canopyParams = river.canopyParams;
  shader.uniforms.waterLevel = river.waterLevel;
  shader.uniforms.waterShape = river.waterShape;
  shader.uniforms.waterStep = river.waterStep;
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      /* glsl */ `
      #include <common>
      uniform float waterLightTime;
      varying vec3 vWaterPosition;
      varying float vWaterDrift;
      ${lightDriftGLSL}
    `,
    )
    .replace(
      "#include <worldpos_vertex>",
      /* glsl */ `
      #include <worldpos_vertex>
      vec4 waterWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        waterWorld = instanceMatrix * waterWorld;
      #endif
      vWaterPosition = (modelMatrix * waterWorld).xyz;
      vWaterDrift = waterLightDrift(vWaterPosition, waterLightTime);
    `,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      /* glsl */ `
      #include <common>
      uniform float waterTime;
      varying vec3 vWaterPosition;
      varying float vWaterDrift;
      vec3 gWaterLight = vec3(1.0);
      ${causticGLSL}
    `,
    )
    .replace(
      "#include <lights_physical_pars_fragment>",
      /* glsl */ `
      #include <lights_physical_pars_fragment>
      #undef RE_Direct
      void RE_Direct_Water(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
        IncidentLight lit = directLight;
        lit.color *= gWaterLight;
        RE_Direct_Physical(lit, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
        ${perLight}
      }
      #define RE_Direct RE_Direct_Water
    `,
    )
    .replace(
      "#include <lights_fragment_begin>",
      /* glsl */ `
      gWaterLight = waterLight(vWaterPosition) * vWaterDrift;
      #include <lights_fragment_begin>
    `,
    );
  return shader;
}
