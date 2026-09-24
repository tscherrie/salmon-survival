import { FALLS, MILLS, REACHES, S, TRIBUTARIES, clamp, coastAt, frame, place, regionName, section } from "./course.js";
import { riverSketch } from "./logbook.js";

// The minimap (M): a small round map in the corner, turned so that up is where the camera
// looks, with the river round the fish -- its banks, how fast it runs (pale where it races,
// deep blue where it stands), the falls, which way is up- and downstream -- and under it the
// logbook's map of the whole river in small, with a dot where the fish is. Out at sea it
// shows the way back to the river's mouth.
//
// Others swimming in the same river (a co-op game later) are passed in each frame as
// `others`: [{ name, colour, x, z, yaw, s }] -- world position, heading and place along the
// river. Near ones are drawn on the round map, far ones pinned to its rim with how far away
// they are; on the strip below, all of them.

const STORAGE = "salmon-survival-minimap";
const SIZE = 184; // the round map, in CSS pixels
const UNITS_PER_METRE = 10; // a scene unit is ten centimetres
const TAU = Math.PI * 2;
const REGION_NAME = { brook: "Bach", upper: "Oberlauf", middle: "Mittellauf", lower: "Unterlauf", estuary: "Mündung", sea: "Meer" };

export function createMinimap({ logbook, places = null }) {
  const box = document.querySelector("#minimap");
  const local = box.querySelector(".local");
  const strip = box.querySelector(".strip");
  const whereBox = box.querySelector(".where .name");
  const scaleBar = box.querySelector(".where .scale i");
  const scaleText = box.querySelector(".where .scale b");
  const lastScale = { w: 0, metres: 0 };
  const button = document.querySelector("#map-toggle");
  const map = riverSketch();

  let open = false;
  try {
    open = localStorage.getItem(STORAGE) === "1";
  } catch {}
  let R = null; // metres from the centre to the rim, eased
  let flow = 0; // how far the current has carried the arrows, metres
  let clock = 1; // seconds since the last picture
  let stripBase = null;
  let stripClock = 0;
  let lastWhere = "";
  let homing = false; // grown and going home: the way to the mouth in gold

  // Canvases at the screen's own pixel density.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  local.width = local.height = Math.round(SIZE * dpr);
  local.style.width = local.style.height = `${SIZE}px`;
  const g = local.getContext("2d");
  const kx = (SIZE - 20) / (map.W - 2 * map.pad);
  const STRIP_H = Math.round((map.H - 2 * map.pad - 24) * kx + 22);
  const oy = 11 - (map.pad + 12) * kx;
  const ox = 10 - map.pad * kx;
  strip.width = Math.round(SIZE * dpr);
  strip.height = Math.round(STRIP_H * dpr);
  strip.style.width = `${SIZE}px`;
  strip.style.height = `${STRIP_H}px`;
  const h = strip.getContext("2d");
  const toStrip = (s, z) => {
    const [x, y] = map.locate(s, z);
    return [ox + x * kx, oy + y * kx];
  };

  function show() {
    box.hidden = !open;
    button?.setAttribute("aria-pressed", String(open));
    button?.setAttribute("aria-label", open ? "Karte ausblenden" : "Karte einblenden");
    clock = 1;
    stripBase = null;
  }
  show();

  // ------------------------------------------------------------------------------------
  // The whole river, drawn once (and again now and then, as new stretches are swum).
  function drawStripBase() {
    const canvas = stripBase ?? document.createElement("canvas");
    canvas.width = strip.width;
    canvas.height = strip.height;
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, SIZE, STRIP_H);
    const visited = new Set(logbook.visited());
    c.lineCap = "round";
    for (let i = 1; i < map.line.length; i++) {
      const a = map.line[i - 1],
        b = map.line[i];
      const [x1, y1] = toStrip(a.s, a.z);
      const [x2, y2] = toStrip(b.s, b.z);
      c.strokeStyle = visited.has(b.region) ? "#6fd3e8" : "rgba(111, 211, 232, 0.28)";
      c.lineWidth = Math.max(1.2, map.WIDTH[b.region] * kx);
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
    }
    // The places found, as small gold diamonds.
    for (const p of places?.found() ?? []) {
      const w = place(p.s, p.u ?? 0, {});
      const [x, y] = toStrip(p.s, w.z);
      c.save();
      c.translate(x, y);
      c.rotate(Math.PI / 4);
      c.fillStyle = "#ffd98a";
      c.strokeStyle = "rgba(0, 20, 24, 0.8)";
      c.lineWidth = 1;
      c.fillRect(-2, -2, 4, 4);
      c.strokeRect(-2, -2, 4, 4);
      c.restore();
    }
    const climbed = new Set(logbook.climbed());
    for (const st of map.STATIONS) {
      const p = st.s >= S.straight ? place(st.s, 0, {}) : frame(st.s, {});
      const [x, y] = toStrip(st.s, p.z);
      c.beginPath();
      c.arc(x, y, st.fall ? 2.4 : 2, 0, TAU);
      c.fillStyle = st.fall ? (climbed.has(st.fall) ? "#8ff0c0" : "#9fb4bb") : st.redd ? "#ffb070" : "#f3fbf7";
      c.strokeStyle = "rgba(0, 20, 24, 0.8)";
      c.lineWidth = 1;
      c.fill();
      c.stroke();
    }
    return canvas;
  }

  // ------------------------------------------------------------------------------------
  // The round map.
  const scratch = {};
  function waterColour(c) {
    // Deep blue where the river stands, pale and white where it races.
    const t = clamp((c.speed - 0.4) / 6, 0, 1) ** 1.2;
    const r = 26 + (160 - 26) * t,
      gr = 98 + (228 - 98) * t,
      b = 132 + (242 - 132) * t;
    return `rgb(${r | 0}, ${gr | 0}, ${b | 0})`;
  }

  function drawLocal(fish, yaw, others) {
    const r = SIZE / 2;
    const px = (r - 4) / R;
    const fx = fish.position.x,
      fz = fish.position.z;
    const fs = fish.river.s;
    const sin = Math.sin(yaw),
      cos = Math.cos(yaw);
    // World (x, z) to the map: up is the way the camera looks.
    const toScreen = (x, z, out = scratch) => {
      const dx = x - fx,
        dz = z - fz;
      out.x = r + (-dx * sin + dz * cos) * px;
      out.y = r - (dx * cos + dz * sin) * px;
      return out;
    };

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);
    g.save();
    g.beginPath();
    g.arc(r, r, r - 1, 0, TAU);
    g.clip();
    // The land.
    const land = g.createRadialGradient(r, r, 0, r, r, r);
    land.addColorStop(0, "#3a5238");
    land.addColorStop(1, "#1f3321");
    g.fillStyle = land;
    g.fillRect(0, 0, SIZE, SIZE);

    // The world, turned and scaled.
    g.save();
    g.translate(r, r);
    g.rotate(-Math.PI / 2 - yaw);
    g.scale(px, px);
    g.translate(-fx, -fz);
    g.lineCap = "round";
    g.lineJoin = "round";

    // The river: pieces along it, each as wide as the river is there -- first the gravel
    // of the banks, then the water over it.
    const reach = 2.4 * R;
    let step = 2 ** Math.round(Math.log2(R / 28));
    step = clamp(step, 0.5, 64);
    const from = Math.max(5, Math.floor((fs - reach) / step) * step);
    const to = Math.min(S.coast + 60, fs + reach);
    const pieces = [];
    for (let s = from; s <= to; s += step) {
      const c = section(s);
      const p = place(s, c.thalweg * 0.3, {});
      pieces.push({ s, x: p.x, z: p.z, half: c.half, colour: waterColour(c), c });
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < pieces.length; i++) {
        const a = pieces[i - 1],
          b = pieces[i];
        g.lineWidth = Math.max(a.half, b.half) * 2 + (pass === 0 ? 3 / px : 0);
        g.strokeStyle = pass === 0 ? "#8a7f5c" : b.colour;
        g.beginPath();
        g.moveTo(a.x, a.z);
        g.lineTo(b.x, b.z);
        g.stroke();
      }
    }

    // Side brooks, cut into the land.
    for (const b of TRIBUTARIES) {
      if (Math.abs(b.s - fs) > reach + b.length) continue;
      const bank = section(b.s).half;
      const pts = [];
      for (let t = -0.05; t <= 1.001; t += 0.1) {
        const tt = Math.min(1, Math.max(0, t));
        const s = b.s + b.drift * tt + 2.2 * Math.sin(t * 5.2 + 0.7) * tt;
        const p = place(s, b.side * (bank - 1.5 + b.length * t), {});
        pts.push({ x: p.x, z: p.z, w: b.width * (1 - 0.35 * tt) });
      }
      for (let pass = 0; pass < 2; pass++)
        for (let i = 1; i < pts.length; i++) {
          g.lineWidth = pts[i].w * 2 * 0.9 + (pass === 0 ? 3 / px : 0);
          g.strokeStyle = pass === 0 ? "#8a7f5c" : "rgb(52, 124, 158)";
          g.beginPath();
          g.moveTo(pts[i - 1].x, pts[i - 1].z);
          g.lineTo(pts[i].x, pts[i].z);
          g.stroke();
        }
      // Its fall: a white bar at the head.
      const head = pts[pts.length - 1];
      g.fillStyle = "rgba(245, 252, 255, 0.95)";
      g.beginPath();
      g.arc(head.x, head.z, 2.5 / px, 0, TAU);
      g.fill();
    }
    // Mill races, walled in beside the river.
    for (const m of MILLS) {
      if (fs < m.from - reach || fs > m.to + reach) continue;
      const pts = [];
      for (let s = m.from; s <= m.to; s += 8) {
        const c = section(s);
        const ramp = Math.min(1, Math.max(0, (s - m.from) / 34)) * Math.min(1, Math.max(0, (m.to - s) / 34));
        const p = place(s, c.thalweg + m.side * (c.half - 3 + (m.offset + 3) * ramp), {});
        pts.push(p);
      }
      for (let pass = 0; pass < 2; pass++)
        for (let i = 1; i < pts.length; i++) {
          g.lineWidth = m.width * 2 + (pass === 0 ? 3 / px : 0);
          g.strokeStyle = pass === 0 ? "#8d8a82" : "rgb(60, 140, 170)";
          g.beginPath();
          g.moveTo(pts[i - 1].x, pts[i - 1].z);
          g.lineTo(pts[i].x, pts[i].z);
          g.stroke();
        }
    }
    // The bridge: a grey band across.
    for (const b of [{ s: 10400 }]) {
      if (Math.abs(b.s - fs) > reach) continue;
      const c = section(b.s);
      const a = place(b.s, c.thalweg - c.half * 1.3, {}),
        e = place(b.s, c.thalweg + c.half * 1.3, {});
      g.strokeStyle = "rgba(200, 196, 188, 0.95)";
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(a.x, a.z);
      g.lineTo(e.x, e.z);
      g.stroke();
    }
    // Islands: land in the middle of the river.
    g.strokeStyle = "#3a5238";
    for (let i = 1; i < pieces.length; i++) {
      const a = pieces[i - 1].c,
        b = pieces[i].c;
      if (a.island < 0.05 || b.island < 0.05) continue;
      const pa = place(pieces[i - 1].s, a.islandU, {}),
        pb = place(pieces[i].s, b.islandU, {});
      g.lineWidth = Math.max(a.islandHalf, b.islandHalf) * 1.85;
      g.beginPath();
      g.moveTo(pa.x, pa.z);
      g.lineTo(pb.x, pb.z);
      g.stroke();
    }

    // The sea, out beyond the coast, over the end of the river; the coast's gravel either
    // side of the mouth.
    if (fs + reach > S.straight + 300) {
      const u0 = fish.river.u;
      const mouth = section(S.coast).half;
      const coast = [];
      for (let k = -32; k <= 32; k++) {
        const u = u0 + (k / 32) * 3 * R;
        const p = place(coastAt(u), u, {});
        coast.push({ u, x: p.x, z: p.z });
      }
      g.beginPath();
      coast.forEach((p, k) => (k ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z)));
      let p = place(S.coast + 6000, u0 + 3 * R, scratch);
      g.lineTo(p.x, p.z);
      p = place(S.coast + 6000, u0 - 3 * R, scratch);
      g.lineTo(p.x, p.z);
      g.closePath();
      g.fillStyle = waterColour(section(S.coast));
      g.fill();
      g.strokeStyle = "#8a7f5c";
      g.lineWidth = 3 / px;
      g.beginPath();
      let pen = false;
      for (const q of coast) {
        if (Math.abs(q.u) < mouth) {
          pen = false;
          continue;
        }
        if (pen) g.lineTo(q.x, q.z);
        else g.moveTo(q.x, q.z);
        pen = true;
      }
      g.stroke();
    }

    // The falls: a white line across the river.
    const labels = [];
    const named = new Map();
    for (const f of FALLS) {
      if (f.head || Math.abs(f.s - fs) > reach) continue;
      const c = section(f.s);
      const a = place(f.s, -c.half, {});
      const b = place(f.s, c.half, {});
      g.strokeStyle = "rgba(245, 252, 255, 0.95)";
      g.lineWidth = (f.step ? 2 : 3) / px;
      g.beginPath();
      g.moveTo(a.x, a.z);
      g.lineTo(b.x, b.z);
      g.stroke();
      const d = Math.abs(f.s - fs);
      const known = named.get(f.name);
      if (!known || d < known.d) named.set(f.name, { d, s: f.s, half: c.half });
    }
    for (const [name, { s, half }] of named) {
      // The steps of the fish pass are one place: named from the top step.
      let top = s;
      for (const f of FALLS) if (f.name === name && f.s < top && s - f.s < 60) top = f.s;
      const a = place(top, -half, {});
      const b = place(top, half, {});
      labels.push({ text: name, a, b, f: frame(top, {}) });
    }

    // Arrows down the middle, carried along at the speed of the current.
    // (The spacing in whole powers of two, so the arrows do not jump while the map zooms.)
    const gap = 2 ** Math.round(Math.log2(R / 3.2));
    const arrow = 5 / px;
    for (let s = Math.floor((fs - reach) / gap) * gap + (flow % gap); s < to; s += gap) {
      if (s < from) continue;
      // (The river there from the nearest piece: the arrows' own places change every frame
      // and would only fill the cross-section cache.)
      const c = pieces[clamp(Math.round((s - from) / step), 0, pieces.length - 1)]?.c;
      if (!c) break;
      const lanes = c.half * px > 30 ? [-0.5, 0, 0.5] : [0];
      const f = frame(s, {});
      const alpha = 0.25 + 0.45 * clamp(c.speed / 4, 0, 1);
      g.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
      g.lineWidth = 1.6 / px;
      for (const lane of lanes) {
        const x = f.x + f.nx * (c.thalweg * 0.3 + lane * c.half),
          z = f.z + f.nz * (c.thalweg * 0.3 + lane * c.half);
        g.beginPath();
        g.moveTo(x - f.tx * arrow + f.nx * arrow * 0.8, z - f.tz * arrow + f.nz * arrow * 0.8);
        g.lineTo(x, z);
        g.lineTo(x - f.tx * arrow - f.nx * arrow * 0.8, z - f.tz * arrow - f.nz * arrow * 0.8);
        g.stroke();
      }
    }
    g.restore();

    // Names by the falls, upright, out on the bank past one end of the line (whichever
    // stays on the map), or else in the water just above the lip.
    g.font = `700 10px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const inside = (x, y) => Math.hypot(x - r, y - r) < r - 12;
    for (const l of labels) {
      const a = toScreen(l.a.x, l.a.z, {});
      const b = toScreen(l.b.x, l.b.z, {});
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / len,
        uy = (b.y - a.y) / len;
      const push = g.measureText(l.text).width / 2 + 5;
      let x = b.x + ux * push,
        y = b.y + uy * push;
      if (!inside(x + ux * push, y + uy * push)) {
        x = a.x - ux * push;
        y = a.y - uy * push;
        if (!inside(x - ux * push, y - uy * push)) {
          const dx = -l.f.tx * sin + l.f.tz * cos,
            dy = -(l.f.tx * cos + l.f.tz * sin);
          x = (a.x + b.x) / 2 - dx * 11;
          y = (a.y + b.y) / 2 - dy * 11;
        }
      }
      const half = push - 5;
      if (inside(x - half, y) && inside(x + half, y)) text(l.text, x, y, "#f3fbf7");
    }

    // Places found nearby: a gold pin and the name.
    for (const p of places?.found() ?? []) {
      if (p.from !== undefined || Math.abs(p.s - fs) > reach) continue;
      const w = place(p.s, p.u ?? 0, {});
      const q = toScreen(w.x, w.z, {});
      if (!inside(q.x, q.y)) continue;
      g.save();
      g.translate(q.x, q.y);
      g.rotate(Math.PI / 4);
      g.fillStyle = "#ffd98a";
      g.strokeStyle = "rgba(40, 24, 0, 0.9)";
      g.lineWidth = 1.5;
      g.fillRect(-3.5, -3.5, 7, 7);
      g.strokeRect(-3.5, -3.5, 7, 7);
      g.restore();
      g.font = `700 9px ${FONT}`;
      text(p.name, q.x, q.y - 11, "#ffe9b8");
    }

    // In the river the arrows of the current say which way is which; out at sea, the way
    // back to the mouth: a pin on it when it is on the map, else an arrow on the rim
    // pointing to it, with how far. Once the fish is grown and homing, all of it gold, a
    // dashed trail running out from the fish toward it.
    tagAngles.length = 0;
    if (fs >= S.coast - 50) {
      const m = place(S.coast, 0, {});
      const p = toScreen(m.x, m.z, {});
      const dx = p.x - r,
        dy = p.y - r;
      const d = Math.hypot(dx, dy) || 1;
      const a = Math.atan2(dy, dx);
      const onMap = d < r - 16;
      const colour = homing ? "#ffd24a" : "#e6f5f0";
      if (homing && d > 22) {
        const end = onMap ? d - 9 : r - 14;
        g.save();
        g.setLineDash([5, 5]);
        g.lineDashOffset = -seconds * 14;
        g.strokeStyle = "rgba(255, 210, 74, 0.9)";
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(r + (dx / d) * 13, r + (dy / d) * 13);
        g.lineTo(r + (dx / d) * end, r + (dy / d) * end);
        g.stroke();
        g.restore();
      }
      if (onMap) {
        g.save();
        g.translate(p.x, p.y);
        g.beginPath();
        g.arc(0, -8, 5.5, Math.PI * 0.8, Math.PI * 2.2);
        g.lineTo(0, 1);
        g.closePath();
        g.fillStyle = colour;
        g.strokeStyle = "rgba(40, 24, 0, 0.9)";
        g.lineWidth = 1.5;
        g.fill();
        g.stroke();
        g.restore();
        g.font = `800 10px ${FONT}`;
        // The name on the far side of the pin from the fish.
        text("Mündung", p.x, p.y < r ? p.y - 21 : p.y + 10, homing ? "#ffe9b8" : "#f3fbf7");
      } else {
        const pulse = homing ? 1 + 0.2 * (0.5 + 0.5 * Math.sin(seconds * 5)) : 0.85;
        g.save();
        g.translate(r + Math.cos(a) * (r - 7), r + Math.sin(a) * (r - 7));
        g.rotate(a);
        g.scale(pulse, pulse);
        g.beginPath();
        g.moveTo(7, 0);
        g.lineTo(-5, -6.5);
        g.lineTo(-2, 0);
        g.lineTo(-5, 6.5);
        g.closePath();
        g.fillStyle = colour;
        g.strokeStyle = "rgba(40, 24, 0, 0.9)";
        g.lineWidth = 1.5;
        g.fill();
        g.stroke();
        g.restore();
        rimTag("Mündung", a, r, homing);
        const far = Math.hypot(m.x - fx, m.z - fz) / UNITS_PER_METRE;
        g.font = `700 9px ${FONT}`;
        const lx = clamp(r + Math.cos(a) * (r - 30), 30, SIZE - 30),
          ly = clamp(r + Math.sin(a) * (r - 16) + (Math.sin(a) > 0.3 ? -14 : 14), 10, SIZE - 10);
        text(far >= 1000 ? `${(far / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(far / 10) * 10} m`, lx, ly, homing ? "#ffe9b8" : "#f3fbf7");
      }
    }

    // The scale bar under the map (a scene unit is ten centimetres).
    const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
    let metres = nice[0];
    for (const n of nice) if (n * UNITS_PER_METRE * px <= 48) metres = n;
    const w = Math.round(metres * UNITS_PER_METRE * px);
    if (w !== lastScale.w || metres !== lastScale.metres) {
      lastScale.w = w;
      lastScale.metres = metres;
      scaleBar.style.width = `${w}px`;
      scaleText.textContent = metres < 1 ? `${Math.round(metres * 100)} cm` : `${metres} m`;
    }

    // The others: near ones where they swim, far ones on the rim with how far away (the
    // label kept inward of the tags on the rim).
    const pos = {};
    for (const o of others) {
      const p = toScreen(o.x, o.z, pos);
      const dx = p.x - r,
        dy = p.y - r;
      const d = Math.hypot(dx, dy);
      if (d < r - 12) {
        marker(p.x, p.y, (o.yaw ?? yaw) - yaw, o.colour ?? "#7fe0ff", 0.8);
        g.font = `700 10px ${FONT}`;
        text(o.name ?? "", p.x, p.y - 13, o.colour ?? "#7fe0ff");
      } else {
        const a = Math.atan2(dy, dx);
        const x = r + Math.cos(a) * (r - 5),
          y = r + Math.sin(a) * (r - 5);
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.beginPath();
        g.moveTo(6, 0);
        g.lineTo(-4, -5);
        g.lineTo(-4, 5);
        g.closePath();
        g.fillStyle = o.colour ?? "#7fe0ff";
        g.strokeStyle = "rgba(0, 20, 24, 0.85)";
        g.lineWidth = 1.5;
        g.fill();
        g.stroke();
        g.restore();
        const far = (Math.abs((o.s ?? fs) - fs) || Math.hypot(o.x - fx, o.z - fz)) / UNITS_PER_METRE;
        const label = `${o.name ?? ""} · ${far >= 1000 ? `${(far / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(far)} m`}`;
        g.font = `700 9px ${FONT}`;
        const crowded = tagAngles.some((t) => Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t))) < 0.5);
        const lx = clamp(r + Math.cos(a) * (r - (crowded ? 62 : 44)), 40, SIZE - 40),
          ly = clamp(r + Math.sin(a) * (r - (crowded ? 44 : 34)), 12, SIZE - 12);
        text(label, lx, ly, o.colour ?? "#7fe0ff");
      }
    }

    // The fish itself, in the middle.
    marker(r, r, fish.yaw - yaw, "#ffd24a", 1);
    g.restore();
    // A ring round it all.
    g.beginPath();
    g.arc(r, r, r - 1, 0, TAU);
    g.strokeStyle = "rgba(230, 250, 245, 0.55)";
    g.lineWidth = 2;
    g.stroke();
  }

  const FONT = `ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif`;
  function text(value, x, y, colour) {
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0, 20, 24, 0.85)";
    g.strokeText(value, x, y);
    g.fillStyle = colour;
    g.fillText(value, x, y);
  }
  // A tag on the rim at screen angle a (0 is to the right, going clockwise).
  const tagAngles = [];
  function rimTag(label, a, r, bright = false) {
    tagAngles.push(a);
    g.font = `800 9px ${FONT}`;
    const w = g.measureText(label).width + 10;
    const x = r + Math.cos(a) * (r - 22 - w * 0.25 * Math.abs(Math.cos(a))),
      y = r + Math.sin(a) * (r - 16);
    g.fillStyle = bright ? "rgba(70, 44, 0, 0.85)" : "rgba(4, 24, 30, 0.72)";
    g.beginPath();
    g.roundRect?.(x - w / 2, y - 7, w, 14, 7);
    g.fill();
    g.fillStyle = bright ? "#ffe9b8" : "rgba(243, 251, 247, 0.9)";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, x, y + 0.5);
  }
  // A little fish-arrow at (x, y), turned by `turn` from straight up.
  function marker(x, y, turn, colour, scale) {
    g.save();
    g.translate(x, y);
    g.rotate(turn);
    g.scale(scale, scale);
    g.beginPath();
    g.moveTo(0, -9);
    g.quadraticCurveTo(5.5, -2, 3, 4);
    g.lineTo(5.5, 9);
    g.lineTo(0, 6.5);
    g.lineTo(-5.5, 9);
    g.lineTo(-3, 4);
    g.quadraticCurveTo(-5.5, -2, 0, -9);
    g.closePath();
    g.fillStyle = colour;
    g.strokeStyle = "rgba(40, 24, 0, 0.9)";
    g.lineWidth = 1.5;
    g.fill();
    g.stroke();
    g.restore();
  }

  // ------------------------------------------------------------------------------------
  // The strip: the whole river, the fish and the others on it.
  function drawStrip(fish, others, t) {
    h.setTransform(1, 0, 0, 1, 0, 0);
    h.clearRect(0, 0, strip.width, strip.height);
    h.drawImage(stripBase, 0, 0);
    h.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const o of others) {
      const [x, y] = toStrip(o.s ?? fish.river.s, o.z);
      h.beginPath();
      h.arc(x, y, 3.2, 0, TAU);
      h.fillStyle = o.colour ?? "#7fe0ff";
      h.strokeStyle = "rgba(0, 20, 24, 0.85)";
      h.lineWidth = 1.2;
      h.fill();
      h.stroke();
    }
    const [x, y] = toStrip(fish.river.s, fish.position.z);
    h.beginPath();
    h.arc(x, y, 5 + 2.5 * (0.5 + 0.5 * Math.sin(t * 4)), 0, TAU);
    h.fillStyle = "rgba(255, 210, 74, 0.28)";
    h.fill();
    h.beginPath();
    h.arc(x, y, 3.6, 0, TAU);
    h.fillStyle = "#ffd24a";
    h.strokeStyle = "#3a2600";
    h.lineWidth = 1.2;
    h.fill();
    h.stroke();
  }

  function whereName(s) {
    if (places?.here && places.here.from === undefined) return places.here.name;
    for (const q of REACHES) if (q.name && s > q.from && s < q.to) return q.name;
    const f = FALLS.find((f) => !f.head && Math.abs(s - f.s) < 40);
    if (f) return f.name;
    return REGION_NAME[regionName(s)];
  }

  let seconds = 0;
  const api = {
    get open() {
      return open;
    },
    toggle() {
      open = !open;
      try {
        localStorage.setItem(STORAGE, open ? "1" : "0");
      } catch {}
      show();
      return open;
    },
    // Each frame: dt (0 while the game stands still), the fish, the way the camera looks,
    // and whoever else is in the river.
    update(dt, { fish, yaw, homing: home = false, others = [] }) {
      seconds += dt;
      homing = home;
      const c = section(Math.min(fish.river.s, S.coast));
      flow += c.speed * dt;
      const want = fish.river.s > S.coast + 100 ? 420 : clamp(c.width * 1.5, 16, 420);
      R = R === null ? want : R + (want - R) * (1 - Math.exp(-dt * 1.2));
      if (!open) return;
      // About thirty pictures a second; none while the game stands still, once drawn.
      clock += dt;
      stripClock += dt;
      if (clock < 1 / 30) return;
      clock = 0;
      if (!stripBase || stripClock > 5) {
        stripBase = drawStripBase();
        stripClock = 0;
      }
      drawLocal(fish, yaw, others);
      drawStrip(fish, others, seconds);
      const where = whereName(fish.river.s);
      if (where !== lastWhere) {
        lastWhere = where;
        whereBox.textContent = where;
      }
    },
    // Where the box is on the screen, so the fight bar can keep clear of it.
    rect() {
      return open ? box.getBoundingClientRect() : null;
    },
  };
  return api;
}
