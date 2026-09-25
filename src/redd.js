import * as THREE from "three";
import { MODEL_LENGTH, createFishMesh } from "./anatomy.js";
import { S, bed, frame, level, locate, place, section } from "./course.js";
import { mode } from "./vegan.js";

// The finale: home, on the gravel of the spring. A hen is there before him, cutting the
// redd -- turning on her side and beating her tail against the bottom until the gravel
// lifts and the current carries the fines away, again and again. He has to stay at her side
// through it (courting her, the bar fills), and drive off every other cock that pushes in
// (a blow in the flank sends him off -- for a while). When she is ready they spawn together
// over the pit: the eggs, orange, and the milt, a white cloud; and a precocious little parr
// darts in from nowhere to have his share, as they do.
//
// main.js starts it when the fish is home and ripe, and does the spawning itself (the eggs
// in the gravel, the card, the next generation) when this says she is ready.

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// How long by her side it takes, and how long a rival there sets it back.
const COURT_SECONDS = 22;
const RIVALS = 2;

export function createRedd(scene) {
  const hen = createFishMesh(scene, "salmon", "spawner", 1, { name: "Hen", cacheKey: "redd-hen" });
  const cocks = createFishMesh(scene, "salmon", "spawner", RIVALS, { name: "Rivals", cacheKey: "redd-cock" });
  const sneaker = createFishMesh(scene, "parr", "parr", 1, { name: "Sneaker", cacheKey: "redd-parr", detail: 0.6, castShadow: false });
  if (hen.materials.uniforms?.coat_kype) {
    hen.materials.uniforms.coat_kype.value = 0;
    hen.materials.uniforms.coat_hump.value = 0.15;
  }
  if (cocks.materials.uniforms?.coat_kype) {
    cocks.materials.uniforms.coat_kype.value = 0.9;
    cocks.materials.uniforms.coat_hump.value = 0.85;
  }
  const meshes = [hen.body, hen.membranes, cocks.body, cocks.membranes, sneaker.body, sneaker.membranes];
  for (const m of [hen, cocks, sneaker]) {
    m.begin();
    m.finish();
  }
  // Clouds in the water: gravel dust from her digging (brown), the milt (white).
  const PUFFS = 160;
  const puffGeometry = new THREE.BufferGeometry();
  const puffPositions = new Float32Array(PUFFS * 3);
  const puffColors = new Float32Array(PUFFS * 3);
  puffGeometry.setAttribute("position", new THREE.BufferAttribute(puffPositions, 3));
  puffGeometry.setAttribute("color", new THREE.BufferAttribute(puffColors, 3));
  const dot = document.createElement("canvas");
  dot.width = dot.height = 32;
  const g = dot.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const puffMaterial = new THREE.PointsMaterial({ size: 1.4, map: new THREE.CanvasTexture(dot), vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true });
  const puffs = new THREE.Points(puffGeometry, puffMaterial);
  puffs.frustumCulled = false;
  puffs.visible = false;
  puffs.name = "Redd clouds";
  scene.add(puffs);
  const puffList = Array.from({ length: PUFFS }, () => ({ life: 0, velocity: new THREE.Vector3(), position: new THREE.Vector3() }));
  let nextPuff = 0;
  function puff(at, color, n, spread) {
    for (let i = 0; i < n; i++) {
      const index = nextPuff;
      const p = puffList[index];
      nextPuff = (nextPuff + 1) % PUFFS;
      p.life = 1.6 + Math.random() * 1.4;
      p.position.copy(at);
      p.velocity.set((Math.random() - 0.5) * spread, Math.random() * spread * 0.6, (Math.random() - 0.5) * spread);
      puffColors.set(color, index * 3);
    }
  }

  const at = {};
  const f = {};
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const want = new THREE.Vector3();

  const her = { position: new THREE.Vector3(), heading: new THREE.Vector3(), size: 8.4, phase: 0, dig: 0, digNext: 2, roll: 0 };
  const rivals = Array.from({ length: RIVALS }, (_, i) => ({
    slot: i,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    heading: new THREE.Vector3(),
    home: new THREE.Vector3(),
    size: 8.2 + i * 0.6,
    phase: Math.random() * TAU,
    mode: "wait",
    until: 0,
    gape: 0,
  }));
  const small = { position: new THREE.Vector3(), heading: new THREE.Vector3(), t: -1, phase: 0 };
  const state = { on: false, courtship: 0, ready: false, rival: null, drivenOff: 0, spawning: false };
  let clock = 0;
  let nextRival = 0;

  // A place in the brook `ahead` units down from the redd, `across` of the half-width off.
  function spot(ahead, across, height, out) {
    const s = S.redd + ahead;
    const c = section(s);
    const u = c.thalweg + across * c.half;
    place(s, u, at);
    const floor = bed(s, u);
    out.set(at.x, Math.min(floor + height, level(s) - 1), at.z);
    return out;
  }
  function upstream(s, out) {
    frame(Math.max(S.redd, s), f);
    return out.set(-f.tx, 0, -f.tz).normalize();
  }
  function draw(mesh, slot, position, heading, size, phase, amplitude, gape, rollAngle = 0) {
    axisZ.crossVectors(heading, UP);
    if (axisZ.lengthSq() < 1e-6) axisZ.set(0, 0, 1);
    axisZ.normalize();
    axisY.crossVectors(axisZ, heading).normalize();
    basis.makeBasis(heading, axisY, axisZ);
    quaternion.setFromRotationMatrix(basis);
    if (rollAngle) quaternion.multiply(roll.setFromAxisAngle(tmp.set(1, 0, 0), rollAngle));
    const k = size / MODEL_LENGTH;
    matrix.compose(position, quaternion, scale.set(k, k, k));
    mesh.body.setMatrixAt(slot, matrix);
    mesh.swim.setXYZW(slot, phase, amplitude, 0, 0.3);
    mesh.fin.setX(slot, phase * 0.6);
    mesh.mouth.setX(slot, gape);
  }

  return {
    meshes,
    state,
    her,
    get on() {
      return state.on;
    },
    start(fish) {
      state.on = true;
      state.courtship = 0;
      state.ready = false;
      state.rival = null;
      state.drivenOff = 0;
      state.spawning = false;
      clock = 0;
      nextRival = 7;
      spot(0, 0, 0.35 * her.size * 0.5, her.position);
      upstream(S.redd, her.heading);
      her.dig = 0;
      her.digNext = 1.5;
      rivals.forEach((r, i) => {
        spot(26 + i * 10, i ? 0.45 : -0.45, 2.2, r.home);
        r.position.copy(r.home);
        upstream(S.redd + 26, r.heading);
        r.mode = "wait";
        r.until = 0;
      });
      small.t = -1;
      puffs.visible = true;
    },
    stop() {
      state.on = false;
      state.spawning = false;
      state.courtship = 0;
      state.ready = false;
      puffs.visible = false;
      for (const m of [hen, cocks, sneaker]) {
        m.begin();
        m.finish();
      }
    },
    // Spawning now (main.js): she and he over the pit, the milt, and the little parr.
    spawn(fish) {
      state.spawning = true;
      small.t = 0;
      spot(40, 0.6, 0.6, small.position);
    },
    // Rivals after her, for the warning arrows.
    threats(fish, out) {
      if (!state.on || state.spawning) return out;
      for (const r of rivals) if (r.mode === "approach" || r.mode === "court") out.push({ position: r.position, level: r.mode === "court" ? 0.9 : 0.7, kind: "rival", title: "Rivale", key: r });
      return out;
    },
    // Returns what happened: { driven } (a rival sent off by a blow).
    update(dt, fish, time) {
      const happened = { driven: false };
      if (!state.on) return happened;
      clock += dt;
      const L = fish.length;
      // ---- The hen: holding over the redd, facing up the current; now and then over on her
      // side, beating the gravel with her tail.
      her.digNext -= dt;
      if (her.dig <= 0 && her.digNext <= 0 && !state.spawning) {
        her.dig = 1.6;
        her.digNext = 3 + Math.random() * 2.5;
      }
      let amplitude = 0.35;
      if (her.dig > 0) {
        her.dig -= dt;
        amplitude = 1;
        if (Math.random() < dt * 9) puff(tmp.copy(her.position).addScaledVector(her.heading, -her.size * 0.4).setY(her.position.y - 0.3), [0.45, 0.38, 0.26], 3, 1.6);
      }
      const wantRoll = her.dig > 0 ? 1.25 : state.spawning ? 0.2 : 0;
      her.roll += (wantRoll - her.roll) * (1 - Math.exp(-dt * 6));
      her.phase = (her.phase + dt * TAU * (her.dig > 0 ? 3.2 : state.spawning ? 5 : 1.1)) % TAU;
      hen.begin();
      draw(hen, 0, her.position, her.heading, her.size, her.phase, state.spawning ? 0.6 : amplitude, state.spawning ? 0.9 : 0.1, her.roll);
      hen.finish();

      // ---- Courting: by her side, with no other cock there.
      const near = fish.position.distanceTo(her.position) < her.size * 0.5 + L * 1.5;
      state.rival = rivals.find((r) => r.mode === "court") ?? null;
      if (!state.spawning) {
        if (state.rival) state.courtship = Math.max(0, state.courtship - dt / 30);
        else if (near) state.courtship = Math.min(1, state.courtship + dt / COURT_SECONDS);
        state.ready = state.courtship >= 1;
      }

      // ---- The rivals.
      // (vegan mode: no fight over her -- the other cocks keep their distance)
      if (!state.spawning && !mode.vegan && clock > nextRival && !rivals.some((r) => r.mode === "approach" || r.mode === "court")) {
        const r = rivals.find((q) => q.mode === "wait" && clock > q.until);
        if (r) {
          r.mode = "approach";
          nextRival = clock + 9 + Math.random() * 6;
        }
      }
      cocks.begin();
      for (const r of rivals) {
        const top = 12;
        if (r.mode === "wait") {
          want.subVectors(r.home, r.position).multiplyScalar(0.8);
          upstream(S.redd + 20, tmp);
          r.heading.lerp(tmp, 1 - Math.exp(-dt * 2)).normalize();
        } else if (r.mode === "approach" || r.mode === "court") {
          // To her flank, the side away from the salmon.
          const side = tmp.crossVectors(her.heading, UP).normalize();
          const toFish = fish.position.clone().sub(her.position).dot(side);
          const target = her.position.clone().addScaledVector(side, (toFish > 0 ? -1 : 1) * her.size * 0.28).addScaledVector(her.heading, -her.size * 0.1);
          want.subVectors(target, r.position).multiplyScalar(1.5);
          if (r.mode === "approach" && r.position.distanceTo(target) < her.size * 0.3) r.mode = "court";
          if (r.velocity.lengthSq() > 0.5) r.heading.lerp(tmp.copy(r.velocity).normalize(), 1 - Math.exp(-dt * 4)).normalize();
          else r.heading.lerp(her.heading, 1 - Math.exp(-dt * 3)).normalize();
          // Struck in a dash: off he goes.
          if (fish.lunging > 0 && !fish.safe && !mode.vegan) {
            const hit = fish.mouth ? fish.mouth.distanceTo(r.position) : fish.position.distanceTo(r.position);
            if (hit < r.size * 0.45 + L * 0.3) {
              r.mode = "flee";
              r.until = clock + 4;
              r.gape = 1;
              state.drivenOff++;
              happened.driven = true;
            }
          }
        } else if (r.mode === "flee") {
          // Away down the brook, fast, then back to wait his turn.
          upstream(S.redd + 30, tmp).negate();
          want.copy(tmp).multiplyScalar(top);
          r.heading.lerp(tmp, 1 - Math.exp(-dt * 5)).normalize();
          if (clock > r.until) {
            r.mode = "wait";
            r.until = clock + 10 + Math.random() * 8;
          }
        }
        if (state.spawning && r.mode !== "flee") {
          r.mode = "wait";
        }
        want.clampLength(0, top);
        r.velocity.lerp(want, 1 - Math.exp(-dt * 3));
        r.position.addScaledVector(r.velocity, dt);
        // In the water, off the bottom.
        locate(r.position.x, r.position.z, S.redd + 20, at);
        const floor = bed(at.s, at.u);
        r.position.y = clamp(r.position.y, floor + r.size * 0.12, level(at.s) - r.size * 0.1);
        const speed = r.velocity.length();
        r.phase = (r.phase + dt * TAU * (1 + speed / r.size * 1.4)) % TAU;
        r.gape = Math.max(0, r.gape - dt * 2);
        draw(cocks, r.slot, r.position, r.heading, r.size, r.phase, 0.3 + Math.min(0.6, speed / r.size * 0.3), Math.max(r.gape, r.mode === "court" ? 0.4 : 0.1));
      }
      cocks.finish();

      // ---- Spawning: the milt, and the little parr darting in and away.
      sneaker.begin();
      if (state.spawning) {
        if (Math.random() < dt * 14) puff(tmp.copy(fish.position).addScaledVector(fish.heading, -L * 0.1).setY(fish.position.y - L * 0.08), [0.95, 0.95, 0.9], 2, 1.2);
        if (small.t >= 0) {
          small.t += dt;
          const k = clamp(small.t / 1.4, 0, 1);
          const back = small.t > 2.6;
          const target = back ? spot(45, -0.5, 0.6, tmp.clone()) : her.position.clone().addScaledVector(her.heading, -her.size * 0.35);
          small.position.lerp(target, 1 - Math.exp(-dt * (back ? 2 : 3.5)));
          small.heading.subVectors(target, small.position).setY(0);
          if (small.heading.lengthSq() < 1e-4) small.heading.copy(her.heading);
          small.heading.normalize();
          small.phase = (small.phase + dt * TAU * 5) % TAU;
          if (small.t < 5) draw(sneaker, 0, small.position, small.heading, 1.3, small.phase, 0.7 * k + 0.3, 0.5);
        }
      }
      sneaker.finish();

      // ---- The clouds drift off down the current, thinning.
      for (let i = 0; i < PUFFS; i++) {
        const p = puffList[i];
        if (p.life <= 0) {
          puffPositions[i * 3 + 1] = -1e4;
          continue;
        }
        p.life -= dt;
        p.velocity.multiplyScalar(Math.exp(-dt * 1.2));
        upstream(S.redd, tmp);
        p.position.addScaledVector(p.velocity, dt).addScaledVector(tmp, -dt * 0.8);
        puffPositions[i * 3] = p.position.x;
        puffPositions[i * 3 + 1] = p.position.y;
        puffPositions[i * 3 + 2] = p.position.z;
      }
      puffGeometry.attributes.position.needsUpdate = true;
      puffGeometry.attributes.color.needsUpdate = true;
      return happened;
    },
  };
}
