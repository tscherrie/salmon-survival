import * as THREE from "three";
import { randomGenerator } from "../../riverscape/src/math.js";
import { waterLitShader } from "../../riverscape/src/water.js";
import { COATS, MODEL_LENGTH, createFishMesh } from "./anatomy.js";
import { FALLS, S, bed, current, frame, level, locate, place, regionWeights, section } from "./course.js";
import { bearLegsGeometry, bearPawGeometry, creatureMaterial, heronHeadGeometry, heronLegsGeometry, kingfisherGeometry } from "./creatures.js";
import { createPredators } from "./predators.js";
import { conditions } from "./seasons.js";
import { createRivals } from "./rivals.js";
import { createSchool } from "./school.js";
import { createBrawls } from "./brawl.js";
import { profile as prof } from "./profile.js";
import { phaseOf } from "./salmon.js";
import { dressFoodShader, foodGeometry } from "./food-shapes.js";

// Everything else alive in the river and the sea, and what it means to the salmon:
//
//   food      the drift -- midge and mayfly larvae, caddis, stoneflies, freshwater shrimps,
//             beetles and flies fallen on the surface -- carried down by the current, and
//             at sea swarms of krill; each glows faintly so it can be seen coming
//   shoals    minnows in the river, sticklebacks in the estuary, sand eels and herring at
//             sea: prey once the salmon is big enough, and they know it and scatter; and
//             other young trout holding in the brook, company
//   hunters   brown trout and kingfishers in the brook, herons and pike downstream, seals
//             at sea, and a bear at the salmon fall. Anything big enough to swallow the
//             salmon kills it; anything smaller only hurts it.

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
// The eddies round the fish (flowfield.js), when they are worked out: the drift and the
// specks go where the water round the stones takes them.
let eddies = null;
const eddy = {};
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothUnit = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// How long a caught fish takes to go down, in seconds.
const SWALLOW = 0.4;

// ---------------------------------------------------------------------------------------
// Food.
// Each kind lives its own way, and is worth what it weighs:
//   drift    carried down by the current, anywhere in the water column
//   bed      on the bottom: caddis in their cases of little stones, stonefly nymphs clinging
//            to the gravel, snails; they crawl, they do not drift -- the fish has to go down
//   swim     drifting, but darting now and then, and away from a fish that comes too close:
//            mayfly nymphs, shrimps, leeches
//   surface  fallen into the river from the banks, struggling in the film: ants, flies,
//            beetles -- the fish must come up for them
//   swarm    krill at sea, in clouds that shy from a big shape
// Rare treats: an earthworm washed in from the bank, a trout egg drifting from a redd.
const FOODS = {
  blackfly: { size: 0.06, nutrition: 0.8, color: [0.36, 0.3, 0.2], shape: "larva", mode: "drift" },
  midge: { size: 0.075, nutrition: 1.2, color: [0.8, 0.14, 0.08], shape: "worm", mode: "drift" },
  egg: { size: 0.06, nutrition: 2.5, color: [1.0, 0.45, 0.1], shape: "egg", mode: "drift", low: true },
  mayfly: { size: 0.15, nutrition: 3, color: [0.62, 0.5, 0.26], shape: "nymph", mode: "swim", flee: 0.9 },
  gammarus: { size: 0.18, nutrition: 5, color: [0.78, 0.56, 0.34], shape: "shrimp", mode: "swim", flee: 1.2 },
  leech: { size: 0.35, nutrition: 11, color: [0.12, 0.14, 0.08], shape: "leech", mode: "swim", flee: 0.5 },
  caddis: { size: 0.22, nutrition: 6, color: [0.42, 0.36, 0.26], shape: "cased", mode: "bed" },
  stonefly: { size: 0.3, nutrition: 9, color: [0.55, 0.38, 0.18], shape: "nymph", mode: "bed" },
  snail: { size: 0.14, nutrition: 4, color: [0.42, 0.3, 0.16], shape: "snail", mode: "bed" },
  ant: { size: 0.08, nutrition: 1.5, color: [0.1, 0.06, 0.04], shape: "beetle", mode: "surface" },
  fly: { size: 0.12, nutrition: 3, color: [0.16, 0.16, 0.15], shape: "fly", mode: "surface" },
  insect: { size: 0.17, nutrition: 7, color: [0.14, 0.12, 0.09], shape: "beetle", mode: "surface" },
  earthworm: { size: 0.5, nutrition: 25, color: [0.85, 0.42, 0.4], shape: "earthworm", mode: "drift", sinks: true },
  krill: { size: 0.32, nutrition: 6, color: [0.95, 0.38, 0.22], shape: "shrimp", mode: "swarm" },
  // Only where people throw it in, from the bridge.
  bread: { size: 0.3, nutrition: 9, color: [0.9, 0.78, 0.52], shape: "crumb", mode: "surface" },
  // Only round the salmon farm: feed that drifts out through its nets.
  pellet: { size: 0.14, nutrition: 5, color: [0.5, 0.32, 0.18], shape: "pellet", mode: "drift", sinks: true },
  // An angler's fly: bright, tempting -- and on a hook (events.js moves it).
  lure: { size: 0.22, nutrition: 0, color: [0.85, 0.35, 0.12], shape: "fly", mode: "surface" },
};
for (const type of Object.values(FOODS)) {
  type.surface = type.mode === "surface";
  type.swarm = type.mode === "swarm";
}
const MIX = {
  brook: { blackfly: 0.2, midge: 0.24, egg: 0.04, mayfly: 0.17, stonefly: 0.08, caddis: 0.08, snail: 0.04, ant: 0.05, fly: 0.05, insect: 0.02, earthworm: 0.02, leech: 0.01 },
  upper: { blackfly: 0.12, midge: 0.15, mayfly: 0.17, caddis: 0.14, gammarus: 0.12, stonefly: 0.08, snail: 0.05, fly: 0.06, ant: 0.04, insect: 0.03, earthworm: 0.03, leech: 0.02 },
  middle: { midge: 0.12, mayfly: 0.14, caddis: 0.14, gammarus: 0.24, snail: 0.07, leech: 0.05, fly: 0.08, ant: 0.05, insect: 0.06, earthworm: 0.03 },
  lower: { midge: 0.2, gammarus: 0.32, snail: 0.08, leech: 0.08, insect: 0.14, fly: 0.08, ant: 0.04, earthworm: 0.03 },
  estuary: { gammarus: 0.5, krill: 0.4, leech: 0.05, snail: 0.05 },
  sea: { krill: 1 },
};

function createFood(scene, { count = 240 } = {}) {
  const random = randomGenerator(51377);
  const range = (a, b) => a + (b - a) * random();
  const glow = { value: 0.25 };
  const pulseTime = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.45 });
  material.onBeforeCompile = (shader) => {
    waterLitShader(shader);
    shader.uniforms.foodGlow = glow;
    shader.uniforms.foodTime = pulseTime;
    dressFoodShader(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float edible;\nvarying float vEdible;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvEdible = edible;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float foodGlow;\nuniform float foodTime;\nvarying float vEdible;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // A living thing in the drift catches the eye: a faint glow of its own colour, and
        // a rim that lights up against the water behind it. What this fish can swallow
        // glows warm and gently pulses, so food is food at a glance.
        float rim = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 2.0);
        float pulse = 0.75 + 0.25 * sin(foodTime * 5.0);
        totalEmissiveRadiance += diffuseColor.rgb * foodGlow * (0.6 + 1.6 * rim) * (0.5 + 1.3 * vEdible);
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.38) * vEdible * (0.35 + 1.1 * rim) * pulse * foodGlow;`,
      );
  };
  material.customProgramCacheKey = () => "salmon-food-v3";
  const meshes = {};
  const edibleFlags = {};
  for (const [name, type] of Object.entries(FOODS)) {
    const geometry = foodGeometry(type.shape);
    edibleFlags[name] = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    edibleFlags[name].setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("edible", edibleFlags[name]);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = `Food ${name}`;
    mesh.castShadow = false;
    scene.add(mesh);
    meshes[name] = mesh;
  }
  // A soft halo round each item, so a speck of food reads at a distance.
  const haloGeometry = new THREE.BufferGeometry();
  const haloPositions = new Float32Array(count * 3);
  const haloSizes = new Float32Array(count);
  const haloColors = new Float32Array(count * 3);
  haloGeometry.setAttribute("position", new THREE.BufferAttribute(haloPositions, 3));
  haloGeometry.setAttribute("size", new THREE.BufferAttribute(haloSizes, 1));
  haloGeometry.setAttribute("color", new THREE.BufferAttribute(haloColors, 3));
  const haloMaterial = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), scale: { value: 400 }, light: { value: 1 } },
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute float size;
      attribute vec3 color;
      uniform float scale;
      varying vec3 vColor;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(size * scale / max(-mvPosition.z, 0.05), 2.0, 110.0);
        vColor = color;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float light;
      varying vec3 vColor;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-r * r * 3.5) * 0.275;
        if (a < 0.004) discard;
        // Fogged as a colour first, then weighted, so the haze is not added to the whole square.
        gl_FragColor = vec4(vColor * light, 1.0);
        #include <fog_fragment>
        gl_FragColor.rgb = max(gl_FragColor.rgb - underwaterInscatter(fogDirection) * (1.0 - fogTransmit), 0.0) * a;
      }
    `,
  });
  const halos = new THREE.Points(haloGeometry, haloMaterial);
  halos.frustumCulled = false;
  halos.name = "Food halos";
  scene.add(halos);

  // The marked morsel, quietly: a faint glint round the one the fish is making for, and
  // when it is close enough to strike a thin circle that draws in onto it, again and again,
  // like an eye focusing. Nothing that sits over the water like a sight.
  const markGeometry = new THREE.BufferGeometry();
  const markPosition = new Float32Array(3);
  markGeometry.setAttribute("position", new THREE.BufferAttribute(markPosition, 3));
  const markMaterial = new THREE.ShaderMaterial({
    uniforms: { size: { value: 0 }, scale: { value: 400 }, time: { value: 0 }, strength: { value: 0 }, ready: { value: 0 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float size, scale;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(size * scale / max(-mvPosition.z, 0.05), 8.0, 64.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time, strength, ready;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float r = length(p) * 2.0;
        float glint = exp(-r * r * 10.0) * 0.16 * strength;
        float phase = fract(time * 0.85);
        float eased = phase * phase * (3.0 - 2.0 * phase);
        float radius = mix(0.92, 0.3, eased);
        float line = exp(-pow((r - radius) * 20.0, 2.0)) * (1.0 - phase) * ready * 0.5;
        float alpha = glint + line;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.76) * alpha, 1.0);
      }
    `,
  });
  const mark = new THREE.Points(markGeometry, markMaterial);
  mark.frustumCulled = false;
  mark.renderOrder = 5;
  mark.name = "Food mark";
  scene.add(mark);
  const markAt = new THREE.Vector3();
  let markStrength = 0,
    readySince = -1;
  const gullet = new THREE.Vector3();
  const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  // How much drift there is: round a young fish in the river half as much as the pool holds
  // (plenty to live on, not a feast); for bigger fish and at sea all of it.
  // Less in the cold months, more in an evening rise, and more past a spot the fish holds
  // as its own.
  let focus = 0;
  const activeCount = (fish) => Math.min(count, Math.round(count * (fish.length < 1.6 ? 0.5 : 1) * (0.4 + 0.6 * conditions.plenty) * (1 + 0.6 * conditions.hatch) * (1 + 0.55 * focus)));

  const items = Array.from({ length: count }, () => ({
    type: "midge",
    position: new THREE.Vector3(),
    river: { s: 0, u: 0 },
    wiggle: range(0, TAU),
    size: 0.1,
    nutrition: 1,
    eatenAt: -1,
    swarm: null,
    offset: new THREE.Vector3(),
    alive: false,
    eta: 0.5,
  }));
  const swarms = Array.from({ length: 5 }, () => ({ centre: new THREE.Vector3(), river: { s: 0, u: 0 }, velocity: new THREE.Vector3(), members: 0 }));
  const rises = [];
  const flow = {};
  const at = {};
  const object = new THREE.Object3D();
  const toItem = new THREE.Vector3();
  const color = new THREE.Color();
  const weights = {};
  let clock = 0;

  function chooseType(s) {
    regionWeights(s, weights);
    const mix = {};
    for (const [region, w] of Object.entries(weights)) {
      if (w <= 0) continue;
      for (const [type, share] of Object.entries(MIX[region])) mix[type] = (mix[type] ?? 0) + share * w;
    }
    // The time of day and year: at dusk the insects hatch -- mayfly nymphs swim up and
    // the duns sit on the surface -- and in winter nothing falls on the water; the spring
    // flood washes earthworms in from the banks.
    const c = conditions;
    const river = 1 - (weights.sea ?? 0) - (weights.estuary ?? 0);
    if (river > 0.05) {
      mix.fly = (mix.fly ?? 0) + 0.6 * c.hatch * river;
      mix.mayfly = (mix.mayfly ?? 0) + 0.35 * c.hatch * river;
      const insects = 1 - 0.92 * c.winter;
      for (const type of ["ant", "fly", "insect"]) if (mix[type]) mix[type] *= insects;
      if (mix.earthworm) mix.earthworm *= 1 + 2.5 * c.flood;
    }
    let total = 0;
    for (const v of Object.values(mix)) total += v;
    let x = random() * total;
    for (const [type, v] of Object.entries(mix)) {
      x -= v;
      if (x <= 0) return type;
    }
    return "midge";
  }

  function window(fish) {
    const L = fish.length;
    const up = clamp(14 + 18 * L, 14, 100);
    return { up, down: up * 0.4, side: clamp(2.5 + 4 * L, 3, 40), depth: clamp(1 + 2.5 * L, 1.2, 25) };
  }

  // Put an item somewhere in the water round the fish: at the upstream edge when refilling,
  // anywhere in the window at the start.
  function spawn(item, fish, anywhere) {
    const w = window(fish);
    const s0 = fish.river.s;
    item.held = false;
    item.type = chooseType(s0);
    // Round a very small fish the drift is mostly what it can swallow: the smallest larvae
    // are the most numerous anyway.
    for (let k = 0; k < 2 && FOODS[item.type].size * 0.8 > fish.length * 0.5 && random() < 0.65; k++) item.type = chooseType(s0);
    const type = FOODS[item.type];
    item.eatenAt = -1;
    item.alive = true;
    item.swarm = null;
    item.size = type.size * range(0.8, 1.25);
    item.nutrition = type.nutrition * (item.size / type.size) ** 3;
    if (type.swarm) {
      const swarm = swarms[Math.floor(random() * swarms.length)];
      if (swarm.members === 0 || swarm.centre.distanceTo(fish.position) > w.up * 2.5) placeSwarm(swarm, fish);
      swarm.members++;
      item.swarm = swarm;
      item.offset.set(range(-1, 1), range(-0.6, 0.6), range(-1, 1)).multiplyScalar(2.5 + fish.length * 0.4);
      item.position.copy(swarm.centre).add(item.offset);
      locate(item.position.x, item.position.z, swarm.river.s, item.river);
      return;
    }
    const onBed = type.mode === "bed";
    for (let tries = 0; tries < 6; tries++) {
      // Things on the bottom do not drift in from upstream: they are wherever they are.
      const s = anywhere || onBed ? s0 + range(-w.down, w.up) * -1 : s0 - w.up + range(0, w.up * 0.25);
      if (onBed && !anywhere && Math.abs(s - s0) < 2 + fish.length * 2) continue;
      const c = section(Math.min(s, S.coast));
      // Most of the drift rides the seams of fast water; some anywhere across. On a good
      // spot of its own, more of it comes right past the fish.
      const side = !anywhere && focus > 0 && random() < 0.6 ? w.side * 0.3 : w.side;
      const u = clamp(fish.river.u + range(-side, side), c.thalweg - c.half * 0.95, c.thalweg + c.half * 0.95);
      const floor = bed(s, u);
      const lv = level(s);
      if (lv - floor < 0.4) continue;
      place(s, u, at);
      // Height as a share of the water column, so the drift keeps its place in it as the
      // river steps down: near the fish's own share, give or take.
      const fishFloor = bed(fish.river.s, fish.river.u);
      const fishLevel = level(fish.river.s);
      const fishEta = clamp((fish.position.y - fishFloor) / Math.max(0.3, fishLevel - fishFloor), 0, 1);
      const spread = Math.min(0.45, w.depth / Math.max(0.5, lv - floor));
      item.eta = type.surface ? 1 : onBed ? 0 : type.low ? range(0.03, 0.2) : clamp(fishEta + range(-spread, spread), 0.04, 0.96);
      item.crawl = random() * TAU;
      item.dart = 0;
      // In an evening rise, many of the mayfly nymphs are on their way up to hatch.
      item.emerging = item.type === "mayfly" && random() < conditions.hatch * 0.85;
      if (item.emerging) item.eta = range(0.05, 0.6);
      const y = type.surface ? lv - 0.025 : onBed ? floor + item.size * 0.3 : lerp(floor + 0.1, lv - 0.1, item.eta);
      item.position.set(at.x, y, at.z);
      item.river.s = s;
      item.river.u = u;
      return;
    }
    item.alive = false;
  }
  function placeSwarm(swarm, fish) {
    const a = random() * TAU;
    const d = range(25, 70) + fish.length * 6;
    swarm.centre.set(fish.position.x + Math.cos(a) * d, 0, fish.position.z + Math.sin(a) * d);
    locate(swarm.centre.x, swarm.centre.z, fish.river.s, swarm.river);
    const floor = bed(swarm.river.s, swarm.river.u);
    const lv = level(swarm.river.s);
    swarm.centre.y = lerp(floor + 2, lv - 1, range(0.3, 0.8));
    swarm.velocity.set(range(-0.3, 0.3), 0, range(-0.3, 0.3));
    swarm.members = 0;
  }

  return {
    meshes: Object.values(meshes),
    items,
    rises,
    glow,
    haloMaterial,
    markMaterial,
    reset(fish) {
      for (const swarm of swarms) swarm.members = 0;
      const active = activeCount(fish);
      items.forEach((item, i) => {
        if (i < active) spawn(item, fish, true);
        else item.alive = false;
      });
    },
    // Something thrown in at (x, z): it lands on the surface and drifts from there.
    toss(type, x, z, fish) {
      // A free slot, or else the drifting morsel furthest from the fish.
      let item = items.find((q) => !q.alive);
      // (Out at sea every slot may be in a swarm; then a swarm gives up its furthest member.)
      if (!item) {
        let far = -1;
        for (const q of items) {
          if (q.eatenAt >= 0) continue;
          const d = q.position.distanceToSquared(fish.position) + (q.swarm ? 1e9 : 0);
          if (d > far) (far = d), (item = q);
        }
      }
      const t = FOODS[type];
      if (!item || !t) return false;
      item.type = type;
      item.held = false;
      item.eatenAt = -1;
      item.alive = true;
      item.swarm = null;
      item.size = t.size * range(0.8, 1.2);
      item.nutrition = t.nutrition * (item.size / t.size) ** 3;
      item.eta = t.surface ? 1 : range(0.4, 0.9);
      item.crawl = random() * TAU;
      item.dart = 0;
      item.emerging = false;
      locate(x, z, fish.river.s, item.river);
      const lv = level(item.river.s);
      item.position.set(x, t.surface ? lv - 0.025 : lerp(bed(item.river.s, item.river.u) + 0.1, lv - 0.1, item.eta), z);
      return item;
    },
    // Returns what the fish ate this frame (nutrition), after offering it to the fish.
    update(dt, fish, salmon, time, bonus = 0, prior = null) {
      clock += dt;
      focus = bonus;
      const w = window(fish);
      const L = fish.length;
      const gape = 0.5 * L;
      pulseTime.value = clock;
      // A fish takes food only between its jaws: nothing is drawn to it. Getting close is the
      // player's work; the nearest morsel close ahead is marked, and over the last short
      // stretch the fish goes for it by itself -- turning onto it and darting at it with its
      // mouth open (Space darts from a little further). `prior` is the best target the
      // shoals offered (a minnow, a sand eel), so a fish and a larva compete fairly.
      const reach = 0.1 * L + 0.025;
      let pull = prior?.position ?? null,
        pullDistance = prior?.position ? prior.distance : 1.1 * L + 0.22,
        pullAhead = prior?.position ? prior.ahead : 0;
      const fasting = salmon.stage().fasting && fish.lunging <= 0 && !((fish.striking ?? 0) > 0);
      const canEat = !fish.airborne && !fasting && !fish.captive;
      const active = activeCount(fish);
      // Inside the mouth, a little behind the lips: where swallowed food goes.
      gullet.copy(fish.mouth).addScaledVector(fish.heading, (-0.07 * L) / 0.79);
      let eaten = 0;
      const counts = {};
      for (const name of Object.keys(FOODS)) counts[name] = 0;
      for (const swarm of swarms) {
        if (swarm.members <= 0) continue;
        swarm.centre.addScaledVector(swarm.velocity, dt);
        // Krill shy from a big shape coming at them.
        const away = toItem.subVectors(swarm.centre, fish.position);
        const d = away.length();
        if (d < 4 + L * 2 && d > 1e-3) swarm.centre.addScaledVector(away, (dt * 0.6) / d);
        locate(swarm.centre.x, swarm.centre.z, swarm.river.s, swarm.river);
        swarm.members = 0;
      }
      // Other fish rising: in a hatch, now and then something takes a dun off the surface
      // somewhere near -- a ring spreads where it was.
      rises.length = 0;
      if (conditions.hatch > 0.05 && random() < dt * conditions.hatch * 1.4) {
        const pick = items[Math.floor(random() * items.length)];
        if (pick.alive && pick.eatenAt < 0 && FOODS[pick.type].surface && pick.position.distanceTo(fish.mouth) > 1.5 + L * 2) {
          pick.alive = false;
          rises.push({ x: pick.position.x, z: pick.position.z });
        }
      }
      let halo = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.alive) {
          if (i < active && random() < 0.05 * (1 + focus)) spawn(item, fish, false);
          if (!item.alive) continue;
        }
        const type = FOODS[item.type];
        const { position, river } = item;
        item.wiggle += dt * (type.swarm ? 7 : 4);
        if (item.eatenAt >= 0) {
          // Being swallowed: drawn into the open mouth, and gone inside it.
          position.lerp(gullet, 1 - Math.exp(-dt * 32));
        } else if (item.held) {
          // On a line: whoever holds it moves it.
        } else if (item.swarm) {
          item.swarm.members++;
          item.offset.x += Math.sin(item.wiggle * 0.7 + i) * dt * 0.4;
          item.offset.z += Math.cos(item.wiggle * 0.5 + i * 1.3) * dt * 0.4;
          item.offset.y += Math.sin(item.wiggle * 0.3 + i * 0.7) * dt * 0.15;
          item.offset.clampLength(0, 3 + L * 0.5);
          position.copy(item.swarm.centre).add(item.offset);
          if (item.swarm.centre.distanceTo(fish.position) > w.up * 3) item.alive = false;
        } else if (type.mode === "bed") {
          // Crawling slowly over the bottom; the current does not take it.
          item.crawl += (Math.sin(item.wiggle * 0.37 + i) * 0.8) * dt;
          position.x += Math.cos(item.crawl) * 0.03 * dt;
          position.z += Math.sin(item.crawl) * 0.03 * dt;
          locate(position.x, position.z, river.s, river);
          const lv = level(river.s);
          const floor = bed(river.s, river.u);
          position.y = floor + item.size * 0.3;
          const behind = river.s - fish.river.s;
          if (behind > w.down || behind < -w.up - 10 || Math.abs(river.u - fish.river.u) > w.side * 1.6 || lv - floor < 0.2) item.alive = false;
        } else {
          locate(position.x, position.z, river.s, river);
          current(river.s, river.u, position.y, flow, time);
          if (eddies) eddies.apply(position.x, position.y, position.z, flow);
          const k = type.surface ? 1.05 : 0.95;
          position.x += (flow.vx * k + Math.sin(item.wiggle) * 0.04) * dt;
          position.z += (flow.vz * k + Math.cos(item.wiggle * 0.7) * 0.04) * dt;
          if (item.emerging) {
            // Swimming steadily up; at the surface the nymph splits its skin and the dun
            // sits on the film to dry its wings.
            item.eta += (0.05 + 0.02 * Math.sin(item.wiggle)) * dt;
            if (item.eta >= 0.97) {
              item.emerging = false;
              item.type = "fly";
              item.size = FOODS.fly.size * range(0.9, 1.2);
              item.nutrition = FOODS.fly.nutrition * (item.size / FOODS.fly.size) ** 3;
            }
          } else if (type.mode === "swim") {
            // Darting now and then, and away from a mouth that comes close.
            item.dart = Math.max(0, item.dart - dt);
            if (item.dart <= 0 && random() < dt * 0.4) {
              item.dart = 0.35;
              item.crawl = random() * TAU;
            }
            toItem.subVectors(position, fish.mouth);
            const near = toItem.length();
            if (near < 0.9 * L + 0.25 && near > 1e-4 && toItem.dot(fish.heading) > 0 && fish.relative.length() > 0.2) {
              position.addScaledVector(toItem, (type.flee * dt) / near);
              item.eta = clamp(item.eta + (toItem.y > 0 ? 0.08 : -0.08) * dt, 0.03, 0.97);
            } else if (item.dart > 0) {
              position.x += Math.cos(item.crawl) * type.flee * 0.5 * dt;
              position.z += Math.sin(item.crawl) * type.flee * 0.5 * dt;
            }
          }
          const lv = level(river.s);
          const floor = bed(river.s, river.u);
          if (type.surface) position.y = lv - 0.025 + Math.sin(item.wiggle * 3) * 0.004;
          else if (item.emerging) position.y = lerp(floor + 0.1, lv - 0.05, Math.min(1, item.eta));
          else {
            const sink = type.sinks ? -0.02 : type.low ? -0.006 : 0;
            item.eta = clamp(item.eta + (Math.sin(item.wiggle * 0.5) * 0.01 + (flow.speed > 2 ? 0.004 : -0.002) + sink) * dt, 0.03, 0.97);
            position.y = lerp(floor + 0.1, lv - 0.1, item.eta);
          }
          const behind = river.s - fish.river.s;
          if (behind > w.down || behind < -w.up - 10 || Math.abs(river.u - fish.river.u) > w.side * 1.6 || lv - floor < 0.2) item.alive = false;
        }
        if (item.eatenAt >= 0 && clock - item.eatenAt > 0.2) item.alive = false;
        // In front of the mouth and small enough to swallow: taken.
        const fits = item.size <= gape;
        if (item.eatenAt < 0 && fits && canEat) {
          toItem.subVectors(position, fish.mouth);
          const d = toItem.length();
          const ahead = toItem.dot(fish.heading);
          if (d < reach + item.size * 0.5 && (d < 0.08 * L || ahead > 0.3 * d)) {
            item.eatenAt = clock;
            item.swarm = null;
            if (!item.held) eaten += salmon.eat(item.nutrition, item.type);
          } else if (d < pullDistance && ahead > 0.5 * d) {
            pullDistance = d;
            pull = position;
            pullAhead = ahead / d;
          }
        }
        if (!item.alive) continue;
        const mesh = meshes[item.type];
        const slot = counts[item.type]++;
        // Swallowed food keeps its size until it is between the jaws, then disappears inside.
        const shrink = item.eatenAt >= 0 ? 1 - smooth01((clock - item.eatenAt - 0.06) / 0.1) : 1;
        frame(river.s, at);
        object.position.copy(position);
        object.rotation.set(Math.sin(item.wiggle) * 0.5, -Math.atan2(at.tz, at.tx) + Math.sin(item.wiggle * 1.3) * 0.6 + (type.swarm ? i : 0), Math.sin(item.wiggle * 0.8) * 0.3);
        object.scale.setScalar(item.size * shrink);
        object.updateMatrix();
        mesh.setMatrixAt(slot, object.matrix);
        color.setRGB(...type.color);
        mesh.setColorAt(slot, color);
        const edible = fits && !fasting ? 1 : 0;
        edibleFlags[item.type].setX(slot, edible);
        haloPositions[halo * 3] = position.x;
        haloPositions[halo * 3 + 1] = position.y;
        haloPositions[halo * 3 + 2] = position.z;
        // Only food near the fish glows, so the water is not full of lights; what it can
        // eat glows warm and breathes, what is too big for it hardly at all.
        const near = 1 - Math.min(1, position.distanceTo(fish.position) / (3 + L * 8));
        const breathe = 1 + 0.22 * Math.sin(clock * 5 + i * 1.7);
        haloSizes[halo] = Math.max(item.size * 3.2, 0.12) * shrink * (edible ? breathe : 0.45) * near;
        if (edible) {
          haloColors[halo * 3] = 0.95 + type.color[0] * 0.2;
          haloColors[halo * 3 + 1] = 0.72 + type.color[1] * 0.15;
          haloColors[halo * 3 + 2] = 0.34 + type.color[2] * 0.1;
        } else {
          haloColors[halo * 3] = 0.1;
          haloColors[halo * 3 + 1] = 0.11;
          haloColors[halo * 3 + 2] = 0.1;
        }
        halo++;
      }
      for (const [name, mesh] of Object.entries(meshes)) {
        const n = counts[name];
        mesh.count = n;
        mesh.visible = n > 0;
        if (n === 0) continue;
        // Only the slots in use go up to the card.
        for (const attribute of [mesh.instanceMatrix, edibleFlags[name], mesh.instanceColor]) {
          if (!attribute) continue;
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(0, n * attribute.itemSize);
          attribute.needsUpdate = true;
        }
      }
      // The marked morsel (for the tips), and whether it is close enough ahead that Space
      // makes the fish strike at it: shoot the last short stretch, mouth open, and take it.
      fish.dart = pull ? pull.clone() : null;
      fish.strike = pull && pullDistance < 0.75 * L + 0.15 && pullAhead > 0.6 ? pull.clone() : null;
      // Close in front: the fish goes for it by itself.
      fish.snap = pull && pullDistance < 0.45 * L + 0.1 && pullAhead > 0.7 ? fish.strike : null;
      // The mark glides from one morsel to the next.
      if (pull) {
        if (markStrength < 0.05) markAt.copy(pull);
        else markAt.lerp(pull, 1 - Math.exp(-dt * 18));
      }
      markStrength += ((pull ? 1 : 0) - markStrength) * (1 - Math.exp(-dt * (pull ? 6 : 5)));
      markPosition[0] = markAt.x;
      markPosition[1] = markAt.y;
      markPosition[2] = markAt.z;
      markGeometry.attributes.position.needsUpdate = true;
      const readyNow = fish.strike && !fish.winded;
      if (readyNow && readySince < 0) readySince = clock;
      else if (!readyNow) readySince = -1;
      const u = markMaterial.uniforms;
      u.size.value = Math.max(0.08, L * 0.18);
      u.time.value = readySince < 0 ? 0 : clock - readySince;
      u.strength.value = markStrength;
      u.ready.value += ((readyNow ? 1 : 0) - u.ready.value) * (1 - Math.exp(-dt * 10));
      mark.visible = markStrength > 0.02;
      haloGeometry.setDrawRange(0, halo);
      haloGeometry.attributes.position.needsUpdate = true;
      haloGeometry.attributes.size.needsUpdate = true;
      haloGeometry.attributes.color.needsUpdate = true;
      return eaten;
    },
  };
}

// ---------------------------------------------------------------------------------------
// Shoals.
const SHOALS = {
  minnow: { body: "minnow", coat: "minnow", size: [0.55, 0.85], per: 18, groups: 3, regions: { upper: 0.8, middle: 1, lower: 0.8 }, nutrition: 90, ref: 0.75, cruise: 1.2, sprint: 4.2, bottom: 0.25, flees: true, title: "Elritze", temper: 0.5 },
  stickleback: { body: "minnow", coat: { ...COATS.minnow, back: [0.02, 0.035, 0.018], flank: [0.2, 0.26, 0.14], bars: 0.3, silver: 0.6 }, size: [0.4, 0.6], per: 16, groups: 2, regions: { estuary: 1, lower: 0.4 }, nutrition: 40, ref: 0.5, cruise: 1.0, sprint: 3.5, bottom: 0.3, flees: true, title: "Stichling", temper: 0.9 },
  sandeel: { body: "sandeel", coat: "sandeel", size: [1.0, 2.0], per: 34, groups: 3, regions: { sea: 1, estuary: 0.3 }, nutrition: 250, ref: 1.6, cruise: 2.2, sprint: 9, bottom: 0.1, flees: true, title: "Sandaal", temper: 0.4 },
  herring: { body: "herring", coat: "herring", size: [2.0, 3.0], per: 46, groups: 3, regions: { sea: 1 }, nutrition: 600, ref: 2.5, cruise: 3, sprint: 12, bottom: 0.5, flees: true, title: "Hering", temper: 0.5 },
  mackerel: { body: "mackerel", coat: "mackerel", size: [2.2, 3.4], per: 28, groups: 2, regions: { sea: 1 }, nutrition: 700, ref: 2.8, cruise: 3.4, sprint: 14, bottom: 0.6, flees: true, title: "Makrele", temper: 0.6 },
  // Graylings holding in the current of the middle river in small groups, fins spread.
  grayling: { body: "grayling", coat: "grayling", size: [1.4, 2.6], per: 5, groups: 2, regions: { upper: 0.5, middle: 1, lower: 0.5 }, nutrition: 0, ref: 2, cruise: 1.4, sprint: 6, bottom: 0.2, flees: false, station: true, title: "Äsche", temper: 0.9 },
  // Eels, lying up on the bed of the slow lower river and the estuary.
  eel: { body: "eel", coat: "eel", size: [2.5, 5.0], per: 2, groups: 2, regions: { lower: 1, estuary: 0.8, middle: 0.3 }, nutrition: 0, ref: 3.5, cruise: 0.8, sprint: 4, bottom: 0.02, flees: false, station: true, spread: 6, title: "Aal", temper: 1.1 },
  // The alevin's brothers and sisters, wriggling in the gravel of the same redd.
  siblings: { body: "alevin", coat: "alevin", size: [0.2, 0.28], per: 12, groups: 1, regions: { brook: 1 }, nutrition: 0, ref: 0.25, cruise: 0.25, sprint: 0.7, bottom: 0.0, flees: false, station: true, home: S.redd, spread: 2.2, title: "Geschwister", temper: 0.3 },
  troutParr: { body: "parr", coat: { ...COATS.parr, back: [0.04, 0.035, 0.016], redSpots: 1, blackSpots: 0.9, halo: 0.6 }, size: [0.6, 1.2], per: 6, groups: 2, regions: { brook: 1, upper: 0.6 }, nutrition: 0, ref: 1, cruise: 1.2, sprint: 4, bottom: 0.15, flees: false, station: true, title: "Junge Forelle", temper: 1.35 },
};

function createShoals(scene, { detail, brawls }) {
  const random = randomGenerator(77219);
  const range = (a, b) => a + (b - a) * random();
  const kinds = {};
  const meshes = [];
  for (const [name, spec] of Object.entries(SHOALS)) {
    const count = spec.per * spec.groups;
    // Shoal fish are small on screen: the lighter body.
    const fishMesh = createFishMesh(scene, spec.body, spec.coat, count, { name, castShadow: spec.size[1] > 1.5 && detail, cacheKey: `shoal-${name}`, detail: spec.size[1] > 1.5 ? 0.6 : 0.45 });
    fishMesh.body.count = fishMesh.membranes.count = count;
    meshes.push(fishMesh.body, fishMesh.membranes);
    const groups = [];
    let slot = 0;
    for (let g = 0; g < spec.groups; g++) {
      const members = [];
      for (let i = 0; i < spec.per; i++)
        members.push({
          slot: slot++,
          position: new THREE.Vector3(0, -1e4, 0),
          velocity: new THREE.Vector3(),
          heading: new THREE.Vector3(1, 0, 0),
          offset: new THREE.Vector3(range(-1, 1), range(-0.4, 0.4), range(-1, 1)),
          phase: range(0, TAU),
          finPhase: range(0, TAU),
          size: range(...spec.size),
          alive: false,
          tired: 0,
        });
      groups.push({ spec, name, centre: new THREE.Vector3(), river: { s: -1e5, u: 0 }, members, panic: 0, active: false, wander: new THREE.Vector3(), home: new THREE.Vector3() });
    }
    kinds[name] = { spec, mesh: fishMesh, groups };
  }
  const flow = {};
  const at = {};
  const weights = {};
  const delta = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  function suitability(spec, s) {
    regionWeights(s, weights);
    let v = 0;
    for (const [region, w] of Object.entries(spec.regions)) v += (weights[region] ?? 0) * w;
    return v;
  }
  // Settle a shoal somewhere round the fish where its kind lives, or leave it out.
  function settle(group, fish, ahead) {
    const spec = group.spec;
    group.active = false;
    for (let tries = 0; tries < 8; tries++) {
      const along = ahead * range(25, 70) * (1 + fish.length * 0.15) + range(-20, 20);
      let s = fish.river.s + along;
      if (spec.home !== undefined) {
        if (Math.abs(fish.river.s - spec.home) > 150) return;
        s = spec.home + range(-3, 3);
      }
      if (s < 120 && !spec.station) continue;
      if (random() > suitability(spec, s)) continue;
      const c = section(Math.min(s, S.coast));
      const u = s >= S.straight ? fish.river.u + range(-60, 60) : c.thalweg + range(-0.7, 0.7) * c.half;
      const floor = bed(s, u);
      const lv = level(s);
      const depth = lv - floor;
      if (depth < spec.size[1] * 2 + 0.6) continue;
      place(s, u, at);
      const y = spec.home !== undefined ? floor + 0.08 : floor + Math.min(depth - spec.size[1], Math.max(spec.size[1], depth * (spec.bottom + range(0, 0.3))));
      group.centre.set(at.x, y, at.z);
      group.home.copy(group.centre);
      group.river.s = s;
      group.river.u = u;
      group.active = true;
      group.panic = 0;
      const spread = spec.spread ?? (spec.station ? 5 : 1.2 + spec.size[1] * 1.5);
      for (const m of group.members) {
        m.alive = true;
        m.kraft = undefined;
        m.brawl = null;
        m.position.copy(group.centre).addScaledVector(m.offset, spread);
        m.velocity.set(0, 0, 0);
        m.tired = 0;
      }
      return;
    }
  }

  return {
    meshes,
    kinds,
    reset(fish) {
      for (const kind of Object.values(kinds)) {
        for (const group of kind.groups) {
          group.ball = null;
          settle(group, fish, random() < 0.5 ? 1 : -0.5);
        }
      }
    },
    // A bait ball (baitball.js): every shoal of a kind balled up tight round `ball.centre`,
    // milling, a hole opening round whatever comes into it -- or, with null, let go again.
    // They come in from round about it, out of sight.
    ball(name, ball) {
      const kind = kinds[name];
      if (!kind) return;
      for (const group of kind.groups) {
        group.ball = ball;
        if (!ball) {
          group.panic = 1;
          continue;
        }
        group.active = true;
        group.panic = 0;
        group.centre.copy(ball.centre);
        group.home.copy(ball.centre);
        locate(ball.centre.x, ball.centre.z, null, group.river);
        for (const m of group.members) {
          m.alive = true;
          m.swallow = 0;
          m.kraft = undefined;
          m.brawl = null;
          m.tired = 0;
          m.position.copy(ball.centre).addScaledVector(m.offset, ball.radius * 3.5);
          m.velocity.set(0, 0, 0);
        }
      }
    },
    // Something dives into the ball at `at` and takes the one nearest it (within `reach`).
    take(name, at, reach = 4) {
      const kind = kinds[name];
      if (!kind) return false;
      let best = null,
        bestD = reach;
      for (const group of kind.groups)
        for (const m of group.members) {
          if (!m.alive) continue;
          const d = m.position.distanceTo(at);
          if (d < bestD) (bestD = d), (best = m);
        }
      if (!best) return false;
      best.alive = false;
      best.swallow = 0;
      return true;
    },
    // Returns nutrition eaten by the salmon; `hunters` may take fish too. `aim` collects the
    // nearest fish close ahead that the salmon could dart at.
    update(dt, fish, salmon, time, travel, aim = null) {
      let eaten = 0;
      const L = fish.length;
      const gape = 0.5 * L;
      // A spawner no longer hunts; it only snaps with a lunge, from habit or anger.
      const feeding = !salmon.stage().fasting;
      const hunting = feeding || fish.lunging > 0 || (fish.striking ?? 0) > 0;
      if (!feeding) aim = null;
      if (aim) {
        aim.position = null;
        aim.distance = 1.1 * L + 0.22;
        aim.ahead = 0;
      }
      for (const kind of Object.values(kinds)) {
        const { spec, mesh } = kind;
        mesh.begin();
        for (const group of kind.groups) {
          const gap = group.river.s - fish.river.s;
          const far = Math.abs(gap) > 150 + L * 12 || (group.active && group.centre.distanceTo(fish.position) > 200 + L * 10);
          if (!group.active || far || group.members.every((m) => !m.alive && !(m.swallow > 0))) {
            if (random() < 0.02) settle(group, fish, travel || 1);
            for (const m of group.members) {
              mesh.body.setMatrixAt(m.slot, hidden);
              mesh.membranes.setMatrixAt(m.slot, hidden);
            }
            continue;
          }
          locate(group.centre.x, group.centre.z, group.river.s, group.river);
          current(group.river.s, group.river.u, group.centre.y, flow, time);
          const lv = level(group.river.s);
          const floor = bed(group.river.s, group.river.u);
          // The shoal as a whole: holding in the river, roaming at sea, running from the salmon.
          const toFish = delta.subVectors(group.centre, fish.position);
          const d = toFish.length();
          const threat = spec.flees && L > spec.ref * 1.6 ? 1 : 0;
          const fear = threat * clamp(1 - (d - L * 2) / (6 + L * 4), 0, 1) * clamp(0.4 + fish.relative.length() / 3, 0.4, 1.5);
          group.panic = Math.max(group.panic - dt * 0.4, fear);
          if (group.ball) {
            // Balled up: held where the hunters keep it.
            group.panic = 0;
            group.centre.copy(group.ball.centre);
          } else if (spec.station || group.river.s < S.coast) {
            // Station-keeping: the centre stays where it was put.
            group.centre.lerp(group.home, 1 - Math.exp(-dt * 0.2));
          } else {
            group.wander.x += (random() - 0.5) * dt * 0.8;
            group.wander.z += (random() - 0.5) * dt * 0.8;
            group.wander.clampLength(0, spec.cruise);
            group.centre.addScaledVector(group.wander, dt);
          }
          if (group.panic > 0.05 && d > 1e-3 && !group.ball) group.centre.addScaledVector(toFish, (spec.sprint * 0.6 * group.panic * dt) / d);
          group.centre.y = clamp(group.centre.y, floor + spec.size[1] * 0.8, lv - spec.size[1] * 0.6);
          // The ball turns slowly on itself.
          const mill = group.ball ? time * 0.45 : 0;
          const millC = Math.cos(mill),
            millS = Math.sin(mill);
          const spread = (spec.spread ?? (spec.station ? 5 : 1 + spec.size[1] * 1.2)) * (1 + group.panic);
          for (const m of group.members) {
            if (!m.alive) {
              if (m.swallow > 0) {
                // Caught: it goes into the salmon's mouth head first, tail thrashing, and is
                // gone.
                m.swallow -= dt;
                const t = 1 - m.swallow / SWALLOW;
                m.heading.copy(fish.heading).negate();
                m.position.copy(fish.mouth).addScaledVector(fish.heading, (0.45 - 1.2 * t) * m.size * 0.5);
                const k = (m.size / MODEL_LENGTH) * (1 - smoothUnit((t - 0.45) / 0.55));
                axisZ.crossVectors(m.heading, UP);
                if (axisZ.lengthSq() < 1e-6) axisZ.set(0, 0, 1);
                axisZ.normalize();
                axisY.crossVectors(axisZ, m.heading).normalize();
                basis.makeBasis(m.heading, axisY, axisZ);
                quaternion.setFromRotationMatrix(basis);
                matrix.compose(m.position, quaternion, scale.set(k, k, k));
                mesh.body.setMatrixAt(m.slot, matrix);
                mesh.membranes.setMatrixAt(m.slot, matrix);
                m.phase = (m.phase + dt * TAU * 6) % TAU;
                mesh.swim.setXYZW(m.slot, m.phase, 0.8, 0, 0.6);
                continue;
              }
              mesh.body.setMatrixAt(m.slot, hidden);
              mesh.membranes.setMatrixAt(m.slot, hidden);
              continue;
            }
            // Keep to its place in the shoal, hold into the current, scatter from the salmon.
            if (group.ball) {
              const R = group.ball.radius;
              desired.set(group.centre.x + (m.offset.x * millC - m.offset.z * millS) * R, group.centre.y + m.offset.y * R * 1.6, group.centre.z + (m.offset.x * millS + m.offset.z * millC) * R);
              desired.sub(m.position).multiplyScalar(2.2);
              // (away from a bird plunging in)
              for (const p of group.ball.away) {
                delta.subVectors(m.position, p);
                const dp = delta.length();
                if (dp < 5 && dp > 1e-3) desired.addScaledVector(delta, ((5 - dp) / dp) * 6);
              }
            } else desired.copy(group.centre).addScaledVector(m.offset, spread).sub(m.position).multiplyScalar(1.2);
            // The siblings keep down in the gravel, wriggling.
            if (spec.home !== undefined) desired.y = (floor + 0.06 + Math.max(0, m.offset.y) * 0.2 - m.position.y) * 2 + Math.sin(m.phase * 0.3) * 0.05;
            if (!spec.station && group.river.s >= S.coast && !group.ball) desired.addScaledVector(group.wander, 0.6);
            delta.subVectors(m.position, fish.position);
            const dm = delta.length();
            // (balled up they have nowhere to go: only a hole opens round the salmon, wider
            // when it dashes)
            const scare = group.ball ? (2 + L * 0.9) * (fish.lunging > 0 ? 1.5 : 1) : spec.flees ? (threat ? 3 + L * 1.5 : 1.2 + L) : 0.6 + L * 0.8;
            if (dm < scare && dm > 1e-3) {
              desired.addScaledVector(delta, ((scare - dm) / dm) * (3 + (threat ? spec.sprint : spec.cruise)));
              m.tired += dt;
            } else m.tired = Math.max(0, m.tired - dt * 0.5);
            // Struck by the salmon: fleeing from it, or turning on it.
            const brawling = brawls.move(m, fish, dt, desired, spec.sprint);
            if (brawling && m.brawl === "flee") group.panic = Math.max(group.panic, 0.8);
            const top = brawling ? spec.sprint : m.tired > 4 ? spec.cruise * 1.6 : spec.sprint;
            desired.clampLength(0, top);
            // Swimming through the water: the current is added on top.
            m.velocity.lerp(desired, 1 - Math.exp(-dt * 4));
            m.position.x += (m.velocity.x + flow.vx * (spec.station ? 0 : 0.2)) * dt;
            m.position.y += m.velocity.y * dt;
            m.position.z += (m.velocity.z + flow.vz * (spec.station ? 0 : 0.2)) * dt;
            m.position.y = clamp(m.position.y, floor + m.size * 0.25, lv - m.size * 0.2);
            // Heading: the way it swims through the water, or into the current when still.
            delta.set(m.velocity.x, m.velocity.y * 0.5, m.velocity.z);
            if (delta.lengthSq() < 0.05 * spec.cruise) delta.set(-flow.vx - 1e-3, 0, -flow.vz);
            if (delta.lengthSq() < 1e-6) delta.set(1, 0, 0);
            m.heading.lerp(delta.normalize(), 1 - Math.exp(-dt * 6)).normalize();
            const speed = m.velocity.length();
            m.phase = (m.phase + dt * TAU * (2 + (speed / Math.max(m.size, 0.2)) * 1.2)) % TAU;
            m.finPhase = (m.finPhase + dt * TAU * 2.2) % TAU;
            // Eaten.
            // Only between the jaws; closer in front, it is a target the fish darts at.
            if (spec.nutrition > 0 && m.size <= gape && !fish.airborne && !fish.captive && hunting) {
              const reach = 0.1 * L + m.size * 0.3;
              delta.subVectors(m.position, fish.mouth);
              const dm2 = delta.length();
              const ahead = delta.dot(fish.heading);
              // Out of a bait ball only in a dash, and one at a time (it must swallow first).
              const takes = !group.ball || ((fish.lunging > 0 || (fish.striking ?? 0) > 0) && time - (group.ball.bite ?? -9) > 1.4);
              if (dm2 < reach && ahead > -0.1 * reach && takes) {
                if (group.ball) group.ball.bite = time;
                m.alive = false;
                m.swallow = SWALLOW;
                eaten += salmon.eat(spec.nutrition * (m.size / spec.ref) ** 3, group.name);
              } else if (aim && dm2 < aim.distance && ahead > 0.5 * dm2) {
                aim.distance = dm2;
                aim.ahead = ahead / dm2;
                aim.position = m.position;
              }
            } else if (fish.lunging > 0 && brawls.strike(m, fish, { kind: group.name, title: spec.title, temper: spec.temper })) {
              // Too big to swallow (or not food at all): a blow.
              if (m.brawl === "flee") group.panic = 1;
            }
            axisZ.crossVectors(m.heading, UP);
            if (axisZ.lengthSq() < 1e-6) axisZ.set(0, 0, 1);
            axisZ.normalize();
            axisY.crossVectors(axisZ, m.heading).normalize();
            basis.makeBasis(m.heading, axisY, axisZ);
            quaternion.setFromRotationMatrix(basis);
            const k = m.size / MODEL_LENGTH;
            matrix.compose(m.position, quaternion, scale.set(k, k, k));
            mesh.body.setMatrixAt(m.slot, matrix);
            mesh.membranes.setMatrixAt(m.slot, matrix);
            mesh.swim.setXYZW(m.slot, m.phase, 0.25 + Math.min(0.5, speed / Math.max(spec.cruise, 0.1) * 0.15), 0, 0.2);
            mesh.fin.setX(m.slot, m.finPhase);
          }
        }
        mesh.finish();
      }
      return eaten;
    },
  };
}

// ---------------------------------------------------------------------------------------
// Hunters.
function createHunters(scene, { detail }) {
  const random = randomGenerator(33917);
  const range = (a, b) => a + (b - a) * random();
  const meshes = [];
  const flow = {};
  const at = {};
  const delta = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const mouth = new THREE.Vector3();
  const weights = {};
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  // Birds and the bear: they come from above.
  const creature = creatureMaterial();
  const kingfisher = new THREE.Mesh(kingfisherGeometry(), creature);
  kingfisher.visible = false;
  kingfisher.castShadow = true;
  const heronLegs = new THREE.Mesh(heronLegsGeometry(), creature);
  const heronHead = new THREE.Mesh(heronHeadGeometry(), creature);
  heronLegs.visible = heronHead.visible = false;
  heronLegs.castShadow = heronHead.castShadow = true;
  const bearLegs = new THREE.Mesh(bearLegsGeometry(), creature);
  const bearPaw = new THREE.Mesh(bearPawGeometry(), creature);
  bearLegs.visible = bearPaw.visible = false;
  bearLegs.castShadow = bearPaw.castShadow = true;
  scene.add(kingfisher, heronLegs, heronHead, bearLegs, bearPaw);
  const bird = { mode: "away", clock: 0, next: 60, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, surface: 0 };
  const heron = { mode: "away", position: new THREE.Vector3(), river: { s: 0, u: 0 }, strike: 0, rest: 0, head: new THREE.Vector3(), target: new THREE.Vector3() };
  const lachsfall = FALLS.find((f) => f.name === "Lachsfall");
  const bear = { position: new THREE.Vector3(), u: 0, swipe: 0, rest: 0, active: false, paw: new THREE.Vector3() };
  // The salmon once caught: where the captor holds it (a fish's open mouth, a kingfisher's
  // or a heron's bill, a bear's paw) and which way the captor faces, followed every frame
  // until it is swallowed or carried off.
  const captive = { active: false, kind: null, hunter: null, grip: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0), t: 0 };
  const forward = new THREE.Vector3();
  function seize(kind, hunter = null) {
    captive.active = true;
    captive.kind = kind;
    captive.hunter = hunter;
    captive.t = 0;
  }
  // Everything that hunts under water: fish, the otter, the goosander, the seal.
  const predators = createPredators(scene, { random, seize, captive });
  meshes.push(...predators.meshes);
  const suit = (regions, s) => {
    regionWeights(s, weights);
    let v = 0;
    for (const [r, w] of Object.entries(regions)) v += (weights[r] ?? 0) * w;
    return v;
  };

  function placeHeron(fish, travel, close = false) {
    for (let tries = 0; tries < 12; tries++) {
      // Over a rich riffle it comes to the shallows the fish is feeding in.
      const s = fish.river.s + (travel || 1) * (close ? range(6, 22) : range(30, 70));
      if (suit({ upper: 1, middle: 1, lower: 0.6 }, s) < 0.5) continue;
      const c = section(s);
      const side = random() < 0.5 ? -1 : 1;
      for (let a = 0.6; a < 1.05; a += 0.05) {
        const u = c.thalweg + side * a * c.half;
        const depth = level(s) - bed(s, u);
        if (depth > 1.5 && depth < 4.5) {
          place(s, u, at);
          heron.position.set(at.x, bed(s, u), at.z);
          heron.river.s = s;
          heron.river.u = u;
          heron.mode = "stand";
          return;
        }
      }
    }
    heron.mode = "away";
  }

  return {
    meshes,
    list: predators.list,
    bird,
    heron,
    bear,
    captive,
    // What hunters are about near the fish, for the logbook.
    present(fish, out = []) {
      out.length = 0;
      // (the goosanders of the drive are goosanders)
      for (const h of predators.list) if (h.mode !== "away" && h.position.distanceTo(fish.position) < 14 + h.size * 1.5) out.push(h.kind === "drive" ? "merganser" : h.kind);
      if (bird.mode !== "away") out.push("kingfisher");
      if (heron.mode !== "away" && heron.position.distanceTo(fish.position) < 40) out.push("heron");
      if (bear.active && bear.position.distanceTo(fish.position) < 40) out.push("bear");
      return out;
    },
    // Where a hunter of a kind is (the nearest), for pointing it out.
    where(kind, fish) {
      if (kind === "kingfisher") return bird.from.clone().lerp(bird.to, Math.min(1, bird.t));
      if (kind === "heron") return heron.position;
      if (kind === "bear") return bear.position;
      let best = null;
      for (const h of predators.list) if ((h.kind === kind || (kind === "merganser" && h.kind === "drive")) && h.mode !== "away" && (!best || h.position.distanceTo(fish.position) < best.distanceTo(fish.position))) best = h.position;
      return best;
    },
    // Development: put a hunter of a kind at a point, ready to hunt.
    force(kind, x, y, z) {
      return predators.force(kind, x, y, z);
    },
    // The goosanders of the drive coming in (or going off again).
    drive(fish, on) {
      predators.drive(fish, on);
    },
    foe(fish) {
      return predators.foe(fish);
    },
    threat(fish) {
      return predators.threat(fish);
    },
    // Everything after the salmon now, with how close it is to striking (see predators.js).
    threats(fish, out = []) {
      out.length = 0;
      predators.threats(fish, out);
      if (bird.mode === "hover") out.push({ position: kingfisher.position, level: bird.t > 0.8 ? 1 : 0.8, coiled: bird.t > 0.8, kind: "kingfisher", title: "Eisvogel", above: true, key: bird });
      if (heron.mode === "stand" || heron.mode === "strike") {
        const d = Math.hypot(fish.position.x - heron.position.x, fish.position.z - heron.position.z);
        if (d < 14) out.push({ position: heron.position, level: heron.mode === "strike" ? 1 : d < 7 ? 0.8 : 0.5, coiled: heron.mode === "strike", kind: "heron", title: "Graureiher", key: heron });
      }
      if (bear.active && bear.position.distanceTo(fish.position) < 26) out.push({ position: bear.paw, level: bear.striking ? 1 : 0.6, coiled: !!bear.striking, kind: "bear", title: "Braunbär", key: bear });
      return out;
    },
    reset(fish) {
      predators.reset();
      bird.mode = "away";
      bird.next = 45 + random() * 60;
      heron.mode = "away";
      heron.rest = 30;
      captive.active = false;
      captive.hunter = null;
    },
    // Returns { bitten, killed } for the salmon.
    update(dt, fish, time, travel, covered, cruise = 1, decoy = null, occluded = null, exposed = 0, drive = null) {
      const L = fish.length;
      const result = { bitten: false, killed: null, decoy: false, hits: [], watched: false, hidden: false };
      const deep = level(fish.river.s) - fish.position.y;
      if (captive.active) captive.t += dt;
      // How far a hunter can see: clear in the brook and the sea, less in the brown lower
      // river and the silty estuary.
      regionWeights(fish.river.s, weights);
      const clarity = 1.1 * weights.brook + 1 * weights.upper + 0.85 * weights.middle + 0.65 * weights.lower + 0.7 * weights.estuary + 1.15 * weights.sea;
      // ---- Fish, otters, goosanders and seals under the water.
      predators.update(dt, fish, { time, travel, covered, clarity, cruise, decoy, occluded, exposed, drive }, result);

      // ---- The kingfisher: a small fish near the surface of the brook is watched from above.
      // The bird hovers over it for a moment -- its shadow crosses the bed, its whistle
      // carries -- then drops beak first. A fish that dives deep or bolts in that moment lives.
      bird.next -= dt * (1 + 2 * exposed);
      const brookish = suit({ brook: 1, upper: 0.7 }, fish.river.s);
      // A kingfisher hunts by day, and not over ice.
      const birdLight = conditions.light > 0.45 && conditions.ice < 0.5;
      if (bird.mode === "away" && bird.next <= 0 && birdLight && L < 1.3 && brookish > 0.4 && deep < 3 + L && !covered && !fish.airborne) {
        bird.mode = "hover";
        bird.t = 0;
        bird.surface = level(fish.river.s);
        bird.from.set(fish.position.x - 4, bird.surface + 9, fish.position.z + 2);
        bird.splashed = false;
        bird.checked = false;
        result.call = "kingfisher";
      }
      if (bird.mode === "hover") {
        bird.t += dt;
        result.watched = true;
        // Hanging over the fish, wings a blur.
        bird.to.copy(fish.position);
        const over = new THREE.Vector3(fish.position.x, bird.surface + 7 + Math.sin(bird.t * 30) * 0.08, fish.position.z);
        kingfisher.position.lerp(bird.t < dt * 1.5 ? bird.from : over, bird.t < dt * 1.5 ? 1 : 1 - Math.exp(-dt * 6));
        kingfisher.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.3, -1, 0).normalize());
        kingfisher.scale.setScalar(1.7);
        kingfisher.visible = true;
        if (bird.t > 1.3) {
          bird.mode = "dive";
          bird.t = 0;
          bird.from.copy(kingfisher.position);
          // It aims where the fish will be.
          bird.to.copy(fish.position).addScaledVector(fish.velocity, 0.3);
          bird.to.y = Math.max(bird.to.y, bird.surface - 2.4);
        }
      } else if (bird.mode === "dive") {
        bird.t += dt;
        const t = bird.t / 0.35;
        if (t < 1) kingfisher.position.lerpVectors(bird.from, bird.to, t * t);
        else kingfisher.position.lerpVectors(bird.to, bird.from, Math.min(1, (t - 1) * 0.9));
        delta.subVectors(t < 1 ? bird.to : bird.from, t < 1 ? bird.from : bird.to).normalize();
        kingfisher.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), delta);
        if (!bird.splashed && kingfisher.position.y < bird.surface) {
          bird.splashed = true;
          result.splash = { x: kingfisher.position.x, y: bird.surface, z: kingfisher.position.z, strength: 0.9 };
        }
        if (t >= 1 && !bird.checked) {
          bird.checked = true;
          if (bird.to.distanceTo(fish.position) < 0.45 + L * 0.35 && !covered && !captive.active && !fish.safe) {
            result.killed = "Vom Eisvogel erwischt";
            seize("bird");
          }
        }
        if (captive.kind === "bird" && captive.active) {
          // Held crosswise in the bill, carried up and away.
          forward.set(1, 0, 0).applyQuaternion(kingfisher.quaternion);
          captive.grip.copy(kingfisher.position).addScaledVector(forward, 1.05);
          captive.heading.set(-forward.z, 0, forward.x).normalize();
        }
        if (t > 2.4) {
          bird.mode = "away";
          bird.next = 80 + random() * 100;
          kingfisher.visible = false;
        }
      }

      // ---- The heron: grey legs in the shallows; a fish passing close near the surface is
      // speared.
      heron.rest = Math.max(0, heron.rest - dt);
      const heronCountry = suit({ upper: 1, middle: 1, lower: 0.6 }, fish.river.s);
      // The heron fishes by day and into the dusk; not on a frozen river.
      const heronLight = conditions.light > 0.15 && conditions.ice < 0.5;
      // The evening rise and the rich shallows of a riffle bring it sooner.
      const heronDraw = 1 + 4 * conditions.hatch + 3 * exposed;
      if (heron.mode === "away" && heron.rest <= 0 && heronLight && L < 3.2 && heronCountry > 0.4 && random() < dt * 0.05 * heronDraw) placeHeron(fish, travel, exposed > 0.3);
      if (heron.mode !== "away") {
        if (Math.abs(heron.river.s - fish.river.s) > 200) heron.mode = "away";
        const lv = level(heron.river.s);
        heronLegs.position.copy(heron.position);
        heronLegs.position.y = heron.position.y;
        heronLegs.scale.setScalar(1);
        heronLegs.visible = heron.mode !== "away";
        const dx = fish.position.x - heron.position.x,
          dz = fish.position.z - heron.position.z;
        const horizontal = Math.hypot(dx, dz);
        if (heron.mode === "stand") {
          heron.head.set(heron.position.x + 2, lv + 16, heron.position.z);
          if (horizontal < 5 && deep < 4.5 && !covered && L < 3.2 && !fish.airborne && !fish.safe) {
            heron.mode = "strike";
            heron.strike = 0;
            heron.target.copy(fish.position).addScaledVector(fish.velocity, 0.3);
            heron.from = heron.head.clone();
            // The head stops a bill's length short, so the tip of the bill meets the fish.
            heron.aim = heron.target.clone().addScaledVector(heron.target.clone().sub(heron.from).normalize(), -4.6);
          }
        } else if (heron.mode === "strike") {
          heron.strike += dt;
          const t = Math.min(1, heron.strike / 0.3);
          heron.head.lerpVectors(heron.from, heron.aim ?? heron.target, t * t);
          if (t >= 1 && !heron.checked) {
            heron.checked = true;
            result.splash = { x: heron.target.x, y: lv, z: heron.target.z, strength: 0.8 };
            if (heron.target.distanceTo(fish.position) < 0.7 + L * 0.35) {
              if (L < 2.4 && !captive.active) {
                result.killed = "Vom Graureiher erbeutet";
                seize("heron");
              } else {
                result.bitten = true;
                fish.energy = Math.max(0, fish.energy - 0.25);
              }
            }
          }
          if (heron.strike > 1.2) {
            heron.mode = "stand";
            heron.checked = false;
            heron.rest = 20;
            heron.mode = "wait";
          }
        } else if (heron.mode === "wait") {
          heron.head.lerp(new THREE.Vector3(heron.position.x + 2, lv + 16, heron.position.z), 1 - Math.exp(-dt * 2));
          if (heron.rest <= 0) heron.mode = "stand";
        }
        heronHead.position.copy(heron.head);
        heronHead.visible = true;
        // The beak points from the head toward its target.
        delta.subVectors(heron.target.lengthSq() ? heron.target : heron.head, heron.head);
        heronHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), heron.mode === "strike" && delta.lengthSq() > 1e-4 ? delta.normalize() : new THREE.Vector3(0.3, -1, 0).normalize());
        if (captive.kind === "heron" && captive.active) {
          // Gripped crosswise near the tip of the bill, lifted out of the water with the head.
          forward.set(0, -1, 0).applyQuaternion(heronHead.quaternion);
          captive.grip.copy(heronHead.position).addScaledVector(forward, 4.9);
          captive.heading.set(-forward.z, 0, forward.x);
          if (captive.heading.lengthSq() < 1e-4) captive.heading.set(0, 0, 1);
          captive.heading.normalize();
        }
      } else heronLegs.visible = heronHead.visible = false;

      // ---- The bear at the salmon fall: it stands in the upper pool by the lip in the
      // season the salmon come home.
      bear.active = !!lachsfall && phaseOf(fish.stage) === "spawner" && Math.abs(fish.river.s - lachsfall.s) < 150;
      bearLegs.visible = bearPaw.visible = bear.active;
      if (bear.active) {
        const c = section(lachsfall.s - 6);
        bear.u = c.thalweg + c.half * 0.35;
        const s = lachsfall.s - 5;
        place(s, bear.u, at);
        const floor = bed(s, bear.u);
        bearLegs.position.set(at.x, floor, at.z);
        bear.position.copy(bearLegs.position);
        frame(s, at);
        bearLegs.rotation.set(0, -Math.atan2(at.nz, at.nx), 0);
        bear.rest = Math.max(0, bear.rest - dt);
        const lv = level(s);
        const dx = fish.position.x - bearLegs.position.x,
          dz = fish.position.z - bearLegs.position.z;
        const near = Math.hypot(dx, dz) < 12 && fish.position.y > lv - 5;
        // It fishes in a rhythm: the paw goes up (a moment, for all to see), comes down into
        // the water by the lip with a smack -- at the salmon, if one is near, otherwise at
        // the white water -- and rests a few seconds. A salmon leaping the fall lands safe
        // just after a smack.
        const WIND = 0.7,
          STRIKE = 0.3;
        if (bear.swipe > 0) bear.swipe += dt;
        else if (bear.rest <= 0) {
          bear.swipe = dt;
          bear.checked = false;
          bear.target = new THREE.Vector3();
        }
        if (bear.swipe > 0 && bear.swipe < WIND) {
          // Aiming while the paw is up.
          if (near && !fish.safe) bear.target.copy(fish.position);
          else {
            place(lachsfall.s - 2, bear.u - 2.5, at);
            bear.target.set(at.x, lv - 0.3, at.z);
          }
        }
        const rest = new THREE.Vector3(bearLegs.position.x, lv + 14, bearLegs.position.z);
        const raised = new THREE.Vector3(bearLegs.position.x, lv + 19, bearLegs.position.z);
        const up = bear.swipe > 0 ? Math.min(1, bear.swipe / WIND) : 0;
        const t = bear.swipe > WIND ? Math.min(1, (bear.swipe - WIND) / STRIKE) : 0;
        if (bear.swipe > WIND + STRIKE && captive.kind === "bear" && captive.active) {
          // With a fish under its claws the paw comes back up slowly, holding on.
          const back = Math.min(1, (bear.swipe - WIND - STRIKE) / 0.8);
          bear.paw.lerpVectors(bear.target, rest, back * back * (3 - 2 * back));
        } else if (bear.swipe > WIND + STRIKE) {
          const back = Math.min(1, (bear.swipe - WIND - STRIKE) / 0.9);
          bear.paw.lerpVectors(bear.target, rest, back * back * (3 - 2 * back));
        } else if (bear.swipe > WIND) bear.paw.lerpVectors(raised, bear.target, Math.sin(t * Math.PI * 0.5));
        else bear.paw.lerpVectors(rest, raised, Math.sin(up * Math.PI * 0.5)).add(forward.set(Math.sin(bear.swipe * 40) * 0.15 * up, 0, 0));
        bearPaw.position.copy(bear.paw);
        bear.striking = bear.swipe > 0 && bear.swipe < WIND + STRIKE;
        if (bear.swipe > WIND && t >= 1 && !bear.checked) {
          bear.checked = true;
          result.splash = { x: bear.target.x, y: lv, z: bear.target.z, strength: 1.4 };
          result.bearSmack = true;
          if (bear.target.distanceTo(fish.position) < 3.5 && !captive.active && !fish.safe) {
            result.killed = "Vom Bären gefangen";
            seize("bear");
          }
        }
        if (captive.kind === "bear" && captive.active) {
          // Pinned under the claws and swept up out of the water.
          captive.grip.copy(bear.paw).add(forward.set(0, -0.6, 0));
          frame(lachsfall.s, at);
          captive.heading.set(at.tx, 0, at.tz).normalize();
        }
        if (bear.swipe > WIND + STRIKE + 1.0) {
          bear.swipe = 0;
          bear.checked = false;
          bear.rest = 2.6 + random() * 1.4;
        }
      }
      return result;
    },
  };
}

// ---------------------------------------------------------------------------------------
// Specks in the water round the camera -- silt, plankton, bits of leaf -- that make the water
// itself visible and show how fast it is going. They live in a box round the camera, sized
// to the fish, and wrap round it.
function createMotes(scene, { count = 2200 } = {}) {
  const random = randomGenerator(8812);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = random();
    seeds[i * 3 + 1] = random();
    seeds[i * 3 + 2] = random();
    sizes[i] = 0.4 + random() * random() * 2.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), scale: { value: 400 }, light: { value: 1 }, grain: { value: 0.02 } },
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute float size;
      uniform float scale;
      uniform float grain;
      varying float vNear;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(size * grain * scale / max(-mvPosition.z, 0.02), 1.0, 7.0);
        vNear = smoothstep(grain * 4.0, grain * 16.0, -mvPosition.z);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float light;
      varying float vNear;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.15, length(q)) * 0.32 * vNear;
        gl_FragColor = vec4(vec3(0.78, 0.8, 0.7) * light, a);
        #include <fog_fragment>
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = "Motes";
  scene.add(points);
  const flow = {};
  const river = { s: 0, u: 0 };
  let box = 0;
  const origin = new THREE.Vector3();
  return {
    material,
    update(dt, centre, hintS, length, time, above) {
      points.visible = !above;
      const size = Math.max(5, Math.min(70, 4 + length * 9));
      if (Math.abs(size - box) > box * 0.3) {
        box = size;
        for (let i = 0; i < count; i++) {
          positions[i * 3] = centre.x + (seeds[i * 3] - 0.5) * box;
          positions[i * 3 + 1] = centre.y + (seeds[i * 3 + 1] - 0.5) * box;
          positions[i * 3 + 2] = centre.z + (seeds[i * 3 + 2] - 0.5) * box;
        }
        material.uniforms.grain.value = 0.004 + length * 0.007;
      }
      locate(centre.x, centre.z, hintS, river);
      current(river.s, river.u, centre.y, flow, time);
      const lv = level(river.s);
      const floor = bed(river.s, river.u);
      const half = box / 2;
      for (let i = 0; i < count; i++) {
        let vx = flow.vx,
          vz = flow.vz;
        // Round the stones: parted before them, slack and turning back behind, whirled off.
        if (eddies) {
          eddies.sample(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], eddy);
          vx += eddy.vx;
          vz += eddy.vz;
        }
        let x = positions[i * 3] + vx * dt,
          y = positions[i * 3 + 1] + Math.sin(time * 0.3 + i) * 0.02 * dt,
          z = positions[i * 3 + 2] + vz * dt;
        const dx = x - centre.x,
          dy = y - centre.y,
          dz = z - centre.z;
        if (dx > half) x -= box;
        else if (dx < -half) x += box;
        if (dz > half) z -= box;
        else if (dz < -half) z += box;
        if (dy > half) y -= box;
        else if (dy < -half) y += box;
        // Specks only in the water.
        positions[i * 3] = x;
        positions[i * 3 + 1] = y > lv ? y - Math.ceil((y - lv) / box) * box : y < floor ? y + Math.ceil((floor - y) / box) * box : y;
        positions[i * 3 + 2] = z;
      }
      geometry.attributes.position.needsUpdate = true;
      void origin;
    },
  };
}

// ---------------------------------------------------------------------------------------
// Moon jellyfish drifting in the estuary and the sea: a glassy bell that pulses, four pink
// rings seen through it, a fringe of fine tentacles and the frilled arms trailing under.
function createJellies(scene, { count = 36 } = {}) {
  const random = randomGenerator(4441);
  const range = (a, b) => a + (b - a) * random();
  // The bell: a shallow dome with a scalloped margin, and the tentacles and arms hanging from
  // it, all in one geometry; `part` tells the shader which is which.
  const positions = [],
    normals = [],
    parts = [],
    indices = [];
  const rings = 10,
    segments = 48;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const scallop = 1 - 0.04 * Math.pow(Math.abs(Math.sin(a * 8)), 0.5) * t;
      const r = Math.sin(t * Math.PI * 0.5) * scallop;
      const y = Math.cos(t * Math.PI * 0.5) * 0.42 - 0.05 * t * t;
      positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
      const n = new THREE.Vector3(Math.cos(a) * r, y * 2.4, Math.sin(a) * r).normalize();
      normals.push(n.x, n.y, n.z);
      parts.push(0, t);
      if (i < rings && j < segments) {
        const k = i * (segments + 1) + j;
        indices.push(k, k + segments + 1, k + 1, k + 1, k + segments + 1, k + segments + 2);
      }
    }
  }
  // Tentacles: thin ribbons hanging from the margin.
  const addStrand = (x0, z0, length, width, part, steps = 8) => {
    const start = positions.length / 3;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      for (const side of [-1, 1]) {
        positions.push(x0 + side * width * (1 - t * 0.7), -0.05 - length * t, z0);
        normals.push(0, 0, 1);
        parts.push(part, t);
      }
      if (s < steps) {
        const k = start + s * 2;
        indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
  };
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    addStrand(Math.cos(a) * 0.97, Math.sin(a) * 0.97, 0.7 + 0.3 * random(), 0.008, 1);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    addStrand(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.9, 0.07, 2, 12);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("jelly", new THREE.Float32BufferAttribute(parts, 2));
  geometry.setIndex(indices);
  const phases = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  phases.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aPulse", phases);

  const material = new THREE.MeshStandardMaterial({ color: 0xdfeff2, roughness: 0.25, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec2 jelly;
        attribute float aPulse;
        varying vec2 vJelly;
        varying vec3 vJellyPoint;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // The bell contracts from the margin in, then relaxes; what hangs from it sways.
        float beat = pow(max(0.0, sin(aPulse)), 3.0);
        if (jelly.x < 0.5) {
          float squeeze = 1.0 - 0.2 * beat * jelly.y;
          transformed.xz *= squeeze;
          transformed.y += 0.06 * beat * jelly.y;
        } else {
          transformed.xz *= 1.0 - 0.15 * beat;
          float t = jelly.y;
          transformed.x += sin(aPulse * 0.5 + t * 4.0 + position.z * 3.0) * 0.12 * t;
          transformed.z += cos(aPulse * 0.4 + t * 3.0 + position.x * 3.0) * 0.12 * t;
        }
        vJelly = jelly;
        vJellyPoint = position;`,
      );
    waterLitShader(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vJelly;\nvarying vec3 vJellyPoint;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.0);
        if (vJelly.x < 0.5) {
          // Four horseshoes of pink seen through the top of the bell.
          float a = atan(vJellyPoint.z, vJellyPoint.x);
          float r = length(vJellyPoint.xz);
          float lobes = pow(abs(cos(a * 2.0)), 3.0);
          float ring = exp(-pow((r - 0.28 - 0.06 * lobes) / 0.05, 2.0)) * smoothstep(0.1, 0.25, r);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.55, 0.7), ring * 0.8);
          diffuseColor.a = 0.12 + 0.55 * rim + ring * 0.45;
        } else if (vJelly.x < 1.5) {
          diffuseColor.a = 0.35 * (1.0 - vJelly.y * 0.7);
        } else {
          diffuseColor.rgb = vec3(0.92, 0.8, 0.86);
          diffuseColor.a = 0.3 * (1.0 - vJelly.y * 0.8);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * 0.18 * (0.5 + rim);`,
      );
  };
  material.customProgramCacheKey = () => "salmon-jelly-v1";
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.name = "Moon jellies";
  mesh.renderOrder = 1;
  mesh.count = 0;
  scene.add(mesh);
  const jellies = Array.from({ length: count }, () => ({ position: new THREE.Vector3(), phase: range(0, 6.28), rate: range(1.2, 2), size: range(1, 2.6), tilt: range(-0.3, 0.3), yaw: range(0, 6.28), alive: false }));
  const object = new THREE.Object3D();
  const weights = {};
  const probe = { s: 0, u: 0 };
  return {
    update(dt, fish, time) {
      regionWeights(fish.river.s, weights);
      const want = Math.round(count * Math.min(1, weights.sea + weights.estuary * 0.6));
      let shown = 0;
      for (let i = 0; i < count; i++) {
        const j = jellies[i];
        if (i >= want) {
          j.alive = false;
          continue;
        }
        const far = j.position.distanceTo(fish.position) > 170;
        if (!j.alive || far) {
          const a = random() * Math.PI * 2;
          const d = range(20, 150);
          j.position.set(fish.position.x + Math.cos(a) * d, 0, fish.position.z + Math.sin(a) * d);
          locate(j.position.x, j.position.z, fish.river.s, probe);
          const lv = level(probe.s),
            floor = bed(probe.s, probe.u);
          if (lv - floor < 6) continue;
          j.position.y = lerp(floor + 3, lv - 2, range(0.2, 0.95));
          j.alive = true;
        }
        j.phase += dt * j.rate * 2;
        // Each beat lifts it a little; between beats it sinks and drifts.
        const beat = Math.pow(Math.max(0, Math.sin(j.phase)), 3);
        j.position.y += (beat * 0.35 - 0.08) * dt * j.size;
        j.position.x += Math.sin(time * 0.05 + i) * 0.1 * dt;
        j.position.z += Math.cos(time * 0.04 + i * 1.3) * 0.1 * dt;
        object.position.copy(j.position);
        object.rotation.set(j.tilt * Math.sin(time * 0.2 + i), j.yaw, j.tilt * Math.cos(time * 0.17 + i));
        object.scale.setScalar(j.size);
        object.updateMatrix();
        mesh.setMatrixAt(shown, object.matrix);
        phases.setX(shown, j.phase);
        shown++;
      }
      mesh.count = shown;
      mesh.instanceMatrix.needsUpdate = true;
      phases.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------------------
// Leaves on the water. In the autumn the river carries the trees' leaves -- birch yellow,
// aspen orange, rowan red -- flat on the surface, and turning slowly down through the
// water once they are soaked; in the spring flood, last year's brown leaves torn from the
// banks.
const LEAF_TINTS = {
  autumn: [
    [0.85, 0.66, 0.12],
    [0.8, 0.5, 0.1],
    [0.78, 0.32, 0.07],
    [0.55, 0.13, 0.06],
    [0.42, 0.28, 0.1],
  ],
  flood: [
    [0.3, 0.2, 0.09],
    [0.36, 0.25, 0.12],
    [0.24, 0.17, 0.08],
  ],
};
function createDebris(scene, { count = 120 } = {}) {
  const random = randomGenerator(8812);
  const range = (a, b) => a + (b - a) * random();
  const outline = new THREE.Shape();
  outline.moveTo(0, 0);
  outline.quadraticCurveTo(0.3, 0.3, 1, 0);
  outline.quadraticCurveTo(0.3, -0.3, 0, 0);
  const geometry = new THREE.ShapeGeometry(outline, 5).rotateX(-Math.PI / 2).translate(-0.5, 0, 0);
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.75 });
  material.onBeforeCompile = (shader) => {
    waterLitShader(shader);
    // Thin leaves glow with the light through them.
    shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.18;");
  };
  material.customProgramCacheKey = () => "salmon-leaf-v2";
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = "Drifting leaves";
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.setColorAt(0, new THREE.Color());
  scene.add(mesh);
  const items = Array.from({ length: count }, () => ({ alive: false, position: new THREE.Vector3(), river: { s: 0, u: 0 }, eta: 1, spin: 0, turn: 0, tilt: 0, size: 0.5, color: new THREE.Color() }));
  const object = new THREE.Object3D();
  const flow = {};
  const at = {};
  const weights = {};
  function drop(item, fish, anywhere, window) {
    const c = conditions;
    for (let tries = 0; tries < 5; tries++) {
      const s = anywhere ? fish.river.s + range(-window.up, window.up * 0.5) : fish.river.s - window.up + range(0, window.up * 0.3);
      const sec = section(Math.min(s, S.coast));
      const u = clamp(fish.river.u + range(-window.side, window.side), sec.thalweg - sec.half * 0.95, sec.thalweg + sec.half * 0.95);
      const floor = bed(s, u);
      const lv = level(s);
      if (lv - floor < 0.3) continue;
      place(s, u, at);
      // Most float; a soaked few are on their way down.
      item.eta = random() < 0.6 ? 1 : range(0.2, 0.95);
      item.position.set(at.x, lerp(floor + 0.05, lv - 0.02, item.eta), at.z);
      item.river.s = s;
      item.river.u = u;
      item.spin = range(0, TAU);
      item.turn = range(-0.6, 0.6);
      item.tilt = range(0, TAU);
      item.size = range(0.45, 1.0);
      const autumn = c.leafFall >= c.flood * 0.5;
      const tints = autumn ? LEAF_TINTS.autumn : LEAF_TINTS.flood;
      item.color.setRGB(...tints[Math.floor(random() * tints.length)]).multiplyScalar(range(0.8, 1.1));
      item.alive = true;
      return;
    }
    item.alive = false;
  }
  return {
    update(dt, fish, time) {
      const c = conditions;
      regionWeights(fish.river.s, weights);
      const river = 1 - weights.sea - weights.estuary * 0.7;
      const want = Math.round(count * clamp(c.leafFall + 0.6 * c.flood, 0, 1) * clamp(river, 0, 1) * (1 - 0.8 * c.ice));
      const L = fish.length;
      const window = { up: clamp(16 + 16 * L, 16, 90), side: clamp(4 + 4 * L, 5, 40) };
      let shown = 0;
      for (let i = 0; i < count; i++) {
        const item = items[i];
        if (!item.alive) {
          if (i < want && random() < 0.08) drop(item, fish, mesh.count === 0 && i < want * 0.8, window);
          if (!item.alive) continue;
        }
        const { position, river: r } = item;
        locate(position.x, position.z, r.s, r);
        current(r.s, r.u, position.y, flow, time);
        position.x += flow.vx * 0.9 * dt;
        position.z += flow.vz * 0.9 * dt;
        const lv = level(r.s);
        const floor = bed(r.s, r.u);
        if (item.eta < 1) item.eta = Math.max(0, item.eta - 0.012 * dt);
        // Just under the film (the surface's waves would hide anything closer to it).
        position.y = item.eta >= 1 ? lv - 0.07 : lerp(floor + 0.03, lv - 0.1, item.eta);
        item.spin += item.turn * dt;
        const behind = r.s - fish.river.s;
        if (behind > window.up * 0.6 || lv - floor < 0.15 || Math.abs(r.u - fish.river.u) > window.side * 1.8 || (i >= want && behind > 4)) {
          item.alive = false;
          continue;
        }
        object.position.copy(position);
        const sinking = item.eta < 1 ? 1 : 0;
        object.rotation.set(sinking * Math.sin(time * 0.9 + item.tilt) * 0.9, item.spin, sinking * Math.cos(time * 0.7 + item.tilt) * 0.6);
        object.scale.setScalar(item.size);
        object.updateMatrix();
        mesh.setMatrixAt(shown, object.matrix);
        mesh.setColorAt(shown, item.color);
        shown++;
      }
      mesh.count = shown;
      mesh.visible = shown > 0;
      if (shown) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, shown * 16);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, shown * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------
export function createLife(scene, { detail = true, terrain, salmon }) {
  const food = createFood(scene, { count: detail ? 260 : 180 });
  const brawls = createBrawls(randomGenerator(5507));
  const shoals = createShoals(scene, { detail, brawls });
  const hunters = createHunters(scene, { detail });
  const motes = createMotes(scene, { count: detail ? 2600 : 1600 });
  const jellies = createJellies(scene);
  const debris = createDebris(scene);
  const rivals = createRivals(scene, { random: randomGenerator(4421) });
  const school = createSchool(scene, { random: randomGenerator(9912), brawls });
  // The run home: grown salmon going up the river in late summer and autumn.
  const run = createSchool(scene, {
    random: randomGenerator(7719),
    brawls,
    coat: "spawner",
    count: 10,
    title: "Laichlachs",
    kind: "spawnerRun",
    when: (fish, w) => phaseOf(fish.stage) === "spawner" && w.sea + w.estuary < 0.4 && fish.river.s > 400 && fish.progress < 0.97,
  });
  const aim = { position: null, distance: Infinity, ahead: 0 };
  let travel = 1;
  const at = {};
  return {
    meshes: [...shoals.meshes, ...hunters.meshes, ...rivals.meshes, ...school.meshes, ...run.meshes],
    rivals,
    school,
    run,
    food,
    shoals,
    hunters,
    motes,
    setScale(value) {
      food.haloMaterial.uniforms.scale.value = value;
      food.markMaterial.uniforms.scale.value = value;
      motes.material.uniforms.scale.value = value;
    },
    light(value) {
      food.glow.value = 0.175 * value + 0.05;
      food.haloMaterial.uniforms.light.value = value;
      motes.material.uniforms.light.value = 0.25 + 0.75 * value;
    },
    reset(fish) {
      food.reset(fish);
      shoals.reset(fish);
      hunters.reset(fish);
      rivals.reset();
      school.reset();
      run.reset();
      brawls.reset();
    },
    // `drive`: the lead of the smolt school while the goosanders drive it (drive.js), or null.
    // `ball`: the bait ball at sea (baitball.js), or null.
    update(dt, { fish, salmon: s, time, world, camera, above, drive = null, ball = null }) {
      eddies = world?.eddies?.ready ? world.eddies : null;
      prof.mark("life:pre");
      if (camera) motes.update(dt, camera.position, fish.river.s, fish.length, time, above);
      prof.mark("life:motes");
      jellies.update(dt, fish, time);
      debris.update(dt, fish, time);
      prof.mark("life:jellies+debris");
      frame(fish.river.s, at);
      const along = fish.velocity.x * at.tx + fish.velocity.z * at.tz;
      if (Math.abs(along) > 0.3) travel = Math.sign(along);
      brawls.begin(time);
      const rivalEvents = rivals.update(dt, fish, { travel, food: food.items });
      prof.mark("life:rivals");
      school.update(dt, fish, time, drive ? null : food.items, drive);
      // (a goosander of the drive diving into the school takes one of them)
      if (drive) drive.take ??= (at) => school.take(at);
      run.update(dt, fish, time);
      prof.mark("life:schools");
      let eaten = shoals.update(dt, fish, salmon, time, travel, aim);
      prof.mark("life:shoals");
      // More drifts past a spot the fish holds as its own, and down a rich riffle.
      eaten += food.update(dt, fish, salmon, time, (rivals.territory.inside ? 1 : 0) + 0.9 * (world.rich ?? 0), aim);
      prof.mark("life:food");
      // A hunter striking into a school, or into a bait ball the fish is in, often takes one
      // of them instead.
      const schoolDecoy = school.count + run.count > 0 ? (at) => (school.count > 0 && school.decoy(at, fish, drive ? (fish.position.distanceTo(drive.position) < drive.radius ? 1 : 0.6) : 0.75, drive ? 6 : 5)) || (run.count > 0 && run.decoy(at, fish)) : null;
      const ballDecoy = ball && fish.position.distanceTo(ball.centre) < ball.radius + 2 + fish.length ? (at) => Math.random() < 0.6 && shoals.take(ball.kind, at, 4 + fish.length) : null;
      const decoy = schoolDecoy && ballDecoy ? (at) => schoolDecoy(at) || ballDecoy(at) : (schoolDecoy ?? ballDecoy);
      const outcome = hunters.update(dt, fish, time, travel, world.covered, s?.speeds?.().cruise ?? 1, decoy, world.occluded ?? null, world.rich ?? 0, drive);
      // The fish being fought, for the bar over it: a hunter, or a young salmon holding a spot.
      prof.mark("life:hunters");
      let foe = null;
      for (const f of [hunters.foe(fish), rivals.foe(fish), brawls.foe(fish)]) if (f && (!foe || f.score > foe.score)) foe = f;
      // Blows on the other fish, and their nips back.
      outcome.hits.push(...brawls.hits);
      return { eaten, rises: food.rises, rivals: rivalEvents, territory: rivals.territory, school: school.count, run: run.count, foe, threatened: hunters.threat(fish), nips: brawls.nips, ...outcome };
    },
    // A word at the foot of a fall, the first few times.
    leapHint(fish) {
      for (const f of FALLS) {
        if (f.head) continue;
        const d = fish.river.s - f.s;
        if (f.pass && d > -0.2 && d < f.poolLength + 6)
          return "Fischtreppe: Schwimm durch den weißen Schlitz in der Stufe – oder an der Oberfläche mit <kbd>Leertaste</kbd> drüberspringen";
        if (d > -0.2 && d < f.poolLength && fish.length * 3 > f.drop * 0.8)
          return "An die Oberfläche, Anlauf nehmen, <kbd>Leertaste</kbd>: über den Fall springen";
      }
      return null;
    },
  };
}
