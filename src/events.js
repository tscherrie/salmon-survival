import * as THREE from "three";
import { waterLitShader } from "../../riverscape/src/water.js";
import { MODEL_LENGTH, createFishMesh } from "./anatomy.js";
import { bed, current, frame, level, locate, place, regionWeights, section } from "./course.js";
import { conditions } from "./seasons.js";
import { mergeTubes, trunkGeometry } from "./terrain.js";

// What happens now and then on the river, beyond the round of the days and the seasons:
//
//   storm    a summer thunderstorm: the sky goes dark, rain, lightning (through the water a
//            flash, then the thunder rolling), and half a minute in the flash flood -- the
//            river rising brown and fast, branches tumbling down it that knock a fish aside
//   angler   a man on the bank casting a fly, swinging it across the current; it looks like
//            any fly on the water, but a fine line runs from it. A fish that takes it is on
//            the hook and reeled in -- unless it tears itself free (Space, away from him)
//   otters   an otter and her cubs at play: loud, fast, harmless to the fish now -- and the
//            hunting fish keep clear of them
//   floes    the ice going out in early April: floes drifting down on the melt, dark slabs
//            overhead that shut the fish off from the air
//   aurora   on clear winter nights the northern lights over the water (seen above it, or
//            through the window in the surface)
//
// (The run home -- the grown salmon going up together in autumn -- is a school, school.js.)
// ?event=storm|angler|otters|floes|aurora starts one at once, for trying it.

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const UP = new THREE.Vector3(0, 1, 0);

const STORM = { length: 150, floodFrom: 35, floodFull: 70, recede: 70 };

export function createEvents(scene, { rocks, sound, daylight, life, random = Math.random, query = new URLSearchParams(location.search) }) {
  const range = (a, b) => a + (b - a) * random();
  const forced = query.get("event");
  const weights = {};
  const at = {};
  const flow = {};
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const happened = [];
  let clock = 0;
  // When each may next come (seconds of play); a forced one comes at once.
  const next = { storm: range(240, 480), angler: range(150, 300), otters: range(200, 420) };
  if (forced) next[forced] = 2;

  // ---------------------------------------------------------------------------------------
  // The storm.
  const storm = { active: false, t: 0, flash: 0, flood: 0, rain: 0, nextBolt: 0, thunder: [], branches: [] };
  const branchGroup = new THREE.Group();
  branchGroup.name = "Storm branches";
  scene.add(branchGroup);
  for (let k = 0; k < 6; k++) {
    // A torn-off branch: a stem with a few side twigs.
    const length = range(7, 13);
    const tubes = [];
    const pts = [];
    for (let i = 0; i <= 4; i++) pts.push(new THREE.Vector3((i / 4 - 0.5) * length, Math.sin(i * 1.3 + k) * 0.35, Math.cos(i * 1.7 + k) * 0.35));
    tubes.push(trunkGeometry(pts, range(0.28, 0.4), 0.12, 91 + k));
    for (let j = 0; j < 3; j++) {
      const base = pts[1 + j].clone();
      const dir = new THREE.Vector3(range(-0.3, 0.6), range(-0.5, 0.8), j % 2 ? 1 : -1).normalize();
      const tip = base.clone().addScaledVector(dir, range(2, 4));
      tubes.push(trunkGeometry([base, base.clone().lerp(tip, 0.5), tip], range(0.08, 0.14), 0.03, 7 * k + j));
    }
    const mesh = new THREE.Mesh(mergeTubes(tubes), rocks.wood);
    mesh.rotation.order = "YXZ";
    mesh.castShadow = true;
    mesh.visible = false;
    branchGroup.add(mesh);
    storm.branches.push({ mesh, length, alive: false, river: { s: 0, u: 0 }, spin: 0, roll: 0, turn: 0, tumble: 0, hitAt: -1e9 });
  }
  function dropBranch(b, fish, anywhere) {
    const s = fish.river.s - range(anywhere ? -10 : 30, 60);
    const c = section(s);
    const u = c.thalweg + range(-0.6, 0.6) * c.half;
    const lv = level(s);
    if (lv - bed(s, u) < 2) return;
    place(s, u, at);
    b.mesh.position.set(at.x, lv - range(0.3, Math.min(3, (lv - bed(s, u)) * 0.5)), at.z);
    b.river.s = s;
    b.river.u = u;
    b.spin = range(0, TAU);
    b.roll = range(0, TAU);
    b.turn = range(-0.5, 0.5);
    b.tumble = range(-0.8, 0.8);
    b.alive = true;
    b.mesh.visible = true;
  }
  function stormUpdate(dt, fish, time) {
    const s = storm;
    s.t += dt;
    const { length, floodFrom, floodFull, recede } = STORM;
    s.rain = smooth(0, 20, s.t) * (1 - smooth(length - 25, length, s.t));
    daylight.setRain(Math.max(s.rain, 0));
    s.flood = smooth(floodFrom, floodFull, s.t) * (1 - smooth(length, length + recede, s.t));
    // Lightning, the thunder after it: the nearer, the sooner and the harder.
    const stormy = smooth(15, 30, s.t) * (1 - smooth(length - 30, length - 5, s.t));
    if (stormy > 0 && time > s.nextBolt) {
      s.nextBolt = time + range(4, 13) / (0.5 + stormy);
      const near = random();
      s.flash = 0.6 + 0.4 * near;
      s.flicker = time + range(0.08, 0.16);
      s.thunder.push({ at: time + 0.3 + (1 - near) * 3.5, near });
      happened.push({ type: "lightning", near });
    }
    if (s.flicker && time > s.flicker) {
      s.flash = Math.max(s.flash, 0.5);
      s.flicker = 0;
    }
    s.flash *= Math.exp(-dt * 11);
    for (let i = s.thunder.length - 1; i >= 0; i--)
      if (time > s.thunder[i].at) {
        sound.thunder(s.thunder[i].near);
        s.thunder.splice(i, 1);
      }
    // Branches coming down on the flood.
    for (const b of s.branches) {
      if (!b.alive) {
        if (s.flood > 0.35 && random() < dt * 0.35) dropBranch(b, fish, false);
        continue;
      }
      const p = b.mesh.position;
      locate(p.x, p.z, b.river.s, b.river);
      current(b.river.s, b.river.u, p.y, flow, time);
      p.x += flow.vx * dt;
      p.z += flow.vz * dt;
      const lv = level(b.river.s);
      p.y = Math.min(p.y + Math.sin(time * 0.7 + b.roll) * 0.2 * dt, lv - 0.25);
      b.spin += b.turn * dt;
      b.roll += b.tumble * dt;
      b.mesh.rotation.set(b.roll, b.spin, 0.2 * Math.sin(b.roll));
      if (b.river.s > fish.river.s + 45 || b.river.s < fish.river.s - 90 || s.flood < 0.1) {
        b.alive = false;
        b.mesh.visible = false;
        continue;
      }
      // Knocking into the fish: along the stem, how close does it come?
      if (fish.captive || fish.airborne || time - b.hitAt < 2) continue;
      tmp.set(Math.cos(b.spin), 0, -Math.sin(b.spin));
      tmp2.subVectors(fish.position, p);
      const along = clamp(tmp2.dot(tmp), -b.length / 2, b.length / 2);
      tmp2.addScaledVector(tmp, -along);
      if (tmp2.length() < 0.6 + fish.length * 0.25) {
        b.hitAt = time;
        const speed = Math.hypot(flow.vx, flow.vz);
        fish.energy = Math.max(0, fish.energy - 0.05 - 0.01 * speed);
        fish.relative.x += flow.vx * 0.8;
        fish.relative.z += flow.vz * 0.8;
        happened.push({ type: "branch" });
      }
    }
    if (s.t > length + recede) {
      s.active = false;
      s.flood = 0;
      s.flash = 0;
      daylight.setRain(null);
      for (const b of s.branches) {
        b.alive = false;
        b.mesh.visible = false;
      }
      happened.push({ type: "stormOver" });
      next.storm = clock + range(540, 900);
    }
  }

  // ---------------------------------------------------------------------------------------
  // The angler.
  const figure = new THREE.Group();
  figure.name = "Angler";
  figure.visible = false;
  {
    const mat = (r, g, b, rough = 0.85) => new THREE.MeshStandardMaterial({ color: new THREE.Color(r, g, b), roughness: rough });
    const waders = mat(0.12, 0.14, 0.1);
    const jacket = mat(0.22, 0.26, 0.16);
    const skin = mat(0.62, 0.46, 0.36);
    const hat = mat(0.3, 0.26, 0.18);
    const part = (geometry, material, x, y, z) => {
      const m = new THREE.Mesh(geometry, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      figure.add(m);
      return m;
    };
    part(new THREE.CylinderGeometry(0.75, 0.65, 8.5, 8), waders, 0, 4.25, 1);
    part(new THREE.CylinderGeometry(0.75, 0.65, 8.5, 8), waders, 0, 4.25, -1);
    part(new THREE.BoxGeometry(3, 6.5, 4.4), jacket, 0, 11.4, 0);
    part(new THREE.SphereGeometry(1.2, 12, 10), skin, 0.2, 15.6, 0);
    part(new THREE.CylinderGeometry(1.5, 1.6, 0.3, 14), hat, 0.2, 16.5, 0);
    part(new THREE.CylinderGeometry(1.0, 1.15, 1.1, 12), hat, 0.2, 17.1, 0);
    // The casting arm and the rod, which turn together about the shoulder.
    const arm = new THREE.Group();
    arm.position.set(0.6, 13.6, -1.8);
    figure.add(arm);
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1, 1), jacket);
    forearm.position.set(2, 0, 0);
    arm.add(forearm);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 27, 6).translate(0, 13.5, 0).rotateZ(-Math.PI / 2), mat(0.15, 0.1, 0.08, 0.4));
    rod.position.set(4, 0, 0);
    arm.add(rod);
    figure.userData.arm = arm;
    figure.userData.tip = new THREE.Object3D();
    figure.userData.tip.position.set(31, 0, 0);
    arm.add(figure.userData.tip);
  }
  scene.add(figure);
  const lineGeometry = new THREE.BufferGeometry();
  const LINE_POINTS = 16;
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(LINE_POINTS * 3), 3));
  const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: 0xe6e0c8, transparent: true, opacity: 0.8 }));
  line.frustumCulled = false;
  line.visible = false;
  line.name = "Fishing line";
  scene.add(line);
  // The last of it, the leader, just under the surface from the fly: what a fish sees.
  const leaderGeometry = new THREE.BufferGeometry();
  leaderGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
  const leader = new THREE.Line(leaderGeometry, new THREE.LineBasicMaterial({ color: 0xf4f0e0, transparent: true, opacity: 0.95 }));
  leader.frustumCulled = false;
  leader.visible = false;
  leader.name = "Leader";
  scene.add(leader);
  function setLeader(fly, toward, lv) {
    const p = leaderGeometry.attributes.position;
    tmp.subVectors(toward, fly).setY(0);
    const d = tmp.length() || 1;
    tmp.multiplyScalar(1 / d);
    for (let i = 0; i < 6; i++) {
      const t = (i / 5) * Math.min(6, d);
      p.setXYZ(i, fly.x + tmp.x * t, lv - 0.05 - 0.04 * Math.sin((i / 5) * Math.PI), fly.z + tmp.z * t);
    }
    p.needsUpdate = true;
    leader.visible = true;
  }
  const angler = { active: false, t: 0, s: 0, u: 0, side: 1, bank: new THREE.Vector3(), cast: 0, lure: null, fly: { s: 0, u: 0 }, from: { s: 0, u: 0 }, to: { s: 0, u: 0 }, hooked: false, hookT: 0, struggle: 0, lineLength: 0, reelClock: 0, leaving: 0 };
  const tip = new THREE.Vector3();
  function startAngler(fish) {
    frame(fish.river.s, at);
    const ahead = Math.sign(fish.heading.x * at.tx + fish.heading.z * at.tz) || -1;
    for (let tries = 0; tries < 12; tries++) {
      const s = fish.river.s + ahead * range(16, 34);
      const c = section(s);
      const side = random() < 0.5 ? -1 : 1;
      for (let out = 3; out < 16; out += 2) {
        const u = c.thalweg + side * (c.half + out);
        const ground = bed(s, u);
        if (ground < level(s) + 0.3) continue;
        place(s, u, at);
        figure.position.set(at.x, ground, at.z);
        // Facing the river, across it.
        place(s, c.thalweg, tmp);
        figure.rotation.set(0, Math.atan2(-(tmp.z - at.z), tmp.x - at.x), 0);
        figure.visible = true;
        Object.assign(angler, { active: true, t: 0, s, u, side, cast: 0, lure: null, hooked: false, struggle: 0, leaving: 0 });
        // Where he stands at the water's edge: where a fish on the line is drawn to.
        place(s, c.thalweg + side * c.half * 0.98, at);
        angler.bank.set(at.x, level(s), at.z);
        happened.push({ type: "angler" });
        return true;
      }
    }
    return false;
  }
  function endAngler() {
    angler.active = false;
    angler.hooked = false;
    figure.visible = false;
    line.visible = false;
    leader.visible = false;
    if (angler.lure) {
      angler.lure.alive = false;
      angler.lure = null;
    }
    next.angler = clock + range(360, 720);
  }
  function setLine(from, to, sag) {
    const p = lineGeometry.attributes.position;
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / (LINE_POINTS - 1);
      tmp.lerpVectors(from, to, t);
      tmp.y -= Math.sin(Math.PI * t) * sag;
      p.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    p.needsUpdate = true;
    line.visible = true;
  }
  function anglerUpdate(dt, fish, time) {
    const a = angler;
    a.t += dt;
    figure.updateMatrixWorld(true);
    const arm = figure.userData.arm;
    const c = section(a.s);
    const lv = level(a.s);
    if (a.hooked) {
      // On the hook: the rod bent up high, the line tight to the fish's mouth, reeling in.
      arm.rotation.set(0, 0, 1.05 + Math.sin(time * 9) * 0.04);
      figure.userData.tip.getWorldPosition(tip);
      a.hookT += dt;
      a.lineLength = Math.max(2, a.lineLength - (1.1 + 0.12 * fish.length) * dt);
      tmp.subVectors(fish.position, tip);
      const d = tmp.length();
      if (d > a.lineLength) fish.position.addScaledVector(tmp, (a.lineLength - d) / d);
      tmp.subVectors(a.bank, fish.position).setY(0).normalize();
      fish.relative.addScaledVector(tmp, 2.5 * dt);
      fish.energy = Math.max(0, fish.energy - 0.03 * dt);
      for (const e of fish.events)
        if (e.type === "lunge") {
          // A head-shake or a run away from him works the hook loose; towards him, nothing.
          const away = -(fish.heading.x * tmp.x + fish.heading.z * tmp.z);
          if (away > -0.2) a.struggle += 0.14 + 0.1 * random() + 0.06 * away;
        }
      a.reelClock -= dt;
      if (a.reelClock <= 0) {
        a.reelClock = 0.3;
        sound.reel();
      }
      setLine(tip, fish.mouth, 0.05);
      leader.visible = false;
      const landed = Math.hypot(fish.position.x - a.bank.x, fish.position.z - a.bank.z) < 4 + fish.length * 0.5 || a.hookT > 20 || fish.energy <= 0.01;
      if (a.struggle >= 1) {
        a.hooked = false;
        a.leaving = 8;
        sound.snap();
        happened.push({ type: "unhooked" });
        fish.relative.addScaledVector(tmp, -3 - fish.length * 0.3);
      } else if (landed) {
        a.hooked = false;
        happened.push({ type: "landed" });
        endAngler();
      }
      return;
    }
    if (a.leaving > 0) {
      a.leaving -= dt;
      line.visible = false;
      leader.visible = false;
      if (a.leaving <= 0) endAngler();
      return;
    }
    // Casting: the rod back, then forward; the fly lands out across the current and swings
    // round below him on the tight line, and he lifts it and casts again.
    const period = 11;
    const phase = (a.t % period) / period;
    const k = phase * period;
    figure.userData.tip.getWorldPosition(tip);
    if (k < 1.2) {
      arm.rotation.set(0, 0, k < 0.6 ? 0.5 + k * 2.5 : 2.0 - (k - 0.6) * 2.67);
      if (a.lure) {
        a.lure.alive = false;
        a.lure = null;
      }
      line.visible = false;
      leader.visible = false;
      a.cast = Math.floor(a.t / period);
      frame(a.s, at);
      a.from.s = a.s + range(6, 12);
      a.from.u = c.thalweg - a.side * c.half * range(0.2, 0.55);
      a.to.s = a.from.s + range(10, 16);
      a.to.u = c.thalweg + a.side * c.half * range(0.45, 0.7);
      return;
    }
    arm.rotation.set(0, 0, 0.42 + Math.sin(time * 1.3) * 0.03);
    const swing = smooth(1.2, period - 1.3, k);
    // Across and down, as a swinging fly goes: round an arc below the rod.
    a.fly.s = a.from.s + (a.to.s - a.from.s) * Math.sin((swing * Math.PI) / 2);
    a.fly.u = a.from.u + (a.to.u - a.from.u) * (1 - Math.cos((swing * Math.PI) / 2));
    place(a.fly.s, a.fly.u, at);
    const flyLevel = level(a.fly.s);
    if (k > period - 0.8) {
      // Lifted off.
      if (a.lure) {
        a.lure.alive = false;
        a.lure = null;
      }
      line.visible = false;
      leader.visible = false;
      return;
    }
    if (a.lure && a.lure.type === "lure" && a.lure.eatenAt >= 0) {
      // Taken!
      a.hooked = true;
      a.hookT = 0;
      a.struggle = 0;
      a.lineLength = fish.position.distanceTo(tip) + 1;
      a.lure = null;
      happened.push({ type: "hooked" });
      return;
    }
    if (!a.lure || !a.lure.alive || !a.lure.held || a.lure.type !== "lure") {
      a.lure = life.food.toss("lure", at.x, at.z, fish) || null;
      if (a.lure) a.lure.held = true;
    }
    if (a.lure) {
      a.lure.position.set(at.x, flyLevel - 0.03, at.z);
      locate(at.x, at.z, a.fly.s, a.lure.river);
      // The line: from the rod tip down to the water, and the last of it just under the
      // surface to the fly -- the tell.
      tmp2.set(at.x, flyLevel - 0.03, at.z);
      setLine(tip, tmp2, 1.5);
      setLeader(tmp2, tip, flyLevel);
    } else leader.visible = false;
    if (a.t > 160 || Math.abs(fish.river.s - a.s) > 160) endAngler();
  }

  // ---------------------------------------------------------------------------------------
  // The otter family.
  const otterMesh = createFishMesh(scene, "otter", "otter", 4, { name: "Otter family", cacheKey: "otter-family", detail: 0.8 });
  otterMesh.begin();
  otterMesh.finish();
  const otters = { active: false, t: 0, centre: new THREE.Vector3(), river: { s: 0, u: 0 }, wander: new THREE.Vector3(), chirp: 0, members: [] };
  for (let i = 0; i < 4; i++)
    otters.members.push({ slot: i, size: i === 0 ? 10.5 : range(5.2, 6.8), position: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0), speed: 0, phase: range(0, TAU), orbit: range(0, TAU), radius: range(3, 8), rate: range(0.5, 1.1) * (random() < 0.5 ? -1 : 1), dive: range(0, TAU), under: false });
  const oMatrix = new THREE.Matrix4(),
    oQuat = new THREE.Quaternion(),
    oScale = new THREE.Vector3(),
    oBasis = new THREE.Matrix4(),
    axisY = new THREE.Vector3(),
    axisZ = new THREE.Vector3(),
    want = new THREE.Vector3();
  function startOtters(fish) {
    frame(fish.river.s, at);
    const ahead = Math.sign(fish.heading.x * at.tx + fish.heading.z * at.tz) || -1;
    for (let tries = 0; tries < 10; tries++) {
      const s = fish.river.s + ahead * range(14, 30);
      const c = section(s);
      const u = c.thalweg + range(-0.4, 0.4) * c.half;
      const lv = level(s);
      if (lv - bed(s, u) < 4) continue;
      place(s, u, at);
      otters.centre.set(at.x, lv - 1.5, at.z);
      otters.river.s = s;
      otters.river.u = u;
      otters.active = true;
      otters.t = 0;
      for (const m of otters.members) {
        m.position.set(at.x + range(-6, 6), lv - range(0.5, 2), at.z + range(-6, 6));
        m.speed = 0;
      }
      happened.push({ type: "otters" });
      return true;
    }
    return false;
  }
  function ottersUpdate(dt, fish, time) {
    const o = otters;
    o.t += dt;
    const leaving = o.t > 80;
    // The family drifts about slowly; leaving, it makes off downstream along the bank.
    locate(o.centre.x, o.centre.z, o.river.s, o.river);
    const c = section(o.river.s);
    const lv = level(o.river.s);
    const floor = bed(o.river.s, o.river.u);
    frame(o.river.s, at);
    o.wander.x += (random() - 0.5) * dt;
    o.wander.z += (random() - 0.5) * dt;
    o.wander.clampLength(0, 1.2);
    if (leaving) o.wander.set(at.tx * 6, 0, at.tz * 6);
    o.centre.addScaledVector(o.wander, dt);
    // Keep in the water.
    if (Math.abs(o.river.u - c.thalweg) > c.half * 0.7) {
      place(o.river.s, c.thalweg, tmp);
      o.centre.x += (tmp.x - o.centre.x) * dt * 0.5;
      o.centre.z += (tmp.z - o.centre.z) * dt * 0.5;
    }
    otterMesh.begin();
    for (const m of o.members) {
      // Round and round the middle, rolling, the cubs after one another; up for air, and
      // down again in a curl.
      m.orbit += m.rate * dt * (m.slot ? 1.4 : 0.8);
      m.dive += dt * (0.6 + 0.15 * m.slot);
      const depth = Math.max(0, Math.sin(m.dive)) * Math.min(4, (lv - floor) * 0.6);
      want.set(o.centre.x + Math.cos(m.orbit) * m.radius, lv - m.size * 0.07 - depth, o.centre.z + Math.sin(m.orbit) * m.radius);
      if (m.slot > 1) want.lerp(o.members[m.slot - 1].position, 0.4);
      tmp.subVectors(want, m.position);
      const d = tmp.length();
      if (d > 1e-3) m.heading.lerp(tmp.multiplyScalar(1 / d), 1 - Math.exp(-dt * 4)).normalize();
      m.speed += (clamp(d * 1.6, 0, leaving ? 14 : 9) - m.speed) * (1 - Math.exp(-dt * 3));
      m.position.addScaledVector(m.heading, m.speed * dt);
      m.position.y = clamp(m.position.y, floor + 0.5, lv - m.size * 0.06);
      const under = depth > 0.8;
      if (m.under && !under && fish.position.distanceTo(m.position) < 40) happened.push({ type: "otterSplash", x: m.position.x, z: m.position.z });
      m.under = under;
      m.phase = (m.phase + dt * TAU * (0.8 + m.speed / m.size)) % TAU;
      axisZ.crossVectors(m.heading, UP);
      if (axisZ.lengthSq() < 1e-6) axisZ.set(0, 0, 1);
      axisZ.normalize();
      axisY.crossVectors(axisZ, m.heading).normalize();
      oBasis.makeBasis(m.heading, axisY, axisZ);
      oQuat.setFromRotationMatrix(oBasis);
      const k = m.size / MODEL_LENGTH;
      oMatrix.compose(m.position, oQuat, oScale.set(k, k, k));
      otterMesh.body.setMatrixAt(m.slot, oMatrix);
      otterMesh.membranes.setMatrixAt(m.slot, oMatrix);
      otterMesh.swim.setXYZW(m.slot, m.phase, 0.45, 0, 0.1);
      otterMesh.fin.setX(m.slot, m.phase);
      otterMesh.mouth.setX(m.slot, 0.15 + 0.15 * Math.sin(time * 3 + m.slot));
    }
    otterMesh.finish();
    // Loud: chirps and squeaks now and then, while the fish is near.
    o.chirp -= dt;
    if (o.chirp <= 0 && fish.position.distanceTo(o.centre) < 45) {
      o.chirp = range(0.8, 2.6);
      sound.otter();
    }
    // The hunting fish keep clear of them.
    for (const h of life.hunters.list ?? []) {
      if (h.mode === "away" || h.mode === "swallow" || h.spec.bird || h.kind === "otter") continue;
      if (h.position.distanceTo(o.centre) < 45 && h.mode !== "leave") {
        h.mode = "leave";
        h.until = time + 8;
        h.rest = Math.max(h.rest, 25);
      }
    }
    if ((leaving && o.t > 95) || Math.abs(fish.river.s - o.river.s) > 200) {
      o.active = false;
      otterMesh.begin();
      otterMesh.finish();
      next.otters = clock + range(300, 600);
    }
  }

  // ---------------------------------------------------------------------------------------
  // The ice going out: floes on the melt.
  const FLOES = 28;
  const floeShape = new THREE.Shape();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const r = 0.8 + 0.2 * Math.sin(i * 2.7) + 0.12 * Math.cos(i * 5.3);
    if (i === 0) floeShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else floeShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const floeGeometry = new THREE.ExtrudeGeometry(floeShape, { depth: 1, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.06, bevelSegments: 2 }).rotateX(-Math.PI / 2);
  const floeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.86, 0.9), roughness: 0.5 });
  floeMaterial.onBeforeCompile = (shader) => waterLitShader(shader);
  const floeMesh = new THREE.InstancedMesh(floeGeometry, floeMaterial, FLOES);
  floeMesh.name = "Ice floes";
  floeMesh.castShadow = true;
  floeMesh.receiveShadow = true;
  floeMesh.frustumCulled = false;
  floeMesh.count = 0;
  scene.add(floeMesh);
  const floes = Array.from({ length: FLOES }, () => ({ alive: false, river: { s: 0, u: 0 }, position: new THREE.Vector3(), sx: 1, sz: 1, thick: 1, yaw: 0, spin: 0 }));
  let floeCount = 0;
  const floeMatrix = new THREE.Matrix4();
  const floeQuat = new THREE.Quaternion();
  function dropFloe(f, fish, anywhere) {
    const s = fish.river.s - (anywhere ? range(-40, 100) : range(70, 110));
    const c = section(s);
    f.sx = range(2.5, 10);
    f.sz = f.sx * range(0.55, 1.1);
    const room = Math.max(0, c.half * 0.9 - f.sx);
    const u = c.thalweg + range(-1, 1) * room;
    place(s, u, at);
    f.position.set(at.x, 0, at.z);
    f.river.s = s;
    f.river.u = u;
    f.thick = range(0.7, 1.6);
    f.yaw = range(0, TAU);
    f.spin = range(-0.08, 0.08);
    f.alive = true;
  }
  function floesUpdate(dt, fish, time, amount) {
    const want = Math.round(FLOES * amount);
    let n = 0;
    for (let i = 0; i < FLOES; i++) {
      const f = floes[i];
      if (i >= want) {
        f.alive = false;
        continue;
      }
      if (!f.alive) dropFloe(f, fish, floeCount === 0);
      locate(f.position.x, f.position.z, f.river.s, f.river);
      current(f.river.s, f.river.u, level(f.river.s) - 0.3, flow, time);
      f.position.x += flow.vx * 0.9 * dt;
      f.position.z += flow.vz * 0.9 * dt;
      f.yaw += f.spin * dt;
      if (f.river.s > fish.river.s + 60 || f.river.s < fish.river.s - 130) dropFloe(f, fish, false);
      const lv = level(f.river.s);
      // Ice floats with a tenth of it above the water.
      f.position.y = lv - f.thick * 0.88;
      floeQuat.setFromAxisAngle(UP, f.yaw);
      floeMatrix.compose(f.position, floeQuat, tmp.set(f.sx, f.thick, f.sz));
      floeMesh.setMatrixAt(n++, floeMatrix);
      // Under it the fish cannot come up.
      const dx = fish.position.x - f.position.x,
        dz = fish.position.z - f.position.z;
      const cs = Math.cos(f.yaw),
        sn = Math.sin(f.yaw);
      const lx = (dx * cs - dz * sn) / (f.sx * 0.95),
        lz = (dx * sn + dz * cs) / (f.sz * 0.95);
      if (lx * lx + lz * lz < 1) {
        const ceiling = f.position.y - fish.length * 0.18;
        if (fish.position.y > ceiling && !fish.airborne) {
          fish.position.y = ceiling;
          if (fish.relative.y > 0) fish.relative.y = 0;
          happened.push({ type: "underFloe" });
        }
      }
    }
    floeMesh.count = n;
    floeMesh.instanceMatrix.needsUpdate = true;
    floeCount = n;
  }

  // ---------------------------------------------------------------------------------------
  let auroraShown = false;
  return {
    storm,
    angler,
    otters,
    get floes() {
      return floeCount;
    },
    aurora: 0,
    happened,
    get flood() {
      return storm.flood;
    },
    get flash() {
      return storm.flash;
    },
    get hooked() {
      return angler.hooked;
    },
    // A new life: whatever was going on is over.
    reset() {
      if (angler.active) endAngler();
      if (storm.active) {
        storm.t = STORM.length + STORM.recede;
      }
    },
    update(dt, { fish, time, dead }) {
      clock += dt;
      happened.length = 0;
      regionWeights(fish.river.s, weights);
      const river = weights.brook + weights.upper + weights.middle + weights.lower;
      const c = conditions;
      const L = fish.length;
      // Storms: in the warm half of the year, over the river.
      if (!storm.active && clock > next.storm && dead <= 0) {
        const season = c.summer + 0.6 * c.autumn + 0.4 * c.spring;
        if (forced === "storm" || (season > 0.5 && c.ice < 0.2 && river + weights.estuary > 0.5)) {
          Object.assign(storm, { active: true, t: 0, flash: 0, flood: 0, nextBolt: time + 12, thunder: [] });
          happened.push({ type: "storm" });
        } else next.storm = clock + range(60, 120);
      }
      if (storm.active) stormUpdate(dt, fish, time);
      // An angler: by day, from spring to autumn, on the river, for a fish that takes a fly.
      if (!angler.active && clock > next.angler && dead <= 0 && !storm.active) {
        const fits = forced === "angler" || (c.light > 0.55 && c.ice < 0.2 && c.winter < 0.5 && weights.upper + weights.middle + weights.lower > 0.6 && L > 0.7 && L < 9);
        if (!fits || !startAngler(fish)) next.angler = clock + range(60, 120);
      }
      if (angler.active) anglerUpdate(dt, fish, time);
      // Otters: anywhere on the river, any time but deep winter.
      if (!otters.active && clock > next.otters && dead <= 0) {
        const fits = forced === "otters" || (river + weights.estuary > 0.6 && c.ice < 0.5);
        if (!fits || !startOtters(fish)) next.otters = clock + range(90, 180);
      }
      if (otters.active) ottersUpdate(dt, fish, time);
      // The ice going out.
      const breakup = forced === "floes" ? 1 : c.breakup * clamp(river * 1.5, 0, 1);
      if (breakup > 0.05 || floeCount > 0) {
        const before = floeCount;
        floesUpdate(dt, fish, time, breakup > 0.05 ? Math.pow(breakup, 0.7) : 0);
        if (before === 0 && floeCount > 0) happened.push({ type: "floes" });
      }
      // The northern lights: clear winter nights (and whenever asked for).
      const wave = 0.55 + 0.45 * Math.sin(clock / 37) * Math.sin(clock / 91 + 1);
      const aurora = forced === "aurora" ? 1 : smooth(0.35, 0.8, c.winter) * smooth(0.5, 0.9, c.night) * wave;
      this.aurora = aurora * (1 - 0.9 * (daylight.state.rain ?? 0));
      if (this.aurora > 0.35 && !auroraShown) {
        auroraShown = true;
        happened.push({ type: "aurora" });
      } else if (this.aurora < 0.05) auroraShown = false;
      return happened;
    },
  };
}
