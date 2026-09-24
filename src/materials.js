import * as THREE from "three";
import { SUN_DIRECTION, RIPPLE_COUNT, RIPPLE_SPEED, river, waterLitShader, waterTime } from "../../riverscape/src/water.js";
import { surfaceWavesGLSL } from "../../riverscape/src/caustics.js";
import { eddyGLSL, eddyUniforms } from "./flowfield.js";

// The materials the river is made of: its bed (gravel, sand, silt and rock, with the film
// of algae and moss that grows on anything the light reaches), the land along it, the
// water's surface seen from below and from above, the white water of a fall, and the sky.

// Shared by everything that shows the sky: the dome, the surface's mirror from above and
// the window through it from below.
export const skyUniforms = {
  sunDirection: { value: SUN_DIRECTION.clone() },
  // Brightness and colour of the sky and the sun, set each frame from the time of day.
  skyLevel: { value: new THREE.Color(1, 1, 1) },
  sunColor: { value: new THREE.Color(1, 0.95, 0.86) },
  sun: { value: 1 },
  night: { value: 0 },
  cloud: { value: 0.3 },
  // The northern lights (0..1), and a lightning flash lighting the clouds from within.
  aurora: { value: 0 },
  flash: { value: 0 },
};

export const skyGLSL = /* glsl */ `
  uniform vec3 sunDirection;
  uniform vec3 skyLevel;
  uniform vec3 sunColor;
  uniform float sun;
  uniform float night;
  uniform float cloud;
  uniform float aurora;
  uniform float flash;
  float skyHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
  float skyNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(skyHash(i), skyHash(i + vec2(1, 0)), f.x), mix(skyHash(i + vec2(0, 1)), skyHash(i + vec2(1, 1)), f.x), f.y);
  }
  // A northern sky: pale at the horizon, a clear cold blue overhead, and high thin cloud
  // drifting over it; the sun; at night deep blue with stars.
  vec3 skyColor(vec3 d, float time) {
    float h = clamp(d.y, -0.2, 1.0);
    vec3 zenith = vec3(0.30, 0.52, 0.92);
    vec3 horizon = vec3(0.86, 0.92, 0.98);
    vec3 sky = mix(horizon, zenith, pow(max(h, 0.0), 0.55)) * 2.4;
    vec2 q = d.xz / max(d.y + 0.12, 0.05);
    float clouds = skyNoise(q * 0.9 + time * 0.004) * 0.55 + skyNoise(q * 2.3 - time * 0.006) * 0.3 + skyNoise(q * 5.1) * 0.15;
    float cover = smoothstep(0.62 - cloud * 0.45, 0.95 - cloud * 0.3, clouds) * smoothstep(0.0, 0.18, h);
    sky = mix(sky, vec3(2.3, 2.35, 2.4) * (0.75 + 0.25 * clouds), cover * 0.85);
    sky *= skyLevel;
    vec2 starCell = floor(q * 60.0);
    float star = step(0.9975, skyHash(starCell)) * (0.6 + 0.4 * sin(time * 2.0 + skyHash(starCell + 3.0) * 30.0));
    sky += vec3(0.8, 0.85, 1.0) * star * night * (1.0 - cover) * smoothstep(0.05, 0.3, h) * 0.8;
    float toward = max(dot(d, sunDirection), 0.0);
    sky += sunColor * (pow(toward, 1400.0) * 70.0 + pow(toward, 12.0) * 0.9 * (1.0 - cover * 0.6)) * sun;
    // The northern lights: curtains across the northern half of the sky, their lower hem
    // folding and drifting, green at the foot and fading to violet high up, streaked with
    // rays that shimmer.
    if (aurora > 0.001) {
      float az = atan(d.z, d.x);
      float north = smoothstep(-0.35, 0.45, -d.z / max(length(d.xz), 1e-3));
      float hem = 0.16 + 0.07 * sin(az * 3.0 + time * 0.045) + 0.04 * sin(az * 7.0 - time * 0.07) + 0.02 * skyNoise(vec2(az * 6.0, time * 0.05));
      float above = h - hem;
      float curtain = smoothstep(-0.015, 0.02, above) * exp(-max(above, 0.0) * 5.5);
      float rays = 0.45 + 0.55 * skyNoise(vec2(az * 60.0 + time * 0.12, time * 0.35));
      float folds = 0.55 + 0.45 * sin(az * 11.0 + 2.0 * skyNoise(vec2(az * 3.0, time * 0.03)) + time * 0.08);
      vec3 hue = mix(vec3(0.15, 1.0, 0.45), vec3(0.55, 0.25, 0.95), smoothstep(0.04, 0.3, above));
      sky += hue * curtain * rays * folds * north * aurora * night * (1.0 - cover * 0.8) * 1.6;
    }
    // Lightning: the cloud lit from within, for an instant.
    sky += vec3(0.75, 0.8, 1.0) * flash * (0.6 + 1.4 * cover) * smoothstep(-0.05, 0.25, h) * 3.0;
    // Below the horizon: the far shore, dark and green.
    sky = mix(sky, vec3(0.05, 0.07, 0.05) * max(skyLevel.g, 0.03), smoothstep(0.0, -0.08, d.y));
    return sky;
  }
`;

export function createSky(scene) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms, waterTime },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float waterTime;
      varying vec3 vDirection;
      ${skyGLSL}
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDirection), waterTime), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = "Sky";
  scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------------------
// The bed.
//
// Photographed ground (Poly Haven, CC0): rounded river pebbles, rough brook stones, sand,
// forest mud with its litter of leaves and twigs, and rock face -- blended by what the course
// says the bed is made of at each point, with the pebbles standing proud of the sand that
// fills between them. Rock is laid on from all three axes so cliffs and ledges do not smear.
// Over it grows what the light allows: a brown diatom film, green algae, and in the brook
// dark fontinalis moss on the stones. Above the waterline the same ground turns to a dark
// wet band and then the heath and needles of the forest floor.
const bedGLSL = /* glsl */ `
  varying vec4 vGround;
  varying vec3 vBedNormal;
  varying float vShore;
  varying float vMossy;
  varying float vRough;
  uniform sampler2D pebbleMap;
  uniform sampler2D pebbleNormal;
  uniform sampler2D stonesMap;
  uniform sampler2D stonesNormal;
  uniform sampler2D sandMap;
  uniform sampler2D sandNormal;
  uniform sampler2D mudMap;
  uniform sampler2D mudNormal;
  uniform sampler2D rockMap;
  uniform sampler2D rockNormal;
  uniform sampler2D landMap;
  uniform vec3 bedTint;
  vec3 gBedNormal = vec3(0.0, 1.0, 0.0);
  float gBedRough = 0.9;
  float bedHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float bedNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(bedHash(i), bedHash(i + vec2(1, 0)), f.x), mix(bedHash(i + vec2(0, 1)), bedHash(i + vec2(1, 1)), f.x), f.y);
  }
  // A tangent-space normal from a GL normal map, laid flat in the world's x-z plane.
  vec3 flatNormal(sampler2D map, vec2 uv) {
    vec3 n = texture2D(map, uv).xyz * 2.0 - 1.0;
    return vec3(n.x, n.z, n.y);
  }
  // Two samples at different scales and angles, so the repeat of a tile never shows.
  vec3 twoScale(sampler2D map, vec2 p, float scale) {
    vec2 a = p * scale;
    vec2 b = mat2(0.8, -0.6, 0.6, 0.8) * p * scale * 0.37 + 0.31;
    return mix(texture2D(map, a).rgb, texture2D(map, b).rgb, 0.35);
  }
`;

export async function createBedMaterial() {
  const loader = new THREE.TextureLoader();
  const base = "./assets/";
  const load = async (name, srgb) => {
    const t = await loader.loadAsync(`${base}${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const maps = await Promise.all([
    load("ganges_river_pebbles_diff", true),
    load("ganges_river_pebbles_nor_gl", false),
    load("river_small_rocks_diff", true),
    load("river_small_rocks_nor_gl", false),
    load("damp_sand_diff", true),
    load("damp_sand_nor_gl", false),
    load("mud_forest_diff", true),
    load("mud_forest_nor_gl", false),
    load("rock_face_03_diff", true),
    load("rock_face_03_nor_gl", false),
    load("forest_ground_04_diff", true),
  ]);
  const [pebbleMap, pebbleNormal, stonesMap, stonesNormal, sandMap, sandNormal, mudMap, mudNormal, rockMap, rockNormal, landMap] = maps;
  const tint = { value: new THREE.Color(1, 1, 1) };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      pebbleMap: { value: pebbleMap },
      pebbleNormal: { value: pebbleNormal },
      stonesMap: { value: stonesMap },
      stonesNormal: { value: stonesNormal },
      sandMap: { value: sandMap },
      sandNormal: { value: sandNormal },
      mudMap: { value: mudMap },
      mudNormal: { value: mudNormal },
      rockMap: { value: rockMap },
      rockNormal: { value: rockNormal },
      landMap: { value: landMap },
      bedTint: tint,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 ground;
        attribute vec3 bedExtra;
        varying vec4 vGround;
        varying vec3 vBedNormal;
        varying float vShore;
        varying float vMossy;
        varying float vRough;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vGround = ground;
        vBedNormal = normal;
        vShore = bedExtra.x;
        vMossy = bedExtra.y;
        vRough = bedExtra.z;`,
      );
    waterLitShader(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${bedGLSL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        {
          vec3 P = vWaterPosition;
          vec3 Nw = normalize(vBedNormal);
          vec4 w = vGround / max(dot(vGround, vec4(1.0)), 1e-4);
          vec2 q = P.xz;
          vec3 color = vec3(0.0);
          float px = length(fwidth(q));
          vec3 tangentNormal = vec3(0.0);
          vec3 rockWorld = Nw;
          float rough = 0.0;

          // Gravel: rounded pebbles, rougher broken stones where the water is wild.
          if (w.x > 0.01) {
            vec3 pebbles = twoScale(pebbleMap, q, 1.0 / 21.6);
            vec3 pn = flatNormal(pebbleNormal, q / 21.6);
            vec3 stones = vec3(0.0);
            vec3 sn = vec3(0.0, 1.0, 0.0);
            if (vRough > 0.01) {
              stones = twoScale(stonesMap, q, 1.0 / 29.0);
              sn = flatNormal(stonesNormal, q / 29.0);
            }
            vec3 g = mix(pebbles, stones * vec3(0.95, 0.97, 1.0), vRough);
            vec3 gn = normalize(mix(pn, sn, vRough));
            // Sand settles in the hollows between the stones.
            float height = dot(g, vec3(0.3, 0.5, 0.2));
            float fill = w.y > 0.01 ? smoothstep(height + 0.05, height + 0.25, w.y * 0.9) : 0.0;
            w.y += w.x * fill;
            w.x *= 1.0 - fill;
            color += g * w.x;
            tangentNormal += gn * w.x;
            rough += 0.72 * w.x;
          }
          if (w.y > 0.01) {
            vec3 sand = twoScale(sandMap, q, 1.0 / 20.4) * vec3(0.78, 0.8, 0.82);
            color += sand * w.y;
            vec3 sn = flatNormal(sandNormal, q / 20.4);
            // Current ripples across the flow.
            float ripple = sin(P.x * 2.6 + 1.8 * sin(P.z * 0.37) + 0.6 * sin(P.z * 1.1 + P.x * 0.2));
            sn.x += cos(P.x * 2.6 + 1.8 * sin(P.z * 0.37)) * 0.12;
            tangentNormal += normalize(sn) * w.y;
            color -= sand * w.y * 0.06 * smoothstep(0.3, 1.0, -ripple);
            rough += 0.9 * w.y;
          }
          if (w.z > 0.01) {
            color += twoScale(mudMap, q, 1.0 / 23.5) * 0.85 * w.z;
            tangentNormal += flatNormal(mudNormal, q / 23.5) * w.z;
            rough += 0.95 * w.z;
          }
          if (w.w > 0.01) {
            vec3 b = pow(abs(Nw), vec3(4.0));
            b /= dot(b, vec3(1.0));
            float s = 1.0 / 27.0;
            vec3 rock = texture2D(rockMap, P.zy * s).rgb * b.x + texture2D(rockMap, P.xz * s).rgb * b.y + texture2D(rockMap, P.xy * s).rgb * b.z;
            // A cooler, greyer rock than the photograph: northern granite and gneiss.
            rock = mix(vec3(dot(rock, vec3(0.3, 0.55, 0.15))), rock, 0.45) * vec3(0.92, 0.95, 1.0);
            color += rock * w.w;
            vec3 nx = texture2D(rockNormal, P.zy * s).xyz * 2.0 - 1.0;
            vec3 ny = texture2D(rockNormal, P.xz * s).xyz * 2.0 - 1.0;
            vec3 nz = texture2D(rockNormal, P.xy * s).xyz * 2.0 - 1.0;
            vec3 worldRock = normalize(
              vec3(nx.z * sign(Nw.x), nx.y, nx.x) * b.x +
              vec3(ny.x, ny.z * sign(Nw.y), ny.y) * b.y +
              vec3(nz.x, nz.y, nz.z * sign(Nw.z)) * b.z);
            rockWorld = worldRock;
            rough += 0.8 * w.w;
          }
          // Close up, the grit between the stones and in the sand: the same ground at a
          // scale thirty times finer, so nothing a small fish looks at is ever a smear.
          float closeUp = 1.0 - smoothstep(0.004, 0.03, px);
          if (closeUp > 0.0 && vShore < 0.2) {
            vec3 grit = texture2D(pebbleMap, q * 1.37 + 0.5).rgb;
            float gl = dot(grit, vec3(0.3, 0.5, 0.2));
            color *= mix(1.0, 0.72 + 0.7 * gl, closeUp * (0.55 * w.x + 0.35 * w.y + 0.3 * w.z));
            vec3 gn = flatNormal(pebbleNormal, q * 1.37 + 0.5);
            tangentNormal += vec3(gn.x, 0.0, gn.z) * closeUp * 0.6 * (w.x + w.y * 0.5);
          }
          color *= bedTint;

          // Growth: diatom film and algae where the light reaches, moss in the brook.
          float light = smoothstep(-0.2, 0.9, Nw.y);
          float patchNoise = bedNoise(q * 0.35) * 0.6 + bedNoise(q * 1.7 + 3.0) * 0.4;
          float film = (w.x * 0.8 + w.w + w.y * 0.2) * light * (0.4 + 0.6 * patchNoise);
          color = mix(color, color * vec3(0.8, 0.74, 0.5), film * 0.5);
          // Green algae in patches over the stones and gravel where the light is good,
          // then the darker moss cushions.
          float algaePatch = smoothstep(0.42, 0.78, bedNoise(q * 0.8 + 7.0) * 0.7 + patchNoise * 0.3);
          float algae = (0.25 + 0.75 * vMossy) * light * algaePatch * (w.x * 0.8 + w.w * 0.8 + w.y * 0.35);
          color = mix(color, color * vec3(0.55, 0.85, 0.35) + vec3(0.015, 0.035, 0.0), algae * 0.6);
          float moss = vMossy * smoothstep(0.36, 0.68, patchNoise + 0.25 * Nw.y) * (w.x * 0.7 + w.w + w.y * 0.2);
          vec3 mossColor = mix(vec3(0.035, 0.07, 0.02), vec3(0.1, 0.15, 0.04), bedNoise(q * 9.0));
          color = mix(color, mossColor, moss * 0.85);

          // Above the water: a dark wet band, then the forest floor, rock where it is steep.
          if (vShore > -0.05) {
            float wet = 1.0 - smoothstep(0.0, 0.9, vShore);
            float steep = 1.0 - smoothstep(0.55, 0.8, Nw.y);
            vec3 floorColor = twoScale(landMap, q, 1.0 / 31.5);
            float green = bedNoise(q * 0.07) * 0.6 + bedNoise(q * 0.3) * 0.4;
            floorColor = mix(floorColor, floorColor * vec3(0.55, 0.85, 0.35), smoothstep(0.35, 0.75, green) * 0.8);
            vec3 b = pow(abs(Nw), vec3(4.0));
            b /= dot(b, vec3(1.0));
            vec3 cliff = (texture2D(rockMap, P.zy / 27.0).rgb * b.x + texture2D(rockMap, P.xz / 27.0).rgb * b.y + texture2D(rockMap, P.xy / 27.0).rgb * b.z);
            cliff = mix(vec3(dot(cliff, vec3(0.3, 0.55, 0.15))), cliff, 0.4);
            vec3 dry = mix(floorColor, cliff, steep);
            vec3 land = mix(dry, color * 0.55, wet);
            color = mix(color, land, smoothstep(-0.05, 0.25, vShore));
          }
          diffuseColor.rgb *= color;
          // The flat maps tilt the geometric normal about their own frame; rock brings its
          // own world normal from the three projections.
          vec3 tn = normalize(tangentNormal + vec3(0.0, 1e-3, 0.0));
          vec3 up = Nw;
          vec3 reference = abs(up.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
          vec3 tx = normalize(reference - up * dot(reference, up));
          vec3 tz = normalize(cross(tx, up));
          vec3 flatWorld = normalize(tx * tn.x + up * tn.y + tz * tn.z);
          gBedNormal = normalize(mix(flatWorld, rockWorld, w.w));
          gBedRough = clamp(rough, 0.4, 1.0) + moss * 0.1;
        }
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(gBedNormal, 0.0)).xyz);
        `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = gBedRough;`,
      );
  };
  material.customProgramCacheKey = () => "salmon-bed-v2";
  material.userData.tint = tint;
  material.userData.maps = { rockMap, rockNormal, pebbleMap, pebbleNormal };
  return material;
}

// ---------------------------------------------------------------------------------------
// The water surface. From below: Snell's window and the mirror round it, as in the
// aquarium, with white water where the river breaks over rock. From above: the sky
// mirrored at a grazing angle, the dark body of the water looked into, and the sun's glint.
export const surfaceUniforms = {
  ...skyUniforms,
  waterTime,
  ripples: river.ripples,
  roughness: { value: 1 },
  rain: { value: 0 },
  body: { value: new THREE.Color(0.02, 0.06, 0.06) },
  fogColor: { value: new THREE.Color() },
  fogDensity: { value: 0.02 },
  // Winter: how much of the river here is frozen over (the riffles stay open longest).
  ice: { value: 0 },
  // The eddies round the fish (flowfield.js): white water trailing from the stones that
  // break the surface.
  ...eddyUniforms,
};

const rippleSlopeGLSL = /* glsl */ `
  uniform vec4 ripples[${RIPPLE_COUNT}];
  vec3 rippleSlope(vec2 q) {
    vec3 slope = vec3(0.0);
    for (int i = 0; i < ${RIPPLE_COUNT}; i++) {
      vec4 r = ripples[i];
      if (r.w <= 0.0) continue;
      vec2 d = q - r.xy;
      float dist = length(d);
      float x = dist - r.z * ${RIPPLE_SPEED.toFixed(2)};
      float envelope = r.w * exp(-x * x * 1.6) * (x < 0.0 ? 1.0 : exp(-x * 4.0)) / (1.0 + dist * 0.45);
      float wave = cos(x * 9.0);
      slope.xy += d / max(dist, 1e-3) * envelope * wave * 0.45;
      slope.z += envelope * max(0.0, wave);
    }
    return slope;
  }
`;

export function createSurfaceMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: surfaceUniforms,
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute float foam;
      attribute vec2 flow;
      varying vec3 vWorld;
      varying float vFoam;
      varying vec2 vFlow;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vFoam = foam;
        vFlow = flow;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float waterTime;
      uniform float roughness;
      uniform float rain;
      uniform float ice;
      uniform vec3 body;
      varying vec3 vWorld;
      varying float vFoam;
      varying vec2 vFlow;
      ${surfaceWavesGLSL}
      ${rippleSlopeGLSL}
      ${skyGLSL}
      ${eddyGLSL}
      float foamNoise(vec2 p) {
        return skyNoise(p) * 0.5 + skyNoise(p * 2.3 + 1.7) * 0.3 + skyNoise(p * 5.1 + 4.2) * 0.2;
      }
      vec2 rainSlope(vec2 q, float t) {
        vec2 slope = vec2(0.0);
        vec2 p = q / 0.8;
        vec2 cell = floor(p);
        for (int j = -1; j <= 1; j++)
          for (int i = -1; i <= 1; i++) {
            vec2 c = cell + vec2(float(i), float(j));
            float h = skyHash(c);
            float cycle = t * (0.8 + 0.7 * h) + h * 7.3;
            if (skyHash(c + floor(cycle) * 1.37) > rain) continue;
            float age = fract(cycle);
            vec2 d = p - c - vec2(skyHash(c + 3.1), skyHash(c + 7.7));
            float dist = length(d);
            float x = dist - age * 1.1;
            slope += d / max(dist, 1e-3) * sin(x * 30.0) * exp(-x * x * 50.0) * (1.0 - age) * (1.0 - age);
          }
        return slope * 0.14;
      }
      void main() {
        vec2 q = vWorld.xz;
        vec3 waves = surfaceWaves(q, waterTime, roughness);
        vec2 swell = vec2(
          0.035 * cos(q.x * 0.21 + q.y * 0.07 - waterTime * 0.6) + 0.02 * cos(q.x * 0.37 - q.y * 0.19 - waterTime * 0.9),
          0.018 * cos(q.x * 0.11 + q.y * 0.29 - waterTime * 0.5) - 0.015 * cos(q.x * 0.37 - q.y * 0.19 - waterTime * 0.9));
        vec3 rings = rippleSlope(q);
        // Round a stone that breaks the surface (or nearly): the water heaped up before it
        // and parting, a trail of broken, whirling water behind it.
        vec4 eddy = eddyAt(q);
        float reach = smoothstep(0.25, 0.8, eddy.w) * smoothstep(0.3, 2.0, length(vFlow));
        vec2 stir = eddy.xy * reach;
        float wake = reach * clamp(length(eddy.xy) / max(length(vFlow), 0.6) + abs(eddy.z) * 0.08, 0.0, 1.5);
        // Fast water is broken water: the steeper and quicker, the rougher the skin.
        float chop = 1.0 + length(vFlow) * 0.25 + vFoam * 2.0 + wake * 1.2;
        vec2 slope = (waves.xy * 1.8 + swell) * chop + rings.xy + stir * 0.035;
        // Far off the fine ripples are finer than a pixel: calm them rather than let them
        // alias into a checkerboard.
        float footprint = length(fwidth(q));
        slope *= 1.0 / (1.0 + footprint * 6.0);
        if (rain > 0.01) slope += rainSlope(q, waterTime) * min(1.0, rain * 1.5);
        // Ice: a still sheet over the slow water, its edge ragged; the white water of the
        // riffles and the falls stays open.
        float iceHere = ice * (1.0 - smoothstep(0.3, 0.75, vFoam + length(vFlow) * 0.02));
        iceHere = smoothstep(0.15, 0.4, iceHere + (foamNoise(q * 0.07) - 0.5) * 0.5 * ice);
        slope *= 1.0 - iceHere;
        // White water: lace of foam carried with the flow, torn into strands along it, and
        // thickest where the river breaks.
        // (What the eddies add is carried in two phases a little apart and blended, so the
        // lace follows the whirls without being dragged out further and further.)
        vec2 alongFlow = normalize(vFlow + stir + vec2(1e-3, 0.0));
        float phase = fract(waterTime / 1.6);
        float foamField = 0.0;
        for (int p = 0; p < 2; p++) {
          float t = fract(phase + float(p) * 0.5);
          float weight = 1.0 - abs(2.0 * t - 1.0);
          vec2 carried = q - vFlow * waterTime * 0.9 - stir * t * 1.6 * 0.9 + float(p) * 7.3;
          vec2 stretched = vec2(dot(carried, alongFlow) * 0.45, dot(carried, vec2(-alongFlow.y, alongFlow.x)));
          foamField += (foamNoise(stretched * 2.2) * 0.55 + foamNoise(stretched * 6.3 + 3.0) * 0.3 + foamNoise(carried * 15.0) * 0.15) * weight;
        }
        vec2 carried = q - vFlow * waterTime * 0.9;
        float foamy = max(vFoam, wake * 0.55);
        float threshold = 1.05 - foamy * 0.75;
        float foam = smoothstep(threshold, threshold + 0.18, foamField) * min(1.0, foamy * 2.0);
        // Bubbles: fine speckle through the lace.
        foam *= 0.75 + 0.25 * step(0.35, foamNoise(carried * 40.0));
        vec3 incident = normalize(vWorld - cameraPosition);
        vec3 color;
        float daylit = clamp(max(skyLevel.r, max(skyLevel.g, skyLevel.b)), 0.02, 1.2);
        if (cameraPosition.y < vWorld.y) {
          // From below.
          vec3 normal = normalize(vec3(slope.x, -1.0, slope.y));
          float cosi = clamp(-dot(incident, normal), 0.0, 1.0);
          const float eta = 1.333;
          float k = 1.0 - eta * eta * (1.0 - cosi * cosi);
          float fresnel = 1.0;
          color = vec3(0.0);
          if (k > 0.0) {
            float cost = sqrt(k);
            float rs = (eta * cosi - cost) / (eta * cosi + cost);
            float rp = (cosi - eta * cost) / (cosi + eta * cost);
            fresnel = 0.5 * (rs * rs + rp * rp);
            vec3 transmitted = normalize(eta * incident + (eta * cosi - cost) * normal);
            color += skyColor(transmitted, waterTime) * (1.0 - fresnel);
          }
          vec3 mirrored = reflect(incident, normal);
          vec3 riverColor = underwaterInscatter(mirrored) * 1.35;
          float bedSeen = smoothstep(-0.1, -0.45, mirrored.y);
          riverColor = mix(riverColor, fogColor * vec3(1.6, 1.5, 1.1) * (0.55 + 0.6 * sun) * daylit, bedSeen * 0.35);
          float edge = smoothstep(0.35, 0.72, cosi);
          color += riverColor * fresnel * (1.0 + 0.9 * edge);
          color += vec3(0.9, 1.0, 1.0) * rings.z * (0.6 + 0.8 * sun) * daylit;
          // Foam from below: milky and lit through, never a flat white.
          color = mix(color, vec3(1.25, 1.35, 1.35) * (0.25 + 0.75 * daylit) * (0.75 + 0.25 * foamField), foam * 0.7);
          // Under the ice: a grey-blue ceiling, the light coming through it milky, crazed
          // with cracks and dotted with trapped air.
          if (iceHere > 0.0) {
            float crack = 1.0 - smoothstep(0.0, 0.012, abs(foamNoise(q * 0.09 + 3.0) - 0.5));
            float air = step(0.86, foamNoise(q * 6.0 + 2.0)) * (0.4 + 0.6 * foamNoise(q * 19.0));
            float clouded = foamNoise(q * 0.13) * 0.6 + foamNoise(q * 0.5 + 9.0) * 0.4;
            vec3 under = vec3(0.42, 0.53, 0.6) * (0.18 + 0.82 * daylit) * (0.78 + 0.3 * clouded);
            under *= 1.0 - 0.3 * crack;
            under += vec3(0.22, 0.24, 0.25) * air * (0.2 + 0.8 * daylit);
            color = mix(color, under, iceHere);
          }
          float away = length(vWorld - cameraPosition);
          color = mix(color, underwaterInscatter(incident), smoothstep(22.0, 90.0, away) * 0.7);
        } else {
          // From above.
          vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
          vec3 mirrored = reflect(incident, normal);
          mirrored.y = abs(mirrored.y);
          float cosi = clamp(-dot(incident, normal), 0.0, 1.0);
          float fresnel = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);
          vec3 sky = skyColor(mirrored, waterTime);
          vec3 into = body * (0.4 + 0.6 * daylit) * (1.0 + 0.4 * sun);
          color = mix(into, sky, fresnel);
          color = mix(color, vec3(2.2, 2.25, 2.25) * (0.2 + 0.8 * daylit), foam * 0.92);
          // Snow on the ice.
          color = mix(color, vec3(1.9, 1.95, 2.05) * (0.2 + 0.8 * daylit) * (0.85 + 0.15 * foamNoise(q * 0.4)), iceHere);
        }
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
      }
    `,
  });
  material.customProgramCacheKey = () => "salmon-surface-v3";
  return material;
}

// ---------------------------------------------------------------------------------------
// A fall's curtain: a sheet of white water streaming off the lip, torn into ropes and
// spray, lit by the day. Seen from the pool below through the water, from above in a leap.
export function createCurtainMaterial({ under = false } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), waterTime, light: { value: 1 }, uFrom: { value: -1e3 }, uTo: { value: 1e3 } },
    defines: under ? { UNDER: "" } : {},
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float waterTime;
      uniform float light;
      uniform float uFrom;
      uniform float uTo;
      varying vec2 vUv;
      varying vec3 vWorld;
      float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n1(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        float t = waterTime;
        #ifdef UNDER
          // Under the surface the falling water goes on down as a column of air beaten into
          // the pool: dense and white where it enters, torn into streaks and billows below,
          // fading out as the bubbles slow and turn back up. uv.y from 0 at the surface to 1
          // at the bottom of the plunge.
          vec2 pu = vec2(vUv.x * 0.8, vUv.y * 3.0 - t * 1.9);
          float jets = n1(vec2(vUv.x * 0.9, t * 0.07)) * 0.55 + n1(vec2(vUv.x * 2.7, 3.0 + t * 0.11)) * 0.45;
          float streaks = n1(pu * vec2(4.0, 0.7)) * 0.5 + n1(pu * vec2(11.0, 1.8) + 5.0) * 0.3 + n1(pu * vec2(27.0, 5.0) + 9.0) * 0.2;
          float billow = n1(vec2(vUv.x * 1.3, vUv.y * 2.2 - t * 0.6) + 11.0);
          float mass = smoothstep(0.3, 0.8, jets * 0.55 + streaks * 0.45 + billow * 0.3 - vUv.y * 0.25);
          float fadeDown = 1.0 - smoothstep(0.15, 1.0, vUv.y + (billow - 0.5) * 0.35);
          float edgeU = min(vUv.x - uFrom, uTo - vUv.x);
          float a = mass * fadeDown * smoothstep(0.0, 1.5, edgeU + (n1(vec2(vUv.y * 5.0 - t, vUv.x)) - 0.5) * 1.2) * 0.8;
          // Brightest right under the surface where the light comes in; a bluish glow deeper.
          vec3 c = mix(vec3(0.62, 0.8, 0.84), vec3(1.35, 1.45, 1.45), (1.0 - smoothstep(0.0, 0.7, vUv.y)) * (0.5 + 0.5 * streaks));
          gl_FragColor = vec4(c * light, a);
        #else
        // uv.x across the lip in units, uv.y down the fall from 0 at the lip to 1.
        vec2 p = vec2(vUv.x * 0.7, vUv.y * 5.0 - t * 2.6);
        float ropes = n1(vec2(vUv.x * 1.6, 0.0) + vec2(0.0, t * 0.05)) * 0.6 + n1(vec2(vUv.x * 4.3, 1.0)) * 0.4;
        float streak = n1(p * vec2(3.0, 0.6)) * 0.55 + n1(p * vec2(9.0, 1.6) + 3.0) * 0.3 + n1(p * vec2(23.0, 4.0) + 7.0) * 0.15;
        float body = smoothstep(0.25, 0.75, ropes * 0.6 + streak * 0.7);
        // It thickens and whitens as it falls and breaks up into spray.
        float alpha = mix(0.35, 0.85, smoothstep(0.0, 0.6, vUv.y)) * mix(0.3, 1.0, body);
        // Ragged at the sides, thin where it leaves the lip.
        float edge = min(vUv.x - uFrom, uTo - vUv.x);
        alpha *= smoothstep(0.0, 1.2, edge + (n1(vec2(vUv.y * 6.0 - t * 2.0, vUv.x)) - 0.5) * 0.8);
        alpha *= smoothstep(0.0, 0.12, vUv.y + 0.02);
        vec3 color = mix(vec3(0.5, 0.66, 0.66), vec3(1.5, 1.6, 1.6), smoothstep(0.0, 0.45, vUv.y) * (0.45 + 0.55 * body));
        color *= light;
        gl_FragColor = vec4(color, alpha);
        #endif
        #include <fog_fragment>
      }
    `,
  });
  material.customProgramCacheKey = () => (under ? "salmon-curtain-under-v1" : "salmon-curtain-v1");
  return material;
}

// Bubbles and spray: soft round points, bright where they catch the light.
export function createBubbleMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), scale: { value: 400 }, light: { value: 1 } },
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute float size;
      attribute float alpha;
      uniform float scale;
      varying float vAlpha;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(size * scale / max(-mvPosition.z, 0.05), 1.0, 64.0);
        vAlpha = alpha * smoothstep(0.1, 0.6, -mvPosition.z);
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float light;
      varying float vAlpha;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float r = length(q);
        if (r > 0.5) discard;
        // A bubble is a silvery bead: a thin bright rim, a milky body, a highlight up and to
        // one side.
        float rim = smoothstep(0.38, 0.47, r) * (1.0 - smoothstep(0.47, 0.5, r));
        float body = 1.0 - smoothstep(0.2, 0.5, r);
        float glint = smoothstep(0.14, 0.0, length(q - vec2(-0.12, -0.14)));
        float a = (rim * 0.45 + body * 0.35 + glint * 0.9) * vAlpha;
        gl_FragColor = vec4(vec3(1.6, 1.75, 1.8) * light, a);
        #include <fog_fragment>
      }
    `,
  });
  material.customProgramCacheKey = () => "salmon-bubbles-v1";
  return material;
}

// ---------------------------------------------------------------------------------------
// Stones and wood. Boulders are laid over with photographed rock from all three axes in
// world space, so a boulder merged into a stretch of river needs no unwrapping, and carry a
// cap of moss and algae on the side that faces the light; how much depends on the river
// (thick in the shaded brook, a thin film in the big river, kelp-browns in the sea).
export async function createRockMaterials() {
  const loader = new THREE.TextureLoader();
  const load = async (name, srgb) => {
    const t = await loader.loadAsync(`./assets/${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const [mossy, mossyNormal, face, faceNormal, sea, seaNormal, bark, barkNormal] = await Promise.all([
    load("mossy_rock_diff", true),
    load("mossy_rock_nor_gl", false),
    load("rock_face_03_diff", true),
    load("rock_face_03_nor_gl", false),
    load("seaside_rock_diff", true),
    load("seaside_rock_nor_gl", false),
    load("pine_bark_diff", true),
    load("pine_bark_nor_gl", false),
  ]);
  const make = (map, normalMap, { scale, grey, moss, key }) => {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.rockMap = { value: map };
      shader.uniforms.rockNormal = { value: normalMap };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vRockNormal;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRockNormal = normalize(mat3(modelMatrix) * normal);");
      waterLitShader(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform sampler2D rockMap;
          uniform sampler2D rockNormal;
          varying vec3 vRockNormal;
          vec3 gRockWorldNormal = vec3(0.0, 1.0, 0.0);
          float rockHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float rockNoise(vec3 p) {
            vec3 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(rockHash(i), rockHash(i + vec3(1, 0, 0)), f.x), mix(rockHash(i + vec3(0, 1, 0)), rockHash(i + vec3(1, 1, 0)), f.x), f.y),
              mix(mix(rockHash(i + vec3(0, 0, 1)), rockHash(i + vec3(1, 0, 1)), f.x), mix(rockHash(i + vec3(0, 1, 1)), rockHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
          }`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          {
            vec3 P = vWaterPosition;
            vec3 Nw = normalize(vRockNormal);
            vec3 b = pow(abs(Nw), vec3(4.0));
            b /= dot(b, vec3(1.0));
            float s = ${(1 / scale).toFixed(5)};
            vec3 c = texture2D(rockMap, P.zy * s).rgb * b.x + texture2D(rockMap, P.xz * s).rgb * b.y + texture2D(rockMap, P.xy * s).rgb * b.z;
            c = mix(vec3(dot(c, vec3(0.3, 0.55, 0.15))), c, ${(1 - grey).toFixed(3)});
            vec3 nx = texture2D(rockNormal, P.zy * s).xyz * 2.0 - 1.0;
            vec3 ny = texture2D(rockNormal, P.xz * s).xyz * 2.0 - 1.0;
            vec3 nz = texture2D(rockNormal, P.xy * s).xyz * 2.0 - 1.0;
            gRockWorldNormal = normalize(
              vec3(nx.z * sign(Nw.x), nx.y, nx.x) * b.x +
              vec3(ny.x, ny.z * sign(Nw.y), ny.y) * b.y +
              vec3(nz.x, nz.y, nz.z * sign(Nw.z)) * b.z);
            gRockWorldNormal = normalize(mix(Nw, gRockWorldNormal, 0.8));
            // Moss and algae on the side facing the light.
            float n = rockNoise(P * 1.3) * 0.6 + rockNoise(P * 4.1) * 0.4;
            float cap = smoothstep(0.1, 0.75, Nw.y + (n - 0.5) * 0.7) * ${moss.toFixed(3)} * vColor.g;
            vec3 growth = mix(vec3(0.05, 0.085, 0.025), vec3(0.14, 0.17, 0.06), rockNoise(P * 11.0));
            diffuseColor.rgb = mix(c * vColor.r, growth, cap * 0.9);
          }`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          normal = normalize((viewMatrix * vec4(gRockWorldNormal, 0.0)).xyz);`,
        );
    };
    material.customProgramCacheKey = () => key;
    return material;
  };
  return {
    // Brook and upper river: lichen-grey stone under a coat of moss.
    brook: make(mossy, mossyNormal, { scale: 16, grey: 0.25, moss: 0.9, key: "salmon-rock-brook" }),
    // The big river and the falls: bare grey gneiss with a film.
    river: make(face, faceNormal, { scale: 22, grey: 0.6, moss: 0.35, key: "salmon-rock-river" }),
    // The sea: dark, barnacled, with red and brown algae.
    sea: make(sea, seaNormal, { scale: 14, grey: 0.2, moss: 0.25, key: "salmon-rock-sea" }),
    // Drowned trunks and roots.
    wood: make(bark, barkNormal, { scale: 9, grey: 0.1, moss: 0.5, key: "salmon-wood" }),
  };
}

// A puff of aerated water: a soft, lumpy, milky blot, lit from above.
export function createFoamCloudMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), scale: { value: 400 }, light: { value: 1 }, waterTime },
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute float size;
      attribute float alpha;
      attribute float seed;
      uniform float scale;
      varying float vAlpha;
      varying float vSeed;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(size * scale / max(-mvPosition.z, 0.1), 2.0, 512.0);
        // Thin out puffs right at the lens.
        vAlpha = alpha * smoothstep(size * 0.3, size * 1.2, -mvPosition.z);
        vSeed = seed;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float light;
      uniform float waterTime;
      varying float vAlpha;
      varying float vSeed;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float r = length(q) * 2.0;
        // The lumps churn: the noise turns slowly round the puff's middle, each puff its own
        // way, so the cloud rolls rather than slides.
        float turn = waterTime * (0.35 + vSeed * 0.5) * (vSeed > 0.5 ? 1.0 : -1.0);
        mat2 spin = mat2(cos(turn), -sin(turn), sin(turn), cos(turn));
        vec2 w = spin * q;
        float lumps = n(w * 4.0 + vSeed * 17.0) * 0.5 + n(w * 9.0 - vSeed * 9.0 + waterTime * 0.2) * 0.3 + n(q * 22.0 + vSeed * 5.0) * 0.2;
        float a = smoothstep(1.0, 0.25, r + (lumps - 0.5) * 0.9) * vAlpha;
        // Specks of bigger bubbles glinting inside.
        float specks = step(0.93, n(q * 36.0 + vSeed * 31.0 + vec2(0.0, waterTime * 0.8)));
        if (a < 0.003) discard;
        // Brighter on top, where it catches the light coming down; grey-blue underneath,
        // shadowed by itself.
        float lit = clamp(0.5 - q.y + (lumps - 0.5) * 0.6, 0.0, 1.0);
        vec3 c = mix(vec3(0.42, 0.56, 0.6), vec3(1.3, 1.38, 1.38), lit) * light;
        c += vec3(0.6) * specks * light;
        gl_FragColor = vec4(c, a);
        #include <fog_fragment>
      }
    `,
  });
  material.customProgramCacheKey = () => "salmon-foam-cloud-v2";
  return material;
}
