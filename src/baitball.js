import * as THREE from "three";
import { bed, level, locate } from "./course.js";
import { creatureMaterial, gannetGeometry } from "./creatures.js";

// The sea's trial: the hunt. Now and then, out at sea, the herring (the sand eels, for a
// fish still too small for herring) are driven together into a bait ball -- a tight,
// milling, flashing ball of fish up under the surface -- and everything that eats fish
// comes to it. Gannets plunge in from high above, one after another, in a white spray; a
// seal comes by to feed. For a short while there is more food in one place than the fish
// will meet again for weeks: it has to be quick, dash in at the edge of the ball, snap one,
// and again -- and keep an eye on the seal. Inside the ball it is harder to pick out.
//
// Here: when a ball forms and breaks up, where it is, and the gannets. The fish in it are
// the shoals' own (life.js, `shoals.ball`); the seal is the hunters' (predators.js).

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const BALL_SECONDS = 42;
// How long at sea before the first, and between one and the next.
const FIRST = 35,
  BETWEEN = 170;
const GANNETS = 4;

export function createBaitBall(scene) {
  // (`bite`: when the salmon last took one out of it -- see the shoals in life.js)
  const ball = { kind: "herring", title: "Heringsball", centre: new THREE.Vector3(), radius: 6, away: [], river: { s: 0, u: 0 }, bite: -9 };
  const material = creatureMaterial();
  const geometry = gannetGeometry();
  const down = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0));
  const tilt = new THREE.Quaternion();
  const gannets = Array.from({ length: GANNETS }, () => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.castShadow = false;
    mesh.name = "gannet";
    scene.add(mesh);
    return { mesh, t: -1, at: new THREE.Vector3(), surface: 0, depth: 0, took: false, splashed: false };
  });
  let state = "idle"; // idle, on
  let t = 0;
  let atSea = 0;
  let next = FIRST;
  let nextDive = 0;
  let caught = 0;
  let sealIn = false;
  const events = [];

  function place(fish) {
    // Ahead of the fish, where it is going, up under the surface.
    const h = new THREE.Vector3(fish.heading.x, 0, fish.heading.z);
    if (h.lengthSq() < 1e-4) h.set(1, 0, 0);
    h.normalize();
    const at = new THREE.Vector3().copy(fish.position).addScaledVector(h, 50);
    const r = locate(at.x, at.z, fish.river.s, ball.river);
    const lv = level(ball.river.s);
    const floor = bed(ball.river.s, ball.river.u);
    at.y = clamp(lv - 8 - ball.radius * 0.4, floor + ball.radius * 1.5, lv - ball.radius * 0.9);
    ball.centre.copy(at);
    return r;
  }

  function dive(g) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * ball.radius * 0.9;
    g.at.set(ball.centre.x + Math.cos(a) * r, 0, ball.centre.z + Math.sin(a) * r);
    g.surface = level(ball.river.s);
    g.depth = clamp(ball.centre.y + (Math.random() - 0.5) * ball.radius, bed(ball.river.s, ball.river.u) + 2, g.surface - 3);
    g.t = 0;
    g.took = false;
    g.splashed = false;
    g.mesh.visible = true;
    // A little off the vertical, each its own way.
    tilt.setFromAxisAngle(new THREE.Vector3(Math.cos(a + 1.3), 0, Math.sin(a + 1.3)), (Math.random() - 0.5) * 0.5);
    g.mesh.quaternion.copy(tilt).multiply(down);
  }

  return {
    ball,
    get state() {
      return state;
    },
    get on() {
      return state === "on";
    },
    get caught() {
      return caught;
    },
    // How much of it is left (1..0), for the bar.
    get left() {
      return clamp(1 - t / BALL_SECONDS, 0, 1);
    },
    get time() {
      return t;
    },
    // A new life, or back to the river: the sea's clock starts again.
    reset() {
      state = "idle";
      atSea = 0;
      next = FIRST;
      for (const g of gannets) (g.t = -1), (g.mesh.visible = false);
    },
    // `ok`: whether a ball may form now (the fish at sea and feeding, by day). Returns the
    // events of this step: { type: "start" | "dive" | "seal" | "end" , ... }.
    update(dt, fish, { ok, light, shoals, hunters }) {
      events.length = 0;
      if (state === "idle") {
        if (ok) atSea += dt;
        if (ok && atSea > next && light > 0.35) this.start(fish, shoals);
      }
      if (state === "on") {
        t += dt;
        ball.away.length = 0;
        // The gannets, one after another.
        nextDive -= dt;
        if (nextDive <= 0 && t < BALL_SECONDS - 3) {
          const g = gannets.find((q) => q.t < 0);
          if (g) dive(g);
          nextDive = 1.2 + Math.random() * 2.2;
        }
        // The seal comes to feed, a while in.
        if (!sealIn && t > 12) {
          sealIn = true;
          const from = new THREE.Vector3().subVectors(ball.centre, fish.position).setY(0).normalize();
          const at = new THREE.Vector3().copy(ball.centre).addScaledVector(from, ball.radius + 22);
          at.y = ball.centre.y;
          hunters.force("seal", at.x, at.y, at.z);
          events.push({ type: "seal" });
        }
        if (t >= BALL_SECONDS) this.stop(shoals, "end");
      }
      // Gannets: in from high above at 25 m/s, a splash, down in a trail of bubbles to the
      // ball, a moment there, then up again on the air in their feathers.
      for (const g of gannets) {
        if (g.t < 0) continue;
        g.t += dt;
        const inAir = 0.45;
        let y;
        if (g.t < inAir) y = g.surface + 26 * (1 - g.t / inAir);
        else if (g.t < inAir + 0.5) {
          const k = (g.t - inAir) / 0.5;
          y = g.surface - (g.surface - g.depth) * (1 - (1 - k) * (1 - k));
          if (!g.splashed) {
            g.splashed = true;
            events.push({ type: "dive", x: g.at.x, y: g.surface, z: g.at.z });
          }
        } else if (g.t < inAir + 1.9) {
          const k = (g.t - inAir - 0.5) / 1.4;
          y = g.depth + (g.surface - g.depth) * k * k;
          if (!g.took && state === "on") {
            g.took = true;
            shoals.take(ball.kind, new THREE.Vector3(g.at.x, g.depth, g.at.z), 3.5);
          }
        } else {
          g.t = -1;
          g.mesh.visible = false;
          continue;
        }
        g.mesh.position.set(g.at.x, y, g.at.z);
        if (g.t > inAir && g.t < inAir + 1.9) ball.away.push(g.mesh.position);
      }
      return events;
    },
    start(fish, shoals) {
      // Herring for a fish big enough to swallow one, sand eels before that.
      const herring = fish.length * 0.5 >= 2.3;
      ball.kind = herring ? "herring" : "sandeel";
      ball.title = herring ? "Heringsball" : "Sandaalball";
      ball.radius = herring ? 6 : 4;
      ball.bite = -9;
      place(fish);
      shoals.ball(ball.kind, ball);
      state = "on";
      t = 0;
      caught = 0;
      sealIn = false;
      nextDive = 2.5;
      events.push({ type: "start", kind: ball.kind, title: ball.title });
    },
    // The ball breaks up: the fish scatter, the birds are done.
    stop(shoals, type = "end") {
      if (state !== "on") return;
      state = "idle";
      atSea = 0;
      next = BETWEEN;
      shoals.ball(ball.kind, null);
      ball.away.length = 0;
      events.push({ type, caught, title: ball.title, kind: ball.kind });
    },
    // One caught (counted from what the fish ate while the ball was on).
    ate(kind) {
      if (state === "on" && kind === ball.kind) caught++;
    },
  };
}
