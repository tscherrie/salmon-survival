// Playing on a phone or a tablet, held sideways. A finger dragged anywhere on the screen
// looks round and steers (the mouse on a computer); two buttons for the right thumb: held
// down, the arrow swims ahead (W), and the fish dashes, bites and leaps with the other
// (Space) -- tapped, or with the thumb slid across onto it from the arrow, which keeps
// swimming. A quick sideways swipe just before it makes the dash a dodge. A pause button
// in the corner; the map comes in from the right edge, with a swipe or its tab, and a tap
// on it puts it away.

const ICONS = {
  go: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5 12 8.5l6 6" /></svg>',
  bite: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12c2.6-4.2 6.2-6.3 10.2-6.3 2.7 0 4.9 1 6.8 2.8l-3.4 3.5 3.4 3.5c-1.9 1.8-4.1 2.8-6.8 2.8-4 0-7.6-2.1-10.2-6.3Z" /><circle cx="8.6" cy="10.6" r="1.1" /></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6v12M15.5 6v12" /></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5Z" /><path d="M9 4v13.5M15 6.5V20" /></svg>',
};

export function createTouch({ habitat, onTouch, onLunge, onLook, onPause, onMap }) {
  const root = document.createElement("div");
  root.id = "touch";
  root.hidden = true;
  root.innerHTML = `
    <div class="look"></div>
    <button class="go" type="button" aria-label="Schwimmen">${ICONS.go}</button>
    <button class="bite" type="button" aria-label="Spurt, Biss, Sprung">${ICONS.bite}</button>
    <button class="pause" type="button" aria-label="Pause">${ICONS.pause}</button>
    <button class="map-tab" type="button" aria-label="Karte">${ICONS.map}</button>
    <div class="edge"></div>`;
  habitat.append(root);
  // Sideways, please.
  const turn = document.createElement("div");
  turn.id = "rotate";
  turn.innerHTML = '<div class="phone" aria-hidden="true"></div><p>Bitte dreh dein Handy quer.</p>';
  habitat.append(turn);

  const state = { forward: false, flick: 0 };

  // Dragging: looking round and steering. The last moment of it is kept, so that a dash
  // right after a quick sideways swipe goes that way.
  const look = root.querySelector(".look");
  let lookId = null,
    lx = 0,
    ly = 0;
  const recent = [];
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
    const dx = event.clientX - lx;
    onLook(dx, event.clientY - ly);
    lx = event.clientX;
    ly = event.clientY;
    recent.push([performance.now(), dx]);
    if (recent.length > 24) recent.shift();
  });
  const letLook = (event) => {
    if (event.pointerId === lookId) lookId = null;
  };
  look.addEventListener("pointerup", letLook);
  look.addEventListener("pointercancel", letLook);
  const flick = () => {
    const now = performance.now();
    const sum = recent.reduce((s, [t, dx]) => (now - t < 180 ? s + dx : s), 0);
    return Math.abs(sum) > 45 ? Math.sign(sum) : 0;
  };

  // The two buttons, one thumb: held on the arrow it swims; slid onto the fish, a dash.
  const go = root.querySelector(".go");
  const bite = root.querySelector(".bite");
  const over = (element, event) => {
    const r = element.getBoundingClientRect();
    return event.clientX > r.left - 8 && event.clientX < r.right + 8 && event.clientY > r.top - 8 && event.clientY < r.bottom + 8;
  };
  const thumbs = new Map();
  const refresh = () => {
    const all = [...thumbs.values()];
    state.forward = all.some((t) => t.forward);
    go.classList.toggle("pressed", state.forward);
    bite.classList.toggle("pressed", all.some((t) => t.onBite));
  };
  const dash = () => {
    state.flick = flick();
    onLunge();
  };
  for (const button of [go, bite]) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      onTouch();
      button.setPointerCapture(event.pointerId);
      const thumb = { forward: button === go, onBite: button === bite };
      thumbs.set(event.pointerId, thumb);
      if (thumb.onBite) dash();
      refresh();
    });
    button.addEventListener("pointermove", (event) => {
      const thumb = thumbs.get(event.pointerId);
      if (!thumb) return;
      const onBite = over(bite, event);
      if (onBite && !thumb.onBite) dash();
      thumb.onBite = onBite;
      if (over(go, event)) thumb.forward = true;
      refresh();
    });
    const lift = (event) => {
      thumbs.delete(event.pointerId);
      refresh();
    };
    button.addEventListener("pointerup", lift);
    button.addEventListener("pointercancel", lift);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  }

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
  // No page scrolling or zooming under the fingers (only the logbook and the cards scroll).
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
    // Paused or hidden: nothing held.
    release() {
      thumbs.clear();
      lookId = null;
      refresh();
    },
  };
}
