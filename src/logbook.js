import { relaid, FALLS, S, frame, place, regionWeights } from "./course.js";

// The logbook (L): a map of the whole river from the spring to the sea, with where the
// fish is now, the stretches it has swum and the falls it has climbed; and everything it
// has met on the way -- what it has eaten, the fish it has seen, the hunters it has met.
// It is kept across lives and generations: a collection to fill.

const STORAGE = "salmon-survival-logbook";

export const CATALOGUE = {
  food: {
    title: "Futter",
    kinds: {
      blackfly: "Kriebelmückenlarve",
      midge: "Zuckmückenlarve",
      egg: "Forellenei",
      mayfly: "Eintagsfliegenlarve",
      gammarus: "Bachflohkrebs",
      caddis: "Köcherfliegenlarve",
      stonefly: "Steinfliegenlarve",
      snail: "Schnecke",
      leech: "Egel",
      ant: "Ameise",
      fly: "Fliege",
      insect: "Käfer",
      earthworm: "Regenwurm",
      krill: "Krill",
      bread: "Brotkrume",
      pellet: "Futterpellet",
    },
  },
  fish: {
    title: "Fische",
    kinds: { minnow: "Elritze", stickleback: "Stichling", grayling: "Äsche", eel: "Aal", sandeel: "Sandaal", herring: "Hering", mackerel: "Makrele", rival: "Junger Lachs" },
  },
  hunters: {
    title: "Jäger",
    kinds: {
      trout: "Bachforelle",
      bullhead: "Groppe",
      kingfisher: "Eisvogel",
      merganser: "Gänsesäger",
      heron: "Graureiher",
      perch: "Flussbarsch",
      pike: "Hecht",
      otter: "Otter",
      bear: "Braunbär",
      cod: "Dorsch",
      seal: "Seehund",
      king: "Der alte König",
    },
  },
};
const REGIONS = [
  ["brook", "Bach"],
  ["upper", "Oberlauf"],
  ["middle", "Mittellauf"],
  ["lower", "Unterlauf"],
  ["estuary", "Mündung"],
  ["sea", "Meer"],
];
// The landmarks on the map.
const STATIONS = [
  { s: 12, name: "Quelle", redd: true },
  { s: 170, name: "Kaskade", fall: "Kaskade" },
  { s: 1480, name: "Bachstufe", fall: "Bachstufe" },
  { s: 5200, name: "Lachsfall", fall: "Lachsfall" },
  { s: 6470, name: "Steinstufe", fall: "Steinstufe" },
  { s: relaid(9800), name: "Fischtreppe", fall: "Fischtreppe" },
  { s: relaid(12950), name: "Felsschwelle", fall: "Felsschwelle" },
  { s: S.coast, name: "Mündung" },
  { s: S.coast + 1300, name: "Meer" },
];

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (data && data.seen) return data;
  } catch {}
  return { seen: { food: {}, fish: {}, hunters: {} }, falls: [], regions: [] };
}

// The sketch map of the whole river, shared by the logbook and the minimap: the river's
// line from the spring to well out to sea, each piece with the stretch it belongs to, and
// the projection onto a W × H map. Not a survey: the journey down the river runs from left
// to right, the little brook where a young fish spends its first seasons drawn out wider
// than its length, the long lower river pressed together; the bends as they are.
let sketch = null;
export function riverSketch() {
  if (sketch) return sketch;
  const line = [];
  const weights = {};
  for (let s = -150; s <= S.coast + 1600; s += 40) {
    const p = s >= S.straight ? place(s, 0, {}) : frame(s, {});
    regionWeights(s, weights);
    let region = "brook",
      bestW = -1;
    for (const [r] of REGIONS)
      if (weights[r] > bestW) {
        bestW = weights[r];
        region = r;
      }
    line.push({ s, x: p.x, z: p.z, region });
  }
  let minZ = Infinity,
    maxZ = -Infinity;
  for (const p of line) {
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const W = 560,
    pad = 40;
  const sMax = line[line.length - 1].s;
  const warp = (s) => (Math.sqrt(Math.max(0, s + 300)) - Math.sqrt(150)) / (Math.sqrt(sMax + 300) - Math.sqrt(150));
  const kz = Math.min(0.06, 190 / Math.max(1, maxZ - minZ));
  const H = Math.round((maxZ - minZ) * kz + 2 * pad + 24);
  const toMap = (s, z) => [pad + (W - 2 * pad) * warp(s), pad + 12 + (z - minZ) * kz];
  // Where a swimmer at (s, z) goes on the map, kept on it.
  const locate = (s, z) => toMap(Math.min(Math.max(s, -150), sMax), Math.min(Math.max(z, minZ - 60), maxZ + 60));
  sketch = { line, W, H, pad, toMap, locate, sMax, WIDTH: { brook: 3, upper: 5, middle: 7.5, lower: 10, estuary: 13, sea: 16 }, STATIONS };
  return sketch;
}

// The badges the logbook hands out: for each kind of food, fish and hunter found, for each
// fighting hunter beaten, each fall climbed, each stretch of river reached, and for having
// found them all.
const FIGHTERS = { trout: "Bachforelle", bullhead: "Groppe", perch: "Flussbarsch", pike: "Hecht", cod: "Dorsch", rival: "Junger Lachs", king: "Der alte König" };
const FALL_TIERS = { Kaskade: "bronze", Bachstufe: "silver", Lachsfall: "gold", Fischtreppe: "silver", Felsschwelle: "silver" };
const FOUND = {
  food: { group: "Futter", title: (n) => n, line: "Neue Futterart entdeckt", icon: "food", kicker: "Neue Futterart" },
  fish: { group: "Fische", title: (n) => n, line: "Neuer Fisch entdeckt", icon: "fish", kicker: "Neuer Fisch" },
  hunters: { group: "Jäger", title: (n) => n, line: "Ein neuer Jäger – nimm dich in Acht", icon: "hunter", kicker: "Neuer Jäger" },
};
function badgeFor(group, kind) {
  const f = FOUND[group];
  const name = CATALOGUE[group].kinds[kind];
  return { group: f.group, title: f.title(name), line: f.line, icon: f.icon, kicker: f.kicker, tier: group === "hunters" ? "silver" : "bronze" };
}

export function createLogbook({ hud, badges = null, places = null }) {
  const data = load();
  const box = document.querySelector("#logbook");
  const mapBox = box.querySelector(".map");
  const listBox = box.querySelector(".species");
  const badgeBox = box.querySelector(".badges");
  const genBox = box.querySelector(".gen");
  let dirty = false;
  let saveClock = 0;
  let lastS = null;
  const present = [];
  const weights = {};
  const { line, W, H, toMap, locate, WIDTH } = riverSketch();

  // Every badge the logbook can give, so the collection shows what is still to find; and
  // whatever an earlier life already found, counted without fuss.
  const fallBadge = (name) => ({ group: "Wasserfälle", title: name, line: `${name} geschafft`, icon: "fall", tier: FALL_TIERS[name] ?? "silver", kicker: "Geschafft" });
  const regionBadge = (r, name) => ({ group: "Flussabschnitte", title: name, line: r === "sea" ? "Das offene Meer!" : `Du hast den ${name} erreicht`, icon: "region", tier: r === "sea" ? "gold" : "bronze", kicker: "Neuer Abschnitt" });
  const victoryBadge = (kind) => ({
    group: "Siege",
    title: `${FIGHTERS[kind]} besiegt`,
    line: kind === "rival" ? "Du hast dir ein Revier erkämpft" : kind === "king" ? "Der Herr der Königsgumpe ist geschlagen" : "Sie lässt dich jetzt in Ruhe",
    icon: "victory",
    tier: kind === "pike" || kind === "cod" || kind === "king" ? "gold" : "silver",
    kicker: kind === "king" ? "Königsbezwinger" : "Sieg",
  });
  const FEATS = {
    gourmet: { group: "Meisterstücke", title: "Feinschmecker", line: "Jede Futterart gekostet", icon: "feat", tier: "gold" },
    naturalist: { group: "Meisterstücke", title: "Naturkundler", line: "Alle Fische und Jäger gesehen", icon: "feat", tier: "gold" },
    fighter: { group: "Meisterstücke", title: "Kämpfernatur", line: "Fünf Kämpfe gewonnen", icon: "victory", tier: "silver" },
    champion: { group: "Meisterstücke", title: "Flusschampion", line: "Fünfzehn Kämpfe gewonnen", icon: "victory", tier: "gold" },
  };
  if (badges) {
    for (const group of Object.keys(FOUND)) for (const kind of Object.keys(CATALOGUE[group].kinds)) badges.register(`${group}:${kind}`, badgeFor(group, kind));
    for (const kind of Object.keys(FIGHTERS)) badges.register(`victory:${kind}`, victoryBadge(kind));
    for (const name of new Set(FALLS.filter((f) => !f.head).map((f) => f.name))) badges.register(`fall:${name}`, fallBadge(name));
    for (const [r, name] of REGIONS) if (r !== "brook") badges.register(`region:${r}`, regionBadge(r, name));
    for (const [id, def] of Object.entries(FEATS)) badges.register(`feat:${id}`, def);
    for (const group of Object.keys(FOUND)) for (const kind of Object.keys(data.seen[group])) if (CATALOGUE[group].kinds[kind]) badges.award(`${group}:${kind}`, badgeFor(group, kind), { quiet: true });
    for (const kind of Object.keys(data.seen.victories ?? {})) if (FIGHTERS[kind]) badges.award(`victory:${kind}`, victoryBadge(kind), { quiet: true });
    for (const name of data.falls) badges.award(`fall:${name}`, fallBadge(name), { quiet: true });
    for (const [r, name] of REGIONS) if (r !== "brook" && data.regions.includes(r)) badges.award(`region:${r}`, regionBadge(r, name), { quiet: true });
  }
  // Having found them all.
  function feats(quiet = false) {
    if (!badges) return;
    const all = (group) => Object.keys(CATALOGUE[group].kinds).every((k) => data.seen[group][k]);
    if (all("food")) badges.award("feat:gourmet", FEATS.gourmet, { quiet });
    if (all("fish") && all("hunters")) badges.award("feat:naturalist", FEATS.naturalist, { quiet });
    const won = Object.values(data.seen.victories ?? {}).reduce((a, b) => a + b, 0);
    if (won >= 5) badges.award("feat:fighter", FEATS.fighter, { quiet });
    if (won >= 15) badges.award("feat:champion", FEATS.champion, { quiet });
  }
  feats(true);

  function remember(group, kind, count = 1) {
    const seen = data.seen[group];
    const first = !seen[kind];
    seen[kind] = (seen[kind] ?? 0) + count;
    dirty = true;
    if (first && CATALOGUE[group].kinds[kind]) {
      if (badges) {
        badges.award(`${group}:${kind}`, badgeFor(group, kind));
        feats();
      } else hud.note(`Neu im Logbuch: ${CATALOGUE[group].kinds[kind]}`);
    }
    return first && !!CATALOGUE[group].kinds[kind];
  }
  // Something found for the first time and where it is, for the game to point it out.
  const spot = (kind, position) => {
    if (position) api.spotted = { kind, position };
  };
  function persist() {
    if (!dirty) return;
    dirty = false;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(data));
    } catch {}
  }

  function renderMap(fish) {
    const visited = new Set(data.regions);
    const segments = [];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i];
      const best = b.region;
      const width = WIDTH[best];
      const [x1, y1] = toMap(a.s, a.z);
      const [x2, y2] = toMap(b.s, b.z);
      segments.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="${width}" class="${visited.has(best) ? "visited" : "unknown"}"/>`);
    }
    const falls = new Set(data.falls);
    const marks = STATIONS.map((st, i) => {
      const p = st.s >= S.straight ? place(st.s, 0, {}) : frame(st.s, {});
      const [x, y] = toMap(st.s, p.z);
      const done = st.fall && falls.has(st.fall);
      const cls = st.fall ? (done ? "fall done" : "fall") : st.redd ? "redd" : "place";
      const label = `${st.name}${done ? " ✓" : ""}`;
      // Labels above and below the line in turn, so neighbours do not overlap.
      const ly = i % 2 ? y - 12 : y + 22;
      const anchor = i === 0 ? "start" : i === STATIONS.length - 1 ? "end" : "middle";
      return `<g class="${cls}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${st.fall ? 5 : 4}"/><text x="${x.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}">${label}</text></g>`;
    });
    const [fx, fy] = locate(fish.river.s, fish.position.z);
    const regions = REGIONS.map(([r, name]) => `<li class="${visited.has(r) ? "visited" : ""}">${name}</li>`).join("");
    // The places found: gold diamonds, named when hovered.
    const found = (places?.found() ?? []).map((p) => {
      const w = place(p.s, p.u ?? 0, {});
      const [x, y] = locate(p.s, w.z);
      return `<g class="spot"><title>${p.name}</title><rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/></g>`;
    });
    mapBox.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Karte des Flusses">
        <g class="river">${segments.join("")}</g>
        <g class="spots">${found.join("")}</g>
        <g class="stations">${marks.join("")}</g>
        <g class="you"><circle class="pulse" cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="11"/><circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="5.5"/></g>
      </svg>
      <ul class="regions">${regions}</ul>`;
  }
  function renderSpecies() {
    let found = 0,
      total = 0;
    const groups = Object.entries(CATALOGUE).map(([group, { title, kinds }]) => {
      const items = Object.entries(kinds).map(([kind, name]) => {
        total++;
        const n = data.seen[group][kind];
        if (!n) return `<li class="unknown">???</li>`;
        found++;
        const note = group === "food" ? `${n}× gefressen` : group === "fish" ? (data.seen.fishEaten?.[kind] ? `${data.seen.fishEaten[kind]}× gefressen` : "gesehen") : `${n}× begegnet${data.seen.victories?.[kind] ? ` · ${data.seen.victories[kind]}× besiegt` : ""}`;
        return `<li><span class="name">${name}</span><span class="count">${note}</span></li>`;
      });
      return `<div class="group"><h4>${title}</h4><ul>${items.join("")}</ul></div>`;
    });
    listBox.innerHTML = `<h3>Entdeckt <span class="tally">${found} / ${total}</span></h3>${groups.join("")}`;
  }

  const api = {
    open: false,
    // For the minimap: the stretches swum and the falls climbed.
    visited: () => data.regions,
    climbed: () => data.falls,
    toggle(fish, generation = 0) {
      api.open = !api.open;
      box.hidden = !api.open;
      if (api.open) {
        genBox.textContent = `Generation ${generation + 1}`;
        renderMap(fish);
        renderSpecies();
        if (badges && badgeBox) badgeBox.innerHTML = badges.render();
      }
      return api.open;
    },
    close() {
      api.open = false;
      box.hidden = true;
    },
    // Each step: what the fish ate and met, where it is, which falls it has climbed.
    update(dt, fish, life) {
      for (const e of fish.events) {
        if (e.type !== "eat" || !e.kind) continue;
        if (CATALOGUE.food.kinds[e.kind]) remember("food", e.kind);
        else if (CATALOGUE.fish.kinds[e.kind]) {
          remember("fish", e.kind);
          data.seen.fishEaten ??= {};
          data.seen.fishEaten[e.kind] = (data.seen.fishEaten[e.kind] ?? 0) + 1;
        }
      }
      // Hunters about: counted once per meeting.
      const now = life.hunters.present(fish, present);
      api.metNow ??= new Set();
      for (const kind of now)
        if (!api.metNow.has(kind)) {
          api.metNow.add(kind);
          if (remember("hunters", kind)) spot(kind, life.hunters.where?.(kind, fish));
        }
      for (const kind of [...api.metNow]) if (!now.includes(kind)) api.metNow.delete(kind);
      // Shoal fish and young salmon in sight.
      for (const [name, kind] of Object.entries(life.shoals.kinds))
        if (CATALOGUE.fish.kinds[name] && !data.seen.fish[name])
          for (const g of kind.groups) if (g.active && g.centre.distanceTo(fish.position) < 18 + fish.length * 4 && remember("fish", name, 0.0001)) spot(name, g.centre);
      if (!data.seen.fish.rival) {
        const r = life.rivals.list.find((r) => r.active && r.position.distanceTo(fish.position) < 10);
        if (r && remember("fish", "rival", 0.0001)) spot("rival", r.position);
      }
      // The stretch of river it is in.
      regionWeights(fish.river.s, weights);
      for (const [r, name] of REGIONS)
        if (weights[r] > 0.5 && !data.regions.includes(r)) {
          data.regions.push(r);
          dirty = true;
          if (r !== "brook") badges?.award(`region:${r}`, regionBadge(r, name));
        }
      // A fall climbed: crossed going up, by a leap or through the pass.
      const s = fish.river.s;
      if (lastS !== null && !fish.captive)
        for (const f of FALLS) {
          if (f.head) continue;
          if (lastS > f.s + 0.3 && s < f.s - 0.3 && !data.falls.includes(f.name)) {
            data.falls.push(f.name);
            dirty = true;
            if (badges) badges.award(`fall:${f.name}`, fallBadge(f.name), { delay: 1.5 });
            else hud.note(`Logbuch: ${f.name} geschafft`);
          }
        }
      lastS = s;
      saveClock += dt;
      if (saveClock > 5) {
        saveClock = 0;
        persist();
      }
      if (api.open) {
        api.refresh = (api.refresh ?? 0) + dt;
        if (api.refresh > 0.5) {
          api.refresh = 0;
          renderMap(fish);
        }
      }
    },
    // A hunter beaten in a fight.
    victory(kind) {
      data.seen.victories ??= {};
      data.seen.victories[kind] = (data.seen.victories[kind] ?? 0) + 1;
      if (CATALOGUE.hunters.kinds[kind] && !data.seen.hunters[kind]) data.seen.hunters[kind] = 1;
      dirty = true;
      if (badges && FIGHTERS[kind]) {
        badges.award(`victory:${kind}`, victoryBadge(kind), { delay: 1 });
        feats();
      }
    },
    persist,
  };
  return api;
}
