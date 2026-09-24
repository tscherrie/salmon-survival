import * as THREE from "three";
import { MODEL_LENGTH, createFishMesh } from "./anatomy.js";
import { KING_POOL, S, bed, current, frame, level, locate, place, regionWeights, section } from "./course.js";
import { creatureMaterial, merganserFeetGeometry, merganserGeometry } from "./creatures.js";
import { conditions } from "./seasons.js";
import { blow, breathe, contact, freshFighter, takeBlow, winded } from "./fight.js";
import { odds } from "./brawl.js";

// What hunts the salmon under water, and how. Every hunter senses the fish the same way --
// by sight, over a distance that shrinks in murky water and in cover and grows when the
// fish moves fast, and by the lateral line close by, all round, in cover or not -- and turns
// and swims at the rate its body allows. How it hunts is its own:
//
//   stalk     the brown trout: from its station it turns to face what it has seen, then
//             swims at it steadily on an intercepting course, and from a couple of body
//             lengths strikes; misses, turns, tries again until it tires of it
//   ambush    the bullhead on the stones, the pike in the weed, the cod by the kelp: they do
//             not move, only turn a little to keep it in view, and strike like a spring when
//             it passes close in front of them
//   pursuit   the otter, the goosander and the seal: they roam, and when they see prey they
//             chase it down -- fast, agile, tireless for a while -- but they breathe air, and
//             when their breath runs out they must go up, which is the salmon's chance
//   pack      perch: a loose shoal that, when one sees prey, spreads round it and closes in,
//             striking from several sides
//
// Whatever can swallow the salmon kills it and swallows it; a smaller hunter only bites.

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

//   sight, lateral   how far it sees (clear water), how far it feels (units)
//   cruise, stalk, chase, strike   speeds (units a second)
//   range            from how far it strikes; turn: how fast it turns (radians a second)
//   notice           how long it takes to turn and decide (a warning to the player)
//   chaseTime        how long it keeps at one chase; air: how long it can stay under
//   prey             it hunts fish shorter than this; maxPrey: swallows fish shorter than
//                    this (fish hunters: anything less than half their own length)
export const PREDATORS = {
  trout: { body: "trout", coat: "trout", count: 2, size: [3.2, 4.6], regions: { brook: 1, upper: 0.8 }, from: 130, prey: 1.5, tactic: "stalk", sight: 13, lateral: 3, cruise: 2.5, stalk: 3, chase: 8, strike: 14, range: 2.2, turn: 3.2, notice: 0.6, chaseTime: 9, rest: 30, name: "Von einer Bachforelle gefressen" },
  bullhead: { body: "bullhead", coat: "bullhead", count: 3, nocturnal: true, size: [1.0, 1.5], regions: { brook: 1, upper: 0.7 }, from: 130, prey: 0.55, tactic: "ambush", bottom: true, sight: 2.6, lateral: 1.2, cruise: 0.6, strike: 7, range: 0.9, turn: 5, notice: 0.2, rest: 10, name: "Von einer Groppe geschnappt" },
  perch: { body: "perch", coat: "perch", count: 4, pack: true, size: [1.8, 2.8], regions: { middle: 1, lower: 1, estuary: 0.4, upper: 0.2 }, prey: 1.2, tactic: "pack", sight: 10, lateral: 2.5, cruise: 2, stalk: 4, chase: 7.5, strike: 11, range: 1.5, turn: 3.6, notice: 0.4, chaseTime: 12, rest: 25, name: "Von Flussbarschen erbeutet" },
  pike: { body: "pike", coat: "pike", count: 1, size: [8, 11], regions: { middle: 1, lower: 1, upper: 0.3, estuary: 0.3 }, prey: 4, tactic: "ambush", bank: true, sight: 9, lateral: 4, cruise: 1, strike: 18, range: 5, turn: 1.6, notice: 0.3, rest: 50, name: "Vom Hecht gefressen" },
  otter: { body: "otter", coat: "otter", count: 1, nocturnal: true, size: [9, 11], regions: { upper: 0.3, middle: 0.7, lower: 1, estuary: 1 }, prey: 6, maxPrey: 6, tactic: "pursuit", bank: true, air: 25, sight: 14, lateral: 4, cruise: 5, chase: 16, strike: 22, range: 2.4, turn: 4.5, notice: 0.3, chaseTime: 14, rest: 40, name: "Von einem Otter gefangen" },
  merganser: { bird: true, count: 1, size: [5.5, 6.5], regions: { brook: 0.4, upper: 1, middle: 1 }, from: 900, prey: 1.8, maxPrey: 1.8, tactic: "pursuit", floats: true, air: 20, sight: 11, lateral: 2.5, cruise: 3, chase: 11, strike: 15, range: 1.6, turn: 3.5, notice: 0.5, chaseTime: 16, rest: 35, name: "Von einem Gänsesäger erbeutet" },
  cod: { body: "cod", coat: "cod", count: 2, nocturnal: true, size: [6, 9], regions: { sea: 1, estuary: 0.3 }, prey: 3.2, tactic: "ambush", bottom: true, sight: 6, lateral: 3, cruise: 1.5, strike: 16, range: 3, turn: 2.2, notice: 0.3, rest: 30, name: "Von einem Dorsch geschluckt" },
  seal: { body: "seal", coat: "seal", count: 1, size: [14, 17], regions: { sea: 1, estuary: 0.7 }, prey: 10, maxPrey: 10, tactic: "pursuit", air: 45, sight: 40, lateral: 6, cruise: 5, chase: 20, strike: 24, range: 5, turn: 2.4, notice: 0.4, chaseTime: 15, rest: 45, name: "Von einer Robbe gefressen" },
  // A band of goosanders driving the smolt school in the lower river (the drive, drive.js):
  // they come only then, all together, circle the school under water and dash in at any
  // smolt out on its own. Before each dash one draws up for a moment -- the tell to dodge.
  drive: { bird: true, drive: true, count: 3, size: [5.6, 6.4], regions: {}, prey: 2.6, maxPrey: 2.6, tactic: "pursuit", air: 18, sight: 22, lateral: 3, cruise: 4.5, chase: 11, strike: 15, range: 1.8, turn: 3.2, notice: 0.35, chaseTime: 10, rest: 6, tell: 0.42, name: "Von Gänsesägern erbeutet" },
  // The old king of the trout: huge, slow to tire, and only ever in his own deep pool.
  king: { body: "trout", coat: "trout", count: 1, boss: true, tough: 0.3, size: [10, 11], regions: {}, prey: 5, tactic: "stalk", sight: 12, lateral: 4.5, cruise: 2, stalk: 2.6, chase: 7, strike: 15, range: 3.4, turn: 2.4, notice: 0.7, chaseTime: 7, rest: 20, name: "Vom alten König der Forellen gefressen" },
};

// What each is called, and which of them the salmon can fight: the fish. (The otter, the
// goosander and the seal are not to be fought.)
const TITLES = { trout: "Bachforelle", bullhead: "Groppe", perch: "Flussbarsch", pike: "Hecht", otter: "Otter", merganser: "Gänsesäger", drive: "Gänsesäger", cod: "Dorsch", seal: "Seehund", king: "Der alte König" };
for (const [kind, spec] of Object.entries(PREDATORS)) {
  spec.title = TITLES[kind];
  spec.fights = ["trout", "bullhead", "perch", "pike", "cod", "king"].includes(kind);
}
// What a fish spends of its breath: a second of each kind of effort, and each strike.
const EFFORT = { stalk: 0.03, chase: 0.06, encircle: 0.05, fight: 0.05 };
const STRIKE_BREATH = 0.25;
// Before a fish strikes it draws itself up, bent like a spring -- the moment to dodge (the
// ambushers give the least warning); and once it goes it is committed, and can correct its
// line only a little.
const COIL = { trout: 0.3, perch: 0.25, pike: 0.4, bullhead: 0.18, cod: 0.25, king: 0.45 };

export function createPredators(scene, { random, seize, captive }) {
  const range = (a, b) => a + (b - a) * random();
  const meshes = [];
  const list = [];
  const flow = {};
  const at = {};
  const weights = {};
  const toFish = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const mouth = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const birdMaterial = creatureMaterial();
  const fishMeshes = [];
  let clock = 0;
  // When the next goosander of the drive may go in.
  let driveNext = 0;

  for (const [kind, spec] of Object.entries(PREDATORS)) {
    let mesh = null;
    if (!spec.bird) {
      // Small hunters are drawn with the lighter body; the big ones fill the screen.
      mesh = createFishMesh(scene, spec.body, spec.coat, spec.count, { name: kind, cacheKey: `hunter-${kind}`, detail: spec.size[1] < 5 ? 0.55 : 1 });
      meshes.push(mesh.body, mesh.membranes);
      fishMeshes.push(mesh);
    }
    for (let i = 0; i < spec.count; i++) {
      let bird = null;
      if (spec.bird) {
        bird = new THREE.Group();
        const body = new THREE.Mesh(merganserGeometry(), birdMaterial);
        const feet = new THREE.Mesh(merganserFeetGeometry(), birdMaterial);
        feet.position.set(-1.6, -0.45, 0);
        body.castShadow = true;
        bird.add(body, feet);
        bird.userData.feet = feet;
        bird.visible = false;
        bird.name = kind;
        scene.add(bird);
      }
      list.push({
        kind,
        spec,
        mesh,
        bird,
        slot: i,
        index: i,
        position: new THREE.Vector3(0, -1e4, 0),
        heading: new THREE.Vector3(1, 0, 0),
        velocity: new THREE.Vector3(),
        speed: 0,
        river: { s: -1e5, u: 0 },
        home: new THREE.Vector3(),
        lastSeen: new THREE.Vector3(),
        seenAt: -1e9,
        chased: 0,
        size: range(...spec.size),
        mode: "away",
        until: 0,
        rest: spec.boss ? 2 : 15 + i * 20 + random() * 20,
        air: 0,
        phase: random() * TAU,
        finPhase: 0,
        gape: 0,
        pack: null,
      });
      refresh(list[list.length - 1]);
    }
  }
  // The perch hunt as one shoal.
  const packs = {};
  for (const h of list)
    if (h.spec.pack) {
      packs[h.kind] ??= { members: [], clock: 0, angle: 0 };
      packs[h.kind].members.push(h);
      h.pack = packs[h.kind];
    }

  const suit = (regions, s) => {
    regionWeights(s, weights);
    let v = 0;
    for (const [r, w] of Object.entries(regions)) v += (weights[r] ?? 0) * w;
    return v;
  };

  // Put a hunter (and its shoal) somewhere ahead of the salmon, where its kind lives.
  function station(h, fish, travel) {
    const spec = h.spec;
    for (let tries = 0; tries < 10; tries++) {
      const s = fish.river.s + (travel || 1) * range(35, 85) * (h.kind === "seal" ? 2 : 1) + range(-15, 15);
      if (s < (spec.from ?? 130) || random() > suit(spec.regions, s)) continue;
      const c = section(Math.min(s, S.coast));
      let u = s >= S.straight ? fish.river.u + range(-80, 80) : c.thalweg + range(-0.6, 0.6) * c.half;
      // The pike and the otter keep to the margins, by the weed and the banks.
      if (spec.bank && s < S.straight) u = c.thalweg + (random() < 0.5 ? -1 : 1) * range(0.4, 0.75) * c.half;
      const floor = bed(s, u);
      const lv = level(s);
      if (lv - floor < h.size * 0.5) continue;
      place(s, u, at);
      const y = spec.bottom ? floor + h.size * 0.12 : spec.floats ? lv - h.size * 0.08 : floor + Math.min((lv - floor) * 0.5, h.size * 0.4 + 1);
      const members = h.pack ? h.pack.members : [h];
      frame(s, at);
      for (const m of members) {
        const k = m === h ? 0 : 1;
        m.position.set(at.x + (k ? range(-3, 3) : 0), y + (k ? range(-0.5, 0.5) : 0), at.z + (k ? range(-3, 3) : 0));
        place(s, u, tmp);
        if (!k) m.position.set(tmp.x, y, tmp.z);
        else m.position.set(tmp.x + range(-3, 3), y + range(-0.5, 0.5), tmp.z + range(-3, 3));
        m.home.copy(m.position);
        locate(m.position.x, m.position.z, s, m.river);
        m.heading.set(-at.tx, 0, -at.tz);
        m.mode = "hold";
        m.speed = 0;
        m.air = 0;
        // A new place, a new fish.
        freshFighter(m, random);
      }
      return true;
    }
    h.mode = "away";
    return false;
  }

  // What the hunter makes of the fish: 1 it feels it close by (lateral line), 2 it sees
  // it, -1 it would see it but the fish is hidden (in weed, or behind a stone or the lie of
  // the bed), 0 nothing.
  function perceive(h, fish, ctx) {
    if (fish.captive || fish.airborne) return 0;
    toFish.subVectors(fish.position, h.position);
    const d = toFish.length();
    const L = fish.length;
    const moving = fish.relative.length();
    const loud = moving > ctx.cruise * 1.5 ? 1.3 : moving < ctx.cruise * 0.3 ? 0.7 : 1;
    if (d < h.spec.lateral * (1 + L * 0.2) * loud) return 1;
    // Those that hunt by eye see little in the dark; the otter's whiskers, the bullhead's
    // and the cod's lateral lines and barbels do not need the light.
    const light = h.spec.nocturnal ? 1 : 0.25 + 0.75 * conditions.light;
    // In bright, shallow, open water (the rich drift of a riffle) it is seen from further off.
    if (d > h.spec.sight * ctx.clarity * light * (1 + L * 0.06) * loud * (1 + 0.6 * (ctx.exposed ?? 0))) return 0;
    // Anything but right behind it.
    if (h.heading.dot(toFish) <= -0.25 * d) return 0;
    if (ctx.covered) return -1;
    // A stone between them hides the fish (asked a few times a second, not every frame).
    if (ctx.occluded) {
      if (ctx.time - (h.sightAt ?? -1) > 0.15) {
        h.sightAt = ctx.time;
        h.blocked = ctx.occluded(h.position, fish.position, L);
      }
      if (h.blocked) return -1;
    }
    return 2;
  }
  function senses(h, fish, ctx) {
    h.perceived = perceive(h, fish, ctx);
    return h.perceived > 0;
  }
  // Where to aim to meet the fish, at this speed.
  function intercept(h, fish, speed, out) {
    const d = h.position.distanceTo(fish.position);
    const t = Math.min(1.5, d / Math.max(speed, 1));
    return out.copy(fish.position).addScaledVector(fish.velocity, t);
  }
  // Turn the heading toward `want` by no more than `rate` radians a second.
  function steer(h, want, rate, dt) {
    tmp.copy(want);
    if (tmp.lengthSq() < 1e-8) return;
    tmp.normalize();
    tmp.y = clamp(tmp.y, -0.6, 0.6);
    tmp.normalize();
    const cos = clamp(h.heading.dot(tmp), -1, 1);
    const angle = Math.acos(cos);
    if (angle < 1e-4) return void h.heading.copy(tmp);
    const step = rate * dt;
    if (cos < -0.95) {
      // Straight behind: turn about the vertical.
      h.heading.applyAxisAngle(UP, step);
    } else h.heading.lerp(tmp, Math.min(1, step / angle));
    h.heading.normalize();
  }
  const canSwallow = (h, L) => (h.spec.maxPrey ? L < h.spec.maxPrey : h.size >= L * 2.2);

  // A fresh fighter; the old king is always at his full strength.
  function refresh(h) {
    freshFighter(h, random);
    if (h.spec.boss) {
      h.maxKraft = h.kraft = h.puste = 1;
      h.weak = false;
    }
  }
  // The king in the deepest part of his pool, facing up the current.
  function stationKing(h) {
    const s = KING_POOL.s + range(-6, 6);
    const c = section(s);
    const u = c.thalweg + range(-0.2, 0.2) * c.half;
    const floor = bed(s, u);
    place(s, u, at);
    h.position.set(at.x, floor + h.size * 0.35, at.z);
    h.home.copy(h.position);
    locate(h.position.x, h.position.z, s, h.river);
    frame(s, at);
    h.heading.set(-at.tx, 0, -at.tz);
    h.mode = "hold";
    h.speed = 0;
    h.air = 0;
    refresh(h);
  }

  function hide(h) {
    if (h.mesh) {
      h.mesh.body.setMatrixAt(h.slot, hidden);
      h.mesh.membranes.setMatrixAt(h.slot, hidden);
    }
    if (h.bird) h.bird.visible = false;
  }

  return {
    meshes,
    list,
    force(kind, x, y, z) {
      const h = list.find((q) => q.kind === kind);
      if (!h) return null;
      for (const m of h.pack ? h.pack.members : [h]) {
        const k = m === h ? 0 : 1;
        m.position.set(x + k * range(-2.5, 2.5), y + k * range(-0.4, 0.4), z + k * range(-2.5, 2.5));
        m.home.copy(m.position);
        locate(m.position.x, m.position.z, null, m.river);
        m.mode = "hold";
        m.rest = 0;
        m.air = 0;
      }
      return h;
    },
    // The drive (drive.js): the goosanders come in round the school -- one ahead, two
    // behind to either side, landing on the water -- or, when it is over, go up and away.
    drive(fish, on) {
      driveNext = clock + 3;
      for (const h of list) {
        if (!h.spec.drive) continue;
        if (on) {
          const s = Math.min(fish.river.s + [24, -16, -12][h.index % 3], S.coast - 1);
          const c = section(s);
          const u = c.thalweg + [0, -0.45, 0.45][h.index % 3] * c.half;
          place(s, u, at);
          h.position.set(at.x, level(s) - h.size * 0.08, at.z);
          h.home.copy(h.position);
          locate(h.position.x, h.position.z, s, h.river);
          frame(s, at);
          h.heading.set(at.tx, 0, at.tz).normalize();
          h.mode = "hold";
          h.rest = 3 + h.index * 2.5;
          h.air = 0;
          h.speed = 0;
          h.leaveUntil = 0;
          h.lunge = null;
          h.coilUntil = 0;
        } else if (h.mode !== "away" && h.mode !== "swallow") {
          h.mode = "surface";
          h.until = clock + 2;
          h.rest = 999;
          h.leaveUntil = clock + 5;
        }
      }
    },
    reset() {
      for (const h of list) {
        h.mode = "away";
        h.rest = h.spec.boss ? 2 : 20 + random() * 30;
        h.position.set(0, -1e4, 0);
        refresh(h);
        hide(h);
      }
    },
    // Who is after the salmon now, and how close to striking (for the warnings round the
    // edge of the screen): 0.4 it has noticed it, 0.6 stalking or lying in wait with it in
    // view, 0.8 chasing, 1 about to strike (coiled).
    threats(fish, out) {
      for (const h of list) {
        if (h.beaten || h.mode === "away" || fish.captive) continue;
        const d = h.position.distanceTo(fish.position);
        if (d > 45) continue;
        let level = 0;
        if (h.mode === "strike") level = 1;
        else if (h.mode === "chase" || h.mode === "encircle" || h.mode === "fight") level = 0.8;
        else if (h.mode === "stalk" || h.mode === "raid" || (h.mode === "lurk" && h.perceived > 0)) level = 0.6;
        else if (h.mode === "notice") level = 0.4;
        if (!level) continue;
        out.push({ position: h.position, level, coiled: h.mode === "strike" && clock < (h.coilUntil ?? 0), kind: h.kind, title: TITLES[h.kind] ?? h.spec.title, key: h });
      }
      return out;
    },
    // Whether a fish that could be fought is after the salmon now.
    threat(fish) {
      for (const h of list)
        if (h.spec.fights && !h.beaten && ["stalk", "chase", "encircle", "strike", "lurk", "fight"].includes(h.mode) && h.position.distanceTo(fish.position) < 8 + h.size * 2) return true;
      return false;
    },
    // The fish the salmon is fighting -- only one it has struck at least once; how strong
    // it is, the salmon learns only by trying: the one struck last, or else the nearest
    // struck one still about it.
    foe(fish) {
      let best = null,
        bestScore = -Infinity;
      for (const h of list) {
        if (!h.spec.fights || h.mode === "away" || !h.struck) continue;
        const d = h.position.distanceTo(fish.position);
        const since = clock - h.fightAt;
        const recent = since < 12 && (!h.beaten || since < 3);
        const engaged = !h.beaten && ["stalk", "chase", "encircle", "strike", "recover", "fight", "lurk", "notice"].includes(h.mode) && d < 8 + h.size * 2;
        // Close enough to take on, even while it waits.
        const close = !h.beaten && h.mode !== "cowed" && d < 3 + h.size * 1.2;
        if (!recent && !engaged && !close) continue;
        const score = (recent ? 100 - since : 0) - d;
        if (score > bestScore) {
          bestScore = score;
          best = h;
        }
      }
      return best && { score: bestScore, weak: best.weak, kind: best.kind, title: best.spec.title, kraft: best.kraft, puste: best.puste, winded: winded(best), beaten: best.beaten, position: best.position, heading: best.heading, size: best.size };
    },
    // ctx: { time, travel, covered, clarity, cruise, occluded(from, to, length) }. Returns
    // { bitten, killed }, and whether a hunter has the fish in sight (watched) or would
    // but for its hiding (hidden).
    update(dt, fish, ctx, result) {
      const L = fish.length;
      const time = ctx.time;
      clock = time;
      result.hits ??= [];
      for (const mesh of fishMeshes) mesh.begin();
      // Night: the otter, the bullhead and the cod are out and about; the goosander has
      // gone to roost, and the rest hunt less.
      const night = conditions.night;
      const iced = conditions.ice > 0.5;
      for (const h of list) {
        const spec = h.spec;
        const activity = spec.nocturnal ? 0.6 + 1.6 * night : spec.bird ? (night > 0.6 || iced ? 0 : 1) : 1 - 0.45 * night;
        h.rest = Math.max(0, h.rest - dt * (spec.nocturnal ? 1 + 2 * night : 1));
        const held = captive.active && captive.hunter === h;
        // The old king keeps to his own pool, and is there whenever a fish he could eat
        // comes near it.
        // Whether it hunts the salmon (it is small enough), and whether it is about at all:
        // the fish are there whether or not the salmon has outgrown them -- they can still be
        // fought -- while the otter, the goosander and the seal come only for prey.
        const hunts = L < spec.prey;
        const interested = spec.boss
          ? Math.abs(fish.river.s - KING_POOL.s) < 170 || held
          : spec.drive
            ? !!ctx.drive || time < (h.leaveUntil ?? 0) || held
            : ((hunts || spec.fights) && suit(spec.regions, fish.river.s) > 0.3 && activity > 0) || held;
        if (h.mode === "away") {
          hide(h);
          const leader = !h.pack || h.pack.members[0] === h;
          if (spec.boss) {
            if (interested && h.rest <= 0) stationKing(h);
          } else if (!spec.drive && leader && interested && h.rest <= 0 && random() < dt * 0.2 * activity) station(h, fish, ctx.travel);
          continue;
        }
        locate(h.position.x, h.position.z, h.river.s, h.river);
        if ((Math.abs(h.river.s - fish.river.s) > 260 || !interested) && !held && h.mode !== "strike") {
          h.mode = "away";
          // A beaten fish is gone for good; whatever comes in its place is another, later.
          if (h.beaten) h.rest = Math.max(h.rest, spec.boss ? 900 : 600);
          refresh(h);
          hide(h);
          continue;
        }
        current(h.river.s, h.river.u, h.position.y, flow, time);
        const lv = level(h.river.s);
        const floor = bed(h.river.s, h.river.u);
        const sees = !held && senses(h, fish, ctx);
        // For the eye on the card: someone has the fish in sight, or would, but it hides.
        if (!held && !h.beaten && h.mode !== "cowed" && h.mode !== "flee" && (hunts || h.mode === "fight")) {
          if (h.perceived > 0) result.watched = true;
          else if (h.perceived < 0) result.hidden = true;
        }
        if (sees) {
          h.lastSeen.copy(fish.position);
          h.seenAt = time;
          // A shoal shares what any of it sees.
          if (h.pack) for (const m of h.pack.members) m.seenAt = time;
        }
        toFish.subVectors(fish.position, h.position);
        const d = toFish.length();
        const facing = d > 1e-4 ? h.heading.dot(toFish) / d : 1;
        let speed = 0;
        let rate = spec.turn;
        dir.copy(h.heading);
        let prevMode = h.mode;
        // The salmon fights back: a burst that lands on it is a blow.
        if (spec.fights && !h.beaten && !held && fish.lunging > 0 && h.hitBy !== fish.lungeCount && !fish.safe && d < h.size + L * 2) {
          const where = contact(fish, h);
          if (where) {
            h.hitBy = fish.lungeCount;
            const tired = winded(h);
            const beaten = takeBlow(h, blow(where, L, h.size, tired) * (spec.tough ?? 1));
            h.fightAt = h.seenAt = h.chased = time;
            result.hits.push({ kind: h.kind, title: spec.title, where, beaten, winded: tired });
            // The blow knocks it aside; the salmon bounces off.
            h.position.addScaledVector(fish.heading, 0.12 * L + 0.02 * h.size);
            fish.relative.multiplyScalar(0.35);
            if (beaten) {
              h.mode = "flee";
              h.until = time + 5;
            } else if (!canSwallow(h, L) && odds(h, fish, spec.boss ? 1.5 : 1) < 1) {
              // Outmatched by the salmon: it does not stay to fight.
              h.mode = "flee";
              h.until = time + 4;
              result.hits[result.hits.length - 1].fled = true;
            } else if (where === "front" && canSwallow(h, L) && !winded(h)) {
              // Head on into its jaws: it snaps at once, no warning.
              h.mode = prevMode = "strike";
              h.until = time + 0.4;
              h.coilUntil = 0;
              h.lunge = null;
            } else if (!["strike", "swallow", "leave"].includes(h.mode)) h.mode = "fight";
          }
        }
        // Out of breath it cannot strike.
        const able = !spec.fights || !winded(h);
        // Air-breathers go up when their breath runs out, and whatever they were doing waits.
        if (spec.air) {
          const under = h.position.y < lv - h.size * 0.3;
          h.air = under ? h.air + dt : Math.max(0, h.air - dt * 4);
          if (h.air > spec.air && !["surface", "swallow", "leave"].includes(h.mode)) {
            h.mode = "surface";
            h.until = time + 4;
          }
        }
        // Grown too big for it while it was on the hunt: it gives up (unless it is fighting).
        if (!hunts && ["notice", "stalk", "lurk", "chase", "encircle"].includes(h.mode)) h.mode = spec.tactic === "ambush" ? "hold" : "return";
        // The goosanders of the drive have no place of their own to go back to: they keep
        // with the school.
        if (spec.drive && ctx.drive && h.mode === "return") h.mode = "hold";
        switch (h.mode) {
          case "hold": {
            if (spec.drive && ctx.drive) {
              // Circling the school, a little above it, each on its own side -- or, when the
              // salmon has fallen out of it, round the salmon: a smolt on its own is theirs.
              const alone = fish.position.distanceTo(ctx.drive.position) > ctx.drive.radius * 1.3;
              const lead = alone ? fish.position : ctx.drive.position;
              const a = time * 0.35 + h.index * (TAU / 3);
              const r = 9 + 3 * Math.sin(time * 0.5 + h.index * 1.3);
              aim.set(lead.x + Math.cos(a) * r, Math.min(lead.y + 1.5, lv - h.size * 0.4), lead.z + Math.sin(a) * r);
              dir.subVectors(aim, h.position);
              speed = Math.min(spec.chase, 2 + dir.length() * 0.8);
            } else if (spec.tactic === "pursuit" && !spec.floats) {
              // Roaming about its patch.
              const t = time * 0.25 + h.index * 2;
              aim.set(h.home.x + Math.cos(t) * 6, h.home.y + Math.sin(t * 0.7) * 1.5, h.home.z + Math.sin(t) * 6);
              dir.subVectors(aim, h.position);
              speed = spec.cruise;
            } else {
              // Holding its station, facing into the current.
              dir.subVectors(h.home, h.position);
              const off = dir.length();
              if (off < 0.6) dir.set(-flow.vx - 1e-3, 0, -flow.vz);
              speed = Math.min(spec.cruise + flow.speed, off * 2 + flow.speed);
              if (h.pack) {
                // The shoal mills about its middle.
                dir.x += Math.sin(time * 0.6 + h.index * 1.7) * 0.5;
                dir.z += Math.cos(time * 0.5 + h.index * 2.3) * 0.5;
              }
            }
            // The goosanders of the drive go in one at a time -- mostly into the thick of the
            // school, taking whichever smolt they meet; at the salmon when it is out on the
            // edge or on its own (or, now and then, even in the middle).
            const turn = !spec.drive || (time > driveNext && !list.some((o) => o !== h && o.spec.drive && ["notice", "chase", "strike", "recover", "raid"].includes(o.mode)));
            if (spec.drive && ctx.drive && h.rest <= 0 && turn) {
              const inside = fish.position.distanceTo(ctx.drive.position) < ctx.drive.radius;
              // (and not one straight after another)
              if (inside || sees) driveNext = time + 6;
              if (inside && (!sees || random() < 0.75)) {
                h.mode = "raid";
                h.until = time + 4;
                h.raidAt = new THREE.Vector3(range(-2, 2), range(-1, 1), range(-2, 2));
                break;
              }
            }
            if (sees && h.rest <= 0 && hunts && turn) {
              h.mode = "notice";
              h.until = time + spec.notice;
              if (h.pack)
                for (const m of h.pack.members)
                  if (m !== h && m.mode === "hold" && !m.beaten) {
                    m.mode = "notice";
                    m.until = time + spec.notice + 0.2;
                  }
            }
            break;
          }
          case "notice":
            // It has seen something: it turns to face it, and decides.
            dir.copy(toFish);
            speed = flow.speed * 0.9;
            rate *= 1.3;
            if (time > h.until) {
              h.chased = time;
              if (spec.tactic === "stalk") h.mode = "stalk";
              else if (spec.tactic === "ambush") h.mode = "lurk";
              else if (spec.tactic === "pack") {
                h.mode = "encircle";
                h.pack.clock = h.pack.clock > time - 1 ? h.pack.clock : time;
                h.pack.angle = Math.atan2(h.position.z - fish.position.z, h.position.x - fish.position.x);
              } else h.mode = "chase";
            }
            break;
          case "stalk":
            intercept(h, fish, spec.stalk, aim);
            dir.subVectors(aim, h.position);
            speed = spec.stalk + (flow.speed * 0.5);
            if (!sees && time - h.seenAt > 2) h.mode = "return";
            else if (able && d < spec.range * 1.3 && facing > 0.9) {
              h.mode = "strike";
              h.until = time + 0.5;
            } else if (time - h.chased > spec.chaseTime) {
              h.mode = "return";
              h.rest = spec.rest * 0.5;
            }
            break;
          case "lurk":
            // Still as a stone, only turning a little to keep it in front.
            dir.copy(toFish);
            rate *= 0.4;
            speed = spec.bottom ? 0 : flow.speed * 0.9;
            if (able && d < spec.range && facing > 0.75 && sees) {
              h.mode = "strike";
              h.until = time + 0.45;
            } else if (time - h.seenAt > 3) h.mode = "hold";
            break;
          case "chase": {
            intercept(h, fish, spec.chase, aim);
            dir.subVectors(aim, h.position);
            speed = spec.chase;
            // (a goosander of the drive measures from its bill, well ahead of its body)
            const near = spec.drive ? mouth.copy(h.position).addScaledVector(h.heading, (3.8 * h.size) / 6).distanceTo(fish.position) : d;
            if (able && near < spec.range * 1.4 && facing > 0.85) {
              h.mode = "strike";
              h.until = time + 0.5;
            } else if (time - h.chased > spec.chaseTime || time - h.seenAt > 2.5) {
              h.mode = spec.air ? "surface" : "return";
              h.until = time + 4;
              h.rest = spec.rest * 0.5;
            }
            break;
          }
          case "raid": {
            // Into the school, fast, and out again with a smolt.
            if (!ctx.drive) {
              h.mode = "hold";
              break;
            }
            aim.copy(ctx.drive.position).add(h.raidAt);
            dir.subVectors(aim, h.position);
            speed = spec.strike * 0.85;
            rate *= 1.4;
            mouth.copy(h.position).addScaledVector(h.heading, (3.8 * h.size) / 6);
            if (mouth.distanceTo(aim) < 1.6) {
              if (ctx.drive.take?.(mouth)) result.raided = (result.raided ?? 0) + 1;
              h.mode = "leave";
              h.until = time + 3;
              h.rest = spec.rest * 1.6;
            } else if (time > h.until) {
              h.mode = "hold";
              h.rest = spec.rest * 0.5;
            }
            break;
          }
          case "encircle": {
            // Spread round the fish and close in; strike from wherever is nearest.
            const pack = h.pack;
            const n = pack.members.length;
            const since = time - pack.clock;
            const radius = spec.range * (2.4 - Math.min(1.1, since * 0.35));
            const a = pack.angle + (h.index / n) * TAU;
            aim.set(fish.position.x + Math.cos(a) * radius, fish.position.y + Math.sin(a * 1.7) * 0.4, fish.position.z + Math.sin(a) * radius);
            dir.subVectors(aim, h.position);
            if (dir.length() < 0.8) dir.copy(toFish);
            speed = spec.chase * Math.min(1, 0.4 + dir.length() * 0.3);
            if (able && since > 1.2 && d < spec.range * 1.4 && facing > 0.8) {
              h.mode = "strike";
              h.until = time + 0.55;
            } else if (since > spec.chaseTime || time - h.seenAt > 3) {
              for (const m of pack.members) if (m.mode === "encircle") m.mode = "return";
              h.rest = spec.rest * 0.5;
            }
            break;
          }
          case "strike": {
            if ((spec.fights || spec.tell) && time < h.coilUntil) {
              // The tell: drawn up on the line it has chosen, still -- unless the salmon comes
              // right up to its jaws, when it goes at once.
              dir.copy(h.lunge ?? toFish);
              speed = 0;
              h.speed *= Math.exp(-dt * 8);
              if (d < h.size * 0.45 + L * 0.8) h.coilUntil = time;
              else break;
            }
            intercept(h, fish, spec.strike, aim);
            dir.subVectors(aim, h.position);
            speed = spec.strike;
            if (spec.fights || spec.tell) {
              // Committed: it goes along the line it chose while it coiled.
              if (!h.lunge) h.lunge = dir.clone().normalize();
              dir.copy(h.lunge);
              rate *= 0.35;
            } else rate *= 1.6;
            const reach = spec.bird ? (3.8 * h.size) / 6 : (0.35 * h.size) / MODEL_LENGTH;
            mouth.copy(h.position).addScaledVector(h.heading, reach);
            if (!captive.active && !fish.captive && !fish.safe && mouth.distanceTo(fish.position) < 0.4 + L * 0.35 + h.size * 0.04) {
              if (ctx.decoy && ctx.decoy(mouth)) {
                // Into a school: it takes the one it gets, and it is another.
                result.decoy = true;
                h.mode = "leave";
                h.until = time + 5;
              } else if (canSwallow(h, L)) {
                result.killed = spec.name;
                seize("fish", h);
                h.mode = "swallow";
                h.until = time + 1.6;
              } else {
                result.bitten = true;
                // A bite: the bigger the biter against the salmon, the worse.
                fish.energy = Math.max(0, fish.energy - 0.3 * clamp(h.size / L, 0.25, 1));
                // A hunter goes off with its bite; a fish only fighting back keeps at it.
                const fighting = !hunts && time - h.fightAt < 10;
                h.mode = fighting ? "recover" : "leave";
                h.until = time + (fighting ? 1.2 : 5);
              }
              h.rest = spec.rest;
              if (h.pack) for (const m of h.pack.members) if (m !== h && m.mode !== "away" && !m.beaten) m.mode = "return";
            } else if (time > h.until) {
              h.mode = "recover";
              h.until = time + (spec.tactic === "ambush" ? 1.5 : 1.1);
              // A strike that missed: the salmon got away (counted on its life card).
              if (hunts && !fish.captive) result.missed = (result.missed ?? 0) + 1;
            }
            break;
          }
          case "recover":
            // Overshot: slow, turning back.
            dir.copy(toFish);
            speed = spec.cruise * 0.6;
            rate *= 0.8;
            if (time > h.until) {
              const keen = sees && time - h.chased < (spec.chaseTime ?? 4);
              if (!keen) {
                h.mode = spec.tactic === "ambush" ? "hold" : "return";
                h.rest = spec.rest * 0.4;
              } else h.mode = spec.tactic === "stalk" ? "stalk" : spec.tactic === "ambush" ? "lurk" : spec.tactic === "pack" ? "encircle" : "chase";
              // Stung, it goes on with the fight.
              if (spec.fights && time - h.fightAt < 10) h.mode = "fight";
            }
            break;
          case "fight":
            // Struck: it turns on the salmon and goes for it while it has the breath.
            intercept(h, fish, spec.strike * 0.6, aim);
            dir.subVectors(aim, h.position);
            speed = (spec.stalk ?? spec.cruise * 2.2) + flow.speed * 0.5;
            rate *= 1.5;
            if (able && d < spec.range * 1.3 && facing > 0.85) {
              h.mode = "strike";
              h.until = time + 0.5;
            } else if (time - h.fightAt > 10 && time - h.seenAt > 2) h.mode = spec.tactic === "ambush" ? "hold" : "return";
            break;
          case "flee":
            // Beaten: away from the salmon as fast as it still can.
            dir.copy(toFish).multiplyScalar(-1);
            dir.y = 0;
            speed = (spec.chase ?? spec.strike * 0.5) * 0.7;
            if (time > h.until) {
              h.mode = "cowed";
              h.home.copy(h.position);
            }
            break;
          case "cowed": {
            // And after that it keeps out of the salmon's way for good.
            const wide = 6 + h.size * 1.5 + L * 3;
            if (d < wide) {
              dir.copy(toFish).multiplyScalar(-1);
              dir.y = 0;
              speed = spec.cruise * 1.6 + flow.speed * 0.5;
              h.home.copy(h.position);
            } else {
              dir.subVectors(h.home, h.position);
              const off = dir.length();
              if (off < 0.6) dir.set(-flow.vx - 1e-3, 0, -flow.vz);
              speed = Math.min(spec.cruise + flow.speed, off * 2 + flow.speed);
            }
            break;
          }
          case "return":
            dir.subVectors(h.home, h.position);
            speed = spec.cruise + flow.speed * 0.5;
            if (dir.length() < 1) h.mode = "hold";
            break;
          case "surface":
            // Up for air, and a breather there before going on.
            dir.set(h.heading.x, 0, h.heading.z).normalize().multiplyScalar(0.5);
            dir.y = lv - h.size * 0.08 - h.position.y > 0.3 ? 1 : 0;
            speed = spec.cruise;
            if (spec.drive && ctx.drive) {
              // ...pattering along on top, over the school and a little ahead of it.
              aim.copy(ctx.drive.position).addScaledVector(ctx.drive.heading, 8);
              dir.set(aim.x - h.position.x, 0, aim.z - h.position.z);
              const off = dir.length();
              dir.normalize();
              dir.y = lv - h.size * 0.08 - h.position.y > 0.3 ? 1.5 : 0;
              speed = Math.min(spec.chase * 1.2, 2 + off * 0.8);
            }
            if (time > h.until && h.air < 1) {
              h.mode = "hold";
              h.home.copy(h.position);
              if (!spec.floats) h.home.y = Math.max(floor + h.size * 0.4, lv - h.size * 1.5);
            }
            break;
          case "swallow":
            dir.copy(h.heading);
            speed = 1.2;
            if (time > h.until) {
              h.mode = "leave";
              h.until = time + 4;
            }
            break;
          case "leave":
            dir.copy(toFish).multiplyScalar(-1);
            speed = 2;
            if (time > h.until) {
              h.mode = "hold";
              h.home.copy(h.position);
            }
            break;
        }
        // A goosander of the drive draws up for a moment before it dashes, on the line it
        // has picked (the salmon's moment to dodge).
        if (spec.tell && h.mode === "strike" && prevMode !== "strike") {
          h.coilUntil = time + spec.tell;
          h.until += spec.tell;
          intercept(h, fish, spec.strike, aim);
          h.lunge = aim.sub(h.position).normalize().clone();
        }
        if (spec.fights) {
          // Its breath: spent by the hunt and by every strike, back while it waits.
          if (h.mode === "strike" && prevMode !== "strike") {
            h.puste = Math.max(0, h.puste - STRIKE_BREATH);
            const coil = COIL[h.kind] ?? 0.25;
            h.coilUntil = time + coil;
            h.until += coil;
            // It picks its line now, where the salmon will be if it keeps on as it is.
            intercept(h, fish, spec.strike, aim);
            h.lunge = aim.sub(h.position).normalize().clone();
          }
          // Out of breath it gives up the hunt and backs off to get it back -- slowly, its
          // tail to the salmon.
          if (winded(h) && ["stalk", "chase", "encircle", "fight", "lurk"].includes(h.mode)) h.mode = spec.tactic === "ambush" ? "hold" : "return";
          const resting = ["hold", "lurk", "return", "notice", "cowed"].includes(h.mode);
          breathe(h, dt, { effort: EFFORT[h.mode] ?? 0, rest: resting && time - h.fightAt > 1.5 });
          // Out of breath it swims and turns heavily; beaten, it finds what it has left to flee.
          if (h.mode !== "flee" && h.mode !== "cowed") {
            const vigor = 0.4 + 0.6 * Math.min(1, h.puste / 0.35);
            speed *= vigor;
            rate *= 0.5 + 0.5 * vigor;
          }
        }
        steer(h, dir, rate, dt);
        // Swimming is through the water: the current carries hunter and hunted alike.
        h.speed += (speed - h.speed) * (1 - Math.exp(-dt * (speed > h.speed ? (h.mode === "strike" ? 12 : 3) : 2)));
        h.velocity.copy(h.heading).multiplyScalar(h.speed);
        h.velocity.x += flow.vx;
        h.velocity.z += flow.vz;
        h.position.addScaledVector(h.velocity, dt);
        locate(h.position.x, h.position.z, h.river.s, h.river);
        const floor2 = bed(h.river.s, h.river.u);
        const lv2 = level(h.river.s);
        if (lv2 - floor2 < h.size * 0.3) {
          h.position.addScaledVector(h.velocity, -dt);
          h.home.copy(h.position);
        }
        const resting = h.mode === "hold" || h.mode === "lurk" || h.mode === "notice";
        let low = floor2 + h.size * 0.12,
          high = lv2 - h.size * 0.1;
        if (spec.floats && (resting || h.mode === "surface")) low = high = lv2 - h.size * 0.08;
        else if (spec.floats || spec.air) high = lv2 - h.size * 0.05;
        if (spec.bottom && resting) high = low;
        h.position.y = clamp(h.position.y, low, Math.max(low, high));
        // The body: its swimming wave, its fins, its jaws.
        const beat = 0.6 + (h.speed / h.size) * 1.4;
        h.phase = (h.phase + dt * TAU * beat) % TAU;
        h.finPhase = (h.finPhase + dt * TAU * 1.4) % TAU;
        const swallowing = h.mode === "swallow" && held;
        const panting = spec.fights && winded(h) ? 0.35 + 0.25 * Math.sin(time * 9 + h.index) : 0;
        const wantGape = h.mode === "strike" ? (time < (h.coilUntil ?? 0) ? 0.35 : 1) : swallowing ? (captive.t < 0.75 ? 1 : 0) : h.mode === "stalk" || h.mode === "chase" ? Math.max(0.15, panting) : panting;
        h.gape += (wantGape - h.gape) * (1 - Math.exp(-dt * (wantGape > h.gape ? 14 : 9)));
        axisZ.crossVectors(h.heading, UP);
        if (axisZ.lengthSq() < 1e-6) axisZ.set(0, 0, 1);
        axisZ.normalize();
        axisY.crossVectors(axisZ, h.heading).normalize();
        basis.makeBasis(h.heading, axisY, axisZ);
        quaternion.setFromRotationMatrix(basis);
        if (h.mesh) {
          const k = h.size / MODEL_LENGTH;
          matrix.compose(h.position, quaternion, scale.set(k, k, k));
          h.mesh.body.setMatrixAt(h.slot, matrix);
          h.mesh.membranes.setMatrixAt(h.slot, matrix);
          const coiled = h.mode === "strike" && time < (h.coilUntil ?? 0);
          h.mesh.swim.setXYZW(h.slot, h.phase, coiled ? 0.95 : 0.3 + Math.min(0.5, (h.speed / h.size) * 0.4), 0, resting ? 0.5 : 0.1);
          h.mesh.fin.setX(h.slot, h.finPhase);
          h.mesh.mouth.setX(h.slot, h.gape);
        } else if (h.bird) {
          h.bird.visible = true;
          h.bird.position.copy(h.position);
          h.bird.quaternion.copy(quaternion);
          const k = h.size / 6;
          h.bird.scale.setScalar(k);
          // The feet: paddling hard under water, idling on the surface.
          h.bird.userData.feet.rotation.z = Math.sin(h.phase * 1.3) * (resting ? 0.2 : 0.7);
        }
        if (held) {
          const reach = h.bird ? (3.8 * h.size) / 6 : (0.33 * h.size) / MODEL_LENGTH;
          captive.grip.copy(h.position).addScaledVector(h.heading, reach);
          captive.heading.copy(h.heading);
        }
      }
      for (const mesh of fishMeshes) mesh.finish();
      return result;
    },
  };
}
