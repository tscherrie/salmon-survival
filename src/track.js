// A few moments worth counting, sent to Vercel Web Analytics as custom events (index.html
// loads its script; nothing is sent from a development copy, where there is none). Only
// what the game is doing -- never anything about the player.
export function track(name, data = {}) {
  try {
    if (location.hostname.endsWith("vercel.app")) window.va?.("event", { name, data });
  } catch {}
}
