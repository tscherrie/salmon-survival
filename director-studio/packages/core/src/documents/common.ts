import type { AssetKind } from '../assets.ts';

/** Kontext für die Validierung von Operationen (z. B. Existenz referenzierter Assets). */
export interface OpContext {
  /** Liefert die Art eines Assets oder `undefined`, wenn es nicht existiert. */
  assetKind?: (assetId: string) => AssetKind | undefined;
}

export class DocumentOpError extends Error {
  readonly opIndex: number;
  readonly opType: string;
  constructor(opIndex: number, opType: string, message: string) {
    super(`Operation ${opIndex + 1} (${opType}): ${message}`);
    this.name = 'DocumentOpError';
    this.opIndex = opIndex;
    this.opType = opType;
  }
}

export function assertUniqueId(existing: Iterable<string>, id: string, what: string): void {
  for (const e of existing) {
    if (e === id) throw new Error(`${what}-ID "${id}" existiert bereits`);
  }
}

export function assertAssetKind(
  ctx: OpContext,
  assetId: string | undefined,
  allowed: readonly AssetKind[],
  what: string,
): void {
  if (!assetId || !ctx.assetKind) return;
  const kind = ctx.assetKind(assetId);
  if (kind === undefined) throw new Error(`${what}: Asset "${assetId}" existiert nicht`);
  if (!allowed.includes(kind)) {
    throw new Error(`${what}: Asset "${assetId}" ist vom Typ "${kind}", erwartet ${allowed.join('/')}`);
  }
}

export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

/** Flaches Mergen von `props`-artigen Objekten; `null` löscht einen Schlüssel. */
export function mergePatch<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (value !== undefined) out[key] = value;
  }
  return out as T;
}
