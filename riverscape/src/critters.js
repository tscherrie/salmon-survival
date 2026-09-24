import * as THREE from "three";
import { bedHeight as groundHeight, randomGenerator } from "./math.js";
import { CENTER, ROCKS, SURFACE_Y, radial, rockCenterY } from "./layout.js";
import { STRIDER_SLOTS, river, waterLitShader } from "./water.js";

// The small life of the river: apple snails grazing the film of algae on the stones and
// the sand, glass shrimps picking over the bed, and water striders skating on the surface
// overhead, their feet dimpling the film.

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// --------------------------------------------------------------------------------------
// Apple snail, Pomacea: a round brown shell with darker spiral bands, a pale mottled foot.
function snailGeometry() {
  const positions = [],
    colours = [],
    indices = [];
  const colour = new THREE.Color();
  const tube = (points, radii, tint) => {
    const start = positions.length / 3;
    const AROUND = 12;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const next = points[Math.min(i + 1, points.length - 1)];
      const prev = points[Math.max(i - 1, 0)];
      const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
      const a = new THREE.Vector3().crossVectors(tangent, UP);
      if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
      a.normalize();
      const b = new THREE.Vector3().crossVectors(tangent, a).normalize();
      for (let j = 0; j <= AROUND; j++) {
        const phi = (j / AROUND) * TAU;
        const v = p.clone().addScaledVector(a, Math.cos(phi) * radii[i]).addScaledVector(b, Math.sin(phi) * radii[i]);
        positions.push(v.x, v.y, v.z);
        tint(i / (points.length - 1), phi, colour);
        colours.push(colour.r, colour.g, colour.b);
        if (i < points.length - 1 && j < AROUND) {
          const q = start + i * (AROUND + 1) + j;
          indices.push(q, q + AROUND + 1, q + 1, q + 1, q + AROUND + 1, q + AROUND + 2);
        }
      }
    }
  };
  // The shell: a tube coiling round a vertical axis, each turn wider and lower than the
  // last (a logarithmic spiral), its cross-section always in the plane of the axis so the
  // whorls sit snugly on one another. The last, biggest whorl is most of the shell, as an
  // apple snail's is.
  {
    const start = positions.length / 3;
    const STEPS = 90,
      AROUND = 14,
      TURNS = 3.4;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const theta = t * TURNS * TAU;
      const grow = Math.exp((t - 1) * 2.9);
      const a = 0.15 * grow + 0.003;
      const r = 0.95 * a;
      const y = 0.15 + (0.15 - a) * 1.25;
      for (let j = 0; j <= AROUND; j++) {
        const phi = (j / AROUND) * TAU;
        const out = r + a * Math.cos(phi);
        positions.push(Math.cos(theta) * out - 0.05, y + a * Math.sin(phi), Math.sin(theta) * out);
        // Olive-brown with darker spiral bands and fine growth lines; the lip paler.
        colour.setRGB(0.24, 0.17, 0.07);
        const band = Math.pow(0.5 + 0.5 * Math.cos(phi * 4 + 0.6), 6);
        const growth = 0.88 + 0.12 * Math.sin(theta * 14);
        // The suture, where each whorl sits down on the one before.
        const suture = Math.exp(-(((phi - 1.95) / 0.22) ** 2));
        colour.multiplyScalar((1 - 0.65 * band) * growth * (1 - 0.6 * suture));
        if (t > 0.985) colour.lerp(new THREE.Color(0.62, 0.5, 0.3), 0.7);
        colours.push(colour.r, colour.g, colour.b);
        if (i < STEPS && j < AROUND) {
          const q = start + i * (AROUND + 1) + j;
          indices.push(q, q + 1, q + AROUND + 1, q + 1, q + AROUND + 2, q + AROUND + 1);
        }
      }
    }
  }
  // The foot and head: a low slab under the shell's opening, two tentacles.
  const foot = [],
    footRadii = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    foot.push(new THREE.Vector3(0.24 - t * 0.46, 0.03 + 0.02 * Math.sin(t * Math.PI), 0.02));
    footRadii.push(0.075 * Math.sin(Math.PI * (0.1 + 0.8 * t)) + 0.01);
  }
  tube(foot, footRadii, (t, phi, c) => c.setRGB(0.3, 0.26, 0.17).multiplyScalar(0.8 + 0.2 * Math.sin(phi * 5 + t * 20)));
  for (const side of [-1, 1]) {
    const tentacle = [new THREE.Vector3(0.22, 0.06, 0.03 * side), new THREE.Vector3(0.3, 0.07, 0.06 * side), new THREE.Vector3(0.36, 0.06, 0.1 * side)];
    tube(tentacle, [0.012, 0.008, 0.003], (t, phi, c) => c.setRGB(0.28, 0.24, 0.16));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// --------------------------------------------------------------------------------------
// Glass shrimp, Macrobrachium / Palaemonetes: clear bodies with a few rust-brown bands, a
// fan of a tail, long antennae. Built along a curved spine: the carapace, six abdominal
// segments tapering to the tail, and the tail fan.
function shrimpGeometry() {
  const positions = [],
    colours = [],
    tails = [],
    indices = [];
  const colour = new THREE.Color();
  const ROWS = 26,
    AROUND = 10;
  const spine = (t) => new THREE.Vector3(0.22 - t * 0.5, 0.06 + 0.05 * Math.sin(t * Math.PI * 0.9) - 0.03 * t, 0);
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS;
    const c = spine(t);
    const radius = (t < 0.4 ? 0.05 * Math.sin(Math.PI * (0.25 + t * 1.5)) + 0.012 : 0.048 * (1 - (t - 0.4) / 0.6) + 0.01) * 1.0;
    for (let j = 0; j <= AROUND; j++) {
      const phi = (j / AROUND) * TAU;
      positions.push(c.x, c.y + Math.sin(phi) * radius * 1.15, c.z + Math.cos(phi) * radius * 0.9);
      // Clear, with rust bands at the segment joints and a dark line along the gut.
      const joint = t > 0.4 ? Math.pow(Math.abs(Math.cos((t - 0.4) * 26)), 12) : 0;
      colour.setRGB(0.42, 0.44, 0.38).lerp(new THREE.Color(0.45, 0.16, 0.06), joint * 0.7);
      if (Math.sin(phi) > 0.2 && Math.sin(phi) < 0.7 && t > 0.1 && t < 0.85) colour.lerp(new THREE.Color(0.28, 0.18, 0.1), 0.35);
      colours.push(colour.r, colour.g, colour.b);
      tails.push(t);
      if (i < ROWS && j < AROUND) {
        const q = i * (AROUND + 1) + j;
        indices.push(q, q + AROUND + 1, q + 1, q + 1, q + AROUND + 1, q + AROUND + 2);
      }
    }
  }
  const flat = (points, tint, t) => {
    const base = positions.length / 3;
    for (const p of points) {
      positions.push(...p);
      colours.push(tint.r, tint.g, tint.b);
      tails.push(t);
    }
    for (let k = 1; k < points.length - 1; k++) indices.push(base, base + k, base + k + 1, base, base + k + 1, base + k);
  };
  const clear = new THREE.Color(0.42, 0.43, 0.37);
  const end = spine(1);
  // Tail fan.
  flat([[end.x + 0.02, end.y, 0], [end.x - 0.1, end.y - 0.01, 0.07], [end.x - 0.12, end.y - 0.01, 0], [end.x - 0.1, end.y - 0.01, -0.07]], clear, 1);
  // Rostrum and antennae: long, thin, sweeping back over the body.
  flat([[0.22, 0.08, 0], [0.34, 0.1, 0.004], [0.34, 0.1, -0.004]], clear, 0);
  for (const side of [-1, 1]) {
    // Each antenna a hair-thin sliver.
    flat([[0.24, 0.07, 0.01 * side], [0.52, 0.12, 0.13 * side], [0.24, 0.078, 0.014 * side]], clear, 0);
    flat([[0.5, 0.118, 0.125 * side], [0.74, 0.05, 0.32 * side], [0.5, 0.124, 0.132 * side]], clear, 0);
    // Walking legs: thin spokes under the carapace.
    for (let k = 0; k < 4; k++) {
      const x = 0.14 - k * 0.05;
      flat([[x, 0.03, 0.02 * side], [x + 0.03, -0.04, 0.09 * side], [x + 0.025, -0.045, 0.09 * side], [x - 0.005, 0.03, 0.02 * side]], clear, 0.1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute("aTail", new THREE.Float32BufferAttribute(tails, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// --------------------------------------------------------------------------------------
// Water strider: a slender dark body and six legs spread on the film. Each foot presses a
// dimple into the surface, and the dimple bends the sunlight aside like a lens: on the bed
// below each strider walks a set of round dark shadows, rimmed with light. The dimples are
// drawn as faint discs on the film, and their shadows come from the light model itself
// (striderShade in water.js), which is told where every strider is.
function striderGeometry() {
  const positions = [],
    indices = [];
  const quad = (a, b, width) => {
    const base = positions.length / 3;
    const side = new THREE.Vector3().subVectors(b, a).cross(UP).normalize().multiplyScalar(width);
    positions.push(a.x + side.x, a.y, a.z + side.z, a.x - side.x, a.y, a.z - side.z, b.x + side.x, b.y, b.z + side.z, b.x - side.x, b.y, b.z - side.z);
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);
  quad(V(0.16, 0), V(-0.14, 0), 0.018);
  for (const side of [-1, 1]) {
    quad(V(0.08, 0), V(0.18, 0.08 * side), 0.005);
    quad(V(0.0, 0.01 * side), V(0.05, 0.3 * side), 0.004);
    quad(V(0.05, 0.3 * side), V(-0.1, 0.42 * side), 0.003);
    quad(V(-0.04, 0.01 * side), V(-0.22, 0.2 * side), 0.004);
    quad(V(-0.22, 0.2 * side), V(-0.36, 0.26 * side), 0.003);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
// Where the feet press the film, relative to the body.
const STRIDER_FEET = [
  [0.18, 0.08], [0.18, -0.08],
  [-0.1, 0.42], [-0.1, -0.42],
  [-0.36, 0.26], [-0.36, -0.26],
];

export function createCritters(scene, { flow = null, food = null, particles = null, ripples = null, detail = false } = {}) {
  const random = randomGenerator(318811);
  const range = (a, b) => a + (b - a) * random();

  // Places on the stones and on the sand for a snail: the tops of rocks, found by the
  // stone's own ellipsoid, and the open sand around them.
  const stoneTop = (x, z) => {
    let top = -Infinity;
    for (const rock of ROCKS) {
      const u = (x - rock.x) / rock.rx,
        v = (z - rock.z) / rock.rz;
      const k = 1 - u * u - v * v;
      if (k > 0) top = Math.max(top, rockCenterY(rock) + rock.ry * Math.sqrt(k) * 0.92);
    }
    return top;
  };
  const surfaceAt = (x, z) => Math.max(groundHeight(x, z), stoneTop(x, z));

  // ---------------- snails
  const SNAILS = detail ? 9 : 6;
  const snailMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  snailMaterial.onBeforeCompile = (shader) => waterLitShader(shader);
  snailMaterial.customProgramCacheKey = () => "snail-v1";
  const snailMesh = new THREE.InstancedMesh(snailGeometry(), snailMaterial, SNAILS);
  snailMesh.name = "Apple snails";
  snailMesh.castShadow = true;
  snailMesh.receiveShadow = true;
  snailMesh.frustumCulled = false;
  snailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Start half of them on stones.
  const bigStones = ROCKS.filter((r) => r.rx > 0.9 && radial(r.x, r.z) < 15);
  const snails = Array.from({ length: SNAILS }, (_, i) => {
    let x, z;
    if (i % 2 === 0 && bigStones.length) {
      const rock = bigStones[Math.floor(random() * bigStones.length)];
      const a = range(0, TAU);
      x = rock.x + Math.cos(a) * rock.rx * range(0.1, 0.55);
      z = rock.z + Math.sin(a) * rock.rz * range(0.1, 0.55);
    } else {
      const a = range(0, TAU),
        r = range(3, 12);
      x = CENTER.x + Math.cos(a) * r;
      z = CENTER.z + Math.sin(a) * r;
    }
    return {
      position: new THREE.Vector3(x, surfaceAt(x, z), z),
      heading: range(0, TAU),
      turn: 0,
      speed: range(0.015, 0.035),
      pause: range(0, 10),
      scale: range(0.8, 1.2),
    };
  });

  // ---------------- shrimp
  const SHRIMP = detail ? 12 : 8;
  const shrimpMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.3,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const flick = new THREE.InstancedBufferAttribute(new Float32Array(SHRIMP), 1);
  flick.setUsage(THREE.DynamicDrawUsage);
  shrimpMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aTail;\nattribute float aFlick;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        // The tail curls under at a flick, the way a shrimp shoots itself backwards.
        float curl = aFlick * smoothstep(0.35, 1.0, aTail);
        float c = cos(curl * 2.2), s = sin(curl * 2.2);
        vec2 pivot = vec2(0.02, 0.07);
        vec2 q = transformed.xy - pivot;
        transformed.xy = pivot + vec2(q.x * c - q.y * s, q.x * s + q.y * c);
      `,
      );
    // A glassy body: the light it lets through, and a sheen.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.05;",
    );
    waterLitShader(shader);
  };
  shrimpMaterial.customProgramCacheKey = () => "glass-shrimp-v1";
  const shrimpGeo = shrimpGeometry();
  shrimpGeo.setAttribute("aFlick", flick);
  const shrimpMesh = new THREE.InstancedMesh(shrimpGeo, shrimpMaterial, SHRIMP);
  shrimpMesh.name = "Glass shrimps";
  shrimpMesh.frustumCulled = false;
  shrimpMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const shrimp = Array.from({ length: SHRIMP }, () => {
    const a = range(0, TAU),
      r = range(2, 11);
    const x = CENTER.x + Math.cos(a) * r,
      z = CENTER.z + Math.sin(a) * r;
    return {
      position: new THREE.Vector3(x, groundHeight(x, z), z),
      velocity: new THREE.Vector3(),
      heading: range(0, TAU),
      mode: "pick",
      until: range(0, 4),
      flick: 0,
      bob: range(0, TAU),
      scale: range(0.8, 1.25),
      goal: new THREE.Vector3(x, 0, z),
      pellet: null,
    };
  });

  // ---------------- water striders
  const STRIDERS = Math.min(STRIDER_SLOTS, detail ? 7 : 5);
  const striderMaterial = new THREE.MeshBasicMaterial({ color: 0x0b0a08, side: THREE.DoubleSide });
  const striderMesh = new THREE.InstancedMesh(striderGeometry(), striderMaterial, STRIDERS);
  striderMesh.name = "Water striders";
  striderMesh.castShadow = true;
  striderMesh.frustumCulled = false;
  striderMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // The dimples: faint bright rings on the film from below, and round shadows on the bed.
  const dimpleMaterial = new THREE.MeshBasicMaterial({ color: 0xdff4f0, transparent: true, opacity: 0.35, depthWrite: false });
  const dimpleMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.1, 14).rotateX(Math.PI / 2), dimpleMaterial, STRIDERS * STRIDER_FEET.length);
  dimpleMesh.name = "Strider dimples";
  dimpleMesh.castShadow = false;
  dimpleMesh.frustumCulled = false;
  dimpleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const striders = Array.from({ length: STRIDERS }, () => {
    const a = range(0, TAU),
      r = range(4, 16);
    return {
      position: new THREE.Vector3(CENTER.x + Math.cos(a) * r, SURFACE_Y - 0.005, CENTER.z + Math.sin(a) * r),
      velocity: new THREE.Vector3(),
      heading: range(0, TAU),
      next: range(0, 3),
      scale: range(0.85, 1.15),
    };
  });

  scene.add(snailMesh, shrimpMesh, striderMesh, dimpleMesh);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const stir = new THREE.Vector3();
  const foot = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const tilt = new THREE.Quaternion();

  function update(dt, time, pointer, creatures = []) {
    dt = Math.min(dt, 0.05);

    // Snails: creep, stop, creep on, turning a little; over the stones and down again.
    for (let i = 0; i < SNAILS; i++) {
      const s = snails[i];
      s.pause -= dt;
      if (s.pause < 0) {
        s.turn += (random() - 0.5) * dt * 0.8;
        s.turn *= Math.exp(-dt * 0.5);
        s.heading += s.turn * dt;
        const nx = s.position.x + Math.cos(s.heading) * s.speed * dt;
        const nz = s.position.z + Math.sin(s.heading) * s.speed * dt;
        // Keep to the clearing.
        if (radial(nx, nz) > 14) s.heading += Math.PI * dt;
        else {
          s.position.x = nx;
          s.position.z = nz;
        }
        if (random() < dt * 0.02) s.pause = range(8, 40);
      }
      const y = surfaceAt(s.position.x, s.position.z);
      s.position.y += (y - s.position.y) * (1 - Math.exp(-dt * 3));
      // Lie along the surface under the foot.
      const h = 0.15;
      normal.set(surfaceAt(s.position.x - h, s.position.z) - surfaceAt(s.position.x + h, s.position.z), 2 * h, surfaceAt(s.position.x, s.position.z - h) - surfaceAt(s.position.x, s.position.z + h)).normalize();
      tilt.setFromUnitVectors(UP, normal);
      quaternion.setFromAxisAngle(UP, -s.heading).premultiply(tilt);
      matrix.compose(s.position, quaternion, scale.setScalar(s.scale));
      snailMesh.setMatrixAt(i, matrix);
    }
    snailMesh.instanceMatrix.needsUpdate = true;

    // Shrimp: pick at the sand, walk a little, and shoot backwards from anything fast.
    for (let i = 0; i < SHRIMP; i++) {
      const s = shrimp[i];
      const { position } = s;
      let threat = null;
      if (pointer && pointer.velocity.length() > 0.8 && pointer.position.distanceTo(position) < 2.5) threat = pointer.position;
      for (const c of creatures) if (c.velocity && c.position.distanceTo(position) < c.radius + 1.2) threat = c.position;
      if (threat && s.mode !== "flee") {
        s.mode = "flee";
        s.until = time + range(0.3, 0.5);
        delta.subVectors(position, threat).setY(0).normalize();
        s.velocity.copy(delta).multiplyScalar(3.2).setY(0.9);
        s.heading = Math.atan2(-delta.z, -delta.x);
        if (particles) particles.puff(position, 4, 0.3, 0.1);
      }
      if (food && !s.pellet && s.mode === "pick")
        for (const pellet of food.pellets)
          if (!pellet.gone && food.settled(pellet) && pellet.position.distanceToSquared(position) < 4) {
            s.pellet = pellet;
            s.mode = "walk";
            s.goal.copy(pellet.position);
            s.until = time + 8;
            break;
          }
      if (s.pellet && s.pellet.gone) s.pellet = null;
      if (time > s.until) {
        if (s.mode === "pick") {
          s.mode = "walk";
          const a = range(0, TAU);
          s.goal.set(position.x + Math.cos(a) * range(0.3, 1.2), 0, position.z + Math.sin(a) * range(0.3, 1.2));
          if (radial(s.goal.x, s.goal.z) > 12) s.goal.set(CENTER.x, 0, CENTER.z).lerp(position, 0.8);
          s.until = time + range(2, 5);
        } else {
          s.mode = "pick";
          s.until = time + range(2, 7);
        }
      }
      const bed = groundHeight(position.x, position.z);
      if (s.mode === "flee") {
        s.velocity.multiplyScalar(Math.exp(-dt * 3));
        s.velocity.y -= dt * 1.5;
        s.flick = Math.min(1, s.flick + dt * 12);
      } else {
        s.flick = Math.max(0, s.flick - dt * 4);
        if (s.mode === "walk") {
          delta.subVectors(s.goal, position).setY(0);
          const d = delta.length();
          if (s.pellet && d < 0.15) {
            food.take(s.pellet);
            s.pellet = null;
            s.mode = "pick";
            s.until = time + range(3, 6);
          }
          s.velocity.lerp(delta.multiplyScalar(d > 0.05 ? 0.25 / d : 0), 1 - Math.exp(-dt * 3));
          if (d > 0.05) {
            const want = Math.atan2(s.goal.z - position.z, s.goal.x - position.x);
            s.heading += Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading)) * (1 - Math.exp(-dt * 4));
          }
        } else s.velocity.multiplyScalar(Math.exp(-dt * 5));
      }
      position.addScaledVector(s.velocity, dt);
      if (s.mode === "flee" && time > s.until) {
        s.mode = "pick";
        s.until = time + range(3, 6);
      }
      position.y = Math.max(bed, s.mode === "flee" ? position.y : bed + (position.y - bed) * Math.exp(-dt * 4));
      // Picking: the whole body dips and rises as the claws work.
      s.bob += dt * (s.mode === "pick" ? 7 : 3);
      const dip = s.mode === "pick" ? 0.05 * Math.sin(s.bob) : 0;
      euler.set(0, -s.heading, -0.12 + dip, "YZX");
      quaternion.setFromEuler(euler);
      matrix.compose(delta.copy(position).setY(position.y + 0.03 * s.scale), quaternion, scale.setScalar(s.scale));
      shrimpMesh.setMatrixAt(i, matrix);
      flick.setX(i, s.flick);
    }
    shrimpMesh.instanceMatrix.needsUpdate = true;
    flick.needsUpdate = true;

    // Striders: a stroke of the long middle legs, a glide, a pause; the film carries
    // them downstream slowly and they row back up it. A hand near the top scatters them.
    for (let i = 0; i < STRIDERS; i++) {
      const s = striders[i];
      s.next -= dt;
      if (pointer && pointer.velocity.length() > 1 && Math.hypot(pointer.position.x - s.position.x, pointer.position.z - s.position.z) < 3 && pointer.position.y > SURFACE_Y - 3)
        s.next = Math.min(s.next, 0);
      if (s.next <= 0) {
        // Upstream on the whole, and back toward the middle if far out.
        const home = Math.atan2(CENTER.z - s.position.z, CENTER.x - s.position.x);
        const out = radial(s.position.x, s.position.z) > 16;
        s.heading = out ? home + range(-0.5, 0.5) : Math.PI + range(-1.4, 1.4);
        s.velocity.set(Math.cos(s.heading), 0, Math.sin(s.heading)).multiplyScalar(range(0.6, 1.6));
        s.next = range(0.6, 3.5);
        if (ripples) ripples.add(s.position.x, s.position.z, 0.12);
      }
      s.velocity.multiplyScalar(Math.exp(-dt * 1.4));
      if (flow) {
        flow.sample(s.position, stir);
        s.velocity.x += stir.x * dt;
        s.velocity.z += stir.z * dt;
      }
      s.position.x += (s.velocity.x + 0.3) * dt;
      s.position.z += s.velocity.z * dt;
      quaternion.setFromAxisAngle(UP, -s.heading);
      matrix.compose(s.position, quaternion, scale.setScalar(s.scale));
      striderMesh.setMatrixAt(i, matrix);
      for (let k = 0; k < STRIDER_FEET.length; k++) {
        const [fx, fz] = STRIDER_FEET[k];
        foot.set(fx * s.scale, 0, fz * s.scale).applyQuaternion(quaternion).add(s.position);
        matrix.makeTranslation(foot.x, SURFACE_Y - 0.01, foot.z);
        dimpleMesh.setMatrixAt(i * STRIDER_FEET.length + k, matrix);
      }
    }
    striderMesh.instanceMatrix.needsUpdate = true;
    dimpleMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < STRIDER_SLOTS; i++) {
      const s = striders[i];
      if (s) river.striders.value[i].set(s.position.x, s.position.z, s.heading, s.scale);
      else river.striders.value[i].set(0, 0, 0, 0);
    }
  }
  update(0, 0, null);
  return { update, snails, shrimp, striders };
}
