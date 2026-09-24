import { qualityName, frameRate } from "../../shared/render-policy.js";
import { installControls, reportSceneError } from "../../shared/controls.js";
import * as THREE from "three";
import { installUnderwaterFog } from "./fog.js";
import { CAMERA, CENTER, ORBIT, SURFACE_Y, radial } from "./layout.js";
import { LIGHT_DIRECTION, river, swayCanopy, waterTime } from "./water.js";
import { createEnvironment } from "./environment.js";
import { createPlants } from "./plants.js";
import { createFishSchool } from "./fish.js";
import { createFood } from "./food.js";
import { createCaustics } from "./caustics.js";
import { createFlowField } from "./flow.js";
import { createRipples, createSurface } from "./surface.js";
import { createParticles } from "./particles.js";
import { createPost } from "./post.js";
import { createCruisers } from "./cruisers.js";
import { createRay } from "./stingray.js";
import { createCorydoras } from "./corydoras.js";
import { createCritters } from "./critters.js";
import { createDaylight } from "./daylight.js";
import { createRiverSound } from "./sound.js";
import { bedHeight as groundHeight, randomGenerator, smoothstep } from "./math.js";
import { createFrameLoop } from "../../shared/frame-loop.js";
import { installSoftShadows, shadowFrame } from "./shadows.js";
import { renderSettings, framebufferSize } from "./render-policy.js";

const canvas = document.querySelector("#scene");
const habitat = document.querySelector("#habitat");
const loading = document.querySelector("#loading");
// A page that says the host owns its motion leaves the system's reduced-motion preference
// to the host, which is the only one that can offer a way back: the wallpaper never sees a
// key. The preview keeps the preference itself, where Space can clear it.
let paused =
  document.documentElement.dataset.motion !== "host" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const query = new URLSearchParams(location.search);
const wallpaper = document.documentElement.dataset.motion === "host";
// The browser has frame time to spare, so it starts on Detail; the wallpaper stays lean.
function startingQuality() {
  if (query.get("quality") === "reference") return "reference";
  let saved = null;
  try {
    saved = localStorage.getItem("habitat-quality");
  } catch {}
  const asked = query.get("quality") || saved;
  if (asked) return qualityName(asked);
  return wallpaper ? "balanced" : "detail";
}
let profile = startingQuality();
if (query.get("still") === "1") paused = true;
let onBattery = false;
// Development: ?taa=0 turns the temporal resolve off, for comparison.
const taaOff = new URLSearchParams(location.search).get("taa") === "0";
const policy = (options) => {
  const result = renderSettings(options);
  if (taaOff) result.taa = false;
  return result;
};
let settings = policy({ profile, wallpaper, pixelRatio: devicePixelRatio });
let requestedRate = wallpaper ? 0 : 60;
let loop = null,
  applyPower = null,
  updateControls = () => {};
window.habitatPause = (value) => {
  paused = Boolean(value);
  loop?.setPaused(paused);
  updateControls();
};
window.habitatRate = (fps) => {
  requestedRate = Number.isFinite(fps) && fps > 0 ? Math.min(120, fps) : 0;
  loop?.setRate(frameRate(qualityName(profile), requestedRate, onBattery));
  updateControls();
};
window.habitatPower = (battery) => {
  const next = Boolean(battery);
  if (next === onBattery) return;
  onBattery = next;
  settings = policy({ profile, wallpaper, pixelRatio: devicePixelRatio, onBattery });
  applyPower?.();
  loop?.setRate(frameRate(qualityName(profile), requestedRate, onBattery));
  updateControls();
};
let sprinkle = null;
window.habitatFeed = () => {
  if (sprinkle && loop?.state.running) sprinkle();
};

async function start() {
  installUnderwaterFog();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: settings.powerPreference,
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Soft, contact-hardening shadows where the temporal resolve can smooth their sampling.
  if (settings.taa && query.get("pcss") !== "0")
    installSoftShadows({
      blockerSamples: settings.detail ? 16 : 6,
      filterSamples: settings.detail ? 24 : 10,
    });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // The in-scattered light of the water for a level look; the fog model does the rest.
  const WATER = new THREE.Color(0.045, 0.15, 0.2);
  scene.background = WATER.clone();
  scene.fog = new THREE.FogExp2(WATER.clone(), 0.017);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, CAMERA.near, CAMERA.far);
  camera.position.set(...CAMERA.position);
  camera.lookAt(...CAMERA.target);
  // Development: ?view=x,y,z,tx,ty,tz looks from somewhere else and holds still there.
  const view = query.get("view")?.split(",").map(Number);
  const viewFixed = view?.length === 6 && view.every(Number.isFinite);
  if (viewFixed) {
    camera.position.set(view[0], view[1], view[2]);
    camera.lookAt(view[3], view[4], view[5]);
  }
  // The viewer drifts round the clearing, a full turn every few minutes, rising and
  // falling a little and coming a little nearer and further as it goes. ?orbit=0 holds
  // the first view; ?angle= starts somewhere else round the circle (degrees).
  const orbit = {
    angle: THREE.MathUtils.degToRad(Number(query.get("angle")) || 0),
    speed: 0,
    enabled: !viewFixed && query.get("orbit") !== "0",
    period: wallpaper ? ORBIT.wallpaperPeriod : ORBIT.period,
  };
  const lookAt = new THREE.Vector3();
  function placeCamera() {
    // Development: habitatDebug.orbit.look = { position, target } holds any view.
    if (orbit.look) {
      camera.position.copy(orbit.look.position);
      camera.lookAt(orbit.look.target);
      return;
    }
    const a = orbit.angle;
    const reach = ORBIT.radius + 1.1 * Math.sin(3 * a + 0.4);
    const rise = 0.45 * Math.sin(2 * a + 1.1);
    camera.position.set(
      CENTER.x + Math.sin(a) * reach,
      ORBIT.height + rise,
      CENTER.z + Math.cos(a) * reach,
    );
    lookAt.set(CENTER.x, ORBIT.lookHeight + 0.4 * rise, CENTER.z);
    camera.lookAt(lookAt);
  }
  if (!viewFixed) placeCamera();

  // The sun, arriving through the surface already bent toward the vertical. The sky's
  // light comes down from everywhere above; light scattered back off the sand and the
  // water around the viewer fills from below and in front.
  // Light in clear, shallow water comes from everywhere: shadows under the grass stay soft
  // and green rather than going black.
  const SKY = 1.15;
  const SUN = 9.5;
  const sky = new THREE.HemisphereLight(0x94d2e2, 0x8a8466, SKY);
  scene.add(sky);
  const SUN_COLOR = new THREE.Color(1.0, 0.95, 0.84);
  const key = new THREE.DirectionalLight(SUN_COLOR, SUN);
  // The shadow map covers the clearing and the viewer's whole circle round it.
  const sunTarget = new THREE.Vector3(CENTER.x, 0, CENTER.z);
  key.position.copy(sunTarget).addScaledVector(LIGHT_DIRECTION, 34);
  key.target.position.copy(sunTarget);
  key.castShadow = true;
  key.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
  Object.assign(key.shadow.camera, {
    left: -25,
    right: 25,
    top: 25,
    bottom: -25,
    near: 2,
    far: 64,
  });
  key.shadow.bias = -0.00018;
  key.shadow.normalBias = 0.05;
  const shadowRadius = Math.max(2, Math.round((2.5 * settings.shadowSize) / 4096));
  key.shadow.radius = shadowRadius;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xb7dde0, 0.38);
  fill.position.set(2, 3, 16);
  scene.add(fill);

  // What the fish's silver sides mirror: the bright window overhead fading to blue-green
  // water all round and the pale bed below.
  const envScene = new THREE.Scene();
  const envSphere = new THREE.Mesh(
    new THREE.SphereGeometry(10, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir; void main(){
        float up = vDir.y;
        vec3 water = mix(vec3(0.07, 0.17, 0.17), vec3(0.2, 0.42, 0.42), smoothstep(-0.2, 0.5, up));
        vec3 bed = vec3(0.32, 0.3, 0.22);
        vec3 c = mix(bed, water, smoothstep(-0.55, -0.1, up));
        c += vec3(3.4, 3.6, 3.4) * smoothstep(0.72, 0.9, up);
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  );
  envScene.add(envSphere);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02, 0.1, 30);
  // Only the fish mirror it: lighting the whole river with it would flatten every shadow.
  const mirrored = [];
  const mirrorFish = (object) => {
    object.traverse((child) => {
      for (const material of [child.material].flat()) {
        if (!material || !("envMap" in material)) continue;
        material.envMap = env.texture;
        material.envMapIntensity = 0.6;
        material.needsUpdate = true;
        mirrored.push(material);
      }
    });
  };
  pmrem.dispose();
  envSphere.geometry.dispose();
  envSphere.material.dispose();

  const caustics = createCaustics(renderer, { size: settings.detail ? 768 : 512, grid: settings.detail ? 220 : 170 });
  const flow = createFlowField();
  const ripples = createRipples();
  const { obstacles, landmarks } = await createEnvironment(scene, { detail: settings.detail });
  const plants = createPlants(scene, {
    ...settings,
    animatedShadows: profile !== "reference",
  });
  const particles = createParticles(scene, { flow, ripples, plants, detail: settings.detail });
  const splash = new THREE.Vector3();
  const food = createFood(scene, {
    thickets: plants.thickets,
    flow,
    onSplash(position, inWater) {
      ripples.add(position.x, position.z, inWater ? 0.35 : 0.75);
      // A little air goes down with each flake and comes straight back up; a pinch pushed
      // under by hand takes a good deal more with it.
      const count = inWater ? 1 : 2;
      for (let i = 0; i < count; i++)
        particles.bubble(
          inWater
            ? splash.set(position.x + (Math.random() - 0.5) * 0.4, position.y + Math.random() * 0.3, position.z + (Math.random() - 0.5) * 0.4)
            : splash.set(position.x, SURFACE_Y - 0.15 - Math.random() * 0.3, position.z),
          (inWater ? 0.018 : 0.012) + Math.random() * 0.016,
          0.08,
        );
    },
  });
  let serpae = null;
  const fish = createFishSchool(scene, {
    obstacles,
    landmarks,
    thickets: plants.thickets,
    food,
    flow,
    particles,
    strangers: () => serpae?.fish ?? [],
  });
  // A second, smaller shoal of a redder kind.
  serpae = createFishSchool(scene, {
    obstacles,
    landmarks,
    thickets: plants.thickets,
    food,
    flow,
    particles,
    species: "serpae",
    count: settings.detail ? 16 : 10,
    offset: new THREE.Vector3(0.5, 0.8, 5.2),
    strangers: () => fish.fish,
  });
  const cruisers = createCruisers(scene, { obstacles, flow, food, ripples, particles, detail: settings.detail });
  const dourado = createCruisers(scene, {
    obstacles,
    flow,
    particles,
    detail: settings.detail,
    species: "salminus",
    prey: () => fish.fish.concat(serpae.fish),
  });
  const ray = createRay(scene, { flow, particles, food });
  const corydoras = createCorydoras(scene, { flow, food, particles, detail: settings.detail });
  const critters = createCritters(scene, { flow, food, particles, ripples, detail: settings.detail });
  const surface = createSurface(scene, { reflections: settings.reflections });
  for (const name of ["Silver-blue freshwater fish", "Attached translucent fish fins", "Serpae tetras", "Serpae tetra fins"])
    mirrorFish(scene.getObjectByName(name));
  for (const mesh of [...cruisers.meshes, ...dourado.meshes]) mirrorFish(mesh);

  const post = createPost(renderer, camera, settings);

  let contextLost = false,
    zeroSize = false,
    forceShadows = true;
  const maxDimension = Math.min(
    renderer.capabilities.maxTextureSize,
    renderer.getContext().getParameter(renderer.getContext().MAX_RENDERBUFFER_SIZE),
  );
  function visibility() {
    loop?.setHidden(document.hidden || contextLost || zeroSize);
    updateControls();
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    settings = policy({ profile, wallpaper, pixelRatio: devicePixelRatio, onBattery });
    const dimensions = framebufferSize(
      bounds.width,
      bounds.height,
      settings.resolution,
      maxDimension,
      settings.maxPixels,
    );
    zeroSize = !dimensions;
    visibility();
    if (!dimensions) return;
    const { width, height, scale } = dimensions;
    if (post.main.width !== width || post.main.height !== height) {
      renderer.setSize(width, height, false);
      post.setSize(width, height, scale);
      camera.aspect = bounds.width / bounds.height;
      camera.updateProjectionMatrix();
      particles.setPixelScale(height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
      forceShadows = true;
      loop?.invalidate();
    }
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(habitat);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", visibility);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    visibility();
  });
  canvas.addEventListener("webglcontextrestored", () => location.reload());
  applyPower = () => {
    forceShadows = true;
    resize();
  };
  resize();

  // ------------------------------------------------------------------------------------
  // The viewer's hand. The pointer is a hand in the water in front of the fish: they read
  // where it is and how fast it is coming at them, and a hand held still for a moment
  // draws the curious ones over. Moving it stirs the water all along the line of sight --
  // the grass under it bends, drift swirls, a low sweep kicks up silt, and near the top
  // of the picture it ruffles the surface into rings.
  let pointer = null,
    lastPointerTime = 0;
  const pointerPosition = new THREE.Vector3();
  const pointerSample = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  // The hand is held in a plane facing the viewer, a little in front of the middle of the
  // clearing, wherever round it the viewer has drifted.
  const handPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -2);
  const viewForward = new THREE.Vector3(0, 0, -1);
  const viewRight = new THREE.Vector3(1, 0, 0);
  const handPoint = new THREE.Vector3();
  function faceTheViewer() {
    viewForward.set(CENTER.x - camera.position.x, 0, CENTER.z - camera.position.z).normalize();
    viewRight.set(-viewForward.z, 0, viewForward.x);
    handPoint.set(CENTER.x, 0, CENTER.z).addScaledVector(viewForward, -4.5);
    handPlane.setFromNormalAndCoplanarPoint(handPoint.clone().set(-viewForward.x, 0, -viewForward.z), handPoint);
  }
  faceTheViewer();
  const surfacePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), SURFACE_Y);
  const ndc = new THREE.Vector2();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();
  const surfaceHit = new THREE.Vector3();
  function aim(event) {
    const bounds = canvas.getBoundingClientRect();
    ndc.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  }
  canvas.addEventListener("pointermove", (event) => {
    const ray = aim(event);
    rayOrigin.copy(ray.origin);
    rayDirection.copy(ray.direction);
    if (ray.intersectPlane(handPlane, pointerPosition)) {
      const now = performance.now();
      if (pointer) {
        const seconds = Math.max(0.004, (now - lastPointerTime) / 1000);
        pointerSample.subVectors(pointerPosition, pointer.position).divideScalar(seconds);
        pointer.velocity.lerp(pointerSample, 0.5);
        pointer.position.copy(pointerPosition);
      } else
        pointer = {
          position: pointerPosition.clone(),
          velocity: new THREE.Vector3(),
          still: 0,
          origin: new THREE.Vector3(),
          direction: new THREE.Vector3(),
        };
      pointer.origin.copy(rayOrigin);
      pointer.direction.copy(rayDirection);
      lastPointerTime = now;
    }
  });
  canvas.addEventListener("pointerleave", () => {
    pointer = null;
  });

  // Clicking the surface in the picture scatters a pinch of flakes on it there. Clicking
  // the water pushes the pinch straight under where the click is, so it is in view at
  // once: most of the surface above the near water is out of the picture.
  const dropPoint = new THREE.Vector3();
  const FEED_REACH = 12.5;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary || !loop?.state.running) return;
    const ray = aim(event);
    if (ray.intersectPlane(surfacePlane, dropPoint) && radial(dropPoint.x, dropPoint.z) < 22)
      food.drop(dropPoint);
    else {
      // An arm's length into the picture -- nearer than the hand that stirs, so the fish
      // come up close to feed -- or wherever the line of sight meets the sand first.
      let t = 4;
      for (; t < FEED_REACH; t += 0.25) {
        ray.at(t, dropPoint);
        if (dropPoint.y < groundHeight(dropPoint.x, dropPoint.z) + 0.9) break;
      }
      ray.at(t, dropPoint);
      dropPoint.y = THREE.MathUtils.clamp(dropPoint.y, groundHeight(dropPoint.x, dropPoint.z) + 0.9, SURFACE_Y - 0.35);
      food.drop(dropPoint, undefined, { inWater: true });
      // The air the fingers take down with them, in a burst that rises back to the film,
      // and the water they push aside.
      for (let i = 0; i < 18; i++)
        particles.bubble(
          splash.set(
            dropPoint.x + (Math.random() - 0.5) * 0.5,
            dropPoint.y + (Math.random() - 0.3) * 0.5,
            dropPoint.z + (Math.random() - 0.5) * 0.5,
          ),
          0.022 + Math.random() * 0.04,
          0.05,
        );
      flow.inject(dropPoint, splash.set(0, -0.6, 0), 1.2, 0.5);
    }
  });
  // The menu's pinch goes onto the surface just beyond the middle of the clearing, the
  // nearest part of the film the viewer can see, somewhere new each time.
  const scatter = randomGenerator(715249);
  sprinkle = () => {
    const ahead = 7 + scatter() * 4,
      across = (scatter() - 0.5) * 9;
    dropPoint
      .set(CENTER.x, SURFACE_Y, CENTER.z)
      .addScaledVector(viewForward, ahead)
      .addScaledVector(viewRight, across);
    food.drop(dropPoint);
  };

  const stirPoint = new THREE.Vector3();
  const stirVelocity = new THREE.Vector3();
  const ground = new THREE.Vector3();
  let rippleClock = 0,
    puffClock = 0;
  function stir(dt) {
    if (!pointer) return;
    const speed = pointer.velocity.length();
    pointer.still = speed < 0.35 ? pointer.still + dt : 0;
    if (speed < 0.25) return;
    // Along the line of sight through the water the viewer can reach, strongest in the
    // middle distance. Farther along the ray the same movement on screen is a faster one
    // in the water, so the stir is scaled with distance, up to what a hand could do.
    const reference = rayOrigin.distanceTo(pointer.position);
    const gain = Math.min(1, (speed - 0.25) / 1.5);
    for (let t = 4; t < 34; t += 1.3) {
      stirPoint.copy(pointer.origin).addScaledVector(pointer.direction, t);
      const across = radial(stirPoint.x, stirPoint.z);
      if (across > 19 || stirPoint.y > SURFACE_Y || stirPoint.y < -0.5) continue;
      const weight = Math.exp(-((across / 12) ** 2));
      stirVelocity.copy(pointer.velocity).multiplyScalar(Math.min(2.2, t / reference));
      stirVelocity.clampLength(0, 6);
      flow.inject(stirPoint, stirVelocity, 1.25, 0.4 * weight * gain);
    }
    // A fast sweep low over the bed lifts silt where the line of sight meets the sand.
    puffClock -= dt;
    if (speed > 2.4 && puffClock <= 0) {
      for (let t = 6; t < 34; t += 0.5) {
        ground.copy(pointer.origin).addScaledVector(pointer.direction, t);
        if (ground.y < environmentHeight(ground)) {
          if (radial(ground.x, ground.z) < 18) {
            particles.puff(ground, Math.round(4 + speed * 2), Math.min(1, speed / 6), 0.35);
            puffClock = 0.12;
          }
          break;
        }
      }
    }
    // And near the top of the picture it catches the surface.
    rippleClock -= dt;
    if (speed > 0.6 && rippleClock <= 0) {
      const ray = new THREE.Ray(pointer.origin, pointer.direction);
      if (ray.intersectPlane(surfacePlane, surfaceHit) && radial(surfaceHit.x, surfaceHit.z) < 36) {
        ripples.add(surfaceHit.x, surfaceHit.z, Math.min(0.7, 0.2 + speed * 0.1));
        rippleClock = 0.16;
      }
    }
  }
  const environmentHeight = (p) => groundHeight(p.x, p.z);

  // The river's sound, in the browser only: a wallpaper stays silent.
  const sound = wallpaper ? null : createRiverSound();
  if (sound) {
    let announced = false;
    const wake = () => {
      sound.start();
      if (!announced && sound.enabled) {
        announced = true;
        showHint("Sound on · M mutes");
      }
    };
    document.addEventListener("pointerdown", wake);
    document.addEventListener("keydown", (event) => {
      if (event.code !== "KeyM") wake();
    });
    setInterval(() => sound.hush(!loop?.state.running), 400);
  }

  // ------------------------------------------------------------------------------------
  // Steering a fish from the keyboard (the browser only; the wallpaper never gets keys).
  const held = new Set();
  const STEER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
  const hint = document.createElement("div");
  hint.className = "steer-hint";
  hint.setAttribute("role", "status");
  hint.hidden = true;
  habitat.append(hint);
  let hintTimer = 0;
  function showHint(text) {
    if (wallpaper) return;
    hint.textContent = text;
    hint.hidden = false;
    hint.style.opacity = "1";
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hint.style.opacity = "0";
      hintTimer = setTimeout(() => (hint.hidden = true), 600);
    }, 4200);
  }
  const marker = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: ringTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
      fog: false,
    }),
  );
  marker.scale.setScalar(1.25);
  marker.renderOrder = 10;
  marker.matrixAutoUpdate = true;
  scene.add(marker);
  let markerGlow = 0;
  function applySteer(dash) {
    const x = (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0);
    const y = (held.has("ArrowUp") ? 1 : 0) - (held.has("ArrowDown") ? 1 : 0);
    const length = Math.hypot(x, y) || 1;
    fish.setSteer(x / length, y / length, dash);
  }
  document.addEventListener("keydown", (event) => {
    if (event.target.closest?.("button,select,input,textarea,a,[contenteditable]")) return;
    if (event.code === "Escape" && fish.player) {
      fish.release();
      held.clear();
      showHint("The fish swims off on its own again.");
      return;
    }
    if (event.code === "KeyM" && !event.repeat && sound) {
      const on = sound.toggle();
      showHint(on ? "Sound on · M mutes" : "Sound off · M turns it on");
      return;
    }
    if (event.code === "KeyO" && !event.repeat && !viewFixed) {
      orbit.enabled = !orbit.enabled;
      showHint(orbit.enabled ? "Drifting round the clearing · O holds still" : "Holding still · O drifts on");
      return;
    }
    if (!STEER_KEYS.has(event.code)) {
      if (event.key === "Shift") applySteer(true);
      return;
    }
    event.preventDefault();
    if (!fish.player) {
      // One of the fish in the middle of the picture and not too far off.
      const projected = new THREE.Vector3();
      fish.takeControl((f) => {
        projected.copy(f.position).project(camera);
        return (
          Math.abs(projected.x) < 0.75 &&
          Math.abs(projected.y) < 0.75 &&
          projected.z < 1 &&
          f.position.distanceTo(camera.position) < 26
        );
      });
      markerGlow = 3;
      showHint("You are steering a bloodfin tetra · arrows swim · Shift dashes · Esc lets go");
    }
    held.add(event.code);
    applySteer(event.shiftKey);
  });
  document.addEventListener("keyup", (event) => {
    if (STEER_KEYS.has(event.code)) held.delete(event.code);
    if (fish.player) applySteer(event.shiftKey);
  });
  window.addEventListener("blur", () => {
    held.clear();
    if (fish.player) applySteer(false);
  });

  updateControls = installControls({
    habitat,
    isPaused: () => paused,
    isRunning: () => Boolean(loop?.state.running),
    pause: window.habitatPause,
    feed: window.habitatFeed,
    quality: () => (profile === "reference" ? "detail" : profile),
    setQuality(value) {
      // The planting, the particles and the passes are built for a quality, so a new one
      // is a fresh start of the scene.
      const next = qualityName(value);
      if (next === profile) return;
      try {
        localStorage.setItem("habitat-quality", next);
      } catch {}
      const url = new URL(location.href);
      url.searchParams.set("quality", next);
      location.replace(url);
    },
  });

  scene.traverse((object) => {
    if (object === marker) return;
    object.updateMatrix();
    object.matrixAutoUpdate = false;
  });
  scene.updateMatrixWorld(true);

  // Passing cloud: now and then the sun dims for half a minute, the net on the sand
  // fades, the shafts go out, and then it all comes back.
  const sunLight = new THREE.Vector3();
  function sunAt(t) {
    // Clear to begin with; a cloud comes over only when both slow waves crest together,
    // a few times an hour.
    const n = 0.5 + 0.3 * Math.sin(t * 0.031 - 1.2) + 0.2 * Math.sin(t * 0.0173 - 0.6);
    return 1 - 0.6 * smoothstep(0.8, 0.97, n);
  }

  const daylight = createDaylight({ wallpaper, query });
  const keyColor = new THREE.Color();
  const DUSK_COLOR = new THREE.Color(1.0, 0.62, 0.34);
  const MOON_COLOR = new THREE.Color(0.55, 0.68, 1.0);
  const MOON = 1.1;
  const SKY_COLOR = sky.color.clone();
  const DUSK_SKY = new THREE.Color(0xd9a070);
  const NIGHT_SKY = new THREE.Color(0x3a5a96);
  const DUSK_WINDOW = new THREE.Color(1.0, 0.66, 0.42);
  const DUSK_WATER = new THREE.Color(0.12, 0.15, 0.11);
  const NIGHT_WATER = new THREE.Color(0.004, 0.014, 0.03);
  // Raindrops take a little air down with them: fine bubbles just under the film, over
  // the part of the river in view.
  let dropClock = 0;
  const dropAt = new THREE.Vector3();
  function rainfall(dt, rain) {
    if (rain < 0.05) return;
    dropClock += dt * 40 * rain;
    while (dropClock > 1) {
      dropClock -= 1;
      const a = Math.random() * Math.PI * 2,
        r = Math.sqrt(Math.random()) * 18;
      dropAt.set(CENTER.x + Math.cos(a) * r, SURFACE_Y - 0.1 - Math.random() * 0.5, CENTER.z + Math.sin(a) * r);
      particles.bubble(dropAt, 0.01 + Math.random() * 0.018, 0.02);
    }
  }

  let time = 0,
    lastShadowTime = -Infinity,
    renderedFrames = 0,
    shadowFrames = 0;
  let ready = false;
  const creatures = [];
  function renderFrame(dt, now) {
    const total = Math.min(0.1, dt);
    const steps = Math.max(1, Math.round(total * 60));
    const step = total / steps;
    creatures.length = 0;
    for (const c of cruisers.creatures) creatures.push(c);
    for (const c of dourado.creatures) creatures.push(c);
    creatures.push(ray.creature);
    // The viewer's drift: eased in and out, and brought to a stop while a fish is being
    // steered, so the arrow keys keep meaning the same directions on screen.
    if (!viewFixed) {
      const wanted = orbit.enabled && !fish.player ? (Math.PI * 2) / orbit.period : 0;
      orbit.speed += (wanted - orbit.speed) * (1 - Math.exp(-total / 2.5));
      // Clockwise, seen from above.
      orbit.angle = (((orbit.angle - orbit.speed * total) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      placeCamera();
    }
    faceTheViewer();
    fish.setSteerBasis(viewRight, viewForward, camera.position);
    for (let i = 0; total > 0 && i < steps; i++) {
      time += step;
      waterTime.value = time;
      food.update(step, time);
      fish.update(step, time, pointer, { creatures });
      serpae.update(step, time, pointer, { creatures });
      cruisers.update(step, time, pointer, camera.position);
      dourado.update(step, time, pointer, camera.position);
      ray.update(step, time, pointer);
      corydoras.update(step, time, pointer, creatures);
      critters.update(step, time, pointer, creatures);
    }
    if (pointer && now - lastPointerTime > 60) pointer.velocity.multiplyScalar(Math.exp(-dt * 12));
    stir(total);
    flow.update(total);
    particles.update(total, time);
    ripples.update(total);
    surface.update(total, time, flow);

    // The time of day, the weather, and what the light does with them.
    const day = daylight.update(total);
    const rain = day.rain;
    rainfall(total, rain);
    // Cloud: passing clouds, and the grey of a shower.
    const cloud = sunAt(time) * (1 - 0.62 * rain);
    const sunUp = day.daylight;
    // By day the key light is the sun, warming toward its ends; by night the moon, faint and
    // blue, and it still casts its net and shadows.
    keyColor.copy(SUN_COLOR).lerp(DUSK_COLOR, day.golden * 0.85).lerp(MOON_COLOR, 1 - sunUp);
    key.color.copy(keyColor);
    key.intensity = SUN * (0.3 + 0.7 * cloud) * (sunUp + 0.45 * day.golden) + MOON * day.moon * (1 - 0.6 * rain);
    const ambient = 0.07 + 0.93 * sunUp;
    sky.intensity = SKY * (0.8 + 0.2 * cloud) * ambient;
    sky.color.copy(SKY_COLOR).lerp(DUSK_SKY, day.golden * 0.6).lerp(NIGHT_SKY, 1 - sunUp);
    const net = (sunUp + 0.4 * day.golden) * cloud + 0.4 * day.moon * (1 - rain);
    river.causticParams.value.y = Math.min(1, net);
    river.causticParams.value.w = 1 - 0.55 * rain;
    swayCanopy(time);
    particles.uniforms.sun.value = sunUp * cloud;
    surface.uniforms.sun.value = sunUp * cloud + 0.25 * day.moon;
    surface.uniforms.sunColor.value.copy(keyColor);
    surface.uniforms.skyLevel.value.setRGB(1, 1, 1).lerp(DUSK_WINDOW, day.golden * 0.8).multiplyScalar(0.02 + 0.98 * sunUp).multiplyScalar(1 - 0.45 * rain);
    surface.uniforms.night.value = 1 - sunUp;
    surface.uniforms.rain.value = rain;
    surface.uniforms.roughness.value = 1 + 0.6 * rain;
    caustics.uniforms.roughness.value = 0.9 + 0.15 * Math.sin(time * 0.05) + 0.5 * rain;
    // The water's own glow is the light scattered in it: warm-green in the evening, a
    // deep blue by moonlight.
    scene.fog.color.copy(WATER).lerp(DUSK_WATER, day.golden * 0.6).multiplyScalar((0.75 + 0.25 * cloud) * (0.06 + 0.94 * sunUp + 0.3 * day.golden));
    scene.fog.color.lerp(NIGHT_WATER, (1 - sunUp) * 0.8);
    scene.background.copy(scene.fog.color);
    sunLight.set(keyColor.r, keyColor.g, keyColor.b).multiplyScalar(key.intensity * 0.55 * ((sunUp + 0.5 * day.golden) * cloud + 0.35 * day.moon));
    // The eye adjusts: a night view is brought up, though never to day.
    renderer.toneMappingExposure = 1 + 1.1 * (1 - sunUp);
    for (const material of mirrored) material.envMapIntensity = 0.6 * (0.08 + 0.92 * sunUp);
    food.glow.value = 0.42 * (0.12 + 0.88 * sunUp);
    sound?.update(total, { rain, daylight: sunUp, stir: pointer ? pointer.velocity.length() / 4 : 0 });

    // Where the steered fish is, for anyone looking for it.
    if (fish.player) {
      marker.position.copy(fish.player.position);
      markerGlow = Math.max(markerGlow - total, held.size ? 0.35 : 0);
      marker.material.opacity = Math.min(1, markerGlow) * 0.55;
    } else marker.material.opacity = 0;

    caustics.render();
    const refreshShadow = forceShadows || time - lastShadowTime + 1e-7 >= 1 / settings.shadowHz;
    renderer.shadowMap.needsUpdate = refreshShadow;
    if (refreshShadow) {
      lastShadowTime = time;
      forceShadows = false;
      shadowFrames++;
    }
    renderer.info.reset();
    camera.updateMatrixWorld();
    post.jitter();
    if (settings.taa) shadowFrame(key, shadowRadius, renderedFrames);
    renderer.setRenderTarget(post.main);
    renderer.render(scene, camera);
    post.render({ light: key, sunLight, density: scene.fog.density });
    renderedFrames++;
    if (!ready) {
      ready = true;
      loading.style.opacity = 0;
      setTimeout(() => {
        loading.hidden = true;
      }, 850);
    }
  }
  loop = createFrameLoop(renderFrame, {
    fps: frameRate(qualityName(profile), requestedRate, onBattery),
    paused,
    hidden: document.hidden || zeroSize || contextLost,
  });
  updateControls();
  window.habitatStats = () => ({
    profile,
    onBattery,
    resolution: settings.resolution,
    framebuffer: [post.main.width, post.main.height],
    shadowSize: settings.shadowSize,
    renderedFrames,
    shadowFrames,
    simulationTime: time,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    plants: { ...plants.stats },
    fish: fish.getTelemetry(),
    loop: loop.state,
  });
  // Development handles, only when asked for.
  if (query.get("capture") || query.get("diagnostics") === "1")
    window.habitatDebug = { sound, daylight, fish, serpae, dourado, corydoras, critters, food, flow, particles, ripples, cruisers, ray, camera, scene, river, post, renderer, caustics, key, orbit, placeCamera, THREE };
  // Development: render one frame at a chosen size and hand it to a local capture helper.
  if (query.get("capture")) {
    window.habitatCapture = async (name = "frame", width = 1920, height = 1080, inspect = null) => {
      const bounds = canvas.getBoundingClientRect();
      renderer.setSize(width, height, false);
      post.setSize(width, height, width / bounds.width);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      particles.setPixelScale(height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
      forceShadows = true;
      // Held still, so the temporal resolve can gather its full set of samples.
      for (let i = 0; i < (settings.taa ? 16 : 1); i++) renderFrame(0, performance.now());
      const image = canvas.toDataURL("image/jpeg", 0.92);
      const inspected = inspect ? inspect({ post, renderer }) : null;
      post.main.setSize(1, 1);
      resize();
      await fetch(`/__capture/${name}`, { method: "POST", body: image });
      return inspected ?? name;
    };
    // A fixed-step recording: the loop is paused and each frame advances the river by
    // exactly one step, whatever the capture itself costs. `script(i)` may poke the scene.
    window.habitatRecord = async (prefix, frames, width = 1280, height = 720, fps = 30, script = null) => {
      window.habitatPause(true);
      const bounds = canvas.getBoundingClientRect();
      renderer.setSize(width, height, false);
      post.setSize(width, height, width / bounds.width);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      particles.setPixelScale(height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
      forceShadows = true;
      for (let i = 0; i < frames; i++) {
        if (script) await script(i);
        renderFrame(1 / fps, performance.now());
        const image = canvas.toDataURL("image/jpeg", 0.9);
        await fetch(`/__capture/${prefix}_${String(i).padStart(4, "0")}`, { method: "POST", body: image });
      }
      post.main.setSize(1, 1);
      resize();
      window.habitatPause(false);
      return frames;
    };
  }
  if (query.get("diagnostics") === "1") {
    const { installDiagnostics } = await import("../../shared/diagnostics.js");
    installDiagnostics({ renderer, loop, renderFrame, stats: window.habitatStats });
  }
  window.addEventListener("pagehide", () => loop.setHidden(true));
  window.addEventListener("pageshow", visibility);
}

// A soft ring, drawn once, that marks the steered fish for a moment.
function ringTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const gradient = g.createRadialGradient(64, 64, 34, 64, 64, 62);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.55, "rgba(220,255,245,0.9)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

start().catch(reportSceneError);
