import { QUALITY_PRESETS, qualityName, renderScale } from '../../shared/render-policy.js';
// Rendering budgets, kept separate from animation and habitat behaviour. Balanced is what
// the wallpaper runs; Detail is the browser's own, where frame time is not the limit and
// the river gets everything: bigger shadows, denser shafts, the surface mirror, a denser
// meadow and more life in the water. Reference is the full-quality still for comparisons.
export const PROFILES = Object.freeze({
  eco: Object.freeze({
    name: 'eco',
    // Temporal anti-aliasing: each frame is drawn a fraction of a pixel off the last and
    // the frames are blended, so thin blades and edges stop crawling.
    taa: false,
    shadowSize: 2048,
    shadowHz: Infinity,
    batteryShadowHz: Infinity,
    aoSamples: 6,
    shaftSteps: 10,
    reflections: false,
    backgroundDensity: 0.55,
    backgroundRows: 16,
    backgroundCols: 2,
    lawnDensity: 14,
    detail: false,
    powerPreference: 'low-power',
  }),
  balanced: Object.freeze({
    name: 'balanced',
    taa: true,
    shadowSize: 2048,
    // Every frame: at 20-30 fps a slower shadow refresh makes moving shadows step visibly.
    shadowHz: Infinity,
    batteryShadowHz: Infinity,
    aoSamples: 8,
    shaftSteps: 16,
    reflections: false,
    backgroundDensity: 0.7,
    backgroundRows: 20,
    backgroundCols: 2,
    lawnDensity: 18,
    detail: false,
    powerPreference: 'low-power',
  }),
  detail: Object.freeze({
    name: 'detail',
    taa: true,
    shadowSize: 4096,
    shadowHz: Infinity,
    batteryShadowHz: Infinity,
    aoSamples: 12,
    shaftSteps: 40,
    reflections: true,
    backgroundDensity: 1,
    backgroundRows: 28,
    backgroundCols: 3,
    lawnDensity: 30,
    detail: true,
    powerPreference: 'high-performance',
  }),
  reference: Object.freeze({
    name: 'reference',
    taa: true,
    shadowSize: 4096,
    shadowHz: Infinity,
    batteryShadowHz: Infinity,
    aoSamples: 12,
    shaftSteps: 48,
    reflections: true,
    backgroundDensity: 1,
    backgroundRows: 30,
    backgroundCols: 3,
    lawnDensity: 30,
    detail: true,
    powerPreference: 'high-performance',
  }),
});

export function renderSettings({
  profile = 'balanced', wallpaper = false, pixelRatio = 1, onBattery = false,
} = {}) {
  const budget = PROFILES[profile] || PROFILES.balanced;
  const dpr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const referenceResolution = wallpaper ? Math.min(2, Math.max(1.5, dpr)) : 1.5;
  return {
    ...budget,
    // Do not make Retina resolution a multiplier of an already supersampled target.
    resolution: budget.name === 'reference' ? referenceResolution :
      renderScale(profile, pixelRatio, onBattery),
    maxPixels: budget.name === 'reference' ? Infinity : QUALITY_PRESETS[qualityName(profile)].pixels,
    referenceResolution,
    shadowHz: onBattery ? budget.batteryShadowHz : budget.shadowHz,
    // The leaf shader uses quarter-sample coverage for translucent tissue. Keep 4x
    // MSAA and the HDR format: changing either would be a much larger visual change.
    samples: 4,
  };
}

export { framebufferSize } from '../../shared/render-policy.js';
