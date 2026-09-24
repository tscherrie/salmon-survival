// Badges: a small medal that slides in at the right whenever something is found or done for
// the first time -- a new kind of food, a new fish, a new hunter met, a hunter beaten, a fall
// climbed, a stretch of river reached, a stage of life, a place discovered, and a few feats
// besides -- with a bell or two. Each is earned once, kept across lives and generations,
// and the whole collection (earned and still to find) is in the logbook.
//
// award(id, { title, line, icon, tier }) earns one (false if it was earned already);
// register(id, def) adds one to the collection before it is earned, so the logbook can show
// it as still to find.

const STORAGE = "salmon-survival-badges";

// Little pictures for the medals, as SVG paths on a 24 x 24 box.
export const ICONS = {
  food: '<path d="M12 20c-4 0-6.5-3-6.5-6.5C5.5 9 9 5 12 3c3 2 6.5 6 6.5 10.5C18.5 17 16 20 12 20Z"/><path d="M12 8v9M9.5 11.5 12 14l2.5-2.5"/>',
  fish: '<path d="M3 12c3-4.5 7-6 11-6 3 0 5 2.5 6 6-1 3.5-3 6-6 6-4 0-8-1.5-11-6Z"/><path d="M3 12 1 8.5M3 12l-2 3.5"/><circle cx="16.5" cy="10.5" r="1"/>',
  hunter: '<path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="3"/><path d="M12 10.5v3"/>',
  victory: '<path d="M7 4h10v4a5 5 0 0 1-10 0Z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 2.8 4M17 6h2.5a2.5 2.5 0 0 1-2.8 4M12 13v4M8.5 20h7M10 17h4"/>',
  fall: '<path d="M4 4h9v5"/><path d="M13 9c0 4 1 7 1 11M10 9c0 4 .5 7 .5 11M16 9c.5 4 1.5 7 2 11"/><path d="M3 20h18"/>',
  stage: '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7Z"/>',
  region: '<path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5Z"/><path d="M9 4v13.5M15 6.5V20"/>',
  place: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
  feat: '<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-2 7 5.5-3 5.5 3-2-7"/>',
};

export function createBadges({ sound } = {}) {
  let earned = {};
  try {
    earned = JSON.parse(localStorage.getItem(STORAGE) || "{}") || {};
  } catch {}
  const known = new Map(); // id -> { title, line, icon, tier, group }
  const box = document.querySelector("#badges");
  const queue = [];
  let showing = 0;

  function save() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(earned));
    } catch {}
  }
  function medal(def) {
    return `<span class="medal ${def.tier ?? "bronze"}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[def.icon] ?? ICONS.feat}</svg></span>`;
  }
  // One at a time slides in; up to three stand stacked, the rest wait their turn.
  function pump() {
    while (showing < 3 && queue.length) {
      const def = queue.shift();
      showing++;
      const card = document.createElement("div");
      card.className = `badge ${def.tier ?? "bronze"}`;
      card.setAttribute("role", "status");
      card.innerHTML = `${medal(def)}<span class="words"><em>${def.kicker ?? "Abzeichen"}</em><b></b><span class="line"></span></span>`;
      card.querySelector("b").textContent = def.title;
      card.querySelector(".line").textContent = def.line ?? "";
      box.append(card);
      sound?.chime?.(def.tier);
      setTimeout(() => card.classList.add("leaving"), 4600);
      setTimeout(() => {
        card.remove();
        showing--;
        pump();
      }, 5200);
    }
  }

  const api = {
    // Known to the collection (shown in the logbook as still to find).
    register(id, def) {
      if (!known.has(id)) known.set(id, def);
    },
    has(id) {
      return !!earned[id];
    },
    // Earned now (the first time only): the medal slides in, after `delay` seconds.
    award(id, def, { delay = 0, quiet = false } = {}) {
      api.register(id, def);
      if (earned[id]) return false;
      earned[id] = { at: Date.now() };
      save();
      if (quiet || !box) return true;
      const go = () => {
        queue.push(def);
        pump();
      };
      if (delay > 0) setTimeout(go, delay * 1000);
      else go();
      return true;
    },
    count() {
      return Object.keys(earned).length;
    },
    // The collection for the logbook: groups of earned and still-to-find badges.
    render() {
      const groups = new Map();
      for (const [id, def] of known) {
        const group = def.group ?? "Besonderes";
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push({ id, def, got: !!earned[id] });
      }
      let got = 0;
      const html = [...groups]
        .map(([group, items]) => {
          const cells = items
            .map(({ def, got: have }) => {
              if (have) got++;
              return have
                ? `<li class="got" title="${(def.line ?? "").replace(/"/g, "&quot;")}">${medal(def)}<span>${def.title}</span></li>`
                : `<li class="locked">${medal({ icon: def.icon, tier: "locked" })}<span>???</span></li>`;
            })
            .join("");
          return `<div class="group"><h4>${group}</h4><ul>${cells}</ul></div>`;
        })
        .join("");
      return `<h3>Abzeichen <span class="tally">${got} / ${known.size}</span></h3>${html}`;
    },
  };
  return api;
}
