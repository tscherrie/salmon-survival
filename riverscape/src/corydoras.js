import * as THREE from "three";
import { bedHeight as groundHeight, randomGenerator } from "./math.js";
import { CENTER, ROCKS, SURFACE_Y, radial } from "./layout.js";
import { shelteredVelocity, waterLitShader } from "./water.js";

// Bronze corydoras, Corydoras aeneus: small armoured catfish that live on the sand in
// groups, rooting through it with their barbels for anything edible. Their body is a
// wedge -- flat below, peaked at the dorsal spine -- sheathed in two rows of bony plates
// that shine metallic bronze-green, with a pinkish belly.
//
// They move as a party: a few seconds nose-down in the sand with the tail fluttering to
// hold them there and a puff of silt going up, then a short hop along the bed after the
// others. And now and then one of them does the thing corydoras are known for: it shoots
// straight up to the surface, gulps a mouthful of air (they breathe it through the gut),
// and drifts back down to the group. Food that reaches the sand is theirs. A fast hand or
// a big fish passing low sends the whole party skittering off along the bottom.

const TAU = Math.PI * 2;
const LENGTH = 0.9;
const UP = new THREE.Vector3(0, 1, 0);

const MOVE = { hop: [0.6, 1.9], hopSpeed: 0.75, root: [2.5, 7], forage: 0.18 };
const BREATH = { interval: [70, 190], rise: 2.6, sink: 0.9 };
const SPOOK = { range: 3.2, looming: 1.1, speed: 2.2, time: [1.4, 2.4] };
const PARTY = { roam: [14, 30], spacing: 0.42, reach: 11 };

// Body sections along the fish, snout (x = 0) to the end of the caudal peduncle: height
// of the back and of the belly below the midline, and half-width.
const SECTIONS = [
  [0.0, 0.025, 0.02, 0.03],
  [0.04, 0.085, 0.06, 0.085],
  [0.12, 0.165, 0.09, 0.13],
  [0.22, 0.225, 0.1, 0.15],
  [0.32, 0.24, 0.1, 0.145],
  [0.44, 0.2, 0.09, 0.12],
  [0.58, 0.13, 0.07, 0.085],
  [0.7, 0.085, 0.05, 0.055],
  [0.78, 0.06, 0.042, 0.035],
];
function section(t) {
  for (let i = 1; i < SECTIONS.length; i++)
    if (t <= SECTIONS[i][0]) {
      const a = SECTIONS[i - 1],
        b = SECTIONS[i];
      const f = (t - a[0]) / (b[0] - a[0]);
      const s = f * f * (3 - 2 * f);
      return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
    }
  return SECTIONS[SECTIONS.length - 1].slice(1);
}

// The body and fins as one mesh. Each vertex carries `aTail`, how far back along the body
// it is (0 at the snout, 1 at the tail tip), which the vertex shader uses to swing the
// rear half, and a colour.
function corydorasGeometry() {
  const part = () => ({ positions: [], colours: [], tails: [], metals: [], indices: [] });
  const body = part(),
    fins = part();
  let into = body;
  let { positions, indices } = into;
  const colour = new THREE.Color();
  let metal = 0.15;
  const push = (x, y, z, c, tail) => {
    into.positions.push(x, y, z);
    into.colours.push(c.r, c.g, c.b);
    into.tails.push(tail);
    into.metals.push(metal);
    return into.positions.length / 3 - 1;
  };
  const ROWS = 44,
    AROUND = 26;
  const BELLY = new THREE.Color(0.74, 0.62, 0.5);
  const TAN = new THREE.Color(0.47, 0.35, 0.21);
  const HEAD = new THREE.Color(0.6, 0.37, 0.18);
  const BAND = new THREE.Color(0.04, 0.13, 0.1);
  for (let i = 0; i <= ROWS; i++) {
    const t = (i / ROWS) * 0.8;
    const [top, bottom, width] = section(t);
    for (let j = 0; j <= AROUND; j++) {
      const phi = (j / AROUND) * TAU;
      const s = Math.sin(phi),
        c = Math.cos(phi);
      // Peaked above, flat below: a wedge, the plates meeting in a ridge on the back.
      const y = s >= 0 ? top * Math.pow(s, 1.15) : -bottom * Math.pow(-s, 0.4);
      const z = width * c * (1 - 0.4 * Math.max(0, s));
      // Bronze-tan plates, the broad metallic green band along the flank, a bronze-orange
      // head and a pale belly; the seams between the lateral plates show as fine lines.
      const flank = smoothstepJS(-0.35, -0.1, s) * (1 - smoothstepJS(0.35, 0.6, s));
      const along = smoothstepJS(0.14, 0.22, t) * (1 - smoothstepJS(0.72, 0.8, t));
      const band = flank * along;
      colour.copy(TAN).lerp(HEAD, 1 - smoothstepJS(0.1, 0.2, t));
      colour.lerp(BAND, band * 0.9);
      colour.lerp(BELLY, smoothstepJS(-0.3, -0.55, s));
      const seam = Math.pow(Math.abs(Math.cos(t * 62)), 60) * (t > 0.16 ? 1 : 0) * (s > -0.4 ? 1 : 0);
      colour.multiplyScalar(1 - 0.14 * seam);
      metal = 0.12 + 0.6 * band;
      push(-t * LENGTH, y * LENGTH, z * LENGTH, colour, t / 0.8);
    }
  }
  for (let i = 0; i < ROWS; i++)
    for (let j = 0; j < AROUND; j++) {
      const a = i * (AROUND + 1) + j,
        b = a + AROUND + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  metal = 0.05;
  // Fins: thin sheets with their base on the body.
  const fin = (points, tint, tailAt, where = fins) => {
    into = where;
    const base = into.positions.length / 3;
    for (const [x, y, z, tail] of points) push(x * LENGTH, y * LENGTH, z * LENGTH, tint, tail ?? tailAt);
    for (let k = 1; k < points.length - 1; k++) into.indices.push(base, base + k, base + k + 1, base, base + k + 1, base + k);
    into = body;
  };
  const finTint = new THREE.Color(0.42, 0.4, 0.34);
  const spine = new THREE.Color(0.16, 0.14, 0.1);
  // Dorsal: a stout spine and a sail behind it.
  fin([[-0.27, 0.23, 0], [-0.31, 0.5, 0], [-0.36, 0.47, 0], [-0.46, 0.36, 0], [-0.52, 0.18, 0]], finTint, 0.35);
  fin([[-0.27, 0.23, 0.004], [-0.305, 0.5, 0.004], [-0.3, 0.23, 0.004]], spine, 0.35, body);
  // Caudal: forked.
  fin([[-0.78, 0.035, 0, 0.97], [-0.99, 0.19, 0, 1], [-0.9, 0.0, 0, 1], [-0.99, -0.17, 0, 1], [-0.78, -0.035, 0, 0.97]], finTint, 1);
  for (const side of [-1, 1]) {
    // Pectorals: stiff spines held out sideways and a little down.
    fin([[-0.1, -0.07, 0.1 * side], [-0.17, -0.11, 0.27 * side], [-0.28, -0.09, 0.23 * side], [-0.23, -0.08, 0.11 * side]], finTint, 0.2);
    // Pelvics.
    fin([[-0.42, -0.085, 0.06 * side], [-0.5, -0.12, 0.16 * side], [-0.57, -0.1, 0.11 * side]], finTint, 0.6);
    // Barbels: two short whiskers either side of the mouth.
    fin([[-0.01, -0.02, 0.025 * side], [0.06, -0.06, 0.08 * side], [0.05, -0.066, 0.07 * side]], BELLY, 0);
    // Eye: high on the side of the head, a dark pupil in a pale gold ring.
    const ex = -0.1, ey = 0.1, ez = 0.1 * side;
    for (const [radius, tint, lift] of [[0.035, new THREE.Color(0.55, 0.47, 0.3), 0.006], [0.021, new THREE.Color(0.01, 0.01, 0.012), 0.009]]) {
      const ring = [[ex, ey, ez + lift * side]];
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * TAU;
        ring.push([ex + Math.cos(a) * radius, ey + Math.sin(a) * radius, ez + lift * side]);
      }
      fin(ring, tint, 0.1, body);
    }
  }
  // Adipose spine.
  fin([[-0.62, 0.09, 0], [-0.66, 0.16, 0], [-0.7, 0.075, 0]], spine, 0.8, body);
  const build = ({ positions, colours, tails, metals, indices }) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    geometry.setAttribute("aTail", new THREE.Float32BufferAttribute(tails, 1));
    geometry.setAttribute("aMetal", new THREE.Float32BufferAttribute(metals, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };
  return { body: build(body), fins: build(fins) };
}
function smoothstepJS(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function createCorydoras(scene, { flow = null, food = null, particles = null, detail = false } = {}) {
  const random = randomGenerator(620417);
  const range = (a, b) => a + (b - a) * random();
  const COUNT = detail ? 9 : 7;
  const { body: geometry, fins: finGeometry } = corydorasGeometry();
  const swing = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 2), 2);
  swing.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aSwing", swing);
  finGeometry.setAttribute("aSwing", swing);

  // Metallic plates, a thin iridescent film over them.
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    metalness: 0.45,
    roughness: 0.38,
    iridescence: 0.6,
    iridescenceIOR: 1.4,
    iridescenceThicknessRange: [260, 420],
    side: THREE.DoubleSide,
  });
  const bend = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aTail;\nattribute vec2 aSwing;",
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        // The tail beats; the head hardly moves. aSwing: phase, amplitude.
        float rear = smoothstep(0.25, 1.0, aTail);
        transformed.z += sin(aSwing.x - aTail * 5.0) * aSwing.y * rear * rear;
      `,
      );
  };
  material.onBeforeCompile = (shader) => {
    bend(shader);
    // The green band is the metallic part; the tan plates and the belly much less so.
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aMetal;\nvarying float vMetal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMetal = aMetal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vMetal;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = vMetal;");
    waterLitShader(shader);
  };
  material.customProgramCacheKey = () => "corydoras-v2";
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = bend;
  depth.customProgramCacheKey = () => "corydoras-depth-v1";
  // Fins: thin, clear membranes with a little colour in them.
  const finMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  finMaterial.onBeforeCompile = (shader) => {
    bend(shader);
    waterLitShader(shader);
  };
  finMaterial.customProgramCacheKey = () => "corydoras-fins-v1";
  const finMesh = new THREE.InstancedMesh(finGeometry, finMaterial, COUNT);
  finMesh.name = "Bronze corydoras fins";
  finMesh.frustumCulled = false;
  finMesh.instanceMatrix = null;
  const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
  mesh.name = "Bronze corydoras";
  finMesh.instanceMatrix = mesh.instanceMatrix;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = depth;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh, finMesh);

  // Open sand the party can use: inside the clearing and off the stones.
  const clearOfStones = (x, z, margin = 0.4) =>
    ROCKS.every((rock) => Math.hypot((x - rock.x) / (rock.rx + margin), (z - rock.z) / (rock.rz + margin)) > 1);
  const pickSpot = (near, spread) => {
    for (let tries = 0; tries < 30; tries++) {
      const a = range(0, TAU),
        r = Math.sqrt(random()) * spread;
      const x = near.x + Math.cos(a) * r,
        z = near.z + Math.sin(a) * r;
      if (radial(x, z) < PARTY.reach && clearOfStones(x, z)) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(CENTER.x, 0, CENTER.z + 3);
  };
  const party = { centre: pickSpot(new THREE.Vector3(CENTER.x - 1, 0, CENTER.z + 4), 3), until: range(...PARTY.roam) };

  const fish = Array.from({ length: COUNT }, (_, id) => {
    const spot = pickSpot(party.centre, 1.4);
    spot.y = groundHeight(spot.x, spot.z);
    const yaw = range(0, TAU);
    return {
      id,
      position: spot,
      velocity: new THREE.Vector3(),
      yaw,
      pitch: 0,
      roll: 0,
      mode: "root",
      until: range(0, 4),
      goal: spot.clone(),
      scale: range(0.85, 1.1),
      phase: range(0, TAU),
      beat: 0.02,
      nextBreath: range(BREATH.interval[0], BREATH.interval[1]) * range(0.2, 1),
      puffClock: range(0, 1),
      pellet: null,
      creature: null,
    };
  });

  let clock = 0;
  const water = new THREE.Vector3();
  const stir = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const puffAt = new THREE.Vector3();
  const bubbleAt = new THREE.Vector3();

  function hop(f) {
    f.mode = "hop";
    f.goal.copy(pickSpot(party.centre, 1.6));
    f.until = clock + 6;
  }

  function update(dt, time, pointer, creatures = []) {
    dt = Math.min(dt, 0.05);
    clock += dt;
    // The party drifts from one patch of sand to the next.
    if (clock > party.until) {
      party.centre.copy(pickSpot(party.centre, 5));
      party.until = clock + range(...PARTY.roam);
    }
    for (const f of fish) {
      const { position } = f;
      const floor = groundHeight(position.x, position.z);

      // Threats: a fast hand close by, or a big fish coming low.
      let threat = null;
      if (pointer && pointer.velocity.length() > 1) {
        delta.subVectors(position, pointer.position);
        if (delta.length() < SPOOK.range && pointer.velocity.dot(delta) / Math.max(delta.lengthSq(), 0.3) > SPOOK.looming * 0.3)
          threat = pointer.position;
      }
      for (const c of creatures) {
        if (!c.velocity) continue;
        delta.subVectors(position, c.position);
        if (delta.length() < c.radius + 1.6 && c.velocity.length() > 1.2) threat = c.position;
      }
      if (threat && f.mode !== "flee" && f.mode !== "breathe") {
        f.mode = "flee";
        f.until = clock + range(...SPOOK.time);
        delta.subVectors(position, threat).setY(0).normalize();
        f.goal.copy(position).addScaledVector(delta, 3);
        if (particles) particles.puff(position, 10, 0.6, 0.3);
      }

      // Food on the sand is theirs.
      if (food && !f.pellet && (f.mode === "root" || f.mode === "hop")) {
        for (const pellet of food.pellets)
          if (!pellet.gone && food.settled(pellet) && pellet.position.distanceToSquared(position) < 9) {
            f.pellet = pellet;
            f.mode = "feed";
            f.until = clock + 12;
            break;
          }
      }
      if (f.pellet && (f.pellet.gone || f.mode !== "feed")) f.pellet = null;

      // A breath.
      if (f.mode === "root" && clock > f.nextBreath) {
        f.mode = "breathe";
        f.stage = "up";
        f.goal.set(position.x + range(-0.8, 0.8), SURFACE_Y - 0.15, position.z + range(-0.8, 0.8));
        f.until = clock + 20;
        f.nextBreath = clock + range(...BREATH.interval);
      }

      if (clock >= f.until) {
        if (f.mode === "root") hop(f);
        else {
          f.mode = "root";
          f.until = clock + range(...MOVE.root);
        }
      }

      // Where to go and how fast.
      let speed = 0;
      let lift = 0.04;
      desired.set(0, 0, 0);
      if (f.mode === "hop" || f.mode === "flee") {
        desired.subVectors(f.goal, position).setY(0);
        const d = desired.length();
        speed = f.mode === "flee" ? SPOOK.speed : MOVE.hopSpeed * Math.min(1, d * 1.5);
        if (d < 0.15 && f.mode === "hop") {
          f.mode = "root";
          f.until = clock + range(...MOVE.root);
        }
        lift = f.mode === "flee" ? 0.12 : 0.1;
        if (d > 1e-3) desired.multiplyScalar(speed / d);
      } else if (f.mode === "feed" && f.pellet) {
        desired.subVectors(f.pellet.position, position).setY(0);
        const d = desired.length();
        speed = Math.min(0.9, 0.2 + d);
        if (d < 0.12 * f.scale + 0.05) {
          food.take(f.pellet);
          f.pellet = null;
          f.mode = "root";
          f.until = clock + range(1, 3);
        } else desired.multiplyScalar(speed / Math.max(d, 1e-3));
      } else if (f.mode === "root") {
        // Shuffling along with the nose in the sand.
        desired.set(Math.cos(f.yaw), 0, Math.sin(f.yaw)).multiplyScalar(MOVE.forage * (0.5 + 0.5 * Math.sin(clock * 1.7 + f.id)));
        speed = MOVE.forage;
        lift = 0.0;
      } else if (f.mode === "breathe") {
        if (f.stage === "up") {
          desired.subVectors(f.goal, position);
          const d = desired.length();
          desired.multiplyScalar(BREATH.rise / Math.max(d, 1e-3));
          speed = BREATH.rise;
          if (d < 0.25) {
            f.stage = "down";
            if (particles)
              for (let i = 0; i < 3; i++)
                particles.bubble(bubbleAt.copy(position).add(delta.set(range(-0.05, 0.05), -0.2, range(-0.05, 0.05))), range(0.02, 0.035), 0.02);
            f.goal.copy(pickSpot(party.centre, 1.4));
          }
        } else {
          desired.subVectors(f.goal, position).setY(0).multiplyScalar(0.3);
          desired.y = -BREATH.sink;
          speed = BREATH.sink;
          if (position.y < floor + 0.15) {
            f.mode = "root";
            f.until = clock + range(...MOVE.root);
          }
        }
      }

      // Keep a little apart, and off the stones.
      for (const other of fish) {
        if (other === f) continue;
        delta.subVectors(position, other.position);
        delta.y = 0;
        const d = delta.length();
        if (d < PARTY.spacing && d > 1e-4) desired.addScaledVector(delta, ((PARTY.spacing - d) / d) * 1.5);
      }
      for (const rock of ROCKS) {
        const dx = (position.x - rock.x) / (rock.rx + 0.3),
          dz = (position.z - rock.z) / (rock.rz + 0.3);
        const d = Math.hypot(dx, dz);
        if (d < 1.15 && d > 1e-4) desired.add(delta.set(dx, 0, dz).multiplyScalar((1.15 - d) * 2 / d));
      }

      // The current pushes a fish that is off the bottom; one holding on to it is not moved.
      shelteredVelocity(position, time, water);
      if (flow) water.add(flow.sample(position, stir));
      const inWater = position.y > floor + 0.25 ? 1 : 0.15;
      f.velocity.lerp(desired.addScaledVector(water, inWater), 1 - Math.exp(-dt * 4));
      position.addScaledVector(f.velocity, dt);
      const bed = groundHeight(position.x, position.z);
      if (f.mode !== "breathe") {
        const target = bed + lift * f.scale;
        position.y += (target - position.y) * (1 - Math.exp(-dt * 6));
      }
      position.y = Math.max(position.y, bed);

      // Heading follows the motion; nose down when rooting, up when rising.
      const horizontal = Math.hypot(f.velocity.x, f.velocity.z);
      if (horizontal > 0.05) {
        const target = Math.atan2(f.velocity.z, f.velocity.x);
        const error = Math.atan2(Math.sin(target - f.yaw), Math.cos(target - f.yaw));
        f.yaw += error * (1 - Math.exp(-dt * (f.mode === "flee" ? 9 : 4)));
      }
      let pitch = 0;
      if (f.mode === "root") pitch = -0.42 + 0.08 * Math.sin(clock * 3 + f.id);
      else if (f.mode === "breathe") pitch = f.stage === "up" ? 1.2 : -0.5;
      else if (f.mode === "feed") pitch = -0.25;
      f.pitch += (pitch - f.pitch) * (1 - Math.exp(-dt * 5));

      // The tail: a flutter while rooting, strong strokes while moving.
      const through = f.velocity.length();
      const beat = f.mode === "root" ? 0.018 + 0.012 * Math.sin(clock * 0.9 + f.id) : Math.min(0.09, 0.03 + through * 0.03);
      f.beat += (beat - f.beat) * (1 - Math.exp(-dt * 6));
      f.phase = (f.phase + dt * TAU * (f.mode === "root" ? 5 : 3 + through * 3)) % TAU;
      swing.setXY(f.id, f.phase, f.beat);

      // Rooting throws up a little silt.
      if (f.mode === "root" && particles) {
        f.puffClock -= dt;
        if (f.puffClock <= 0) {
          f.puffClock = range(0.8, 2.2);
          puffAt.set(Math.cos(f.yaw), 0, Math.sin(f.yaw)).multiplyScalar(0.08 * f.scale).add(position);
          particles.puff(puffAt, 3, 0.25, 0.12);
        }
      }

      euler.set(0, -f.yaw, f.pitch, "YZX");
      quaternion.setFromEuler(euler);
      scale.setScalar(f.scale);
      // The body's origin is at the snout; set it so the fish pivots about its middle.
      puffAt.set(0.4 * LENGTH * f.scale, 0, 0).applyQuaternion(quaternion);
      matrix.compose(bubbleAt.copy(position).add(puffAt).setY(position.y + 0.09 * f.scale), quaternion, scale);
      mesh.setMatrixAt(f.id, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    swing.needsUpdate = true;
  }

  update(0, 0, null);
  return { update, fish, mesh };
}
