import * as THREE from "three";
import { bedHeight as groundHeight, channel, randomGenerator } from "./math.js";
import { RAY_BOUNDS, ROCKS } from "./layout.js";
import { waterLitShader } from "./water.js";

// An ocellated river stingray, Potamotrygon motoro, a freshwater ray of the Paraná and
// Paraguay basins: a round brown disc a quarter of a metre across, peppered with orange
// eye-spots ringed in black, and a whip of a tail.
//
// A ray does not swim with its tail. It rows the water with the margins of its disc: a
// wave runs round each side from the snout to the rear, small at rest and deep when it
// hurries, and the body glides flat above the sand on it. It spends long stretches
// lying still, and before it settles it flaps its disc once or twice to throw sand over
// its back, so a resting ray is a faint round shape with its eyes showing. Its wings
// stir the water enough to part the lawn it passes over and lift a haze of silt behind
// it; a hand that comes at it fast sends it off in a burst and a cloud of sand.

const RADIUS = 1.9;
const TAIL = 3.7;
const HEIGHT = 0.15 * RADIUS;
const TAU = Math.PI * 2;

// The disc's outline: nearly round, a little blunt at the snout, with the pelvic fins
// showing as lobes either side of the tail.
function outline(theta) {
  const back = Math.abs(theta);
  return (
    RADIUS *
    (1 + 0.04 * Math.cos(2 * theta) - 0.035 * Math.cos(theta) +
      0.11 * Math.exp(-(((back - 2.72) / 0.13) ** 2)))
  );
}
const outlineGLSL = /* glsl */ `
  float rayOutline(float theta) {
    float back = abs(theta);
    return ${RADIUS.toFixed(3)} * (1.0 + 0.04 * cos(2.0 * theta) - 0.035 * cos(theta)
      + 0.11 * exp(-pow((back - 2.72) / 0.13, 2.0)));
  }
`;

function rayGeometry() {
  const positions = [],
    parts = [],
    indices = [];
  const RINGS = 26,
    SEGMENTS = 112;
  const push = (x, y, z, part) => {
    positions.push(x, y, z);
    parts.push(part);
    return positions.length / 3 - 1;
  };
  const eye = (x, z) =>
    0.16 * HEIGHT * (Math.exp(-(((x - 0.44 * RADIUS) ** 2 + (Math.abs(z) - 0.19 * RADIUS) ** 2) / 0.012)));
  for (const [part, sign] of [
    [0, 1],
    [1, -1],
  ]) {
    const center = push(0, sign > 0 ? HEIGHT * 1.5 * 1.1 : -0.3 * HEIGHT, 0, part);
    const first = positions.length / 3;
    for (let i = 1; i <= RINGS; i++) {
      const r = Math.pow(i / RINGS, 0.62);
      for (let j = 0; j < SEGMENTS; j++) {
        const theta = (j / SEGMENTS) * TAU - Math.PI;
        const R = outline(theta);
        const x = Math.cos(theta) * R * r,
          z = Math.sin(theta) * R * r;
        const bulk = 1 + 0.22 * Math.cos(theta);
        // Flat wings round a low central body: the disc is thin over most of its width
        // and rises only where the body cavity and the head are.
        const body = Math.exp(-((x / (0.62 * RADIUS)) ** 2 + (z / (0.42 * RADIUS)) ** 2) * 1.6);
        const y =
          sign > 0
            ? HEIGHT * (0.35 * Math.pow(Math.max(0, 1 - r * r), 1.4) + 1.15 * body) * bulk + eye(x, z)
            : -0.3 * HEIGHT * Math.pow(Math.max(0, 1 - r * r), 1.1);
        push(x, y, z, part);
      }
    }
    for (let j = 0; j < SEGMENTS; j++) {
      const a = first + j,
        b = first + ((j + 1) % SEGMENTS);
      if (sign > 0) indices.push(center, b, a);
      else indices.push(center, a, b);
    }
    for (let i = 0; i < RINGS - 1; i++)
      for (let j = 0; j < SEGMENTS; j++) {
        const a = first + i * SEGMENTS + j,
          b = first + i * SEGMENTS + ((j + 1) % SEGMENTS),
          c = a + SEGMENTS,
          d = b + SEGMENTS;
        if (sign > 0) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
  }
  // The tail: a tapering, slightly flattened whip from inside the rear of the disc.
  const ALONG = 30,
    AROUND = 8;
  const tailStart = positions.length / 3;
  for (let i = 0; i <= ALONG; i++) {
    const u = i / ALONG;
    const x = -0.82 * RADIUS - u * TAIL;
    const radius = 0.11 * RADIUS * Math.pow(1 - u, 1.2) + 0.008;
    for (let j = 0; j < AROUND; j++) {
      const a = (j / AROUND) * TAU;
      push(x, 0.1 * HEIGHT * (1 - u) + Math.sin(a) * radius * 0.75, Math.cos(a) * radius, 2 + u);
      if (i < ALONG) {
        const k = tailStart + i * AROUND + j,
          next = tailStart + i * AROUND + ((j + 1) % AROUND);
        indices.push(k, next, k + AROUND, next, next + AROUND, k + AROUND);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("rayPart", new THREE.Float32BufferAttribute(parts, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// The rowing wave, the settling flap and the tail's sway, all as a displacement of the
// rest shape so the normal can be taken from the same function.
const deformGLSL = /* glsl */ `
  uniform float rayPhase;
  uniform float rayAmplitude;
  uniform float rayFlap;
  uniform float raySway;
  attribute float rayPart;
  ${outlineGLSL}
  float rayLift(vec3 p) {
    float theta = atan(p.z, p.x);
    float r = clamp(length(p.xz) / rayOutline(theta), 0.0, 1.0);
    float s = abs(theta) / 3.14159265;
    float margin = pow(r, 2.3);
    float wave = sin(rayPhase - s * 6.9);
    return margin * ${RADIUS.toFixed(3)} * (rayAmplitude * (0.45 + 0.55 * s) * wave + rayFlap * 0.32);
  }
  vec3 rayDeform(vec3 p) {
    if (rayPart < 1.5) {
      p.y += rayLift(p);
    } else {
      float u = rayPart - 2.0;
      p.z += raySway * sin(rayPhase * 0.5 - u * 3.2) * u * u * ${(TAIL * 0.14).toFixed(3)};
      p.y += 0.05 * sin(rayPhase * 0.5 - u * 2.4) * u * u;
    }
    return p;
  }
`;

function deformShader(shader, uniforms, withNormal) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace(
    "#include <common>",
    `#include <common>\n${deformGLSL}\nvarying vec3 vRayLocal;\nvarying float vRayPart;`,
  );
  if (withNormal)
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      /* glsl */ `
      vec3 objectNormal = vec3(normal);
      if (rayPart < 1.5) {
        float e = 0.04;
        float h0 = rayLift(position);
        float dx = (rayLift(position + vec3(e, 0.0, 0.0)) - h0) / e;
        float dz = (rayLift(position + vec3(0.0, 0.0, e)) - h0) / e;
        objectNormal = normalize(objectNormal - objectNormal.y * vec3(dx, 0.0, dz));
      }
    `,
    );
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `vec3 transformed = rayDeform(position);\nvRayLocal = position;\nvRayPart = rayPart;`,
  );
}

function rayMaterial(uniforms) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    deformShader(shader, uniforms, true);
    waterLitShader(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float rayBuried;
        varying vec3 vRayLocal;
        varying float vRayPart;
        vec2 rayHash(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453);
        }
        float rayNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rayHash(i).x, rayHash(i + vec2(1, 0)).x, f.x), mix(rayHash(i + vec2(0, 1)).x, rayHash(i + vec2(1, 1)).x, f.x), f.y);
        }`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        vec2 q = vRayLocal.xz / ${RADIUS.toFixed(3)};
        vec3 colour;
        if (vRayPart < 0.5) {
          // Dorsal: warm grey-brown, mottled, with orange ocelli ringed in black -- larger
          // toward the margin, crowded and small toward the midline.
          float mottle = rayNoise(q * 7.0) * 0.6 + rayNoise(q * 19.0) * 0.4;
          colour = mix(vec3(0.1, 0.058, 0.026), vec3(0.2, 0.12, 0.055), mottle);
          vec2 cell = q * 5.2 + (vec2(rayNoise(q * 6.0), rayNoise(q * 6.0 + 9.0)) - 0.5) * 0.5;
          vec2 id = floor(cell);
          float best = 9.0;
          float tone = 0.0;
          for (int y = -1; y <= 1; y++)
            for (int x = -1; x <= 1; x++) {
              vec2 n = id + vec2(float(x), float(y));
              vec2 h = rayHash(n);
              vec2 centre = n + 0.2 + 0.6 * h;
              float size = 0.13 + 0.12 * h.y + 0.1 * length(centre / 5.2);
              float d = length(cell - centre) / size;
              if (d < best) { best = d; tone = h.x; }
            }
          // Ocellus: an orange eye-spot, paler at its heart, in a black ring.
          float spot = 1.0 - smoothstep(0.58, 0.66, best);
          float ring = smoothstep(0.54, 0.64, best) * (1.0 - smoothstep(0.98, 1.1, best));
          vec3 ocellus = mix(vec3(0.78, 0.26, 0.03), vec3(0.9, 0.46, 0.07), tone);
          ocellus = mix(ocellus, ocellus * 1.25 + 0.03, 1.0 - smoothstep(0.0, 0.4, best));
          colour = mix(colour, ocellus, spot);
          colour = mix(colour, vec3(0.008, 0.006, 0.004), ring * 0.95);
          // Eyes and the spiracles behind them.
          float eye = exp(-(pow(q.x - 0.44, 2.0) + pow(abs(q.y) - 0.19, 2.0)) / 0.0018);
          colour = mix(colour, vec3(0.02, 0.018, 0.012), eye);
          float spiracle = exp(-(pow(q.x - 0.3, 2.0) + pow(abs(q.y) - 0.2, 2.0)) / 0.0012);
          colour = mix(colour, vec3(0.03, 0.022, 0.015), spiracle * 0.8);
          // Sand thrown over the back while it rests.
          float sand = smoothstep(0.45, 0.8, rayNoise(q * 11.0 + 3.1) * 0.75 + length(q) * 0.45);
          colour = mix(colour, vec3(0.3, 0.27, 0.19), min(rayBuried, 0.6) * sand * (1.0 - eye));
        } else if (vRayPart < 1.5) {
          colour = vec3(0.72, 0.66, 0.58);
        } else {
          float u = vRayPart - 2.0;
          float band = step(0.5, fract(u * 9.0));
          colour = mix(vec3(0.11, 0.085, 0.06), vec3(0.035, 0.028, 0.02), band * 0.7);
          colour = mix(colour, vec3(0.5, 0.45, 0.38), smoothstep(-0.02, -0.06, vRayLocal.y - 0.03 * (1.0 - u)));
        }
        diffuseColor.rgb = colour;`,
      );
  };
  material.customProgramCacheKey = () => "river-ray-v1";
  return material;
}

export function createRay(scene, { flow = null, particles = null, food = null } = {}) {
  const random = randomGenerator(41277);
  const range = (a, b) => a + (b - a) * random();
  const uniforms = {
    rayPhase: { value: 0 },
    rayAmplitude: { value: 0.03 },
    rayFlap: { value: 0 },
    raySway: { value: 0.3 },
    rayBuried: { value: 0 },
  };
  const geometry = rayGeometry();
  const material = rayMaterial(uniforms);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Ocellated river stingray";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => deformShader(shader, uniforms, false);
  depth.customProgramCacheKey = () => "river-ray-depth-v1";
  mesh.customDepthMaterial = depth;
  scene.add(mesh);

  const B = RAY_BOUNDS;
  const ray = {
    position: new THREE.Vector3(1 + range(-1.5, 1.5), 0, range(0.5, 4)),
    velocity: new THREE.Vector3(),
    yaw: range(0, TAU),
    yawRate: 0,
    speed: 0,
    height: 0.2,
    mode: "rest",
    until: range(6, 14),
    goal: new THREE.Vector3(),
    buried: 0.25,
    flap: 0,
    phase: 0,
    trail: 0,
  };
  const creature = { position: ray.position, velocity: ray.velocity, radius: RADIUS };
  let clock = 0;
  const normal = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const side = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const push = new THREE.Vector3();
  const rim = new THREE.Vector3();

  const bedNormal = (x, z, out) => {
    const e = 0.6;
    const dx = (groundHeight(x + e, z) - groundHeight(x - e, z)) / (2 * e);
    const dz = (groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  };
  // Somewhere else on the sand, usually out on the swept corridor where the bed is open
  // and the cobbles are few.
  function pickGoal() {
    const open = random() < 0.7;
    for (let attempt = 0; attempt < 40; attempt++) {
      ray.goal.set(range(B.minX, B.maxX), 0, range(B.minZ, B.maxZ));
      if (ray.goal.distanceTo(ray.position) < 6) continue;
      if (open && attempt < 30 && channel(ray.goal.x, ray.goal.z) < 0.5) continue;
      if (ROCKS.every((r) => Math.hypot(ray.goal.x - r.x, ray.goal.z - r.z) > Math.max(r.rx, r.rz) + RADIUS + 0.5)) return;
    }
  }
  // Flapping the disc throws sand up all round its rim.
  function kickSand(strength) {
    if (!particles) return;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + range(-0.3, 0.3);
      rim.set(ray.position.x + Math.cos(a) * RADIUS, 0, ray.position.z + Math.sin(a) * RADIUS);
      rim.y = groundHeight(rim.x, rim.z) + 0.05;
      particles.puff(rim, Math.round(3 + 4 * strength), 0.4 + 0.5 * strength, 0.5);
    }
  }
  function depart(fast = false) {
    ray.mode = fast ? "flee" : "glide";
    ray.until = clock + (fast ? range(1.4, 2.2) : range(12, 26));
    ray.flap = 1;
    kickSand(fast ? 1 : 0.5);
    ray.buried = 0;
    pickGoal();
  }
  function settle() {
    ray.mode = "rest";
    ray.until = clock + range(14, 34);
    ray.flap = 0.8;
    kickSand(0.6);
  }

  function update(dt, time, pointer) {
    clock += dt;
    const p = ray.position;
    // A hand coming at it fast, or a big splash of silt from a fish on the sand.
    if (pointer && ray.mode !== "flee") {
      delta.subVectors(pointer.position, p);
      delta.y *= 0.5;
      const d = delta.length();
      const looming = d > 1e-3 ? -pointer.velocity.dot(delta) / (d * Math.max(d, 1)) : 0;
      if (d < 7 && looming > 0.6) {
        depart(true);
        ray.goal.copy(p).addScaledVector(delta.normalize(), -9);
        ray.goal.x = THREE.MathUtils.clamp(ray.goal.x, B.minX, B.maxX);
        ray.goal.z = THREE.MathUtils.clamp(ray.goal.z, B.minZ, B.maxZ);
      }
    }
    // Something to eat lying on the sand nearby.
    if (food && ray.mode === "glide")
      for (const pellet of food.pellets) {
        if (pellet.gone || !food.settled(pellet)) continue;
        if (Math.hypot(pellet.position.x - p.x, pellet.position.z - p.z) < 4) {
          ray.goal.set(pellet.position.x, 0, pellet.position.z);
          if (Math.hypot(pellet.position.x - p.x, pellet.position.z - p.z) < 0.6) food.take(pellet);
          break;
        }
      }
    if (clock >= ray.until) {
      if (ray.mode === "rest") depart(false);
      else if (ray.mode === "flee") {
        ray.mode = "glide";
        ray.until = clock + range(6, 12);
        pickGoal();
      } else if (random() < 0.6) settle();
      else {
        ray.until = clock + range(8, 18);
        pickGoal();
      }
    }

    // Steering over the sand, around the stones.
    let target = 0;
    if (ray.mode === "glide" || ray.mode === "flee") {
      delta.set(ray.goal.x - p.x, 0, ray.goal.z - p.z);
      const remaining = delta.length();
      if (remaining < 1.2 && ray.mode === "glide") {
        if (random() < 0.5) settle();
        else pickGoal();
      }
      for (const r of ROCKS) {
        push.set(p.x - r.x, 0, p.z - r.z);
        const gap = push.length() - Math.max(r.rx, r.rz) - RADIUS * 0.9;
        if (gap < 1.5) delta.addScaledVector(push.normalize(), (1.5 - gap) * 3);
      }
      if (p.x < B.minX) delta.x += (B.minX - p.x) * 2;
      if (p.x > B.maxX) delta.x -= (p.x - B.maxX) * 2;
      if (p.z < B.minZ) delta.z += (B.minZ - p.z) * 2;
      if (p.z > B.maxZ) delta.z -= (p.z - B.maxZ) * 2;
      const wantYaw = Math.atan2(delta.z, delta.x);
      const error = Math.atan2(Math.sin(wantYaw - ray.yaw), Math.cos(wantYaw - ray.yaw));
      const turn = ray.mode === "flee" ? 2.2 : 0.55;
      ray.yawRate = THREE.MathUtils.lerp(ray.yawRate, THREE.MathUtils.clamp(error * 1.2, -turn, turn), 1 - Math.exp(-dt * 2));
      target = ray.mode === "flee" ? 3.6 : 0.75 * Math.min(1, 0.4 + remaining / 4);
    } else ray.yawRate *= Math.exp(-dt * 3);
    ray.yaw += ray.yawRate * dt;
    ray.speed = THREE.MathUtils.lerp(ray.speed, target, 1 - Math.exp(-dt * (ray.mode === "flee" ? 3 : 0.8)));
    forward.set(Math.cos(ray.yaw), 0, Math.sin(ray.yaw));
    ray.velocity.copy(forward).multiplyScalar(ray.speed);
    p.addScaledVector(ray.velocity, dt);
    const lift = ray.mode === "rest" ? 0.13 : ray.mode === "flee" ? 0.7 : 0.32;
    ray.height = THREE.MathUtils.lerp(ray.height, lift, 1 - Math.exp(-dt * 1.5));
    p.y = groundHeight(p.x, p.z) + ray.height;

    // Burying: sand settles over the back after the settling flap.
    ray.buried = ray.mode === "rest"
      ? Math.min(0.75, ray.buried + dt * 0.18)
      : Math.max(0, ray.buried - dt * 1.5);
    ray.flap *= Math.exp(-dt * 2.5);
    // The rowing wave: slow ripples at rest, deep waves in a hurry.
    const effort = ray.mode === "rest" ? 0.012 : 0.05 + ray.speed * 0.05;
    const rate = ray.mode === "rest" ? 0.6 : 0.9 + ray.speed * 0.55;
    ray.phase += dt * TAU * rate;
    uniforms.rayPhase.value = ray.phase;
    uniforms.rayAmplitude.value = THREE.MathUtils.lerp(uniforms.rayAmplitude.value, effort, 1 - Math.exp(-dt * 2));
    uniforms.rayFlap.value = ray.flap * Math.sin(clock * 9) * 0.8 + ray.flap * 0.3;
    uniforms.raySway.value = 0.25 + ray.speed * 0.12;
    uniforms.rayBuried.value = ray.buried;

    // What the wings do to the water: a push along the path and a haze of silt lifted
    // behind when it skims the sand.
    if (flow && ray.speed > 0.1) {
      flow.inject(p, ray.velocity, RADIUS * 0.9, 0.3);
      ray.trail += dt * ray.speed;
      if (particles && ray.height < 0.45 && ray.trail > 1.2) {
        ray.trail = 0;
        rim.copy(p).addScaledVector(forward, -RADIUS * 0.8);
        rim.y = groundHeight(rim.x, rim.z) + 0.05;
        particles.puff(rim, 4, 0.25, 0.7);
      }
    }

    // Lie on the bed as it slopes, turned to the heading.
    bedNormal(p.x, p.z, normal);
    normal.lerp(delta.set(0, 1, 0), ray.mode === "rest" ? 0 : 0.5).normalize();
    side.crossVectors(forward, normal).normalize();
    forward.crossVectors(normal, side).normalize();
    matrix.makeBasis(forward, normal, side);
    matrix.setPosition(p);
    mesh.matrix.copy(matrix);
    mesh.matrixWorld.copy(matrix);
  }

  mesh.matrixAutoUpdate = false;
  update(0, 0, null);
  return { update, creature, mesh, state: ray };
}
