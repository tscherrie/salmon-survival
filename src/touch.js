// Playing on a phone or a tablet, held sideways. The left thumb has a stick, which comes
// to wherever it lands on the left of the screen: up swims (W), sideways turns, down brakes
// and holds on to the bottom (S). The right thumb swipes over the right of the screen to
// look round and to tilt up and down (the mouse on a computer), and has the big button to
// dash, bite and leap (Space). A pause button in the corner; the map comes in from the
// right edge, with a swipe or its tab, and a tap on it puts it away.

const ICONS = {
  bite: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12c2.6-4.2 6.2-6.3 10.2-6.3 2.7 0 4.9 1 6.8 2.8l-3.4 3.5 3.4 3.5c-1.9 1.8-4.1 2.8-6.8 2.8-4 0-7.6-2.1-10.2-6.3Z" /><circle cx="8.6" cy="10.6" r="1.1" /></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6v12M15.5 6v12" /></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5Z" /><path d="M9 4v13.5M15 6.5V20" /></svg>',
};
const RADIUS = 56;

export function createTouch({ habitat, onTouch, onLunge, onLook, onPause, onMap }) {
  const root = document.createElement("div");
  root.id = "touch";
  root.hidden = true;
  root.innerHTML = `
    <div class="look"></div>
    <div class="zone"><div class="stick"><div class="knob"></div></div></div>
    <button class="bite" type="button" aria-label="Biss, Spurt, Sprung">${ICONS.bite}</button>
    <button class="pause" type="button" aria-label="Pause">${ICONS.pause}</button>
    <button class="map-tab" type="button" aria-label="Karte">${ICONS.map}</button>
    <div class="edge"></div>`;
  habitat.append(root);
  // Sideways, please.
  const turn = document.createElement("div");
  turn.id = "rotate";
  turn.innerHTML = '<div class="phone" aria-hidden="true"></div><p>Bitte dreh dein Handy quer.</p>';
  habitat.append(turn);

  const state = { x: 0, y: 0, active: false };
  // The stick.
  const zone = root.querySelector(".zone");
  const stick = root.querySelector(".stick");
  const knob = root.querySelector(".knob");
  let stickId = null,
    ox = 0,
    oy = 0;
  zone.addEventListener("pointerdown", (event) => {
    if (stickId !== null) return;
    event.preventDefault();
    onTouch();
    stickId = event.pointerId;
    zone.setPointerCapture(event.pointerId);
    const box = zone.getBoundingClientRect();
    ox = event.clientX;
    oy = event.clientY;
    // The stick comes to the thumb.
    stick.classList.add("live");
    stick.style.transform = `translate(${ox - box.left - stick.offsetLeft - stick.offsetWidth / 2}px, ${oy - box.top - stick.offsetTop - stick.offsetHeight / 2}px)`;
    state.active = true;
  });
  zone.addEventListener("pointermove", (event) => {
    if (event.pointerId !== stickId) return;
    let dx = event.clientX - ox,
      dy = event.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      dx *= RADIUS / d;
      dy *= RADIUS / d;
    }
    state.x = dx / RADIUS;
    state.y = -dy / RADIUS;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  const release = (event) => {
    if (event.pointerId !== stickId) return;
    stickId = null;
    state.x = state.y = 0;
    state.active = false;
    stick.style.transform = "";
    stick.classList.remove("live");
    knob.style.transform = "";
  };
  zone.addEventListener("pointerup", release);
  zone.addEventListener("pointercancel", release);

  // Swiping on the right: looking round, tilting up and down.
  const look = root.querySelector(".look");
  let lookId = null,
    lx = 0,
    ly = 0;
  look.addEventListener("pointerdown", (event) => {
    if (lookId !== null) return;
    event.preventDefault();
    onTouch();
    lookId = event.pointerId;
    look.setPointerCapture(event.pointerId);
    lx = event.clientX;
    ly = event.clientY;
  });
  look.addEventListener("pointermove", (event) => {
    if (event.pointerId !== lookId) return;
    onLook(event.clientX - lx, event.clientY - ly);
    lx = event.clientX;
    ly = event.clientY;
  });
  const letLook = (event) => {
    if (event.pointerId === lookId) lookId = null;
  };
  look.addEventListener("pointerup", letLook);
  look.addEventListener("pointercancel", letLook);

  const bite = root.querySelector(".bite");
  bite.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    bite.classList.add("pressed");
    onTouch();
    onLunge();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) bite.addEventListener(type, () => bite.classList.remove("pressed"));
  root.querySelector(".pause").addEventListener("click", (event) => {
    event.stopPropagation();
    onPause();
  });
  root.querySelector(".map-tab").addEventListener("click", (event) => {
    event.stopPropagation();
    onMap();
  });
  // A swipe in from the right edge brings the map.
  const edge = root.querySelector(".edge");
  let edgeX = null;
  edge.addEventListener("pointerdown", (event) => {
    edgeX = event.clientX;
    edge.setPointerCapture(event.pointerId);
  });
  edge.addEventListener("pointermove", (event) => {
    if (edgeX !== null && edgeX - event.clientX > 36) {
      edgeX = null;
      onMap(true);
    }
  });
  edge.addEventListener("pointerup", () => (edgeX = null));
  // A tap on the open map puts it away.
  habitat.querySelector("#minimap")?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onMap();
  });
  // No page scrolling or zooming under the thumbs (only the logbook and the cards scroll).
  habitat.addEventListener(
    "touchmove",
    (event) => {
      if (!event.target.closest?.("#logbook, #intro, #lifecard")) event.preventDefault();
    },
    { passive: false },
  );

  return {
    state,
    show() {
      root.hidden = false;
    },
  };
}
