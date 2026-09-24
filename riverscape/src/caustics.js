import * as THREE from "three";
import { FLOW_DIRECTION, river, waterTime } from "./water.js";

// The caustic net, computed from the surface itself rather than painted on.
//
// A gently rippled surface acts as a sheet of weak lenses: every patch of it tilts the
// sunlight passing through by an angle proportional to its slope, so a bundle of rays
// that started parallel converges under a trough-shaped patch and spreads under a crest.
// At some depth below, the bundles cross, and the bright folded lines where they cross
// are the net seen dancing on a sandy bed. The same construction every physically based
// caustic renderer uses is done here once a frame for one periodic tile of surface: a fine
// grid over the tile is moved to where its light lands at the focal depth, and each
// triangle's brightness is the area it had at the surface over the area it covers on the
// bed. Where the moved grid folds, triangles overlap and add; where it spreads, they dim.
// On average the light is conserved, so the map averages exactly one.
//
// The surface is a sum of short wave trains whose wave numbers fit the tile a whole number
// of times, so the tile repeats seamlessly, and the whole pattern is carried downstream at
// the speed of the surface water, which is why caustics in a river slide rather than
// simply shimmer.

// Wave numbers, in whole cycles across the tile, and each train's share of the slope. Small
// trains carry as much curvature as big ones, so fine detail survives into the net.
const TRAINS = [
  [2, 1], [1, -2], [3, 1], [-2, 3], [4, -1], [1, 4], [5, 2], [-3, -4],
  [6, -2], [2, 6], [7, 1], [-5, 4], [8, 3], [-3, 8],
];
const TILE = 6;
const SURFACE_DRIFT = 0.8;

function trains() {
  let seed = 0.37;
  const next = () => (seed = (seed * 9301 + 0.49297) % 1);
  return TRAINS.map(([n, m]) => {
    const kx = (2 * Math.PI * n) / TILE;
    const kz = (2 * Math.PI * m) / TILE;
    const k = Math.hypot(kx, kz);
    // Equal curvature per train: amplitude falls as the square of the wave number.
    const amplitude = 0.15 / (k * k);
    // Capillary-gravity waves: short ones travel slower relative to their size, and all of
    // them are slowed here from the free-surface value, because the surface of a spring run
    // is sheltered and glassy rather than wind-roughened.
    const omega = 1.15 * Math.sqrt(k) * (0.8 + 0.4 * next());
    return new THREE.Vector4(kx, kz, amplitude, omega).toArray().concat([next() * Math.PI * 2]);
  });
}
const WAVES = trains();

// The surface's gradient at q (in scene units on the surface plane), shared by the caustic
// pass and the surface itself so the ripples one sees are the ones that make the light.
export const surfaceWavesGLSL = /* glsl */ `
  const int WAVE_COUNT = ${WAVES.length};
  const vec4 WAVES[WAVE_COUNT] = vec4[WAVE_COUNT](
    ${WAVES.map((w) => `vec4(${w.slice(0, 4).map((v) => v.toFixed(6)).join(", ")})`).join(",\n    ")}
  );
  const float WAVE_PHASE[WAVE_COUNT] = float[WAVE_COUNT](
    ${WAVES.map((w) => w[4].toFixed(5)).join(", ")}
  );
  const vec2 SURFACE_FLOW = vec2(${(FLOW_DIRECTION.x * SURFACE_DRIFT).toFixed(5)}, ${(FLOW_DIRECTION.z * SURFACE_DRIFT).toFixed(5)});
  // x, y: slope along x and z; z: height.
  vec3 surfaceWaves(vec2 q, float t, float roughness) {
    vec2 moved = q - SURFACE_FLOW * t;
    vec3 result = vec3(0.0);
    for (int i = 0; i < WAVE_COUNT; i++) {
      vec4 w = WAVES[i];
      float phase = dot(w.xy, moved) - w.w * t + WAVE_PHASE[i];
      float a = w.z * roughness;
      result.xy += a * w.xy * cos(phase);
      result.z += a * sin(phase);
    }
    return result;
  }
`;

export function createCaustics(renderer, { size = 512, grid = 176 } = {}) {
  const target = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
  });
  target.texture.name = "Caustic net";
  river.causticMap.value = target.texture;
  river.causticParams.value.x = TILE;

  // The grid spans the tile and a margin all round: light from just outside the tile can
  // land inside it, and the periodic surface makes that light the tile's own.
  const margin = 0.22;
  const positions = [];
  const indices = [];
  for (let j = 0; j <= grid; j++)
    for (let i = 0; i <= grid; i++) {
      positions.push(
        (-margin + ((1 + 2 * margin) * i) / grid) * TILE,
        (-margin + ((1 + 2 * margin) * j) / grid) * TILE,
        0,
      );
      if (i < grid && j < grid) {
        const a = j * (grid + 1) + i;
        indices.push(a, a + 1, a + grid + 1, a + 1, a + grid + 2, a + grid + 1);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const uniforms = {
    waterTime,
    focalDepth: river.causticParams,
    roughness: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    blending: THREE.AdditiveBlending,
    // Where the moved grid folds over, its triangles face the other way; they carry
    // light all the same.
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    extensions: {},
    vertexShader: /* glsl */ `
      uniform float waterTime;
      uniform vec4 focalDepth;
      uniform float roughness;
      varying vec2 vBefore;
      varying vec2 vAfter;
      ${surfaceWavesGLSL}
      void main() {
        vec2 q = position.xy;
        vec3 wave = surfaceWaves(q, waterTime, roughness);
        // Small-slope refraction: a ray through a patch tilted by the slope s leaves it
        // bent by (1 - 1/n) s, and carries that bend down to the focal depth.
        vec2 landed = q - wave.xy * (1.0 - 1.0 / 1.333) * focalDepth.z;
        vBefore = q;
        vAfter = landed;
        gl_Position = vec4(landed / ${TILE.toFixed(3)} * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vBefore;
      varying vec2 vAfter;
      void main() {
        float before = abs(dFdx(vBefore).x * dFdy(vBefore).y - dFdx(vBefore).y * dFdy(vBefore).x);
        float after = abs(dFdx(vAfter).x * dFdy(vAfter).y - dFdx(vAfter).y * dFdy(vAfter).x);
        float light = before / max(after, 1e-7);
        gl_FragColor = vec4(min(light, 24.0), 0.0, 0.0, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.Camera();
  const clear = new THREE.Color();

  return {
    target,
    tile: TILE,
    uniforms,
    render() {
      const previous = renderer.getRenderTarget();
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      renderer.setClearColor(clear, alpha);
    },
    dispose() {
      target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
