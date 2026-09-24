import * as THREE from "three";
import { bedHeight as groundHeight, randomGenerator, smoothstep } from "./math.js";
import { CENTER, SPRINGS, radial } from "./layout.js";
import {
  SURFACE_Y,
  causticGLSL,
  currentVelocity,
  lightDriftGLSL,
  river,
  waterTime,
} from "./water.js";

// Everything small the water carries, simulated rather than animated, so it answers to
// the same water the fish and the grass do.
//
// Motes: flecks of plant matter and fine silt drifting in the current, visible only where
// the sun's shafts catch them. Sand: grains thrown up where a spring boils through the
// bed, and clouds of silt kicked off the bottom by the ray's wings, a fish's strike or a
// hand stirring low. Bubbles: oxygen pearling off leaves in the sun, gas rising from the
// springs, and the air a pellet drags down with it; they rise at the speed their size
// sets, wobble once they are big enough, and break the surface in a small ring.

const KIND = { mote: 0, sand: 1, bubble: 2 };
const G = 7.5; // sand settling acceleration, scene units per s^2 (after drag)

export function createParticles(scene, { flow = null, ripples = null, plants = null, detail = false } = {}) {
  const random = randomGenerator(81133);
  const range = (a, b) => a + (b - a) * random();
  const MOTES = detail ? 2800 : 1700;
  const SAND = detail ? 900 : 600;
  const BUBBLES = detail ? 320 : 220;
  const COUNT = MOTES + SAND + BUBBLES;
  const positions = new Float32Array(COUNT * 3);
  const sizes = new Float32Array(COUNT);
  const kinds = new Float32Array(COUNT);
  const alphas = new Float32Array(COUNT);
  const seeds = new Float32Array(COUNT);
  const velocity = new Float32Array(COUNT * 3);
  const life = new Float32Array(COUNT); // seconds left; <= 0 means free (sand, bubbles)
  const span = new Float32Array(COUNT);
  const radius = new Float32Array(COUNT);

  // The water round the clearing and out past the viewer's path, wherever it looks.
  const BOX = {
    minX: CENTER.x - 25,
    maxX: CENTER.x + 25,
    minY: 0.1,
    maxY: SURFACE_Y - 0.05,
    minZ: CENTER.z - 25,
    maxZ: CENTER.z + 25,
  };
  const place = (i, upstream = false) => {
    const x = upstream ? BOX.minX + random() * 0.6 : range(BOX.minX, BOX.maxX);
    const z = range(BOX.minZ, BOX.maxZ);
    const floor = groundHeight(x, z) + 0.08;
    positions[i * 3] = x;
    positions[i * 3 + 1] = range(Math.max(BOX.minY, floor), BOX.maxY);
    positions[i * 3 + 2] = z;
  };
  for (let i = 0; i < MOTES; i++) {
    place(i);
    kinds[i] = KIND.mote;
    // Mostly fine silt, the occasional larger fragment catching the light.
    sizes[i] = 0.006 + 0.036 * random() ** 2.6;
    alphas[i] = 0.4 + 0.6 * random();
    seeds[i] = random();
  }
  for (let i = MOTES; i < COUNT; i++) {
    kinds[i] = i < MOTES + SAND ? KIND.sand : KIND.bubble;
    positions[i * 3 + 1] = -100;
    alphas[i] = 0;
    seeds[i] = random();
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const sizeAttribute = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  const alphaAttribute = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("size", sizeAttribute);
  geometry.setAttribute("alpha", alphaAttribute);
  geometry.setAttribute("kind", new THREE.BufferAttribute(kinds, 1));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.lights,
    THREE.UniformsLib.fog,
    { pixelScale: { value: 1000 }, sun: { value: 1 } },
  ]);
  uniforms.waterTime = waterTime;
  uniforms.causticMap = river.causticMap;
  uniforms.causticParams = river.causticParams;
  uniforms.ripples = river.ripples;
  uniforms.canopyMap = river.canopyMap;
  uniforms.canopyShift = river.canopyShift;
  uniforms.canopyParams = river.canopyParams;
  uniforms.waterLevel = river.waterLevel;
  uniforms.waterShape = river.waterShape;
  uniforms.waterStep = river.waterStep;
  const material = new THREE.ShaderMaterial({
    uniforms,
    lights: true,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <fog_pars_vertex>
      uniform float pixelScale;
      uniform float waterTime;
      uniform float sun;
      attribute float size;
      attribute float alpha;
      attribute float kind;
      attribute float seed;
      varying float vKind;
      varying float vAlpha;
      varying vec3 vLight;
      varying float vSize;
      ${lightDriftGLSL}
      ${causticGLSL}
      #if NUM_DIR_LIGHT_SHADOWS > 0
        uniform mat4 directionalShadowMatrix[NUM_DIR_LIGHT_SHADOWS];
        uniform sampler2D directionalShadowMap[NUM_DIR_LIGHT_SHADOWS];
      #endif
      void main() {
        vec3 p = position;
        vKind = kind;
        vAlpha = alpha;
        float lit = 1.0;
        #if NUM_DIR_LIGHT_SHADOWS > 0
          vec4 shadowCoord = directionalShadowMatrix[0] * vec4(p, 1.0);
          shadowCoord.xyz /= shadowCoord.w;
          if (all(greaterThan(shadowCoord.xy, vec2(0.0))) && all(lessThan(shadowCoord.xy, vec2(1.0)))) {
            float occluder = unpackRGBAToDepth(texture2D(directionalShadowMap[0], shadowCoord.xy));
            lit = shadowCoord.z - 0.002 <= occluder ? 1.0 : 0.0;
          }
        #endif
        // A mote tumbles, turning its flat face to the light and away.
        float tumble = kind < 0.5 ? 0.3 + 0.7 * abs(sin(waterTime * (1.1 + seed * 2.5) + seed * 40.0)) : 1.0;
        vLight = waterLight(p) * waterLightDrift(p, waterTime) * (0.06 + 0.94 * lit * sun) * tumble;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float pixels = size * pixelScale / -mvPosition.z;
        vSize = pixels;
        gl_PointSize = max(kind > 1.5 ? 2.0 : 1.2, pixels);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying float vKind;
      varying float vAlpha;
      varying vec3 vLight;
      varying float vSize;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0 || vAlpha <= 0.0) discard;
        vec3 color;
        float alpha;
        // A sprite smaller than its minimum size is dimmed by the difference, so a tiny
        // particle does not get brighter by being drawn bigger.
        float coverage = clamp(vSize * vSize / 4.0, 0.08, 1.0);
        if (vKind > 1.5) {
          // An air bubble: the water around it seen bent through a dark rim, a bright
          // pinpoint facing the light above, and a faint caustic spot below it.
          float rim = smoothstep(0.55, 1.0, r);
          vec2 g = c - vec2(-0.12, 0.2);
          float glint = exp(-dot(g, g) * 70.0);
          float under = exp(-dot(c - vec2(0.05, -0.22), c - vec2(0.05, -0.22)) * 30.0);
          color = mix(vec3(0.5, 0.62, 0.6) * 0.35, vec3(0.02, 0.035, 0.03), rim) * (0.35 + 0.65 * vLight.g)
            + (glint * 5.0 + under * 0.8) * vLight;
          alpha = (0.28 + 0.62 * rim + glint) * vAlpha;
        } else if (vKind > 0.5) {
          // A grain or a puff of silt.
          color = vec3(0.62, 0.55, 0.42) * (0.25 + 1.1 * vLight);
          alpha = (1.0 - smoothstep(0.2, 1.0, r)) * vAlpha;
        } else {
          color = vec3(0.64, 0.66, 0.52) * vLight * 2.2;
          alpha = (1.0 - smoothstep(0.15, 1.0, r)) * vAlpha * 0.75;
        }
        gl_FragColor = vec4(color, alpha * coverage);
        #include <fog_fragment>
      }
    `,
  });
  material.customProgramCacheKey = () => "river-particles-v1";
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = "Drift, silt and bubbles";
  scene.add(points);

  // Where the leaves pearl: lit ribbon-leaf tips in the beds and meadow the viewer sees.
  const pearlSources = [];
  if (plants) {
    const attributes = plants.mesh.geometry.attributes;
    const along = attributes.along,
      thin = attributes.thin,
      position = attributes.position;
    for (let i = 0; i < position.count; i += 37) {
      if (thin.getX(i) < 0.9 || along.getW(i) < 2.5) continue;
      const x = position.getX(i),
        y = position.getY(i),
        z = position.getZ(i);
      if (radial(x, z) > 17 || y < 2.5 || y > 10) continue;
      pearlSources.push(new THREE.Vector3(x, y, z));
    }
  }

  let nextSand = MOTES,
    nextBubble = MOTES + SAND;
  function takeSand() {
    for (let n = 0; n < SAND; n++) {
      const i = MOTES + ((nextSand - MOTES + n) % SAND);
      if (life[i] <= 0) {
        nextSand = MOTES + ((i - MOTES + 1) % SAND);
        return i;
      }
    }
    // All in use: recycle the next one regardless.
    const i = nextSand;
    nextSand = MOTES + ((i - MOTES + 1) % SAND);
    return i;
  }
  function takeBubble() {
    for (let n = 0; n < BUBBLES; n++) {
      const i = MOTES + SAND + ((nextBubble - MOTES - SAND + n) % BUBBLES);
      if (life[i] <= 0) {
        nextBubble = MOTES + SAND + ((i - MOTES - SAND + 1) % BUBBLES);
        return i;
      }
    }
    return -1;
  }

  // A cloud of silt thrown off the bed at p. `strength` 1 is a ray lifting off.
  function puff(p, count = 20, strength = 1, spread = 0.4) {
    for (let n = 0; n < count; n++) {
      const i = takeSand();
      const a = range(0, Math.PI * 2);
      const out = range(0.2, 1) * strength;
      positions[i * 3] = p.x + Math.cos(a) * spread * random();
      positions[i * 3 + 1] = Math.max(p.y, groundHeight(p.x, p.z) + 0.03);
      positions[i * 3 + 2] = p.z + Math.sin(a) * spread * random();
      velocity[i * 3] = Math.cos(a) * out * 1.4;
      velocity[i * 3 + 1] = range(0.4, 1.3) * strength;
      velocity[i * 3 + 2] = Math.sin(a) * out * 1.4;
      span[i] = life[i] = range(2.5, 5.5);
      sizes[i] = range(0.07, 0.2);
      radius[i] = 0; // a cloud, not a grain
      alphas[i] = 0;
    }
  }
  // Single grains thrown up by a spring.
  function grain(p, lift) {
    const i = takeSand();
    const a = range(0, Math.PI * 2),
      d = Math.sqrt(random()) * p.w;
    positions[i * 3] = p.x + Math.cos(a) * d;
    positions[i * 3 + 1] = groundHeight(p.x, p.z) - 0.05;
    positions[i * 3 + 2] = p.z + Math.sin(a) * d;
    velocity[i * 3] = Math.cos(a) * range(0, 0.2);
    velocity[i * 3 + 1] = lift * range(0.6, 1.2);
    velocity[i * 3 + 2] = Math.sin(a) * range(0, 0.2);
    span[i] = life[i] = range(0.9, 2.2);
    sizes[i] = range(0.018, 0.04);
    radius[i] = 1;
    alphas[i] = 0;
  }
  function bubble(p, r, jitter = 0) {
    const i = takeBubble();
    if (i < 0) return;
    positions[i * 3] = p.x + range(-jitter, jitter);
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z + range(-jitter, jitter);
    velocity[i * 3] = velocity[i * 3 + 1] = velocity[i * 3 + 2] = 0;
    radius[i] = r;
    sizes[i] = r * 2;
    span[i] = life[i] = 60;
    alphas[i] = 0;
  }

  const water = new THREE.Vector3();
  const stir = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const springPoints = SPRINGS.map((s) => new THREE.Vector4(s.x, 0, s.z, s.radius * 0.8));
  let pearlClock = 0,
    springClock = 0,
    gasClock = 0;

  function update(dt, time) {
    dt = Math.min(dt, 0.05);
    // Oxygen pearling in the sun: a few bubbles a second across the visible planting.
    const sunlit = uniforms.sun.value;
    pearlClock += dt * 3.2 * sunlit * sunlit;
    while (pearlClock > 1 && pearlSources.length) {
      pearlClock -= 1;
      const source = pearlSources[Math.floor(random() * pearlSources.length)];
      bubble(source, range(0.012, 0.028), 0.03);
    }
    // The springs: grains leap and fall continuously; now and then a string of gas.
    springClock += dt * 60;
    while (springClock > 1) {
      springClock -= 1;
      const s = SPRINGS[Math.floor(random() * SPRINGS.length)];
      grain(springPoints[SPRINGS.indexOf(s)], 0.55 + 0.45 * s.strength);
    }
    gasClock += dt * 0.9;
    while (gasClock > 1) {
      gasClock -= 1;
      const s = springPoints[Math.floor(random() * springPoints.length)];
      probe.set(s.x, groundHeight(s.x, s.z) + 0.05, s.z);
      const string = 1 + Math.floor(random() * 4);
      for (let k = 0; k < string; k++) {
        probe.y -= 0.12;
        bubble(probe, range(0.025, 0.05), s.w * 0.5);
      }
    }

    for (let i = 0; i < COUNT; i++) {
      const o = i * 3;
      const kind = kinds[i];
      probe.set(positions[o], positions[o + 1], positions[o + 2]);
      if (kind === KIND.mote) {
        currentVelocity(probe, time, water);
        const height = probe.y - groundHeight(probe.x, probe.z);
        water.multiplyScalar(0.3 + 0.7 * smoothstep(0, 1.6, height));
        if (flow) water.add(flow.sample(probe, stir));
        // Motes are nearly neutrally buoyant and follow the water within a fraction of a
        // second, with a slow settling and a little turbulent wander of their own.
        const follow = 1 - Math.exp(-dt / (0.25 + seeds[i] * 0.4));
        velocity[o] += (water.x - velocity[o]) * follow;
        velocity[o + 1] += (water.y - 0.012 - velocity[o + 1]) * follow;
        velocity[o + 2] += (water.z - velocity[o + 2]) * follow;
        positions[o] += (velocity[o] + 0.02 * Math.sin(time * 0.7 + seeds[i] * 40)) * dt;
        positions[o + 1] += (velocity[o + 1] + 0.015 * Math.sin(time * 0.9 + seeds[i] * 70)) * dt;
        positions[o + 2] += velocity[o + 2] * dt;
        const floor = groundHeight(positions[o], positions[o + 2]) + 0.04;
        if (positions[o + 1] < floor) positions[o + 1] = floor;
        if (positions[o + 1] > BOX.maxY) positions[o + 1] = BOX.maxY;
        if (
          positions[o] > BOX.maxX ||
          positions[o] < BOX.minX - 1 ||
          positions[o + 2] < BOX.minZ ||
          positions[o + 2] > BOX.maxZ
        ) {
          place(i, positions[o] > BOX.maxX);
          velocity[o] = velocity[o + 1] = velocity[o + 2] = 0;
        }
        continue;
      }
      if (life[i] <= 0) {
        alphas[i] = 0;
        continue;
      }
      life[i] -= dt;
      const age = span[i] - life[i];
      currentVelocity(probe, time, water);
      const height = probe.y - groundHeight(probe.x, probe.z);
      water.multiplyScalar(0.3 + 0.7 * smoothstep(0, 1.6, height));
      if (flow) water.add(flow.sample(probe, stir));
      if (kind === KIND.sand) {
        if (radius[i] > 0) {
          // A grain: thrown up, dragged hard by the water, falling back.
          velocity[o + 1] -= G * 0.35 * dt;
          const drag = 1 - Math.exp(-dt * 3.5);
          velocity[o] += (water.x - velocity[o]) * drag;
          velocity[o + 2] += (water.z - velocity[o + 2]) * drag;
          velocity[o + 1] *= 1 - drag * 0.3;
          alphas[i] = Math.min(1, age * 8) * Math.min(1, life[i] * 3);
        } else {
          // Silt: the burst is spent within a second and the cloud rides the water,
          // spreading and settling as it thins.
          const drag = 1 - Math.exp(-dt * 2.2);
          velocity[o] += (water.x - velocity[o]) * drag;
          velocity[o + 1] += (water.y - 0.06 - velocity[o + 1]) * drag;
          velocity[o + 2] += (water.z - velocity[o + 2]) * drag;
          sizes[i] *= 1 + dt * 0.35;
          alphas[i] = 0.42 * Math.min(1, age * 4) * Math.min(1, life[i] / span[i] * 1.6);
        }
        positions[o] += velocity[o] * dt;
        positions[o + 1] += velocity[o + 1] * dt;
        positions[o + 2] += velocity[o + 2] * dt;
        const floor = groundHeight(positions[o], positions[o + 2]);
        if (positions[o + 1] < floor) {
          positions[o + 1] = floor;
          velocity[o + 1] = 0;
          if (radius[i] > 0) life[i] = Math.min(life[i], 0.15);
        }
        continue;
      }
      // Bubbles: terminal rise speed grows with size up to the point a bubble starts to
      // wobble and zigzag; the water carries them sideways.
      const r = radius[i];
      const rise = Math.min(4.2, 95 * r);
      const wobble = r > 0.03 ? 0.18 : 0.05;
      velocity[o] = water.x + wobble * Math.sin(age * 14 + seeds[i] * 30);
      velocity[o + 1] = rise * Math.min(1, age * 5) + water.y;
      velocity[o + 2] = water.z + wobble * Math.cos(age * 12 + seeds[i] * 20);
      positions[o] += velocity[o] * dt;
      positions[o + 1] += velocity[o + 1] * dt;
      positions[o + 2] += velocity[o + 2] * dt;
      alphas[i] = Math.min(1, age * 6);
      if (positions[o + 1] >= SURFACE_Y - r) {
        // Breaking the film.
        if (ripples && r > 0.022 && random() < 0.35)
          ripples.add(positions[o], positions[o + 2], 0.12 + r * 3);
        life[i] = 0;
        alphas[i] = 0;
      }
    }
    positionAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
    alphaAttribute.needsUpdate = true;
  }

  return {
    update,
    puff,
    bubble,
    uniforms,
    points,
    setPixelScale(value) {
      uniforms.pixelScale.value = value;
    },
  };
}
