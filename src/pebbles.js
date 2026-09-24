import * as THREE from "three";
import { rockGeometry } from "../../riverscape/src/environment.js";
import { waterLitShader } from "../../riverscape/src/water.js";
import { bedDetail, level, locate } from "./course.js";

// The gravel as a small fish sees it. To a salmon two centimetres long the pebbles of the
// redd are boulders, and a photograph laid on the bed cannot be looked at from that close.
// So round a small fish the gravel is real: stones laid on the bed, each its own shape,
// colour and size, with its film of algae on top and the fine grain of granite in it.
//
// It comes in two layers, so that it reaches far without costing much:
//   fine    the small stones, on a grid of cells sized to the fish, out to a few body
//           lengths -- beyond that they are too small to see
//   coarse  the bigger stones, on a grid three times coarser that reaches three times as far
// Each cell's stones are the same every time (they come from a hash of the cell). Every
// stone sinks into the bed and shrinks away toward the edge of its layer, smoothly as the
// fish moves (in the vertex shader), so the patch has no edge and no stone appears all at
// once; and cells are built nearest first, a few milliseconds a frame, well inside that
// fading edge. The gravel goes as the fish outgrows it.

const STONE_COLORS = [
  [0.26, 0.25, 0.23],
  [0.33, 0.32, 0.29],
  [0.38, 0.29, 0.24],
  [0.32, 0.23, 0.18],
  [0.11, 0.11, 0.1],
  [0.16, 0.16, 0.15],
  [0.48, 0.46, 0.41],
  [0.34, 0.25, 0.16],
  [0.24, 0.22, 0.18],
  [0.2, 0.19, 0.16],
];
const COARSE = 3; // coarse cells are this many fine cells across
const FINE_RADIUS = 11; // in fine cells
const COARSE_RADIUS = 11; // in coarse cells
const MAX_FINE = 4200; // stones per shape and layer
const MAX_COARSE = 2600;
const BUDGET_MS = 2.5;

function hash(i, j, k) {
  const h = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

// The fade toward the layer's edge, for the stone's colour pass and its shadow alike.
const FADE_GLSL = /* glsl */ `
  #ifdef USE_INSTANCING
  {
    // Toward the edge of the layer a stone sinks into the bed and shrinks away.
    vec3 centre = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float away = distance(centre.xz, pebbleFade.xy);
    float keep = 1.0 - smoothstep(pebbleFade.z, pebbleFade.w, away);
    transformed *= keep;
    transformed.y -= (1.0 - keep) * 0.8;
  }
  #endif
`;
function pebbleDepthMaterial(fade) {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pebbleFade = fade;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec4 pebbleFade;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${FADE_GLSL}`);
  };
  material.customProgramCacheKey = () => "salmon-pebbles-depth-v1";
  return material;
}

function pebbleMaterial(fade) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pebbleFade = fade;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStone; varying float vTop;\nuniform vec4 pebbleFade;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvStone = position * 3.0; vTop = normal.y;\n${FADE_GLSL}`);
    waterLitShader(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vStone;
        varying float vTop;
        float pebbleHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float pebbleNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(pebbleHash(i), pebbleHash(i + vec3(1, 0, 0)), f.x), mix(pebbleHash(i + vec3(0, 1, 0)), pebbleHash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(pebbleHash(i + vec3(0, 0, 1)), pebbleHash(i + vec3(1, 0, 1)), f.x), mix(pebbleHash(i + vec3(0, 1, 1)), pebbleHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        float gGrain = 0.0;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          // The grain of the stone: fine crystals of three colours, dark flecks of mica, and
          // a quartz vein now and then.
          float grain = pebbleNoise(vStone * 9.0) * 0.6 + pebbleNoise(vStone * 27.0) * 0.4;
          float crystals = step(0.74, pebbleNoise(vStone * 41.0 + 3.0));
          float dark = step(0.78, pebbleNoise(vStone * 53.0 + 11.0));
          vec3 c = diffuseColor.rgb * (0.78 + 0.34 * grain);
          c = mix(c, c * 1.4 + 0.03, crystals * 0.45);
          c = mix(c, c * 0.25, dark * 0.7);
          // Now and then a straight band of quartz right through a stone.
          float band = abs(dot(vStone, normalize(vec3(0.3, 1.0, 0.5))) - (pebbleHash(floor(vStone * 0.05 + 0.5)) - 0.5) * 2.0);
          float vein = (1.0 - smoothstep(0.02, 0.06, band)) * step(0.8, pebbleHash(floor(vStone * 0.05 + 0.5) + 3.0));
          c = mix(c, vec3(0.62, 0.6, 0.55), vein * 0.5);
          // A thin brown film of diatoms over everything, a little thicker on top; a fine
          // green fur of algae only in the brightest places.
          float patchy = pebbleNoise(vStone * 4.0) * 0.7 + pebbleNoise(vStone * 13.0) * 0.3;
          float top = smoothstep(0.0, 0.8, vTop + (patchy - 0.5) * 0.5);
          c = mix(c, c * vec3(0.66, 0.6, 0.42), 0.3 + top * 0.35);
          c = mix(c, c * vec3(0.55, 0.7, 0.35), smoothstep(0.66, 0.85, patchy) * top * 0.35);
          diffuseColor.rgb = c;
          gGrain = grain;
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = 0.28 + 0.3 * gGrain;`,
      );
  };
  material.customProgramCacheKey = () => "salmon-pebbles-v2";
  return material;
}

export function createPebbles(scene) {
  const fineFade = { value: new THREE.Vector4(0, 0, 1e5, 1e5) };
  const coarseFade = { value: new THREE.Vector4(0, 0, 1e5, 1e5) };
  const makeLayer = (name, detail, max, fade) => {
    const material = pebbleMaterial(fade);
    const depth = pebbleDepthMaterial(fade);
    const shapes = [rockGeometry(2.1, detail, 1), rockGeometry(5.7, detail, 0.7), rockGeometry(9.3, detail, 1)];
    return shapes.map((shape, i) => {
      const mesh = new THREE.InstancedMesh(shape, material, max);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depth;
      mesh.frustumCulled = false;
      mesh.name = `Gravel ${name} ${i}`;
      scene.add(mesh);
      return mesh;
    });
  };
  const fineMeshes = makeLayer("fine", 16, MAX_FINE, fineFade);
  const coarseMeshes = makeLayer("coarse", 12, MAX_COARSE, coarseFade);

  const fineCells = new Map();
  const coarseCells = new Map();
  const probe = { s: 0, u: 0 };
  const g = {};
  const object = new THREE.Object3D();
  const color = new THREE.Color();
  let cellSize = 0;
  let centreKey = "";
  let dirty = false;
  let complete = false;
  let waited = 0;
  let keep = 1;
  let active = false;

  // Lay `count` stones in the square at (x0, z0) of side `side`, with radii from `radius`,
  // keeping clear of the stones already in `others`. Returns the new stones.
  function lay(ix, iz, layer, x0, z0, side, count, radius, others, hintS) {
    const stones = [];
    for (let k = 0; k < count; k++) {
      const x = x0 + hash(ix, iz, k * 3 + 2 + layer) * side;
      const z = z0 + hash(ix, iz, k * 3 + 3 + layer) * side;
      const r = radius(hash(ix, iz, k * 3 + 4 + layer));
      let clash = false;
      for (const list of [stones, ...others])
        for (const other of list) {
          const reach = (r + other.collider.r) * 0.85;
          if ((x - other.collider.x) ** 2 + (z - other.collider.z) ** 2 < reach * reach) {
            clash = true;
            break;
          }
        }
      if (clash) continue;
      locate(x, z, hintS, probe);
      const y = bedDetail(probe.s, probe.u, null);
      const lv = level(probe.s);
      // Not out of the water, and not on a steep bank: the slope across the stone.
      if (y > lv - 0.05) continue;
      locate(x + r, z, probe.s, probe);
      const yx = bedDetail(probe.s, probe.u, null);
      locate(x, z + r, probe.s, probe);
      const yz = bedDetail(probe.s, probe.u, null);
      if (Math.max(Math.abs(yx - y), Math.abs(yz - y)) / Math.max(r, 1e-3) > 0.5) continue;
      const flat = 0.38 + 0.3 * hash(ix, iz, k + 80 + layer);
      object.position.set(x, Math.min(y, yx, yz) - r * flat * 0.3, z);
      object.rotation.set((hash(ix, iz, k + 40) - 0.5) * 0.5, hash(ix, iz, k + 50) * 6.28, (hash(ix, iz, k + 60) - 0.5) * 0.5);
      object.scale.set(r * (0.9 + 0.5 * hash(ix, iz, k + 70)), r * flat, r * (0.8 + 0.3 * hash(ix, iz, k + 90)));
      object.updateMatrix();
      stones.push({
        shape: Math.floor(hash(ix, iz, k + 110 + layer) * 3),
        matrix: object.matrix.clone(),
        color: STONE_COLORS[Math.floor(hash(ix, iz, k + 100 + layer) * STONE_COLORS.length)],
        fade: hash(ix, iz, k + 120 + layer),
        collider: { x, y: object.position.y, z, r: Math.max(object.scale.x, object.scale.z) * 0.95, ry: object.scale.y * 0.95 },
      });
    }
    return stones;
  }
  // How much gravel a cell's ground holds (0..1), from its middle.
  function gravelAt(x, z, hintS) {
    locate(x, z, hintS, probe);
    const y = bedDetail(probe.s, probe.u, g);
    if (level(probe.s) - y < 0.1) return 0;
    return g.gravel + g.rock * 0.4;
  }
  // The bigger stones of a coarse cell.
  function fillCoarse(cx, cz, hintS) {
    const side = cellSize * COARSE;
    const gravel = gravelAt((cx + 0.5) * side, (cz + 0.5) * side, hintS);
    if (gravel < 0.15) return [];
    const others = [];
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const near = (i || j) && coarseCells.get(`${cx + i}|${cz + j}`);
        if (near) others.push(near);
      }
    const count = Math.round(gravel * (6 + 10 * hash(cx, cz, 7)));
    return lay(cx, cz, 500, cx * side, cz * side, side, count, (h) => cellSize * (0.16 + 0.24 * h ** 1.6), others, hintS);
  }
  // The small stones of a fine cell, among the big ones.
  function fillFine(ix, iz, hintS) {
    const gravel = gravelAt((ix + 0.5) * cellSize, (iz + 0.5) * cellSize, hintS);
    if (gravel < 0.15) return [];
    const cx = Math.floor(ix / COARSE),
      cz = Math.floor(iz / COARSE);
    const others = [];
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const big = coarseCells.get(`${cx + i}|${cz + j}`);
        if (big) others.push(big);
      }
    const count = Math.round(8 + gravel * 12 * hash(ix, iz, 1));
    return lay(ix, iz, 0, ix * cellSize, iz * cellSize, cellSize, count, (h) => cellSize * (0.035 + 0.12 * h ** 2.2), others, hintS);
  }

  // Put the stones of the cells into a layer's instances.
  function upload(meshes, cells, max) {
    const counts = [0, 0, 0];
    for (const stones of cells.values())
      for (const stone of stones) {
        if (stone.fade > keep) continue;
        const slot = counts[stone.shape]++;
        if (slot >= max) continue;
        const mesh = meshes[stone.shape];
        mesh.setMatrixAt(slot, stone.matrix);
        mesh.setColorAt(slot, color.setRGB(...stone.color));
      }
    meshes.forEach((mesh, i) => {
      mesh.count = Math.min(max, counts[i]);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  // The cells wanted round (cx, cz) within `radius`, nearest first.
  const rings = new Map();
  function ring(radius) {
    if (!rings.has(radius)) {
      const list = [];
      for (let j = -radius; j <= radius; j++) for (let i = -radius; i <= radius; i++) if (i * i + j * j <= radius * radius) list.push([i, j, i * i + j * j]);
      list.sort((a, b) => a[2] - b[2]);
      rings.set(radius, list);
    }
    return rings.get(radius);
  }

  return {
    meshes: [...fineMeshes, ...coarseMeshes],
    // Stones within `reach` of a point, as colliders.
    near(position, reach, out) {
      if (!active || !cellSize) return out;
      for (const [cells, side] of [
        [fineCells, cellSize],
        [coarseCells, cellSize * COARSE],
      ]) {
        const cx = Math.floor(position.x / side),
          cz = Math.floor(position.z / side);
        const n = Math.ceil(reach / side);
        for (let j = -n; j <= n; j++)
          for (let i = -n; i <= n; i++) {
            const stones = cells.get(`${cx + i}|${cz + j}`);
            if (stones) for (const stone of stones) if (stone.fade <= keep) out.push(stone.collider);
          }
      }
      return out;
    },
    // Lay all the gravel at once (at the start, and after a jump to another place).
    prime(position, length, hintS) {
      this.update(position, length, hintS, Infinity);
    },
    // Lay the gravel round a fish of this length at this place, a little each frame.
    update(position, length, hintS, budget = BUDGET_MS) {
      active = length < 1.6;
      if (!active) {
        for (const mesh of [...fineMeshes, ...coarseMeshes]) mesh.count = 0;
        centreKey = "";
        return;
      }
      const size = Math.max(0.3, Math.min(1.4, 0.25 + length * 0.9));
      if (Math.abs(size - cellSize) > cellSize * 0.35) {
        fineCells.clear();
        coarseCells.clear();
        cellSize = size;
        dirty = true;
        complete = false;
        centreKey = "";
      }
      // Stones thin out as the fish outgrows them.
      const wantKeep = 1 - Math.max(0, (length - 0.9) / 0.7);
      if (Math.abs(wantKeep - keep) > 0.02) {
        keep = wantKeep;
        dirty = true;
      }
      const fineReach = FINE_RADIUS * cellSize,
        coarseReach = COARSE_RADIUS * COARSE * cellSize;
      fineFade.value.set(position.x, position.z, fineReach * 0.6, fineReach * 0.95);
      coarseFade.value.set(position.x, position.z, coarseReach * 0.6, coarseReach * 0.95);
      const fx = Math.floor(position.x / cellSize),
        fz = Math.floor(position.z / cellSize);
      const cx = Math.floor(fx / COARSE),
        cz = Math.floor(fz / COARSE);
      const key = `${fx}|${fz}`;
      if (key !== centreKey) {
        centreKey = key;
        complete = false;
        // Drop what has fallen behind the edge.
        for (const k of fineCells.keys()) {
          const [i, j] = k.split("|").map(Number);
          if ((i - fx) ** 2 + (j - fz) ** 2 > (FINE_RADIUS + 2) ** 2) {
            fineCells.delete(k);
            dirty = true;
          }
        }
        for (const k of coarseCells.keys()) {
          const [i, j] = k.split("|").map(Number);
          if ((i - cx) ** 2 + (j - cz) ** 2 > (COARSE_RADIUS + 2) ** 2) {
            coarseCells.delete(k);
            dirty = true;
          }
        }
      }
      // Build what is missing, nearest first, big stones before the small ones among them.
      const start = performance.now();
      let done = true;
      const coarseRing = ring(COARSE_RADIUS);
      const fineRing = ring(FINE_RADIUS);
      let a = complete ? coarseRing.length : 0,
        b = complete ? fineRing.length : 0;
      while (a < coarseRing.length || b < fineRing.length) {
        if (performance.now() - start > budget) {
          done = false;
          break;
        }
        // Alternate by distance: a coarse cell's reach counts three times a fine cell's.
        const nextCoarse = a < coarseRing.length ? coarseRing[a][2] * COARSE * COARSE : Infinity;
        const nextFine = b < fineRing.length ? fineRing[b][2] : Infinity;
        if (nextCoarse <= nextFine + 4) {
          const [i, j] = coarseRing[a++];
          const k = `${cx + i}|${cz + j}`;
          if (!coarseCells.has(k)) {
            coarseCells.set(k, fillCoarse(cx + i, cz + j, hintS));
            dirty = true;
          }
        } else {
          const [i, j] = fineRing[b++];
          const k = `${fx + i}|${fz + j}`;
          if (!fineCells.has(k)) {
            // The big stones round it first, so the small ones lie among them.
            const ccx = Math.floor((fx + i) / COARSE),
              ccz = Math.floor((fz + j) / COARSE);
            for (let q = -1; q <= 1; q++)
              for (let p = -1; p <= 1; p++) {
                const kk = `${ccx + p}|${ccz + q}`;
                if (!coarseCells.has(kk)) coarseCells.set(kk, fillCoarse(ccx + p, ccz + q, hintS));
              }
            fineCells.set(k, fillFine(fx + i, fz + j, hintS));
            dirty = true;
          }
        }
      }
      complete = done;
      // Upload when something changed and all is built (or every few frames while the far
      // cells are still coming in).
      waited++;
      if (dirty && (done || waited >= 6)) {
        upload(fineMeshes, fineCells, MAX_FINE);
        upload(coarseMeshes, coarseCells, MAX_COARSE);
        dirty = false;
        waited = 0;
      }
    },
  };
}
