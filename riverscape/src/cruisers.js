import * as THREE from "three";
import { bedHeight as groundHeight, randomGenerator } from "./math.js";
import { CRUISER_BOUNDS, SURFACE_Y } from "./layout.js";
import { shelteredVelocity } from "./water.js";
import { createFishMaterials, flattenEyes, makeAnatomy, SNOUT_X } from "./fish-anatomy.js";
import { applySwimming } from "./fish.js";

// Piraputanga, Brycon hilarii: the big silver characins of the clear spring rivers,
// twenty to thirty centimetres long, travelling the run in a loose group. They are the
// river's scale: the tetras are a hand's width, these are an arm's length.
//
// Their day is slow. They hold station in the current behind the snag and the big stones,
// tails beating lazily to stay in place; then one drifts off and the rest follow, cruising
// up or down the run, out of sight and back. They are curious about a still hand and
// wary of a fast one. And they are fruit and insect eaters that take food from the
// surface: when pellets land, one will rise and take one off the film with a swirl that
// rings out across the surface.
//
// Their body is the same characin anatomy the tetras are built on -- Brycon is a close
// relative and shares the plan -- drawn seven times larger with its own colouring, and
// driven by the same travelling-wave spine.

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(1, 0, 0);

const SWIM = {
  cruise: [1.1, 1.7],
  hold: 0.25,
  flee: 5.5,
  turnRate: 0.75,
  fleeTurn: 2.4,
  response: 0.9,
  lateral: 2.5,
};
const HOLD = { duration: [8, 22], lee: 0.7 };
// The big fish of the river. Piraputanga cruise in a group and rise to food; the dourado,
// Salminus brasiliensis -- the golden river predator of the same family, the fish the
// clear rivers are famous for -- patrols alone or in a pair, and every minute or two makes
// a run at the tetras, which is what the shoal's alarm is for.
const SPECIES = {
  brycon: {
    seed: 990127,
    name: "Piraputanga",
    define: null,
    count: [5, 6],
    scale: [4.3, 5.4],
    stretch: [1.08, 0.96, 1.0],
    cruise: [1.1, 1.7],
    feeds: true,
    iridescence: 0.25,
  },
  salminus: {
    seed: 441709,
    name: "Dourado",
    define: "FISH_SALMINUS",
    count: [2, 2],
    scale: [7.2, 8.6],
    stretch: [1.2, 0.9, 0.95],
    cruise: [1.3, 2.0],
    feeds: false,
    iridescence: 0.35,
  },
};
// A dourado's run at the shoal: how often, how fast, and for how long.
const HUNT = { interval: [45, 100], speed: 6.5, duration: 1.7, range: 16 };
const WARY = { range: 7, looming: 0.8, zone: 3.2 };
const CURIOUS = { stillness: 2.2, range: 11, rate: 0.05, standoff: 3 };
const FEED = { range: 9, rate: 0.9, reach: 0.45 };

export function createCruisers(
  scene,
  { obstacles = [], flow = null, food = null, ripples = null, particles = null, detail = false, species = "brycon", prey = () => [] } = {},
) {
  const kind = SPECIES[species] ?? SPECIES.brycon;
  const random = randomGenerator(kind.seed);
  const range = (a, b) => a + (b - a) * random();
  const COUNT = detail ? kind.count[1] : kind.count[0];
  const geometry = makeAnatomy();
  flattenEyes(geometry.body, 0.7);
  const swimAttribute = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 4), 4);
  const finAttribute = new THREE.InstancedBufferAttribute(new Float32Array(COUNT), 1);
  swimAttribute.setUsage(THREE.DynamicDrawUsage);
  finAttribute.setUsage(THREE.DynamicDrawUsage);
  for (const part of [geometry.body, geometry.fins]) {
    part.setAttribute("aSwim", swimAttribute);
    part.setAttribute("aFinPhase", finAttribute);
  }
  const { skin, fins } = createFishMaterials();
  skin.defines.FISH_BRYCON = "";
  fins.defines.FISH_BRYCON = "";
  if (kind.define) skin.defines[kind.define] = fins.defines[kind.define] = "";
  skin.iridescence = kind.iridescence;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  applySwimming(skin);
  applySwimming(fins);
  applySwimming(depth, false);
  const bodies = new THREE.InstancedMesh(geometry.body, skin, COUNT);
  const membranes = new THREE.InstancedMesh(geometry.fins, fins, COUNT);
  bodies.name = kind.name;
  membranes.name = `${kind.name} fins`;
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  bodies.customDepthMaterial = depth;
  for (const mesh of [bodies, membranes]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  scene.add(bodies, membranes);

  const B = CRUISER_BOUNDS;
  const fish = Array.from({ length: COUNT }, (_, id) => {
    const position = new THREE.Vector3(range(-18, 14), range(4, 8), range(-15, -8));
    const yaw = random() < 0.7 ? Math.PI + range(-0.3, 0.3) : range(-0.3, 0.3);
    return {
      id,
      position,
      velocity: new THREE.Vector3(),
      swim: new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(0.6),
      heading: new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)),
      goal: position.clone(),
      mode: "cruise",
      until: range(2, 10),
      speed: range(kind.cruise[0], kind.cruise[1]),
      scale: range(kind.scale[0], kind.scale[1]),
      nextHunt: range(HUNT.interval[0], HUNT.interval[1]) * 0.5,
      phase: range(0, TAU),
      finPhase: range(0, TAU),
      bend: 0,
      effort: 0.3,
      yawRate: 0,
      alarm: 0,
      pellet: null,
      creature: { position, velocity: null, radius: 1.5 },
    };
  });
  for (const f of fish) {
    f.creature.velocity = f.velocity;
    f.creature.radius = 0.3 * f.scale;
  }
  let leader = fish[0];
  let clock = 0;

  const water = new THREE.Vector3();
  const stir = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const away = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const mouth = new THREE.Vector3();
  const lateral = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const bank = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const splash = new THREE.Vector3();

  function pickGoal(f) {
    // Along the run, mostly: far up or down it, out of the picture and back again, with
    // the group keeping loosely to its leader.
    if (f === leader || random() < 0.25) {
      const side = f.position.x > 0 ? -1 : 1;
      f.goal.set(
        side * range(8, 32) + range(-4, 4),
        range(B.minY + 1, B.maxY - 0.5),
        range(B.minZ, B.maxZ),
      );
    } else {
      f.goal.copy(leader.goal).add(delta.set(range(-3, 3), range(-1.5, 1.5), range(-2.5, 2.5)));
    }
    f.goal.x = THREE.MathUtils.clamp(f.goal.x, B.minX, B.maxX);
    f.goal.y = THREE.MathUtils.clamp(f.goal.y, B.minY, B.maxY);
    f.goal.z = THREE.MathUtils.clamp(f.goal.z, B.minZ, B.maxZ);
    f.speed = range(kind.cruise[0], kind.cruise[1]);
  }

  function decide(f) {
    if (f.mode === "cruise" && random() < 0.45) {
      // Hold station: nose into the current, somewhere sheltered in mid-water.
      f.mode = "hold";
      f.until = clock + range(HOLD.duration[0], HOLD.duration[1]);
      f.goal.copy(f.position);
      return;
    }
    f.mode = "cruise";
    f.until = clock + range(12, 30);
    if (random() < 0.3) leader = f;
    pickGoal(f);
  }

  for (const f of fish) pickGoal(f);

  function update(dt, time, pointer, viewer = null) {
    clock += dt;
    for (const f of fish) {
      const { position, heading, swim } = f;
      shelteredVelocity(position, time, water);
      if (flow) water.add(flow.sample(position, stir));
      f.alarm *= Math.exp(-dt / 20);

      // A hand: fast and close is a threat; still and near is worth a look.
      if (pointer) {
        delta.subVectors(pointer.position, position);
        const d = delta.length();
        const looming = d > 1e-3 ? -pointer.velocity.dot(delta) / (d * Math.max(d, 1)) : 0;
        if (d < WARY.range && looming > WARY.looming * (1 + f.alarm) && f.mode !== "flee") {
          f.mode = "flee";
          f.until = clock + range(1.6, 2.6);
          f.alarm += 1;
          away.copy(delta).multiplyScalar(-1 / Math.max(d, 1e-3));
          away.y *= 0.3;
          f.goal.copy(position).addScaledVector(away.normalize(), 12);
          f.pellet = null;
          if (flow) flow.inject(position, away.multiplyScalar(4), 2.2, 0.8);
          if (particles && position.y - groundHeight(position.x, position.z) < 2)
            particles.puff(position, 18, 0.8, 0.6);
        } else if (
          f.mode === "hold" &&
          (pointer.still ?? 0) > CURIOUS.stillness &&
          d < CURIOUS.range &&
          f.alarm < 0.5 &&
          random() < dt * CURIOUS.rate
        ) {
          f.mode = "inspect";
          f.until = clock + range(6, 12);
        }
        if (f.mode === "inspect")
          f.goal.copy(pointer.position).addScaledVector(delta.normalize(), -CURIOUS.standoff);
      } else if (f.mode === "inspect") f.until = 0;

      // The dourado's run: at the middle of the nearest knot of small fish, flat out.
      if (!kind.feeds && f.mode !== "flee" && f.mode !== "hunt" && clock >= f.nextHunt) {
        const fishes = prey();
        let target = null,
          best = HUNT.range * HUNT.range;
        for (const small of fishes) {
          const d = small.position.distanceToSquared(position);
          if (d < best && d > 4) {
            best = d;
            target = small;
          }
        }
        f.nextHunt = clock + range(HUNT.interval[0], HUNT.interval[1]);
        if (target) {
          f.mode = "hunt";
          f.until = clock + HUNT.duration;
          f.goal.copy(target.position).addScaledVector(delta.subVectors(target.position, position).normalize(), 3);
        }
      }
      // Food on the film or sinking through the water: a calm fish rises for it.
      if (kind.feeds && food && !f.pellet && f.mode !== "flee" && f.alarm < 0.6) {
        for (const pellet of food.pellets) {
          if (pellet.gone) continue;
          if (pellet.position.distanceToSquared(position) > FEED.range * FEED.range) continue;
          if (random() < dt * FEED.rate) {
            f.pellet = pellet;
            f.mode = "feed";
            f.until = clock + 8;
          }
          break;
        }
      }
      if (f.pellet && (f.pellet.gone || f.mode !== "feed")) {
        f.pellet = null;
        if (f.mode === "feed") f.until = 0;
      }

      if (clock >= f.until) decide(f);

      // What the fish wants to do in the water, before the current is taken off.
      let speed = f.speed;
      if (f.mode === "hold") {
        desired.subVectors(f.goal, position).multiplyScalar(0.4).clampLength(0, SWIM.hold);
      } else if (f.mode === "feed" && f.pellet) {
        mouth.copy(position).addScaledVector(heading, SNOUT_X * f.scale);
        desired.subVectors(f.pellet.position, mouth);
        const d = desired.length();
        speed = Math.min(3.2, 0.8 + d * 0.8);
        desired.setLength(speed);
        if (d < FEED.reach * f.scale * 0.1 + 0.25) {
          if (food.take(f.pellet)) {
            // A swirl at the film as the pellet goes.
            if (ripples && f.pellet.position.y > SURFACE_Y - 1.2) {
              ripples.add(f.pellet.position.x, f.pellet.position.z, 1.4);
              if (particles)
                for (let i = 0; i < 5; i++)
                  particles.bubble(splash.copy(f.pellet.position).add(delta.set(range(-0.3, 0.3), range(-0.6, -0.1), range(-0.3, 0.3))), range(0.015, 0.035));
            }
            if (flow) flow.inject(mouth, delta.copy(heading).multiplyScalar(2.5), 1.4, 0.6);
          }
          f.pellet = null;
          f.mode = "cruise";
          f.until = clock + range(3, 8);
          pickGoal(f);
        }
      } else {
        if (f.mode === "flee") speed = SWIM.flee;
        else if (f.mode === "hunt") speed = HUNT.speed;
        else if (f.mode === "inspect") speed = 0.9;
        desired.subVectors(f.goal, position);
        const remaining = desired.length();
        if (f.mode === "cruise" && remaining < 2) {
          f.until = 0;
          desired.set(0, 0, 0);
        } else desired.multiplyScalar(Math.min(speed, remaining * 0.6) / Math.max(remaining, 1e-3));
      }

      // Keep apart, keep off the bed, the stones and the wood.
      for (const other of fish) {
        if (other === f) continue;
        delta.subVectors(position, other.position);
        const d = delta.length();
        const room = 0.45 * (f.scale + other.scale);
        if (d < room && d > 1e-3) desired.addScaledVector(delta, ((room - d) / d) * 0.9);
      }
      for (const obstacle of obstacles) {
        delta.subVectors(position, obstacle.center);
        const d = delta.length();
        const room = obstacle.radius + 0.25 * f.scale;
        if (d < room + 1.2 && d > 1e-3) desired.addScaledVector(delta, ((room + 1.2 - d) / d) * 1.2);
      }
      // And off the viewer: a big fish turns aside rather than swim into the lens.
      if (viewer) {
        delta.subVectors(position, viewer);
        const d = delta.length();
        const room = 6 + 0.5 * f.scale;
        if (d < room && d > 1e-3) desired.addScaledVector(delta, ((room - d) / d) * 1.4);
      }
      const floor = groundHeight(position.x, position.z) + 0.1 * f.scale + 0.6;
      if (position.y < floor + 1) desired.y += (floor + 1 - position.y) * 1.2;
      if (position.y > B.maxY) desired.y -= (position.y - B.maxY) * 1.5;
      if (position.z > B.maxZ) desired.z -= (position.z - B.maxZ) * 1.2;
      if (position.z < B.minZ) desired.z += (B.minZ - position.z) * 1.2;

      // Holding in a current means swimming into it; everything else is relative to it.
      desired.sub(water);
      const wanted = desired.length();

      // Turn toward what is wanted at a rate a big body can manage.
      const rate = f.mode === "flee" || f.mode === "hunt" ? SWIM.fleeTurn : SWIM.turnRate;
      if (wanted > 0.05) {
        const yaw = Math.atan2(heading.z, heading.x);
        const target = Math.atan2(desired.z, desired.x);
        const error = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
        f.yawRate = THREE.MathUtils.lerp(f.yawRate, THREE.MathUtils.clamp(error * 1.6, -rate, rate), 1 - Math.exp(-dt * 3));
        const pitch = THREE.MathUtils.lerp(
          Math.asin(THREE.MathUtils.clamp(heading.y, -1, 1)),
          Math.asin(THREE.MathUtils.clamp(desired.y / wanted, -0.5, 0.5)),
          1 - Math.exp(-dt * 1.5),
        );
        const nextYaw = yaw + f.yawRate * dt;
        heading.set(Math.cos(nextYaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(nextYaw) * Math.cos(pitch));
      } else f.yawRate *= Math.exp(-dt * 2);

      // Thrust along the body; the water resists sideways motion far more than forward.
      const forward = Math.max(0, desired.dot(heading));
      const thrust = (forward - swim.dot(heading)) / SWIM.response;
      swim.addScaledVector(heading, thrust * dt);
      lateral.copy(swim).addScaledVector(heading, -swim.dot(heading));
      swim.addScaledVector(lateral, -(1 - Math.exp(-dt * SWIM.lateral)));
      swim.multiplyScalar(1 / (1 + dt * 0.25));
      f.velocity.copy(swim).add(water);
      position.addScaledVector(f.velocity, dt);
      position.x = THREE.MathUtils.clamp(position.x, B.minX - 4, B.maxX + 4);
      position.y = Math.max(position.y, floor);

      // The body: a slow, deep tail beat whose rate follows the speed through the water,
      // and a bend that follows the turn.
      const through = swim.length();
      const effort = THREE.MathUtils.clamp(0.25 + through * 0.3 + Math.max(0, thrust) * 0.15, 0, 1);
      f.effort = THREE.MathUtils.lerp(f.effort, effort, 1 - Math.exp(-dt * 4));
      const frequency = 0.9 + through * 0.9;
      f.phase = (f.phase + dt * TAU * frequency) % TAU;
      f.finPhase = (f.finPhase + dt * TAU * (1.2 + f.effort)) % TAU;
      const curvature = THREE.MathUtils.clamp(f.yawRate / Math.max(through, 0.6), -1.6, 1.6);
      f.bend = THREE.MathUtils.lerp(f.bend, curvature, 1 - Math.exp(-dt * 4));
      swimAttribute.setXYZW(f.id, f.phase, (0.28 + 0.42 * f.effort) * 0.9, -f.bend, f.mode === "hold" ? 0.5 : 0.1);
      finAttribute.setX(f.id, f.finPhase);

      // Their wake parts the grass and stirs the drift like no tetra can.
      if (flow) flow.inject(position, swim, 0.2 * f.scale, f.mode === "hunt" ? 0.5 : 0.28);

      axisZ.crossVectors(heading, UP).normalize();
      axisY.crossVectors(axisZ, heading).normalize();
      basis.makeBasis(heading, axisY, axisZ);
      quaternion.setFromRotationMatrix(basis);
      bank.setFromAxisAngle(FORWARD, -THREE.MathUtils.clamp(f.bend, -1.5, 1.5) * 0.1);
      quaternion.multiply(bank);
      scale.set(f.scale * kind.stretch[0], f.scale * kind.stretch[1], f.scale * kind.stretch[2]);
      matrix.compose(position, quaternion, scale);
      bodies.setMatrixAt(f.id, matrix);
      membranes.setMatrixAt(f.id, matrix);
    }
    bodies.instanceMatrix.needsUpdate = true;
    membranes.instanceMatrix.needsUpdate = true;
    swimAttribute.needsUpdate = true;
    finAttribute.needsUpdate = true;
  }

  update(0, 0, null);
  return {
    update,
    fish,
    creatures: fish.map((f) => f.creature),
    meshes: [bodies, membranes],
  };
}
