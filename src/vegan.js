// Vegan mode, chosen on the start card: nobody is eaten. The salmon eats nothing and nothing
// eats it -- no hunters after it, no nets, no angler's hook, no bear at the falls, no
// goosanders driving the smolts, no bait ball -- and it grows with time and with the way it
// swims: down the river while young, anywhere at sea, up the river home (as before). Its
// siblings live too. It can be switched on the card before each swim; ?vegan / ?vegan=0
// sets it for one visit.

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
