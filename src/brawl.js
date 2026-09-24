import * as THREE from "three";
import { blow, breathe, contact, freshFighter, takeBlow, winded } from "./fight.js";

// Fighting the rest. Every fish the salmon can reach and cannot swallow -- a shoal fish too
// big for its mouth, a young trout, a smolt of its own school -- takes a blow (Space) the
// way the hunters do, and answers it by how the two measure up: size, what strength each
// has left, and its nature (shoal fish are shy, trout are quick to anger). One that is
// clearly weaker flees and keeps away for a while; one that is a match for the salmon, or
// stronger, turns on it and nips at it until it runs out of breath, is beaten, or the fight
// cools. Nips cost the salmon strength -- and in a fight with none left, it dies (main.js).

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const toFish = new THREE.Vector3();
const head = new THREE.Vector3();

// How a fish measures up against the salmon: above 1, it is the stronger.
export function odds(m, fish, temper = 1) {
  return (temper * m.size * (0.4 + 0.6 * (m.kraft ?? 1))) / (fish.length * (0.4 + 0.6 * clamp(fish.energy, 0, 1)));
}

export function createBrawls(random = Math.random) {
  const hits = [];
  const nips = [];
  let last = null; // { m, kind, title, at }
  let clock = 0;

  return {
    hits,
    nips,
    begin(time) {
      clock = time;
      hits.length = 0;
      nips.length = 0;
    },
    // The salmon's burst landing on `m` ({ position, heading, size }): a blow, and how the fish
    // takes it. Returns true if it landed.
    strike(m, fish, { kind, title, temper = 1 }) {
      if (fish.lunging <= 0 || m.hitBy === fish.lungeCount || fish.safe || fish.captive) return false;
      const reach = m.size + fish.length * 2;
      if (m.position.distanceToSquared(fish.position) > reach * reach) return false;
      const where = contact(fish, m);
      if (!where) return false;
      if (m.kraft === undefined) freshFighter(m, random);
      m.hitBy = fish.lungeCount;
      const tired = winded(m);
      // Whether it stands up to the salmon: how the two measured up as the blow came, give
      // or take its mood.
      const measure = odds(m, fish, temper) * (0.85 + 0.35 * random());
      const beaten = takeBlow(m, blow(where, fish.length, m.size, tired));
      m.fightAt = clock;
      // Knocked aside; the salmon bounces off.
      m.position.addScaledVector(fish.heading, 0.12 * fish.length + 0.02 * m.size);
      fish.relative.multiplyScalar(0.5);
      const fights = !beaten && !tired && measure >= 1;
      m.brawl = fights ? "fight" : "flee";
      m.brawlTitle = title;
      m.brawlUntil = clock + (fights ? 9 : 4);
      last = { m, kind, title, at: clock };
      hits.push({ kind, title, where, beaten, winded: tired, minor: true, fled: !fights });
      return true;
    },
    // What a fish in a brawl does now: sets `desired` (a velocity through the water) and
    // returns true, or returns false when it is not in one. It may nip the salmon.
    move(m, fish, dt, desired, sprint) {
      if (!m.brawl) return false;
      if (clock > m.brawlUntil) {
        if (m.brawl === "fight" || m.brawl === "flee") {
          // After a fight or a flight it keeps its distance for a while.
          m.brawl = "shy";
          m.brawlUntil = clock + 25;
        } else {
          m.brawl = null;
          return false;
        }
      }
      toFish.subVectors(fish.position, m.position);
      const d = Math.max(1e-3, toFish.length());
      if (m.brawl !== "fight") {
        const wide = m.brawl === "flee" ? Infinity : 2 * fish.length + 3 * m.size;
        breathe(m, dt, { rest: true });
        if (d > wide) return false;
        desired.copy(toFish).multiplyScalar((-sprint * (m.brawl === "flee" ? 1 : 0.6)) / d);
        return true;
      }
      if (fish.captive || fish.airborne) {
        m.brawl = "shy";
        m.brawlUntil = clock + 10;
        return false;
      }
      // Out of breath it backs off, panting, and gets it back before it goes in again.
      if (winded(m)) {
        breathe(m, dt, { rest: true });
        desired.copy(toFish).multiplyScalar((-sprint * 0.35) / d);
        m.brawlUntil = Math.max(m.brawlUntil, clock + 2);
        return true;
      }
      breathe(m, dt, { effort: 0.05 });
      // At the salmon's flank, and a nip when its jaws are there.
      desired.copy(toFish).multiplyScalar((sprint * 0.85) / d);
      head.copy(m.position).addScaledVector(m.heading, 0.45 * m.size);
      if (head.distanceTo(fish.position) < 0.4 * fish.length + 0.2 * m.size && clock > (m.nipAt ?? -1e9) + 1.1) {
        m.nipAt = clock;
        m.puste = Math.max(0, m.puste - 0.18);
        const damage = 0.07 * clamp(m.size / fish.length, 0.3, 1.6);
        fish.energy = Math.max(0, fish.energy - damage);
        fish.relative.addScaledVector(toFish, (1.5 * Math.min(1, m.size / fish.length)) / d);
        nips.push({ title: m.brawlTitle ?? "Fisch", damage });
        // Every nip keeps the fight going a little longer.
        m.brawlUntil = Math.max(m.brawlUntil, clock + 4);
      }
      return true;
    },
    // The fish the salmon struck last, for the bar over it, while the fight is fresh.
    foe(fish) {
      if (!last) return null;
      const { m } = last;
      const since = clock - last.at;
      const d = m.position.distanceTo(fish.position);
      if (since > 12 || d > 30 || m.alive === false || m.active === false || (m.brawl !== "fight" && since > 3)) return null;
      return { score: 100 - since - d, weak: m.weak, kind: last.kind, title: last.title, kraft: m.kraft, puste: m.puste, winded: winded(m), beaten: m.beaten, position: m.position, heading: m.heading, size: m.size };
    },
    reset() {
      last = null;
    },
  };
}
