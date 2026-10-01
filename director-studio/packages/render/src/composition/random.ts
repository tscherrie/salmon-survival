/**
 * Deterministischer Zufall für Komponenten und Effekte. Gleicher Seed → gleiche Folge, auf jedem
 * Rechner und in Vorschau wie Export (Voraussetzung für reproduzierbare Renderings).
 */

/** 32-Bit-Hash eines Strings (cyrb53-Variante, auf 32 Bit gefaltet). */
export function hashString(value: string): number {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Erzeugt einen PRNG (mulberry32) aus einem String-Seed. Werte in [0, 1). */
export function seededRandom(seed: string): () => number {
  let state = hashString(seed) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ein einzelner deterministischer Wert in [0, 1) für einen Seed. */
export function randomFromSeed(seed: string): number {
  return seededRandom(seed)();
}

/**
 * Zufallsfunktion für `OverlayComponentProps.random`: rein (ohne inneren Zustand), Seed aus
 * Clip-ID + Frame + Salt. Gleicher Salt im selben Frame liefert denselben Wert – für mehrere Werte
 * unterschiedliche Salts verwenden (z. B. `random('x')`, `random('y')`, `random(i)`).
 */
export function makeClipRandom(clipId: string, frame: number): (salt?: string | number) => number {
  return (salt) => randomFromSeed(`${clipId}|${frame}|${salt ?? ''}`);
}
