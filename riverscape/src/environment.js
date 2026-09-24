import * as THREE from "three";
import {
  channel,
  groundHeight,
  noise,
  random,
  randomGenerator,
  range,
  smoothstep,
  vec,
} from "./math.js";
import { CENTER, MOSS_COLONIES, ROCKS, THICKETS, WOOD, radial, rockCenterY } from "./layout.js";
import { waterLitShader } from "./water.js";

const TAU = Math.PI * 2;
const COLONIES = MOSS_COLONIES.map((c) => ({ ...c, center: vec(...c.center) }));

// Moss and a green algal turf settle where light reaches, where the current is sheltered,
// and where the wood has lain longest. Coverage runs 0 (bare) to 1 (dense turf). A slow
// noise field lowers the threshold unevenly, so patches sit at different stages of growth.
function mossCoverage(p, n, shelter, bias = 0) {
  let colony = 0;
  for (const c of COLONIES) {
    const d = p.distanceToSquared(c.center) / (c.radius * c.radius);
    colony = Math.max(colony, c.strength * Math.exp(-d * 1.6));
  }
  const patch =
    noise(p.x * 1.15 + 5.2, p.y * 1.15, p.z * 1.15) * 0.55 +
    noise(p.x * 3.4 + 1.7, p.y * 3.4, p.z * 3.4 + 8.4) * 0.45;
  const age = noise(p.x * 0.4 + 21.3, p.y * 0.4, p.z * 0.4 + 4.6);
  const exposure = 0.4 + 0.6 * Math.max(0, n.y);
  const value = patch * exposure + shelter * 0.25 + colony + bias;
  const threshold = 0.7 - age * 0.3;
  return smoothstep(threshold, threshold + 0.25, value);
}

// Writes per-vertex coverage into `geometry` (in world space through `matrix`) and returns
// the vertices that could carry fronds.
function growMoss(geometry, matrix, shelterAt, bias = 0) {
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const coverage = new Float32Array(positions.count);
  const samples = [];
  const p = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i).applyMatrix4(matrix);
    n.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
    const c = mossCoverage(p, n, shelterAt(p, i), bias);
    coverage[i] = c;
    if (c > 0.3)
      samples.push({ position: p.clone(), normal: n.clone(), coverage: c });
  }
  geometry.setAttribute("moss", new THREE.BufferAttribute(coverage, 1));
  return samples;
}

// The moss layer on rock, wood and sand: a thin algal film where growth is young, a dark
// velvety turf where it is established. Turf is rough, its fibres scatter light at grazing
// angles, and its fringe is broken up by fine noise.
const mossGLSL = /* glsl */ `
  varying float vMoss;
  uniform vec3 mossFilm;
  uniform vec3 mossTurf;
  float gMoss = 0.0;
  vec3 gMossColor = vec3(0.0);
  float mossHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float mossNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(mossHash(i), mossHash(i + vec3(1, 0, 0)), f.x), mix(mossHash(i + vec3(0, 1, 0)), mossHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(mossHash(i + vec3(0, 0, 1)), mossHash(i + vec3(1, 0, 1)), f.x), mix(mossHash(i + vec3(0, 1, 1)), mossHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;
export function mossLayer(material, film, turf, { extra = null, key = "mossy-surface-v4" } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.mossFilm = { value: new THREE.Color(film) };
    shader.uniforms.mossTurf = { value: new THREE.Color(turf) };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float moss; varying float vMoss;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMoss = moss;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${mossGLSL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        vec3 mossFuzz = vec3(0.0);
        if (vMoss > 0.02) {
          float mossFine = mossNoise(vWaterPosition * 9.0) * 0.6 + mossNoise(vWaterPosition * 27.0) * 0.4;
          gMoss = smoothstep(0.07, 0.5, vMoss + (mossFine - 0.5) * 0.45);
          gMossColor = mix(mossFilm, mossTurf, smoothstep(0.15, 0.85, vMoss)) * (0.6 + 0.8 * mossFine);
          #ifdef USE_COLOR
            gMossColor *= vColor;
          #endif
          diffuseColor.rgb = mix(diffuseColor.rgb, gMossColor, gMoss);
          mossFuzz = vec3(mossFine - 0.5, mossNoise(vWaterPosition * 31.0 + 7.0) - 0.5, fract(mossFine * 7.0) - 0.5);
        }
      `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, gMoss);",
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        normal = normalize(normal + gMoss * 0.5 * mossFuzz);
      `,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `
        #include <lights_fragment_end>
        float grazing = pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0);
        reflectedLight.indirectDiffuse += gMoss * grazing * gMossColor * 0.6;
      `,
      );
    if (extra) extra(shader);
    waterLitShader(shader);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// `base` is where the assets folder is, relative to the page, for other pages that share
// these materials.
export async function surface(loader, name, repeat, color, film, turf, options, base = "") {
  const [map, normalMap] = await Promise.all([
    loader.loadAsync(`${base}assets/${name}_diff.jpg`),
    loader.loadAsync(`${base}assets/${name}_nor_gl.jpg`),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, normalMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.anisotropy = 8;
  }
  return mossLayer(
    new THREE.MeshStandardMaterial({
      map,
      normalMap,
      color,
      roughness: 0.92,
      normalScale: new THREE.Vector2(0.65, 0.65),
      vertexColors: true,
    }),
    film,
    turf,
    options,
  );
}

// ---------------------------------------------------------------------------------------
// The sand. Current ripples run across the flow, their crests wandering and forking; the
// troughs hold a little dark organic grit. Where the sand is sheltered -- under the grass,
// in the lee of a stone -- the ripples fade out and a diatom film takes over.
const sandGLSL = /* glsl */ `
  varying float vSwept;
  vec3 gRipple = vec3(0.0);
  vec3 sandRipple(vec2 p) {
    float a = p.y * 0.43 + p.x * 0.06;
    float b = p.y * 1.13 - p.x * 0.21 + 1.3;
    float c = p.y * 2.7 + p.x * 0.37 + 0.4;
    float warp = 0.55 * sin(a) + 0.35 * sin(b) + 0.12 * sin(c);
    float dwarpX = 0.55 * 0.06 * cos(a) - 0.35 * 0.21 * cos(b) + 0.12 * 0.37 * cos(c);
    float dwarpZ = 0.55 * 0.43 * cos(a) + 0.35 * 1.13 * cos(b) + 0.12 * 2.7 * cos(c);
    float phase = p.x * 3.3 + warp * 2.4;
    float height = sin(phase) + 0.32 * sin(2.0 * phase + 0.9);
    float slope = cos(phase) + 0.64 * cos(2.0 * phase + 0.9);
    return vec3((3.3 + 2.4 * dwarpX) * slope, (2.4 * dwarpZ) * slope, height);
  }
`;
export function sandExtras(shader) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float swept; varying float vSwept;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSwept = swept;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${sandGLSL}`)
    .replace(
      "#include <color_fragment>",
      /* glsl */ `
      #include <color_fragment>
      {
        vec2 sp = vWaterPosition.xz;
        gRipple = sandRipple(sp);
        float rippleFade = vSwept * (1.0 - smoothstep(0.35, 1.2, fwidth(sp.x * 3.3)));
        gRipple *= rippleFade;
        diffuseColor.rgb *= 1.0 - 0.11 * smoothstep(0.2, 1.1, -gRipple.z);
        // Break the texture's repeat with slow colour drift across the bed.
        float drift = mossNoise(vec3(sp * 0.07, 1.7)) * 0.65 + mossNoise(vec3(sp * 0.23, 5.3)) * 0.35;
        diffuseColor.rgb *= mix(vec3(0.84, 0.86, 0.86), vec3(1.1, 1.06, 0.98), drift);
      }
    `,
    )
    .replace(
      "#include <normal_fragment_maps>",
      /* glsl */ `
      #include <normal_fragment_maps>
      {
        vec3 rippleSlope = vec3(gRipple.x, 0.0, gRipple.y) * 0.05;
        normal = normalize(normal - (viewMatrix * vec4(rippleSlope, 0.0)).xyz);
      }
    `,
    );
}

// Rounded limestone: a sphere cut back by soft planes, weathered by noise, with shallow
// solution pits and faint bedding. `round` pulls the cut planes out so the stone is
// water-worn rather than angular.
export function rockGeometry(seed, detail = 96, round = 1) {
  const geometry = new THREE.SphereGeometry(1, detail, Math.floor(detail * 0.7));
  const positions = geometry.attributes.position;
  const color = new THREE.Color();
  const colors = [];
  const planes = [];
  const sample = randomGenerator(Math.round(seed * 1000) + 27461);
  const pits = [];
  if (detail > 20)
    for (let i = 0; i < 60; i++) {
      const y = sample() * 2 - 1,
        a = sample() * Math.PI * 2,
        r = Math.sqrt(1 - y * y);
      const radius = 0.03 + sample() ** 2 * 0.14;
      pits.push({
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        radius,
        depth: radius * (0.15 + sample() * 0.4),
      });
    }
  for (let i = 0; i < 11; i++) {
    const a = i * 2.399963 + seed,
      y = 1 - (2 * (i + 0.5)) / 11,
      r = Math.sqrt(1 - y * y);
    planes.push({
      normal: vec(Math.cos(a) * r, y, Math.sin(a) * r),
      distance: 0.8 + 0.12 * round + noise(i, seed, 4) * 0.28,
    });
  }
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const a = noise(x * 2.1 + seed, y * 2.1, z * 2.1);
    const b = noise(x * 6 + seed, y * 6, z * 6);
    const c = noise(x * 19 + seed, y * 19, z * 19);
    const strata = Math.pow(Math.abs(Math.sin(x * 2.2 + y * 11 + z * 1.7 + a * 4)), 24);
    // Soft minimum over the cut planes, so edges are rounded by the water.
    let inverse = 0;
    for (const plane of planes) {
      const dot = x * plane.normal.x + y * plane.normal.y + z * plane.normal.z;
      if (dot > 0) inverse += Math.pow(dot / plane.distance, 6 + 4 * (1 - round));
    }
    let radius = Math.min(1.3, Math.pow(1 + inverse, -1 / (6 + 4 * (1 - round))) * 1.15);
    radius +=
      (a - 0.5) * 0.12 + (b - 0.5) * 0.04 + (c - 0.5) * 0.012 - strata * 0.012;
    let depression = 0;
    for (const pit of pits) {
      const d =
        Math.sqrt((x - pit.x) ** 2 + ((y - pit.y) * 1.1) ** 2 + (z - pit.z) ** 2) /
        pit.radius;
      if (d < 1) depression += pit.depth * (1 - d * d) ** 0.8;
    }
    radius -= Math.min(0.12, depression);
    positions.setXYZ(i, x * radius, y * radius, z * radius);
    color
      .setRGB(1, 0.985, 0.955)
      .multiplyScalar((0.82 + 0.2 * a) * (1 - Math.min(0.4, depression * 2.6)) * (1 - strata * 0.08));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function branchGeometry(points, baseRadius, tipRadius, seed, detail = true) {
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const rows = Math.ceil(length * (detail ? 22 : 14)),
    cols = detail ? 72 : 44;
  const positions = [],
    uv = [],
    indices = [],
    colors = [];
  const frames = curve.computeFrenetFrames(rows, false);
  const splitRandom = randomGenerator(Math.round(seed * 1000) + 51781);
  const splits = Array.from({ length: 14 }, () => ({
    a: splitRandom() * Math.PI * 2,
    t: splitRandom(),
    width: 0.025 + splitRandom() * 0.09,
    length: 0.025 + splitRandom() * 0.15,
    depth: 0.08 + splitRandom() * 0.32,
  }));
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      p = curve.getPointAt(t);
    const radius = THREE.MathUtils.lerp(baseRadius, tipRadius, Math.pow(t, 0.8));
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * Math.PI * 2;
      const ridges =
        0.077 * Math.sin(a * 9 + t * 12 + seed) +
        0.042 * Math.sin(a * 17 - t * 7) +
        0.022 * Math.sin(a * 31 + t * 33);
      const weather = noise(Math.cos(a) * 5 + seed, t * 30, Math.sin(a) * 5);
      const groove =
        Math.pow(0.5 + 0.5 * Math.sin(a * 13 + Math.sin(t * 15) * 0.25), 10) * 0.07;
      const knot = 1 + 0.15 * Math.exp(-(((t - 0.47) / 0.08) ** 2));
      let splitDepth = 0;
      for (const split of splits) {
        const angle = a - split.a - 0.07 * Math.sin(t * 37 + seed);
        const around = Math.atan2(Math.sin(angle), Math.cos(angle)) / split.width;
        const along = (t - split.t) / split.length;
        const distance = around * around + along * along;
        if (distance < 1) splitDepth += split.depth * Math.pow(1 - distance, 0.6);
      }
      const r =
        radius *
        knot *
        (1 + ridges + (weather - 0.5) * 0.3 - groove - Math.min(0.65, splitDepth));
      const radial = frames.normals[i]
        .clone()
        .multiplyScalar(Math.cos(a))
        .addScaledVector(frames.binormals[i], Math.sin(a));
      const v = p.clone().addScaledVector(radial, r);
      positions.push(v.x, v.y, v.z);
      uv.push(j / cols, length * t * 0.32);
      const tint =
        (0.7 + weather * 0.27 + ridges * 0.7 - groove) *
        (1 - Math.min(0.6, splitDepth * 1.5));
      colors.push(tint, tint * 0.97, tint * 0.92);
      if (i < rows && j < cols) {
        const k = i * (cols + 1) + j;
        indices.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
      }
    }
  }
  for (const i of [0, rows]) {
    const p = curve.getPointAt(i / rows),
      k = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    uv.push(0.5, 0.5);
    colors.push(0.38, 0.32, 0.23);
    for (let j = 0; j < cols; j++) {
      if (i === 0) indices.push(k, j + 1, j);
      else indices.push(k, i * (cols + 1) + j, i * (cols + 1) + j + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createContactShadows(scene, rocks) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 5, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,.8)");
  gradient.addColorStop(0.45, "rgba(0,0,0,.4)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    opacity: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  for (const rock of rocks) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(rock.rx * 3.2, rock.rz * 3.2),
      material,
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(rock.x, groundHeight(rock.x, rock.z) + 0.02, rock.z);
    scene.add(plane);
  }
}

// One moss frond: a short curved stem carrying pairs of tiny leaflets.
function frondGeometry() {
  const positions = [],
    colors = [],
    indices = [];
  const stem = new THREE.QuadraticBezierCurve3(
    vec(0, 0, 0),
    vec(0.02, 0.11, 0.01),
    vec(0.07, 0.2, 0.03),
  );
  const push = (p, color) => {
    positions.push(p.x, p.y, p.z);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };
  const stemColor = new THREE.Color("#3a5a1e");
  const segments = 4;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      p = stem.getPoint(t),
      radius = 0.0035 * (1 - 0.6 * t);
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * TAU;
      push(p.clone().add(vec(Math.cos(a) * radius, 0, Math.sin(a) * radius)), stemColor);
      if (i < segments) {
        const k = i * 3 + j,
          next = i * 3 + ((j + 1) % 3);
        indices.push(k, k + 3, next, next, k + 3, next + 3);
      }
    }
  }
  for (let i = 0; i < 6; i++) {
    const t = 0.2 + i * 0.15,
      base = stem.getPoint(t),
      tangent = stem.getTangent(t);
    for (const side of [-1, 1]) {
      const out = vec(side, 0.55 + 0.1 * (i % 2), 0.45 * side * (i % 2 ? 1 : -1)).normalize();
      out.addScaledVector(tangent, -out.dot(tangent) * 0.4).normalize();
      const across = new THREE.Vector3().crossVectors(out, tangent).normalize();
      const length = 0.042 * (1 - 0.08 * i),
        width = 0.017;
      const shade = new THREE.Color().setHSL(0.245 + 0.015 * side, 0.65, 0.22 + 0.05 * t);
      const a = push(base, shade);
      const b = push(base.clone().addScaledVector(out, length * 0.5).addScaledVector(across, width * 0.5), shade);
      const c = push(base.clone().addScaledVector(out, length), shade.clone().multiplyScalar(1.15));
      const d = push(base.clone().addScaledVector(out, length * 0.5).addScaledVector(across, -width * 0.5), shade);
      indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function plantFronds(scene, groups) {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => waterLitShader(shader);
  material.customProgramCacheKey = () => "moss-frond-v2";
  const fronds = new THREE.InstancedMesh(frondGeometry(), material, total);
  const object = new THREE.Object3D(),
    up = new THREE.Vector3(),
    color = new THREE.Color();
  let index = 0;
  for (const { samples, count, scale = 1 } of groups) {
    const weights = samples.map((s) => Math.max(0, s.coverage - 0.3) ** 2.2);
    const sum = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < count; i++) {
      if (!sum) break;
      let pick = random() * sum,
        j = 0;
      while (j < weights.length - 1 && pick > weights[j]) pick -= weights[j++];
      const { position, normal, coverage } = samples[j];
      up.copy(normal).lerp(vec(0, 1, 0), 0.4).normalize();
      up.add(vec(range(-0.3, 0.3), range(-0.15, 0.15), range(-0.3, 0.3))).normalize();
      object.position.copy(position).addScaledVector(normal, -0.01);
      object.quaternion.setFromUnitVectors(vec(0, 1, 0), up);
      object.rotateY(range(0, TAU));
      const size = (0.5 + coverage * 0.9) * range(0.5, 1.6) * scale;
      object.scale.set(size * range(0.8, 1.2), size, size * range(0.8, 1.2));
      object.updateMatrix();
      fronds.setMatrixAt(index, object.matrix);
      color.setHSL(0.24 + range(-0.02, 0.02), 0.55, 0.4 - coverage * 0.18 + range(-0.05, 0.05));
      fronds.setColorAt(index, color);
      index++;
    }
  }
  fronds.count = index;
  fronds.receiveShadow = true;
  scene.add(fronds);
}

// The bed as one mesh, in rings round the centre of the clearing out to the haze: fine
// where the viewer drifts and the ripples and grit are seen, coarse far off.
function riverbedGeometry(detail) {
  const rings = detail ? 230 : 190,
    segments = detail ? 460 : 380,
    reach = 92;
  const positions = [],
    uvs = [],
    colors = [],
    swept = [],
    indices = [];
  const vertex = (x, z) => {
      const y = groundHeight(x, z) + 0.01 * noise(x * 30, 0, z * 30);
      positions.push(x, y, z);
      uvs.push(x * 0.42, -z * 0.42);
      // Ambient occlusion: sand at the foot of a stone and under the grass sees less of
      // the lit water above it.
      let occlusion = 0;
      for (const rock of ROCKS) {
        const gap = Math.hypot((x - rock.x) / rock.rx, (z - rock.z) / rock.rz);
        occlusion = Math.max(occlusion, 0.55 * smoothstep(1.9, 0.9, gap));
      }
      let cover = 0;
      for (const bed of THICKETS)
        cover = Math.max(
          cover,
          smoothstep(bed.minX - 0.8, bed.minX + 0.8, x) *
            smoothstep(bed.maxX + 0.8, bed.maxX - 0.8, x) *
            smoothstep(bed.minZ - 0.8, bed.minZ + 0.8, z) *
            smoothstep(bed.maxZ + 0.8, bed.maxZ - 0.8, z),
        );
      const r = radial(x, z);
      cover = Math.max(cover, 0.7 * smoothstep(26, 29, r) * smoothstep(64, 58, r));
      const shade = (1 - occlusion) * (1 - 0.45 * cover);
      colors.push(shade, shade, shade);
      swept.push(Math.min(1, (1 - occlusion * 1.4) * (1 - cover)) * (0.55 + 0.45 * smoothstep(0, 0.6, channel(x, z) + 0.3)));
  };
  vertex(CENTER.x, CENTER.z);
  for (let i = 1; i <= rings; i++) {
    const r = reach * Math.pow(i / rings, 1.5);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      vertex(CENTER.x + Math.cos(a) * r, CENTER.z + Math.sin(a) * r);
    }
  }
  const at = (i, j) => 1 + (i - 1) * segments + (j % segments);
  for (let j = 0; j < segments; j++) indices.push(0, at(1, j + 1), at(1, j));
  for (let i = 1; i < rings; i++)
    for (let j = 0; j < segments; j++) {
      const a = at(i, j),
        b = at(i, j + 1),
        c = at(i + 1, j),
        d = at(i + 1, j + 1);
      indices.push(a, b, c, b, d, c);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("swept", new THREE.Float32BufferAttribute(swept, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export async function createEnvironment(scene, { detail = false } = {}) {
  const loader = new THREE.TextureLoader();
  const [rockMaterial, woodMaterial, sandMaterial] = await Promise.all([
    surface(loader, "rock_boulder_dry", [1.6, 1.25], 0xbdb6a3, "#56632e", "#1f3a14"),
    surface(loader, "rough_wood", [2.1, 1.4], 0x9c8266, "#44572a", "#1d3812"),
    surface(loader, "sand_01", [1, 1], 0xfff4e2, "#6b6a36", "#2f4a1c", {
      extra: sandExtras,
      key: "river-sand-v1",
    }),
  ]);
  rockMaterial.normalScale.set(0.9, 0.9);
  rockMaterial.roughness = 0.88;
  woodMaterial.roughness = 0.9;
  woodMaterial.normalScale.set(0.85, 0.85);
  sandMaterial.normalScale.set(0.35, 0.35);

  // How sheltered the sand is from the flow: against the stones, beneath the wood.
  const shelterAt = (x, z) => {
    let shelter = 0;
    for (const r of ROCKS) {
      const size = Math.max(r.rx, r.rz);
      const gap = Math.hypot(x - r.x, z - r.z) - size;
      shelter = Math.max(shelter, smoothstep(0.6 + 0.8 * size, 0.1, gap));
    }
    return shelter;
  };
  const sediment = (x, z) => {
    const open = channel(x, z);
    const bank = smoothstep(0.55, 0.2, open) * smoothstep(0.02, 0.1, open);
    return (0.1 + 1.3 * shelterAt(x, z) + 0.6 * bank) * (1 - 0.8 * open);
  };
  const sedimentSpot = (minX, maxX, minZ, maxZ, floor = 0) => {
    for (;;) {
      const x = range(minX, maxX),
        z = range(minZ, maxZ);
      if (random() * 2 < floor + (1 - floor) * sediment(x, z)) return [x, z];
    }
  };

  const bedGeometry = riverbedGeometry(detail);
  const sand = new THREE.Mesh(bedGeometry, sandMaterial);
  sand.name = "Riverbed";
  sand.receiveShadow = true;
  scene.add(sand);
  const sandSamples = growMoss(
    bedGeometry,
    sand.matrix,
    (p) => 0.45 * shelterAt(p.x, p.z) * (1 - channel(p.x, p.z)),
    -0.3,
  ).filter((s) => radial(s.position.x, s.position.z) < 24);

  const obstacles = [];
  const landmarks = [];
  const rockSamples = [];
  ROCKS.forEach((r, i) => {
    const far = radial(r.x, r.z) > 24;
    const geometry = rockGeometry(i * 2.63 + 0.7, far ? 48 : detail ? 96 : 68, 1);
    const grain = Math.max(0.8, (r.rx + r.ry + r.rz) / 3.3);
    const uv = geometry.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * grain, uv.getY(k) * grain);
    const mesh = new THREE.Mesh(geometry, rockMaterial);
    mesh.scale.set(r.rx, r.ry, r.rz);
    mesh.position.set(r.x, rockCenterY(r), r.z);
    mesh.rotation.set(range(-0.1, 0.1), range(-3, 3), r.lean, "ZYX");
    mesh.updateMatrix();
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const tints = mesh.geometry.attributes.color;
    rockSamples.push(
      ...growMoss(
        mesh.geometry,
        mesh.matrix,
        (p, index) =>
          0.5 * (1 - tints.getX(index)) +
          0.3 * smoothstep(0.9, 0.2, p.y - groundHeight(p.x, p.z)),
        0.02,
      ),
    );
    const radius = Math.max(r.rx, r.ry, r.rz) * 0.85;
    obstacles.push({ center: mesh.position.clone(), radius });
    if (radius > 0.7 && !far)
      landmarks.push({
        kind: "rock",
        point: mesh.position.clone().add(vec(0, r.ry * 0.85, r.rz * 0.6)),
        obstacle: obstacles.length - 1,
      });
  });
  createContactShadows(scene, ROCKS);

  // River cobbles: rounded, many-coloured, gathered at the feet of the boulders, along
  // the banks of the corridor and in the lee of the wood.
  const cobbleGeometry = rockGeometry(37, 16, 1);
  cobbleGeometry.setAttribute(
    "moss",
    new THREE.BufferAttribute(new Float32Array(cobbleGeometry.attributes.position.count), 1),
  );
  const cobbleMaterial = mossLayer(rockMaterial.clone(), "#56632e", "#1f3a14", {
    key: "river-cobble-v1",
  });
  cobbleMaterial.color.set(0xffffff);
  const cobbles = new THREE.InstancedMesh(cobbleGeometry, cobbleMaterial, detail ? 1500 : 1000);
  const object = new THREE.Object3D(),
    color = new THREE.Color();
  const palette = ["#b8ab93", "#8f8574", "#a0765a", "#6d6a62", "#c9bea6", "#7f6a4f", "#9a9d92"];
  for (let i = 0; i < cobbles.count; i++) {
    const [x, z] = sedimentSpot(CENTER.x - 27, CENTER.x + 27, CENTER.z - 27, CENTER.z + 27);
    const s =
      (0.05 + 0.32 * random() ** 2.2) *
      (0.6 + 0.8 * Math.min(1, sediment(x, z))) *
      (1 - 0.5 * channel(x, z));
    object.position.set(x, groundHeight(x, z) + s * 0.25, z);
    object.scale.set(s * range(0.9, 1.4), s * range(0.45, 0.75), s * range(0.8, 1.1));
    object.rotation.set(range(-0.25, 0.25), range(0, TAU), range(-0.25, 0.25));
    object.updateMatrix();
    cobbles.setMatrixAt(i, object.matrix);
    color.set(palette[Math.floor(random() * palette.length)]).multiplyScalar(range(0.75, 1.1));
    cobbles.setColorAt(i, color);
  }
  // Cobbles are too small for their shadows to be resolved except at full detail.
  cobbles.castShadow = detail;
  cobbles.receiveShadow = true;
  cobbles.name = "Cobbles";
  scene.add(cobbles);

  const gritMaterial = new THREE.MeshStandardMaterial({ color: 0xb6a07a, roughness: 1 });
  gritMaterial.onBeforeCompile = (shader) => waterLitShader(shader);
  gritMaterial.customProgramCacheKey = () => "river-grit-v1";
  const grit = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    gritMaterial,
    detail ? 11000 : 7000,
  );
  for (let i = 0; i < grit.count; i++) {
    const [x, z] = sedimentSpot(CENTER.x - 25, CENTER.x + 25, CENTER.z - 25, CENTER.z + 25, 0.4);
    const s = range(0.008, 0.03);
    object.position.set(x, groundHeight(x, z) + s * 0.3, z);
    object.scale.set(s, s * 0.55, s);
    object.rotation.set(range(0, 3), range(0, 3), range(0, 3));
    object.updateMatrix();
    grit.setMatrixAt(i, object.matrix);
    grit.setColorAt(i, color.setHSL(range(0.07, 0.15), range(0.1, 0.35), range(0.14, 0.62)));
  }
  grit.receiveShadow = true;
  scene.add(grit);

  const woodSamples = [];
  WOOD.forEach((branch, i) => {
    const points = branch.p.map((p) => vec(...p));
    const geometry = branchGeometry(points, branch.r, branch.t, i * 5.7 + 1.3, detail);
    const mesh = new THREE.Mesh(geometry, woodMaterial);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const tints = geometry.attributes.color;
    woodSamples.push(
      ...growMoss(geometry, mesh.matrix, (p, index) => 0.7 * (1 - tints.getX(index)), 0.06),
    );
    if (branch.obstacle) {
      const curve = new THREE.CatmullRomCurve3(points);
      const steps = Math.ceil(curve.getLength() / 0.75);
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const radius = THREE.MathUtils.lerp(branch.r, branch.t, t) * 0.9 + 0.14;
        obstacles.push({ center: curve.getPoint(t), radius });
        if (branch.landmarks && t > 0.12 && t < 0.85 && k % 3 === 0)
          landmarks.push({
            kind: "wood",
            point: curve.getPoint(t).add(vec(0, radius * 0.7, radius * 0.9)),
            obstacle: obstacles.length - 1,
          });
      }
    }
  });
  plantFronds(scene, [
    { samples: woodSamples, count: detail ? 3200 : 2000 },
    { samples: rockSamples, count: detail ? 1400 : 900, scale: 0.6 },
    { samples: sandSamples, count: 120, scale: 0.6 },
  ]);

  // Beyond the far bank: nothing but water. A dark dome the fog turns into the colour of
  // distance itself, so the horizon matches whatever the water there is doing.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(135, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, fog: true }),
  );
  dome.name = "Distance";
  dome.position.set(CENTER.x, 0, CENTER.z);
  scene.add(dome);

  return { obstacles, landmarks };
}
