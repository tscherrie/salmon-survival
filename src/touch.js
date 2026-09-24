// Playing on a phone or a tablet, held sideways. A finger dragged anywhere on the screen
// looks round and steers (the mouse on a computer); two buttons for the right thumb: held
// down, the arrow swims ahead (W), and the fish dashes, bites and leaps with the other
// (Space) -- tapped, or with the thumb slid across onto it from the arrow, which keeps
// swimming. A quick sideways swipe just before it makes the dash a dodge. A pause button
// in the corner (the map is switched on and off there, like the sound).

const ICONS = {
  go: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5 12 8.5l6 6" /></svg>',
  // A fish darting ahead, jaws open, with the wake of the dash behind it.
  bite: '<svg class="dash" viewBox="0 0 28 20" aria-hidden="true"><path class="body" d="M9 10c2.5-3.8 6.5-5.2 10.2-5.1 2.8.1 5 1.4 6.6 3.3L22 10l3.8 1.8c-1.6 1.9-3.8 3.2-6.6 3.3-3.7.1-7.7-1.3-10.2-5.1Z" /><path class="body" d="M9.8 10 5.2 5.8l1.1 4.2-1.1 4.2Z" /><path class="body" d="M15 5.7l2.4-2.9 1.6 2.3Z" /><circle class="eye" cx="20.8" cy="7.9" r="1.1" /><path class="wake" d="M.8 7.6h2.8M.2 10h3.6M.8 12.4h2.8" /></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6v12M15.5 6v12" /></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5Z" /><path d="M9 4v13.5M15 6.5V20" /></svg>',
};

export function createTouch({ habitat, onTouch, onLunge, onLook, onPause }) {
  const root = document.createElement("div");
  root.id = "touch";
  root.hidden = true;
  root.innerHTML = `
    <div class="look"></div>
    <button class="go" type="button" aria-label="Schwimmen">${ICONS.go}</button>
    <button class="bite" type="button" aria-label="Spurt, Biss, Sprung">${ICONS.bite}</button>
    <button class="pause" type="button" aria-label="Pause">${ICONS.pause}</button>
`;
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
