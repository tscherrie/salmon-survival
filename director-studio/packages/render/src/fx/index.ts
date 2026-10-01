import { createElement, type ReactElement } from 'react';
import { hashString, seededRandom } from '../composition/random.ts';

/**
 * `@studio/fx`: kleine, deterministische Helfer für Director-Komponenten (einziger erlaubter
 * Import neben react/remotion). Kein Zufall ohne Seed, keine Zeit, kein Netzwerk.
 */

export { hashString, seededRandom };

export const clamp = (v: number, min = 0, max = 1): number => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Wertebereich umrechnen (geklemmt). */
export const mapRange = (v: number, inMin: number, inMax: number, outMin: number, outMax: number): number =>
  lerp(outMin, outMax, clamp((v - inMin) / (inMax - inMin || 1)));
export const easeOutCubic = (t: number): number => 1 - (1 - clamp(t)) ** 3;
export const easeInOutCubic = (t: number): number => {
  const x = clamp(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** „Animation auf Zweiern“: Frame auf Vielfache von `step` runden (Boil-Effekt, Handgezeichnet-Look). */
export const onTwos = (frame: number, step = 2): number => Math.floor(frame / step) * step;

/** Glattes 1D-Rauschen (Value-Noise, kosinus-interpoliert), Werte in [0, 1). */
export function noise1D(seed: string, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = seededRandom(`${seed}|${i}`)();
  const b = seededRandom(`${seed}|${i + 1}`)();
  const t = (1 - Math.cos(f * Math.PI)) / 2;
  return a * (1 - t) + b * t;
}

/** Zufälliger Versatz in [-amount, amount] (deterministisch über `random(salt)`). */
export function jitter(random: (salt?: string | number) => number, amount: number, salt: string | number = ''): number {
  return (random(salt) * 2 - 1) * amount;
}

/** Polygon/Polylinie mit „Boil“-Zittern als SVG-Pfad. */
export function wobblePath(points: ReadonlyArray<readonly [number, number]>, random: (salt?: string | number) => number, amount: number, closed = true): string {
  if (!points.length) return '';
  const pts = points.map(([x, y], i) => [x + jitter(random, amount, `x${i}`), y + jitter(random, amount, `y${i}`)] as const);
  return `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}${closed ? 'Z' : ''}`;
}

/** Filmkorn-Overlay als SVG (feTurbulence); `seed` z. B. `onTwos(frame)` für lebendiges Korn. */
export function GrainOverlay(props: { opacity?: number; frequency?: number; seed?: number; blend?: string }): ReactElement {
  const id = `grain-${hashString(String(props.seed ?? 0)) % 100000}`;
  return createElement(
    'svg',
    { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', mixBlendMode: props.blend ?? 'overlay', opacity: props.opacity ?? 0.25 } },
    createElement('filter', { id }, createElement('feTurbulence', { type: 'fractalNoise', baseFrequency: props.frequency ?? 0.85, numOctaves: 2, seed: props.seed ?? 0, stitchTiles: 'stitch' })),
    createElement('rect', { width: '100%', height: '100%', filter: `url(#${id})` }),
  );
}
