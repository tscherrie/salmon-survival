import * as THREE from "three";
import { waterLitShader } from "../../riverscape/src/water.js";

// Netting: twine knotted into meshes, drawn in the shader rather than in a texture, so it
// stays crisp close up and melts into a faint veil far off instead of shimmering. The
// mesh's uv is in world units: u along the net, v down from its top edge.
//
// Each thread is filtered to the pixel: where a thread is thinner than a pixel it is drawn
// half a pixel wide but only as opaque as its share of the pixel, and the whole is laid in
// with a dither that changes every frame, which the temporal filter smooths into a
// see-through gauze. Weed and drift catch in the mesh here and there; the deeper twine
// is fouled a little brown and green; the net sways in the current, most at its foot, and
// bellies round whatever is caught in it (`netPull`: where, and how hard).

export const netPull = { value: new THREE.Vector4(0, -1e5, 0, 0) };

const GLSL = /* glsl */ `
  float netHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float netNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(netHash(i), netHash(i + vec2(1, 0)), f.x), mix(netHash(i + vec2(0, 1)), netHash(i + vec2(1, 1)), f.x), f.y);
  }
  // How much of this pixel a family of threads (along integer values of a) covers.
  float netThreads(float a, float w, float fw) {
    float d = abs(fract(a + 0.5) - 0.5);
    float we = max(w, fw * 0.5);
    return (1.0 - smoothstep(we - fw * 0.5, we + fw * 0.5, d)) * (w / we);
  }
`;

export function nettingMaterial({ color = new THREE.Color(0.3, 0.37, 0.33), mesh = 1.2, hang = 1.25, twine = 0.045, knot = 1.8, square = false, opacity = 0.85, fouling = 0.35, weed = 0.18, sway = 0.5, key = "net" } = {}) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
  const W = mesh,
    H = square ? mesh : mesh * hang;
  // A thread's half-width in the units of the mesh's own coordinates.
  const wa = square ? (twine * 0.5) / mesh : twine * 0.5 * Math.hypot(1 / W, 1 / H);
  const f = (x) => x.toFixed(5);
  material.onBeforeCompile = (shader) => {
    waterLitShader(shader);
    shader.uniforms.netPull = netPull;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec4 netPull;
        varying vec2 vNet;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vNet = uv;
        {
          // Swaying in the current, the more the further down from the top edge.
          float down = clamp(uv.y / 12.0, 0.0, 1.0);
          float t = waterLightTime;
          transformed += objectNormal * ${f(sway)} * down * (sin(t * 0.55 + uv.x * 0.11 + uv.y * 0.07) + 0.4 * sin(t * 1.3 - uv.x * 0.31));
          // Pulled round a fish caught in it.
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          vec3 toward = netPull.xyz - wp.xyz;
          float grip = netPull.w * exp(-dot(toward, toward) / 9.0);
          transformed += transpose(mat3(modelMatrix)) * toward * clamp(grip, 0.0, 0.85);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec2 vNet;
        ${GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec2 q = vNet;
          ${square ? `float a = q.x / ${f(W)}, b = q.y / ${f(H)};` : `float a = q.x / ${f(W)} + q.y / ${f(H)}, b = q.x / ${f(W)} - q.y / ${f(H)};`}
          float fa = fwidth(a), fb = fwidth(b);
          // Drift caught in the mesh: weed and leaves wrapped round the twine in rags.
          float patches = netNoise(q * vec2(0.09, 0.14)) * 0.7 + netNoise(q * 0.43) * 0.3;
          float rag = smoothstep(0.76, 0.9, patches) * ${f(weed)} * 4.0 * (0.4 + 0.6 * netNoise(q * 1.7 + 5.0));
          float thick = ${f(wa)} * (1.0 + 5.0 * clamp(rag, 0.0, 1.0));
          float ca = netThreads(a, thick, fa), cb = netThreads(b, thick, fb);
          float cover = 1.0 - (1.0 - ca) * (1.0 - cb);
          // The knots where the threads cross.
          vec2 k = abs(fract(vec2(a, b) + 0.5) - 0.5);
          float kr = ${f(wa * knot)};
          float fk = max(fa, fb);
          float knotCover = (1.0 - smoothstep(max(kr, fk * 0.5) - fk * 0.5, max(kr, fk * 0.5) + fk * 0.5, length(k))) * min(1.0, kr / max(kr, fk * 0.5));
          cover = max(cover, knotCover);
          // Far off, where a mesh is smaller than a pixel or two: the even gauze it averages to.
          float mean = 1.0 - (1.0 - 2.0 * ${f(wa)}) * (1.0 - 2.0 * ${f(wa)});
          cover = mix(cover, mean, smoothstep(0.3, 0.7, max(fa, fb)));
          // A fouled film on the twine, more of it deeper down.
          float down = clamp(q.y / 14.0, 0.0, 1.0);
          float foul = ${f(fouling)} * (0.35 + 0.65 * down) * smoothstep(0.35, 0.8, patches);
          vec3 twine = diffuseColor.rgb * (0.85 + 0.3 * netHash(floor(vec2(a, b))));
          twine = mix(twine, vec3(0.2, 0.19, 0.1), foul * 0.6);
          twine = mix(twine, twine * vec3(0.7, 0.9, 0.55), foul * 0.5);
          twine = mix(twine, vec3(0.16, 0.13, 0.05) + 0.08 * vec3(netNoise(q * 5.0), netNoise(q * 5.0 + 3.0), 0.0), clamp(rag * 1.5, 0.0, 1.0));
          diffuseColor.rgb = mix(twine * 0.8, twine, 1.0 - knotCover * 0.4);
          float alpha = cover * mix(${f(opacity)}, 1.0, clamp(rag, 0.0, 1.0));
          // Laid in with a dither that moves every frame; the temporal filter evens it out.
          vec2 pix = gl_FragCoord.xy + vec2(47.0, 17.0) * floor(fract(waterTime * 3.7) * 64.0);
          float threshold = fract(52.9829189 * fract(dot(pix, vec2(0.06711056, 0.00583715))));
          if (alpha < max(threshold, 0.02)) discard;
        }`,
      );
  };
  material.customProgramCacheKey = () => `salmon-netting-${key}`;
  return material;
}
