import * as THREE from "three";
import { waterLitShader } from "../../riverscape/src/water.js";
import { S, level, place } from "./course.js";

// Set nets in the estuary. On the way home the grown salmon has to get past the fishermen's
// gill nets: walls of fine mesh hanging from a line of floats, out from the shore across
// part of the channel. A smolt slips through the mesh; a grown salmon swimming into one is
// caught by the gills and has to fight its way free (Space, again and again) before its
// strength runs out. The nets hang only so deep: under them, or round their ends, is open
// water.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// s along the river, from and to across it (u), how deep the net hangs.
export const NETS = [
  { s: 15260, u0: 175, u1: 35, depth: 13 },
  { s: 15470, u0: -200, u1: -45, depth: 12 },
  { s: 15690, u0: 290, u1: 70, depth: 14 },
  { s: 15900, u0: -430, u1: -110, depth: 13 },
];
// A fish shorter than this slips through the mesh.
const MESH_PASSES = 2;

function meshTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, size, size);
  g.strokeStyle = "#fff";
  g.lineWidth = 3;
  // Diamond mesh, as a gill net hangs.
  g.beginPath();
  g.moveTo(0, size / 2);
  g.lineTo(size / 2, 0);
  g.lineTo(size, size / 2);
  g.lineTo(size / 2, size);
  g.closePath();
  g.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

export function createNets(scene) {
  const alpha = meshTexture();
  const group = new THREE.Group();
  group.name = "Nets";
  const floatGeometry = new THREE.SphereGeometry(0.35, 10, 8).scale(1, 0.7, 1);
  const floatMaterial = new THREE.MeshStandardMaterial({ color: 0xe8702a, roughness: 0.5 });
  floatMaterial.onBeforeCompile = (shader) => waterLitShader(shader);
  const nets = NETS.map((n) => {
    const a = place(n.s, n.u0, {});
    const b = place(n.s, n.u1, {});
    const lv = level(Math.min(n.s, S.coast));
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const texture = alpha.clone();
    texture.needsUpdate = true;
    texture.repeat.set(length / 1.3, n.depth / 1.3);
    const material = new THREE.MeshStandardMaterial({ color: 0x3c4a44, roughness: 0.8, alphaMap: texture, alphaTest: 0.35, side: THREE.DoubleSide, transparent: false });
    material.onBeforeCompile = (shader) => waterLitShader(shader);
    material.customProgramCacheKey = () => "salmon-net-v1";
    // Hanging, with a little belly in the current.
    const geometry = new THREE.PlaneGeometry(length, n.depth, Math.ceil(length / 6), 6);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i);
      const along = x / length + 0.5;
      const down = 0.5 - y / n.depth;
      p.setZ(i, Math.sin(Math.PI * along) * down * 2.2);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((a.x + b.x) / 2, lv - n.depth / 2 - 0.05, (a.z + b.z) / 2);
    mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    mesh.name = "Gill net";
    group.add(mesh);
    // The float line.
    const floats = Math.floor(length / 5);
    const buoys = new THREE.InstancedMesh(floatGeometry, floatMaterial, floats);
    const m = new THREE.Matrix4();
    for (let k = 0; k < floats; k++) {
      const t = (k + 0.5) / floats;
      m.makeTranslation(a.x + (b.x - a.x) * t, lv - 0.05, a.z + (b.z - a.z) * t);
      buoys.setMatrixAt(k, m);
    }
    buoys.name = "Net floats";
    group.add(buoys);
    return { ...n, a, b, lv, length, mesh };
  });
  scene.add(group);

  const stuck = { active: false, net: null, t: 0, struggle: 0, at: new THREE.Vector3(), from: new THREE.Vector3(), torn: 0 };
  return {
    stuck,
    group,
    reset() {
      stuck.active = false;
    },
    // Returns "caught", "freed", "drowned" or null.
    update(dt, fish) {
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
        const belly = Math.sin(Math.PI * clamp(along / n.length + 0.5, 0, 1)) * clamp(depth / n.depth, 0, 1) * 2.2;
        if (Math.abs(across - belly) < 0.3 + fish.length * 0.12) {
          stuck.active = true;
          stuck.net = n;
          stuck.t = 0;
          stuck.struggle = 0;
          stuck.at.copy(fish.position);
          // Back out the way it came.
          stuck.from.set(s, 0, c).multiplyScalar(Math.sign(across - belly) || 1);
          return "caught";
        }
      }
      return null;
    },
  };
}
