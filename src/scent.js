import * as THREE from "three";
import { S, locate, tributaryAt } from "./course.js";

// The scent of home. Every river smells of its own -- of the stones, the soil and the plants
// of its valley -- and a salmon remembers the smell of the brook it hatched in. Coming back
// from the sea it finds its river by it: first the plume of the river's water spread out in
// the sea, carried off along the coast by the current and fading the further out it is;
// then, in the river, at every fork, the arm that smells of home.
//
// Here: how strong the smell of home is at a place (and of another river, farther along the
// coast, whose plume crosses the sea as well -- the wrong one), which way it grows, and a
// few glints of it in the water round the fish where it is strong. The HUD bar and the map
// are main.js's.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// The plume: out from the mouth, bent off along the coast by the current, widening and fading.
const BEND = 0.3,
  WIDTH = 180,
  SPREAD = 0.45,
  FADE = 2600;
// The other river's mouth, off along the coast (its water is a stranger's).
const OTHER_U = 2400,
  OTHER_STRENGTH = 0.85;

function plume(s, u, mouthU) {
  const d = Math.max(0, s - S.coast);
  const axis = mouthU + BEND * d;
  const w = WIDTH + SPREAD * d;
  const off = (u - axis) / w;
  return Math.exp(-d / FADE) * Math.exp(-off * off);
}

const at = {};
const trib = {};
// { home, foreign } at a river position (0..1 each).
export function smell(s, u) {
  if (s <= S.coast) {
    // In the river it is home all the way up -- except up the Alder Brook, which is not.
    const t = tributaryAt(s, u, trib);
    if (t && t.t > 0.08) return { home: 0.25, foreign: 0.8 };
    return { home: 1, foreign: 0 };
  }
  return { home: plume(s, u, 0), foreign: OTHER_STRENGTH * plume(s, u, OTHER_U) };
}

export function createScent(scene) {
  // A few glints of it in the water round the fish: fine, pale-gold, drifting.
  const COUNT = 260;
  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 40;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
    seeds[i] = Math.random() * 100;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  // Each a soft round glint, not a square.
  const dot = document.createElement("canvas");
  dot.width = dot.height = 32;
  const g = dot.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const material = new THREE.PointsMaterial({ color: 0xffe3a0, size: 0.28, map: new THREE.CanvasTexture(dot), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const glints = new THREE.Points(geometry, material);
  glints.frustumCulled = false;
  glints.visible = false;
  glints.name = "Scent";
  scene.add(glints);
  const centre = new THREE.Vector3();
  const state = { home: 0, foreign: 0, trend: 0, shown: 0 };
  const probe = new THREE.Vector3();

  function homeAt(x, z, hint) {
    locate(x, z, hint, at);
    return smell(at.s, at.u).home;
  }

  return {
    state,
    // `on`: whether it is being followed (a spawner homing); the glints show only then.
    update(dt, fish, time, on) {
      const here = smell(fish.river.s, fish.river.u);
      state.home += (here.home - state.home) * (1 - Math.exp(-dt * 3));
      state.foreign += (here.foreign - state.foreign) * (1 - Math.exp(-dt * 3));
      // Which way it grows: the fish's heading against the gradient of the (log) smell.
      if (on) {
        const e = 6;
        const h = Math.max(1e-4, here.home);
        const gx = (homeAt(fish.position.x + e, fish.position.z, fish.river.s) - homeAt(fish.position.x - e, fish.position.z, fish.river.s)) / (2 * e);
        const gz = (homeAt(fish.position.x, fish.position.z + e, fish.river.s) - homeAt(fish.position.x, fish.position.z - e, fish.river.s)) / (2 * e);
        const along = (gx * fish.heading.x + gz * fish.heading.z) / h;
        state.trend += (along - state.trend) * (1 - Math.exp(-dt * 2));
      } else state.trend = 0;
      // The glints: where the smell of home is strong enough to notice, round the fish.
      const want = on ? clamp((state.home - 0.08) * 1.3, 0, 0.7) : 0;
      state.shown += (want - state.shown) * (1 - Math.exp(-dt * 1.5));
      const was = glints.visible;
      glints.visible = state.shown > 0.01;
      if (glints.visible && !was) scatter(fish);
      if (glints.visible) {
        material.opacity = state.shown;
        centre.copy(fish.position);
        const p = geometry.attributes.position;
        for (let i = 0; i < COUNT; i++) {
          // Drifting slowly, each on its own path; wrapped round the fish.
          let x = p.getX(i) + Math.sin(time * 0.3 + seeds[i]) * dt * 0.4 + (fish.flow?.vx ?? 0) * dt * 0.2;
          let y = p.getY(i) + Math.cos(time * 0.23 + seeds[i] * 1.7) * dt * 0.2;
          let z = p.getZ(i) + Math.cos(time * 0.27 + seeds[i]) * dt * 0.4 + (fish.flow?.vz ?? 0) * dt * 0.2;
          probe.set(x - centre.x, y - centre.y, z - centre.z);
          if (Math.abs(probe.x) > 20) x = centre.x - Math.sign(probe.x) * 19.5;
          if (Math.abs(probe.y) > 8) y = centre.y - Math.sign(probe.y) * 7.5;
          if (Math.abs(probe.z) > 20) z = centre.z - Math.sign(probe.z) * 19.5;
          p.setXYZ(i, x, y, z);
        }
        p.needsUpdate = true;
      }
      return state;
    },
    // Put the glints round the fish at once (after it has been moved).
    place(fish) {
      scatter(fish);
    },
  };
  function scatter(fish) {
    const p = geometry.attributes.position;
    for (let i = 0; i < COUNT; i++) p.setXYZ(i, fish.position.x + (Math.random() - 0.5) * 40, fish.position.y + (Math.random() - 0.5) * 16, fish.position.z + (Math.random() - 0.5) * 40);
    p.needsUpdate = true;
  }
}
