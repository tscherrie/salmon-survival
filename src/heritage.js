// What a fish gets from its parents. A salmon that spawned hands a little of what it was
// good at on to the brood that hatches in its gravel: a leaper's spring, a fighter's burst,
// a good feeder's growth, a wary fish's caution, a long swimmer's stamina -- four per cent
// a step, at most three steps of each, adding up over the generations. A new brood of other
// parents (when a whole brood is lost) starts again with none.

export const heritage = { leap: 0, strength: 0, growth: 0, stealth: 0, stamina: 0 };
export const TRAITS = { leap: "Sprungkraft", strength: "Kampfgeist", growth: "Wuchs", stealth: "Wachsamkeit", stamina: "Ausdauer" };
export const STEP = 0.04;
const MAX = 3;

// How much a trait adds (1 = nothing): leap power, burst, growth.
export const bonus = (key) => 1 + STEP * (heritage[key] ?? 0);
// How much a trait takes off (1 = nothing): how far hunters see it, what swimming costs.
export const less = (key) => 1 - STEP * (heritage[key] ?? 0);

// What the life that spawned was good at: at most two traits, the strongest; none if it
// did nothing much of anything.
export function earned(life = {}) {
  const scores = {
    leap: (life.leaps ?? 0) / 6,
    strength: (life.fights ?? 0) / 3,
    growth: (life.eaten ?? 0) / 800,
    stealth: (life.escapes ?? 0) / 5,
    stamina: (life.distance ?? 0) / 40000,
  };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const keys = ranked.filter(([, v]) => v >= 1).slice(0, 2).map(([k]) => k);
  if (!keys.length && ranked[0][1] >= 0.5) keys.push(ranked[0][0]);
  return keys;
}
// Handed on: one step more of each (up to the most there can be).
export function inherit(keys) {
  for (const k of keys) heritage[k] = Math.min(MAX, (heritage[k] ?? 0) + 1);
}
export function resetHeritage() {
  for (const k of Object.keys(heritage)) heritage[k] = 0;
}
export function loadHeritage(saved) {
  resetHeritage();
  if (!saved) return;
  for (const k of Object.keys(heritage)) if (Number.isFinite(saved[k])) heritage[k] = Math.max(0, Math.min(MAX, Math.round(saved[k])));
}
// The traits it has, for showing: [{ key, name, percent }].
export function traits() {
  return Object.entries(heritage)
    .filter(([, v]) => v > 0)
    .map(([key, v]) => ({ key, name: TRAITS[key], percent: Math.round(v * STEP * 100) }));
}
