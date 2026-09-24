import * as THREE from "three";
import { S, bed, current, frame, level, place, relaid, section } from "./course.js";
import { speeds } from "./salmon.js";

// The drive: the smolt run's trial. Where the lower river spreads out wide and shallow at
// the edges, a band of goosanders waits for the smolts coming down. They hunt together:
// under water they circle the school and dash in at any smolt out on its own, driving the
// rest toward the shallows. The school does not wait -- it flees down the river at its own
// pace, closing up, flashing open round a bird and closing again -- and the fish has to
// keep up with it, in the middle of it, to the rapids below, where the birds give up.
//
// Here: when it starts and ends, and the school's lead (its middle, going down the river
// along the deep line). The birds are in predators.js (kind "drive"), the school in
// school.js.

export const DRIVE = { from: relaid(13380), to: relaid(14000), name: "Treibjagd" };

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;

export function createDrive() {
  const lead = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    heading: new THREE.Vector3(1, 0, 0),
    river: { s: 0, u: 0 },
    away: [],
    // Within this of the middle the fish is in the school (and the others count for it);
    // further out it is on the edge, or on its own.
    radius: 10,
  };
  const at = {};
  const flow = {};
  let state = "idle"; // idle, on, done
  let t = 0;
  let size = 0;
  let weave = 0;

  // `y`: the height it would keep (mid-water when not given).
  function set(s, u, fish, y = null) {
    const floor = bed(s, u);
    const lv = level(s);
    place(s, u, at);
    y = clamp(y ?? lerp(floor, lv, 0.55), floor + fish.length * 1.2, lv - fish.length * 1.5);
    lead.position.set(at.x, y, at.z);
    lead.river.s = s;
    lead.river.u = u;
  }

  return {
    lead,
    get state() {
      return state;
    },
    get on() {
      return state === "on";
    },
    // How far along to the rapids (0..1), for the bar on the screen.
    get progress() {
      return clamp((lead.river.s - DRIVE.from) / (DRIVE.to - DRIVE.from), 0, 1);
    },
    get time() {
      return t;
    },
    // How many were in the school when it began.
    get size() {
      return size;
    },
    // Is the fish where it may begin (a smolt, with its school, at the top of the stretch)?
    ready(fish, schoolCount) {
      return state === "idle" && schoolCount >= 8 && fish.river.s > DRIVE.from && fish.river.s < DRIVE.from + 90 && !fish.captive && !fish.airborne;
    },
    start(fish, schoolCount) {
      state = "on";
      t = 0;
      size = schoolCount;
      weave = Math.random() * 10;
      set(fish.river.s, fish.river.u, fish, fish.position.y);
      frame(fish.river.s, at);
      lead.heading.set(at.tx, 0, at.tz).normalize();
      lead.velocity.set(0, 0, 0);
    },
    // Over (made it, or died, or left the school far behind): the birds go.
    stop() {
      state = "done";
      lead.away.length = 0;
    },
    // Back to waiting (a new life far up the river, or a new brood).
    reset() {
      state = "idle";
      t = 0;
      lead.away.length = 0;
    },
    // Moves the school's middle on down the river. Returns "made" at the rapids, "left"
    // when the fish has fallen far behind, or null.
    update(dt, fish, time, hunters = []) {
      if (state !== "on") {
        // A fish far up the river again (a new life): the drive waits for it once more.
        if (state === "done" && fish.river.s < DRIVE.from - 300) state = "idle";
        return null;
      }
      t += dt;
      const L = fish.length;
      const cruise = speeds(L).cruise;
      lead.radius = 5 + L * 3;
      let s = lead.river.s;
      const c = section(Math.min(s, S.coast));
      current(s, lead.river.u, lead.position.y, flow, time, true);
      // As fast as the fish swims, with the current -- a little slower when it lags just
      // behind (a moment to catch up), not at all when it is far behind (left).
      const behind = s - fish.river.s;
      let pace = 0.95;
      if (behind < 0) pace = Math.min(1.5, 0.95 - behind * 0.05);
      else if (behind < 14) pace = 0.95 - behind * 0.01;
      const speed = flow.speed + cruise * pace;
      s += speed * dt;
      // Across the river and in depth it goes loosely where the fish goes (a school turns
      // with its members), drawn toward the deep line, swaying a little; only its pace is
      // its own.
      const want = lerp(c.thalweg, fish.river.u, 0.7) + Math.sin(time * 0.23 + weave) * c.half * 0.06;
      const u = lead.river.u + (want - lead.river.u) * (1 - Math.exp(-dt * 0.7));
      const floor = bed(s, u);
      const y = lead.position.y + (lerp(lerp(floor, level(s), 0.55), fish.position.y, 0.7) - lead.position.y) * (1 - Math.exp(-dt * 0.9));
      const before = lead.position.clone();
      set(s, u, fish, y);
      lead.velocity.subVectors(lead.position, before).divideScalar(Math.max(dt, 1e-4));
      if (lead.velocity.lengthSq() > 1e-4) lead.heading.copy(lead.velocity).setY(0).normalize();
      // The birds near the school, for it to scatter from.
      lead.away.length = 0;
      for (const h of hunters) if (h.kind === "drive" && h.mode !== "away" && h.position.distanceTo(lead.position) < 25) lead.away.push(h.position);
      if (s >= DRIVE.to) return "made";
      if (behind > 70 + L * 10 || t > 150) return "left";
      return null;
    },
    // How far the fish is from the middle of the school (for "stay with them").
    apart(fish) {
      return state === "on" ? fish.position.distanceTo(lead.position) : 0;
    },
  };
}
