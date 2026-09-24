import * as THREE from "three";
import { FALLS, RAPIDS, TRIBUTARIES, bed, current, level, place, section, smooth } from "./course.js";
import { GRAVITY } from "./salmon.js";
import { createBubbleMaterial, createCurtainMaterial, createFoamCloudMaterial } from "./materials.js";

// White water: the curtain of each fall streaming off its lip in the arc the water's speed
// gives it, the plume of bubbles it drives down into the pool below and that boils back up
// to the surface, and the splashes of a fish breaking the surface.

const PLUME = 2600;
const SPRAY = 700;

export function createFalls(scene) {
  const curtainMaterial = createCurtainMaterial();
  const underMaterial = createCurtainMaterial({ under: true });
  const curtains = new Map();
  const at = {};
  const flow = {};

  // The curtain of a fall: a sheet from the lip across the width the water pours over,
  // falling along the arc of a thrown stream.
  function buildCurtain(f) {
    const up = f.head ? level(f.s + 0.5) + f.drop : level(f.s - 0.02);
    const down = level(f.s + 0.02);
    const drop = up - down + 0.5;
    const c = section(f.s);
    // Where across the lip the water actually runs.
    let from = Infinity,
      to = -Infinity;
    const span = f.head ? 3 + f.drop * 0.2 : c.half * 1.3;
    for (let u = -span; u <= span; u += 0.5) {
      const top = f.head ? up - 1 : bed(f.s - 0.3, u);
      if (f.head ? Math.abs(u) < 2.5 + Math.sin(u) * 0.5 : top < up - 0.4) {
        from = Math.min(from, u);
        to = Math.max(to, u);
      }
    }
    if (!Number.isFinite(from)) return null;
    current(f.s - 1, 0, up - 0.5, flow);
    const v0 = f.head ? 1.5 : Math.max(2, flow.speed);
    const fallTime = Math.sqrt((2 * drop) / GRAVITY);
    const rows = 14,
      cols = Math.max(2, Math.ceil((to - from) / 0.8));
    const positions = [],
      uvs = [],
      indices = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const tau = t * fallTime;
      const out = v0 * tau;
      const y = up - 0.5 * GRAVITY * tau * tau;
      for (let j = 0; j <= cols; j++) {
        const u = from + ((to - from) * j) / cols;
        // Ragged edges and a lip that is not a straight line.
        const lip = 0.25 * Math.sin(u * 0.9) + 0.15 * Math.sin(u * 2.3 + 1);
        place(f.s + lip + out + (f.head ? 0.6 : 0), u, at);
        positions.push(at.x, y, at.z);
        uvs.push(u, t);
        if (i < rows && j < cols) {
          const a = i * (cols + 1) + j;
          indices.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    // Each curtain its own copy of the material, for its own edges.
    const material = curtainMaterial.clone();
    material.uniforms.waterTime = curtainMaterial.uniforms.waterTime;
    material.uniforms.light = curtainMaterial.uniforms.light;
    material.uniforms.uFrom = { value: from };
    material.uniforms.uTo = { value: to };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Fall ${f.name}`;
    mesh.renderOrder = 2;
    scene.add(mesh);
    const impactS = f.s + v0 * fallTime + (f.head ? 0.6 : 0);
    // Under the surface the plunge goes on as a column of white water, leaning downstream.
    let under = null;
    if (!f.head) {
      const mid = (from + to) / 2;
      const poolDepth = down - bed(impactS + 1, mid);
      const plunge = Math.min(poolDepth - 0.3, 1.2 + drop * 0.4);
      if (plunge > 0.4) {
        const rowsU = 10;
        const pos = [],
          uv = [],
          idx = [];
        for (let i = 0; i <= rowsU; i++) {
          const t = i / rowsU;
          const y = down - 0.05 - t * plunge;
          for (let j = 0; j <= cols; j++) {
            const u = from + ((to - from) * j) / cols;
            const lip = 0.25 * Math.sin(u * 0.9) + 0.15 * Math.sin(u * 2.3 + 1);
            place(impactS + lip + t * plunge * 0.35, u, at);
            pos.push(at.x, y, at.z);
            uv.push(u, t);
            if (i < rowsU && j < cols) {
              const a = i * (cols + 1) + j;
              idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
            }
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const m = underMaterial.clone();
        m.uniforms.waterTime = underMaterial.uniforms.waterTime;
        m.uniforms.light = underMaterial.uniforms.light;
        m.uniforms.uFrom = { value: from };
        m.uniforms.uTo = { value: to };
        under = new THREE.Mesh(g, m);
        under.name = `Plunge ${f.name}`;
        under.renderOrder = 2;
        scene.add(under);
      }
    }
    // Where along the lip the water pours thickest: a few jets, the same every time.
    const jets = jetsAlong(f.s, from, to);
    // A point where the water comes down: `across` along the lip, `along` out from it.
    function pick(spot, across = from + Math.random() * (to - from), along = (Math.random() - 0.3) * 1.5) {
      place(impactS + along, across, at);
      spot.x = at.x;
      spot.z = at.z;
      spot.tx = at.tx;
      spot.tz = at.tz;
      spot.nx = at.nx;
      spot.nz = at.nz;
      spot.floor = bed(f.s + 2, across);
      return spot;
    }
    return { mesh, under, fall: f, impact: { s: impactS, from, to, y: down }, drop, jets, pick };
  }
  function jetsAlong(seed, from, to) {
    const jets = [];
    const count = Math.max(1, Math.round((to - from) / 5));
    for (let k = 0; k < count; k++) {
      const h = Math.sin((seed + k * 17.3) * 12.9898) * 43758.5453;
      jets.push(from + ((k + 0.2 + 0.6 * (h - Math.floor(h))) / count) * (to - from));
    }
    return jets;
  }

  // The fall at the head of a side brook: the brook comes over a step of rock and drops
  // into the end of its channel, toward the river. Its lip runs along the river (in s); the
  // water falls away from the step, back down the brook.
  function buildSideFall(b) {
    const bank = section(b.s).half;
    const lipU = b.side * (bank - 1.5 + b.length * 1.0);
    const middle = b.s + b.drift + 2.2 * Math.sin(5.2 + 0.7);
    const w = b.width * 0.65 * 0.62;
    const from = middle - w,
      to = middle + w;
    const down = level(middle);
    const up = down + b.drop;
    const drop = b.drop + 0.4;
    const v0 = 1.6;
    const fallTime = Math.sqrt((2 * drop) / GRAVITY);
    const rows = 12,
      cols = Math.max(2, Math.ceil((to - from) / 0.5));
    const positions = [],
      uvs = [],
      indices = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const tau = t * fallTime;
      const out = v0 * tau + 0.3;
      const y = up - 0.5 * GRAVITY * tau * tau;
      for (let j = 0; j <= cols; j++) {
        const s = from + ((to - from) * j) / cols;
        const lip = 0.2 * Math.sin(s * 1.3) + 0.1 * Math.sin(s * 3.1 + 1);
        place(s, lipU - b.side * (out + lip), at);
        positions.push(at.x, y, at.z);
        uvs.push(s, t);
        if (i < rows && j < cols) {
          const a = i * (cols + 1) + j;
          indices.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = curtainMaterial.clone();
    material.uniforms.waterTime = curtainMaterial.uniforms.waterTime;
    material.uniforms.light = curtainMaterial.uniforms.light;
    material.uniforms.uFrom = { value: from };
    material.uniforms.uTo = { value: to };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Fall ${b.name}`;
    mesh.renderOrder = 2;
    scene.add(mesh);
    const impactU = lipU - b.side * (v0 * fallTime + 0.3);
    const fall = { s: middle, drop: b.drop, name: b.name, side: true };
    function pick(spot, across = from + Math.random() * (to - from), along = (Math.random() - 0.3) * 1.2) {
      const u = impactU - b.side * along;
      place(across, u, at);
      spot.x = at.x;
      spot.z = at.z;
      // The plunge is carried down the brook, toward the river.
      spot.tx = -b.side * at.nx;
      spot.tz = -b.side * at.nz;
      spot.nx = at.tx;
      spot.nz = at.tz;
      spot.floor = bed(across, u - b.side * 1.5);
      return spot;
    }
    return { mesh, under: null, fall, impact: { s: middle, from, to, y: down }, drop, jets: jetsAlong(b.s, from, to), pick };
  }
  const SIDE_FALLS = TRIBUTARIES.map((b) => ({ ...b, sideFall: true }));

  // ---- Bubbles: one plume, at the fall nearest the camera.
  const plumeGeometry = new THREE.BufferGeometry();
  const plumePositions = new Float32Array(PLUME * 3);
  const plumeSizes = new Float32Array(PLUME);
  const plumeAlpha = new Float32Array(PLUME);
  plumeGeometry.setAttribute("position", new THREE.BufferAttribute(plumePositions, 3));
  plumeGeometry.setAttribute("size", new THREE.BufferAttribute(plumeSizes, 1));
  plumeGeometry.setAttribute("alpha", new THREE.BufferAttribute(plumeAlpha, 1));
  const bubbleMaterial = createBubbleMaterial();
  const plume = new THREE.Points(plumeGeometry, bubbleMaterial);
  plume.frustumCulled = false;
  plume.name = "Plume";
  scene.add(plume);
  const particles = Array.from({ length: PLUME }, () => ({ x: 0, y: -1e5, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 1, size: 0.1, active: false }));

  // ---- Spray and splash: droplets in the air, bubbles in the water.
  const sprayGeometry = new THREE.BufferGeometry();
  const sprayPositions = new Float32Array(SPRAY * 3);
  const spraySizes = new Float32Array(SPRAY);
  const sprayAlpha = new Float32Array(SPRAY);
  sprayGeometry.setAttribute("position", new THREE.BufferAttribute(sprayPositions, 3));
  sprayGeometry.setAttribute("size", new THREE.BufferAttribute(spraySizes, 1));
  sprayGeometry.setAttribute("alpha", new THREE.BufferAttribute(sprayAlpha, 1));
  const spray = new THREE.Points(sprayGeometry, bubbleMaterial);
  spray.frustumCulled = false;
  spray.name = "Spray";
  scene.add(spray);
  const drops = Array.from({ length: SPRAY }, () => ({ x: 0, y: -1e5, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 1, size: 0.1, water: 0, surface: 0 }));
  let nextDrop = 0;

  // ---- The white cloud under a fall: air beaten into the pool, a churning mass of it.
  const CLOUDS = 280;
  const cloudGeometry = new THREE.BufferGeometry();
  const cloudPositions = new Float32Array(CLOUDS * 3);
  const cloudSizes = new Float32Array(CLOUDS);
  const cloudAlpha = new Float32Array(CLOUDS);
  const cloudSeeds = new Float32Array(CLOUDS).map(() => Math.random());
  cloudGeometry.setAttribute("position", new THREE.BufferAttribute(cloudPositions, 3));
  cloudGeometry.setAttribute("size", new THREE.BufferAttribute(cloudSizes, 1));
  cloudGeometry.setAttribute("alpha", new THREE.BufferAttribute(cloudAlpha, 1));
  cloudGeometry.setAttribute("seed", new THREE.BufferAttribute(cloudSeeds, 1));
  const cloudMaterial = createFoamCloudMaterial();
  const cloud = new THREE.Points(cloudGeometry, cloudMaterial);
  cloud.frustumCulled = false;
  cloud.name = "Foam cloud";
  cloud.renderOrder = 3;
  scene.add(cloud);
  const puffs = Array.from({ length: CLOUDS }, () => ({ x: 0, y: -1e5, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 1, size: 1, seed: Math.random() }));

  let active = null;
  let clock = 0;

  function emit(p, c) {
    const f = c.fall;
    // At the spring, half of it wells up out of the gravel.
    if (f.head && Math.random() < 0.5) {
      const s = 8 + Math.random() * 10;
      const u = (Math.random() - 0.5) * 5;
      place(s, u, at);
      const floor = bed(s, u);
      p.x = at.x;
      p.z = at.z;
      p.y = floor + 0.05;
      p.vx = (Math.random() - 0.5) * 0.3;
      p.vz = (Math.random() - 0.5) * 0.3;
      p.vy = 0.8 + Math.random() * 1.2;
      p.age = 0;
      p.life = 2 + Math.random() * 3;
      p.size = 0.02 + Math.random() ** 3 * 0.1;
      p.active = true;
      p.floor = floor;
      return;
    }
    const spot = c.pick(pickSpot);
    p.x = spot.x;
    p.z = spot.z;
    p.y = c.impact.y - Math.random() * 0.8;
    const force = Math.min(1.5, 0.4 + c.drop / 12);
    p.vy = -(2 + Math.random() * 7) * force;
    const spread = (Math.random() - 0.5) * 2;
    p.vx = spread * spot.nx + Math.random() * 2 * spot.tx * force;
    p.vz = spread * spot.nz + Math.random() * 2 * spot.tz * force;
    p.age = 0;
    p.life = 1.5 + Math.random() * (2 + c.drop * 0.12);
    p.size = 0.025 + Math.random() ** 4 * (0.16 + c.drop * 0.006);
    p.active = true;
    p.floor = spot.floor;
  }
  const pickSpot = {};

  return {
    // Pixels per unit at unit distance, for point sizes.
    setScale(value) {
      bubbleMaterial.uniforms.scale.value = value;
      cloudMaterial.uniforms.scale.value = value;
    },
    light(value) {
      curtainMaterial.uniforms.light.value = value;
      underMaterial.uniforms.light.value = value;
      bubbleMaterial.uniforms.light.value = value;
      cloudMaterial.uniforms.light.value = value;
    },
    // A fish broke the surface: droplets up, bubbles down.
    splash(x, y, z, size) {
      const count = Math.min(90, Math.floor(18 + size * 10));
      for (let i = 0; i < count; i++) {
        const d = drops[nextDrop];
        nextDrop = (nextDrop + 1) % SPRAY;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * size * 0.3;
        const inWater = i % 2 === 0;
        d.x = x + Math.cos(a) * r;
        d.z = z + Math.sin(a) * r;
        d.y = y + (inWater ? -0.05 : 0.02);
        const speed = (0.5 + Math.random()) * (1.5 + size * 0.8);
        d.vx = Math.cos(a) * speed * 0.5;
        d.vz = Math.sin(a) * speed * 0.5;
        d.vy = inWater ? -speed * 0.6 : speed * 1.4;
        d.water = inWater ? 1 : 0;
        d.surface = y;
        d.age = 0;
        d.life = inWater ? 1.2 + Math.random() * 1.5 : 0.6 + Math.random() * 0.6;
        d.size = 0.02 + Math.random() * (0.05 + size * 0.02);
      }
    },
    // How loud the white water is where the fish is: 0 to 1.
    roar(position, s) {
      let r = 0;
      for (const f of FALLS) {
        const d = Math.abs(s - f.s);
        if (d > 300) continue;
        r = Math.max(r, Math.min(1, 0.35 + f.drop / 20) * Math.exp(-d / (30 + f.drop * 3)));
      }
      for (const rapid of RAPIDS) {
        const d = s < rapid.from ? rapid.from - s : s > rapid.to ? s - rapid.to : 0;
        r = Math.max(r, rapid.strength * 0.7 * Math.exp(-d / 60));
      }
      // A side brook's fall: heard close by.
      for (const [f, c] of curtains) {
        if (!c || !f.sideFall) continue;
        const d = Math.hypot(position.x - c.mesh.geometry.boundingSphere.center.x, position.z - c.mesh.geometry.boundingSphere.center.z);
        r = Math.max(r, 0.55 * Math.exp(-d / 18));
      }
      return r;
    },
    update(dt, cameraPosition, s, time) {
      clock += dt;
      // Curtains for the falls within reach (and the side brooks' falls).
      for (const f of [...FALLS, ...SIDE_FALLS]) {
        const near = Math.abs(f.s - s) < 450;
        if (near && !curtains.has(f)) curtains.set(f, f.sideFall ? buildSideFall(f) : buildCurtain(f));
        else if (!near && curtains.has(f)) {
          const c = curtains.get(f);
          if (c) {
            scene.remove(c.mesh);
            c.mesh.geometry.dispose();
            if (c.under) {
              scene.remove(c.under);
              c.under.geometry.dispose();
            }
          }
          curtains.delete(f);
        }
      }
      // The plume follows whichever fall is nearest.
      let nearest = null,
        distance = 260;
      for (const [f, c] of curtains) {
        if (!c) continue;
        const d = Math.abs(f.s - s);
        if (d < distance) {
          distance = d;
          nearest = c;
        }
      }
      if (nearest !== active) {
        active = nearest;
        for (const p of particles) {
          p.active = false;
          p.y = -1e5;
        }
      }
      if (active) {
        const rate = Math.min(PLUME / 3, (active.impact.to - active.impact.from) * (6 + active.drop * 2.5));
        let toEmit = Math.floor(rate * dt + Math.random());
        for (let i = 0; i < PLUME; i++) {
          const p = particles[i];
          if (!p.active || p.age > p.life) {
            if (toEmit-- > 0) emit(p, active);
            else {
              plumeAlpha[i] = 0;
              continue;
            }
          }
          p.age += dt;
          // Driven down, slowed, then buoyancy carries it back up; the current takes it.
          const buoy = 1.5 + p.size * 14;
          p.vy += (buoy - p.vy * 1.6) * dt;
          p.vx *= Math.exp(-dt * 0.9);
          p.vz *= Math.exp(-dt * 0.9);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          if (p.y < p.floor + 0.2) p.y = p.floor + 0.2;
          if (p.y > active.impact.y - 0.05) p.age = p.life + 1;
          plumePositions[i * 3] = p.x;
          plumePositions[i * 3 + 1] = p.y;
          plumePositions[i * 3 + 2] = p.z;
          plumeSizes[i] = p.size;
          plumeAlpha[i] = Math.min(1, p.age * 6) * (1 - smooth(p.life * 0.6, p.life, p.age)) * 0.9;
        }
        plumeGeometry.attributes.position.needsUpdate = true;
        plumeGeometry.attributes.size.needsUpdate = true;
        plumeGeometry.attributes.alpha.needsUpdate = true;
      }
      plume.visible = !!active;
      cloud.visible = !!active && !active.fall.head;
      if (cloud.visible) {
        const c = active;
        const width = c.impact.to - c.impact.from;
        const force = Math.min(1.6, 0.35 + c.drop / 12);
        for (let i = 0; i < CLOUDS; i++) {
          const q = puffs[i];
          q.age += dt;
          if (q.age > q.life) {
            // Most of it goes in where the jets pour thickest; the rest anywhere along.
            const jet = c.jets[Math.floor(Math.random() * c.jets.length)];
            const u = Math.random() < 0.75 ? Math.min(c.impact.to, Math.max(c.impact.from, jet + (Math.random() + Math.random() - 1) * 2.2)) : c.impact.from + Math.random() * width;
            const spot = c.pick(pickSpot, u, Math.random() * 1.2);
            q.x = spot.x;
            q.z = spot.z;
            q.y = c.impact.y - Math.random() * 0.4;
            q.tx = spot.tx;
            q.tz = spot.tz;
            q.vy = -(2 + Math.random() * 3.5) * force;
            q.vx = spot.tx * (0.4 + Math.random()) * force + (Math.random() - 0.5) * 0.6;
            q.vz = spot.tz * (0.4 + Math.random()) * force + (Math.random() - 0.5) * 0.6;
            q.age = 0;
            // Small dense puffs in the plunge itself, big faint billows rolling away from it.
            q.big = Math.random() < 0.35;
            q.life = q.big ? 4 + Math.random() * (3 + c.drop * 0.2) : 1.4 + Math.random() * 1.6;
            q.size = (q.big ? 1.2 + Math.random() * (1.4 + c.drop * 0.25) : 0.4 + Math.random() * (0.6 + c.drop * 0.08)) * (c.fall.side ? 0.5 : 1);
            q.floor = spot.floor;
            q.top = c.impact.y;
          }
          // Down with the plunge, slowing, then welling back up. The pool turns over like a
          // roller: out along the bottom, back toward the fall near the top.
          q.vy += (1.1 - q.vy * 0.9) * dt;
          const height = Math.min(1, Math.max(0, (q.y - q.floor) / Math.max(0.5, q.top - q.floor)));
          const roll = (0.9 - 1.5 * height) * force;
          q.vx += (q.tx * roll - q.vx) * 0.5 * dt;
          q.vz += (q.tz * roll - q.vz) * 0.5 * dt;
          q.x += q.vx * dt;
          q.y = Math.max(q.floor + q.size * 0.3, q.y + q.vy * dt);
          q.z += q.vz * dt;
          if (q.y > q.top - 0.2) q.y = q.top - 0.2;
          cloudPositions[i * 3] = q.x;
          cloudPositions[i * 3 + 1] = q.y;
          cloudPositions[i * 3 + 2] = q.z;
          cloudSizes[i] = q.size * (1 + q.age * (q.big ? 0.3 : 0.6));
          const strength = q.big ? Math.min(0.3, 0.1 + c.drop * 0.012) : Math.min(0.75, 0.3 + c.drop * 0.03);
          cloudAlpha[i] = Math.min(1, q.age * 3) * (1 - smooth(q.life * 0.35, q.life, q.age)) * strength;
        }
        cloudGeometry.attributes.position.needsUpdate = true;
        cloudGeometry.attributes.size.needsUpdate = true;
        cloudGeometry.attributes.alpha.needsUpdate = true;
      }
      // Spray and splash bubbles.
      for (let i = 0; i < SPRAY; i++) {
        const d = drops[i];
        if (d.age > d.life) {
          sprayAlpha[i] = 0;
          continue;
        }
        d.age += dt;
        if (d.water) {
          d.vy += (1.2 + d.size * 20 - d.vy * 2) * dt;
          d.vx *= Math.exp(-dt * 2);
          d.vz *= Math.exp(-dt * 2);
          if (d.y > d.surface - 0.02) d.age = d.life + 1;
        } else {
          d.vy -= GRAVITY * 0.5 * dt;
          if (d.y < d.surface && d.vy < 0) d.age = d.life + 1;
        }
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        sprayPositions[i * 3] = d.x;
        sprayPositions[i * 3 + 1] = d.y;
        sprayPositions[i * 3 + 2] = d.z;
        spraySizes[i] = d.size;
        sprayAlpha[i] = (1 - d.age / d.life) * 0.9;
      }
      sprayGeometry.attributes.position.needsUpdate = true;
      sprayGeometry.attributes.size.needsUpdate = true;
      sprayGeometry.attributes.alpha.needsUpdate = true;
    },
  };
}
