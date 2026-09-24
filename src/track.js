// A few moments worth counting, sent to Vercel Web Analytics (index.html loads its script;
// nothing is sent from a development copy, where there is none). Only what the game is
// doing -- never anything about the player.
//
// Custom events need a paid plan, which the free one only counts page views -- so each
// moment is also counted as a view of a made-up page under /_game/: the name and then the
// data, e.g. /_game/stage/smolt or /_game/death/heron/parr. tools/salmon-stats.sh reads
// them back.
export function track(name, data = {}) {
  try {
    if (!location.hostname.endsWith("vercel.app")) return;
    window.va?.("event", { name, data });
    const parts = Object.values(data)
      .map((v) => String(v).replace(/[^a-z0-9_-]/gi, ""))
      .filter(Boolean);
    window.va?.("pageview", { route: `/_game/${name}`, path: `/_game/${[name, ...parts].join("/")}` });
  } catch {}
}
