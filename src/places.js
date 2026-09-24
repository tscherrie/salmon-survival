import { REACHES, place } from "./course.js";

// The places of the river worth finding: the named reaches (the spring pool, the rock
// gorge, the weir pond ...), and the special places built into the river -- islands, a
// side brook, caves, a mill, a bridge, a wreck. Each is found by swimming into it; finding
// it earns its badge, puts it in the logbook and marks it on the maps.
//
// A place is { id, name, line, s, u, radius } (found within `radius` of the point s, u) or
// { id, name, line, from, to } (found anywhere in that stretch). `icon` picks the medal.

export const PLACES = [];

// The named reaches of the course.
const REACH_LINES = {
  Quelltopf: "Die Quelle, wo du geschlüpft bist",
  Brutbecken: "Ruhiges Wasser für die Kleinsten",
  Moorstrecke: "Braunes, stilles Moorwasser",
  Klamm: "Durch die Felsenklamm",
  Stillwasser: "Ein stiller, breiter Abschnitt",
  Stromenge: "Wo der große Fluss eng wird",
  Wehrstau: "Der Stau vor dem Wehr",
  Felsenge: "Die Felsenge im Unterlauf",
  Altarm: "Ein stiller Seitenarm voller Kraut",
  Felsschlucht: "Wo sich der Fluss durch den Fels zwängt",
};
for (const r of REACHES)
  if (r.name)
    PLACES.push({
      id: `reach-${r.name.toLowerCase()}`,
      name: r.name,
      line: REACH_LINES[r.name] ?? "Ein neuer Ort",
      from: r.from,
      to: r.to,
      s: (r.from + r.to) / 2,
      u: 0,
      icon: "place",
      tier: "bronze",
    });

// Other modules add their places here as they build them (see addPlace).
export function addPlace(p) {
  if (!PLACES.some((q) => q.id === p.id)) PLACES.push({ icon: "place", tier: "silver", u: 0, ...p });
}

export function createPlaces({ badges }) {
  const badge = (p) => ({ group: "Orte", title: p.name, line: p.line, icon: p.icon ?? "place", tier: p.tier ?? "silver", kicker: "Ort entdeckt" });
  for (const p of PLACES) badges.register(`place:${p.id}`, badge(p));
  let clock = 0;
  const at = {};
  const api = {
    // Places found so far (for the maps).
    found() {
      return PLACES.filter((p) => badges.has(`place:${p.id}`));
    },
    // The place the fish is in just now, if any.
    here: null,
    update(dt, fish) {
      clock += dt;
      if (clock < 0.25) return;
      clock = 0;
      const s = fish.river.s,
        u = fish.river.u;
      api.here = null;
      for (const p of PLACES) {
        let inside;
        if (p.from !== undefined) inside = s > p.from && s < p.to;
        else {
          if (Math.abs(s - p.s) > p.radius * 1.5 + 40) continue;
          place(p.s, p.u, at);
          inside = Math.hypot(fish.position.x - at.x, fish.position.z - at.z) < p.radius;
        }
        if (!inside) continue;
        if (!api.here || p.radius) api.here = p;
        badges.register(`place:${p.id}`, badge(p));
        badges.award(`place:${p.id}`, badge(p));
      }
    },
  };
  return api;
}
