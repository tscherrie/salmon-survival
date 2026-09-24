import * as THREE from "three";
import { range, smoothstep, vec } from "./math.js";
import { FLOW_DIRECTION, currentGLSL, waterLitShader, waterTime } from "./water.js";
import { flowGLSL, flowUniforms } from "./flow.js";

// Shared foliage construction: the current model in the vertex stage, the submerged
// leaf material, and the blade and stem generators every plant species is built from.

export const TAU = Math.PI * 2;

// Displacement of a strand along `direction`, and its slope along the strand, at distance
// `s` from the root. Drag bends the strand downstream with a deflection that grows with
// the square of the distance and saturates as it streams out; the shear layer over its
// surface raises a wave that travels from root to tip and grows toward the tip. The slope
// rotates the shading normal so light travels down the blade with the wave.
const strandVertex = /* glsl */ `
  attribute vec3 anchor;
  attribute vec4 bend;
  attribute vec4 along;
  attribute float thin;
  varying float vThin;
  ${currentGLSL}
  ${flowGLSL}
  vec2 strandMotion(vec3 root, vec3 direction, float s, float compliance, float stir) {
    float strength = currentStrength(root, waterTime);
    float seed = fract(sin(root.x * 12.9898 + root.z * 78.233) * 43758.5453);
    float phase = seed * 6.2832 + root.x * 0.9;
    // The steady part of the river's push is already in the shape the plant grew into;
    // what moves it is the gusting about that mean.
    float drag = compliance * dot(FLOW_DIRECTION, direction) * (strength - 0.92);
    float saturation = 1.0 + 0.06 * s * s;
    float bendAmount = drag * 0.16 * s * s / saturation;
    float bendSlope = drag * 0.32 * s / (saturation * saturation);
    // Flutter grows with the flow, and more where something has just stirred the water.
    // Only its size answers the stir, never its rate: the phase runs on the clock itself,
    // and scaling the clock by anything that changes would throw every blade's wave a
    // different distance through its cycle from one frame to the next.
    float gain = compliance * (0.014 + 0.024 * strength + 0.025 * min(stir, 1.5));
    float safeS = max(s, 1e-4);
    float sPower = pow(safeS, 0.3);
    float envelope = gain * safeS * sPower;
    float envelopeSlope = gain * 1.3 * sPower;
    float theta = waterTime * 1.05 - 1.1 * s + phase;
    float ripple = waterTime * 1.75 - 1.8 * s + phase * 2.3;
    float shape = sin(theta) + 0.3 * sin(ripple);
    float wave = envelope * shape;
    float waveSlope = envelopeSlope * shape - envelope * (1.1 * cos(theta) + 0.54 * cos(ripple));
    return vec2(bendAmount + wave, bendSlope + waveSlope);
  }
  vec2 gMotion;
  vec4 gStir;
`;
const strandNormal = /* glsl */ `
  gStir = flowAt(position);
  gMotion = strandMotion(anchor, bend.xyz, along.w, bend.w, gStir.a);
  vec3 objectNormal = normalize(normal - along.xyz * (gMotion.y * dot(bend.xyz, normal)));
`;
// The river's own sway along the strand's bending direction, then whatever a fish or a
// hand has done to the water here: the foliage is pushed along the local displacement,
// more toward the free end, and never along its own length.
const strandPosition = /* glsl */ `
  vec3 pushed = gStir.rgb * bend.w * 0.17 * along.w * along.w / (1.0 + 0.07 * along.w * along.w);
  pushed -= along.xyz * dot(pushed, along.xyz);
  // A blade can be pushed aside, not torn off: the displacement saturates.
  float shove = length(pushed);
  pushed *= 1.6 / max(1.6, shove);
  vec3 transformed = position + bend.xyz * gMotion.x + pushed;
  vThin = thin;
`;

// Submerged leaves show almost no specular reflection: leaf tissue and water have
// nearly the same refractive index, so what reaches the eye is diffuse reflection
// and light transmitted through the thin blade.
export function foliageMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0,
    specularIntensity: 0.07,
    side: THREE.DoubleSide,
    vertexColors: true,
    alphaToCoverage: true,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, flowUniforms);
    shader.vertexShader = strandVertex + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace("#include <beginnormal_vertex>", strandNormal)
      .replace(
        "#include <begin_vertex>",
        `${strandPosition}
      leafUv = uv; leafPosition = position;`,
      );
    shader.vertexShader =
      "varying vec2 leafUv; varying vec3 leafPosition;\n" + shader.vertexShader;
    shader.fragmentShader =
      `varying vec2 leafUv; varying vec3 leafPosition; varying float vThin;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
      // The midrib highlight fades once a leaf is only a few pixels wide, so needle
      // leaves do not clip to white specks.
      float midrib = (1.0 - smoothstep(.008, .035, abs(leafUv.x - .5))) * (1.0 - smoothstep(.02, .06, fwidth(leafUv.x)));
      float veins = pow(.5 + .5 * cos((leafUv.y - abs(leafUv.x - .5) * .32) * 155.0), 22.0);
      float edge = pow(abs(leafUv.x - .5) * 2.0, 5.0);
      float mottling = .965 + .035 * sin(leafUv.y * 64.0 + sin(leafUv.x * 25.0));
      diffuseColor.rgb *= mottling * (1.0 - .09 * edge + .12 * veins);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.22 + vec3(.008,.012,0.), midrib * .6);
      // Leaf undersides are paler and warmer than the upper surface.
      if (!gl_FrontFacing) diffuseColor.rgb *= vec3(.82, .76, .66);
      // Thin tissue lets part of the scene behind show through. Coverage is held to exact
      // quarters of the four multisamples so the driver never dithers it into a pattern:
      // ribbon leaves pass a quarter of the light, their thinner edges half.
      diffuseColor.a = vThin < .7 ? 1.0 : (edge > .45 ? .5 : .75);
      // A leaf right in front of the lens thins away rather than filling the picture -- but
      // not a leaf lying flat on the bed (marked by a thinness of exactly 0.12), which would
      // only show as a pale, see-through patch on the ground.
      if (abs(vThin - 0.12) > 0.005) diffuseColor.a *= smoothstep(0.35, 1.5, length(vViewPosition));
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      /* glsl */ `#include <normal_fragment_maps>
      float rib = exp(-pow((leafUv.x-.5)*60.,2.))*.0015;
      float veinHeight = pow(.5+.5*cos((leafUv.y-abs(leafUv.x-.5)*.32)*155.),16.)*.00025;
      float detailFade = 1.-smoothstep(.003,.012,max(fwidth(leafUv.x),fwidth(leafUv.y)));
      float micro = sin(leafUv.x*230.)*sin(leafUv.y*310.)*.00003*detailFade;
      float surfaceHeight = rib + veinHeight + micro;
      vec3 dp1=dFdx(-vViewPosition),dp2=dFdy(-vViewPosition);
      vec3 r1=cross(dp2,normal),r2=cross(normal,dp1);
      float det=dot(dp1,r1);
      // A sliver of a blade tip can cover a pixel with no screen-space extent at all; the
      // perturbation then vanishes and must not be normalised into NaN.
      vec3 perturbed=abs(det)*normal-sign(det)*(dFdx(surfaceHeight)*r1+dFdy(surfaceHeight)*r2);
      normal=dot(perturbed,perturbed)>1e-20?normalize(perturbed):normal;
    `,
    );
    waterLitShader(shader, {
      // Light reaching the far side of a thin leaf is scattered through the tissue, which
      // passes green far more readily than red or blue.
      perLight: /* glsl */ `
        float backLight = saturate(dot(-geometryNormal, lit.direction));
        reflectedLight.directDiffuse += lit.color * backLight * RECIPROCAL_PI * material.diffuseColor * vec3(.55, .85, .30) * (vThin * .9);
      `,
    });
    // The bright water all round lights a leaf from behind as well as in front: the sky's
    // light reaching its far face comes through the tissue, green. Without it the underside
    // of a blade in shade reads as a hole in the picture.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_end>",
      /* glsl */ `
      #include <lights_fragment_end>
      // A blade seen edge-on can present a shading normal turned away from the eye, and
      // the energy-conserving split of indirect light then goes negative -- sometimes by
      // thousands -- which prints as black specks across the grass. Light is never less
      // than none.
      reflectedLight.indirectDiffuse = max(reflectedLight.indirectDiffuse, vec3(0.0));
      reflectedLight.indirectSpecular = max(reflectedLight.indirectSpecular, vec3(0.0));
      reflectedLight.directSpecular = max(reflectedLight.directSpecular, vec3(0.0));
      #if NUM_HEMI_LIGHTS > 0
        vec3 behind = getHemisphereLightIrradiance(hemisphereLights[0], -geometryNormal);
        reflectedLight.indirectDiffuse += behind * BRDF_Lambert(material.diffuseColor)
          * vec3(0.75, 1.0, 0.55) * (0.3 + 0.7 * vThin);
      #endif
    `,
    );
  };
  material.onBeforeCompile = ((build) => (shader) => {
    build(shader);
    // Whatever a degenerate sliver of blade computes, what it writes is light.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      "#include <dithering_fragment>\ngl_FragColor.rgb = clamp(gl_FragColor.rgb, vec3(0.0), vec3(48.0));",
    );
  })(material.onBeforeCompile);
  material.customProgramCacheKey = () => "river-leaves-v5";
  return material;
}

// Shadows follow the same motion.
export function foliageDepth({ animated = true } = {}) {
  const material = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    // Depth shaders do not pass through waterLitShader, so bind the clock here too.
    if (animated) shader.uniforms.waterTime = waterTime;
    Object.assign(shader.uniforms, flowUniforms);
    shader.vertexShader = strandVertex + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `gStir = flowAt(position);
      gMotion = strandMotion(anchor, bend.xyz, along.w, bend.w, gStir.a);
      ${strandPosition}`,
    );
  };
  material.customProgramCacheKey = () => "river-leaf-shadow-v1";
  return material;
}

// How a stem or petiole answers the current at parameter t: it bends across its axis,
// toward wherever the flow pushes it.
export function stemStrand(curve, t, length, compliance) {
  const tangent = curve.getTangent(t);
  const direction = FLOW_DIRECTION.clone().addScaledVector(
    tangent,
    -FLOW_DIRECTION.dot(tangent),
  );
  if (direction.lengthSq() < 1e-4) direction.crossVectors(tangent, vec(0, 1, 0));
  return {
    direction: direction.normalize(),
    tangent,
    distance: t * length,
    compliance,
  };
}

// Each blade is a curved, cupped surface. It bends across its face unless it rides on a
// parent strand, in which case it inherits the parent's motion at the attachment.
export function blade(
  batch,
  points,
  width,
  color,
  root,
  compliance,
  {
    rows = 12,
    cols = 4,
    twist = 0,
    ribbon = false,
    thin = 0.3,
    attached = null,
    browning = 0,
    emit = true,
  } = {},
) {
  // Even an omitted background blade consumes its original two random values. This
  // preserves all subsequent procedural geometry rather than regenerating the scene.
  const phase = range(0, TAU);
  const turn = ribbon ? range(-0.7, 0.7) : range(-0.12, 0.12);
  if (!emit) return;
  const curve =
    points.length === 3
      ? new THREE.QuadraticBezierCurve3(...points)
      : ribbon && points.length === 4
        ? new THREE.CubicBezierCurve3(...points)
        : new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const start = batch.positions.length / 3;
  const brown = new THREE.Color("#6b5a2a");
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    const theta = twist + turn * t;
    const side = vec(Math.cos(theta), 0, Math.sin(theta));
    side.addScaledVector(tangent, -side.dot(tangent)).normalize();
    const normal = new THREE.Vector3().crossVectors(side, tangent).normalize();
    const envelope = ribbon
      ? Math.pow(Math.sin(Math.PI * Math.pow(t, 0.58)), 0.34)
      : Math.pow(Math.sin(Math.PI * Math.pow(t, 0.73)), 0.76);
    const halfWidth = width * Math.max(0.005, envelope);
    const strand = attached || {
      direction: normal,
      tangent,
      distance: t * length,
      compliance,
    };
    const tint = color
      .clone()
      .multiplyScalar(0.86 + 0.14 * Math.sin(Math.PI * t * 0.9));
    if (browning) tint.lerp(brown, smoothstep(1 - browning, 1, t) * 0.8);
    for (let j = 0; j <= cols; j++) {
      const u = (j / cols) * 2 - 1;
      const wave = 1 + 0.016 * Math.sin(t * 25 + phase) * u * u;
      const p = center.clone().addScaledVector(side, u * halfWidth * wave);
      p.addScaledVector(
        normal,
        halfWidth *
          (0.19 * u * u + 0.045 * Math.sin(t * 15 + phase) * Math.abs(u)),
      );
      batch.vertex(p, [j / cols, t], tint, root, strand, thin);
      if (i < rows && j < cols) {
        const a = start + i * (cols + 1) + j;
        batch.quad(a, a + 1, a + cols + 1, a + cols + 2);
      }
    }
  }
}

export function stem(batch, points, radius, color, root, compliance, attached = null) {
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const rows = Math.max(4, points.length * 3),
    cols = 5;
  const start = batch.positions.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      p = curve.getPoint(t),
      tangent = curve.getTangent(t);
    const a = new THREE.Vector3()
      .crossVectors(tangent, vec(0.2, 0.01, 1))
      .normalize();
    const b = new THREE.Vector3().crossVectors(tangent, a).normalize();
    const strand = attached || stemStrand(curve, t, length, compliance);
    for (let j = 0; j <= cols; j++) {
      const angle = (j / cols) * TAU;
      const v = p
        .clone()
        .addScaledVector(a, Math.cos(angle) * radius * (1 - 0.65 * t))
        .addScaledVector(b, Math.sin(angle) * radius * (1 - 0.65 * t));
      batch.vertex(v, [j / cols, t], color, root, strand, 0);
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  return { curve, length };
}
