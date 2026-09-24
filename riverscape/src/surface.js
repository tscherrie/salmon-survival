import * as THREE from "three";
import { randomGenerator } from "./math.js";
import { CENTER } from "./layout.js";
import {
  FLOW_DIRECTION,
  RIPPLE_COUNT,
  RIPPLE_SPEED,
  SUN_DIRECTION,
  SURFACE_Y,
  river,
  waterLitShader,
  waterTime,
} from "./water.js";
import { surfaceWavesGLSL } from "./caustics.js";

// The underside of the surface, which from down here is the most striking thing in a
// clear river and the least like anything in air.
//
// Looked at from below, the surface is a window only straight overhead: light from the sky
// can reach the eye through it only within 48.6 degrees of the vertical, Snell's window.
// Beyond that angle the surface is a perfect mirror -- total internal reflection -- and
// what it shows is the river itself, hazy and blue-green. From a resting place near the
// bed the whole visible surface lies beyond the window, so it reads as a silvered ceiling;
// wherever a ripple tilts a facet steeply enough toward the eye, a fragment of window
// opens in it and the bright sky and the forest canopy flash through. The same waves that
// focus the caustics shape it, so the light on the sand and the ceiling move together.

const SURFACE_FLOW = FLOW_DIRECTION.clone().multiplyScalar(0.8);

export function createRipples() {
  const slots = river.ripples.value;
  const born = new Float32Array(RIPPLE_COUNT);
  const origins = Array.from({ length: RIPPLE_COUNT }, () => new THREE.Vector2());
  let next = 0;
  let clock = 0;
  return {
    // A ring starting at (x, z) on the surface; strength 1 is a pellet landing.
    add(x, z, strength = 1) {
      // A free slot if there is one, otherwise the ring with the least left in it.
      let slot = next,
        weakest = Infinity;
      for (let i = 0; i < RIPPLE_COUNT; i++) {
        const k = (next + i) % RIPPLE_COUNT;
        const left = slots[k].w * Math.max(0, 7 - (clock - born[k]));
        if (left < weakest) {
          weakest = left;
          slot = k;
        }
        if (left <= 0) break;
      }
      next = (slot + 1) % RIPPLE_COUNT;
      origins[slot].set(x, z);
      born[slot] = clock;
      slots[slot].set(x, z, 0, Math.min(1.6, strength));
      return slot;
    },
    update(dt) {
      clock += dt;
      for (let i = 0; i < RIPPLE_COUNT; i++) {
        const ring = slots[i];
        if (ring.w <= 0) continue;
        const age = clock - born[i];
        if (age > 7) {
          ring.w = 0;
          continue;
        }
        // The ring spreads from where it started as the whole film slides downstream.
        ring.x = origins[i].x + SURFACE_FLOW.x * age;
        ring.y = origins[i].y + SURFACE_FLOW.z * age;
        ring.z = age;
        ring.w *= Math.exp(-dt * 0.55);
      }
    },
  };
}

const rippleSlopeGLSL = /* glsl */ `
  uniform vec4 ripples[${RIPPLE_COUNT}];
  // x, y: the rings' slope; z: how much ring crest is here, for the glint along it.
  vec3 rippleSlope(vec2 q) {
    vec3 slope = vec3(0.0);
    for (int i = 0; i < ${RIPPLE_COUNT}; i++) {
      vec4 r = ripples[i];
      if (r.w <= 0.0) continue;
      vec2 d = q - r.xy;
      float dist = length(d);
      float x = dist - r.z * ${RIPPLE_SPEED.toFixed(2)};
      // A short train of rings behind the leading one, fading as it spreads.
      float envelope = r.w * exp(-x * x * 1.6) * (x < 0.0 ? 1.0 : exp(-x * 4.0)) / (1.0 + dist * 0.45);
      float wave = cos(x * 9.0);
      slope.xy += d / max(dist, 1e-3) * envelope * wave * 0.45;
      slope.z += envelope * max(0.0, wave);
    }
    return slope;
  }
`;

export function createSurface(scene, { reflections = false, leaves: withLeaves = true } = {}) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      roughness: { value: 1 },
      sun: { value: 1 },
      sunColor: { value: new THREE.Color(1.0, 0.95, 0.84) },
      // The sky's colour and brightness through the window: white-blue by day, amber at
      // the ends of it, deep blue with stars at night.
      skyLevel: { value: new THREE.Color(1, 1, 1) },
      night: { value: 0 },
      rain: { value: 0 },
    },
  ]);
  uniforms.waterTime = waterTime;
  uniforms.ripples = river.ripples;
  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
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
      uniform float roughness;
      uniform float sun;
      uniform vec3 sunColor;
      uniform vec3 skyLevel;
      uniform float night;
      uniform float rain;
      varying vec3 vWorld;
      ${surfaceWavesGLSL}
      ${rippleSlopeGLSL}
      const vec3 SUN = vec3(${SUN_DIRECTION.toArray().map((v) => v.toFixed(5)).join(", ")});
      float hash21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
      float valueNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
      }
      // The sky seen through a fragment of Snell's window: bright overcast-blue, the sun,
      // and the dark crowns of the gallery forest leaning in over the banks.
      vec3 skyThrough(vec3 d) {
        float h = clamp(d.y, 0.0, 1.0);
        vec3 sky = mix(vec3(0.95, 1.0, 1.02), vec3(0.42, 0.64, 0.98), pow(h, 0.7)) * 2.6;
        vec2 leaf = d.xz / max(d.y, 0.12) * 1.7;
        float crowns = valueNoise(leaf) * 0.6 + valueNoise(leaf * 2.7 + 3.1) * 0.4;
        float canopy = smoothstep(0.62, 0.28, h) * smoothstep(0.35, 0.6, crowns);
        sky = mix(sky, vec3(0.05, 0.1, 0.04), canopy * 0.9);
        sky *= skyLevel;
        // Stars, where the crowns leave the night sky open.
        vec2 starCell = floor(d.xz / max(d.y, 0.1) * 160.0);
        float star = step(0.9965, hash21(starCell)) * (0.5 + 0.5 * sin(waterTime * 3.0 + hash21(starCell + 5.0) * 40.0));
        sky += vec3(0.7, 0.8, 1.0) * star * night * (1.0 - canopy) * 0.6;
        float toward = max(dot(d, SUN), 0.0);
        sky += sunColor * (pow(toward, 1200.0) * 90.0 + pow(toward, 24.0) * 1.6) * sun;
        return sky;
      }
      // Rain: every drop that lands sends out a small ring. Drops fall on a grid of cells,
      // each cell's drop at its own rate and place, and the heavier the rain the more cells
      // are live; two sizes of cell so the pocking has no visible pattern.
      vec2 rainSlope(vec2 q, float t) {
        vec2 slope = vec2(0.0);
        for (int layer = 0; layer < 2; layer++) {
          float size = layer == 0 ? 0.9 : 0.55;
          vec2 p = q / size;
          vec2 cell = floor(p);
          for (int j = -1; j <= 1; j++)
            for (int i = -1; i <= 1; i++) {
              vec2 c = cell + vec2(float(i), float(j)) + float(layer) * 31.0;
              float h = hash21(c);
              float rate = 0.8 + 0.7 * h;
              float cycle = t * rate + h * 7.3;
              if (hash21(c + floor(cycle) * 1.37) > rain) continue;
              float age = fract(cycle);
              vec2 centre = c - float(layer) * 31.0 + vec2(hash21(c + 3.1), hash21(c + 7.7));
              vec2 d = p - centre;
              float dist = length(d);
              float x = dist - age * 1.1;
              float ring = sin(x * 30.0) * exp(-x * x * 50.0) * (1.0 - age) * (1.0 - age);
              slope += d / max(dist, 1e-3) * ring;
            }
        }
        return slope * 0.14;
      }
      void main() {
        vec3 waves = surfaceWaves(vWorld.xz, waterTime, roughness);
        // A slow swell under the fine ripples keeps the mirror from looking tiled.
        vec2 q = vWorld.xz;
        vec2 swell = vec2(
          0.035 * cos(q.x * 0.21 + q.y * 0.07 - waterTime * 0.6) + 0.02 * cos(q.x * 0.37 - q.y * 0.19 - waterTime * 0.9),
          0.018 * cos(q.x * 0.11 + q.y * 0.29 - waterTime * 0.5) - 0.015 * cos(q.x * 0.37 - q.y * 0.19 - waterTime * 0.9)
        );
        vec3 rings = rippleSlope(q);
        vec2 slope = waves.xy * 1.8 + swell + rings.xy;
        if (rain > 0.01) slope += rainSlope(q, waterTime) * min(1.0, rain * 1.5);
        vec3 normal = normalize(vec3(slope.x, -1.0, slope.y));
        vec3 incident = normalize(vWorld - cameraPosition);
        float cosi = clamp(-dot(incident, normal), 0.0, 1.0);
        const float eta = 1.333;
        float k = 1.0 - eta * eta * (1.0 - cosi * cosi);
        float fresnel = 1.0;
        vec3 color = vec3(0.0);
        if (k > 0.0) {
          float cost = sqrt(k);
          float rs = (eta * cosi - cost) / (eta * cosi + cost);
          float rp = (cosi - eta * cost) / (cosi + eta * cost);
          fresnel = 0.5 * (rs * rs + rp * rp);
          vec3 transmitted = normalize(eta * incident + (eta * cosi - cost) * normal);
          color += skyThrough(transmitted) * (1.0 - fresnel);
        }
        // The mirror shows the river: the same haze a level look into the distance sees,
        // brighter where the reflected ray runs down onto the lit bed nearby.
        vec3 mirrored = reflect(incident, normal);
        vec3 river = underwaterInscatter(mirrored) * 1.35;
        // Steeper reflections reach the sunlit sand and the meadow close by.
        float bed = smoothstep(-0.1, -0.45, mirrored.y);
        float daylit = clamp(max(skyLevel.r, max(skyLevel.g, skyLevel.b)), 0.02, 1.0);
        river = mix(river, vec3(0.42, 0.52, 0.36) * (0.55 + 0.6 * sun) * daylit, bed * 0.5);
        // Near the critical angle the mirror grows brighter still, a silver band.
        float edge = smoothstep(0.35, 0.72, cosi);
        color += river * fresnel * (1.0 + 0.9 * edge);
        // The crest of a ring tilts toward the window and catches the sky along its line.
        color += vec3(0.9, 1.0, 1.0) * rings.z * (0.6 + 0.8 * sun) * daylit;
        // Far off, the ceiling dissolves into the same haze as everything else.
        float away = length(vWorld - cameraPosition);
        color = mix(color, underwaterInscatter(incident), smoothstep(22.0, 75.0, away) * 0.7);
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
      }
    `,
  });
  material.customProgramCacheKey = () => "river-surface-v2";
  const geometry = new THREE.PlaneGeometry(280, 280, 1, 1);
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(CENTER.x, SURFACE_Y, CENTER.z);
  mesh.name = "Water surface";
  mesh.frustumCulled = false;
  scene.add(mesh);

  const leaves = withLeaves ? createFloatingLeaves(scene) : null;
  return {
    mesh,
    uniforms,
    leaves,
    update(dt, time, flow) {
      leaves?.update(dt, time, flow);
    },
  };
}

// Leaves fallen from the gallery forest ride the film downstream. From below they are
// dark shapes against the bright ceiling with the light glowing through their tissue, and
// their shadows cross the bed and cut the sun's shafts as they pass.
function leafGeometry() {
  const rows = 10,
    cols = 6;
  const positions = [],
    uvs = [],
    indices = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const half = 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.9);
    for (let j = 0; j <= cols; j++) {
      const u = (j / cols) * 2 - 1;
      // Curled up a little at the margins and along the midrib, as a floating leaf is.
      positions.push(t - 0.5, 0.06 * u * u + 0.03 * Math.sin(t * Math.PI), u * half);
      uvs.push(j / cols, t);
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
  geometry.computeVertexNormals();
  return geometry;
}

function createFloatingLeaves(scene) {
  const random = randomGenerator(66121);
  const range = (a, b) => a + (b - a) * random();
  const COUNT = 16;
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    waterLitShader(shader, {
      perLight: /* glsl */ `
        // Seen from below, a leaf on the film is lit through: the sun's light scattered
        // through the blade, warm where it has browned.
        reflectedLight.directDiffuse += lit.color * material.diffuseColor * vec3(0.55, 0.62, 0.3) * 0.5;
      `,
    });
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      /* glsl */ `
      #include <color_fragment>
      float vein = 1.0 - smoothstep(0.0, 0.05, abs(vLeafUv.x - 0.5));
      diffuseColor.rgb *= 0.85 + 0.3 * vein;
    `,
    ).replace("#include <common>", "#include <common>\nvarying vec2 vLeafUv;");
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vLeafUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLeafUv = uv;");
  };
  material.customProgramCacheKey = () => "floating-leaf-v1";
  const mesh = new THREE.InstancedMesh(leafGeometry(), material, COUNT);
  mesh.name = "Floating leaves";
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const colors = ["#6b5a24", "#7a4e1e", "#4d5a22", "#8a6a2a", "#5c3a18"];
  const leaves = Array.from({ length: COUNT }, (_, i) => {
    const leaf = {
      position: new THREE.Vector3(CENTER.x + range(-44, 44), SURFACE_Y - 0.035, CENTER.z + range(-34, 34)),
      velocity: new THREE.Vector3(),
      heading: range(0, Math.PI * 2),
      spin: range(-0.12, 0.12),
      size: range(0.7, 1.5),
      bob: range(0, Math.PI * 2),
    };
    mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]).multiplyScalar(range(0.8, 1.2)));
    return leaf;
  });
  scene.add(mesh);
  const object = new THREE.Object3D();
  const stir = new THREE.Vector3();
  return {
    leaves,
    update(dt, time, flow) {
      for (let i = 0; i < COUNT; i++) {
        const leaf = leaves[i];
        // The film moves a little faster than the water beneath it; a hand stirring near
        // the top pushes a leaf aside.
        leaf.velocity.copy(SURFACE_FLOW).multiplyScalar(0.9 + 0.2 * Math.sin(time * 0.05 + i));
        if (flow) {
          flow.sample(leaf.position, stir);
          leaf.velocity.x += stir.x;
          leaf.velocity.z += stir.z;
          leaf.spin += (stir.x * 0.3 - stir.z * 0.3) * dt;
        }
        leaf.position.addScaledVector(leaf.velocity, dt);
        leaf.spin *= Math.exp(-dt * 0.4);
        leaf.heading += (leaf.spin + 0.02 * Math.sin(time * 0.3 + i * 2)) * dt;
        if (leaf.position.x > CENTER.x + 46) {
          leaf.position.set(CENTER.x - 46, SURFACE_Y - 0.035, CENTER.z + range(-34, 34));
          leaf.size = range(0.7, 1.5);
        }
        leaf.bob += dt * 1.3;
        object.position.copy(leaf.position);
        object.position.y += Math.sin(leaf.bob) * 0.012;
        object.rotation.set(Math.sin(leaf.bob * 0.7) * 0.05, leaf.heading, Math.cos(leaf.bob) * 0.05);
        object.scale.setScalar(leaf.size);
        object.updateMatrix();
        mesh.setMatrixAt(i, object.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
