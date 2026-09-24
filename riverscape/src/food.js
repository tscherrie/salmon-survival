import * as THREE from "three";
import { bedHeight as groundHeight, randomGenerator } from "./math.js";
import { SURFACE_Y, shelteredVelocity, waterLitShader } from "./water.js";

// A pinch of flake food dropped on the water: thin, brittle flakes a few millimetres
// across in the usual mix of colours. A flake behaves nothing like a granule. Dry, it sits
// on the meniscus for a moment; it wets through in a second or two because it is so thin,
// and then it does not drop but flutters down, rocking from side to side like a falling
// leaf and sliding a little each way at the end of every swing (Field et al. 1997,
// doi:10.1038/37981, on the "fluttering" regime of thin falling plates). That swaying
// descent is slow -- around a centimetre a second, a third of a body length -- which is
// exactly why it is the food fish are fed with: the whole shoal has time to come up and
// take it in mid-water, where the viewer can watch it happen.
//
// A pinch can also be pushed under by hand, straight into the water where the viewer
// points, with the air that goes down with it bubbling back up; that way it is in the
// picture at once instead of on the part of the surface that is out of view.
const PELLET = {
  // Flake radius in scene units (one unit is about six centimetres).
  radius: [0.085, 0.13],
  sink: [0.16, 0.26],
  float: [0.8, 1.6],
  lingerChance: 0.1,
  linger: [10, 24],
  bob: 0.012,
  bobRate: 3.8,
  // The side-to-side swing of the fall: how far each way, how often, and how far the
  // flake tips at the ends of it.
  sway: [0.12, 0.24],
  swayRate: [1.3, 2.3],
  tip: [0.35, 0.75],
  spin: [0.3, 1.1],
  stagger: [0.03, 0.1],
  perPinch: 12,
  capacity: 120,
  life: [26, 44],
  swallow: 0.12,
  shoveLimit: 0.36,
};
// Flake food is sold as a blend, and the blend is what the eye catches in the water.
const FLAKE_COLOURS = [
  [0.015, 0.72, 0.42],
  [0.045, 0.78, 0.47],
  [0.09, 0.72, 0.5],
  [0.12, 0.62, 0.52],
  [0.26, 0.48, 0.36],
  [0.07, 0.42, 0.32],
];
// Food lands on the film itself, which in the river is in view: the underside of the
// surface at the top of the picture.
const FILM = SURFACE_Y - 0.03;
// A hand does not reach far below the film, nor into the sand.
const REACH = { belowFilm: 0.35, aboveBed: 0.9 };
const PINCH = { x: 0.3, z: 0.35, minZ: -5.5, maxZ: 1.5 };
// The water the food may occupy. Downstream there is no glass: a pellet the fish miss is
// carried out of the picture and gone.
const TANK = { minX: -24, maxX: 24, minZ: -26, maxZ: 21 };
// Settled pellets do not creep. Lifting one off the sand takes a free-stream flow of
// 15 to 19 cm/s (critical shear 0.06 Pa smooth, 0.32 Pa rough: Carvajalino-Fernandez et
// al. 2020, doi:10.3354/aei00350) and the tank's current is an order of magnitude below
// that -- but a fish's tail stroke or a missed strike easily exceeds it, which is why a
// pellet can be blown off the sand only by a fish.
const RESUSPENSION = { drag: 5.5, settleTime: 0.9, recovery: 8 };

export function createFood(scene, { thickets = [], flow = null, onSplash = null } = {}) {
  const random = randomGenerator(902311);
  const range = (min, max) => min + random() * (max - min);
  const exponential = (mean) => -mean * Math.log(1 - random());

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  // A flake is thin enough for the light to come through it: from below, against the
  // bright water, it glows in its own colour rather than showing as a dark speck.
  const glow = { value: 0.42 };
  material.onBeforeCompile = (shader) => {
    waterLitShader(shader);
    shader.uniforms.flakeGlow = glow;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float flakeGlow;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * flakeGlow;",
      );
  };
  material.customProgramCacheKey = () => "food-flake-v2";
  const mesh = new THREE.InstancedMesh(flakeGeometry(), material, PELLET.capacity);
  mesh.name = "Sinking food flakes";
  // A pellet is far too small to cast a shadow the 4096-map can resolve -- it would smear
  // a soft blob several times its own size onto the sand -- but it must visibly dim as it
  // drifts under the driftwood, so it receives.
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);
  // Dry food is a pale tan-orange, light enough to read against dark water as well as
  // against the pale sand, and nothing else in the tank is that colour. Each pellet keeps its own tint, written to whichever
  // instance slot it currently occupies, so a pellet does not change colour when another
  // one ahead of it is eaten.
  const tint = new THREE.Color();
  for (let i = 0; i < PELLET.capacity; i++) mesh.setColorAt(i, tint.setRGB(0, 0, 0));

  const pellets = [];
  const pending = [];
  const stats = { dropped: 0, eaten: 0, dissolved: 0 };
  let elapsed = 0;
  let serial = 0;
  const water = new THREE.Vector3();
  const stir = new THREE.Vector3();
  const stirring = flow;
  const spin = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const size = new THREE.Vector3();
  const instance = new THREE.Matrix4();

  // A pinch scatters: a few pellets land within a body length of each other, each entering
  // the water a few tens of milliseconds after the last, which desynchronises every timer
  // downstream of them for free. Depth is chosen here rather than taken from the pointer,
  // which can only give two dimensions, and is kept in the open water so a fish can reach
  // every pellet without fighting the glass.
  function drop(point, count = PELLET.perPinch, { inWater = false } = {}) {
    let at = elapsed;
    const aimed = Number.isFinite(point.z);
    for (let i = 0; i < count; i++) {
      if (pellets.length + pending.length >= PELLET.capacity) break;
      at += range(PELLET.stagger[0], PELLET.stagger[1]) * (inWater ? 0.4 : 1);
      pending.push({
        at,
        y: inWater ? point.y + range(-0.25, 0.25) : null,
        x: THREE.MathUtils.clamp(
          point.x + range(-PINCH.x, PINCH.x),
          TANK.minX + 0.5,
          TANK.maxX - 0.5,
        ),
        z: aimed
          ? THREE.MathUtils.clamp(point.z + range(-PINCH.z, PINCH.z), TANK.minZ + 0.5, TANK.maxZ - 0.5)
          : range(PINCH.minZ, PINCH.maxZ),
      });
    }
  }

  function spawn({ x, y, z }) {
    const inWater = y !== null && y !== undefined;
    if (inWater)
      y = THREE.MathUtils.clamp(y, groundHeight(x, z) + REACH.aboveBed, FILM - REACH.belowFilm);
    const lingering = !inWater && random() < PELLET.lingerChance;
    const colour = FLAKE_COLOURS[Math.floor(random() * FLAKE_COLOURS.length)];
    const pellet = {
      serial: serial++,
      position: new THREE.Vector3(x, inWater ? y : FILM, z),
      velocity: new THREE.Vector3(),
      // How much a fish has already pushed this pellet about. One pass, or one missed
      // strike, can only move it so far; the allowance comes back over several seconds,
      // so a pellet the shoal keeps working at does travel, but nothing can shove it
      // across the tank in one go.
      shoved: 0,
      kick: new THREE.Vector3(),
      radius: range(PELLET.radius[0], PELLET.radius[1]),
      shape: new THREE.Vector3(range(0.8, 1.2), 1, range(0.6, 1.0)),
      angle: range(0, Math.PI * 2),
      spin: range(PELLET.spin[0], PELLET.spin[1]) * (random() < 0.5 ? -1 : 1),
      tint: new THREE.Color().setHSL(
        colour[0] + range(-0.012, 0.012),
        colour[1] * range(0.85, 1.05),
        colour[2] * range(0.85, 1.1),
      ),
      // The fluttering fall: a swing along one direction in the horizontal, turning slowly
      // as the flake yaws, with the flake tipped toward the end of each swing.
      sway: range(PELLET.sway[0], PELLET.sway[1]),
      swayRate: range(PELLET.swayRate[0], PELLET.swayRate[1]),
      swing: range(0, Math.PI * 2),
      tip: range(PELLET.tip[0], PELLET.tip[1]),
      tilt: 0,
      roll: range(-0.25, 0.25),
      sink: range(PELLET.sink[0], PELLET.sink[1]),
      // How long this pellet lasts from the moment it touches the water, whatever it is
      // doing when the time comes. A pellet that draws a long float can reach the end of
      // its life still on the surface and break up there without ever having sunk, which
      // is what a dry pellet that never properly wets actually does.
      bornAt: elapsed,
      life: range(PELLET.life[0], PELLET.life[1]),
      wetAt: inWater
        ? elapsed
        : lingering
          ? elapsed + range(PELLET.linger[0], PELLET.linger[1])
          : elapsed + PELLET.float[0] + exponential(PELLET.float[1]),
      bob: range(0, Math.PI * 2),
      settledAt: 0,
      gone: false,
      eatenAt: 0,
    };
    if (inWater)
      // Thrown loose from the fingers: a little spread before the water takes over.
      pellet.kick.set(range(-1, 1), range(-0.4, 0.5), range(-1, 1)).multiplyScalar(0.35);
    pellets.push(pellet);
    stats.dropped++;
    if (onSplash) onSplash(pellet.position, inWater);
    return pellet;
  }

  const floating = (pellet) => elapsed < pellet.wetAt;
  const settled = (pellet) => pellet.settledAt > 0;

  // Taken into a fish's mouth. The pellet closes over about an eighth of a second rather
  // than popping, so the frame in which it disappears is the frame the jaws shut.
  function take(pellet) {
    if (pellet.gone || pellet.eatenAt) return false;
    pellet.eatenAt = elapsed;
    pellet.gone = true;
    stats.eaten++;
    return true;
  }

  // A passing bow wave, a missed strike, or the water a fish moves picking at the sand.
  // Only a fish can do this; the tank's own current is far too slow.
  function nudge(pellet, direction, amount) {
    if (pellet.gone) return;
    const room = Math.max(0, PELLET.shoveLimit - pellet.shoved);
    const shove = Math.min(amount, room);
    if (shove <= 0) return;
    pellet.shoved += shove;
    pellet.kick.addScaledVector(direction, shove * RESUSPENSION.drag);
    pellet.settledAt = 0;
  }

  function remove(index) {
    const last = pellets.pop();
    if (index < pellets.length) pellets[index] = last;
  }

  function update(dt, time) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    elapsed += dt;
    while (pending.length && pending[0].at <= elapsed) spawn(pending.shift());
    for (let i = pellets.length - 1; i >= 0; i--) {
      const pellet = pellets[i];
      const { position, velocity } = pellet;
      if (pellet.eatenAt) {
        if (elapsed - pellet.eatenAt > PELLET.swallow) remove(i);
        continue;
      }
      const floor = groundHeight(position.x, position.z) + pellet.radius * 0.15;
      const held = floating(pellet);
      shelteredVelocity(position, time, water, thickets);
      if (stirring) water.add(stirring.sample(position, stir));
      velocity.copy(water).add(pellet.kick);
      if (held) velocity.y = 0;
      else if (settled(pellet)) velocity.set(0, 0, 0);
      else {
        // Fluttering down: fastest through the middle of each swing, slowest and briefly
        // gliding level at the ends of it, where the flake is tipped furthest.
        pellet.swing += dt * pellet.swayRate * Math.PI * 2 * 0.5;
        const across = Math.cos(pellet.swing);
        velocity.y -= pellet.sink * (0.55 + 0.9 * across * across);
        const yaw = pellet.angle;
        velocity.x += Math.cos(yaw) * Math.sin(pellet.swing) * pellet.sway;
        velocity.z += Math.sin(yaw) * Math.sin(pellet.swing) * pellet.sway;
      }
      pellet.kick.multiplyScalar(Math.exp(-dt * RESUSPENSION.drag));
      pellet.shoved *= Math.exp(-dt / RESUSPENSION.recovery);
      position.addScaledVector(velocity, dt);
      if (position.x > TANK.maxX) {
        pellet.gone = true;
        stats.dissolved++;
        remove(i);
        continue;
      }
      position.x = Math.max(position.x, TANK.minX);
      position.z = THREE.MathUtils.clamp(position.z, TANK.minZ, TANK.maxZ);
      if (held) {
        pellet.bob += dt * PELLET.bobRate;
        position.y = FILM + Math.sin(pellet.bob) * PELLET.bob;
      } else if (position.y <= floor) {
        position.y = floor;
        if (!settled(pellet)) pellet.settledAt = elapsed;
      }
      // Rotation carries on while the pellet falls and damps out once it is lying on the
      // sand.
      const turning = settled(pellet)
        ? Math.max(0, 1 - (elapsed - pellet.settledAt) / RESUSPENSION.settleTime)
        : 1;
      pellet.angle += dt * pellet.spin * turning * (held ? 0.2 : 1);
      // Tipped with the swing while falling; flat on the film and on the sand.
      const tipping = !held && !settled(pellet) ? pellet.tip * Math.sin(pellet.swing) : 0;
      pellet.tilt += (tipping - pellet.tilt) * (1 - Math.exp(-dt * 8));
      // Softening and breaking apart. Real extruded food lasts minutes to hours and is
      // mostly broken down by being mouthed; this is far quicker, so that a long session
      // does not silt the sand up with litter and the tank always comes back to clean
      // water on its own.
      if (elapsed - pellet.bornAt > pellet.life) {
        pellet.gone = true;
        stats.dissolved++;
        remove(i);
      }
    }
    for (let i = 0; i < pellets.length; i++) {
      const pellet = pellets[i];
      const swallow = pellet.eatenAt
        ? Math.max(0, 1 - (elapsed - pellet.eatenAt) / PELLET.swallow)
        : 1;
      // Thinning away over the whole of its life, so a pellet is visibly going before it
      // goes and none of them wink out at full size.
      const fading =
        1 - 0.5 * Math.min(1, (elapsed - pellet.bornAt) / pellet.life);
      euler.set(pellet.roll * (settled(pellet) ? 0.4 : 1), -pellet.angle, pellet.tilt, "YXZ");
      spin.setFromEuler(euler);
      size.copy(pellet.shape).multiplyScalar(pellet.radius * swallow * fading);
      instance.compose(pellet.position, spin, size);
      mesh.setMatrixAt(i, instance);
      mesh.setColorAt(i, pellet.tint);
    }
    mesh.count = pellets.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (pellets.length) mesh.instanceColor.needsUpdate = true;
  }

  return {
    drop,
    update,
    glow,
    pellets,
    take,
    nudge,
    floating,
    settled,
    stats,
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

// One flake: a thin, ragged-edged sliver, lying flat. Every flake is this shape, stretched
// and turned differently, which at the size they are seen is all the variety needed.
function flakeGeometry() {
  const random = randomGenerator(55127);
  const sides = 9;
  const positions = [0, 0, 0];
  const normals = [0, 1, 0];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (random() - 0.5) * 0.35;
    const r = 0.7 + random() * 0.35;
    positions.push(Math.cos(a) * r, (random() - 0.5) * 0.08, Math.sin(a) * r);
    normals.push(0, 1, 0);
  }
  const indices = [];
  for (let i = 0; i < sides; i++) indices.push(0, 1 + ((i + 1) % sides), 1 + i);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}
