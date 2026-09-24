import * as THREE from "three";
import { MODEL_LENGTH, createFishMesh } from "./anatomy.js";
import { S, bed, frame, level, locate, place, section } from "./course.js";
import { phaseOf } from "./salmon.js";

// The fish's siblings: a few others of the same brood, about the same age, somewhere near
// it -- each on its own, not in a school: holding a station in the current, darting out at
// what drifts past, now and then moving on to another spot. Not many; more when the fish
// is small (the brood is still large). They are only there to be seen: they take nothing
// from the drift and the hunters leave them be. From the smolt on, the school and the run
// home take their place.
//
// When the fish dies, one of them goes on: the nearest takes over (see main.js).

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const MAX = 6;
// Which body and coat the siblings wear, by the phase of life.
const LOOKS = { alevin: ["alevin", "alevin"], fry: ["parr", "fry"], parr: ["parr", "parr"], smolt: ["salmon", "smolt"], sea: ["salmon", "sea"], spawner: ["salmon", "spawner"] };
// From the smolt on, the siblings about are the real company: the smolt run going down
// together and the run home (school.js), which count as they always have. Before that, a
// few on their own -- and at sea, alone, one only comes when the fish dies (call()).
const HOW_MANY = { alevin: 5, fry: 5, parr: 4, smolt: 0, sea: 0, spawner: 0 };

export function createSiblings(scene, { random = Math.random } = {}) {
  const range = (a, b) => a + (b - a) * random();
  const meshes = {};
  const meshFor = (key) => {
    if (!meshes[key]) {
      const [body, coat] = LOOKS[key];
      meshes[key] = createFishMesh(scene, body, coat, MAX, { name: `Siblings ${key}`, cacheKey: `siblings-${key}`, detail: 0.5, castShadow: false });
    }
    return meshes[key];
  };
  const list = Array.from({ length: MAX }, (_, i) => ({
    slot: i,
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    heading: new THREE.Vector3(1, 0, 0),
    home: new THREE.Vector3(),
    river: { s: 0, u: 0 },
    size: 0.3,
    phase: range(0, TAU),
    finPhase: range(0, TAU),
    move: range(8, 30),
    look: 0,
    target: null,
    gape: 0,
  }));
  const at = {};
  const want = new THREE.Vector3();
  const away = new THREE.Vector3();
  const mouthAt = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  let key = null;
  let wanted = 0;

  // A station in the river near `centre` (a river position), at a depth that suits it.
  function settle(m, fish, s0, u0, spread, hideFrom = null) {
    const L = fish.length;
    for (let tries = 0; tries < 10; tries++) {
      const s = clamp(s0 + range(-spread, spread), S.redd + 2, S.coast + S.seaReach * 0.8);
      const inSea = s > S.coast;
      const c = section(Math.min(s, S.coast));
      const u = inSea ? u0 + range(-spread, spread) : clamp(u0 + range(-spread * 0.6, spread * 0.6), c.thalweg - c.half * 0.8, c.thalweg + c.half * 0.8);
      const floor = bed(s, u);
      const lv = level(s);
      if (lv - floor < Math.max(0.5, L * 1.6)) continue;
      place(s, u, at);
      const y = key === "alevin" ? floor + m.size * 0.35 : clamp(floor + range(0.6, 2.5) * m.size + (key === "sea" ? range(0, 6) : 0), floor + m.size * 0.4, lv - m.size * 0.5);
      m.home.set(at.x, y, at.z);
      // Out of sight of the camera when it joins, so it does not pop up in view.
      if (hideFrom) {
        toCamera.subVectors(m.home, hideFrom.position);
        const d = toCamera.length();
        const ahead = toCamera.dot(hideFrom.forward) / Math.max(1e-4, d);
        if (d < 20 + L * 6 && ahead > 0.3) continue;
      }
      m.river.s = s;
      m.river.u = u;
      return true;
    }
    return false;
  }
  function join(m, fish, camera) {
    m.size = fish.length * range(0.82, 1.08);
    const forward = new THREE.Vector3();
    camera?.getWorldDirection(forward);
    if (!settle(m, fish, fish.river.s, fish.river.u, 10 + fish.length * 8, camera ? { position: camera.position, forward } : null)) return;
    m.position.copy(m.home);
    m.velocity.set(0, 0, 0);
    frame(Math.min(m.river.s, S.coast), at);
    m.heading.set(-at.tx, 0, -at.tz).normalize();
    m.active = true;
    m.target = null;
    m.move = range(8, 30);
  }

  return {
    get meshes() {
      return Object.values(meshes).flatMap((m) => [m.body, m.membranes]);
    },
    list,
    reset() {
      for (const m of list) m.active = false;
    },
    // The nearest sibling within reach of a point, or null.
    nearest(point, reach = 60) {
      let best = null,
        bestD = reach;
      for (const m of list) {
        if (!m.active) continue;
        const d = m.position.distanceTo(point);
        if (d < bestD) (bestD = d), (best = m);
      }
      return best;
    },
    // One placed near the fish right now (when none is about to take over).
    call(fish) {
      const m = list.find((x) => !x.active) ?? list[0];
      m.size = fish.length * range(0.85, 1.05);
      if (!settle(m, fish, fish.river.s, fish.river.u, 10 + fish.length * 4)) return null;
      m.position.copy(m.home);
      frame(Math.min(m.river.s, S.coast), at);
      m.heading.set(-at.tx, 0, -at.tz).normalize();
      m.active = true;
      return m;
    },
    // This one is the fish now.
    take(m) {
      m.active = false;
    },
    update(dt, fish, time, { food = null, camera = null, others = 0, left = MAX } = {}) {
      const phase = phaseOf(fish.stage);
      if (phase !== key) {
        // A new look for a new phase of life: the old ones go, the new ones come in unseen.
        if (key && meshes[key]) {
          meshes[key].begin();
          meshes[key].finish();
        }
        key = phase;
        for (const m of list) m.active = false;
      }
      // Fewer when others keep the fish company (the smolt run, the run home), and never
      // more than are left of the brood.
      wanted = fish.captive ? wanted : Math.max(0, Math.min(HOW_MANY[phase] ?? 3, left - 1) - (others > 0 ? 99 : 0));
      const mesh = meshFor(phase);
      const L = fish.length;
      mesh.begin();
      let active = 0;
      for (const m of list) {
        if (!m.active) {
          if (active < wanted && random() < dt * 0.5) join(m, fish, camera);
          if (!m.active) continue;
        }
        if (active >= wanted || m.position.distanceTo(fish.position) > 50 + L * 15) {
          // Left behind (or one too many): it goes, and another may join nearer.
          m.active = false;
          continue;
        }
        active++;
        m.size += (fish.length * 0.95 - m.size) * dt * 0.02;
        // Now and then it moves on to another spot close by.
        m.move -= dt;
        if (m.move <= 0) {
          m.move = range(10, 35);
          // (drawn a little toward where the fish is, so they stay about it)
          settle(m, fish, m.river.s + (fish.river.s - m.river.s) * 0.4, m.river.u + (fish.river.u - m.river.u) * 0.4, 3 + m.size * 6);
        }
        // Holding its station, facing into the current, with its own small weave.
        want.subVectors(m.home, m.position).multiplyScalar(key === "alevin" ? 0.6 : 1.4);
        want.x += Math.sin(time * 0.8 + m.slot * 2.1) * m.size * 0.25;
        want.z += Math.cos(time * 0.7 + m.slot) * m.size * 0.25;
        // Darting out now and then as if at something in the drift, and back -- only for the
        // look of it: they take nothing the fish could eat, and the hunters leave them be,
        // so they do not change the game (the smolt run and the run home do, as before).
        if (key !== "alevin") {
          m.look -= dt;
          if (!m.target && m.look <= 0) {
            m.look = range(2, 6);
            frame(Math.min(m.river.s, S.coast), at);
            m.target = { point: mouthAt.set(-at.tx, range(-0.3, 0.4), -at.tz).multiplyScalar(m.size * range(1.2, 2.6)).add(m.position).clone(), until: time + 0.5 };
            m.target.point.x += range(-1, 1) * m.size;
          }
          if (m.target) {
            want.subVectors(m.target.point, m.position).multiplyScalar(5);
            if (time > m.target.until || m.position.distanceTo(m.target.point) < m.size * 0.3) {
              m.target = null;
              m.gape = 1;
            }
          }
        }
        // Not on top of each other, nor on the fish.
        for (const o of list) {
          if (o === m || !o.active) continue;
          away.subVectors(m.position, o.position);
          const d = away.length();
          if (d < m.size * 2 && d > 1e-4) want.addScaledVector(away, ((m.size * 2 - d) / d) * 3);
        }
        away.subVectors(m.position, fish.position);
        const df = away.length();
        if (df < L * 1.5 && df > 1e-4) want.addScaledVector(away, ((L * 1.5 - df) / df) * 4);
        const top = (key === "alevin" ? 2 : 8) * Math.pow(m.size, 0.7);
        want.clampLength(0, top);
        m.velocity.lerp(want, 1 - Math.exp(-dt * 3));
        m.position.addScaledVector(m.velocity, dt);
        locate(m.position.x, m.position.z, m.river.s, m.river);
        const lv = level(m.river.s);
        const floor = bed(m.river.s, m.river.u);
        m.position.y = clamp(m.position.y, floor + m.size * 0.25, lv - m.size * 0.3);
        // Facing the current when it holds, the way it swims when it darts.
        if (m.target && m.velocity.lengthSq() > 0.02) m.heading.lerp(away.copy(m.velocity).normalize(), 1 - Math.exp(-dt * 8)).normalize();
        else {
          frame(Math.min(m.river.s, S.coast), at);
          away.set(-at.tx, 0, -at.tz);
          if (m.river.s > S.coast) away.set(Math.cos(m.slot + time * 0.05), 0, Math.sin(m.slot + time * 0.05));
          m.heading.lerp(away.normalize(), 1 - Math.exp(-dt * 2)).normalize();
        }
        const speed = m.velocity.length();
        m.phase = (m.phase + dt * TAU * (key === "alevin" ? 0.6 : 1.1 + (speed / m.size) * 1.1)) % TAU;
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
        mesh.swim.setXYZW(m.slot, m.phase, 0.3 + Math.min(0.5, (speed / m.size) * 0.1), 0, 0.3);
        mesh.fin.setX(m.slot, m.finPhase);
        m.gape = Math.max(0, m.gape - dt * 4);
        mesh.mouth.setX(m.slot, m.gape);
      }
      mesh.finish();
    },
  };
}
