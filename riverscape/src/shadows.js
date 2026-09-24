import * as THREE from "three";

// Soft shadows that harden toward contact. Sunlight reaches the bed through a surface that
// is never flat, so each point on the sand sees the sun as a small, trembling patch of sky
// a few degrees across rather than a point: the shadow of a blade of grass is sharp where
// it leaves the sand and dissolves into a blur where the tip is six units up, and the log's
// shadow is crisp under the log and soft at its edges. A fixed filter gives every shadow
// the same edge; this measures, for each point, how far above it the shadow-caster is
// (by averaging the depths of the casters in the shadow map around it) and widens the
// filter by that much -- percentage-closer soft shadows (Fernando 2005). The samples are
// spread on a rotated spiral, and the rotation changes from pixel to pixel so the temporal
// resolve can average it into a smooth penumbra.
export function installSoftShadows({
  // The spread of the sun as seen from under the waves, as the tangent of its half-angle.
  spread = 0.045,
  // The shadow camera: how many units across its square, and how deep its depth range.
  frustum = 50,
  depthRange = 62,
  blockerSamples = 12,
  filterSamples = 16,
} = {}) {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (chunk.includes("SOFT_SHADOW_SPREAD")) return;
  const start = chunk.indexOf("#if defined( SHADOWMAP_TYPE_PCF )");
  const end = chunk.indexOf("#elif defined( SHADOWMAP_TYPE_PCF_SOFT )");
  if (start < 0 || end < 0) throw new Error("Unexpected shadow chunk: soft shadows not installed.");
  const searchRadius = Math.min(0.012, (12 * spread) / frustum);
  const pcss = /* glsl */ `#if defined( SHADOWMAP_TYPE_PCF )
      #define SOFT_SHADOW_SPREAD ${spread.toFixed(4)}
      vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
      float receiver = shadowCoord.z;
      // The light's shadow radius carries the frame number in its fraction (see
      // shadowFrame below), so the spiral turns from frame to frame as well as from pixel
      // to pixel and the temporal resolve averages it away.
      float shadowFrameIndex = floor( fract( shadowRadius ) * 1000.0 + 0.5 );
      vec2 noisePixel = gl_FragCoord.xy + shadowFrameIndex * 5.588238;
      float spin = 6.2831853 * fract( 52.9829189 * fract( dot( noisePixel, vec2( 0.06711056, 0.00583715 ) ) ) );
      float blockerDepth = 0.0;
      float blockers = 0.0;
      for ( int i = 0; i < ${blockerSamples}; i ++ ) {
        float r = sqrt( ( float( i ) + 0.5 ) / ${blockerSamples.toFixed(1)} );
        float a = float( i ) * 2.39996323 + spin;
        vec2 offset = vec2( cos( a ), sin( a ) ) * r * ${searchRadius.toFixed(5)};
        float d = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + offset ) );
        if ( d < receiver - 0.0008 - r * ${(searchRadius * 0.9).toFixed(6)} ) {
          blockerDepth += d;
          blockers += 1.0;
        }
      }
      if ( blockers > 0.5 ) {
        blockerDepth /= blockers;
        // How far the caster is above this point, in units, times the spread of the sun.
        float penumbra = ( receiver - blockerDepth ) * ${depthRange.toFixed(2)} * SOFT_SHADOW_SPREAD / ${frustum.toFixed(2)};
        float radius = clamp( penumbra, texelSize.x * max( floor( shadowRadius ), 1.0 ), ${searchRadius.toFixed(5)} );
        shadow = 0.0;
        for ( int i = 0; i < ${filterSamples}; i ++ ) {
          float r = sqrt( ( float( i ) + 0.5 ) / ${filterSamples.toFixed(1)} );
          float a = float( i ) * 2.39996323 + spin + 1.3;
          vec2 offset = vec2( cos( a ), sin( a ) ) * r * radius;
          // A sample further out lands on a part of a sloping or curling surface that may
          // be higher than this point, so it is allowed a proportionally wider tolerance:
          // otherwise a wide filter shades a leaf with itself.
          shadow += texture2DCompare( shadowMap, shadowCoord.xy + offset, receiver - 0.0004 - r * radius * 0.9 );
        }
        shadow /= ${filterSamples.toFixed(1)};
      }
    `;
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + pcss + chunk.slice(end);
}

// The frame number rides in the thousandths of the light's shadow radius, which every lit
// material already receives as a uniform: the soft-shadow spiral needs a per-frame turn and
// this is the one per-frame value the built-in materials all share.
export function shadowFrame(light, baseRadius, frame) {
  light.shadow.radius = Math.floor(baseRadius) + (frame % 16) / 1000;
}
