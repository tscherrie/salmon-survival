import { z } from 'zod';
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

/** Flaches Mergen von `props`-artigen Objekten; `null` löscht einen Schlüssel, `undefined` lässt ihn unverändert. */
export function mergePatch<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (value !== undefined) out[key] = value;
  }
  return out as T;
}

/**
 * Mergt einen verschachtelten Teil-Patch (z. B. `transform`, `duck`, `style`): `null` entfernt das ganze Objekt,
 * ein Objekt wird per {@link mergePatch} auf den bisherigen Stand gelegt, `undefined` lässt alles unverändert.
 * Leere Ergebnisse werden zu `undefined`, damit keine leeren Hüllen im Dokument bleiben.
 */
export function mergeNested<T extends Record<string, unknown>>(
  base: T | undefined,
  patch: Record<string, unknown> | null | undefined,
): T | undefined {
  if (patch === undefined) return base;
  if (patch === null) return undefined;
  const merged = mergePatch((base ?? {}) as T, patch);
  return Object.keys(merged).length ? merged : undefined;
}

/** Setzt `value` unter `key` oder entfernt den Schlüssel bei `undefined` (ohne `key: undefined` zu hinterlassen). */
export function setOrDelete<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

/** Validiert mit `schema` und wirft einen lesbaren Fehler (statt der JSON-Ausgabe eines ZodError). */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, what: string): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`).join('; ');
  throw new Error(`${what} ist ungültig – ${issues}`);
}

// ───────────────────────── Patch-Schemas ─────────────────────────

type BareSchema<T> = T extends z.ZodDefault<infer U> ? BareSchema<U> : T extends z.ZodOptional<infer U> ? BareSchema<U> : T;
type PatchField<T> = T extends z.ZodDefault | z.ZodOptional
  ? z.ZodOptional<z.ZodNullable<Extract<BareSchema<T>, z.core.SomeType>>>
  : z.ZodOptional<Extract<BareSchema<T>, z.core.SomeType>>;
export type PatchShape<S extends z.ZodRawShape> = { -readonly [K in keyof S]: PatchField<S[K]> };

/**
 * Baut aus einem Objektschema ein Patch-Schema für `update_*`-Operationen.
 *
 * Wichtig (zod 4): `.partial()` behält `ZodDefault`-Werte – ein Patch ohne das Feld bekäme den Default
 * injiziert und würde den echten Wert überschreiben. Hier werden Defaults daher entfernt:
 * - Pflichtfelder werden optional (fehlend = unverändert), dürfen aber nicht `null` sein.
 * - Optionale Felder und Felder mit Default werden zusätzlich `nullable`: `null` löscht das Feld
 *   (bzw. setzt es nach dem erneuten Parsen mit dem vollen Schema auf seinen Default zurück).
 */
export function patchSchemaOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>): z.ZodObject<PatchShape<S>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    let inner = field as z.ZodType;
    let clearable = false;
    const description = inner.description;
    for (;;) {
      if (inner instanceof z.ZodDefault || inner instanceof z.ZodPrefault || inner instanceof z.ZodOptional) {
        clearable = true;
        inner = inner.unwrap() as z.ZodType;
        continue;
      }
      break;
    }
    let patchField: z.ZodType = clearable ? inner.nullable().optional() : inner.optional();
    if (description && !inner.description) patchField = patchField.describe(description);
    shape[key] = patchField;
  }
  return z.object(shape) as unknown as z.ZodObject<PatchShape<S>>;
}
