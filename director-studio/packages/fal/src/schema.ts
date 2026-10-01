/**
 * OpenAPI → JSON-Schema der Eingabe eines fal-Endpoints, `$ref`-Auflösung und eine kompakte,
 * für Menschen und LLMs lesbare Parameterliste.
 *
 * fal-OpenAPI-Dokumente (Pydantic-generiert) haben typischerweise:
 * `paths["/<endpoint_id>"].post.requestBody.content["application/json"].schema = { $ref: "#/components/schemas/<Name>Input" }`
 * plus Queue-Pfade (`/<owner>/<alias>/requests/{request_id}…`). Eigenschaften nutzen `allOf: [{$ref}]`,
 * `anyOf: [{…}, {type: 'null'}]`, `enum`, `default`, `examples` und `x-fal-order-properties`.
 */

export type JsonSchema = Record<string, unknown>;

/** Schlüssel, deren Werte Daten und keine Schemata sind (dort keine `$ref`-Auflösung). */
const DATA_KEYS = new Set(['enum', 'const', 'default', 'examples', 'example', 'required', 'x-fal-order-properties']);
/** Rein beschreibende Schlüssel, bei Konflikten in `allOf` gewinnt der erste/äußere Wert. */
const SOFT_KEYS = new Set(['title', 'description', 'default', 'examples', 'example', 'x-fal-order-properties']);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lookupPointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#')) return undefined;
  const parts = ref
    .slice(1)
    .split('/')
    .filter((p, i) => i > 0 || p !== '')
    .map((p) => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root;
  for (const part of parts) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * Löst alle lokalen `$ref`s rekursiv auf (auch in `properties`, `items`, `anyOf`, `allOf` …).
 * Geschwister-Schlüssel neben `$ref` (z. B. `description`, `default`) überschreiben das Ziel.
 * Zyklische Referenzen werden durch ein offenes Schema ersetzt. `allOf` ohne Konflikte wird zusammengeführt.
 */
export function resolveRefs(node: unknown, root: unknown, stack: readonly string[] = []): unknown {
  if (Array.isArray(node)) return node.map((item) => resolveRefs(item, root, stack));
  if (!isPlainObject(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref') continue;
    out[key] = DATA_KEYS.has(key) ? value : resolveRefs(value, root, stack);
  }
  const ref = node.$ref;
  if (typeof ref === 'string') {
    if (stack.includes(ref) || stack.length > 64) {
      return { ...out, description: (out.description as string | undefined) ?? `(rekursiv: ${ref.split('/').pop()})` };
    }
    const target = lookupPointer(root, ref);
    if (target === undefined) return { ...out, 'x-unresolved-ref': ref };
    const resolved = resolveRefs(target, root, [...stack, ref]);
    if (!isPlainObject(resolved)) return resolved;
    return mergeAllOf({ ...resolved, ...out });
  }
  return mergeAllOf(out);
}

/** Führt `allOf` zusammen, wenn sich die Teilschemata nicht widersprechen (typisch: `allOf: [{$ref}]` + default). */
export function mergeAllOf(schema: Record<string, unknown>): Record<string, unknown> {
  const parts = schema.allOf;
  if (!Array.isArray(parts) || !parts.every(isPlainObject)) return schema;
  const { allOf: _allOf, ...outer } = schema;
  const merged: Record<string, unknown> = {};
  const layers = [...(parts as Record<string, unknown>[]), outer];
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (key === 'properties' && isPlainObject(value)) {
        merged.properties = { ...(isPlainObject(merged.properties) ? merged.properties : {}), ...value };
      } else if (key === 'required' && Array.isArray(value)) {
        merged.required = [...new Set([...(Array.isArray(merged.required) ? merged.required : []), ...value])];
      } else if (!(key in merged)) {
        merged[key] = value;
      } else if (SOFT_KEYS.has(key)) {
        if (layer === outer) merged[key] = value; // äußere Beschreibung/Default gewinnt
      } else if (JSON.stringify(merged[key]) !== JSON.stringify(value)) {
        return schema; // echter Widerspruch → allOf beibehalten
      }
    }
  }
  return merged;
}

function unwrapDocument(openapi: unknown): Record<string, unknown> | null {
  if (!isPlainObject(openapi)) return null;
  if (isPlainObject(openapi.paths) || isPlainObject(openapi.components)) return openapi;
  if (isPlainObject(openapi.openapi)) return unwrapDocument(openapi.openapi);
  return null;
}

function requestBodySchema(operation: unknown, doc: Record<string, unknown>): unknown {
  if (!isPlainObject(operation)) return undefined;
  let body = operation.requestBody;
  if (isPlainObject(body) && typeof body.$ref === 'string') body = lookupPointer(doc, body.$ref);
  if (!isPlainObject(body) || !isPlainObject(body.content)) return undefined;
  const content = body.content;
  const json = content['application/json'] ?? Object.values(content)[0];
  return isPlainObject(json) ? json.schema : undefined;
}

/**
 * Liefert das (aufgelöste) JSON-Schema des Request-Bodys der Queue-`POST`-Operation eines Endpoints.
 * Akzeptiert das OpenAPI-Dokument oder einen Modell-Datensatz `{ openapi: … }`.
 */
export function extractInputSchema(openapi: unknown, endpointId: string): JsonSchema {
  const doc = unwrapDocument(openapi);
  if (!doc) throw new Error(`Kein OpenAPI-Dokument für „${endpointId}“`);
  const paths = isPlainObject(doc.paths) ? doc.paths : {};
  const keys = Object.keys(paths);
  const normalized = endpointId.replace(/^\/+|\/+$/g, '');
  const ordered = [
    ...keys.filter((k) => k.replace(/^\/+|\/+$/g, '') === normalized),
    ...keys.filter((k) => k.replace(/\/+$/, '').endsWith(`/${normalized}`)),
    ...keys.filter((k) => !k.includes('/requests/') && !k.includes('{')),
    ...keys,
  ];
  let schema: unknown;
  for (const key of [...new Set(ordered)]) {
    const item = paths[key];
    if (!isPlainObject(item)) continue;
    schema = requestBodySchema(item.post, doc);
    if (schema !== undefined) break;
  }
  if (schema === undefined) {
    const schemas = isPlainObject(doc.components) && isPlainObject(doc.components.schemas) ? doc.components.schemas : {};
    const inputNames = Object.keys(schemas).filter((name) => /input$/i.test(name));
    const compact = normalized.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const best = inputNames.find((name) => name.toLowerCase().replace(/input$/, '') === compact.slice(-name.length + 5)) ?? inputNames[0];
    if (best) schema = { $ref: `#/components/schemas/${best}` };
  }
  if (schema === undefined) throw new Error(`Kein Eingabeschema im OpenAPI-Dokument von „${endpointId}“ gefunden`);
  const resolved = resolveRefs(schema, doc);
  if (!isPlainObject(resolved)) throw new Error(`Eingabeschema von „${endpointId}“ ist kein Objekt`);
  if (!resolved.type && isPlainObject(resolved.properties)) resolved.type = 'object';
  return resolved;
}

// ───────────────────────── Eigenschaften lesen ─────────────────────────

export interface PropertyInfo {
  /** Typen ohne `null`, z. B. `['string']`, `['integer']`, `['array']`. */
  types: string[];
  nullable: boolean;
  enumValues: unknown[];
  default?: unknown;
  hasDefault: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  description?: string;
  title?: string;
  format?: string;
  /** Element-Info bei Arrays. */
  items?: PropertyInfo;
  /** Eigenschaftsnamen bei Objekten. */
  objectKeys: string[];
}

/** Alle Varianten eines Schemas (anyOf/oneOf flach, `null` separat). */
function variantsOf(schema: Record<string, unknown>): Record<string, unknown>[] {
  const list = [...(Array.isArray(schema.anyOf) ? schema.anyOf : []), ...(Array.isArray(schema.oneOf) ? schema.oneOf : [])].filter(isPlainObject);
  if (!list.length) return [schema];
  const base = { ...schema };
  delete base.anyOf;
  delete base.oneOf;
  return list.flatMap((variant) => variantsOf(mergeAllOf({ ...base, ...variant })));
}

function typesOf(schema: Record<string, unknown>): string[] {
  const t = schema.type;
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  if (isPlainObject(schema.properties)) return ['object'];
  if (schema.items !== undefined || schema.prefixItems !== undefined) return ['array'];
  if (Array.isArray(schema.enum)) {
    const kinds = new Set(schema.enum.map((v) => (v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v)));
    return [...kinds];
  }
  if ('const' in schema) return [schema.const === null ? 'null' : typeof schema.const];
  return [];
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function propertyInfo(input: unknown): PropertyInfo {
  const schema = isPlainObject(input) ? mergeAllOf(input) : {};
  const variants = variantsOf(schema);
  const types: string[] = [];
  let nullable = schema.nullable === true;
  const enumValues: unknown[] = [];
  const info: PropertyInfo = { types, nullable, enumValues, hasDefault: 'default' in schema, objectKeys: [] };
  for (const variant of variants) {
    for (const t of typesOf(variant)) {
      if (t === 'null') nullable = true;
      else if (!types.includes(t)) types.push(t);
    }
    if (variant.nullable === true) nullable = true;
    if (Array.isArray(variant.enum)) for (const v of variant.enum) if (v !== null && !enumValues.includes(v)) enumValues.push(v);
    if ('const' in variant && variant.const !== null && !enumValues.includes(variant.const)) enumValues.push(variant.const);
    info.minimum ??= num(variant.minimum);
    info.maximum ??= num(variant.maximum);
    info.exclusiveMinimum ??= num(variant.exclusiveMinimum);
    info.exclusiveMaximum ??= num(variant.exclusiveMaximum);
    info.minLength ??= num(variant.minLength);
    info.maxLength ??= num(variant.maxLength);
    info.minItems ??= num(variant.minItems);
    info.maxItems ??= num(variant.maxItems);
    if (!info.format && typeof variant.format === 'string') info.format = variant.format;
    if (!info.items && isPlainObject(variant.items)) info.items = propertyInfo(variant.items);
    if (isPlainObject(variant.properties)) {
      for (const key of Object.keys(variant.properties)) if (!info.objectKeys.includes(key)) info.objectKeys.push(key);
    }
    if (!info.description && typeof variant.description === 'string') info.description = variant.description;
    if (!info.title && typeof variant.title === 'string') info.title = variant.title;
    if (!info.hasDefault && 'default' in variant) {
      info.hasDefault = true;
      info.default = variant.default;
    }
  }
  if ('default' in schema) info.default = schema.default;
  if (typeof schema.description === 'string') info.description = schema.description;
  info.nullable = nullable;
  return info;
}

/** Eigenschaften in fal-Reihenfolge (`x-fal-order-properties`), sonst Pflichtfelder zuerst. */
export function schemaProperties(schema: JsonSchema): Array<[string, Record<string, unknown>]> {
  const props = isPlainObject(schema.properties) ? schema.properties : {};
  const entries = Object.entries(props).filter((entry): entry is [string, Record<string, unknown>] => isPlainObject(entry[1]));
  const order = Array.isArray(schema['x-fal-order-properties']) ? (schema['x-fal-order-properties'] as unknown[]).filter((k): k is string => typeof k === 'string') : [];
  const required = requiredSet(schema);
  const rank = (name: string): number => {
    const idx = order.indexOf(name);
    if (idx >= 0) return idx;
    return order.length + (required.has(name) ? 0 : 10_000);
  };
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry[0]) - rank(b.entry[0]) || a.index - b.index)
    .map((x) => x.entry);
}

export function requiredSet(schema: JsonSchema): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === 'string') : []);
}

// ───────────────────────── Beschreibung ─────────────────────────

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json.length > 60 ? `${json.slice(0, 59)}…` : json;
}

function typeLabel(info: PropertyInfo): string {
  const labels = info.types.map((t) => {
    if (t === 'array') {
      const inner = info.items ? typeLabel(info.items) : 'any';
      return `array<${inner}>`;
    }
    if (t === 'object' && info.objectKeys.length) {
      const keys = info.objectKeys.slice(0, 6).join(', ');
      return `object{${keys}${info.objectKeys.length > 6 ? ', …' : ''}}`;
    }
    return t;
  });
  if (!labels.length) labels.push(info.enumValues.length ? 'enum' : 'any');
  return labels.join(' | ');
}

function rangeLabel(info: PropertyInfo): string | undefined {
  const low = info.minimum ?? info.exclusiveMinimum;
  const high = info.maximum ?? info.exclusiveMaximum;
  const lowOp = info.minimum !== undefined ? '≥' : '>';
  const highOp = info.maximum !== undefined ? '≤' : '<';
  if (low !== undefined && high !== undefined && info.minimum !== undefined && info.maximum !== undefined) return `${low}–${high}`;
  const parts: string[] = [];
  if (low !== undefined) parts.push(`${lowOp}${low}`);
  if (high !== undefined) parts.push(`${highOp}${high}`);
  if (info.minLength !== undefined || info.maxLength !== undefined) parts.push(`Länge ${info.minLength ?? 0}–${info.maxLength ?? '∞'}`);
  if (info.minItems !== undefined || info.maxItems !== undefined) parts.push(`${info.minItems ?? 0}–${info.maxItems ?? '∞'} Einträge`);
  return parts.length ? parts.join(', ') : undefined;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Kompakte Parameterliste, z. B.
 * `- aspect_ratio (string; Werte: 16:9 | 9:16; Standard: 16:9): Seitenverhältnis …`
 * Pflichtfelder tragen `*`.
 */
export function describeSchema(schema: JsonSchema, opts: { maxDescription?: number; maxEnum?: number } = {}): string {
  const maxDescription = opts.maxDescription ?? 160;
  const maxEnum = opts.maxEnum ?? 20;
  const props = schemaProperties(schema);
  if (!props.length) return 'Keine Parameter definiert.';
  const required = requiredSet(schema);
  const lines = ['Parameter (* = Pflicht):'];
  for (const [name, prop] of props) {
    const info = propertyInfo(prop);
    const meta: string[] = [typeLabel(info)];
    const enumValues = info.enumValues.length ? info.enumValues : (info.items?.enumValues ?? []);
    if (enumValues.length) {
      const shown = enumValues.slice(0, maxEnum).map(formatValue).join(' | ');
      meta.push(`Werte: ${shown}${enumValues.length > maxEnum ? ` | … (+${enumValues.length - maxEnum})` : ''}`);
    }
    if (info.hasDefault && info.default !== undefined && info.default !== null) meta.push(`Standard: ${formatValue(info.default)}`);
    const range = rangeLabel(info);
    if (range) meta.push(range);
    if (info.nullable && !required.has(name)) meta.push('optional');
    const description = info.description ?? info.title;
    const desc = description ? `: ${oneLine(description, maxDescription)}` : '';
    lines.push(`- ${name}${required.has(name) ? '*' : ''} (${meta.join('; ')})${desc}`);
  }
  return lines.join('\n');
}
