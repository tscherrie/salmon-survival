import * as THREE from "three";

// Fighting back. Every fish that hunts the salmon, and every young salmon holding a spot,
// has the same two reserves the salmon has:
//
//   Puste   the white muscle's breath for bursts: every snap and every chase spends it,
//           and it comes back while the fish holds still; with none left the fish is out of
//           breath -- slow, turning heavily, unable to strike
//   Kraft   its strength, which the salmon's blows take away and which does not come back
//           in a fight; the breath can never be more than the strength
//
// A burst (Space) that lands on another fish is a blow. On its flank it hurts, on its tail
// more, and on a fish out of breath more still, since it cannot twist away; the smaller the
// salmon against it, the less each blow does. Head on, it hardly hurts it at all -- and a
// fish big enough to swallow the salmon will simply snap. A fish whose strength is gone has
// lost: it flees and never goes for the salmon again.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const BLOW = { front: 0.04, flank: 0.12, rear: 0.18 };
const toMouth = new THREE.Vector3();
const closest = new THREE.Vector3();
const apart = new THREE.Vector3();

// A new fish: not every one is in its prime. Most are strong, some past it, and now and
// then one is old or sick and has only a fraction of the strength of the others -- which
// the salmon learns only once it has struck it.
export function freshFighter(f, random = Math.random) {
  const r = random();
  f.maxKraft = r < 0.18 ? 0.22 + 0.28 * random() : r < 0.45 ? 0.5 + 0.25 * random() : 0.75 + 0.25 * random();
  f.kraft = f.maxKraft;
  f.puste = f.kraft;
  f.weak = f.maxKraft < 0.5;
  f.beaten = false;
  f.struck = false;
  f.fightAt = -1e9;
  f.hitBy = -1;
  f.gasping = false;
  return f;
}

// Where the salmon's lunge meets another fish's body -- "front", "flank", "rear" -- or null.
// `other`: { position, heading, size }; its body runs from about half a length behind its
// middle to a little under half a length ahead.
export function contact(fish, other) {
  const L = fish.length;
  const size = other.size;
  toMouth.subVectors(fish.mouth, other.position);
  const along = clamp(toMouth.dot(other.heading), -0.5 * size, 0.45 * size);
  closest.copy(other.position).addScaledVector(other.heading, along);
  if (fish.mouth.distanceTo(closest) > 0.1 * size + 0.22 * L + 0.05) return null;
  apart.subVectors(fish.position, other.position);
  const front = apart.lengthSq() > 1e-8 ? other.heading.dot(apart.normalize()) : 0;
  if (along > 0.22 * size && front > 0.35) return "front";
  if (along < -0.15 * size || front < -0.45) return "rear";
  return "flank";
}

// How hard a blow of this kind lands: against a fish ten times as long a fry does about a
// third of what an equal does.
export function blow(where, L, size, winded) {
  const power = clamp(1.6 * Math.pow(L / size, 0.6), 0.35, 1.4);
  return BLOW[where] * power * (winded ? 1.5 : 1);
}

// Take a blow: strength goes, and breath with it.
export function takeBlow(f, amount) {
  f.struck = true;
  f.kraft = Math.max(0, f.kraft - amount);
  f.puste = Math.min(f.kraft, Math.max(0, f.puste - amount * 1.5));
  if (f.kraft <= 0) f.beaten = true;
  return f.beaten;
}

// Breath: spent by effort (per second or at once), back while resting, never above the
// strength.
export function breathe(f, dt, { effort = 0, rest = false } = {}) {
  if (rest) f.puste = Math.min(f.kraft, f.puste + 0.08 * dt);
  f.puste = Math.max(0, f.puste - effort * dt);
  // Strength comes back only slowly, and only when the fight is long over.
  const most = f.maxKraft ?? 1;
  if (rest && f.kraft < most) f.kraft = Math.min(most, f.kraft + 0.004 * dt);
}
// Out of breath: once spent it stays so until it has most of it back (as the salmon does).
export function winded(f) {
  if (f.puste < 0.1) f.gasping = true;
  else if (f.puste > 0.45) f.gasping = false;
  return !!f.gasping;
}
