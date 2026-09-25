// Vegan mode, chosen on the start card. The world stays as it is -- the drift, the shoals,
// the birds and the bear, the goosanders driving the smolts, the gannets at the bait ball,
// all of them hunting one another as ever -- but nobody goes for the salmon, and the salmon
// goes for nobody: it eats nothing, hunts nothing, strikes no one, is never hungry, and the
// drift is no longer lit up as its food. No net or hook takes it either. It grows with time
// and with the way it swims: down the river while young, anywhere at sea, up the river home.
// It can be switched on the card before each swim; ?vegan / ?vegan=0 sets it for one visit.

const KEY = "salmon-survival-vegan";

function read() {
  const query = new URLSearchParams(location.search);
  if (query.has("vegan")) return query.get("vegan") !== "0";
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const mode = { vegan: read() };

export function setVegan(on) {
  mode.vegan = !!on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
}
