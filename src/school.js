import * as THREE from "three";
import { MODEL_LENGTH, createFishMesh } from "./anatomy.js";
import { bed, level, locate, regionWeights } from "./course.js";
import { phaseOf } from "./salmon.js";

// The smolt run. In the May flood the smolts go down to the sea together, and the fish goes
// with them: a loose school round it, keeping station with it, turning as it turns. In a
// school a salmon is safer -- a hunter that strikes into it takes whichever fish it gets,
// and often that is another. The others feed as they go, darting out of the school at
// whatever drifts past -- so the fish has to be quick for its share. At sea the school
// breaks up.

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// The same school serves the other run: the grown salmon going home in late summer and
// autumn, a loose company of big fish working up the river together (`coat: "spawner"`,
// `when` saying when it runs; they no longer feed).
const smoltRun = (fish, weights) => phaseOf(fish.stage) === "smolt" && weights.sea < 0.6;

export function createSchool(scene, { random, brawls = null, coat = "smolt", count: COUNT = 16, when = smoltRun, title = "Smolt", kind = "smolt" }) {
  const range = (a, b) => a + (b - a) * random();
  const mesh = createFishMesh(scene, "salmon", coat, COUNT, { name: `${title} school`, cacheKey: `school-${coat}`, detail: 0.5, castShadow: coat !== "smolt" });
  const members = Array.from({ length: COUNT }, (_, i) => ({
    slot: i,
    active: false,
    leaving: 0,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    heading: new THREE.Vector3(1, 0, 0),
    offset: new THREE.Vector3(),
    river: { s: 0, u: 0 },
    size: 1.6,
    phase: range(0, TAU),
    finPhase: range(0, TAU),
    target: null,
    look: 0,
    gape: 0,
  }));
  const weights = {};
  const want = new THREE.Vector3();
  const local = new THREE.Vector3();
  const away = new THREE.Vector3();
  const mouthAt = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  let count = 0;

  function join(m, fish) {
    const L = fish.length;
    m.offset.set(range(-2.5, 2.5), range(-0.8, 0.8), range(-2.5, 2.5)).multiplyScalar(L * 1.4);
    if (m.offset.length() < L * 1.2) m.offset.setLength(L * 1.4);
    m.position.copy(fish.position).addScaledVector(m.offset, range(1, 2.5));
    m.velocity.copy(fish.velocity);
    m.heading.copy(fish.heading);
    m.size = L * range(0.85, 1.15);
    m.active = true;
    m.leaving = 0;
    m.target = null;
    m.kraft = undefined;
    m.brawl = null;
    locate(m.position.x, m.position.z, fish.river.s, m.river);
  }

  return {
    meshes: [mesh.body, mesh.membranes],
    members,
    get count() {
      return count;
    },
    reset() {
      for (const m of members) m.active = false;
    },
    // A hunter strikes into the school near `at`: does it take a schoolmate instead of the
    // fish? The more of them close by, the likelier.
    decoy(at, fish) {
      let near = 0,
        best = null,
        bestD = Infinity;
      for (const m of members) {
        if (!m.active || m.leaving) continue;
        if (m.position.distanceTo(fish.position) < fish.length * 5) near++;
        const d = m.position.distanceTo(at);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
      if (!best || near === 0 || random() > (near / (near + 1)) * 0.75) return false;
      best.active = false;
      return true;
    },
    update(dt, fish, time, food = null) {
      regionWeights(fish.river.s, weights);
      const running = when(fish, weights) && !fish.captive;
      const L = fish.length;
      mesh.begin();
      count = 0;
      for (const m of members) {
        if (!m.active) {
          // Joining: smolts gather round the fish over the first minute of the run.
          if (running && random() < dt * 0.4) join(m, fish);
          if (!m.active) continue;
        }
        if (!running && !m.leaving) m.leaving = range(0.01, 1);
        if (m.leaving) {
          m.leaving += dt;
          if (m.leaving > 4) {
            m.active = false;
            continue;
          }
        }
        // Station in the school: the offset turned with the fish, plus its own weave.
        const yaw = Math.atan2(fish.heading.z, fish.heading.x);
        const c = Math.cos(yaw),
          s = Math.sin(yaw);
        local.set(m.offset.x * c - m.offset.z * s, m.offset.y, m.offset.x * s + m.offset.z * c);
        want.copy(fish.position).add(local);
        want.x += Math.sin(time * 0.7 + m.slot) * L * 0.4;
        want.z += Math.cos(time * 0.6 + m.slot * 1.7) * L * 0.4;
        if (m.leaving) want.addScaledVector(local, 3 + m.leaving * 2);
        want.sub(m.position).multiplyScalar(1.6).addScaledVector(fish.velocity, 0.9);
        // Feeding: now and then it picks a morsel drifting close by, darts out at it and
        // snaps it up -- one the fish will not get.
        if (food && !m.leaving && !m.brawl) {
          m.look -= dt;
          if (m.target && (!m.target.alive || m.target.eatenAt >= 0 || m.target.position.distanceTo(m.position) > m.size * 5)) m.target = null;
          if (!m.target && m.look <= 0) {
            m.look = range(0.4, 1.2);
            let best = null,
              bestD = random() < 0.4 ? m.size * 3 : 0;
            for (const item of food) {
              if (!item.alive || item.held || item.eatenAt >= 0 || item.size > m.size * 0.45) continue;
              const d = item.position.distanceTo(m.position);
              if (d < bestD) (bestD = d), (best = item);
            }
            m.target = best;
          }
          if (m.target) {
            want.subVectors(m.target.position, m.position).multiplyScalar(4);
            mouthAt.copy(m.position).addScaledVector(m.heading, 0.42 * m.size);
            if (mouthAt.distanceTo(m.target.position) < 0.12 * m.size + m.target.size * 0.5 + 0.05) {
              // Taken: gone from the drift.
              m.target.alive = false;
              m.target = null;
              m.gape = 1;
            }
          }
        }
        // Struck by the fish: it flees, or -- a match for it -- nips back.
        if (brawls) {
          brawls.strike(m, fish, { kind, title, temper: 1 });
          brawls.move(m, fish, dt, want, 10 * Math.pow(m.size, 0.7));
        }
        // Not on top of each other, nor on top of the fish.
        for (const o of members) {
          if (o === m || !o.active) continue;
          away.subVectors(m.position, o.position);
          const d = away.length();
          if (d < m.size * 0.9 && d > 1e-4) want.addScaledVector(away, ((m.size * 0.9 - d) / d) * 4);
        }
        away.subVectors(m.position, fish.position);
        const df = away.length();
        if (df < L * 1.1 && df > 1e-4) want.addScaledVector(away, ((L * 1.1 - df) / df) * 5);
        const top = 10 * Math.pow(m.size, 0.7);
        want.clampLength(0, top);
        m.velocity.lerp(want, 1 - Math.exp(-dt * 3));
        m.position.addScaledVector(m.velocity, dt);
        locate(m.position.x, m.position.z, m.river.s, m.river);
        const lv = level(m.river.s);
        const floor = bed(m.river.s, m.river.u);
        m.position.y = clamp(m.position.y, floor + m.size * 0.3, lv - m.size * 0.25);
        if (m.velocity.lengthSq() > 0.05) m.heading.lerp(local.copy(m.velocity).normalize(), 1 - Math.exp(-dt * 6)).normalize();
        const speed = m.velocity.length();
        m.phase = (m.phase + dt * TAU * (1.2 + (speed / m.size) * 1.1)) % TAU;
        m.finPhase = (m.finPhase + dt * TAU * 2) % TAU;
        axisZ.crossVectors(m.heading, UP);
        if (axisZ.lengthSq() < 1e-6) axisZ.set(0, 0, 1);
        axisZ.normalize();
        axisY.crossVectors(axisZ, m.heading).normalize();
        basis.makeBasis(m.heading, axisY, axisZ);
        quaternion.setFromRotationMatrix(basis);
        const k = m.size / MODEL_LENGTH;
        matrix.compose(m.position, quaternion, scale.set(k, k, k));
        mesh.body.setMatrixAt(m.slot, matrix);
        mesh.swim.setXYZW(m.slot, m.phase, 0.3 + Math.min(0.5, (speed / m.size) * 0.1), 0, 0.2);
        mesh.fin.setX(m.slot, m.finPhase);
        m.gape = Math.max(0, m.gape - dt * 4) ;
        mesh.mouth.setX(m.slot, m.target && m.target.position.distanceTo(m.position) < m.size ? 0.8 : m.gape);
        if (!m.leaving) count++;
      }
      mesh.finish();
    },
  };
}
