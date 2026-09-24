import * as THREE from "three";
import { waterLitShader } from "../../riverscape/src/water.js";
import { S, bed, level, locate, place } from "./course.js";
import { MODEL_LENGTH, createFishMesh } from "./anatomy.js";
import { SolidBatch } from "./flora.js";
import { netPull, nettingMaterial } from "./netting.js";

// Set nets in the estuary. On the way home the grown salmon has to get past the fishermen's
// gill nets: walls of fine mesh hanging from a line of floats, out from the shore across
// part of the channel. A smolt slips through the mesh; a grown salmon swimming into one is
// caught by the gills and has to fight its way free (Space, again and again) before its
// strength runs out. The nets hang only so deep: under them, or round their ends, is open
// water.
//
// Each net as the fishermen set it: the mesh hung between a float line of cork floats and
// a lead line weighted every few strides; at each end a marker buoy with a flagged pole,
// moored to a grapnel on the bed. A few herring the tide brought in hang dead in the mesh.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const TAU = Math.PI * 2;
// s along the river, from and to across it (u), how deep the net hangs.
export const NETS = [
  { s: 15260, u0: 175, u1: 35, depth: 13 },
  { s: 15470, u0: -200, u1: -45, depth: 12 },
  { s: 15690, u0: 290, u1: 70, depth: 14 },
  { s: 15900, u0: -430, u1: -110, depth: 13 },
];
// A fish shorter than this slips through the mesh.
const MESH_PASSES = 2;
// The belly of a net in the current, at `along` (0..1) and `down` (0..1) of it.
const BELLY = 2.2;
const belly = (along, down) => Math.sin(Math.PI * clamp(along, 0, 1)) * clamp(down, 0, 1) * BELLY;
const FLOAT_EVERY = 4.5;
// The float line dips a little between floats.
const sag = (x) => -0.16 * Math.abs(Math.sin((Math.PI * x) / FLOAT_EVERY));

// Small random numbers, the same every time.
function seeded(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// A tube along points, into a batch.
function rope(batch, points, radius, color, sides = 5) {
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.TubeGeometry(curve, Math.max(2, points.length * 2), radius, sides, false);
  batch.add(tube, new THREE.Matrix4(), color);
  tube.dispose();
}

const FLOAT = new THREE.CylinderGeometry(1, 1, 1, 10, 1).rotateZ(Math.PI / 2);
const BALL = new THREE.SphereGeometry(1, 14, 10);
const POLE = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CAP = new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2);

export function createNets(scene) {
  const group = new THREE.Group();
  group.name = "Nets";
  const netMaterial = nettingMaterial({ color: new THREE.Color(0.34, 0.42, 0.37), mesh: 1.2, hang: 1.3, twine: 0.05, opacity: 0.9, fouling: 0.4, weed: 0.22, sway: 0.55, key: "gill" });
  const gearMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  gearMaterial.onBeforeCompile = (shader) => waterLitShader(shader);
  gearMaterial.customProgramCacheKey = () => "salmon-net-gear-v1";
  const gear = new SolidBatch();
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    v = new THREE.Vector3(),
    sc = new THREE.Vector3();
  const put = (geometry, x, y, z, sx, sy, sz, yaw, color, pitch = 0, roll = 0) => {
    e.set(pitch, yaw, roll, "YXZ");
    gear.add(geometry, m.compose(v.set(x, y, z), q.setFromEuler(e), sc.set(sx, sy, sz)), color);
  };
  const corkA = new THREE.Color(0.86, 0.33, 0.1),
    corkB = new THREE.Color(0.9, 0.86, 0.76),
    ropeColor = new THREE.Color(0.2, 0.2, 0.16),
    leadColor = new THREE.Color(0.2, 0.21, 0.22),
    pole = new THREE.Color(0.55, 0.5, 0.4),
    flagA = new THREE.Color(0.95, 0.35, 0.08),
    flagB = new THREE.Color(0.08, 0.08, 0.09),
    iron = new THREE.Color(0.28, 0.22, 0.18);
  const caught = [];

  const nets = NETS.map((n, index) => {
    const random = seeded(9173 + index * 311);
    const range = (lo, hi) => lo + (hi - lo) * random();
    const a = place(n.s, n.u0, {});
    const b = place(n.s, n.u1, {});
    const lv = level(Math.min(n.s, S.coast));
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / length,
      uz = (b.z - a.z) / length;
    // Across the net (its local +z), as the mesh is turned.
    const nx = -uz,
      nz = ux;
    const cx = (a.x + b.x) / 2,
      cz = (a.z + b.z) / 2;
    // A point of the net, in its own frame (x along from the middle, y up from the float
    // line, z across), to the world.
    const world = (x, y, z, out = new THREE.Vector3()) => out.set(cx + ux * x + nx * z, lv + y, cz + uz * x + nz * z);

    // The mesh: hung from the float line, bellied by the current, its uv in world units.
    const cols = Math.ceil(length / 2.5),
      rows = 10;
    const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
    const uvs = new Float32Array((cols + 1) * (rows + 1) * 2);
    const indices = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const k = j * (cols + 1) + i;
        const along = i / cols,
          down = j / rows;
        const x = (along - 0.5) * length;
        const top = sag(x);
        positions[k * 3] = x;
        positions[k * 3 + 1] = top - down * n.depth;
        positions[k * 3 + 2] = belly(along, down);
        uvs[k * 2] = along * length;
        uvs[k * 2 + 1] = down * n.depth - top;
        if (i < cols && j < rows) indices.push(k, k + cols + 1, k + 1, k + 1, k + cols + 1, k + cols + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.boundingSphere.radius += 3;
    const mesh = new THREE.Mesh(geometry, netMaterial);
    mesh.position.set(cx, lv - 0.05, cz);
    mesh.rotation.y = -Math.atan2(uz, ux);
    mesh.name = "Gill net";
    group.add(mesh);

    // The float line along the top, cork floats on it, orange and white by turns.
    const head = [];
    for (let x = -length / 2 - 1; x <= length / 2 + 1.01; x += 1.5) head.push(world(x, sag(x) - 0.03, 0));
    rope(gear, head, 0.07, ropeColor);
    const floats = Math.floor(length / FLOAT_EVERY);
    for (let k = 0; k <= floats; k++) {
      const x = -length / 2 + k * FLOAT_EVERY;
      world(x, -0.02, 0, v);
      const r = range(0.3, 0.36);
      put(BALL, v.x, v.y, v.z, 0.5, r, r, -Math.atan2(uz, ux), k % 4 === 0 ? corkB : corkA, 0, range(-0.1, 0.1));
    }
    // The lead line along the foot, a lead every couple of strides.
    const foot = [];
    for (let x = -length / 2; x <= length / 2 + 0.01; x += 2.5) foot.push(world(x, -n.depth, belly(x / length + 0.5, 1)));
    rope(gear, foot, 0.1, ropeColor);
    for (let x = -length / 2 + 1.2; x < length / 2; x += 2.4) {
      world(x, -n.depth, belly(x / length + 0.5, 1), v);
      put(FLOAT, v.x, v.y, v.z, 0.45, 0.16, 0.16, -Math.atan2(uz, ux), leadColor);
    }
    // At each end: made fast to a stake on the beach where the net runs out from the
    // shore; out in the water, a marker buoy, its pole and flag, moored to a grapnel.
    const bedAt = (p) => {
      const r = locate(p.x, p.z, n.s, {});
      return bed(r.s, r.u);
    };
    for (const end of [-1, 1]) {
      const x = end * (length / 2 + 4);
      const tie = world(end * (length / 2 + 1.5), 0, 0);
      const ground = bedAt(tie);
      if (ground > lv - 3) {
        const top = lv + 2.6;
        const foot = ground - 1.2;
        put(POLE, tie.x, (top + foot) / 2, tie.z, 0.16, top - foot, 0.16, 0, pole, range(-0.08, 0.08), range(-0.08, 0.08));
        const brace = world(end * (length / 2 + 3.2), 0, range(-0.6, 0.6));
        const bg = bedAt(brace);
        put(POLE, (tie.x + brace.x) / 2, (lv + 1.6 + bg) / 2, (tie.z + brace.z) / 2, 0.1, Math.hypot(lv + 1.6 - bg, 1.7) * 1.05, 0.1, -Math.atan2(uz, ux), pole, 0, end * Math.atan2(1.7, lv + 1.6 - bg));
        rope(gear, [world(end * (length / 2), sag(end * length / 2) - 0.03, 0), world(end * (length / 2 + 0.8), 0.4, 0), tie.clone().setY(lv + 1.2)], 0.07, ropeColor);
        continue;
      }
      const buoy = world(x, 0.3, range(-1, 1));
      put(BALL, buoy.x, buoy.y, buoy.z, 1.1, 1.0, 1.1, 0, flagA);
      put(POLE, buoy.x, buoy.y + 3.4, buoy.z, 0.08, 6.2, 0.08, 0, pole, range(-0.06, 0.06), range(-0.06, 0.06));
      const yaw = range(0, TAU);
      for (let f = 0; f < 2; f++) {
        const fx = buoy.x + Math.cos(yaw) * 0.55,
          fz = buoy.z - Math.sin(yaw) * 0.55;
        put(BOX, fx, buoy.y + 5.9 - f * 0.55, fz, 1.1, 0.55, 0.03, yaw, f ? flagB : flagA);
      }
      // The bridle from the net's end to the buoy, and the mooring down to the bed.
      rope(gear, [world(end * (length / 2 + 1), -0.05, 0), world(end * (length / 2 + 2.6), -0.25, 0), buoy.clone().setY(buoy.y - 0.8)], 0.06, ropeColor);
      // Out beyond the end if there is water there; if that is the bank, up- or downstream.
      let anchor = null;
      for (const [ox, oz] of [[end * range(10, 16), range(-4, 4)], [end * 4, 14], [end * 4, -14], [-end * 6, 10], [-end * 6, -10], [0, 0.5]]) {
        const out = world(x + ox, 0, oz);
        const onBed = locate(out.x, out.z, n.s, {});
        const floor = bed(onBed.s, onBed.u);
        if (floor < lv - 3 || oz === 0.5) {
          anchor = new THREE.Vector3(out.x, floor + 0.3, out.z);
          break;
        }
      }
      const mid = buoy.clone().lerp(anchor, 0.5);
      mid.y -= 1.5;
      rope(gear, [buoy.clone().setY(buoy.y - 0.9), mid, anchor], 0.06, ropeColor);
      put(POLE, anchor.x, anchor.y + 0.5, anchor.z, 0.12, 1.4, 0.12, 0, iron, range(-0.3, 0.3), range(-0.3, 0.3));
      for (let h = 0; h < 4; h++) {
        const ha = (h / 4) * TAU + yaw;
        put(CAP, anchor.x + Math.cos(ha) * 0.35, anchor.y - 0.1, anchor.z + Math.sin(ha) * 0.35, 0.35, 0.5, 0.1, -ha, iron, Math.PI / 2, 0);
      }
    }
    // Herring caught by the gills, hanging dead in the mesh, heads through it.
    for (let k = 0; k < 3; k++) {
      const along = range(0.15, 0.85),
        down = range(0.15, 0.8);
      const side = random() < 0.5 ? -1 : 1;
      const x = (along - 0.5) * length;
      caught.push({
        at: world(x, sag(x) - down * n.depth, belly(along, down)),
        heading: new THREE.Vector3(nx * side, range(-0.5, -0.2), nz * side).normalize(),
        size: range(2.2, 3),
        roll: range(-0.6, 0.6),
        phase: range(0, TAU),
      });
    }
    return { ...n, a, b, lv, length, mesh };
  });
  const gearGeometry = gear.geometry();
  gearGeometry.computeBoundingSphere();
  const gearMesh = new THREE.Mesh(gearGeometry, gearMaterial);
  gearMesh.name = "Net floats, lines and buoys";
  gearMesh.castShadow = true;
  gearMesh.receiveShadow = true;
  group.add(gearMesh);
  scene.add(group);

  const herring = createFishMesh(scene, "herring", "herring", caught.length, { name: "Netted herring", cacheKey: "netted-herring", detail: 0.5, castShadow: false });
  const matrix = new THREE.Matrix4(),
    basis = new THREE.Matrix4(),
    axisY = new THREE.Vector3(),
    axisZ = new THREE.Vector3(),
    tilt = new THREE.Quaternion(),
    scale = new THREE.Vector3(),
    UP = new THREE.Vector3(0, 1, 0),
    X = new THREE.Vector3(1, 0, 0);
  let time = 0;
  function drawCaught(visible) {
    herring.begin();
    if (visible)
      caught.forEach((c, i) => {
        axisZ.crossVectors(c.heading, UP).normalize();
        axisY.crossVectors(axisZ, c.heading).normalize();
        basis.makeBasis(c.heading, axisY, axisZ);
        q.setFromRotationMatrix(basis).multiply(tilt.setFromAxisAngle(X, c.roll + 0.15 * Math.sin(time * 0.6 + c.phase)));
        const k = c.size / MODEL_LENGTH;
        // Head through the mesh: the body back from it.
        v.copy(c.at).addScaledVector(c.heading, -c.size * 0.3);
        matrix.compose(v, q, scale.set(k, k, k));
        herring.body.setMatrixAt(i, matrix);
        herring.swim.setXYZW(i, 1.2 + 0.3 * Math.sin(time * 0.5 + c.phase), 0.06, 0, 0.05);
        herring.fin.setX(i, time * 0.5 + c.phase);
        herring.mouth.setX(i, 0.5);
      });
    herring.finish();
  }
  drawCaught(false);

  const stuck = { active: false, net: null, t: 0, struggle: 0, at: new THREE.Vector3(), from: new THREE.Vector3(), torn: 0 };
  let near = false;
  return {
    stuck,
    group,
    reset() {
      stuck.active = false;
      netPull.value.w = 0;
    },
    // Returns "caught", "freed", "drowned" or null.
    update(dt, fish) {
      time += dt;
      // Only the nets near the fish are drawn in any detail.
      const nowNear = fish.river.s > NETS[0].s - 600;
      if (nowNear || near) drawCaught(nowNear);
      near = nowNear;
      group.visible = fish.river.s > NETS[0].s - 1400;
      // The mesh pulled round the fish while it is held, shaken as it fights.
      const pull = netPull.value;
      if (stuck.active) {
        pull.x = fish.position.x;
        pull.y = fish.position.y;
        pull.z = fish.position.z;
        pull.w = 0.55 + 0.25 * Math.sin(time * 23) * Math.min(1, stuck.struggle * 3);
      } else pull.w = Math.max(0, pull.w - dt * 1.5);
      stuck.torn = Math.max(0, stuck.torn - dt);
      if (stuck.active) {
        stuck.t += dt;
        // Held by the gills: every burst tears a little more of the mesh.
        for (const e of fish.events) if (e.type === "lunge") stuck.struggle += 0.2 + Math.random() * 0.12;
        fish.energy = Math.max(0, fish.energy - 0.035 * dt);
        fish.position.lerp(stuck.at, 1 - Math.exp(-dt * 8));
        fish.relative.multiplyScalar(0.2);
        if (stuck.struggle >= 1) {
          stuck.active = false;
          stuck.torn = 6;
          fish.relative.copy(stuck.from).multiplyScalar(4 + fish.length * 0.4);
          return "freed";
        }
        if (stuck.t > 9 || fish.energy <= 0.02) {
          stuck.active = false;
          return "drowned";
        }
        return null;
      }
      if (stuck.torn > 0 || fish.length < MESH_PASSES || fish.captive || fish.airborne) return null;
      for (const n of nets) {
        // In the net's own frame: along it, across it, and how deep.
        const dx = fish.position.x - n.mesh.position.x,
          dz = fish.position.z - n.mesh.position.z;
        const c = Math.cos(n.mesh.rotation.y),
          s = Math.sin(n.mesh.rotation.y);
        const along = dx * c - dz * s;
        const across = dx * s + dz * c;
        if (Math.abs(along) > n.length / 2) continue;
        const depth = n.lv - fish.position.y;
        if (depth > n.depth + fish.length * 0.1) continue;
        const bulge = belly(along / n.length + 0.5, depth / n.depth);
        if (Math.abs(across - bulge) < 0.3 + fish.length * 0.12) {
          stuck.active = true;
          stuck.net = n;
          stuck.t = 0;
          stuck.struggle = 0;
          stuck.at.copy(fish.position);
          // Back out the way it came.
          stuck.from.set(s, 0, c).multiplyScalar(Math.sign(across - bulge) || 1);
          return "caught";
        }
      }
      return null;
    },
  };
}
