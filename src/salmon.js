import * as THREE from "three";
import { COATS, MODEL_LENGTH, blendCoat, coatUniforms, createFishMesh } from "./anatomy.js";
import { FALLS, S, bed, current, frame, level, locate, section } from "./course.js";

// The salmon you are, from the day it hatches to the day it spawns.
//
// Its life is ten stages in six phases. Within each stage the fish grows in length in step
// with the bar that fills as it grows, and when the bar is full it becomes the next thing:
//
//   Dottersackbrut   an alevin in the gravel, living off its yolk; it grows with time alone
//   Brütling         the fry, out of the gravel, snapping drift from the current
//   Sömmerling       its first summer: a finger long, the parr marks coming
//   Jährling         a year old, marked, territorial, eating everything that drifts by
//   Parr             the second river year, a hand long
//   Smolt            silvered for the sea; it grows little until it gets there
//   Postsmolt        the first months at sea
//   Grilse           a year at sea, strong enough to come home -- but not yet
//   Meerlachs        the big sea salmon, hunting herring
//   Laichlachs       home again, up the river it came down, eating nothing, living on its
//                    fat while its body turns red and its jaw hooks; ready to spawn when
//                    the bar is full and it has reached the redd it hatched in
//
// Growth takes food and time: what is eaten goes to the stomach, and the stomach is
// digested only so fast. A hungry fish grows nothing; what it digests goes to its strength
// first. Everything it does costs strength, measured against the water: holding still in
// a current costs as much as swimming, swimming against it more, riding it almost nothing.
//
// Controls: W swims; let go and it drifts; S brakes against the
// ground (the fish backs its fins and holds its place if it can); A and D slide it sideways;
// the mouse turns it. Space lunges, and at the surface leaps -- clean out of the water, or
// up a fall if it is big enough and strong enough.

// `minutes` is the shortest a stage can take (a stomach kept full all the way); a fish that
// forages as it goes keeps its stomach half to three quarters full and takes a good deal
// longer -- some five to ten minutes a stage (the smolt's is its journey down to the sea,
// the spawner's its journey home). `rate` is how
// much a fish of this size can digest a second (and so how much food it takes to keep it
// full); `rich` is what a morsel is worth to this stage's growth -- the smallest fish,
// which can take only the smallest drift, most of all. `sea`: it grows only at sea.
// `phase` is the broad part of its life the other creatures go by.
export const STAGES = [
  { id: "alevin", phase: "alevin", name: "Dottersackbrut", body: "alevin", coat: "alevin", length: [0.22, 0.3], minutes: 3.5, yolk: true },
  { id: "fry", phase: "fry", name: "Brütling", body: "parr", coat: "fry", length: [0.3, 0.45], minutes: 3, rate: 0.33, rich: 2.8 },
  { id: "fingerling", phase: "fry", name: "Sömmerling", body: "parr", coat: "fry", length: [0.45, 0.65], minutes: 3.5, rate: 0.45, rich: 2.6 },
  { id: "yearling", phase: "parr", name: "Jährling", body: "parr", coat: "parr", length: [0.65, 1.0], minutes: 4, rate: 0.8, rich: 2.1 },
  { id: "parr", phase: "parr", name: "Parr", body: "parr", coat: "parr", length: [1.0, 1.4], minutes: 4, rate: 1.1, rich: 2 },
  { id: "smolt", phase: "smolt", name: "Smolt", body: "salmon", coat: "smolt", length: [1.4, 2.0], minutes: 7, rate: 1.35, sea: true, rich: 1.8 },
  { id: "postsmolt", phase: "sea", name: "Postsmolt", body: "salmon", coat: "sea", length: [2.0, 3.2], minutes: 4.5, rate: 3.2, sea: true, rich: 1.4 },
  { id: "grilse", phase: "sea", name: "Grilse", body: "salmon", coat: "sea", length: [3.2, 5.5], minutes: 4, rate: 3.5, sea: true, rich: 1.3 },
  { id: "sea", phase: "sea", name: "Meerlachs", body: "salmon", coat: "sea", length: [5.5, 8.5], minutes: 7, rate: 10, sea: true, rich: 1.3 },
  { id: "spawner", phase: "spawner", name: "Laichlachs", body: "salmon", coat: "spawner", length: [8.5, 9], minutes: 35, fasting: true },
];
for (const st of STAGES) if (st.rate) st.need = st.rate * st.minutes * 60;
// The index of the first stage of a phase, and a stage's phase.
export function stageOf(id) {
  const exact = STAGES.findIndex((st) => st.id === id);
  return exact >= 0 ? exact : STAGES.findIndex((st) => st.phase === id);
}
export const phaseOf = (index) => STAGES[Math.max(0, Math.min(STAGES.length - 1, index))].phase;
// A full stomach takes this long to empty at the stage's fastest digestion; digestion runs
// in proportion to what is in it, so a half-full stomach empties half as fast.
const STOMACH_SECONDS = 150;
// How long a feeding fish can go with an empty stomach before its body starts to waste.
const HUNGER_SECONDS = 90;

export const GRAVITY = 98; // units per second squared: 9.8 m/s² at ten centimetres a unit

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(1, 0, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const frameScratch = {};
const frameAt = (s) => frame(s, frameScratch);

// Speeds scale with body length as they do in salmon: a bigger fish is faster through the
// water, but covers fewer of its own lengths a second. Two gears:
//   cruise  swimming (W): a 3 cm fry some 5 lengths a second, an 85 cm salmon about
//           1.4 m/s, well under two lengths
//   burst   a second or two on white muscle (Space): a lunge, a strike (a fry 14 lengths a
//           second, a big salmon 4-5 m/s)
// `sprint` is only a yardstick for how hard the fish is working (its swimming wave);
// `leap` is the speed the leap out of the water is tuned to, kept as it was.
export function speeds(length) {
  const cruise = 3.4 * Math.pow(length, 0.645);
  return {
    cruise,
    sprint: cruise * 1.8,
    burst: 10 * Math.pow(length, 0.7),
    leap: 2.6 * (1.3 * length + 0.5),
    turn: clamp(4.2 / Math.sqrt(length + 0.3), 1.2, 5),
  };
}

// Metabolism per unit of body: small fish burn through their reserves fast and must eat
// often (a fry eats a large share of its own weight a day), a big salmon lives long on what
// it has. Mass-specific metabolic rate falls with size; here relative to a smolt.
export function metabolism(length) {
  return clamp(Math.pow(length / 1.5, -0.45), 0.4, 1.7);
}

export function createSalmon(scene, { pace = 1 } = {}) {
  const coat = coatUniforms(COATS.alevin);
  let meshes = null;
  let bodyKind = null;
  function wear(kind) {
    if (bodyKind === kind) return;
    if (meshes) {
      for (const mesh of [meshes.body, meshes.membranes]) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
    }
    meshes = createFishMesh(scene, kind, COATS.alevin, 1, { name: "Salmon", uniforms: coat, cacheKey: `player-${kind}` });
    bodyKind = kind;
  }

  const f = {
    stage: 0,
    progress: 0,
    energy: 1,
    // Breath for bursts (0..1), and whether it is spent.
    breath: 1,
    winded: false,
    stomach: 0,
    length: STAGES[0].length[0],
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(), // over the ground
    relative: new THREE.Vector3(), // through the water
    heading: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    pitch: 0,
    roll: 0,
    yawRate: 0,
    river: { s: S.redd, u: 0 },
    flow: { vx: 0, vy: 0, vz: 0, speed: 0 },
    airborne: false,
    exhausted: false,
    lungeCool: 0,
    lunging: 0,
    lungeCount: 0,
    phase: 0,
    finPhase: 0,
    bend: 0,
    mouth: new THREE.Vector3(),
    // What happened this step, for the rest of the game to react to.
    events: [],
    depthBelowSurface: 0,
    hidden: false,
    leapTarget: null,
  };

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const bank = new THREE.Quaternion();
  const basis = new THREE.Matrix4();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const target = new THREE.Vector3();
  const side = new THREE.Vector3();
  const push = new THREE.Vector3();
  const strikeDir = new THREE.Vector3();
  const lungeDir = new THREE.Vector3();
  const probe = { s: 0, u: 0 };

  function stage() {
    return STAGES[f.stage];
  }
  function lengthNow() {
    const [a, b] = stage().length;
    return a + (b - a) * clamp(f.progress, 0, 1);
  }
  // Body height, for clearances: a salmon is about a fifth as deep as it is long.
  const height = () => f.length * 0.22;

  function dress() {
    const st = stage();
    wear(st.body);
    const next = STAGES[Math.min(STAGES.length - 1, f.stage + 1)];
    // The last stretch of each stage already shows the next coat coming.
    if (st.fasting) {
      // Home from the sea still silver; the spawning colours come as it ripens in the river.
      blendCoat(coat, COATS.sea, COATS.spawner, clamp(f.progress * 1.25, 0, 1));
    } else {
      const t = f.stage < STAGES.length - 1 ? clamp((f.progress - 0.82) / 0.18, 0, 1) * 0.6 : 0;
      blendCoat(coat, COATS[st.coat], COATS[next.coat], t);
    }
    coat.coat_yolk.value = st.yolk ? 1 - f.progress : 0;
    coat.coat_hump.value = st.fasting ? f.progress : 0;
    coat.coat_kype.value = st.fasting ? f.progress : 0;
  }

  function place(position, yaw) {
    f.captive = false;
    f.shrink = 0;
    f.breath = 1;
    f.winded = false;
    f.position.copy(position);
    f.yaw = yaw;
    f.pitch = 0;
    f.heading.set(Math.cos(yaw), 0, Math.sin(yaw));
    f.velocity.set(0, 0, 0);
    f.relative.set(0, 0, 0);
    f.airborne = false;
    locate(position.x, position.z, null, f.river);
  }

  function setStage(index, progress = 0) {
    f.stage = clamp(index, 0, STAGES.length - 1);
    f.progress = progress;
    f.length = lengthNow();
    dress();
  }

  // Food: `nutrition` in the game's units. Returns what it was worth to the bar.
  function eat(nutrition, kind = null) {
    const st = stage();
    if (st.fasting) {
      // A spawner snaps from habit or anger; it hardly feeds.
      f.energy = Math.min(1, f.energy + 0.002);
      f.events.push({ type: "snap", kind });
      return 0;
    }
    if (st.yolk) {
      // Still on its yolk, but the first midge larvae already count: each one brings the
      // day it leaves the gravel a little nearer.
      f.progress += nutrition / 110;
      f.energy = Math.min(1, f.energy + 0.03 * nutrition);
      f.gulp = 0.22;
      f.events.push({ type: "eat", nutrition, kind });
      return nutrition;
    }
    const rate = st.need / (st.minutes * 60);
    const capacity = rate * STOMACH_SECONDS;
    const room = Math.max(0, capacity - f.stomach);
    nutrition *= st.rich ?? 1;
    const taken = Math.min(nutrition, room + nutrition * 0.2);
    f.stomach = Math.min(capacity, f.stomach + taken);
    // Something in the stomach is strength at once.
    f.energy = Math.min(1, f.energy + Math.min(0.35, (0.0065 * taken) / rate));
    f.gulp = 0.22;
    f.events.push({ type: "eat", nutrition: taken, kind });
    return taken;
  }
  // Caught: held by a hunter at `position`, facing `heading`, thrashing; `shrink` 0..1 as it
  // disappears down a throat.
  const HELD = { forward: false, brake: false, strafe: 0 };
  function captive(dt, position, heading, shrink) {
    f.captive = true;
    f.shrink = shrink;
    f.airborne = false;
    f.velocity.set(0, 0, 0);
    f.relative.set(0, 0, 0);
    f.position.copy(position);
    f.heading.copy(heading).normalize();
    f.yaw = Math.atan2(f.heading.z, f.heading.x);
    f.pitch = Math.asin(clamp(f.heading.y, -1, 1));
    f.lunging = 0.3;
    f.striking = 0;
    locate(f.position.x, f.position.z, f.river.s, f.river);
    pose(dt, speeds(f.length), HELD);
  }
  // How full the stomach is (0..1), and what it holds as a share of the stage's growth.
  function appetite() {
    const st = stage();
    if (st.yolk) return { full: 1 - f.progress, pending: 0 };
    if (st.fasting) return { full: null, pending: 0 };
    const capacity = (st.need / (st.minutes * 60)) * STOMACH_SECONDS;
    return { full: f.stomach / capacity, pending: f.stomach / st.need };
  }

  // One step. `input`: yaw and pitch wanted, forward, brake, strafe, lunge; `world`
  // gives collisions: stones near the fish (x, y, z, r, ry) and whether it is in cover.
  function update(dt, input, world) {
    f.events.length = 0;
    const st = stage();
    f.length = lengthNow();
    const L = f.length;
    const H = height();
    const sp = speeds(L);
    // The water's temperature: cold slows a cold-blooded body down, warmth past what a
    // salmon can bear wears it out.
    const thermal = world.thermal ?? { pace: 1, heat: 0 };
    const chill = (0.8 + 0.2 * thermal.pace) * (1 - 0.15 * thermal.heat);
    sp.cruise *= chill;
    sp.burst *= chill;
    locate(f.position.x, f.position.z, f.river.s, f.river);
    const s = f.river.s,
      u = f.river.u;
    const surface = level(s);
    const floor = bed(s, u);
    current(s, u, f.position.y, f.flow, world.time);
    f.depthBelowSurface = surface - f.position.y;
    // Slack water in the lee of a stone: a fish can hold there against a current it could
    // never swim against in the open. With the eddies worked out (world.eddies), the water
    // round the stones is as they make it -- slack and turning back behind them, faster
    // beside them, whirls coming off; without, a simple lee behind each stone.
    const eddies = world.eddies?.ready ? world.eddies : null;
    if (eddies) f.shelter = eddies.apply(f.position.x, f.position.y, f.position.z, f.flow);
    if (f.flow.speed > 1e-3 || eddies) {
      // (With the eddies the slack water is in the current itself already.)
      let lee = 0;
      if (!eddies && f.flow.speed > 1e-3) {
        const fx = f.flow.vx / f.flow.speed,
          fz = f.flow.vz / f.flow.speed;
        for (const c of world.stones) {
          const dx = f.position.x - c.x,
            dz = f.position.z - c.z;
          const behind = dx * fx + dz * fz;
          if (behind < -c.r * 0.3 || behind > c.r * 4) continue;
          const across = Math.abs(dx * -fz + dz * fx) / (c.r * 1.2);
          const under = 1 - smooth(c.y + c.ry * 0.6, c.y + c.ry * 1.6, f.position.y);
          lee = Math.max(lee, Math.exp(-across * across - Math.max(0, behind) / (c.r * 2.5)) * under);
        }
        f.shelter = lee;
      }
      // Braking close to the bottom, a fish sets its fins against the stones and holds:
      // young salmon sit out a spate like this, pressed into the gravel.
      const above = f.position.y - floor;
      f.gripping = input.brake && above < H * 1.8 + 0.1 ? 1 : 0;
      // An alevin lives in the gravel itself, where the water hardly moves.
      const inGravel = st.yolk && above < H * 2.5 + 0.08 ? 0.95 : 0;
      const k = (1 - 0.8 * lee) * (1 - 0.88 * f.gripping) * (1 - inGravel);
      f.flow.vx *= k;
      f.flow.vz *= k;
      f.flow.speed *= k;
    }

    // ---- Airborne: a leap, or a fall over a lip.
    if (f.airborne) {
      f.velocity.y -= GRAVITY * dt;
      f.velocity.multiplyScalar(Math.exp(-dt * 0.05));
      f.position.addScaledVector(f.velocity, dt);
      // Nose follows the flight.
      const horizontal = Math.hypot(f.velocity.x, f.velocity.z);
      f.pitch += (Math.atan2(f.velocity.y, horizontal) - f.pitch) * (1 - Math.exp(-dt * 4));
      f.roll += dt * 2.5 * (f.leapFlip ?? 0);
      locate(f.position.x, f.position.z, f.river.s, f.river);
      const lv = level(f.river.s);
      const ground = bed(f.river.s, f.river.u);
      if (f.position.y < lv - H * 0.3 && f.velocity.y < 0) {
        // Back in the water.
        f.airborne = false;
        f.roll = 0;
        current(f.river.s, f.river.u, f.position.y, f.flow, world.time);
        f.relative.set(f.velocity.x - f.flow.vx, f.velocity.y * 0.3, f.velocity.z - f.flow.vz);
        f.events.push({ type: "splash", x: f.position.x, y: lv, z: f.position.z, strength: Math.min(1.6, 0.4 + L * 0.12 + Math.abs(f.velocity.y) * 0.01) });
        if (f.leapTarget) {
          f.events.push({ type: f.river.s < f.leapTarget.s - 0.5 ? "leapDone" : "leapFailed", fall: f.leapTarget });
          f.leapTarget = null;
        }
      } else if (f.position.y < ground + H * 0.5) {
        if (lv > ground + H * 0.25) {
          // Came down in shallow water over the stones: in, with a thump.
          f.airborne = false;
          f.roll = 0;
          f.position.y = Math.max(ground + H * 0.3, lv - H * 0.3);
          f.relative.set(0, 0, 0);
          f.events.push({ type: "splash", x: f.position.x, y: lv, z: f.position.z, strength: 0.8 });
          f.events.push({ type: "knock", strength: 0.03 });
          if (f.leapTarget) {
            f.events.push({ type: f.river.s < f.leapTarget.s - 0.5 ? "leapDone" : "leapFailed", fall: f.leapTarget });
            f.leapTarget = null;
          }
        } else {
          // Landed on dry rock: a hard knock, and it flops back the way it came, into the
          // deepest water near by.
          f.events.push({ type: "knock", strength: 0.06 });
          const back = f.velocity.clone().setY(0);
          if (back.lengthSq() < 1e-4) back.set(-f.heading.x, 0, -f.heading.z);
          back.normalize();
          f.position.x -= back.x * Math.max(1, H);
          f.position.z -= back.z * Math.max(1, H);
          f.position.y = ground + H * 0.6;
          f.velocity.set(-back.x * 2, 2, -back.z * 2);
        }
      }
      f.heading.set(Math.cos(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), Math.sin(f.yaw) * Math.cos(f.pitch));
      pose(dt, sp, input);
      return;
    }

    // ---- Steering: toward where the viewer looks, at the rate a fish this size turns.
    const turn = sp.turn * (f.exhausted ? 0.5 : 1);
    const error = wrap(input.yaw - f.yaw);
    const wantRate = clamp(error * 6, -turn, turn);
    f.yawRate += (wantRate - f.yawRate) * (1 - Math.exp(-dt * 10));
    f.yaw = wrap(f.yaw + f.yawRate * dt);
    const pitchLimit = 1.1;
    f.pitch += (clamp(input.pitch, -pitchLimit, pitchLimit) - f.pitch) * (1 - Math.exp(-dt * 4));
    // A strike (Space with food marked close ahead): the fish shoots at it -- one hard beat
    // of the tail, the head snapping round onto it, the mouth thrown open -- and takes it.
    f.strikeCool = Math.max(0, (f.strikeCool ?? 0) - dt);
    f.striking = Math.max(0, (f.striking ?? 0) - dt);
    if (input.lunge && f.strike && f.striking <= 0 && f.strikeCool <= 0 && !f.exhausted && !f.winded && f.breath >= 0.1) {
      f.striking = 0.25;
      f.strikeCool = 0.35;
      f.energy -= 0.0015;
      f.breath -= 0.12;
      f.events.push({ type: "strike" });
      input.lunge = false;
    } else if (f.snap && f.striking <= 0 && f.strikeCool <= 0 && !f.exhausted) {
      // Close in front the fish goes for it by itself: a short, quick dart, nose first.
      f.striking = 0.18;
      f.strikeCool = 0.25;
      f.breath = Math.max(0, f.breath - 0.03);
      f.events.push({ type: "strike", auto: true });
    }
    if (f.striking > 0 && f.strike) {
      strikeDir.subVectors(f.strike, f.mouth);
      const gap = strikeDir.length();
      if (gap > 1e-4) {
        strikeDir.multiplyScalar(1 / gap);
        f.strikeSpeed = Math.min(sp.burst, gap / Math.max(0.06, f.striking) + sp.cruise * 0.3);
        const wantYaw = Math.atan2(strikeDir.z, strikeDir.x);
        f.yaw = wrap(f.yaw + wrap(wantYaw - f.yaw) * (1 - Math.exp(-dt * 22)));
        f.pitch += (clamp(Math.asin(clamp(strikeDir.y, -1, 1)), -1, 1) - f.pitch) * (1 - Math.exp(-dt * 22));
      }
    } else if (f.striking <= 0) f.strikeSpeed = 0;
    // Caught: the dash stops short.
    else f.strikeSpeed = (f.strikeSpeed ?? 0) * Math.exp(-dt * 25);
    f.heading.set(Math.cos(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), Math.sin(f.yaw) * Math.cos(f.pitch));
    side.set(-Math.sin(f.yaw), 0, Math.cos(f.yaw));

    // ---- Breath (Puste): the white muscle's reserve for bursts. A lunge, a leap and a
    // strike use it up; it comes back while the fish lets itself drift or rests, and only
    // slowly while it swims. Spent, the fish is out of breath: no bursts, and it swims more
    // slowly, until it has most of it back.
    const drifting = !input.forward;
    const recover = 1 - 0.6 * thermal.heat;
    if (drifting) f.breath += (0.15 + 0.1 * (f.gripping || 0) + 0.06 * (f.shelter || 0)) * recover * dt;
    else f.breath += 0.03 * recover * dt;
    if (f.breath <= 0) {
      f.breath = 0;
      if (!f.winded) {
        f.winded = true;
        f.events.push({ type: "winded" });
      }
    }
    // It can never have more at call than its strength from food.
    f.breath = Math.min(f.breath, f.energy);
    if (f.winded && f.breath >= Math.min(0.45, f.energy * 0.9)) {
      f.winded = false;
      f.events.push({ type: "recovered" });
    }

    // ---- Thrust: what the fish wants its speed through the water to be.
    const cap = (f.exhausted ? 0.35 : 1) * (f.winded ? 0.8 : 1);
    target.set(0, 0, 0);
    if (input.forward) target.copy(f.heading).multiplyScalar(sp.cruise * cap);
    if (input.brake) {
      // Hold the ground: cancel the current as far as the fins allow.
      const along = clamp(-(f.flow.vx * f.heading.x + f.flow.vz * f.heading.z), -0.5 * sp.cruise, sp.sprint * 0.8);
      target.copy(f.heading).multiplyScalar(along * cap);
      const across = -(f.flow.vx * side.x + f.flow.vz * side.z);
      target.addScaledVector(side, clamp(across, -0.6 * sp.cruise, 0.6 * sp.cruise) * cap);
    }
    if (input.strafe) target.addScaledVector(side, input.strafe * 0.6 * sp.cruise * cap);
    const k = target.lengthSq() > f.relative.lengthSq() ? 2.6 : 1.3;
    f.relative.lerp(target, 1 - Math.exp(-dt * k));
    // A lunge: a burst of speed and a snap.
    f.lungeCool = Math.max(0, f.lungeCool - dt);
    f.lunging = Math.max(0, f.lunging - dt);
    if (input.lunge && (f.winded || f.breath < 0.2) && !f.exhausted) f.events.push({ type: "noBreath" });
    else if (input.lunge && f.lungeCool <= 0 && !f.exhausted) {
      f.lungeCool = 0.9;
      f.lunging = 0.3;
      // Each burst is one blow at most on any fish it runs into.
      f.lungeCount = (f.lungeCount ?? 0) + 1;
      f.breath -= 0.3;
      if (f.breath <= 0) {
        f.breath = 0;
        f.winded = true;
        f.events.push({ type: "winded" });
      }
      // Up to burst speed at once: the white muscle's one hard kick.
      // With A or D held it darts off to that side instead: a dodge.
      const dart = input.strafe ? lungeDir.copy(f.heading).multiplyScalar(0.45).addScaledVector(side, input.strafe).normalize() : lungeDir.copy(f.heading);
      f.relative.addScaledVector(dart, Math.max(sp.sprint * 0.4, sp.burst - f.relative.dot(dart)));
      f.energy -= st.fasting ? 0.004 : 0.012;
      f.events.push({ type: "lunge" });
      // At the surface, a lunge upward is a leap.
      const nearSurface = f.depthBelowSurface < Math.max(H * 3, 0.6);
      // Under ice there is no leaping.
      if (nearSurface && f.relative.length() > sp.cruise * 1.2 && !((world.ice ?? 0) > 0.5) && !world.netted) {
        leap(sp, surface, input.power ?? 1);
        pose(dt, sp, input);
        return;
      }
    }

    // ---- Strength: what the swimming costs, what the stomach gives, how it grows.
    const through = f.relative.length();
    const q = through / sp.cruise;
    const intoCurrent = f.flow.speed > 1e-3 ? Math.max(0, -(f.heading.x * f.flow.vx + f.heading.z * f.flow.vz) / f.flow.speed) : 0;
    // The upkeep of the body falls with size much as metabolic rate does; the cost of
    // swimming a little less steeply.
    const m = metabolism(L);
    let spend = 0.0008 * m + (0.0017 * q * q + 0.0006 * intoCurrent * q) * Math.sqrt(m);
    if (st.yolk) spend = 0.0006 + 0.003 * q * q;
    if (st.fasting) {
      // Living on its fat: a long, slow burn, and a little back while it rests in slack water.
      spend = (0.0001 + 0.00035 * q * q + 0.00015 * intoCurrent * q) * (f.gripping || f.shelter > 0.5 ? 0.6 : 1);
      // Resting in slack water, or pressed to the bottom, it gets its breath back.
      if (q < 0.35 && (f.flow.speed < 1.2 || f.gripping)) spend -= 0.0004 + 0.0011 * f.gripping;
    }
    // In cold water the body idles along on little; in water too warm it suffers.
    spend = spend * (0.45 + 0.55 * thermal.pace) + 0.004 * thermal.heat;
    f.energy -= spend * dt;
    // Hunger: how long the stomach has stood empty. Rest brings back breath, not strength the
    // body has not got -- the longer a feeding fish goes without food the less rest gives
    // back, and then its body starts to waste; with nothing left it dies (main.js).
    if (!st.fasting && !st.yolk) {
      const capacity = (st.need / (st.minutes * 60)) * STOMACH_SECONDS;
      if (f.stomach < capacity * 0.03) f.hunger = (f.hunger ?? 0) + dt;
      else f.hunger = Math.max(0, (f.hunger ?? 0) - dt * 6);
    } else f.hunger = 0;
    const reserve = clamp(1 - f.hunger / HUNGER_SECONDS, 0, 1);
    if (reserve <= 0) f.energy -= 0.003 * dt;
    // Tiredness passes with rest: a fish idling in easy water gets back some strength, though
    // only food fills it.
    if (!st.fasting && !st.yolk && q < 0.4 && f.energy < 0.45) f.energy += 0.0016 * (1 - f.energy / 0.45) * dt * (1 + f.gripping + (f.shelter ?? 0)) * reserve;
    if (st.yolk) {
      // The yolk feeds it, and it grows while it keeps still in the gravel.
      f.energy = Math.min(1, f.energy + 0.0045 * dt);
      const still = 1 - clamp(q - 0.3, 0, 1);
      f.progress += ((dt * pace) / (st.minutes * 60)) * (0.4 + 0.6 * still);
    } else if (st.fasting) {
      // Ripening: it happens with time, faster in fresh water.
      const fresh = s < S.coast ? 1 : 0.35;
      f.progress += ((dt * pace) / (st.minutes * 60)) * fresh;
    } else {
      const rate = st.need / (st.minutes * 60);
      const inSea = s > S.coast - 400 ? 1 : 0;
      // A smolt grows on its way down, the slower the farther it still is from the sea (a
      // fifth of the pace far up the river, full pace in the estuary); it becomes a postsmolt
      // only in salt water.
      const closeness = clamp(1 - (S.coast - 400 - s) / 12000, 0, 1);
      const factor = st.sea && !inSea ? 0.2 + 0.8 * closeness * closeness : 1;
      const digest = Math.min(f.stomach, (f.stomach / STOMACH_SECONDS) * dt * pace * factor * thermal.pace);
      f.stomach -= digest;
      if (f.energy < 0.3) f.energy = Math.min(1, f.energy + (0.0065 * digest) / rate);
      else f.progress += digest / st.need;
      if (st.sea && !inSea) f.progress = Math.min(f.progress, 0.97);
    }
    f.energy = clamp(f.energy, 0, 1);
    if (f.energy <= 0) f.exhausted = true;
    else if (f.exhausted && f.energy > 0.18) f.exhausted = false;
    if (f.progress >= 1 && !(st.fasting)) {
      if (f.stage < STAGES.length - 1) {
        f.stage++;
        f.progress = 0;
        f.events.push({ type: "stage", stage: f.stage });
      } else f.progress = 1;
    }
    if (st.fasting) f.progress = Math.min(1, f.progress);

    // ---- Move: through the water and with it.
    f.velocity.set(f.relative.x + f.flow.vx, f.relative.y, f.relative.z + f.flow.vz);
    // The strike's dash rides on top: quick, short, and gone with it.
    if (f.striking > 0 && f.strikeSpeed > 0) f.velocity.addScaledVector(f.heading, f.strikeSpeed * Math.min(1, f.striking / 0.08));
    // Far out at sea the haze closes in and a set of the water turns the fish back.
    const outward = Math.max(s - (S.coast + S.seaReach), Math.abs(u) - S.seaSide);
    if (outward > 0) {
      const push = Math.min(outward * 0.05, sp.sprint * 1.2);
      f.velocity.x -= (s > S.coast + S.seaReach ? 1 : 0) * push;
      f.velocity.z -= Math.sign(u) * (Math.abs(u) > S.seaSide ? 1 : 0) * push;
    }
    move(dt, L, H, world);

    // ---- Over a lip. A step of a few hand-breadths the water simply carries the fish down
    // in a boil of bubbles; over a real fall it goes through the air with the water.
    locate(f.position.x, f.position.z, f.river.s, f.river);
    const lvNow = level(f.river.s);
    if (f.position.y > lvNow + H * 0.2) {
      const drop = surface - lvNow;
      if (drop < 6) {
        f.position.y = Math.max(bed(f.river.s, f.river.u) + H, f.position.y - drop);
        f.relative.y -= 1.5;
        f.events.push({ type: "tumble", x: f.position.x, y: lvNow, z: f.position.z, strength: Math.min(1.2, 0.3 + drop * 0.2) });
      } else {
        f.airborne = true;
        f.leapFlip = (Math.random() - 0.5) * 2;
        f.events.push({ type: "overFall" });
      }
    }
    pose(dt, sp, input);
  }

  // A leap from the surface. Near the foot of a fall it aims for the lip.
  // `power`: how well the leap was timed (the salmon fall's charge, main.js), 1 otherwise.
  function leap(sp, surface, power = 1) {
    const st = stage();
    const L = f.length;
    const strength = 0.75 + 0.25 * f.energy;
    // A run at it helps: the speed carried into the leap.
    const runUp = 0.9 + 0.2 * Math.min(1, f.relative.length() / sp.leap);
    // The young in the river (up to the smolt) jump twice as high as their size alone
    // would give them, easing off through the first months at sea.
    const young = Math.sqrt(1 + clamp((3.2 - L) / 1.2, 0, 1));
    const exit = sp.leap * 2.9 * strength * runUp * young * (st.fasting ? 1.05 : 1) * power;
    let vy = exit * 0.82,
      horizontal = exit * 0.55;
    const s = f.river.s;
    // Is there a fall just upstream?
    let fall = null;
    for (const fl of FALLS) {
      if (fl.head) continue;
      const d = s - fl.s;
      if (d > -0.2 && d < 10 + fl.drop * 0.6 + L * 0.8) fall = fl;
    }
    let dirX = f.heading.x,
      dirZ = f.heading.z;
    const flat = Math.hypot(dirX, dirZ) || 1;
    dirX /= flat;
    dirZ /= flat;
    if (fall) {
      // Aim for a point just over the lip, at the height the leap can reach.
      const upTo = level(fall.s - 0.1);
      const need = upTo - surface + L * 0.3;
      const reach = (vy * vy) / (2 * GRAVITY);
      const time = vy / GRAVITY + Math.sqrt(Math.max(0, 2 * Math.max(0.1, reach - need) / GRAVITY));
      const distance = s - fall.s + 1.5 + L * 0.5;
      horizontal = distance / Math.max(0.2, time);
      f.leapTarget = fall;
      f.events.push({ type: "leap", fall, clears: reach >= need });
    } else f.events.push({ type: "leap", fall: null, clears: true });
    f.airborne = true;
    f.leapFlip = fall ? 0 : (Math.random() - 0.5) * 1.2;
    f.velocity.set(dirX * horizontal, vy, dirZ * horizontal);
    f.energy -= (st.fasting ? 0.03 : 0.02) * (fall ? 1.5 : 1);
  }

  // Keep the fish in the water: off the bed, under the surface, out of the stones, and off
  // the banks where the water runs out.
  // Moves the fish out of a stone by (x, y, z), and takes away the part of its swimming
  // that went into the stone.
  function pushOut(x, y, z) {
    f.position.x += x;
    f.position.y += y;
    f.position.z += z;
    const n = Math.hypot(x, y, z);
    if (n < 1e-6) return;
    const into = (f.relative.x * x + f.relative.y * y + f.relative.z * z) / n;
    if (into < 0) {
      f.relative.x -= (x / n) * into;
      f.relative.y -= (y / n) * into;
      f.relative.z -= (z / n) * into;
    }
  }
  function move(dt, L, H, world) {
    const before = f.position.clone();
    f.position.addScaledVector(f.velocity, dt);
    // Stones: every boulder, cobble and pebble is an ellipsoid, turned as the stone lies.
    // The fish is tested at its head, its middle and its tail, so its nose does not go into
    // the rock while its middle is still clear; each part it has in a stone is pushed out.
    // Near the bottom a stone never pushes the fish down into the ground: it slides round
    // the stone instead, or over it.
    const stones = world.stones;
    const ground = bed(f.river.s, f.river.u);
    for (const c of stones) {
      const rx = c.rx ?? c.r,
        rz = c.rz ?? c.r,
        cs = c.cos ?? 1,
        sn = c.sin ?? 0;
      const reachOut = Math.max(rx, rz) + L;
      if (Math.abs(f.position.x - c.x) > reachOut || Math.abs(f.position.z - c.z) > reachOut) continue;
      for (let part = 0; part < 3; part++) {
        const along = part === 0 ? 0.36 * L : part === 1 ? 0 : -0.3 * L;
        const thick = part === 2 ? H * 0.3 : H * 0.55;
        const px = f.position.x + f.heading.x * along,
          py = f.position.y + f.heading.y * along,
          pz = f.position.z + f.heading.z * along;
        const wx = px - c.x,
          wy = py - c.y,
          wz = pz - c.z;
        // Into the stone's own frame, scaled to a unit sphere.
        const lx = (wx * cs - wz * sn) / rx,
          ly = wy / c.ry,
          lz = (wx * sn + wz * cs) / rz;
        const d = Math.hypot(lx, ly, lz);
        const room = 1 + thick / Math.min(rx, rz, c.ry);
        if (d >= room || d < 1e-5) continue;
        let nx = lx / d,
          ny = ly / d,
          nz = lz / d,
          to = room;
        if (ny < 0 && py - ground < H * 2) {
          // Beside a stone at the bottom: out sideways at this height, not down.
          const flat = Math.hypot(nx, nz) || 1;
          nx /= flat;
          nz /= flat;
          ny = 0;
          to = Math.sqrt(Math.max(room * room - ly * ly, 0.01));
          const across = Math.hypot(lx, lz);
          if (across >= to) continue;
          const gx = (nx * to - lx) * rx,
            gz = (nz * to - lz) * rz;
          pushOut(gx * cs + gz * sn, 0, -gx * sn + gz * cs);
          continue;
        }
        const k = to - d;
        const gx = nx * k * rx,
          gz = nz * k * rz;
        pushOut(gx * cs + gz * sn, ny * k * c.ry, -gx * sn + gz * cs);
      }
    }
    locate(f.position.x, f.position.z, f.river.s, probe);
    let lv = level(probe.s);
    let fl = bed(probe.s, probe.u);
    // No water to swim in here: the bank, a bar or the face of a fall. Slide along it: try
    // each of the two directions on its own, and failing both, ease off toward deeper water.
    const tooShallow = (x, z, out) => {
      locate(x, z, f.river.s, out);
      const l = level(out.s),
        b = bed(out.s, out.u);
      // A big fish will wriggle through water shallower than itself, back out; only a bank
      // or a ledge stops it.
      return l - b < H * 0.6 || b > f.position.y + H * 1.5;
    };
    if (tooShallow(f.position.x, f.position.z, probe)) {
      // Which way the water deepens, here.
      const depthAt = (x, z) => {
        locate(x, z, f.river.s, probe);
        return level(probe.s) - bed(probe.s, probe.u);
      };
      const e = Math.max(0.2, L * 0.15);
      const gx = depthAt(f.position.x + e, f.position.z) - depthAt(f.position.x - e, f.position.z);
      const gz = depthAt(f.position.x, f.position.z + e) - depthAt(f.position.x, f.position.z - e);
      const gl = Math.hypot(gx, gz) || 1;
      const nx = gx / gl,
        nz = gz / gl;
      // Keep the part of the move along the bank, drop the part into it, and lean off it.
      let dx = f.position.x - before.x,
        dz = f.position.z - before.z;
      const into = dx * nx + dz * nz;
      if (into < 0) {
        dx -= nx * into;
        dz -= nz * into;
      }
      const step = Math.hypot(f.position.x - before.x, f.position.z - before.z);
      dx += nx * step * 0.4;
      dz += nz * step * 0.4;
      f.position.x = before.x + dx;
      f.position.z = before.z + dz;
      if (tooShallow(f.position.x, f.position.z, probe)) {
        f.position.x = before.x + nx * step * 0.3;
        f.position.z = before.z + nz * step * 0.3;
        if (tooShallow(f.position.x, f.position.z, probe)) {
          f.position.x = before.x;
          f.position.z = before.z;
        }
      }
      locate(f.position.x, f.position.z, f.river.s, probe);
      lv = level(probe.s);
      fl = bed(probe.s, probe.u);
      f.relative.multiplyScalar(0.85);
      f.events.push({ type: "blocked" });
    }
    // A few millimetres over the modelled bed, so the rendered ground (a mesh between points
    // of it) never shows through a small fish lying on the bottom.
    let low = fl + H * 0.55 + 0.025;
    let high = lv - H * 0.35;
    if (high < low) {
      // Too shallow to swim covered: scrape along the bottom, slowed, and edge off toward
      // deeper water.
      high = low = Math.min(low, lv - H * 0.1);
      f.relative.multiplyScalar(Math.exp(-dt * 0.6));
      const e = Math.max(0.2, L * 0.15);
      const depthAt = (x, z) => {
        locate(x, z, f.river.s, probe);
        return level(probe.s) - bed(probe.s, probe.u);
      };
      const gx = depthAt(f.position.x + e, f.position.z) - depthAt(f.position.x - e, f.position.z);
      const gz = depthAt(f.position.x, f.position.z + e) - depthAt(f.position.x, f.position.z - e);
      const gl = Math.hypot(gx, gz);
      if (gl > 1e-4) {
        f.position.x += (gx / gl) * L * 0.8 * dt;
        f.position.z += (gz / gl) * L * 0.8 * dt;
      }
      locate(f.position.x, f.position.z, f.river.s, probe);
    }
    if (f.position.y < low) {
      f.position.y = low;
      if (f.relative.y < 0) f.relative.y *= 0.3;
    }
    if (f.position.y > high && !f.airborne) {
      // Only a leap takes it out; otherwise the surface holds it under.
      const overLip = lv < level(f.river.s) - 0.5;
      if (!overLip) {
        f.position.y = Math.max(Math.min(f.position.y, high), low);
        if (f.relative.y > 0) f.relative.y *= 0.3;
      }
    }
  }

  // Pose and swim cycle for the mesh.
  function pose(dt, sp, input) {
    const L = f.length;
    const st = stage();
    const striking = f.striking ?? 0;
    // Held by a hunter it thrashes with everything it has.
    const through = f.captive ? sp.sprint : (f.airborne ? sp.cruise * 1.5 : f.relative.length()) + (striking > 0 ? f.strikeSpeed ?? 0 : 0);
    const effort = Math.min(1, 0.15 + through / sp.sprint + f.lunging * 2 + (striking > 0 ? 0.7 : 0));
    // Small fish beat fast; a strike is one hard, quick beat.
    const beat = (1.2 + (through / Math.max(L, 0.1)) * 0.9) * (f.airborne ? 1.6 : 1) * (striking > 0 ? 1.8 : 1);
    f.phase = (f.phase + dt * TAU * Math.min(beat, 9)) % TAU;
    f.finPhase = (f.finPhase + dt * TAU * (1.4 + effort * 1.5)) % TAU;
    const curvature = clamp(-f.yawRate / Math.max(sp.turn, 0.5) * 1.2, -1.4, 1.4);
    f.bend += (curvature - f.bend) * (1 - Math.exp(-dt * 6));
    const brake = input.brake ? 0.8 : !input.forward ? 0.35 : 0.05;
    meshes.swim.setXYZW(0, f.phase, 0.25 + 0.45 * effort, -f.bend, brake);
    meshes.fin.setX(0, f.finPhase);
    // The mouth: flung open in a strike or a lunge, held open while the food goes in, then
    // shut on it -- a gulp; a spawner's jaw hangs a little open.
    f.gulp = Math.max(0, (f.gulp ?? 0) - dt);
    // Out of breath it pumps water over its gills, mouth working fast.
    f.pant = ((f.pant ?? 0) + dt * 9) % TAU;
    const panting = f.winded ? 0.3 + 0.25 * Math.sin(f.pant) : f.breath < 0.3 ? 0.12 + 0.1 * Math.sin(f.pant) : 0;
    const wantGape = striking > 0.05 || f.gulp > 0.1 ? 1 : f.lunging > 0 ? 0.85 : Math.max(panting, st.fasting ? 0.12 * f.progress : 0);
    f.gape = f.gape ?? 0;
    f.gape += (wantGape - f.gape) * (1 - Math.exp(-dt * (wantGape > f.gape ? 30 : 10)));
    meshes.mouth.setX(0, f.gape);
    meshes.swim.needsUpdate = meshes.fin.needsUpdate = meshes.mouth.needsUpdate = true;
    axisZ.crossVectors(f.heading, UP);
    if (axisZ.lengthSq() < 1e-6) axisZ.set(0, 0, 1);
    axisZ.normalize();
    axisY.crossVectors(axisZ, f.heading).normalize();
    basis.makeBasis(f.heading, axisY, axisZ);
    quaternion.setFromRotationMatrix(basis);
    bank.setFromAxisAngle(FORWARD, clamp(-f.yawRate * 0.12, -0.45, 0.45) + f.roll);
    quaternion.multiply(bank);
    // Place the model so its middle, not its snout, is at the fish's position.
    const k = (L / MODEL_LENGTH) * (1 - (f.shrink ?? 0));
    scale.set(k, k, k);
    matrix.compose(f.position, quaternion, scale);
    const centre = new THREE.Vector3(-0.0, 0, 0).applyMatrix4(matrix);
    void centre;
    meshes.body.setMatrixAt(0, matrix);
    meshes.membranes.setMatrixAt(0, matrix);
    meshes.body.instanceMatrix.needsUpdate = meshes.membranes.instanceMatrix.needsUpdate = true;
    f.mouth.copy(f.heading).multiplyScalar(0.35 * k).add(f.position);
    dress();
  }

  setStage(0, 0);
  return {
    fish: f,
    stage,
    speeds: () => speeds(f.length),
    height,
    setStage,
    place,
    eat,
    captive,
    appetite,
    update,
    get meshes() {
      return [meshes.body, meshes.membranes];
    },
    get materials() {
      return meshes.materials;
    },
  };
}
