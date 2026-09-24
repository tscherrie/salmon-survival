import * as THREE from "three";
import { installUnderwaterFog } from "../../riverscape/src/fog.js";
import { LIGHT_DIRECTION, river as waterUniforms, swayCanopy, waterLitShader, waterTime } from "../../riverscape/src/water.js";
import { createCaustics } from "../../riverscape/src/caustics.js";
import { createRipples } from "../../riverscape/src/surface.js";
import { createPost } from "../../riverscape/src/post.js";
import { installSoftShadows, shadowFrame } from "../../riverscape/src/shadows.js";
import { renderSettings } from "../../riverscape/src/render-policy.js";
import { createDaylight } from "../../riverscape/src/daylight.js";
import { framebufferSize, qualityName } from "../../shared/render-policy.js";
import { reportSceneError } from "../../shared/controls.js";
import { COURSE_VERSION, FALLS, MOUTH, REDD, S, TRIBUTARIES, bed, coolingAt, frame, gusts, level, locate, passSlot, place, poolAt, regionName, regionWeights, relaid, section, setSeasonFlow, driftRich } from "./course.js";
import { createFlowField } from "./flowfield.js";
import { createBedMaterial, createRockMaterials, createSky, photoTextures, photosLoaded, createSurfaceMaterial,skyUniforms, surfaceUniforms } from "./materials.js";
import { createTerrain } from "./terrain.js";
import { treeUniforms } from "./forest.js";
import { STAGES, createSalmon, phaseOf, stageOf } from "./salmon.js";
import { createLife } from "./life.js";
import { createFalls } from "./falls.js";
import { createHud } from "./hud.js";
import { createSave, savedStage } from "./save.js";
import { createSound } from "./sound.js";
import { createPebbles } from "./pebbles.js";
import { COATS, MODEL_LENGTH, createFishMesh } from "./anatomy.js";
import { isDesktop, showIntro, showPhoneNotice } from "./intro.js";
import { MONTHS, conditions, forceYear, thermal, updateConditions, waterTemperature } from "./seasons.js";
import { createNets } from "./nets.js";
import { CATALOGUE, createLogbook } from "./logbook.js";
import { createMinimap } from "./minimap.js";
import { createBadges } from "./badges.js";
import { COUNTER, FARM, createFeatures } from "./features.js";
import { createPlaces } from "./places.js";
import { createEvents } from "./events.js";
import { lang, startTranslation, t as translate } from "./i18n.js";
import { track } from "./track.js";
import { profile as prof } from "./profile.js";
import { createCelebration } from "./celebrate.js";
import { createLore } from "./lore.js";
import { createTouch } from "./touch.js";
import { createBrood, word as broodWord, formatNumber } from "./brood.js";
import { createLifeCard } from "./lifecard.js";
import { createSiblings } from "./siblings.js";
import { createDrive } from "./drive.js";
import { createBaitBall } from "./baitball.js";
import { createScent } from "./scent.js";
import { createRedd } from "./redd.js";
import { TRAITS, STEP, earned, heritage, inherit, loadHeritage, resetHeritage, traits as heritageTraits } from "./heritage.js";

// English over the German, unless the player chose German.
startTranslation();

// Salmon Survival: the life of one salmon, from the gravel of the spring where it hatches,
// down the brook and the river to the sea, and back up again to spawn where it began.

const canvas = document.querySelector("#scene");
const habitat = document.querySelector("#habitat");
const loading = document.querySelector("#loading");
const query = new URLSearchParams(location.search);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Development runs (the capture harness, a jump to a stage or place) skip the title card.
const dev = ["capture", "diagnostics", "stage", "at", "pace", "season", "year"].some((k) => query.has(k));
// On a phone or a tablet (or with ?touch): the touch controls, a lighter picture, the HUD
// laid out for a small screen held sideways.
const touchMode = query.has("touch") || (!dev && !isDesktop());
if (touchMode) habitat.classList.add("touch");
function savedStageName() {
  const saved = savedStage();
  if (!saved || !STAGES[saved.stage]) return null;
  return `${STAGES[saved.stage].name}${saved.generation ? ` · Generation ${saved.generation + 1}` : ""}`;
}

async function start() {
  // How long the way to the title card's button takes, step by step (performance marks,
  // read back with performance.getEntriesByType("mark")).
  performance.mark("salmon:start");
  // The title card goes up at once and waits for the river to be built.
  const intro = dev ? null : showIntro({ resume: savedStageName() });
  const profile = qualityName(query.get("quality") || (touchMode ? "balanced" : "detail"));
  // The game's budget: the full-detail look, but the shafts marched in fewer, jittered
  // steps (the temporal blend smooths them just as well) and at most ~2.4 million pixels
  // drawn -- the rest is filled in by the upscale, and the frame rate is what matters here.
  // On a phone: as sharp as its screen (every pixel of it, up to about 3.7 million -- the
  // resolution steps down by itself when frames run long), a smaller shadow
  // map, fewer steps in the light shafts, plain shadow edges.
  const gameSettings = () => {
    const base = renderSettings({ profile, pixelRatio: devicePixelRatio });
    if (touchMode) return { ...base, resolution: Math.min(devicePixelRatio || 1, 3), shaftSteps: Math.min(base.shaftSteps, 10), maxPixels: 3.7e6, shadowSize: Math.min(base.shadowSize, 1024) };
    return { ...base, shaftSteps: Math.min(base.shaftSteps, 24), maxPixels: Math.min(base.maxPixels, 2.4e6) };
  };
  let settings = gameSettings();
  installUnderwaterFog();
  // (?pcss=blocker,filter overrides the soft shadows' sample counts, for measuring.)
  const pcss = (query.get("pcss") || "").split(",").map(Number);
  if (settings.taa && !touchMode) installSoftShadows({ blockerSamples: pcss[0] || (settings.detail ? 16 : 6), filterSamples: pcss[1] || (settings.detail ? 24 : 10), frustum: 44 });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // A startup mark with what the graphics card holds so far.
  const mark = (name) => performance.mark(`salmon:${name}`, { detail: { programs: renderer.info.programs?.length ?? 0, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries } });

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0.05, 0.14, 0.14);
  scene.background = fogColor.clone();
  scene.fog = new THREE.FogExp2(fogColor.clone(), 0.02);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.03, 900);

  const SKY = 1.15,
    SUN = 9.5,
    MOON = 1.1;
  const sky = new THREE.HemisphereLight(0x9ccfe0, 0x7a7a60, SKY);
  scene.add(sky);
  const SUN_COLOR = new THREE.Color(1.0, 0.95, 0.86);
  const key = new THREE.DirectionalLight(SUN_COLOR, SUN);
  key.castShadow = true;
  key.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
  Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 2, far: 90 });
  key.shadow.bias = -0.00018;
  key.shadow.normalBias = 0.05;
  const shadowRadius = Math.max(2, Math.round((2.5 * settings.shadowSize) / 4096));
  key.shadow.radius = shadowRadius;
  scene.add(key, key.target);

  // What silver flanks mirror: the water round the fish, bright above, dim below.
  const envScene = new THREE.Scene();
  envScene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(10, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vDir; void main(){
          float up = vDir.y;
          vec3 water = mix(vec3(0.06, 0.15, 0.16), vec3(0.2, 0.4, 0.42), smoothstep(-0.2, 0.5, up));
          vec3 c = mix(vec3(0.26, 0.25, 0.2), water, smoothstep(-0.55, -0.1, up));
          c += vec3(3.4, 3.6, 3.5) * smoothstep(0.72, 0.9, up);
          gl_FragColor = vec4(c, 1.0);
        }`,
      }),
    ),
  );
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02, 0.1, 30);
  pmrem.dispose();
  const mirrored = new Set();
  const mirror = (meshes) => {
    for (const mesh of meshes)
      for (const material of [mesh.material].flat()) {
        if (!("envMap" in material) || mirrored.has(material)) continue;
        material.envMap = env.texture;
        material.envMapIntensity = 0.6;
        mirrored.add(material);
      }
  };

  const caustics = createCaustics(renderer, { size: settings.detail ? 768 : 512, grid: settings.detail ? 220 : 170 });
  const ripples = createRipples();
  const skyDome = createSky(scene);
  mark("setup");
  const [bedMaterial, rocks] = await Promise.all([createBedMaterial(), createRockMaterials()]);
  mark("textures");
  const surfaceMaterial = createSurfaceMaterial();
  const terrain = createTerrain(scene, { bedMaterial, surfaceMaterial, rocks, detail: settings.detail });
  const pebbles = createPebbles(scene);
  // The special places: islands, side brooks, caves ... built as the fish comes near.
  const features = createFeatures(scene, { rocks, locate, surfaceMaterial });
  terrain.extras.push(features);
  mark("terrain");
  const featureEvents = [];
  let liceExposure = 0,
    liceUntil = -1,
    counterLast = null;

  // ------------------------------------------------------------------------------------
  // The fish, and where it is in its life.
  const pace = Number(query.get("pace")) || 1;
  const salmon = createSalmon(scene, { pace });
  const fish = salmon.fish;
  mark("salmon");
  const save = createSave();
  const at = {};
  let cameraReady = false;
  function startAt(s, u = 0, height = 0.5, yaw = null) {
    place(s, u, at);
    const lv = level(s);
    const floor = bed(s, u);
    frame(s, at);
    const heading = yaw ?? Math.atan2(at.tz, at.tx);
    const p = place(s, u, {});
    salmon.place(new THREE.Vector3(p.x, lerp(floor, lv, height), p.z), heading);
    if (cameraReady) {
      look.yaw = fish.yaw;
      look.pitch = 0;
      cameraRiver.s = fish.river.s;
      placeCamera(0, true);
    }
  }
  // A saved place: where it was, if the river still runs as it did then; otherwise the
  // same distance down the river (from before river positions were saved: the nearest
  // river), brought back into the water.
  function restore(entry) {
    const sameRiver = entry.course === COURSE_VERSION && Number.isFinite(entry.u);
    if (sameRiver) {
      salmon.place(new THREE.Vector3(...entry.position), entry.yaw);
      return;
    }
    // (A fish saved on the river as it was first laid out: the same place on the new one.)
    let s = entry.course === 4 && Number.isFinite(entry.s) ? relaid(entry.s) : entry.s,
      u = entry.u;
    if (!Number.isFinite(s)) {
      const found = locate(entry.position[0], entry.position[2], null, {});
      s = found.s;
      u = found.u;
    }
    s = clamp(s, S.redd, S.coast + S.seaReach * 0.8);
    const c = section(Math.min(s, S.coast));
    u = s < S.coast ? clamp(Number.isFinite(u) ? u : c.thalweg, c.thalweg - c.half * 0.6, c.thalweg + c.half * 0.6) : clamp(u ?? 0, -S.seaSide * 0.8, S.seaSide * 0.8);
    frame(Math.min(s, S.straight - 1), at);
    startAt(s, u, s <= S.redd + 1 ? 0.02 : 0.45, Math.atan2(at.tz, at.tx));
  }
  const state = save.load();
  let checkpoint;
  if (state && !query.has("new")) {
    salmon.setStage(state.stage, state.progress);
    fish.energy = state.energy;
    fish.stomach = state.stomach ?? 0;
    restore(state);
    checkpoint = state.checkpoint;
  } else {
    // A new life: in the gravel of the redd, facing down the pool.
    salmon.setStage(0, 0);
    startAt(S.redd, section(S.redd).thalweg, 0.02);
    checkpoint = null;
  }
  // Development: ?stage=parr (or a number) and ?at=5200 (an s) to start elsewhere.
  if (query.has("stage")) {
    const id = query.get("stage");
    const index = Number.isFinite(Number(id)) ? Number(id) : stageOf(id);
    salmon.setStage(Math.max(0, index), Number(query.get("progress")) || 0);
  }
  if (query.has("at")) startAt(Number(query.get("at")), Number(query.get("u")) || 0, 0.5);
  // Development: ?season=winter (or ?year=0.05, a fraction of the year) holds the time of year.
  const SEASON_YEAR = { spring: 0.37, summer: 0.58, autumn: 0.8, winter: 0.05 };
  if (query.has("season") || query.has("year")) forceYear(SEASON_YEAR[query.get("season")] ?? Number(query.get("year")));
  if (!checkpoint) checkpoint = snapshotCheckpoint();
  // The brood this fish is one of (src/brood.js). A life saved from before there were
  // broods: its siblings thinned out to the stage it has reached.
  const brood = createBrood(state && !query.has("new") ? state.brood : null);
  // What this line of salmon has from its parents (heritage.js).
  loadHeritage(state && !query.has("new") ? state.heritage : null);
  if (!(state && state.brood)) brood.reached(fish.stage, STAGES);
  function snapshotCheckpoint() {
    return { stage: fish.stage, position: fish.position.toArray(), yaw: fish.yaw, s: fish.river.s, u: fish.river.u, course: COURSE_VERSION };
  }
  mirror(salmon.meshes);

  const life = createLife(scene, { detail: settings.detail, terrain, salmon });
  mirror(life.meshes);
  mark("life");
  const falls = createFalls(scene);
  // Brothers and sisters of the same brood, each on its own, somewhere near.
  const siblings = createSiblings(scene);
  const nets = createNets(scene);
  const hud = createHud({ stages: STAGES });
  const showBrood = () => hud.brood("", broodWord("broodLine", { left: formatNumber(brood.left), size: formatNumber(brood.size) }));
  showBrood();
  const lore = createLore({ hud });
  const loreRegions = {};
  const sound = createSound();
  mark("hud");
  // Badges for everything found and done the first time; the logbook keeps the collection.
  const badges = createBadges({ sound });
  for (const st of STAGES.slice(1)) badges.register(`stage:${st.id}`, stageBadge(st));
  function stageBadge(st) {
    return { group: "Lebensstadien", title: st.name, line: "Ein neues Lebensstadium", icon: "stage", tier: ["smolt", "sea", "spawner"].includes(st.id) ? "gold" : "silver", kicker: "Gewachsen" };
  }
  const FEATS = {
    net: { group: "Meisterstücke", title: "Ausbrecher", line: "Aus dem Stellnetz gerissen", icon: "feat", tier: "silver" },
    hidden: { group: "Meisterstücke", title: "Unsichtbar", line: "Vor einem Jäger versteckt", icon: "hunter", tier: "bronze" },
    school: { group: "Meisterstücke", title: "Im Schwarm", line: "Mit den Smolts gezogen", icon: "fish", tier: "silver" },
    decoy: { group: "Meisterstücke", title: "Glück gehabt", line: "Der Räuber nahm einen anderen", icon: "feat", tier: "bronze" },
    generation: { group: "Meisterstücke", title: "Der Kreis schließt sich", line: "Eine neue Generation", icon: "stage", tier: "gold" },
    bully: { group: "Meisterstücke", title: "Raufbold", line: "Einen Fisch in die Flucht geschlagen", icon: "fish", tier: "bronze" },
    counted: { group: "Meisterstücke", title: "Gezählt", line: "An der Zählstation erfasst", icon: "feat", tier: "silver" },
    lice: { group: "Meisterstücke", title: "Verlaust", line: "Lachsläuse von der Farm eingefangen", icon: "hunter", tier: "bronze" },
    storm: { group: "Erlebnisse", title: "Sturmfest", line: "Eine Sturzflut überstanden", icon: "feat", tier: "silver" },
    unhooked: { group: "Erlebnisse", title: "Vom Haken", line: "Vom Angelhaken losgerissen", icon: "feat", tier: "gold" },
    otters: { group: "Erlebnisse", title: "Ottergesellschaft", line: "Einer Otterfamilie beim Spielen zugesehen", icon: "hunter", tier: "bronze" },
    floes: { group: "Erlebnisse", title: "Eisgang", line: "Unter treibenden Schollen geschwommen", icon: "feat", tier: "bronze" },
    aurora: { group: "Erlebnisse", title: "Nordlicht", line: "Das Nordlicht über dem Wasser gesehen", icon: "feat", tier: "silver" },
    run: { group: "Erlebnisse", title: "Im Laichzug", line: "Mit den anderen Lachsen heimgezogen", icon: "fish", tier: "silver" },
    drive: { group: "Meisterstücke", title: "Treibjagd", line: "Den Gänsesägern entkommen", icon: "hunter", tier: "gold" },
    ball: { group: "Meisterstücke", title: "Festmahl", line: "Acht Fische aus einem Futterball erbeutet", icon: "fish", tier: "gold" },
    nose: { group: "Meisterstücke", title: "Feine Nase", line: "Den Heimatfluss am Duft gefunden", icon: "feat", tier: "gold" },
  };
  for (const [id, def] of Object.entries(FEATS)) badges.register(`feat:${id}`, def);
  const feat = (id, options) => badges.award(`feat:${id}`, FEATS[id], options);
  for (let i = 1; i <= fish.stage; i++) badges.award(`stage:${STAGES[i].id}`, stageBadge(STAGES[i]), { quiet: true });
  // The places worth finding: found by swimming into them.
  const places = createPlaces({ badges });
  const logbook = createLogbook({ hud, badges, places });
  // (On a phone the map is shown from the start, small and see-through in a corner.)
  const minimap = createMinimap({ logbook, places, shownAtFirst: touchMode });
  let homeShown = false;
  mark("logbook");
  // Development: ?mate shows two made-up companions on the map, the way others would be
  // shown in a game swum together -- one close by, one far up the river.
  const mates = query.has("mate")
    ? (time) => {
        const near = section(fish.river.s);
        const a = place(fish.river.s + 6 + 0.8 * near.half * Math.sin(time * 0.23), near.half * 0.45 * Math.sin(time * 0.37), {});
        const farS = Math.max(20, fish.river.s - 900);
        const b = place(farS, 0, {});
        return [
          { name: "Mia", colour: "#7fe0ff", x: a.x, z: a.z, yaw: fish.yaw + 0.6 * Math.sin(time * 0.5), s: fish.river.s + 6 },
          { name: "Ole", colour: "#ff9ad5", x: b.x, z: b.z, yaw: 0, s: farS },
        ];
      }
    : null;
  let mateTime = 0;
  const post = createPost(renderer, camera, settings);
  mark("post");
  // The night kept short: the clock quickens as the dusk deepens, so the dark lasts a
  // little over four minutes from dusk to dawn (it was nearly six).
  const daylight = createDaylight({ wallpaper: false, query, nightPace: 3.05 });
  // Storms, anglers, otters, ice going out, northern lights.
  const events = createEvents(scene, { rocks, sound, daylight, life, query });
  mark("events");

  // ------------------------------------------------------------------------------------
  // Input. Click the river and the pointer is captured; the mouse turns the fish. W swims,
  // S brakes, A/D slide sideways, Space bursts forward -- and with food marked close ahead
  // strikes at it; at the surface it leaps. Without the pointer, the arrow keys turn.
  // Sound on and off: the button at the top right, or T. The map: M, or the button under
  // the logbook's.
  const soundButton = document.querySelector("#sound-toggle");
  function showSound() {
    const on = sound.enabled;
    soundButton.setAttribute("aria-pressed", String(on));
    soundButton.setAttribute("aria-label", on ? "Ton ausschalten" : "Ton einschalten");
  }
  // The logbook: open it and the swim waits.
  let releasing = false;
  function toggleLogbook() {
    const open = logbook.toggle(fish, save.generation, heritageTraits());
    if (open) {
      releasing = true;
      document.exitPointerLock?.();
      held.clear();
    } else last = performance.now();
    sound.hush(open || userPaused);
  }
  // Pause: P, or leaving the game -- Esc out of fullscreen or out of the captured pointer,
  // another window in front. A click on the river (or P) swims on.
  function setPaused(value) {
    if (userPaused === value) return;
    userPaused = value;
    habitat.classList.toggle("paused", value);
    hud.paused(value, touchMode);
    if (value) touch?.release();
    sound.hush(value || logbook.open);
    held.clear();
    if (!value) last = performance.now();
  }
  // Into the game: full screen (unless F has turned it off) and the pointer captured, when
  // the swim starts and whenever it is taken up again with a click.
  let wantFullscreen = true;
  function capture() {
    if (wantFullscreen && !document.fullscreenElement && habitat.requestFullscreen)
      Promise.resolve(habitat.requestFullscreen({ navigationUI: "hide" }))
        // On a phone, held sideways from then on (where the browser lets a page ask).
        .then(() => touchMode && screen.orientation?.lock?.("landscape"))
        .catch(() => {});
    if (!touchMode) Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
  }
  let wasFullscreen = false;
  document.addEventListener("fullscreenchange", () => {
    const now = !!document.fullscreenElement;
    if (wasFullscreen && !now && !waiting && dead <= 0) setPaused(true);
    // Some browsers let the pointer go on the way into full screen: take it again.
    if (now && !touchMode && !locked() && !waiting && !userPaused && !logbook.open) Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
    wasFullscreen = now;
  });
  document.querySelector("#logbook-toggle").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleLogbook();
    event.currentTarget.blur();
  });
  document.querySelector("#logbook .close").addEventListener("click", () => toggleLogbook());
  document.querySelector("#map-toggle").addEventListener("click", (event) => {
    event.stopPropagation();
    minimap.toggle();
    event.currentTarget.blur();
  });
  soundButton.addEventListener("click", (event) => {
    event.stopPropagation();
    sound.toggle();
    showSound();
    soundButton.blur();
  });
  showSound();
  // Stories and facts on or off (the button, or I).
  const loreButton = document.querySelector("#lore-toggle");
  const showLore = () => loreButton.setAttribute("aria-pressed", String(lore.on));
  function toggleLore() {
    lore.on = !lore.on;
    showLore();
    hud.note(lore.on ? "Geschichten und Fakten an" : "Geschichten und Fakten aus");
  }
  loreButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleLore();
    loreButton.blur();
  });
  showLore();

  const held = new Set();
  const look = { yaw: fish.yaw, pitch: 0 };
  const input = { yaw: 0, pitch: 0, forward: false, brake: false, strafe: 0, lunge: false };
  let lungeQueued = false;
  let userPaused = false;
  let waiting = !!intro;
  let zoom = 1;
  const LOOK_SPEED = 0.0022;
  const locked = () => document.pointerLockElement === canvas;
  window.addEventListener("keydown", (event) => {
    sound.start();
    if (lifecard.open) {
      if ((event.code === "Enter" || event.code === "Space") && !event.repeat) {
        event.preventDefault();
        lifecard.go();
      }
      return;
    }
    if (event.code === "KeyT" && !event.repeat) {
      sound.toggle();
      showSound();
      return;
    }
    if (event.code === "KeyM" && !event.repeat) {
      minimap.toggle();
      return;
    }
    if (event.code === "KeyI" && !event.repeat) {
      toggleLore();
      return;
    }
    if (event.code === "KeyF" && !event.repeat) {
      wantFullscreen = !document.fullscreenElement;
      if (!wantFullscreen) document.exitFullscreen?.();
      else capture();
      return;
    }
    if ((event.code === "KeyL" && !event.repeat) || (event.code === "Escape" && logbook.open)) {
      toggleLogbook();
      return;
    }
    if (logbook.open) return;
    if (event.code === "KeyP" && !event.repeat) {
      setPaused(!userPaused);
      return;
    }
    if (userPaused) return;
    if (event.code === "KeyE" && !event.repeat) {
      goOn();
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat && !startCharge()) lungeQueued = true;
    }
    if (event.code.startsWith("Arrow")) event.preventDefault();
    held.add(event.code);
    hud.touched();
  });
  window.addEventListener("keyup", (event) => {
    held.delete(event.code);
    if (event.code === "Space") releaseCharge();
  });
  window.addEventListener("blur", () => held.clear());
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    sound.start();
    hud.touched();
    if (userPaused) setPaused(false);
    if (!locked()) {
      look.yaw = fish.yaw;
      look.pitch = fish.pitch;
      capture();
      return;
    }
    if (event.button === 0 && !startCharge()) lungeQueued = true;
  });
  canvas.addEventListener("pointerup", (event) => {
    if (event.button === 0) releaseCharge();
  });
  document.addEventListener("pointerlockchange", () => {
    habitat.classList.toggle("locked", locked());
    // The pointer let go by the player (Esc) or taken by another window: pause. Not when
    // the game let it go itself (the logbook).
    if (!locked() && !releasing && !waiting && !logbook.open && dead <= 0) setPaused(true);
    releasing = false;
  });
  document.addEventListener("mousemove", (event) => {
    if (!locked()) return;
    look.yaw += event.movementX * LOOK_SPEED;
    look.pitch = clamp(look.pitch - event.movementY * LOOK_SPEED, -1.2, 1.2);
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      zoom = clamp(zoom * Math.exp(event.deltaY * 0.001), 0.55, 2.4);
      event.preventDefault();
    },
    { passive: false },
  );
  // On a phone: dragging to look and steer, the swim and dash buttons, pause, the map.
  const TOUCH_LOOK = 0.007;
  const touch = touchMode
    ? createTouch({
        habitat,
        onTouch: () => {
          sound.start();
          hud.touched();
          if (!document.fullscreenElement) capture();
        },
        onLunge: () => {
          if (!userPaused && !startCharge()) lungeQueued = true;
        },
        onLungeEnd: () => releaseCharge(),
        onLook: (dx, dy) => {
          look.yaw += dx * TOUCH_LOOK;
          look.pitch = clamp(look.pitch - dy * TOUCH_LOOK, -1.2, 1.2);
        },
        onPause: () => setPaused(true),
      })
    : null;
  // Turned upright mid-swim: pause behind the note asking for it sideways again.
  if (touchMode)
    matchMedia("(orientation: portrait)").addEventListener("change", (event) => {
      if (event.matches && !waiting && dead <= 0) setPaused(true);
    });
  // The salmon fall: the leap is timed. Held, the leap gathers and slackens in a swing (the
  // bar by the fish); let go at the top and it flies highest. Only in reach of its foot.
  const SALMON_FALL = FALLS.find((f) => f.name === "Lachsfall");
  let charge = null;
  let leapPower = 1;
  const meter = document.createElement("div");
  meter.id = "leapmeter";
  meter.hidden = true;
  meter.innerHTML = '<div class="track"><div class="sweet"></div><div class="fill"></div></div><span class="label">Sprungkraft</span>';
  habitat.append(meter);
  const meterFill = meter.querySelector(".fill");
  const swing = (t) => 0.5 - 0.5 * Math.cos((t / 1.2) * Math.PI * 2);
  function inLeapReach() {
    if (!SALMON_FALL || dead > 0 || fish.airborne || celebration.active) return false;
    const d = fish.river.s - SALMON_FALL.s;
    return d > -0.2 && d < 10 + SALMON_FALL.drop * 0.6 + fish.length * 0.8;
  }
  function startCharge() {
    if (charge || !inLeapReach()) return false;
    charge = { t: 0 };
    meter.hidden = false;
    return true;
  }
  function releaseCharge() {
    if (!charge) return;
    const v = swing(charge.t);
    charge = null;
    meter.hidden = true;
    // Only a leap near the top of the swing clears it (with a run at it and strength left);
    // "almost" falls back into the pool.
    leapPower = v > 0.82 ? 1.14 : 0.6 + 0.4 * v;
    lungeQueued = true;
    hud.note(v > 0.82 ? "Perfekter Absprung!" : v < 0.45 ? "Zu schwach!" : "Fast!");
  }
  function stepCharge(dt) {
    if (!charge) return;
    if (!inLeapReach()) {
      charge = null;
      meter.hidden = true;
      return;
    }
    charge.t += dt;
    const v = swing(charge.t);
    meterFill.style.transform = `scaleY(${v.toFixed(3)})`;
    meter.classList.toggle("sweet", v > 0.82);
  }
  // The drive (drive.js): goosanders after the smolt school in the lower river. A bar at the
  // foot of the screen: how far to the rapids, and how many are left in the school.
  const drive = createDrive();
  const driveBar = document.createElement("div");
  driveBar.id = "drivebar";
  driveBar.hidden = true;
  driveBar.innerHTML = '<span class="label">Zur Stromschnelle</span><div class="track"><div class="fill"></div></div><span class="count"><span>Schwarm</span> <b>0</b></span>';
  habitat.append(driveBar);
  const driveFill = driveBar.querySelector(".fill");
  const driveCount = driveBar.querySelector(".count b");
  let driveNagged = -1e9;
  function startDrive() {
    drive.start(fish, life.school.count);
    life.hunters.drive(fish, true);
    driveBar.hidden = false;
    sound.splash(0.9);
    track("drive", { outcome: "start", school: drive.size });
    hud.toast("Treibjagd!", "Gänsesäger jagen den Schwarm. Bleib mittendrin – bis zur Stromschnelle!", 6);
    hud.tip("drive", "<b>Die Treibjagd.</b> Gänsesäger jagen im Trupp: Unter Wasser kreisen sie um den Schwarm und stoßen auf jeden Smolt, der allein schwimmt. Bleib mitten im Schwarm und halt mit ihm Schritt. Hält ein Vogel kurz inne, stößt er gleich zu – dann zur Seite ausweichen oder Spurt (<kbd>Leertaste</kbd>). An der Stromschnelle geben sie auf.", 14);
  }
  // "made": at the rapids; "left": the school went on without the fish; "died".
  function endDrive(how) {
    if (!drive.on) return;
    life.hunters.drive(fish, false);
    drive.stop();
    driveBar.hidden = true;
    track("drive", { outcome: how, left: life.school.count, school: drive.size });
    if (how === "made") {
      hud.toast("Durchgekommen!", `${life.school.count} von ${drive.size} Smolts sind noch bei dir.`, 6);
      feat("drive", { delay: 2 });
    } else if (how === "left") {
      // Gone on down the river without it (others of the run may come by later).
      life.school.reset();
      hud.toast("Allein", "Der Schwarm ist ohne dich weitergezogen.", 5);
    }
  }
  function stepDrive(dt) {
    if (dead <= 0 && phaseOf(fish.stage) === "smolt" && conditions.light > 0.35 && drive.ready(fish, life.school.count)) startDrive();
    const how = drive.update(dt, fish, time, life.hunters.list);
    if (how) endDrive(how);
    if (!drive.on) return;
    driveFill.style.transform = `scaleX(${drive.progress.toFixed(3)})`;
    driveCount.textContent = String(life.school.count);
    // Out on its own: the birds' first choice.
    const alone = drive.apart(fish) > drive.lead.radius;
    driveBar.classList.toggle("alone", alone);
    if (alone && time - driveNagged > 6 && dead <= 0) {
      driveNagged = time;
      hud.note("Bleib im Schwarm!");
    }
  }
  // The bait ball at sea (baitball.js): a bar at the foot of the screen (how long it lasts,
  // how many caught) and a green arrow at the edge pointing the way to it.
  const baitball = createBaitBall(scene);
  const huntBar = document.createElement("div");
  huntBar.id = "huntbar";
  huntBar.hidden = true;
  huntBar.innerHTML = '<span class="label">Heringsball</span><div class="track"><div class="fill"></div></div><span class="count"><span>Erbeutet</span> <b>0</b></span>';
  habitat.append(huntBar);
  const huntLabel = huntBar.querySelector(".label");
  const huntFill = huntBar.querySelector(".fill");
  const huntCount = huntBar.querySelector(".count b");
  let ballShown = false;
  const ballAt = new THREE.Vector3();
  function stepBall(dt) {
    const sea = regionWeights(fish.river.s).sea > 0.8;
    const happened = baitball.update(dt, fish, { ok: dead <= 0 && phaseOf(fish.stage) === "sea" && sea && !fish.captive && fish.length >= 2.6, light: conditions.light, shoals: life.shoals, hunters: life.hunters });
    for (const e of happened) {
      if (e.type === "dive") {
        // A gannet going in: the splash, and its crack under the water.
        const near = clamp(1 - Math.hypot(e.x - fish.position.x, e.z - fish.position.z) / 90, 0.12, 0.9);
        ripples.add(e.x, e.z, 2.4);
        falls.splash(e.x, e.y, e.z, 5);
        sound.splash(near);
      } else if (e.type === "seal") hud.toast("Eine Robbe!", "Sie frisst mit – und hätte auch dich gern.", 5);
    }
    if (baitball.on && !ballShown) {
      ballShown = true;
      huntLabel.textContent = translate(baitball.ball.title);
      huntBar.hidden = false;
      track("ball", { outcome: "start", kind: baitball.ball.kind });
      hud.toast(`${baitball.ball.title}!`, "Basstölpel stoßen hinein – schnapp dir, so viele du kannst!", 6);
      hud.tip("ball", "<b>Ein Futterball!</b> Die Fische ballen sich dicht unter der Oberfläche zusammen, und von oben stoßen Basstölpel hinein. Schwimm hin – der grüne Pfeil zeigt die Richtung – und stoß mit <kbd>Leertaste</kbd> in den Ball: jeder Fang lässt dich wachsen. Bald kommt eine Robbe dazu – im Ball bist du für sie schwerer zu fassen.", 14);
    } else if (!baitball.on && ballShown) endBall(false);
    if (!baitball.on) return;
    huntFill.style.transform = `scaleX(${baitball.left.toFixed(3)})`;
    huntCount.textContent = String(baitball.caught);
  }
  // Over: how many it caught (quietly, when it died in it).
  function endBall(quiet) {
    if (baitball.on) baitball.stop(life.shoals);
    if (!ballShown) return;
    ballShown = false;
    huntBar.hidden = true;
    goal.classList.remove("on");
    if (quiet) return;
    const n = baitball.caught;
    track("ball", { outcome: "end", caught: n, kind: baitball.ball.kind });
    hud.toast(n >= 8 ? "Festmahl!" : "Der Ball zerstiebt", `Erbeutet: ${n}`, 5);
    if (n >= 8) feat("ball", { delay: 1.5 });
  }
  // The green arrow to the ball, when it is off the screen or far.
  const goal = document.createElement("div");
  goal.className = "threat goal";
  goal.innerHTML = '<svg viewBox="0 0 40 26"><path d="M5 22 20 6l15 16" /></svg><span class="name"></span>';
  function goalArrow() {
    if (!goal.parentNode) threatBox.append(goal);
    const b = baitball.ball;
    const show = baitball.on && dead <= 0 && fish.position.distanceTo(b.centre) > b.radius + 10;
    goal.classList.toggle("on", show);
    if (!show) return;
    const w = habitat.clientWidth,
      h = habitat.clientHeight;
    ballAt.copy(b.centre).project(camera);
    let x = ballAt.x * w * 0.5,
      y = -ballAt.y * h * 0.5;
    if (ballAt.z > 1) (x = -x), (y = -y);
    const a = Math.atan2(y, x);
    const px = w * 0.5 + Math.cos(a) * w * 0.4,
      py = h * 0.5 + Math.sin(a) * h * 0.36;
    goal.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    goal.firstChild.style.transform = `rotate(${(a + Math.PI / 2).toFixed(3)}rad)`;
    const name = goal.querySelector(".name");
    if (name.textContent !== translate(b.title)) name.textContent = translate(b.title);
  }
  // The scent of home (scent.js): at sea a spawner finds its river by the smell of the brook
  // it hatched in -- a bar for how strong it is and whether it grows the way it swims; the
  // map shows the mouth only once it is near. In the river, at the fork of the Alder Brook,
  // only one arm smells of home.
  const scent = createScent(scene);
  const scentBar = document.createElement("div");
  scentBar.id = "scentbar";
  scentBar.hidden = true;
  scentBar.innerHTML = '<span class="label">Duft der Heimat</span><div class="track"><div class="fill"></div></div><span class="way"></span>';
  habitat.append(scentBar);
  const scentFill = scentBar.querySelector(".fill");
  const scentWay = scentBar.querySelector(".way");
  let scentWord = "";
  let scentOn = false;
  let noseTime = 0;
  let riverFound = false;
  let strangeSaid = -1e9;
  function stepScent(dt) {
    const spawner = phaseOf(fish.stage) === "spawner" && dead <= 0;
    const atSea = fish.river.s > S.coast - 40;
    const nearFork = TRIBUTARIES[0] && Math.abs(fish.river.s - TRIBUTARIES[0].s) < 160;
    scentOn = spawner && (atSea || nearFork) && !spawning;
    const st = scent.update(dt, fish, time, scentOn && atSea);
    if (!spawner) {
      riverFound = false;
      noseTime = 0;
    }
    // In at the mouth from the sea, by the smell of it.
    if (spawner && !riverFound && fish.river.s < S.coast - 20 && noseTime > 0) {
      riverFound = true;
      hud.toast("Der Heimatfluss!", "Das Wasser riecht nach dem Bach, in dem du geschlüpft bist.", 6);
      if (noseTime > 20) feat("nose", { delay: 2 });
      track("home_river", { seconds: Math.round(noseTime) });
    }
    scentBar.hidden = !scentOn;
    if (!scentOn) return;
    if (atSea) noseTime += dt;
    scentFill.style.transform = `scaleX(${Math.sqrt(clamp(st.home, 0, 1)).toFixed(3)})`;
    const strange = st.foreign > st.home && st.foreign > 0.12;
    const word = strange ? "fremd" : st.home < 0.03 ? "keine Spur" : st.home > 0.95 ? "Heimat" : st.trend > 0.00015 ? "stärker" : st.trend < -0.00015 ? "schwächer" : "gleich";
    scentBar.classList.toggle("strange", strange);
    scentBar.classList.toggle("warmer", word === "stärker" || word === "Heimat");
    if (word !== scentWord) {
      scentWord = word;
      scentWay.textContent = translate(word);
    }
    if (atSea) {
      hud.tip("scent", "<b>Der Duft der Heimat.</b> Jeder Fluss riecht anders – und du erinnerst dich an den Geruch deines Bachs. Such im Meer die Fahne seines Wassers und schwimm dorthin, wo der Duft stärker wird. Die Mündung zeigt dir die Karte erst, wenn du nah dran bist. Vorsicht: Weiter an der Küste mündet ein fremder Fluss.", 15);
      if (strange && time - strangeSaid > 14) {
        strangeSaid = time;
        hud.note("Fremdes Wasser – das ist nicht dein Fluss.");
      }
    } else {
      hud.tip("fork", "<b>Zwei Bäche.</b> Hier mündet der Erlenbach. Nur einer von beiden riecht nach der Kinderstube – folge dem Duft.", 10);
      if (strange && time - strangeSaid > 10) {
        strangeSaid = time;
        hud.note("Das ist nicht dein Bach.");
      }
    }
  }
  // The finale (redd.js): home and ripe, a hen cutting the redd on the gravel of the spring;
  // by her side until she is ready, driving off the other cocks -- then they spawn.
  const redd = createRedd(scene);
  const reddBar = document.createElement("div");
  reddBar.id = "reddbar";
  reddBar.hidden = true;
  reddBar.innerHTML = '<span class="label">An ihrer Seite</span><div class="track"><div class="fill"></div></div><span class="way"></span>';
  habitat.append(reddBar);
  const reddFill = reddBar.querySelector(".fill");
  const reddWay = reddBar.querySelector(".way");
  let reddWord = "";
  let rivalSaid = null;
  function stepRedd(dt) {
    const spawner = phaseOf(fish.stage) === "spawner";
    if (!redd.on) {
      if (spawner && !spawning && dead <= 0 && fish.progress >= 0.99 && Math.hypot(fish.position.x - REDD.x, fish.position.z - REDD.z) < 60) {
        redd.start(fish);
        track("redd", { outcome: "start" });
        hud.toast("Daheim.", "Über dem Kies der Quelle schlägt ein Weibchen die Laichgrube.", 6);
        hud.tip("redd", "<b>Daheim.</b> Ein Weibchen schlägt die Laichgrube: Sie legt sich auf die Seite und schlägt mit dem Schwanz den Kies frei. Bleib an ihrer Seite, bis sie bereit ist. Drängt sich ein anderer Milchner dazu, vertreib ihn mit einem Stoß (<kbd>Leertaste</kbd>) in die Flanke.", 15);
      }
      reddBar.hidden = true;
      return;
    }
    if (!spawner || (dead > 0 && !spawning)) {
      redd.stop();
      reddBar.hidden = true;
      return;
    }
    const happened = redd.update(dt, fish, time);
    const st = redd.state;
    if (happened.driven) {
      shake = Math.max(shake, 0.6);
      sound.thump();
      hud.note("Vertrieben!");
    }
    if (st.rival && rivalSaid !== st.rival) {
      rivalSaid = st.rival;
      hud.note("Ein Rivale ist bei ihr!");
    } else if (!st.rival) rivalSaid = null;
    reddBar.hidden = spawning != null;
    reddFill.style.transform = `scaleX(${st.courtship.toFixed(3)})`;
    const near = fish.position.distanceTo(redd.her.position) < redd.her.size * 0.5 + fish.length * 1.5;
    const word = st.rival ? "Vertreib den Rivalen!" : near ? "bleib bei ihr" : "schwimm zu ihr";
    reddBar.classList.toggle("rival", !!st.rival);
    if (word !== reddWord) {
      reddWord = word;
      reddWay.textContent = translate(word);
    }
    if (st.ready && !spawning && dead <= 0) {
      hud.toast("Sie ist bereit", "Eier und Milch, über dem Kies.", 4);
      track("redd", { outcome: "spawn", rivals: st.drivenOff });
      spawn();
    }
  }
  // The way home, for a spawner: long, and between the places that try it much the same.
  // Where nothing is going on it can go on with the run -- the screen goes dark, a word of
  // where it has got to, and it is just below the next of them. Never past one: each place
  // that tries it (a fall, the fish ladder, the fork at the Erlenbach) it swims itself.
  const GATES = [
    { s: FALLS.find((f) => f.name === "Felsschwelle")?.s, below: 45, name: "Felsschwelle", label: "Weiter bis unter die Felsschwelle" },
    { s: Math.max(...FALLS.filter((f) => f.pass).map((f) => f.s)), below: 55, name: "Fischtreppe", label: "Weiter bis zur Fischtreppe" },
    { s: FALLS.find((f) => f.name === "Steinstufe")?.s, below: 40, name: "Steinstufe", label: "Weiter bis unter die Steinstufe" },
    { s: SALMON_FALL?.s, below: 55, name: "Lachsfall", label: "Weiter bis zum Lachsfall" },
    { s: FALLS.find((f) => f.name === "Bachstufe")?.s, below: 28, name: "Bachstufe", label: "Weiter bis unter die Bachstufe" },
    { s: TRIBUTARIES[0]?.s, below: 90, name: "Erlenbach", label: "Weiter bis zum Erlenbach" },
    { s: S.redd, below: 330, name: "Brutbecken", label: "Weiter bis kurz vor die Quelle" },
  ].filter((g) => Number.isFinite(g.s));
  const journeyBtn = document.createElement("button");
  journeyBtn.id = "journey";
  journeyBtn.type = "button";
  journeyBtn.hidden = true;
  journeyBtn.innerHTML = '<span class="label"></span> <kbd>E</kbd>';
  habitat.append(journeyBtn);
  const journeyLabel = journeyBtn.querySelector(".label");
  journeyBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
  journeyBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    journeyBtn.blur();
    goOn();
  });
  let journeying = null;
  let calmSince = 0;
  // Where the run would take it now: just below the next place up the river, if that is far.
  function journeyTarget() {
    const s = fish.river.s;
    let gate = null;
    for (const g of GATES) if (g.s < s - 5 && (!gate || g.s > gate.s)) gate = g;
    if (!gate) return null;
    const to = gate.s + gate.below;
    return s - to > 500 ? { s: to, gate } : null;
  }
  function goOn() {
    const target = journeyShown && journeyTarget();
    if (!target || journeying) return;
    journeying = { t: 0, target, moved: false };
    fish.safe = true;
    hud.veil("dark");
    journeyBtn.hidden = true;
    journeyShown = false;
    track("journey", { to: target.gate.name });
  }
  let journeyShown = false;
  function stepJourney(dt, threatened) {
    if (journeying) {
      journeying.t += dt;
      if (!journeying.moved && journeying.t > 0.7) {
        journeying.moved = true;
        const s = journeying.target.s;
        const c = section(s);
        // Just below it, in the deep line, facing up the river.
        startAt(s, c.thalweg, 0.45);
        startAt(s, c.thalweg, 0.45, fish.yaw + Math.PI);
        fish.energy = Math.max(0.35, fish.energy - 0.06);
        fish.velocity.set(0, 0, 0);
        fish.relative.set(0, 0, 0);
        lastPlace.copy(fish.position);
        look.yaw = fish.yaw;
        look.pitch = 0;
        cameraRiver.s = fish.river.s;
        placeCamera(0, true);
        post.resetHistory?.();
        terrain.prime({ x: camera.position.x, z: camera.position.z, s: fish.river.s, u: fish.river.u }, { radius: builtRadius(), near: clamp(0.28 + fish.length * 0.1, 0.35, 1), land: 60 });
        features.prime(fish.river.s);
        life.reset(fish);
        nets.reset();
        pebbles.prime(fish.position, fish.length, fish.river.s);
        checkpoint = snapshotCheckpoint();
        hud.toast(journeying.target.gate.name, "Ein paar Tage später, ein gutes Stück flussauf.", 4);
        persist();
      }
      if (journeying.t > 1.7) {
        hud.veil(null);
        fish.safe = false;
        journeying = null;
        calmSince = time;
      }
      return;
    }
    if (threatened) calmSince = time;
    const ok =
      phaseOf(fish.stage) === "spawner" && dead <= 0 && !spawning && fish.river.s < S.straight && !fish.airborne && !fish.captive && !charge && !celebration.active && !drive.on && !baitball.on && !scentOn && time - calmSince > 4;
    const target = ok ? journeyTarget() : null;
    if (!!target !== journeyShown || (target && journeyLabel.dataset.to !== target.gate.name)) {
      journeyShown = !!target;
      journeyBtn.hidden = !target;
      if (target) {
        journeyLabel.dataset.to = target.gate.name;
        journeyLabel.textContent = translate(target.gate.label);
        hud.tip("journey", "<b>Die Heimkehr.</b> Der Weg flussauf ist weit. Wo nichts los ist, kannst du mit dem Laichzug weiterziehen (<kbd>E</kbd>) – bis kurz vor die nächste Stelle, die es in sich hat. Die schaffst du dann selbst.", 12);
      }
    }
  }
  function readInput(dt) {
    const turn =(held.has("ArrowLeft") ? -1 : 0) + (held.has("ArrowRight") ? 1 : 0);
    const tilt = (held.has("ArrowUp") ? 1 : 0) - (held.has("ArrowDown") ? 1 : 0);
    const sp = salmon.speeds();
    look.yaw += turn * sp.turn * dt;
    if (tilt) look.pitch = clamp(look.pitch + tilt * dt * 1.2, -1.2, 1.2);
    if (!locked() && !turn && !tilt && !touchMode) {
      // Without the mouse the view settles back behind the fish.
      look.yaw += Math.atan2(Math.sin(fish.yaw - look.yaw), Math.cos(fish.yaw - look.yaw)) * (1 - Math.exp(-dt * 0.8));
    }
    input.yaw = look.yaw;
    input.pitch = look.pitch;
    // On a phone: the arrow held swims; a dash right after a quick sideways swipe dodges.
    const thumb = touch?.state;
    input.forward = held.has("KeyW") || !!thumb?.forward;
    input.brake = held.has("KeyS");
    input.strafe = (held.has("KeyD") ? 1 : 0) - (held.has("KeyA") ? 1 : 0);
    if (thumb && lungeQueued && thumb.flick) {
      input.strafe = thumb.flick;
      thumb.flick = 0;
    }
    input.lunge = lungeQueued;
    input.power = lungeQueued ? leapPower : 1;
    if (lungeQueued) leapPower = 1;
    lungeQueued = false;
    return input;
  }

  // ------------------------------------------------------------------------------------
  // The camera: behind and a little above the fish, at a distance that grows with it; it
  // stays in the water and out of the stones unless the fish itself is in the air.
  const eye = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const wantEye = new THREE.Vector3();
  const wantAim = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const probe = { s: 0, u: 0 };
  const cameraRiver = { s: fish.river.s, u: 0 };
  let shake = 0;
  let airborneCamera = 0;
  let cameraOverride = null;
  // A spotlight on what the fish has just found for the first time (a new fish, a hunter):
  // a ring round it on the screen and, for a moment, the camera's eye turned toward it.
  const spotlight = { target: new THREE.Vector3(), source: null, t: -1, weight: 0, kind: "" };
  const spotRing = document.createElement("div");
  spotRing.id = "spot";
  spotRing.hidden = true;
  spotRing.innerHTML = '<span class="ring"></span><span class="label"></span>';
  habitat.append(spotRing);
  const spotScreen = new THREE.Vector3();
  function spotUpdate(dt) {
    const found = logbook.spotted;
    if (found) {
      logbook.spotted = null;
      spotlight.source = found.position;
      spotlight.target.copy(found.position);
      spotlight.t = 0;
      const name = CATALOGUE.fish.kinds[found.kind] ?? CATALOGUE.hunters.kinds[found.kind] ?? "";
      spotRing.querySelector(".label").textContent = translate(name);
      spotRing.hidden = false;
    }
    if (spotlight.t < 0) {
      spotlight.weight = 0;
      return;
    }
    spotlight.t += dt;
    if (spotlight.source) spotlight.target.lerp(spotlight.source, 1 - Math.exp(-dt * 6));
    const k = spotlight.t;
    // In over half a second, held, back over a second; only part of the way, so the fish
    // stays in the picture.
    spotlight.weight = 0.6 * smooth(0, 0.6, k) * (1 - smooth(2.2, 3.2, k));
    spotScreen.copy(spotlight.target).project(camera);
    const visible = spotScreen.z < 1 && Math.abs(spotScreen.x) < 1.1 && Math.abs(spotScreen.y) < 1.1;
    spotRing.style.opacity = visible ? String(Math.min(1, k * 3) * (1 - smooth(3.4, 4, k))) : "0";
    spotRing.style.transform = `translate(${((spotScreen.x + 1) / 2) * habitat.clientWidth}px, ${((1 - spotScreen.y) / 2) * habitat.clientHeight}px)`;
    if (k > 4) {
      spotlight.t = -1;
      spotRing.hidden = true;
    }
  }
  // A new stage of life: a few seconds in slow motion while the camera takes a turn round
  // the new fish, with light and a fanfare. The fish is safe while it lasts.
  const glitter = createCelebration(scene);
  const celebration = { active: false, t: 0, duration: 6.5, yaw: 0, scale: 1, spin: 1 };
  function celebrate(stage) {
    const st = STAGES[stage];
    track("stage", { stage: st.id });
    celebration.active = true;
    celebration.t = 0;
    celebration.yaw = fish.yaw;
    celebration.spin = Math.random() < 0.5 ? 1 : -1;
    fish.safe = true;
    held.clear();
    glitter.burst(fish.position, fish.length);
    hud.milestone(stage, stageLine(st), Math.round(fish.length * 10), broodWord("left", { left: formatNumber(brood.left), size: formatNumber(brood.size) }));
    sound.fanfare();
  }
  function endCelebration() {
    celebration.active = false;
    celebration.scale = 1;
    fish.safe = false;
    // Hand the camera back where it is; it eases in behind the fish from there.
    eyeOffset.copy(camera.position).sub(fish.position);
    look.yaw = fish.yaw;
    look.pitch = 0;
    reach = 1;
  }
  // How fast the world runs during the show: easing into slow motion and back out.
  function celebrationScale() {
    if (!celebration.active) return 1;
    const t = celebration.t,
      d = celebration.duration;
    if (t < 0.5) return lerp(1, 0.18, smooth(0, 0.5, t));
    if (t > d - 1.4) return lerp(0.18, 1, smooth(d - 1.4, d, t));
    return 0.18;
  }
  const orbitProbe = { s: 0, u: 0 };
  function orbitCamera() {
    const L = fish.length;
    const k = clamp(celebration.t / celebration.duration, 0, 1);
    const e = k * k * (3 - 2 * k);
    // From behind the fish once round it -- its flank, its face, the other flank -- and home.
    const angle = celebration.yaw + Math.PI + celebration.spin * Math.PI * 2 * e;
    const bump = Math.sin(Math.PI * k);
    const distance = Math.min((L * 1.9 + 0.1) * zoom * (1 - 0.35 * bump), 0.42 / Math.max(scene.fog.density, 0.002));
    const horizontal = distance * 0.92;
    const height = distance * 0.36 * (1 - 0.85 * bump);
    const margin = Math.max(0.04, L * 0.12);
    let chosen = null;
    for (let f = 1; f >= 0.25; f -= 0.075) {
      const x = fish.position.x + Math.cos(angle) * horizontal * f,
        z = fish.position.z + Math.sin(angle) * horizontal * f;
      locate(x, z, cameraRiver.s, orbitProbe);
      const floor = bed(orbitProbe.s, orbitProbe.u);
      const lv = level(orbitProbe.s);
      if (lv - floor < margin * 2.5) continue;
      const y = clamp(fish.position.y + height * f, floor + margin, lv - margin);
      chosen = eye.set(x, y, z);
      break;
    }
    if (!chosen) eye.copy(fish.position).addScaledVector(fish.heading, -L * 1.2).setY(fish.position.y + L * 0.3);
    camera.position.copy(eye);
    aim.copy(fish.position).addScaledVector(fish.heading, L * 0.1);
    camera.lookAt(aim);
    locate(camera.position.x, camera.position.z, cameraRiver.s, cameraRiver);
    const near = clamp(L * 0.06, 0.012, 0.25);
    if (Math.abs(camera.near - near) > near * 0.2) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }
  const eyeOffset = new THREE.Vector3(-1, 0.4, 0);
  const aimOffset = new THREE.Vector3();
  let reach = 1;
  function placeCamera(dt, snap = false) {
    const L = fish.length;
    if (celebration.active && !cameraOverride) {
      orbitCamera();
      return;
    }
    if (cameraOverride) {
      camera.position.copy(cameraOverride.eye);
      camera.lookAt(cameraOverride.target);
      locate(camera.position.x, camera.position.z, cameraRiver.s, cameraRiver);
      camera.near = cameraOverride.near ?? 0.05;
      camera.updateProjectionMatrix();
      return;
    }
    // Behind the fish and above it, looking down its back the way it is steering, so the
    // whole fish shows -- its back, its fins, the beat of its tail -- low in the middle of the
    // picture with the water ahead of it; closer in murky water. The camera's place is kept
    // relative to the fish, so it never falls behind a fish the current is carrying.
    const distance = Math.min((L * 1.9 + 0.1) * zoom, 0.42 / Math.max(scene.fog.density, 0.002));
    dir.set(Math.cos(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.sin(look.yaw) * Math.cos(look.pitch));
    wantEye.copy(dir).multiplyScalar(-distance * 0.92);
    wantEye.y += distance * 0.36;
    wantAim.copy(dir).multiplyScalar(L * 1.2 + 0.05);
    wantAim.y += L * 0.3;
    const follow = snap ? 1 : 1 - Math.exp(-dt * 4);
    eyeOffset.lerp(wantEye, follow);
    aimOffset.lerp(wantAim, snap ? 1 : 1 - Math.exp(-dt * 7));
    wantEye.copy(fish.position).add(eyeOffset);
    wantAim.copy(fish.position).add(aimOffset);
    // Walk out from the fish toward where the camera wants to be. The camera may slide up or
    // down the water column to stay under the surface and off the bed; it comes in closer
    // only where the water runs out (a bank, a bar, the face of a fall) or a stone is in the
    // way.
    const inAir = fish.airborne;
    airborneCamera += ((inAir ? 1 : 0) - airborneCamera) * (1 - Math.exp(-dt * (inAir ? 6 : 2)));
    const margin = Math.max(0.04, L * 0.12);
    // A small fish lives among stones as big as itself: the camera keeps above them, looking
    // down on the fish, where the water is deep enough.
    const clearance = Math.max(margin, Math.min(0.45, 1.3 * L + 0.12));
    const followAir = airborneCamera > 0.05 || fish.position.y > level(fish.river.s);
    let reached = fish.position.clone();
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      const x = lerp(fish.position.x, wantEye.x, t),
        z = lerp(fish.position.z, wantEye.z, t);
      let y = lerp(fish.position.y, wantEye.y, t);
      locate(x, z, cameraRiver.s, probe);
      const floor = bed(probe.s, probe.u);
      const lv = level(probe.s);
      if (!followAir) {
        if (lv - floor < margin * 2.5) break;
        y = clamp(y, Math.min(floor + clearance * t, (floor + lv) / 2), lv - margin);
      } else y = Math.max(y, floor + margin);
      let inStone = false;
      for (const c of stones) {
        const dx = (x - c.x) / c.r,
          dy = (y - c.y) / c.ry,
          dz = (z - c.z) / c.r;
        if (dx * dx + dy * dy + dz * dz < 1.1) {
          inStone = true;
          break;
        }
      }
      if (inStone && t > 0.35) break;
      reached.set(x, y, z);
    }
    // Where the way is blocked the camera comes in at once, and eases back out.
    const out = reached.distanceTo(fish.position) / Math.max(1e-4, wantEye.distanceTo(fish.position));
    reach = snap ? out : out < reach ? out : reach + (out - reach) * (1 - Math.exp(-dt * 2.5));
    eye.copy(fish.position).addScaledVector(reached.sub(fish.position), reach / Math.max(1e-4, out));
    aim.copy(wantAim);
    locate(eye.x, eye.z, cameraRiver.s, cameraRiver);
    const lv = level(cameraRiver.s);
    const floor = Math.min(bed(cameraRiver.s, cameraRiver.u) + clearance * reach, (bed(cameraRiver.s, cameraRiver.u) + lv) / 2);
    eye.y = Math.max(floor, eye.y);
    // Under water unless following a leap.
    if (!followAir) eye.y = Math.min(eye.y, lv - margin * 0.5);
    camera.position.copy(eye);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake * L * 0.2;
      camera.position.y += (Math.random() - 0.5) * shake * L * 0.2;
      shake = Math.max(0, shake - dt * 2);
    }
    // Something new found: the eye turns to it for a moment (spotlight, below).
    if (spotlight.weight > 0.001) aim.lerp(spotlight.target, spotlight.weight);
    camera.lookAt(aim);
    const near = clamp(L * 0.06, 0.012, 0.25);
    if (Math.abs(camera.near - near) > near * 0.2) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------------------------
  // The resolution follows the machine: when frames run long for a couple of seconds the
  // image is drawn a step smaller (and scaled up), and when there is time to spare it
  // climbs back, never straight back to a size that was just too much.
  const frameRate = { average: 1 / 60, slow: 0, fast: 0, scale: 1, ceiling: 1 };
  function adaptResolution(seconds) {
    if (!(seconds > 0 && seconds < 0.25)) return;
    const f = frameRate;
    f.average += (seconds - f.average) * 0.06;
    f.ceiling = Math.min(1, f.ceiling + seconds * 0.002);
    if (f.average > 1 / 46) (f.slow += seconds), (f.fast = 0);
    else if (f.average < 1 / 57) (f.fast += seconds), (f.slow = 0);
    else f.slow = f.fast = 0;
    if (f.slow > 1.5 && f.scale > 0.5) {
      f.ceiling = f.scale * 0.96;
      f.scale = Math.max(0.5, f.scale * 0.85);
      f.slow = 0;
      f.average = 1 / 52;
      resize();
    } else if (f.fast > 6 && f.scale < f.ceiling - 0.01) {
      f.scale = Math.min(f.ceiling, f.scale / 0.9);
      f.fast = 0;
      resize();
    }
  }
  const fpsBox = query.has("fps") ? Object.assign(document.createElement("div"), { id: "fps" }) : null;
  if (fpsBox) document.body.append(fpsBox);

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    settings = gameSettings();
    const size = framebufferSize(bounds.width, bounds.height, settings.resolution * frameRate.scale, 8192, settings.maxPixels * frameRate.scale * frameRate.scale);
    if (!size) return;
    renderer.setSize(size.width, size.height, false);
    post.setSize(size.width, size.height, size.scale);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
    life.setScale(size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
    falls.setScale(size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
  }
  new ResizeObserver(resize).observe(habitat);

  // ------------------------------------------------------------------------------------
  // The water's look by region, eased as the fish moves between them.
  const LOOKS = {
    brook: { fog: [0.05, 0.145, 0.14], density: 0.017, canopy: 0.42, focal: 4, body: [0.02, 0.06, 0.05], tint: [0.95, 0.97, 0.98] },
    upper: { fog: [0.052, 0.145, 0.135], density: 0.018, canopy: 0.28, focal: 7, body: [0.02, 0.06, 0.05], tint: [0.95, 0.96, 0.95] },
    middle: { fog: [0.07, 0.15, 0.115], density: 0.021, canopy: 0.14, focal: 9, body: [0.03, 0.05, 0.035], tint: [0.98, 0.96, 0.9] },
    lower: { fog: [0.1, 0.14, 0.08], density: 0.026, canopy: 0.05, focal: 11, body: [0.04, 0.04, 0.02], tint: [1.0, 0.94, 0.82] },
    estuary: { fog: [0.07, 0.15, 0.13], density: 0.028, canopy: 0, focal: 12, body: [0.03, 0.06, 0.05], tint: [0.95, 0.95, 0.92] },
    sea: { fog: [0.035, 0.18, 0.24], density: 0.011, canopy: 0, focal: 14, body: [0.01, 0.05, 0.08], tint: [0.95, 0.98, 1.0] },
  };
  const lookNow = { fog: new THREE.Color(), density: 0.02, canopy: 0.3, focal: 6, body: new THREE.Color(), tint: new THREE.Color() };
  const weights = {};
  const mix3 = new THREE.Color();
  function regionLook(s, depth) {
    regionWeights(s, weights);
    lookNow.fog.setRGB(0, 0, 0);
    lookNow.body.setRGB(0, 0, 0);
    lookNow.tint.setRGB(0, 0, 0);
    lookNow.density = lookNow.canopy = lookNow.focal = 0;
    let total = 0;
    for (const [name, w] of Object.entries(weights)) {
      if (w <= 0) continue;
      const l = LOOKS[name];
      total += w;
      lookNow.fog.add(mix3.setRGB(...l.fog).multiplyScalar(w));
      lookNow.body.add(mix3.setRGB(...l.body).multiplyScalar(w));
      lookNow.tint.add(mix3.setRGB(...l.tint).multiplyScalar(w));
      lookNow.density += l.density * w;
      lookNow.canopy += l.canopy * w;
      lookNow.focal += l.focal * w;
    }
    lookNow.fog.multiplyScalar(1 / total);
    lookNow.body.multiplyScalar(1 / total);
    lookNow.tint.multiplyScalar(1 / total);
    lookNow.density /= total;
    lookNow.canopy /= total;
    lookNow.focal /= total;
    // Deeper water is darker and bluer.
    const deep = Math.exp(-Math.max(0, depth) * 0.006);
    lookNow.fog.multiply(mix3.setRGB(0.7 + 0.3 * deep, 0.8 + 0.2 * deep, 0.9 + 0.1 * deep)).multiplyScalar(0.35 + 0.65 * deep);
    return lookNow;
  }

  // The shaders' idea of where the surface is: level at the camera, falling along the
  // river, with the nearest fall's step in it.
  function updateWaterLevel() {
    const s = cameraRiver.s;
    const lv = level(s);
    frame(s, at);
    const slope = (level(s + 4) - level(s - 4)) / 8;
    let fall = null;
    for (const f of FALLS) if (!f.head && Math.abs(f.s - s) < 160 && (!fall || Math.abs(f.s - s) < Math.abs(fall.s - s))) fall = f;
    const wl = waterUniforms.waterLevel.value;
    const shape = waterUniforms.waterShape.value;
    const step = waterUniforms.waterStep.value;
    wl.set(camera.position.x, camera.position.z, lv, 0);
    shape.set(at.tx * slope, at.tz * slope, 0, 0.4);
    if (fall) {
      const p = place(fall.s, 0, {});
      const fr = frame(fall.s, {});
      step.set(p.x, p.z, fr.tx, fr.tz);
      shape.z = fall.drop;
      if (s > fall.s) wl.z += fall.drop;
    }
  }

  // ------------------------------------------------------------------------------------
  const keyColor = new THREE.Color();
  const DUSK_COLOR = new THREE.Color(1.0, 0.62, 0.36);
  const MOON_COLOR = new THREE.Color(0.55, 0.68, 1.0);
  const SKY_COLOR = sky.color.clone();
  const NIGHT_SKY = new THREE.Color(0x3a5a96);
  const DUSK_WINDOW = new THREE.Color(1.0, 0.68, 0.46);
  const NIGHT_WATER = new THREE.Color(0.004, 0.014, 0.03);
  const FLOOD_WATER = new THREE.Color(0.11, 0.1, 0.055);
  // A flash flood: brown with the soil it has torn from the banks.
  const MUD_WATER = new THREE.Color(0.15, 0.1, 0.04);
  const AIR = new THREE.Color(0.62, 0.72, 0.8);
  const sunLight = new THREE.Vector3();
  const stones = [];
  let time = 0,
    frames = 0,
    dead = 0,
    saveClock = 0,
    playClock = 0,
    last = performance.now();
  const playMarks = [2, 5, 10, 20, 30, 45, 60, 90, 120, 180];
  // The eddies round the fish (a worker works them out): what the stones do to the current
  // -- felt by the fish, carrying the specks and the drifting food. ?eddies=0 goes without.
  const eddies = query.get("eddies") === "0" ? null : createFlowField({ query });
  const eddyStones = [];
  const gatherStones = (reach) => {
    eddyStones.length = 0;
    terrain.collidersNear(fish.position.x, fish.position.z, reach, eddyStones);
    pebbles.near(fish.position, reach, eddyStones);
    return eddyStones;
  };
  const world = { stones, time: 0, covered: false, eddies };
  // Can a hunter see the fish from where it is? Not through a stone big enough to hide it,
  // nor through the lie of the bed between them. (Weed, reeds and trunks hide it too: that
  // is world.covered.)
  const sightStones = [];
  const sightRiver = { s: 0, u: 0 };
  world.occluded = (from, to, length) => {
    const dx = to.x - from.x,
      dy = to.y - from.y,
      dz = to.z - from.z;
    const half = Math.hypot(dx, dz) / 2;
    sightStones.length = 0;
    terrain.collidersNear((from.x + to.x) / 2, (from.z + to.z) / 2, half + 2, sightStones);
    for (const c of sightStones) {
      // A little less than the stone, so a fish just peeking out past its edge is seen.
      const rx = (c.rx ?? c.r) * 0.9,
        rz = (c.rz ?? c.r) * 0.9,
        ry = c.ry * 0.9;
      if (Math.max(rx, rz) < length * 0.5 || ry < length * 0.2) continue;
      const cs = c.cos ?? 1,
        sn = c.sin ?? 0;
      const ox = from.x - c.x,
        oy = from.y - c.y,
        oz = from.z - c.z;
      // The line of sight in the stone's own frame, the stone a unit sphere.
      const ax = (ox * cs - oz * sn) / rx,
        ay = oy / ry,
        az = (ox * sn + oz * cs) / rz;
      const bx = (dx * cs - dz * sn) / rx,
        by = dy / ry,
        bz = (dx * sn + dz * cs) / rz;
      const bb = bx * bx + by * by + bz * bz;
      if (bb < 1e-9) continue;
      const t = clamp(-(ax * bx + ay * by + az * bz) / bb, 0, 1);
      if (t < 0.02 || t > 0.98) continue;
      const px = ax + bx * t,
        py = ay + by * t,
        pz = az + bz * t;
      if (px * px + py * py + pz * pz < 1) return true;
    }
    // The bed rising between them: a bank, a bar of gravel.
    let hint = fish.river.s;
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      locate(from.x + dx * t, from.z + dz * t, hint, sightRiver);
      hint = sightRiver.s;
      if (from.y + dy * t < bed(sightRiver.s, sightRiver.u) - 0.05) return true;
    }
    return false;
  };
  let eddyCanvas = null,
    eddyClock = 0;
  if (eddies && query.get("eddies") === "debug") {
    eddyCanvas = document.createElement("canvas");
    Object.assign(eddyCanvas.style, { position: "fixed", left: "16px", bottom: "16px", width: "256px", height: "256px", zIndex: 40, imageRendering: "pixelated", borderRadius: "8px", pointerEvents: "none" });
    habitat.append(eddyCanvas);
  }
  let ateSomething = false;
  let windedOnce = false;
  // A death: how long until the next life, and whether the dark has come down yet.
  const DEATH = 4.8;
  // How far round the fish the river is built (a little further where the water is wide),
  // and so how far one can see: the haze must close in before its edge.
  const wideWater = (s) => (s > S.coast ? 1 : smooth(120, 260, section(s).width));
  const builtRadius = () => lerp(clamp(70 + fish.length * 12, 90, 170), 210, regionWeights(fish.river.s).sea) + 30 * wideWater(fish.river.s) * (1 - regionWeights(fish.river.s).sea);
  let richShown = false;
  let fallMet = false;
  // Hunters after the fish: an arrow on a ring round the middle of the screen points to each,
  // yellow when it has noticed the fish, red when it hunts it, pulsing when it is about to
  // strike -- with its name, the first time in a while, over the card.
  const threatBox = document.createElement("div");
  threatBox.id = "threats";
  threatBox.setAttribute("aria-hidden", "true");
  habitat.append(threatBox);
  const arrows = Array.from({ length: 4 }, () => {
    const el = document.createElement("div");
    el.className = "threat";
    el.innerHTML = '<svg viewBox="0 0 40 26"><path d="M5 22 20 6l15 16" /></svg><span class="name"></span>';
    threatBox.append(el);
    return el;
  });
  const threatList = [];
  const threatAt = new THREE.Vector3();
  const warned = new WeakMap();
  function warnings() {
    const list = dead > 0 || celebration.active || fish.safe ? [] : life.hunters.threats(fish, threatList);
    if (list === threatList && redd.on) redd.threats(fish, list);
    list.sort((a, b) => b.level - a.level);
    const w = habitat.clientWidth,
      h = habitat.clientHeight;
    for (let i = 0; i < arrows.length; i++) {
      const el = arrows[i];
      const th = list[i];
      if (!th) {
        el.classList.remove("on", "hunt", "coil");
        continue;
      }
      threatAt.copy(th.position);
      if (th.above) threatAt.y += 6;
      threatAt.project(camera);
      let x = threatAt.x * w * 0.5,
        y = -threatAt.y * h * 0.5;
      // Behind the camera the projection turns over.
      if (threatAt.z > 1) (x = -x), (y = -y);
      const a = Math.atan2(y, x);
      const px = w * 0.5 + Math.cos(a) * w * 0.4,
        py = h * 0.5 + Math.sin(a) * h * 0.36;
      el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      el.firstChild.style.transform = `rotate(${(a + Math.PI / 2).toFixed(3)}rad)`;
      el.style.opacity = (0.4 + 0.6 * th.level).toFixed(2);
      el.classList.add("on");
      el.classList.toggle("hunt", th.level >= 0.7);
      el.classList.toggle("coil", !!th.coiled);
      const name = el.querySelector(".name");
      if (name.textContent !== translate(th.title)) name.textContent = translate(th.title);
      // Its name in words when it starts hunting, once in a while.
      if (th.level >= 0.8 && th.key && time - (warned.get(th.key) ?? -1e9) > 20) {
        warned.set(th.key, time);
        hud.note(`${th.title} jagt dich!`);
      }
      if (th.level >= 0.6)
        hud.tip("warn", "<b>Gefahr!</b> Die Pfeile am Bildrand zeigen, wo dich ein Jäger im Blick hat: gelb – er hat dich bemerkt, rot – er jagt dich. Pulsiert der Pfeil, stößt er gleich zu: jetzt zur Seite ausweichen!", 11);
    }
  }
  let veiled = false;
  const lastPlace = fish.position.clone();
  const heldPosition = new THREE.Vector3();
  const heldHeading = new THREE.Vector3();

  // A blow landed in a fight: felt, heard and shown; and a won fight celebrated.
  let lastFoe = null;
  let foeHit = false;
  // When the fish last struck or was struck: with no strength left in a fight, it dies.
  let lastCombat = -1e9;
  const foeAt = new THREE.Vector3();
  function blowLanded(hit) {
    foeHit = true;
    shake = Math.max(shake, hit.where === "rear" ? 0.55 : 0.35);
    sound.nip();
    lastCombat = time;
    if (hit.where === "rear" || hit.winded) sound.thump();
    hud.tip("brawl", "<b>Jeder Fisch lässt sich angreifen.</b> Wer schwächer ist als du, flieht. Wer dir ebenbürtig oder stärker ist, wehrt sich und beißt zurück, und das kostet dich Kraft. Geht sie dir im Kampf ganz aus, stirbst du. Und wer groß genug ist, schluckt dich einfach.", 12);
    if (hit.minor || (hit.fled && !hit.beaten)) {
      // A shoal fish, a smolt, a hunter that thinks better of it.
      hud.note(hit.beaten ? `${hit.title} besiegt – er flieht!` : hit.fled ? `${hit.title} flieht!` : `${hit.title} wehrt sich!`);
      if (hit.fled || hit.beaten) feat("bully", { delay: 0.8 });
      return;
    }
    if (hit.beaten) {
      brood.won();
      if (hit.kind !== "rival") {
        hud.toast(`${hit.title} besiegt!`, "Sie flieht – und lässt dich von jetzt an in Ruhe.", 5);
        sound.fanfare();
      }
      logbook.victory(hit.kind);
      return;
    }
    hud.note(hit.where === "front" ? "Von vorn – Vorsicht!" : hit.where === "rear" ? (hit.winded ? "Volltreffer!" : "Treffer von hinten!") : hit.winded ? "Volltreffer in die Flanke!" : "Treffer in die Flanke!");
  }
  function step(dt) {
    prof.begin();
    if (celebration.active) {
      celebration.t += dt / Math.max(celebration.scale, 1e-3);
      if (celebration.t >= celebration.duration) endCelebration();
    }
    time += dt;
    world.time = time;
    waterTime.value = time;
    const s = fish.river.s;
    // The river round the fish.
    const L = fish.length;
    const viewer = { x: camera.position.x, z: camera.position.z, s: cameraRiver.s, u: cameraRiver.u };
    const sea = regionWeights(s).sea;
    terrain.update(viewer, { radius: builtRadius(), near: clamp(0.28 + L * 0.1, 0.35, 1), budget: 5, land: 60 });
    prof.mark("terrain");
    featureEvents.length = 0;
    features.update(fish.river.s, 3, { dt, time, fish, light: conditions.light, toss: (type, x, z) => life.food.toss(type, x, z, fish), events: featureEvents });
    prof.mark("features");
    if (featureEvents.includes("bread")) hud.tip("bread", "<b>Brot!</b> Leute auf der Brücke werfen Brotkrumen ins Wasser. Schnell hin – sie treiben an der Oberfläche.", 8);
    // The mill wheel's paddles: a knock, and the water throws the fish on.
    const struck = dead <= 0 && !fish.airborne ? features.hazard(fish, time) : null;
    if (struck?.quiet) fish.relative.addScaledVector(struck.push, dt * 10);
    else if (struck) {
      fish.energy = Math.max(0, fish.energy - struck.strength);
      fish.relative.add(struck.push);
      shake = Math.max(shake, 0.7);
      sound.thump();
      hud.note(`Vom ${struck.title} getroffen!`);
      hud.tip("wheel", "<b>Das Mühlrad!</b> Seine Schaufeln tauchen tief in den Graben. Schwimm am Grund darunter durch – oder nimm den Fluss.", 9);
    }
    // Sea lice: a wild fish that lingers by the farm's pens picks them up, and they sap it
    // for a good while.
    const pens = features.marks.farm;
    if (pens && dead <= 0) {
      const near = pens.some((p) => Math.hypot(fish.position.x - p.x, fish.position.z - p.z) < FARM.radius + 28);
      liceExposure = near ? liceExposure + dt : Math.max(0, liceExposure - dt * 0.2);
      if (liceExposure > 14 && time > liceUntil) {
        liceUntil = time + 240;
        liceExposure = 0;
        hud.note("Lachsläuse!");
        feat("lice", { delay: 1.5 });
        hud.tip("lice", "<b>Lachsläuse.</b> In den Netzgehegen wimmelt es von ihnen, und nun sitzen sie auch an dir: eine Weile kostet dich alles mehr Kraft. Halte Abstand zur Farm.", 10);
      }
    }
    if (time < liceUntil) fish.energy = Math.max(0, fish.energy - 0.0011 * dt);
    // The fish counter at the weir: swum up through its slot, counted.
    if (dead <= 0 && counterLast !== null && counterLast >= COUNTER.s && fish.river.s < COUNTER.s && counterLast - fish.river.s < 30 && passSlot(fish.river.s, fish.river.u) > 0.15) {
      let n = 0;
      try {
        n = Number(localStorage.getItem("salmon-survival-counted") || 0);
      } catch {}
      n = n ? n + 1 : 1200 + Math.floor(Math.random() * 300);
      try {
        localStorage.setItem("salmon-survival-counted", String(n));
      } catch {}
      hud.toast("Gezählt!", `Lachs Nr. ${n} – die Kamera der Zählstation hat dich erfasst (${MONTHS[conditions.month]}).`, 6);
      feat("counted", { delay: 2 });
    }
    counterLast = fish.river.s;
    terrain.collidersNear(fish.position.x, fish.position.z, Math.max(6, L * 3), stones);
    pebbles.update(fish.position, L, fish.river.s);
    pebbles.near(fish.position, Math.max(0.6, L * 1.5), stones);
    prof.mark("pebbles+colliders");
    world.covered = terrain.covered(fish.position.x, fish.position.y, fish.position.z);
    // The rich drift of a riffle: more food, and more eyes on the fish.
    world.rich = (world.rich ?? 0) + (driftRich(fish.river.s, fish.river.u) - (world.rich ?? 0)) * (1 - Math.exp(-dt * 1.5));
    if (dead <= 0 && world.rich > 0.55 && !richShown) {
      richShown = true;
      hud.note("Reiche Drift!");
      hud.tip("rich", "<b>Reiche Drift!</b> Über flachen, schnellen Rinnen treibt das meiste Futter – aber hier, im hellen, offenen Wasser, sehen dich Reiher, Eisvögel und Raubfische schon von weitem. Friss dich satt und such dann wieder Deckung.", 12);
    } else if (world.rich < 0.2) richShown = false;
    // The hour and the time of year, for everything that lives by them; the water's
    // temperature here, and what it does to the fish; ice; how hard the river runs.
    updateConditions(daylight.state, fish.stage, fish.progress);
    const regions = regionWeights(fish.river.s);
    const hereDepth = level(fish.river.s) - bed(fish.river.s, fish.river.u);
    conditions.temperature = waterTemperature(regions, hereDepth, poolAt(fish.river.s));
    // Over a cold spring the groundwater keeps it cool.
    const cool = coolingAt(fish.river.s, fish.river.u);
    if (cool > 0) {
      const before = conditions.temperature;
      conditions.temperature -= cool * Math.max(0, conditions.temperature - 8) * 0.8;
      if (before > 16 && cool > 0.5) hud.tip("cold", "<b>Kühles Quellwasser.</b> Hier quillt Grundwasser aus dem Kies – an heißen Tagen der beste Platz im ganzen Fluss.", 9);
    }
    world.thermal = thermal(conditions.temperature);
    conditions.heat = world.thermal.heat;
    world.ice = conditions.ice * clamp(regions.brook + regions.upper + regions.middle + regions.lower * 0.85 + regions.estuary * 0.15, 0, 1);
    setSeasonFlow((1 + 0.55 * conditions.flood - 0.3 * conditions.low) * (1 + 0.8 * events.flood));

    world.netted = nets.stuck.active;
    eddies?.update(dt, fish, gatherStones, gusts(fish.river.s, fish.river.u, time));
    prof.mark("eddies");
    if (eddyCanvas && (eddyClock += dt) > 0.1) {
      eddyClock = 0;
      eddies.debug(eddyCanvas, fish);
      if (fpsBox) fpsBox.dataset.eddies = `${eddies.stats.cost.toFixed(1)} ms · ${(eddies.stats.E / 10).toFixed(1)} m`;
    }
    if (dead <= 0) {
      const wanted = readInput(dt);
      if (celebration.active) {
        // The show: the fish drifts where it is, holding its heading.
        wanted.forward = wanted.brake = wanted.lunge = false;
        wanted.strafe = 0;
        wanted.yaw = fish.yaw;
        wanted.pitch = fish.pitch * 0.9;
      }
      prof.mark("misc");
      salmon.update(dt, wanted, world);
      prof.mark("salmon");
      // The account of this life: the way swum; and the siblings dying unseen as it grows.
      const moved = fish.position.distanceTo(lastPlace);
      if (moved < 5) brood.moved(moved);
      if (brood.update(fish.stage, fish.progress, STAGES)) showBrood();
      if (time > 40) hud.tip("brood", broodWord("firstTip", { size: formatNumber(brood.size) }), 13);
    }
    else readInput(dt);
    lastPlace.copy(fish.position);
    // The gill nets in the estuary.
    if (dead <= 0 && !fish.safe) {
      const net = nets.update(dt, fish);
      if (net === "caught") {
        shake = 1;
        sound.thump();
        hud.note("Im Netz!");
        hud.tip("net", "<b>Im Stellnetz!</b> Die Maschen halten dich an den Kiemen fest. Drück immer wieder <kbd>Leertaste</kbd>, um dich loszureißen – bevor dir die Kraft ausgeht. Unter den Netzen oder um ihre Enden herum ist das Wasser frei.", 12);
      } else if (net === "freed") {
        hud.note("Losgerissen!");
        feat("net", { delay: 1 });
      }
      else if (net === "drowned") die("Im Stellnetz gefangen");
      if (nets.stuck.active) shake = Math.max(shake, 0.25);
    }
    // What happens now and then: storms, anglers, otters, floes, the northern lights.
    for (const e of events.update(dt, { fish, time, dead })) {
      switch (e.type) {
        case "storm":
          hud.note("Ein Gewitter zieht auf …");
          hud.tip("storm", "<b>Gewitter!</b> Blitz und Donner – und bald kommt die Sturzflut: Das Wasser steigt, wird braun und reißend, Äste treiben herab. Halt dich hinter großen Steinen und am Grund.", 11);
          break;
        case "branch":
          shake = Math.max(shake, 0.8);
          sound.thump();
          hud.note("Von einem Ast getroffen!");
          break;
        case "stormOver":
          if (dead <= 0) {
            hud.note("Das Wasser fällt wieder");
            feat("storm", { delay: 1 });
          }
          break;
        case "angler":
          hud.tip("angler", "<b>Ein Angler am Ufer!</b> Seine Fliege treibt verlockend über das Wasser – aber an ihr hängt eine feine Schnur. Beißt du zu, hängst du am Haken.", 10);
          break;
        case "hooked":
          shake = 1;
          sound.thump();
          hud.note("Am Haken!");
          hud.tip("hooked", "<b>Am Haken!</b> Er holt dich ein. Schieß mit <kbd>Leertaste</kbd> immer wieder weg vom Ufer, bis der Haken ausreißt – bevor er dich an Land zieht.", 10);
          break;
        case "unhooked":
          hud.toast("Losgerissen!", "Der Haken ist raus – nichts wie weg.", 4);
          feat("unhooked", { delay: 1 });
          break;
        case "landed":
          die("Vom Angler gefangen");
          break;
        case "otters":
          hud.tip("otters", "<b>Eine Otterfamilie!</b> Mutter und Junge spielen und toben – auf dich haben sie gerade keinen Hunger. Wo sie sind, suchen die Raubfische das Weite.", 10);
          feat("otters", { delay: 3 });
          break;
        case "otterSplash":
          ripples.add(e.x, e.z, 1.4);
          sound.splash(0.35);
          break;
        case "floes":
          hud.tip("floes", "<b>Eisgang!</b> Das Eis bricht auf, Schollen treiben flussab. Unter ihnen kommst du nicht an die Luft.", 9);
          feat("floes", { delay: 2 });
          break;
        case "aurora":
          hud.tip("aurora", "<b>Nordlicht!</b> Über dem Wasser tanzt grünes Licht. Schwimm an die Oberfläche und spring (<kbd>Leertaste</kbd>), um es zu sehen.", 10);
          break;
      }
    }
    if (events.aurora > 0.3 && camera.position.y > level(cameraRiver.s) + 0.05) feat("aurora", { delay: 0.5 });
    if (events.hooked) shake = Math.max(shake, 0.2);
    // The rest of the river's life, and what it does to the fish.
    prof.mark("nets+events");
    stepDrive(dt);
    stepBall(dt);
    stepScent(dt);
    stepRedd(dt);
    const outcome = life.update(dt, { fish, salmon, camera, time, world, above: camera.position.y > level(cameraRiver.s), drive: drive.on ? drive.lead : null, ball: baitball.on ? baitball.ball : null });
    warnings(dt);
    goalArrow();
    stepJourney(dt, threatList.some((th) => th.level >= 0.6));
    siblings.update(dt, fish, time, { food: life.food?.items, camera, others: (outcome.school ?? 0) + (outcome.run ?? 0), left: brood.left });
    prof.mark("life");
    // Caught: the salmon goes where its captor holds it -- down a fish's throat head first,
    // or up out of the water in a bird's bill or under a bear's claws.
    const held = life.hunters.captive;
    if (dead > 0 && held.active) {
      if (held.kind === "fish") {
        const down = clamp(held.t / 0.75, 0, 1);
        heldHeading.copy(held.heading).negate();
        heldPosition.copy(held.grip).addScaledVector(held.heading, (0.9 - 1.7 * down) * L * 0.5);
        salmon.captive(dt, heldPosition, heldHeading, smooth(0.35, 1, down));
      } else salmon.captive(dt, held.grip, held.heading, 0);
    }
    for (const e of fish.events) {
      if (e.type === "eat") {
        brood.ate();
        baitball.ate(e.kind);
        hud.fed(e.kind);
        // Quiet for a larva, a real gulp for a herring.
        sound.swallow(clamp(Math.log10((e.nutrition ?? 1) + 1) / 3, 0.08, 0.9));
        ateSomething = true;
      } else if (e.type === "stage") {
        brood.reached(e.stage, STAGES);
        showBrood();
        celebrate(e.stage);
        badges.award(`stage:${STAGES[e.stage].id}`, stageBadge(STAGES[e.stage]), { delay: 6.5 });
        hud.grew();
        checkpoint = snapshotCheckpoint();
        mirror(salmon.meshes);
      } else if (e.type === "splash") {
        ripples.add(e.x, e.z, e.strength);
        falls.splash(e.x, e.y, e.z, e.strength * L);
        sound.splash(e.strength);
      } else if (e.type === "tumble") {
        falls.splash(e.x, e.y - 0.3, e.z, e.strength * L);
        sound.splash(e.strength * 0.5);
      } else if (e.type === "leap") {
        brood.leapt();
        sound.leap();
        falls.splash(fish.position.x, level(fish.river.s), fish.position.z, L);
        ripples.add(fish.position.x, fish.position.z, 1.2);
      } else if (e.type === "leapDone") {
        if (!e.fall.step) hud.toast(e.fall.name, "geschafft");
        // Past a fall on the way home, this is where it starts again if it dies.
        if (STAGES[fish.stage].fasting) checkpoint = snapshotCheckpoint();
      } else if (e.type === "noBreath") {
        hud.short();
      } else if (e.type === "winded") {
        windedOnce = true;
      } else if (e.type === "knock") {
        fish.energy = Math.max(0, fish.energy - e.strength);
        shake = 0.8;
        sound.thump();
      }
    }
    if (outcome.splash) {
      const sp = outcome.splash;
      ripples.add(sp.x, sp.z, sp.strength);
      falls.splash(sp.x, sp.y, sp.z, sp.strength * 2);
      sound.splash(sp.strength);
    }
    if (outcome.call) sound.call(outcome.call);
    // The eye on the card: seen by a hunter, or hidden from one that is about.
    const watch = dead > 0 ? null : outcome.watched ? "seen" : outcome.hidden ? "hidden" : null;
    hud.watch(watch);
    if (watch === "hidden") feat("hidden", { delay: 0.5 });
    if (watch === "hidden")
      hud.tip("hidden", "<b>Versteckt!</b> Hinter einem großen Stein, in Wasserpflanzen oder im Schilf sieht dich ein Jäger nicht. Nur ganz aus der Nähe spürt er dich trotzdem – mit dem Seitenlinienorgan, und eher, wenn du schnell schwimmst.", 10);
    else if (watch === "seen")
      hud.tip("seen", "<b>Du wirst gesehen.</b> Ein Jäger hat dich im Blick (das Auge oben links). Versteck dich hinter einem großen Stein oder in Pflanzen – oder bleib ganz still, dann fällst du weniger auf.", 10);
    // The logbook keeps count of what the fish meets and where it has been.
    if (dead <= 0) logbook.update(dt, fish, life);
    spotUpdate(dt);
    if (dead <= 0) places.update(dt, fish);
    // A word at some of the places, the first time.
    const here = places.here?.id;
    if (here === "mussels" && fish.stage <= 4)
      hud.tip("mussels", "<b>Flussperlmuscheln.</b> Ihre winzigen Larven heften sich ein paar Monate an die Kiemen junger Lachse und reisen mit – ohne Lachse gäbe es sie nicht.", 10);
    else if (here === "king-pool") hud.tip("king", "<b>Die Königsgumpe.</b> In der Tiefe steht der alte König der Forellen – riesig, zäh und hungrig. Nur wer ihn in die Flanke trifft, immer wieder, kann ihn bezwingen.", 11);
    else if (here === "crack-lachsfall") hud.tip("crack", "<b>Der Felsspalt!</b> Ein geheimer Weg nach oben, am Lachsfall vorbei.", 8);
    // Stories and facts, now and then, when nothing else is being said.
    lore.update(dt, {
      stage: STAGES[fish.stage].id,
      place: here ?? null,
      regions: regionWeights(fish.river.s, loreRegions),
      season: conditions.season,
      night: conditions.night,
      hatch: conditions.hatch,
      hunters: logbook.metNow ?? [],
      quiet: dead <= 0 && !celebration.active && spotlight.t < 0 && hud.hintFree && !fish.captive,
    });
    // In a school, a hunter often takes another.
    if (outcome.decoy) {
      shake = Math.max(shake, 0.6);
      sound.thump();
      if (baitball.on) hud.note("Knapp – er hat einen anderen erwischt!");
      else {
        hud.note("Ein Schwarmgefährte …");
        hud.tip("decoy", "Knapp! Der Räuber hat einen anderen Smolt aus dem Schwarm erwischt. Im Schwarm bist du sicherer – bleib bei den anderen.", 8);
      }
      feat("decoy", { delay: 1 });
    }
    // The drive: a goosander dived into the school and came out with one of the others.
    if (outcome.raided) {
      sound.thump();
      hud.tip("raid", "Ein Gänsesäger hat sich einen Smolt aus dem Schwarm geholt. Mitten im Schwarm trifft es selten dich – am Rand und allein fast immer.", 9);
    }
    if ((outcome.school ?? 0) >= 6) feat("school");
    // The run home: in the company of the others the fish goes easier.
    if ((outcome.run ?? 0) >= 4 && dead <= 0) {
      feat("run", { delay: 2 });
      hud.tip("run", "<b>Der Laichzug!</b> Andere Lachse ziehen mit dir heim. In ihrem Pulk sparst du Kraft – und ein Räuber erwischt oft einen anderen.", 10);
      fish.energy = Math.min(1, fish.energy + 0.0012 * dt);
    }
    if ((outcome.school ?? 0) >= 6)
      hud.tip("school", "<b>Die Smoltwanderung.</b> Mit dem Frühjahrshochwasser ziehen die Smolts gemeinsam flussab ins Meer – und du mit ihnen. Im Schwarm bist du sicherer: ein Räuber erwischt oft einen anderen.", 10);
    // Fights: blows the salmon lands, on hunters and on young salmon holding a spot.
    lastFoe = outcome.foe ?? null;
    foeHit = false;
    for (const hit of outcome.hits ?? []) blowLanded(hit);
    if (outcome.threatened)
      hud.tip(
        "fight",
        `<b>Fliehen – oder kämpfen?</b> Bevor ein Räuber zustößt, krümmt er sich kurz – dann schießt er geradeaus: weich mit <kbd>A</kbd>/<kbd>D</kbd> + <kbd>Leertaste</kbd> zur Seite aus. Jeder Fehlstoß kostet ihn Puste; außer Atem zieht er sich zurück. Dann schieß mit <kbd>Leertaste</kbd> in seine Flanke oder von hinten hinein – nie von vorn. Nach dem ersten Treffer siehst du über ihm, wie viel Kraft er hat: manche sind alt oder krank und schnell besiegt, andere kaum zu bezwingen. Ist seine Kraft aufgebraucht, flieht er und lässt dich für immer in Ruhe.`,
        18,
      );
    if (lastFoe && lastFoe.weak && !lastFoe.beaten) hud.tip("weak", "Dieser Fisch ist <b>geschwächt</b> – alt oder krank. Mit ein paar guten Treffern ist er besiegt.", 7);
    // Other young salmon holding their spots.
    for (const e of outcome.rivals ?? []) {
      if (e.type === "display") {
        hud.tip("rival", "<b>Revier!</b> Ein anderer junger Lachs verteidigt hier seinen Futterplatz: er dreht sich zu dir und spreizt die Flossen – gleich zwickt er. Weiche aus – oder kämpf um den Platz: Schieß mit <kbd>Leertaste</kbd> in seine Flanke oder von hinten hinein. Jeder Treffer kostet ihn Kraft (Balken über ihm); ist sie aufgebraucht, räumt er den Platz.", 12);
      } else if (e.type === "hit") {
        blowLanded(e);
      } else if (e.type === "nip") {
        shake = Math.max(shake, 0.35);
        sound.nip();
        hud.note("Gezwickt!");
      } else if (e.type === "won") {
        sound.nip();
        hud.toast("Revier erobert!", "Solange du hier bleibst, treibt dir mehr Futter zu.", 5);
      } else if (e.type === "lost") {
        shake = Math.max(shake, 0.5);
        sound.thump();
        hud.note("Verdrängt!");
      } else if (e.type === "leftTerritory") {
        hud.note("Revier aufgegeben");
      }
    }
    // Other fish rising to the hatch: rings on the surface, a soft sip.
    for (const r of outcome.rises ?? []) {
      ripples.add(r.x, r.z, 0.28);
      sound.rise(Math.hypot(r.x - camera.position.x, r.z - camera.position.z));
    }
    if (outcome.bitten) {
      shake = 1;
      sound.thump();
      lastCombat = time;
    }
    // Nips from a fish that fights back.
    for (const n of outcome.nips ?? []) {
      shake = Math.max(shake, 0.45);
      sound.nip();
      hud.note(`${n.title} beißt zurück!`);
      lastCombat = time;
    }
    for (const e of outcome.rivals ?? []) if (e.type === "nip" || e.type === "hit" || e.type === "lost") lastCombat = time;
    for (let i = 0; i < (outcome.missed ?? 0); i++) if (dead <= 0) brood.escaped();
    if (outcome.killed && dead <= 0) die(outcome.killed);
    else if (fish.energy <= 0 && dead <= 0 && time - lastCombat < 6) die("Im Kampf unterlegen");
    // Too long without food: first a warning, then the body wastes, and with no strength
    // left the fish dies.
    if ((fish.hunger ?? 0) > 60 && dead <= 0) hud.tip("hunger", "<b>Du hungerst!</b> Dein Magen ist schon lange leer. Ohne Futter schwinden deine Kräfte, bis du verhungerst.", 9);
    if (fish.energy <= 0 && dead <= 0) {
      fish.starving = (fish.starving ?? 0) + dt;
      if (fish.starving > ((fish.hunger ?? 0) > 90 ? 20 : 45)) die((fish.hunger ?? 0) > 90 ? "Verhungert" : "Entkräftet");
    } else fish.starving = 0;
    if (spawning) stepSpawning(dt);
    else if (dead > 0) {
      if (!lifecard.open) dead -= dt;
      // The dark comes down once the catch has been seen.
      if (!veiled && DEATH - dead > (held.active ? 1.9 : 0)) {
        veiled = true;
        hud.veil("dark");
        sound.hush(true);
      }
      if (dead <= 0 && !lifecard.open) handover();
    }
    // The eggs stay in the gravel until the new fry has left the redd.
    if (eggs.count && !["alevin", "fry"].includes(phaseOf(fish.stage))) eggs.count = 0;
    // Tips, each once, when they matter.
    const st = STAGES[fish.stage];
    if (windedOnce && fish.winded)
      hud.tip("winded", "<b>Außer Atem!</b> Jeder Spurt, jedes Schnappen und jeder Sprung mit <kbd>Leertaste</kbd> kostet <b>Kraft</b>. Lass dich treiben (<kbd>W</kbd> loslassen) oder halte dich am Grund fest – dann füllt sich der helle Teil wieder, bis zur Kraft aus dem Futter (gestreift).", 10);
    else if (!st.fasting && !st.sea && fish.dart)
      hud.tip(
        "eat",
        "Alles, was <span class=glow>warm leuchtet</span>, ist Futter: Larven und Krebschen, die die Strömung bringt. Schwimm genau darauf zu – auf den letzten Zentimetern stößt dein Fisch von selbst vor und schnappt zu. Zieht sich schon ein feiner Kreis um den Happen zusammen, schießt er mit <kbd>Leertaste</kbd> auch von weiter weg hin.",
        10,
      );
    else if (ateSomething && !st.fasting && hud.seen("eat"))
      hud.tip(
        "stomach",
        st.yolk
          ? "Lecker! Jede Larve bringt dich schneller aus dem Kies. Oben links siehst du, wie viel <b>Dottersack</b> du noch hast und wie weit dein <b>Wachstum</b> ist."
          : "Gefressenes landet im <b>Magen</b> und wird nach und nach zu <b>Wachstum</b>. Ist der Wachstumsbalken voll, wirst du zum nächsten Stadium.",
        9,
      );
    else if (st.phase === "fry" && fish.flow.speed > salmon.speeds().cruise && !fish.gripping)
      hud.tip("grip", "Die Strömung ist stärker als du: tauch zum Grund und halte <kbd>S</kbd>, dann krallst du dich an den Steinen fest.");
    else if (fish.energy < 0.3 && !st.fasting && !st.yolk)
      hud.tip("tired", "Deine <b>Kraft</b> geht zur Neige. Friss etwas, oder ruh dich hinter einem Stein oder am Grund (<kbd>S</kbd>) aus.");
    else if (st.id === "smolt" && regionWeights(fish.river.s).sea < 0.5 && fish.progress > 0.1)
      hud.tip("smolt2", "Im Süßwasser wächst ein Smolt nur langsam – je weiter vom Meer, desto langsamer –, und zum Postsmolt wird er erst im Salzwasser. Lass dich flussabwärts treiben, bis ins Meer.");
    else if (st.phase === "sea" && regionWeights(fish.river.s).sea > 0.5)
      hud.tip("hunt", "Im Meer jagst du: Sandaale und Heringe fliehen. Schwimm dicht heran – aus der Nähe stößt du von selbst zu, mit <kbd>Leertaste</kbd> schießt du von weiter weg hinein. Teil dir deine Kraft ein.");
    else if (st.fasting && fish.energy < 0.35)
      hud.tip("rest", "Deine Reserven gehen zur Neige. Ruh dich am Grund aus (<kbd>S</kbd>), in ruhigem Wasser erholst du dich.");
    else if (conditions.heat > 0.15 && !fish.captive)
      hud.tip("heat", `<b>Zu warm!</b> Das Wasser hat hier ${Math.round(conditions.temperature)} °C – das kostet einen Lachs viel Kraft. Such tiefes Wasser oder einen Gumpen: dort ist es kühler.`, 10);
    else if ((world.ice ?? 0) > 0.5)
      hud.tip("ice", "<b>Winter.</b> Eis liegt über dem Fluss, das Wasser ist eiskalt. Alles lebt jetzt langsam: du brauchst wenig Kraft, aber Futter ist knapp. Ruh dich in tiefem, ruhigem Wasser aus.", 10);
    else if (conditions.flood > 0.5 && regionWeights(fish.river.s).sea < 0.5)
      hud.tip("flood", "<b>Schneeschmelze!</b> Das Frühjahrshochwasser macht den Fluss trüb und reißend. Halt dich hinter Steinen und am Grund – oder lass dich tragen.", 10);
    else if (conditions.leafFall > 0.5 && regionWeights(fish.river.s).sea < 0.5)
      hud.tip("autumn", "<b>Herbst.</b> Die Blätter fallen und treiben auf dem Wasser. Das Wasser wird kühler – es ist Laichzeit für die Lachse.", 9);
    else if (!st.fasting && !st.yolk && conditions.hatch > 0.45 && regionWeights(fish.river.s).sea < 0.5)
      hud.tip("hatch", "<b>Abendsprung!</b> In der Dämmerung schlüpfen die Insekten: Larven steigen zur Oberfläche, und oben treiben frisch geschlüpfte Fliegen. Jetzt gibt es reichlich Futter – überall ringt es, wo andere Fische steigen.", 9);
    else if (conditions.night > 0.7 && fish.length < 6)
      hud.tip("night", "<b>Nacht.</b> Forellen, Barsche und Vögel sehen dich jetzt kaum – aber Otter und Groppen jagen im Dunkeln mit Tasthaaren und Seitenlinie.", 9);
    // (Spawning: home, ripe, by the hen until she is ready -- see stepRedd.)

    falls.update(dt, camera.position, cameraRiver.s, time);
    ripples.update(dt);
    stepPan(dt);
    stepCharge(dt);
    // Home at the salmon fall: the bear at the top, and how to get past it.
    if (SALMON_FALL && phaseOf(fish.stage) === "spawner" && dead <= 0) {
      const d = fish.river.s - SALMON_FALL.s;
      if (d > 0 && d < 60 && !fallMet) {
        fallMet = true;
        hud.toast("Lachsfall", "Oben an der Kante fischt ein Bär.", 5);
      }
      if (d > 0 && d < 30)
        hud.tip("salmonfall", "<b>Der Lachsfall.</b> Oben an der Kante fischt ein Bär – immer wieder klatscht seine Pranke ins Wasser. Spring gleich danach: Halte <kbd>Leertaste</kbd> gedrückt und lass los, wenn die Sprungkraft ganz oben ist – dann oben sofort weiter. Wer sich nicht traut, sucht den Spalt im Fels.", 14);
    }
    placeCamera(dt);
    prof.mark("rest");
    // How long people play (counted at a few marks, with the stage they have reached).
    playClock += dt;
    if (playMarks.length && playClock >= playMarks[0] * 60) track("played", { minutes: playMarks.shift(), stage: STAGES[fish.stage].id });
    saveClock += dt;
    if (saveClock > 8 && dead <= 0 && !fish.airborne) {
      saveClock = 0;
      persist();
    }
  }

  function stageLine(st) {
    switch (st.id) {
      case "fry":
        return "Der Dotter ist aufgebraucht. Jetzt heißt es fressen, was die Strömung bringt.";
      case "fingerling":
        return "Dein erster Sommer: fingerlang, die dunklen Parr-Flecken kommen. Jetzt passen schon größere Larven ins Maul.";
      case "yearling":
        return "Ein Jahr alt. Revier halten, Larven und Krebschen schnappen – und die Stellen mit der besten Drift verteidigen.";
      case "parr":
        return "Dein zweites Flussjahr, eine Hand lang. Bald zieht es dich hinab zum Meer.";
      case "smolt":
        return "Silbern für das Meer. Flussabwärts, bis das Wasser salzig wird.";
      case "postsmolt":
        return "Salzwasser! Die ersten Monate im Meer: Krill und kleine Fische jagen.";
      case "grilse":
        return "Ein Jahr im Meer, kräftig und schnell. Sandaale und Heringe jagen.";
      case "sea":
        return "Ein großer Meerlachs. Heringe und Makrelen jagen, noch ein wenig wachsen – dann ruft die Heimat.";
      case "spawner":
        return "Der Ruf der Heimat. Folge dem Duft deines Flusses bis zur Mündung. Fressen wirst du nicht mehr.";
      default:
        return "";
    }
  }
  function persist() {
    logbook.persist();
    save.store({
      stage: fish.stage,
      progress: fish.progress,
      energy: fish.energy,
      stomach: fish.stomach,
      position: fish.position.toArray(),
      yaw: fish.yaw,
      s: fish.river.s,
      u: fish.river.u,
      course: COURSE_VERSION,
      checkpoint,
      hour: daylight.state.hour,
      generation: save.generation,
      brood: brood.state(),
      heritage: { ...heritage },
    });
  }
  function die(cause) {
    track("death", { cause, stage: STAGES[fish.stage].id });
    dead = DEATH;
    veiled = false;
    carded = false;
    deathInfo = { cause, stageName: STAGES[fish.stage].name, stageId: STAGES[fish.stage].id, progress: fish.progress, region: regionName(fish.river.s), month: MONTHS[conditions.month] };
    const held = life.hunters.captive;
    if (held.active) sound.eaten(held.kind);
    hud.toast(cause, "", 3);
    endDrive("died");
    endBall(true);
  }
  // After the dark, the nearest of the siblings swims on: the camera swings over to it and
  // it is the fish from then on (a little smaller, at the same stage). With none left, a new
  // brood hatches in the gravel. The life that ended is kept for its card (pause menu).
  let carded = false;
  let deathInfo = null;
  let lastLife = null;
  let pan = null;
  function handover() {
    const end = brood.died();
    lastLife = { life: end.life, ...deathInfo, left: end.left, size: end.size };
    lifeButton.hidden = false;
    showBrood();
    if (end.gone) {
      track("brood_lost", { stage: deathInfo.stageId });
      newBrood();
      hud.toast(broodWord("lostTitle"), broodWord("lostLine", { size: formatNumber(brood.size) }), 7);
      return;
    }
    const fromEye = camera.position.clone(),
      fromAim = aim.clone();
    const next = siblings.nearest(fish.position, 60 + fish.length * 20) ?? siblings.call(fish);
    events.reset();
    salmon.setStage(fish.stage, Math.max(0, fish.progress * 0.7));
    if (next) {
      salmon.place(next.position.clone(), Math.atan2(next.heading.z, next.heading.x));
      siblings.take(next);
    } else restore(checkpoint);
    fish.energy = 1;
    fish.stomach = 0.3;
    fish.hunger = 0;
    fish.starving = 0;
    look.yaw = fish.yaw;
    look.pitch = 0;
    life.reset(fish);
    nets.reset();
    pebbles.prime(fish.position, fish.length, fish.river.s);
    checkpoint = snapshotCheckpoint();
    placeCamera(0, true);
    pan = { t: 0, duration: 2.2, fromEye, fromAim, toEye: camera.position.clone(), toAim: aim.clone() };
    camera.position.copy(fromEye);
    fish.safe = true;
    dead = 0;
    hud.veil(null);
    sound.hush(false);
    hud.toast("", broodWord("takeover"), 4);
    persist();
  }
  // The swing of the camera over to the sibling.
  function stepPan(dt) {
    if (!pan) return;
    pan.t += dt;
    const k = smooth(0, 1, pan.t / pan.duration);
    cameraOverride ??= { eye: new THREE.Vector3(), target: new THREE.Vector3(), pan: true };
    cameraOverride.eye.lerpVectors(pan.fromEye, pan.toEye, k);
    cameraOverride.target.lerpVectors(pan.fromAim, pan.toAim, Math.min(1, k * 1.3));
    if (pan.t >= pan.duration) {
      pan = null;
      if (cameraOverride?.pan) cameraOverride = null;
      fish.safe = false;
    }
  }
  function freeThePointer() {
    held.clear();
    touch?.release();
    if (locked()) {
      releasing = true;
      document.exitPointerLock?.();
    }
  }
  // The last life's card, from the pause menu (to look back at it, and share it).
  const lifeButton = document.querySelector("#life-toggle");
  lifeButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    lifeButton.blur();
    if (lastLife) lifecard.show({ kind: "past", ...lastLife });
  });
  const lifecard = createLifeCard({
    habitat,
    onGo: (kind) => {
      // The card of a past life, opened from the pause: just closed again.
      if (kind === "past") return;
      sound.start();
      if (kind === "lost") newBrood();
      else if (kind === "home") nextGeneration();
      else {
        dead = 0;
        respawn();
      }
      capture();
    },
  });
  // All the siblings gone: a new brood hatches in the gravel of the spring.
  function newBrood() {
    brood.renew();
    redd.stop();
    // Other parents: nothing handed on.
    resetHeritage();
    events.reset();
    salmon.setStage(0, 0);
    startAt(S.redd, section(S.redd).thalweg, 0.02);
    checkpoint = snapshotCheckpoint();
    fish.energy = 1;
    fish.stomach = 0;
    fish.hunger = 0;
    dead = 0;
    look.yaw = fish.yaw;
    look.pitch = 0;
    placeCamera(0, true);
    post.resetHistory?.();
    life.reset(fish);
    nets.reset();
    pebbles.prime(fish.position, fish.length, fish.river.s);
    hud.veil(null);
    sound.hush(false);
    showBrood();
    persist();
  }
  function respawn() {
    events.reset();
    salmon.setStage(checkpoint.stage, 0);
    restore(checkpoint);
    fish.energy = 1;
    fish.stomach = 0;
    fish.hunger = 0;
    look.yaw = fish.yaw;
    look.pitch = 0;
    placeCamera(0, true);
    post.resetHistory?.();
    life.reset(fish);
    nets.reset();
    pebbles.prime(fish.position, fish.length, fish.river.s);
    hud.veil(null);
    sound.hush(false);
    persist();
  }
  // Spawning: the fish settles over the gravel of the redd, and the eggs go down among the
  // stones, orange and bright; then the light goes white, and in the same gravel the next
  // generation hatches among the eggs that are left.
  const eggMaterial = new THREE.MeshStandardMaterial({ color: 0xff7a2a, roughness: 0.25, emissive: 0x401000, transparent: true, opacity: 0.92 });
  eggMaterial.onBeforeCompile = (shader) => waterLitShader(shader);
  const eggs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 10, 8), eggMaterial, 120);
  eggs.count = 0;
  eggs.frustumCulled = false;
  eggs.name = "Eggs";
  scene.add(eggs);
  const eggMatrix = new THREE.Matrix4();
  let spawning = null;
  function layEgg(i) {
    const a = i * 2.39996 + Math.random() * 0.4;
    const r = 0.3 + Math.sqrt(i / 120) * 2.2;
    const s = S.redd + Math.cos(a) * r;
    const u = section(S.redd).thalweg + Math.sin(a) * r;
    const p = place(s, u, {});
    eggMatrix.makeTranslation(p.x, bed(s, u) + 0.04 + Math.random() * 0.05, p.z);
    eggs.setMatrixAt(i, eggMatrix);
    eggs.count = Math.max(eggs.count, i + 1);
    eggs.instanceMatrix.needsUpdate = true;
  }
  function spawn() {
    track("spawned", { generation: save.generation + 1 });
    dead = 1e9;
    // What this life was good at goes on to the brood (heritage.js).
    spawning = { t: 0, laid: 0, traits: earned(brood.life) };
    if (redd.on) redd.spawn(fish);
    sound.hush(false);
  }
  function stepSpawning(dt) {
    if (!spawning) return;
    spawning.t += dt;
    const t = spawning.t;
    // Hold over the gravel, flank to the bottom, tail beating.
    const want = Math.min(120, Math.floor(t * 30));
    while (spawning.laid < want) layEgg(spawning.laid++);
    if (t > 4 && !spawning.veiled) {
      spawning.veiled = true;
      hud.veil("white");
      hud.toast("Gelaicht", "Im Kies der Quelle liegt die nächste Generation.");
    }
    // Home: the card of the life that came back, before the next generation begins.
    if (t > 9 && !spawning.carded) {
      spawning.carded = true;
      freeThePointer();
      lifecard.show({ kind: "home", life: { ...brood.life, number: brood.number }, stageName: STAGES[fish.stage].name, stageId: STAGES[fish.stage].id, progress: 1, region: regionName(fish.river.s), month: MONTHS[conditions.month], left: brood.left, size: brood.size, handed: (spawning.traits ?? []).map((k) => TRAITS[k]) });
    }
  }
  function nextGeneration() {
    const handed = spawning?.traits ?? [];
    spawning = null;
    redd.stop();
    inherit(handed);
    // Said a little after the hatching: what it has from its parents.
    handed.forEach((k, i) => setTimeout(() => hud.note(`Erbe: ${TRAITS[k]} (+${Math.round(heritage[k] * STEP * 100)} %)`), 3800 + i * 2600));
    if (handed.length) setTimeout(() => hud.tip("heritage", "<b>Das Erbe.</b> Was deine Eltern gut konnten, steckt ein wenig in dir: Sprungkraft, Kampfgeist, Wuchs, Wachsamkeit oder Ausdauer – je nachdem, wie sie gelebt haben. Über die Generationen kommt mehr davon zusammen.", 13), 9000);
    track("generation", { traits: handed.join(",") });
    brood.renew();
    showBrood();
    save.generation++;
    salmon.setStage(0, 0);
    startAt(S.redd, section(S.redd).thalweg, 0.02);
    checkpoint = snapshotCheckpoint();
    fish.energy = 1;
    fish.stomach = 0;
    fish.hunger = 0;
    dead = 0;
    look.yaw = fish.yaw;
    placeCamera(0, true);
    life.reset(fish);
    pebbles.prime(fish.position, fish.length, fish.river.s);
    hud.veil(null);
    hud.toast(STAGES[0].name, `Generation ${save.generation + 1}`);
    feat("generation", { delay: 3 });
    persist();
  }

  function draw(dt) {
    const day = daylight.update(dt);
    const rain = day.rain;
    const sunUp = day.daylight;
    const cloud = 1 - 0.62 * rain;
    const s = cameraRiver.s;
    const lv = level(s);
    const above = camera.position.y > lv + 0.02;
    const depth = Math.max(0, lv - camera.position.y);
    const lookHere = regionLook(fish.river.s, lv - bed(fish.river.s, fish.river.u));
    keyColor.copy(SUN_COLOR).lerp(DUSK_COLOR, day.golden * 0.85).lerp(MOON_COLOR, 1 - sunUp);
    key.color.copy(keyColor);
    // Under ice the light comes through milky and dim.
    const iced = world.ice ?? 0;
    const riverShare = 1 - regionWeights(fish.river.s).sea;
    key.intensity = (SUN * (0.3 + 0.7 * cloud) * (sunUp + 0.45 * day.golden) + MOON * day.moon * (1 - 0.6 * rain)) * (1 - 0.6 * iced);
    sky.intensity = SKY * (0.8 + 0.2 * cloud) * (0.07 + 0.93 * sunUp);
    sky.color.copy(SKY_COLOR).lerp(NIGHT_SKY, 1 - sunUp);
    waterUniforms.causticParams.value.y = Math.min(1, (sunUp + 0.4 * day.golden) * cloud + 0.4 * day.moon * (1 - rain)) * (1 - 0.85 * iced);
    waterUniforms.causticParams.value.z = lookHere.focal;
    waterUniforms.causticParams.value.w = (1 - 0.55 * rain) * (1 - 0.6 * smooth(20, 120, depth));
    // The canopy thins as the leaves fall, and the winter trees let the low sun through.
    waterUniforms.canopyParams.value.set(40, 0.22, lookHere.canopy * (1 - 0.45 * conditions.leafFall - 0.65 * conditions.winter), 0.06);
    surfaceUniforms.ice.value = iced;
    swayCanopy(time);
    // The forest: the wind in it (more in rain and storm), the birches turning and bare,
    // snow on the spruces while the river is frozen.
    treeUniforms.treeTime.value = time;
    treeUniforms.treeWind.value = 0.2 + 0.5 * rain + 0.8 * events.flood;
    treeUniforms.treeAutumn.value = Math.max(conditions.autumn, conditions.leafFall);
    treeUniforms.treeBare.value = clamp(conditions.leafFall * 0.7 + conditions.winter * 1.2 - conditions.spring * 1.2, 0, 1);
    treeUniforms.treeSnow.value = clamp(conditions.winter * 1.4 - 0.3, 0, 1) * (0.4 + 0.6 * conditions.ice);
    skyUniforms.sun.value = sunUp * cloud + 0.25 * day.moon;
    skyUniforms.sunColor.value.copy(keyColor);
    skyUniforms.skyLevel.value.setRGB(1, 1, 1).lerp(DUSK_WINDOW, day.golden * 0.8).multiplyScalar(0.02 + 0.98 * sunUp).multiplyScalar(1 - 0.45 * rain);
    skyUniforms.night.value = 1 - sunUp;
    skyUniforms.cloud.value = 0.3 + 0.6 * rain;
    skyUniforms.aurora.value = events.aurora;
    skyUniforms.flash.value = events.flash;
    surfaceUniforms.rain.value = rain;
    surfaceUniforms.body.value.copy(lookHere.body);
    caustics.uniforms.roughness.value = 0.9 + 0.15 * Math.sin(time * 0.05) + 0.5 * rain;
    bedMaterial.userData.tint.value.copy(lookHere.tint);
    // Water, or air for a moment in a leap.
    const light = (0.06 + 0.94 * sunUp + 0.3 * day.golden) * (0.75 + 0.25 * cloud);
    if (above) {
      scene.fog.color.copy(AIR).multiply(skyUniforms.skyLevel.value);
      // The mist over the valley closes in before the edge of what is built round the fish.
      scene.fog.density = 0.9 / builtRadius();
      skyDome.visible = true;
      // The dome goes with the eye: it is the sky at any distance.
      skyDome.position.copy(camera.position);
      post.composite.uniforms.shaftStrength.value = 0;
    } else {
      scene.fog.color.copy(lookHere.fog).multiplyScalar(light * (1 - 0.45 * iced));
      // The snowmelt flood runs brown and thick; the low water of late summer clear.
      scene.fog.color.lerp(FLOOD_WATER, 0.5 * conditions.flood * riverShare);
      scene.fog.color.lerp(MUD_WATER, 0.85 * events.flood * riverShare);
      scene.fog.color.lerp(NIGHT_WATER, (1 - sunUp) * 0.8);
      scene.fog.density = lookHere.density * (1 + 0.9 * conditions.flood * riverShare) * (1 + 1.4 * events.flood * riverShare) * (1 - 0.18 * conditions.low * riverShare);
      // Where the water is wide there is no bank to stop the eye: the haze thickens enough to
      // hide the edge of what is built (else it stands against the haze, square and hard).
      scene.fog.density = Math.max(scene.fog.density, (3.6 / builtRadius()) * wideWater(cameraRiver.s));
      skyDome.visible = false;
      post.composite.uniforms.shaftStrength.value = 1 - 0.85 * iced;
      // Ice mirrors nothing.
      if (post.composite.uniforms.reflectionStrength) post.composite.uniforms.reflectionStrength.value = 0.75 * (1 - iced);
    }
    surfaceUniforms.fogColor.value.copy(scene.fog.color);
    surfaceUniforms.fogDensity.value = scene.fog.density;
    scene.background.copy(scene.fog.color);
    sunLight.set(keyColor.r, keyColor.g, keyColor.b).multiplyScalar(key.intensity * 0.55 * ((sunUp + 0.5 * day.golden) * cloud + 0.35 * day.moon));
    // The eye adapts: deeper down it opens up to what light is left, though never fully.
    const adapt = above ? 1 : 1 + Math.min(depth, 90) * 0.014;
    const flash = celebration.active ? Math.exp(-celebration.t * 1.4) * (1 - Math.exp(-celebration.t * 12)) : 0;
    renderer.toneMappingExposure = (above ? 0.75 : 1 + 1.1 * (1 - sunUp)) * adapt * (dead > 0 ? 0.6 : 1) * (1 + 0.45 * flash) * (1 + events.flash * (above ? 1.4 : 0.55));
    for (const material of mirrored) material.envMapIntensity = 0.6 * (0.08 + 0.92 * sunUp);
    life.light(0.2 + 0.8 * sunUp, sunUp);
    falls.light(0.25 + 0.75 * sunUp);
    sound.update(dt, {
      rain,
      daylight: sunUp,
      stir: Math.max(0, fish.relative.length() - salmon.speeds().cruise) / Math.max(1, salmon.speeds().sprint),
      roar: falls.roar(fish.position, fish.river.s),
      sea: regionWeights(fish.river.s).sea,
      above,
      depth,
    });
    updateWaterLevel();

    // Shadows follow the fish, in whole texels so their edges do not crawl.
    const reach = clamp(10 + fish.length * 5, 12, 60);
    const cam = key.shadow.camera;
    if (Math.abs(cam.right - reach) > 0.5) {
      cam.left = cam.bottom = -reach;
      cam.right = cam.top = reach;
      cam.updateProjectionMatrix();
    }
    const texel = (2 * reach) / settings.shadowSize;
    const cx = Math.round(fish.position.x / texel) * texel,
      cz = Math.round(fish.position.z / texel) * texel;
    const cy = level(fish.river.s);
    key.target.position.set(cx, cy - 10, cz);
    key.position.set(cx, cy - 10, cz).addScaledVector(LIGHT_DIRECTION, 60);
    key.target.updateMatrixWorld();

    const appetite = salmon.appetite();
    hud.update({
      energy: fish.energy,
      breath: fish.breath,
      winded: fish.winded,
      progress: fish.progress,
      pending: appetite.pending,
      stomach: appetite.full,
      yolk: !!STAGES[fish.stage].yolk,
      stage: fish.stage,
      reserve: !!STAGES[fish.stage].fasting,
      // (salmon.js holds a smolt at 97 % until it is within 40 m of the coast.)
      waitSea: !!STAGES[fish.stage].sea && fish.river.s <= S.coast - 400 && fish.progress > 0.9,
      leapHint: (world.ice ?? 0) > 0.5 ? null : (life.leapHint?.(fish) ?? null),
    });
    // The bar over the fish being fought, pinned to it on the screen (to the edge when it is
    // off to the side or behind).
    if (lastFoe && dead <= 0) {
      foeAt.copy(lastFoe.position);
      foeAt.y += lastFoe.size * 0.16;
      foeAt.project(camera);
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      let x = (foeAt.x * 0.5 + 0.5) * w,
        y = (-foeAt.y * 0.5 + 0.5) * h - 10;
      if (foeAt.z > 1) {
        x = w - x;
        y = h * 0.8;
      }
      // Kept on the screen, and clear of the fish's own card at the top left and of the map
      // at the bottom right.
      x = clamp(x, 70, w - 70);
      y = clamp(y, x < 300 ? 230 : 70, h - 40);
      const mapBox = minimap.rect();
      if (mapBox && x > mapBox.left - 70) y = Math.min(y, mapBox.top - 30);
      hud.foe({ ...lastFoe, x, y, hit: foeHit });
      foeHit = false;
    } else hud.foe(null);
    hud.calendar({
      month: MONTHS[conditions.month],
      season: conditions.season,
      hour: conditions.hour,
      night: conditions.night,
      hatch: conditions.hatch,
      temperature: conditions.temperature,
      sea: regionWeights(fish.river.s).sea > 0.5,
    });
    mateTime += dt;
    // At sea and grown, homing: the map shows the way back to the river's mouth -- opened
    // for it once, if it was closed.
    const homing = !!STAGES[fish.stage].fasting && fish.river.s > S.coast - 50;
    if (homing && !homeShown && !minimap.open && dead <= 0) minimap.toggle();
    if (homing) homeShown = true;
    minimap.update(dt, { fish, yaw: look.yaw, homing, others: mates ? mates(mateTime) : [], hideMouth: homing && scentOn && scent.state.home < 0.6 });

    prof.mark("draw-cpu");
    caustics.render();
    if (prof.on) renderer.getContext().finish();
    prof.mark("caustics");
    renderer.shadowMap.needsUpdate = true;
    camera.far = above ? 900 : clamp(4.5 / scene.fog.density, 120, 600);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    post.jitter();
    if (settings.taa) shadowFrame(key, shadowRadius, frames);
    renderer.setRenderTarget(post.main);
    if (prof.on) renderer.getContext().finish();
    prof.mark("draw-prep");
    renderer.render(scene, camera);
    if (prof.on) {
      renderer.getContext().finish();
      prof.calls = renderer.info.render.calls;
      prof.tris = renderer.info.render.triangles;
    }
    prof.mark("render");
    post.render({ light: key, sunLight, density: above ? 0.0001 : scene.fog.density });
    if (prof.on) renderer.getContext().finish();
    prof.mark("post");
    frames++;
  }

  // ------------------------------------------------------------------------------------
  // First frame: build what is round the fish, then run.
  mark("built");
  placeCamera(0, true);
  cameraReady = true;
  mark("camera");
  terrain.prime({ x: camera.position.x, z: camera.position.z, s: fish.river.s, u: fish.river.u }, { radius: 90, near: clamp(0.28 + fish.length * 0.1, 0.35, 1), land: 60 });
  features.prime(fish.river.s);
  mark("prime-features");
  life.reset(fish);
  mark("prime-life");
  pebbles.prime(fish.position, fish.length, fish.river.s);
  resize();
  hud.update({ energy: fish.energy, progress: fish.progress, ...salmon.appetite(), yolk: !!STAGES[fish.stage].yolk, stage: fish.stage, reserve: !!STAGES[fish.stage].fasting });
  mark("primed");
  // Every material the river can show is compiled now, behind the loading card, and not
  // the first time a hunter or a new kind of food turns up mid-swim (a stall of a second).
  {
    const hidden = [];
    scene.traverse((object) => {
      if (object.visible && !(object.isMesh && object.frustumCulled)) return;
      hidden.push([object, object.visible, object.frustumCulled]);
      object.visible = true;
      object.frustumCulled = false;
    });
    // Compiled for the target the scene is really drawn into: the programs depend on it
    // (no tone mapping, linear colour), and compiled for the screen they would all be
    // compiled a second time at the first frame.
    // Then the photographs go up to the graphics card. (Uploading them while the shaders
    // compile gains nothing: the card does one thing after the other either way.)
    renderer.setRenderTarget(post.main);
    try {
      await renderer.compileAsync(scene, camera);
    } catch {}
    mark("compiled");
    await photosLoaded();
    mark("photos");
    for (const texture of photoTextures) renderer.initTexture(texture);
    mark("uploaded");
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(post.main);
    renderer.render(scene, camera);
    mark("first-render");
    for (const [object, visible, culled] of hidden) {
      object.visible = visible;
      object.frustumCulled = culled;
    }
  }
  // Nothing moves until the swim is started from the title card.
  waiting = !!intro;
  step(1 / 60);
  mark("first-step");
  draw(1 / 60);
  mark("first-draw");
  loading.style.opacity = 0;
  setTimeout(() => (loading.hidden = true), 900);
  const begin = () => {
    waiting = false;
    last = performance.now();
    touch?.show();
    // The controls first; the tips wait until they have been read.
    hud.hint(touchMode);
    if ((!state || query.has("new")) && fish.stage === 0) hud.toast(STAGES[0].name, "Du bist geschlüpft! Dein Dottersack nährt dich – bleib nah am Kies, und schnapp dir schon die ersten winzigen Larven.", 7);
  };
  mark("ready");
  if (intro) {
    intro.ready();
    intro.started.then(() => {
      track("start", { stage: STAGES[fish.stage].id, lang, resumed: state && !query.has("new") ? "yes" : "no" });
      sound.start();
      look.yaw = fish.yaw;
      look.pitch = fish.pitch;
      capture();
      canvas.focus({ preventScroll: true });
      begin();
    });
  } else begin();

  let running = true;
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    sound.hush(!running);
    last = performance.now();
    if (!running) persist();
    if (running) requestAnimationFrame(tick);
  });
  window.addEventListener("pagehide", persist);
  // A newer version out while the game sat in the background (an app on a phone's home
  // screen is only woken, never loaded again): the fish is saved and the page loads afresh.
  const bundle = document.querySelector('script[src*="/game."], script[src*="game."]')?.getAttribute("src")?.match(/game\.(\w+)\.js/)?.[1];
  if (bundle && !dev)
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) return;
      try {
        const html = await (await fetch(location.pathname, { cache: "no-store" })).text();
        const latest = html.match(/game\.(\w+)\.js/)?.[1];
        if (latest && latest !== bundle) {
          persist();
          location.reload();
        }
      } catch {}
    });
  function tick(now) {
    if (!running) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    adaptResolution((now - last) / 1000);
    if (fpsBox && frames % 15 === 0) fpsBox.textContent = `${Math.round(1 / frameRate.average)} fps · ${renderer.domElement.width}×${renderer.domElement.height}`;
    last = now;
    advance(dt);
    requestAnimationFrame(tick);
  }
  // One frame: the world (slowed during a celebration), its sparkle, the picture.
  function advance(dt) {
    const still = userPaused || waiting || logbook.open;
    if (!still) {
      celebration.scale = celebrationScale();
      step(dt * celebration.scale);
      glitter.update(dt, camera, fish.position);
    } else if (waiting) {
      // Behind the title card: go on building what is further off.
      features.update(fish.river.s, 4);
      terrain.update({ x: camera.position.x, z: camera.position.z, s: cameraRiver.s, u: cameraRiver.u }, { radius: builtRadius(), near: clamp(0.28 + fish.length * 0.1, 0.35, 1), budget: 4, land: 60 });
    }
    draw(still ? 0 : dt);
  }
  requestAnimationFrame(tick);

  // Development handles: ?capture=1 with tools/capture-server.mjs running.
  if (query.get("capture") || query.get("diagnostics") === "1")
    window.salmon = {
      profile: prof,
      fish,
      salmon,
      terrain,
      features,
      events,
      life,
      falls,
      daylight,
      camera,
      renderer,
      scene,
      post,
      look,
      held,
      input,
      THREE,
      course: { level, bed, place, locate, section, FALLS, S },
      eddies,
      world,
      badges,
      logbook,
      step,
      draw,
      advance,
      celebrate,
      celebration,
      lore,
      startAt,
      brood,
      lifecard,
      siblings,
      drive,
      startDrive,
      baitball,
      startBall: () => baitball.start(fish, life.shoals),
      redd,
      scent,
      leapCharge: () => ({ charge, reach: inLeapReach(), fall: SALMON_FALL?.s, dead, air: fish.airborne, cel: celebration.active }),
      die,
      spawn,
      setZoom: (z) => (zoom = z),
      pebbles,
      // A fish of any kind, posed for a look: returns a function that takes it away.
      showcase(kind, coat, length, position, yaw = 0, mouth = 0) {
        const m = createFishMesh(scene, kind, COATS[coat] ?? coat, 1, { name: `showcase ${kind}`, cacheKey: `showcase-${kind}` });
        mirror([m.body, m.membranes]);
        const k = length / MODEL_LENGTH;
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw), new THREE.Vector3(k, k, k));
        m.body.setMatrixAt(0, matrix);
        m.membranes.setMatrixAt(0, matrix);
        m.swim.setXYZW(0, 1.0, 0.3, 0, 0.2);
        m.mouth.setX(0, mouth);
        return () => {
          scene.remove(m.body, m.membranes);
        };
      },
      // Look from anywhere: view(eye, target) with arrays, or view(null) to follow the fish.
      view(eye, target, near) {
        cameraOverride = eye ? { eye: new THREE.Vector3(...eye), target: new THREE.Vector3(...target), near } : null;
      },
      pause(value) {
        running = !value;
        if (running) {
          last = performance.now();
          requestAnimationFrame(tick);
        }
      },
      async run(seconds, script = null, dt = 1 / 30) {
        for (let t = 0; t < seconds; t += dt) {
          if (script) script(t);
          step(dt);
          if (Math.floor((t + dt) * 2) > Math.floor(t * 2))
            await new Promise((resolve) => {
              const channel = new MessageChannel();
              channel.port1.onmessage = resolve;
              channel.port2.postMessage(0);
            });
        }
      },
      async settle(maxSeconds = 20) {
        const start = performance.now();
        while (terrain.pending > 0 && performance.now() - start < maxSeconds * 1000) {
          terrain.update({ x: camera.position.x, z: camera.position.z, s: cameraRiver.s, u: cameraRiver.u }, { budget: 50, near: clamp(0.28 + fish.length * 0.1, 0.35, 1) });
          await new Promise((r) => setTimeout(r, 0));
        }
      },
      async capture(name, width = 1280, height = 720) {
        const bounds = canvas.getBoundingClientRect();
        renderer.setSize(width, height, false);
        post.setSize(width, height, width / bounds.width);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        for (let i = 0; i < 16; i++) draw(0);
        const image = canvas.toDataURL("image/jpeg", 0.9);
        resize();
        await fetch(`/__capture/${name}`, { method: "POST", body: image });
        return name;
      },
    };
}

// The river, on a computer or a phone (?phone still shows the old note that the game wants
// a computer).
if (query.has("phone")) showPhoneNotice();
else
  start().catch((error) => {
    document.querySelector("#intro").hidden = true;
    reportSceneError(error);
  });
