import * as THREE from "three";
import { EXTINCTION_RATIO } from "./fog.js";
import { surfaceWavesGLSL } from "./caustics.js";
import { SURFACE_Y, causticGLSL, river, waterTime } from "./water.js";

// Everything that happens after the scene is drawn: the sun's shafts through the water,
// the mirror of the river in the underside of the surface, bloom, and the final grade.
//
// The shafts are the sunlight scattered toward the eye by the water itself, integrated
// along each view ray through the same shadow map the scene uses and the same caustic net
// the bed shows. So the log, the grass, a fish and a floating leaf each cut a shaft of
// shadow through the water, and the shafts ripple exactly as the net does -- they are the
// net, seen edge on. They are marched at half resolution with a per-pixel jitter and
// joined back to the full-resolution image on depth, so a shaft never bleeds across the
// edge of something in front of it.
//
// Then the frames are joined in time. Each frame is drawn from a camera shifted by a
// different fraction of a pixel (a Halton sequence), and blended into the history of the
// frames before it, reprojected through the depth buffer so it stays put as the viewer
// drifts. That is sixteen samples per pixel for the price of one: ribbon grass a pixel wide
// stops crawling, edges settle, and the noise in the shafts averages away. Anything that
// moved and does not match the pixels around it any more is clamped back to them, which is
// what keeps a darting fish from leaving a ghost. The result is sharpened a touch, since
// blending in time softens.

const quadVertex = /* glsl */ `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;

function pass(fragmentShader, uniforms, defines = {}) {
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
    vertexShader: quadVertex,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
}

const target = (options = {}) =>
  new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    ...options,
  });

export function createPost(renderer, camera, settings) {
  const scene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  const run = (material, output) => {
    quad.material = material;
    renderer.setRenderTarget(output);
    renderer.render(scene, postCamera);
  };

  const main = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: settings.samples,
  });
  main.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const shafts = target();
  const bloomLevels = Array.from({ length: 5 }, () => target());

  const shared = {
    depth: { value: main.depthTexture },
    beauty: { value: main.texture },
    nearFar: { value: new THREE.Vector2(camera.near, camera.far) },
    projectionInverse: { value: new THREE.Matrix4() },
    projection: { value: new THREE.Matrix4() },
    sceneView: { value: new THREE.Matrix4() },
    cameraWorld: { value: new THREE.Matrix4() },
    cameraPos: { value: new THREE.Vector3() },
  };

  const shaftMaterial = pass(
    /* glsl */ `
      #include <packing>
      uniform sampler2D depth;
      uniform vec2 nearFar;
      uniform mat4 projectionInverse;
      uniform mat4 cameraWorld;
      uniform vec3 cameraPos;
      uniform sampler2D shadowMap;
      uniform mat4 shadowMatrix;
      uniform float hasShadow;
      uniform vec3 sunLight;
      uniform float density;
      uniform float scattering;
      uniform float frame;
      uniform vec2 size;
      uniform float waterTime;
      varying vec2 vUv;
      ${causticGLSL}
      const vec3 EXTINCTION = vec3(${EXTINCTION_RATIO.toArray().map((v) => v.toFixed(3)).join(", ")});
      float interleavedNoise(vec2 p) {
        return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
      }
      float henyeyGreenstein(float cosTheta, float g) {
        float g2 = g * g;
        return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5) * 0.0795775;
      }
      void main() {
        float z = texture2D(depth, vUv).x;
        vec4 view = projectionInverse * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 dirView = normalize(view.xyz / view.w);
        float viewZ = perspectiveDepthToViewZ(z, nearFar.x, nearFar.y);
        // Shafts are traced through the nearer water only; further off they have merged
        // into the even haze the fog already carries.
        float distance = min(viewZ / dirView.z, 48.0);
        vec3 dir = normalize((cameraWorld * vec4(dirView, 0.0)).xyz);
        float jitter = fract(interleavedNoise(gl_FragCoord.xy) + frame * 0.618034);
        float stepLength = distance / float(STEPS);
        vec3 sum = vec3(0.0);
        for (int i = 0; i < STEPS; i++) {
          float t = (float(i) + jitter) * stepLength;
          vec3 p = cameraPos + dir * t;
          float below = surfaceLevelAt(p) - p.y;
          if (below < 0.0) break;
          float lit = 1.0;
          if (hasShadow > 0.5) {
            vec4 sc = shadowMatrix * vec4(p, 1.0);
            sc.xyz /= sc.w;
            if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0)
              lit = step(sc.z - 0.003, unpackRGBAToDepth(texture2D(shadowMap, sc.xy)));
          }
          // Sun through the gaps in the crowns, and within each shaft the net seen from
          // inside: finer where it has formed, soft near the surface.
          vec2 q = surfacePoint(p);
          float open = canopyOpen(q, below * 0.6);
          float net = textureLod(causticMap, q / causticParams.x, 2.2 + 0.1 * abs(below - causticParams.z)).r;
          float beam = open * mix(1.0, net, 0.6 * smoothstep(0.2, 3.5, below) * causticParams.y);
          // Broad bands where the surface happens to be focusing more light overall.
          beam *= 0.7 + 0.6 * textureLod(causticMap, q / causticParams.x * 0.21 + vec2(waterTime * 0.004, 0.0), 6.0).r;
          vec3 down = exp(-vec3(0.030, 0.0085, 0.013) * below / LIGHT_DIRECTION.y);
          vec3 back = exp(-density * 1.8 * EXTINCTION * t);
          sum += lit * beam * down * back;
        }
        float phase = henyeyGreenstein(dot(dir, LIGHT_DIRECTION), 0.62) + 0.02;
        vec3 inscatter = sum * stepLength * sunLight * phase * scattering;
        gl_FragColor = vec4(inscatter, distance);
      }
    `,
    {
      ...shared,
      shadowMap: { value: null },
      shadowMatrix: { value: new THREE.Matrix4() },
      hasShadow: { value: 0 },
      sunLight: { value: new THREE.Vector3(1, 1, 1) },
      density: { value: 0.02 },
      scattering: { value: 0.034 },
      frame: { value: 0 },
      size: { value: new THREE.Vector2() },
      waterTime,
      causticMap: river.causticMap,
      causticParams: river.causticParams,
      ripples: river.ripples,
      canopyMap: river.canopyMap,
      canopyShift: river.canopyShift,
      canopyParams: river.canopyParams,
      waterLevel: river.waterLevel,
      waterShape: river.waterShape,
      waterStep: river.waterStep,
    },
    { STEPS: settings.shaftSteps },
  );

  // The march is jittered per pixel, so it is smoothed before use: a short Gaussian along
  // each axis that only mixes samples at a similar distance.
  const shaftsSpare = target();
  const shaftBlur = pass(
    /* glsl */ `
      uniform sampler2D source;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        vec4 centre = texture2D(source, vUv);
        vec3 sum = centre.rgb * 0.3;
        float weight = 0.3;
        for (int i = 1; i <= 3; i++) {
          float w = i == 1 ? 0.22 : i == 2 ? 0.1 : 0.04;
          for (int s = -1; s <= 1; s += 2) {
            vec4 tap = texture2D(source, vUv + texel * float(i * s));
            float similar = w / (1.0 + abs(tap.a - centre.a) * 2.0);
            sum += tap.rgb * similar;
            weight += similar;
          }
        }
        gl_FragColor = vec4(sum / weight, centre.a);
      }
    `,
    { source: { value: null }, texel: { value: new THREE.Vector2() } },
  );

  // Bloom: a soft threshold at half resolution, then a chain of blurred halvings added
  // back up. It is kept low -- underwater, only the sun, the window and the glints bloom.
  const bright = pass(
    /* glsl */ `
      uniform sampler2D beauty;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        vec3 c = vec3(0.0);
        c += texture2D(beauty, vUv + texel * vec2(-1.0, -1.0)).rgb;
        c += texture2D(beauty, vUv + texel * vec2(1.0, -1.0)).rgb;
        c += texture2D(beauty, vUv + texel * vec2(-1.0, 1.0)).rgb;
        c += texture2D(beauty, vUv + texel * vec2(1.0, 1.0)).rgb;
        c *= 0.25;
        // A stray non-number would be blurred across the whole bloom chain.
        if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float knee = smoothstep(1.1, 3.2, luma);
        gl_FragColor = vec4(min(c * knee, vec3(24.0)), 1.0);
      }
    `,
    { beauty: { value: null }, texel: { value: new THREE.Vector2() } },
  );
  const down = pass(
    /* glsl */ `
      uniform sampler2D source;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(source, vUv).rgb * 0.25;
        c += texture2D(source, vUv + texel * vec2(-1.0, -1.0)).rgb * 0.1875;
        c += texture2D(source, vUv + texel * vec2(1.0, -1.0)).rgb * 0.1875;
        c += texture2D(source, vUv + texel * vec2(-1.0, 1.0)).rgb * 0.1875;
        c += texture2D(source, vUv + texel * vec2(1.0, 1.0)).rgb * 0.1875;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    { source: { value: null }, texel: { value: new THREE.Vector2() } },
  );
  const up = pass(
    /* glsl */ `
      uniform sampler2D source;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        vec3 c = vec3(0.0);
        c += texture2D(source, vUv + texel * vec2(-1.0, 0.0)).rgb;
        c += texture2D(source, vUv + texel * vec2(1.0, 0.0)).rgb;
        c += texture2D(source, vUv + texel * vec2(0.0, -1.0)).rgb;
        c += texture2D(source, vUv + texel * vec2(0.0, 1.0)).rgb;
        gl_FragColor = vec4(c * 0.25, 1.0);
      }
    `,
    { source: { value: null }, texel: { value: new THREE.Vector2() } },
  );
  up.blending = THREE.AdditiveBlending;

  const composite = pass(
    /* glsl */ `
      #include <packing>
      uniform sampler2D beauty;
      uniform sampler2D depth;
      uniform sampler2D shafts;
      uniform sampler2D bloom;
      uniform vec2 size;
      uniform vec2 shaftSize;
      uniform vec2 nearFar;
      uniform float aoRadiusScale;
      uniform mat4 projectionInverse;
      uniform mat4 projection;
      uniform mat4 sceneView;
      uniform mat4 cameraWorld;
      uniform vec3 cameraPos;
      uniform float waterTime;
      uniform float reflectionStrength;
      uniform float bloomStrength;
      uniform float shaftStrength;
      uniform float grain;
      uniform vec4 waterLevel;
      uniform vec4 waterShape;
      uniform vec4 waterStep;
      varying vec2 vUv;
      ${surfaceWavesGLSL}
      float surfaceLevelAt(vec3 p) {
        float y = waterLevel.z + dot(waterShape.xy, p.xz - waterLevel.xy);
        if (waterShape.z > 0.0)
          y -= waterShape.z * smoothstep(-waterShape.w, waterShape.w, dot(p.xz - waterStep.xy, waterStep.zw));
        return y;
      }
      float linearDistance(vec2 p) {
        float z = texture2D(depth, p).x;
        return nearFar.x * nearFar.y / (nearFar.y - z * (nearFar.y - nearFar.x));
      }
      vec3 viewDirection(vec2 uv) {
        vec4 v = projectionInverse * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
        return normalize(v.xyz / v.w);
      }
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        vec3 color = texture2D(beauty, vUv).rgb;
        float center = linearDistance(vUv);

        // Contact shading from depth, as before: creases and the feet of things.
        float occlusion = 0.0;
        for (int i = 0; i < AO_SAMPLES; i++) {
          float a = float(i) * 2.399963;
          float radius = 2.5 + float(i) * AO_STEP;
          float sampleDepth = linearDistance(vUv + vec2(cos(a), sin(a)) * radius * aoRadiusScale / size);
          float difference = center - sampleDepth;
          occlusion += smoothstep(0.012, 0.13, difference) * (1.0 - smoothstep(0.2, 0.8, difference));
        }
        color *= 1.0 - occlusion * AO_GAIN;

        #if REFLECTIONS
        // The underside of the surface mirrors the river. Where this pixel is the surface,
        // march the reflected ray back down through the depth buffer and borrow whatever
        // it meets: a fish swimming just under the film is seen twice.
        {
          vec3 dirView = viewDirection(vUv);
          vec3 dir = normalize((cameraWorld * vec4(dirView, 0.0)).xyz);
          float along = center / max(-dirView.z, 1e-3);
          vec3 p = cameraPos + dir * along;
          if (abs(p.y - surfaceLevelAt(p)) < 0.05 && cameraPos.y < surfaceLevelAt(cameraPos)) {
            vec3 waves = surfaceWaves(p.xz, waterTime, 1.0);
            vec3 normal = normalize(vec3(waves.x * 1.8, -1.0, waves.y * 1.8));
            vec3 r = reflect(dir, normal);
            float travel = 0.6;
            vec3 hit = vec3(0.0);
            float found = 0.0;
            for (int i = 0; i < 20; i++) {
              vec3 q = p + r * travel;
              vec4 clip = projection * sceneView * vec4(q, 1.0);
              vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
              if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
              float sceneDistance = linearDistance(uv);
              float rayDistance = -(sceneView * vec4(q, 1.0)).z;
              float gap = rayDistance - sceneDistance;
              if (gap > 0.0 && gap < 0.6 + travel * 0.18) {
                hit = texture2D(beauty, uv).rgb;
                // The extra path from the surface down to what it shows is water too.
                hit = mix(color, hit, exp(-travel * 0.035));
                float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
                found = smoothstep(0.0, 0.08, edge) * (1.0 - smoothstep(10.0, 40.0, travel));
                break;
              }
              travel *= 1.28;
            }
            color = mix(color, hit, found * reflectionStrength);
          }
        }
        #endif

        // The shafts, joined to this pixel on depth.
        vec2 base = vUv * shaftSize - 0.5;
        vec2 f = fract(base);
        vec2 cell = (floor(base) + 0.5) / shaftSize;
        vec2 step2 = 1.0 / shaftSize;
        vec4 s00 = texture2D(shafts, cell);
        vec4 s10 = texture2D(shafts, cell + vec2(step2.x, 0.0));
        vec4 s01 = texture2D(shafts, cell + vec2(0.0, step2.y));
        vec4 s11 = texture2D(shafts, cell + step2);
        vec4 weights = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
        vec3 dirView = viewDirection(vUv);
        float rayLength = min(center / max(-dirView.z, 1e-3), 48.0);
        vec4 similar = vec4(
          1.0 / (0.02 + abs(s00.a - rayLength)),
          1.0 / (0.02 + abs(s10.a - rayLength)),
          1.0 / (0.02 + abs(s01.a - rayLength)),
          1.0 / (0.02 + abs(s11.a - rayLength)));
        weights *= similar;
        vec3 shaft = (s00.rgb * weights.x + s10.rgb * weights.y + s01.rgb * weights.z + s11.rgb * weights.w)
          / max(dot(weights, vec4(1.0)), 1e-5);
        color += shaft * shaftStrength;

        color += texture2D(bloom, vUv).rgb * bloomStrength;

        // Grade: a touch of lift into the blue-green in the shadows, warmth kept in the
        // lights, and a slight vignette as a mask's glass gives.
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(color, color * vec3(0.94, 1.02, 1.04), 1.0 - smoothstep(0.02, 0.4, luma));
        color = mix(vec3(luma), color, 1.08);
        vec2 v = (vUv - 0.5) * vec2(1.0, 0.8);
        color *= 1.0 - dot(v, v) * 0.35;
        gl_FragColor = vec4(max(color, 0.0), 1.0);
        #if !TAA
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb += (hash12(gl_FragCoord.xy + fract(waterTime) * 91.0) - 0.5) * grain;
        #endif
      }
    `,
    {
      ...shared,
      shafts: { value: shafts.texture },
      bloom: { value: bloomLevels[0].texture },
      size: { value: new THREE.Vector2() },
      shaftSize: { value: new THREE.Vector2() },
      aoRadiusScale: { value: 1 },
      waterTime,
      reflectionStrength: { value: 0.75 },
      waterLevel: river.waterLevel,
      waterShape: river.waterShape,
      waterStep: river.waterStep,
      bloomStrength: { value: 0.12 },
      shaftStrength: { value: 1 },
      grain: { value: 1.5 / 255 },
    },
    {
      AO_SAMPLES: settings.aoSamples,
      AO_STEP: (14.85 / (settings.aoSamples - 1)).toFixed(6),
      AO_GAIN: ((0.02 * 12) / settings.aoSamples).toFixed(6),
      REFLECTIONS: settings.reflections ? 1 : 0,
      TAA: settings.taa ? 1 : 0,
    },
  );

  // ---------------------------------------------------------------------------------
  // Temporal resolve. Colours are blended in a compressed range, c / (1 + max(c)), so one
  // blazing glint cannot dominate sixteen frames of average; the history is kept in that
  // range and only expanded again for the final picture.
  const hdr = target();
  const history = [target(), target()];
  let historyIndex = 0,
    historyValid = false,
    jitterIndex = 0;
  const previousViewProjection = new THREE.Matrix4();
  const viewProjection = new THREE.Matrix4();
  const unjittered = new THREE.Matrix4();
  const halton = (index, base) => {
    let f = 1,
      r = 0;
    for (let i = index; i > 0; i = Math.floor(i / base)) {
      f /= base;
      r += f * (i % base);
    }
    return r;
  };
  const JITTER = Array.from({ length: 16 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);
  const resolve = pass(
    /* glsl */ `
      uniform sampler2D current;
      uniform sampler2D history;
      uniform sampler2D depth;
      uniform mat4 inverseViewProjection;
      uniform mat4 previousViewProjection;
      uniform vec2 texel;
      uniform float historyValid;
      uniform float feedback;
      varying vec2 vUv;
      vec3 compress(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
      vec3 toYCoCg(vec3 c) {
        return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25)));
      }
      vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
      // A five-tap Catmull-Rom history fetch: bilinear would blur the picture a little more
      // every frame it is carried forward.
      vec3 sampleHistory(vec2 uv) {
        vec2 size = 1.0 / texel;
        vec2 position = uv * size;
        vec2 centre = floor(position - 0.5) + 0.5;
        vec2 f = position - centre;
        vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
        vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
        vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
        vec2 w3 = f * f * (-0.5 + 0.5 * f);
        vec2 w12 = w1 + w2;
        vec2 tc12 = (centre + w2 / w12) * texel;
        vec2 tc0 = (centre - 1.0) * texel;
        vec2 tc3 = (centre + 2.0) * texel;
        vec3 result =
          texture2D(history, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y) +
          texture2D(history, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y) +
          texture2D(history, vec2(tc12.x, tc12.y)).rgb * (w12.x * w12.y) +
          texture2D(history, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y) +
          texture2D(history, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
        float weight = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
        return max(result / weight, 0.0);
      }
      void main() {
        vec3 centre = toYCoCg(compress(texture2D(current, vUv).rgb));
        vec3 m1 = centre, m2 = centre * centre;
        vec3 low = centre, high = centre;
        // The nearest surface in the neighbourhood decides where this pixel came from, so
        // the edge of a fish carries its own motion rather than the background's.
        float nearest = texture2D(depth, vUv).x;
        vec2 nearestUv = vUv;
        for (int y = -1; y <= 1; y++)
          for (int x = -1; x <= 1; x++) {
            if (x == 0 && y == 0) continue;
            vec2 uv = vUv + vec2(float(x), float(y)) * texel;
            vec3 s = toYCoCg(compress(texture2D(current, uv).rgb));
            m1 += s;
            m2 += s * s;
            low = min(low, s);
            high = max(high, s);
            float d = texture2D(depth, uv).x;
            if (d < nearest) {
              nearest = d;
              nearestUv = uv;
            }
          }
        vec3 mean = m1 / 9.0;
        vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
        vec3 boxLow = max(low, mean - sigma * 1.25);
        vec3 boxHigh = min(high, mean + sigma * 1.25);

        vec4 world = inverseViewProjection * vec4(nearestUv * 2.0 - 1.0, nearest * 2.0 - 1.0, 1.0);
        world /= world.w;
        vec4 previous = previousViewProjection * world;
        vec2 previousUv = previous.xy / previous.w * 0.5 + 0.5 + (vUv - nearestUv);
        bool inside = all(greaterThan(previousUv, vec2(0.0))) && all(lessThan(previousUv, vec2(1.0)));

        vec3 result = centre;
        if (historyValid > 0.5 && inside) {
          vec3 past = toYCoCg(sampleHistory(previousUv));
          // Clip the history toward the neighbourhood's mean until it lies in the box.
          vec3 toPast = past - mean;
          vec3 extent = max(boxHigh - mean, vec3(1e-4)) ;
          vec3 extentLow = max(mean - boxLow, vec3(1e-4));
          vec3 scaled = abs(toPast) / mix(extentLow, extent, step(0.0, toPast));
          float outside = max(scaled.x, max(scaled.y, scaled.z));
          if (outside > 1.0) past = mean + toPast / outside;
          // Faster motion trusts the history less.
          float motion = length((vUv - previousUv) / texel);
          float blend = mix(feedback, 0.35, clamp(motion / 12.0, 0.0, 1.0));
          result = mix(past, centre, blend);
        }
        vec3 resolved = max(fromYCoCg(result), 0.0);
        // One bad pixel must never be carried forward for ever.
        if (any(isnan(resolved)) || any(isinf(resolved))) resolved = vec3(0.0);
        gl_FragColor = vec4(resolved, 1.0);
      }
    `,
    {
      current: { value: hdr.texture },
      history: { value: null },
      depth: { value: main.depthTexture },
      inverseViewProjection: { value: new THREE.Matrix4() },
      previousViewProjection: { value: new THREE.Matrix4() },
      texel: { value: new THREE.Vector2() },
      historyValid: { value: 0 },
      feedback: { value: 0.1 },
    },
  );
  const present = pass(
    /* glsl */ `
      uniform sampler2D resolved;
      uniform vec2 texel;
      uniform float sharpen;
      uniform float grain;
      uniform float waterTime;
      varying vec2 vUv;
      vec3 expand(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        vec3 c = texture2D(resolved, vUv).rgb;
        vec3 n = texture2D(resolved, vUv + vec2(0.0, texel.y)).rgb;
        vec3 s = texture2D(resolved, vUv - vec2(0.0, texel.y)).rgb;
        vec3 e = texture2D(resolved, vUv + vec2(texel.x, 0.0)).rgb;
        vec3 w = texture2D(resolved, vUv - vec2(texel.x, 0.0)).rgb;
        vec3 sharp = c + (4.0 * c - n - s - e - w) * sharpen;
        sharp = clamp(sharp, min(c, min(min(n, s), min(e, w))), max(c, max(max(n, s), max(e, w))));
        gl_FragColor = vec4(expand(max(sharp, 0.0)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb += (hash12(gl_FragCoord.xy + fract(waterTime) * 91.0) - 0.5) * grain;
      }
    `,
    {
      resolved: { value: null },
      texel: { value: new THREE.Vector2() },
      sharpen: { value: 0.16 },
      grain: { value: 1.5 / 255 },
      waterTime,
    },
  );

  // Shift the camera by this frame's fraction of a pixel. Undone again after the frame
  // (see render), so picking with the pointer always uses the true camera.
  let jittered = false;
  function jitter() {
    if (!settings.taa || !main.width) return;
    jittered = true;
    unjittered.copy(camera.projectionMatrix);
    const [jx, jy] = JITTER[jitterIndex];
    jitterIndex = (jitterIndex + 1) % JITTER.length;
    camera.projectionMatrix.elements[8] += (2 * jx) / main.width;
    camera.projectionMatrix.elements[9] += (2 * jy) / main.height;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  // Forget the history: after a resize or a jump of the camera.
  function resetHistory() {
    historyValid = false;
  }

  function setSize(width, height, scale) {
    main.setSize(width, height);
    const hw = Math.max(1, Math.round(width / 2)),
      hh = Math.max(1, Math.round(height / 2));
    shafts.setSize(hw, hh);
    shaftsSpare.setSize(hw, hh);
    let w = hw,
      h = hh;
    for (const level of bloomLevels) {
      level.setSize(Math.max(1, w), Math.max(1, h));
      w = Math.round(w / 2);
      h = Math.round(h / 2);
    }
    hdr.setSize(width, height);
    for (const h of history) h.setSize(width, height);
    historyValid = false;
    resolve.uniforms.texel.value.set(1 / width, 1 / height);
    present.uniforms.texel.value.set(1 / width, 1 / height);
    composite.uniforms.size.value.set(width, height);
    composite.uniforms.shaftSize.value.set(hw, hh);
    composite.uniforms.aoRadiusScale.value = scale / settings.referenceResolution;
    shaftMaterial.uniforms.size.value.set(hw, hh);
  }

  function render({ light, sunLight, density }) {
    camera.updateMatrixWorld();
    shared.projectionInverse.value.copy(camera.projectionMatrixInverse);
    shared.projection.value.copy(camera.projectionMatrix);
    shared.sceneView.value.copy(camera.matrixWorldInverse);
    shared.cameraWorld.value.copy(camera.matrixWorld);
    shared.cameraPos.value.setFromMatrixPosition(camera.matrixWorld);
    shared.nearFar.value.set(camera.near, camera.far);

    const shadow = light.shadow;
    shaftMaterial.uniforms.hasShadow.value = shadow.map ? 1 : 0;
    if (shadow.map) {
      shaftMaterial.uniforms.shadowMap.value = shadow.map.texture;
      shaftMaterial.uniforms.shadowMatrix.value.copy(shadow.matrix);
    }
    shaftMaterial.uniforms.sunLight.value.copy(sunLight);
    shaftMaterial.uniforms.density.value = density;
    shaftMaterial.uniforms.frame.value = (shaftMaterial.uniforms.frame.value + 1) % 64;
    run(shaftMaterial, shafts);
    shaftBlur.uniforms.source.value = shafts.texture;
    shaftBlur.uniforms.texel.value.set(1 / shafts.width, 0);
    run(shaftBlur, shaftsSpare);
    shaftBlur.uniforms.source.value = shaftsSpare.texture;
    shaftBlur.uniforms.texel.value.set(0, 1 / shafts.height);
    run(shaftBlur, shafts);

    bright.uniforms.beauty.value = main.texture;
    bright.uniforms.texel.value.set(1 / main.width, 1 / main.height);
    run(bright, bloomLevels[0]);
    for (let i = 1; i < bloomLevels.length; i++) {
      down.uniforms.source.value = bloomLevels[i - 1].texture;
      down.uniforms.texel.value.set(1 / bloomLevels[i - 1].width, 1 / bloomLevels[i - 1].height);
      run(down, bloomLevels[i]);
    }
    for (let i = bloomLevels.length - 1; i > 0; i--) {
      up.uniforms.source.value = bloomLevels[i].texture;
      up.uniforms.texel.value.set(1 / bloomLevels[i].width, 1 / bloomLevels[i].height);
      const previous = renderer.autoClear;
      renderer.autoClear = false;
      run(up, bloomLevels[i - 1]);
      renderer.autoClear = previous;
    }
    if (!settings.taa) {
      run(composite, null);
      return;
    }
    run(composite, hdr);
    // Where each pixel was a frame ago, from its depth: this frame's jittered camera back to
    // the world, the last frame's true camera forward again.
    resolve.uniforms.inverseViewProjection.value
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .invert();
    resolve.uniforms.previousViewProjection.value.copy(previousViewProjection);
    resolve.uniforms.history.value = history[historyIndex].texture;
    resolve.uniforms.historyValid.value = historyValid ? 1 : 0;
    const output = history[1 - historyIndex];
    run(resolve, output);
    present.uniforms.resolved.value = output.texture;
    run(present, null);
    historyIndex = 1 - historyIndex;
    historyValid = true;
    // Put the true camera back and remember it for the next frame.
    if (jittered) {
      camera.projectionMatrix.copy(unjittered);
      camera.projectionMatrixInverse.copy(unjittered).invert();
      jittered = false;
    }
    previousViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  return { main, setSize, render, composite, shaftMaterial, jitter, resetHistory };
}
