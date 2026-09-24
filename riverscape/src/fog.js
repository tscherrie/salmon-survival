import * as THREE from "three";

// Water, not air, between the viewer and everything in the river.
//
// Three.js fog blends each fragment toward one colour by a single factor. Water does two
// things instead: it takes light away along the path, red far faster than green, and it
// adds light scattered into the path from the sunlit water around it, which is brighter
// looking up toward the surface than looking down into the bed. Both depend on the true
// distance along the view ray and its direction, so the fog chunks are replaced here with
// that model for every material in the scene, point sprites included. The scene's fog
// colour is the in-scattered light for a level view, and its density sets the green
// extinction per scene unit; the other channels scale from it.
export const EXTINCTION_RATIO = new THREE.Vector3(1.55, 1.0, 1.12);

let installed = false;
export function installUnderwaterFog() {
  if (installed) return;
  installed = true;
  const r = EXTINCTION_RATIO;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying vec3 vFogRay;
    #endif
  `;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      // The view-space offset turned back into the world's axes: the ray from the eye.
      vFogRay = transpose(mat3(viewMatrix)) * mvPosition.xyz;
    #endif
  `;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying vec3 vFogRay;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
      vec3 underwaterInscatter(vec3 direction) {
        float up = direction.y;
        // Brighter toward the lit surface, dimmer and bluer toward the bed.
        vec3 tint = mix(vec3(0.80, 0.93, 1.0), vec3(1.08, 1.04, 0.92), smoothstep(-0.1, 0.5, up));
        return fogColor * tint * (0.52 + 0.95 * smoothstep(-0.45, 0.62, up));
      }
    #endif
  `;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      float fogDistance = length(vFogRay);
      vec3 fogDirection = vFogRay / max(fogDistance, 1e-4);
      #ifdef FOG_EXP2
        vec3 fogTransmit = exp(-fogDensity * fogDistance * vec3(${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.z.toFixed(3)}));
      #else
        vec3 fogTransmit = vec3(1.0 - smoothstep(fogNear, fogFar, fogDistance));
      #endif
      gl_FragColor.rgb = gl_FragColor.rgb * fogTransmit + underwaterInscatter(fogDirection) * (1.0 - fogTransmit);
    #endif
  `;
}
