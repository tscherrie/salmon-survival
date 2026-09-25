import * as THREE from "three";
import { MODEL_LENGTH, createFishMesh } from "./anatomy.js";
import { S, bed, current, frame, level, locate, place, regionWeights, section } from "./course.js";
import { phaseOf } from "./salmon.js";
import { blow, breathe, contact, freshFighter, takeBlow, winded } from "./fight.js";
import { mode } from "./vegan.js";

// Other young salmon, each holding its own patch of the river. A fry or parr that has a
// good spot -- in front of a stone, where the drift comes past close and the current is
// broken -- keeps it: it holds there facing into the current, darts out at whatever drifts
// by and back, and drives off any other young fish that comes too close. First it turns
// to face the intruder and spreads its fins; then it charges and nips.
//
// The player's fish can take a spot for itself by fighting for it (see fight.js): bursts
// (Space) into the holder's flank or tail wear its strength down, head to head both take
// it; the holder nips back while it has the breath. Beaten, it is driven off, and the spot
// is the fish's own for as long as it stays near, with more of the drift coming its way.

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const COUNT = 5;

export function createRivals(scene, { random }) {
  const range = (a, b) => a + (b - a) * random();
  const mesh = createFishMesh(scene, "parr", "parr", COUNT, { name: "Rival parr", cacheKey: "rival-parr", detail: 0.55, castShadow: false });
  const list = Array.from({ length: COUNT }, (_, i) => ({
    slot: i,
    active: false,
    position: new THREE.Vector3(0, -1e4, 0),
    home: new THREE.Vector3(),
    heading: new THREE.Vector3(1, 0, 0),
    upstream: new THREE.Vector3(-1, 0, 0),
    river: { s: -1e5, u: 0 },
    size: 0.6,
    mode: "hold",
    until: 0,
    cool: 0,
    feedCool: range(1, 4),
    fightCool: 0,
    target: null,
    phase: range(0, TAU),
    finPhase: 0,
    gape: 0,
    speed: 0,
    kraft: 1,
    puste: 1,
  }));
  for (const r of list) freshFighter(r, random);
  const territory = { active: false, x: 0, y: 0, z: 0, radius: 0, away: 0, inside: false };
  const flow = {};
  const at = {};
  const weights = {};
  const toFish = new THREE.Vector3();
  const want = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  let time = 0;

  const suitable = (s, stage) => {
    regionWeights(s, weights);
    return weights.brook + weights.upper * 0.9 + (phaseOf(stage) === "parr" ? weights.middle * 0.6 : 0);
  };
  function turn(r, direction, rate, dt) {
    tmp.copy(direction);
    tmp.y = clamp(tmp.y, -0.5 * tmp.length(), 0.5 * tmp.length());
    if (tmp.lengthSq() < 1e-8) return;
    tmp.normalize();
    const angle = Math.acos(clamp(r.heading.dot(tmp), -1, 1));
    if (angle < 1e-4) return;
    r.heading.lerp(tmp, Math.min(1, (rate * dt) / angle)).normalize();
  }
  // A holder somewhere ahead of the fish, on a spot where the drift comes past.
  function settle(r, fish, travel) {
    const L = fish.length;
    for (let tries = 0; tries < 8; tries++) {
      const s = fish.river.s + (travel || 1) * range(10, 45) * (1 + L * 0.6);
      if (s < 130 || s > S.coast - 1500) continue;
      if (random() > suitable(s, fish.stage)) continue;
      const c = section(s);
      const u = c.thalweg + range(-0.7, 0.7) * c.half;
      const floor = bed(s, u);
      const lv = level(s);
      const depth = lv - floor;
      if (depth < 0.8 + L * 1.5) continue;
      place(s, u, at);
      const y = floor + Math.min(depth * 0.35, 0.3 + L * 0.7);
      r.home.set(at.x, y, at.z);
      r.position.copy(r.home);
      frame(s, at);
      r.upstream.set(-at.tx, 0, -at.tz);
      r.heading.copy(r.upstream);
      r.river.s = s;
      r.river.u = u;
      r.size = L * range(0.8, 1.3);
      r.mode = "hold";
      r.cool = 0;
      r.speed = 0;
      r.active = true;
      freshFighter(r, random);
      return;
    }
  }

  return {
    list,
    territory,
    meshes: [mesh.body, mesh.membranes],
    reset() {
      for (const r of list) r.active = false;
      territory.active = false;
    },
    // The holder the fish is fighting, or the one squaring up to it.
    foe(fish) {
      let best = null,
        bestScore = -Infinity;
      for (const r of list) {
        // Only one it has struck: until then it cannot tell how strong it is.
        if (!r.active || !r.struck) continue;
        const d = r.position.distanceTo(fish.position);
        const since = time - r.fightAt;
        const recent = since < 12 && (r.mode !== "flee" || since < 3);
        const engaged = ((r.mode === "display" || r.mode === "charge") && d < 3 * r.size + 1) || (r.mode !== "flee" && d < 1.6 * r.size + 0.6);
        if (!recent && !engaged) continue;
        const score = (recent ? 100 - since : 0) - d;
        if (score > bestScore) {
          bestScore = score;
          best = r;
        }
      }
      return best && { score: bestScore, weak: best.weak, kind: "rival", title: "Junger Lachs", kraft: best.kraft, puste: best.puste, winded: winded(best), beaten: best.beaten, position: best.position, heading: best.heading, size: best.size };
    },
    // Returns what happened between the fish and the holders this frame.
    update(dt, fish, { travel = 1, food = [], cruise = 1 } = {}) {
      time += dt;
      const events = [];
      const L = fish.length;
      const phase = phaseOf(fish.stage);
      const young = (phase === "fry" || phase === "parr") && !fish.captive && !fish.airborne;
      const wanted = young ? (phase === "fry" ? 3 : 4) : 0;
      let activeCount = 0;
      for (const r of list) if (r.active) activeCount++;
      mesh.begin();
      for (const r of list) {
        if (!r.active) {
          if (activeCount < wanted && random() < dt * 0.25) {
            settle(r, fish, travel);
            if (r.active) activeCount++;
          }
          continue;
        }
        locate(r.position.x, r.position.z, r.river.s, r.river);
        if (!young || Math.abs(r.river.s - fish.river.s) > 140 || (r.mode === "flee" && time > r.until)) {
          r.active = false;
          continue;
        }
        current(r.river.s, r.river.u, r.position.y, flow, time);
        const lv = level(r.river.s);
        const floor = bed(r.river.s, r.river.u);
        const burst = 10 * Math.pow(r.size, 0.7);
        const swim = 3.4 * Math.pow(r.size, 0.645);
        toFish.subVectors(fish.position, r.position);
        const d = toFish.length();
        const reach = 2.2 * r.size + 0.5;
        r.cool = Math.max(0, r.cool - dt);
        r.feedCool = Math.max(0, r.feedCool - dt);
        r.fightCool = Math.max(0, r.fightCool - dt);
        let speed = 0;
        let gape = 0;

        // A fight: a burst that lands on the holder is a blow.
        // (vegan mode: no blows either way -- the holders let it pass, and it hurts none)
        if (fish.lunging > 0 && r.hitBy !== fish.lungeCount && r.mode !== "flee" && !fish.safe && d < 1.5 * (L + r.size) && d > 1e-3 && !mode.vegan) {
          const where = contact(fish, r);
          if (where) {
            r.hitBy = fish.lungeCount;
            r.fightAt = time;
            const tired = winded(r);
            let beaten;
            if (where === "front") {
              // Head to head: both take it, the smaller the worse.
              beaten = takeBlow(r, blow("front", L, r.size, tired) * 2);
              fish.energy = Math.max(0, fish.energy - 0.04 * clamp(r.size / L, 0.5, 2));
              fish.relative.addScaledVector(toFish, (1 + 2 * r.size) / d);
            } else beaten = takeBlow(r, blow(where, L, r.size, tired));
            fish.relative.multiplyScalar(0.5);
            r.position.addScaledVector(fish.heading, 0.15 * L);
            events.push({ type: "hit", kind: "rival", title: "Junger Lachs", where, beaten, winded: tired });
            if (beaten) {
              r.mode = "flee";
              r.until = time + 5;
              territory.active = true;
              territory.x = r.home.x;
              territory.y = r.home.y;
              territory.z = r.home.z;
              territory.radius = reach * 1.4;
              territory.away = 0;
              events.push({ type: "won" });
            } else if (!winded(r)) {
              // It hits back.
              r.mode = "charge";
              r.until = time + 1.2;
              r.puste = Math.max(0, r.puste - 0.15);
            } else r.mode = "return";
          }
        }

        switch (r.mode) {
          case "hold": {
            // Station: nose into the current, holding just where it was.
            want.subVectors(r.home, r.position);
            const off = want.length();
            speed = Math.min(swim, off * 1.5);
            turn(r, off > 0.3 * r.size ? want : r.upstream, 4, dt);
            // Drift coming past: out and take it.
            if (r.feedCool <= 0) {
              let best = null,
                bestD = 1.3 * r.size + 0.3;
              for (const item of food) {
                if (!item.alive || item.held || item.eatenAt >= 0 || item.size > r.size * 0.45) continue;
                const dd = item.position.distanceTo(r.position);
                if (dd < bestD) {
                  bestD = dd;
                  best = item;
                }
              }
              if (best) {
                r.target = best;
                r.mode = "feed";
                r.until = time + 0.8;
              } else r.feedCool = range(0.5, 1.5);
            }
            // An intruder in its patch: turn to face it and spread the fins.
            if (d < reach && r.cool <= 0 && young && !fish.safe && !winded(r) && !mode.vegan) {
              r.mode = "display";
              r.until = time + 0.7;
              events.push({ type: "display" });
            }
            break;
          }
          case "feed": {
            const item = r.target;
            if (!item || !item.alive || time > r.until) {
              r.mode = "return";
              r.feedCool = range(1.5, 4);
              break;
            }
            want.subVectors(item.position, r.position);
            turn(r, want, 9, dt);
            speed = burst * 0.7;
            gape = 0.8;
            if (want.length() < 0.25 * r.size + 0.05) {
              item.alive = false;
              r.mode = "return";
              r.feedCool = range(1.5, 4);
            }
            break;
          }
          case "display": {
            turn(r, toFish, 7, dt);
            gape = 0.35;
            speed = 0;
            if (d > reach * 1.4) r.mode = "return";
            else if (time > r.until) {
              r.mode = "charge";
              r.until = time + 1.2;
              r.puste = Math.max(0, r.puste - 0.15);
            }
            break;
          }
          case "charge": {
            want.copy(fish.position).addScaledVector(fish.velocity, 0.15).sub(r.position);
            turn(r, want, 8, dt);
            speed = burst * 0.8;
            gape = 0.6;
            if (d < 0.45 * (L + r.size) + 0.05 && !fish.safe) {
              // The nip: the intruder is driven off.
              fish.relative.addScaledVector(toFish, (2 + 2.5 * r.size) / Math.max(d, 1e-3));
              fish.energy = Math.max(0, fish.energy - 0.02);
              r.mode = "return";
              r.cool = range(1.2, 2.5);
              events.push({ type: "nip" });
            } else if (time > r.until || d > reach * 2) {
              r.mode = "return";
              r.cool = 0.8;
            }
            break;
          }
          case "return": {
            want.subVectors(r.home, r.position);
            turn(r, want, 5, dt);
            speed = swim;
            if (want.length() < 0.25 * r.size + 0.1) r.mode = "hold";
            break;
          }
          case "flee": {
            // Beaten: off downstream and away from the winner.
            want.copy(toFish).multiplyScalar(-1).addScaledVector(r.upstream, -2 * d);
            turn(r, want, 6, dt);
            speed = burst * 0.6;
            break;
          }
        }
        // Its breath: back while it holds its spot, and out of breath it is slow.
        breathe(r, dt, { rest: ["hold", "feed", "return"].includes(r.mode) && time - r.fightAt > 1.5 });
        if (r.mode !== "flee") speed *= 0.45 + 0.55 * Math.min(1, r.puste / 0.35);
        r.speed += (speed - r.speed) * (1 - Math.exp(-dt * 6));
        r.position.addScaledVector(r.heading, r.speed * dt);
        // The current pushes; a holder leans into it.
        if (r.mode === "flee") r.position.addScaledVector(tmp.set(flow.vx, 0, flow.vz), dt * 0.6);
        r.position.y = clamp(r.position.y, floor + r.size * 0.15, lv - r.size * 0.2);
        r.gape += (gape - r.gape) * (1 - Math.exp(-dt * 12));
        const beat = 1 + (r.speed / Math.max(r.size, 0.1)) * 1.5 + flow.speed * 0.3;
        r.phase = (r.phase + dt * TAU * beat) % TAU;
        r.finPhase = (r.finPhase + dt * TAU * (r.mode === "display" ? 4 : 1.6)) % TAU;
        axisZ.crossVectors(r.heading, UP);
        if (axisZ.lengthSq() < 1e-6) axisZ.set(0, 0, 1);
        axisZ.normalize();
        axisY.crossVectors(axisZ, r.heading).normalize();
        basis.makeBasis(r.heading, axisY, axisZ);
        quaternion.setFromRotationMatrix(basis);
        const k = r.size / MODEL_LENGTH;
        matrix.compose(r.position, quaternion, scale.set(k, k, k));
        mesh.body.setMatrixAt(r.slot, matrix);
        mesh.swim.setXYZW(r.slot, r.phase, 0.25 + Math.min(0.5, (r.speed / Math.max(r.size, 0.1)) * 0.12), 0, r.mode === "display" ? 0.9 : 0.25);
        mesh.fin.setX(r.slot, r.finPhase);
        mesh.mouth.setX(r.slot, r.gape);
      }
      mesh.finish();

      // The fish's own spot: kept while it stays near, lost once it has been away a while.
      if (territory.active) {
        const d = Math.hypot(fish.position.x - territory.x, fish.position.z - territory.z);
        territory.inside = d < territory.radius;
        if (d > territory.radius * 2.5) territory.away += dt;
        else territory.away = 0;
        if (territory.away > 25 || !young) {
          territory.active = false;
          territory.inside = false;
          if (young) events.push({ type: "leftTerritory" });
        }
      } else territory.inside = false;
      void cruise;
      return events;
    },
  };
}
