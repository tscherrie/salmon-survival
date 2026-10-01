import type { ErrorObject, ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { isPlainObject, type JsonSchema } from './schema.ts';

/**
 * Eingabeprüfung vor dem Absenden (Ajv, JSON Schema 2020-12, tolerant):
 * - OpenAPI-3.0-Eigenheiten werden vorher umgeschrieben (`nullable`, boolesches `exclusiveMinimum`, Tupel-`items`).
 * - Unbekannte Schlüsselwörter (`x-fal-*`, `examples`, `discriminator` …) und unbekannte Formate werden ignoriert.
 * - Ist das Schema selbst nicht kompilierbar, gilt die Eingabe als gültig (mit Warnung) – fal prüft serverseitig erneut.
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** Hinweise, die das Absenden nicht verhindern (z. B. unbekannte Parameter). */
  warnings?: string[];
}

let ajvInstance: Ajv2020 | undefined;
const compiled = new WeakMap<object, ValidateFunction | Error>();

function ajv(): Ajv2020 {
  if (!ajvInstance) {
    ajvInstance = new Ajv2020({
      strict: false,
      allErrors: true,
      allowUnionTypes: true,
      validateSchema: false,
      logger: false,
      coerceTypes: false,
      useDefaults: false,
    });
    addFormats(ajvInstance);
  }
  return ajvInstance;
}

/** Schreibt OpenAPI-3.0-/Draft-04-Konstrukte in 2020-12-kompatible Form um (tiefe Kopie). */
export function toAjvSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toAjvSchema);
  if (!isPlainObject(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema' || key === '$id' || key === 'id' || key === 'discriminator' || key === 'x-unresolved-ref') continue;
    if (key === 'enum' || key === 'const' || key === 'default' || key === 'examples' || key === 'example' || key === 'required') {
      out[key] = value;
      continue;
    }
    if (key === 'properties' || key === 'patternProperties' || key === '$defs' || key === 'definitions' || key === 'dependentSchemas') {
      out[key] = isPlainObject(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toAjvSchema(v)])) : value;
      continue;
    }
    out[key] = toAjvSchema(value);
  }
  // OpenAPI 3.0: nullable
  if (out.nullable === true) {
    if (typeof out.type === 'string') out.type = [out.type, 'null'];
    else if (Array.isArray(out.type) && !out.type.includes('null')) out.type = [...out.type, 'null'];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  delete out.nullable;
  // Draft-04: boolesches exclusiveMinimum/-Maximum
  if (typeof out.exclusiveMinimum === 'boolean') {
    if (out.exclusiveMinimum && typeof out.minimum === 'number') {
      out.exclusiveMinimum = out.minimum;
      delete out.minimum;
    } else delete out.exclusiveMinimum;
  }
  if (typeof out.exclusiveMaximum === 'boolean') {
    if (out.exclusiveMaximum && typeof out.maximum === 'number') {
      out.exclusiveMaximum = out.maximum;
      delete out.maximum;
    } else delete out.exclusiveMaximum;
  }
  // Draft-07: Tupel über items-Array → prefixItems
  if (Array.isArray(out.items)) {
    out.prefixItems = out.items;
    if (out.additionalItems !== undefined) out.items = out.additionalItems;
    else delete out.items;
    delete out.additionalItems;
  }
  return out;
}

function compile(schema: JsonSchema): ValidateFunction | Error {
  const cached = compiled.get(schema);
  if (cached) return cached;
  let result: ValidateFunction | Error;
  try {
    result = ajv().compile(toAjvSchema(schema) as object);
  } catch (error) {
    result = error instanceof Error ? error : new Error(String(error));
  }
  compiled.set(schema, result);
  return result;
}

const TYPE_LABELS: Record<string, string> = {
  string: 'Text',
  integer: 'Ganzzahl',
  number: 'Zahl',
  boolean: 'Wahrheitswert (true/false)',
  array: 'Liste',
  object: 'Objekt',
  null: 'null',
};

function fieldName(instancePath: string, child?: string): string {
  const parts = instancePath
    .split('/')
    .filter(Boolean)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (child) parts.push(child);
  let out = '';
  for (const part of parts) out += /^\d+$/.test(part) ? `[${part}]` : out ? `.${part}` : part;
  return out || 'Eingabe';
}

function short(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > 40 ? `${text.slice(0, 39)}…` : String(text);
}

function germanMessage(error: ErrorObject): string {
  const field = `„${fieldName(error.instancePath)}“`;
  const p = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'required':
      return `Pflichtfeld „${fieldName(error.instancePath, String(p.missingProperty))}“ fehlt`;
    case 'type': {
      const types = String(p.type)
        .split(',')
        .map((t) => TYPE_LABELS[t] ?? t);
      return `${field} muss vom Typ ${types.join(' oder ')} sein`;
    }
    case 'enum': {
      const allowed = Array.isArray(p.allowedValues) ? p.allowedValues : [];
      const shown = allowed.slice(0, 15).map(short).join(', ');
      return `${field} muss einer der Werte sein: ${shown}${allowed.length > 15 ? ', …' : ''}`;
    }
    case 'const':
      return `${field} muss genau ${short(p.allowedValue)} sein`;
    case 'minimum':
      return `${field} muss ≥ ${p.limit} sein`;
    case 'maximum':
      return `${field} muss ≤ ${p.limit} sein`;
    case 'exclusiveMinimum':
      return `${field} muss > ${p.limit} sein`;
    case 'exclusiveMaximum':
      return `${field} muss < ${p.limit} sein`;
    case 'multipleOf':
      return `${field} muss ein Vielfaches von ${p.multipleOf} sein`;
    case 'minLength':
      return `${field} muss mindestens ${p.limit} Zeichen lang sein`;
    case 'maxLength':
      return `${field} darf höchstens ${p.limit} Zeichen lang sein`;
    case 'minItems':
      return `${field} braucht mindestens ${p.limit} Einträge`;
    case 'maxItems':
      return `${field} darf höchstens ${p.limit} Einträge haben`;
    case 'uniqueItems':
      return `${field} darf keine doppelten Einträge enthalten`;
    case 'additionalProperties':
      return `Unbekannter Parameter „${fieldName(error.instancePath, String(p.additionalProperty))}“`;
    case 'format':
      return `${field} hat kein gültiges Format (${p.format})`;
    case 'pattern':
      return `${field} entspricht nicht dem Muster ${p.pattern}`;
    case 'minProperties':
      return `${field} braucht mindestens ${p.limit} Felder`;
    case 'maxProperties':
      return `${field} darf höchstens ${p.limit} Felder haben`;
    default:
      return `${field}: ${error.message ?? error.keyword}`;
  }
}

/** Fasst anyOf/oneOf-Fehler samt ihrer Unterfehler zu je einer Meldung zusammen. */
function summarize(errors: ErrorObject[]): string[] {
  const groups = errors.filter((e) => e.keyword === 'anyOf' || e.keyword === 'oneOf');
  const consumed = new Set<ErrorObject>();
  const messages: string[] = [];
  // Äußerste Gruppen zuerst (kürzester schemaPath), damit verschachtelte Varianten nicht doppelt erscheinen.
  for (const group of [...groups].sort((a, b) => a.schemaPath.length - b.schemaPath.length)) {
    if (consumed.has(group)) continue;
    const prefix = `${group.schemaPath}/`;
    const children = errors.filter((e) => e !== group && e.schemaPath.startsWith(prefix));
    children.forEach((c) => consumed.add(c));
    consumed.add(group);
    const field = `„${fieldName(group.instancePath)}“`;
    if (group.keyword === 'oneOf' && Array.isArray((group.params as Record<string, unknown>).passingSchemas)) {
      messages.push(`${field} passt zu mehreren Varianten gleichzeitig`);
      continue;
    }
    const childMessages = [...new Set(children.filter((c) => c.keyword !== 'anyOf' && c.keyword !== 'oneOf').map(germanMessage))];
    messages.push(
      childMessages.length
        ? `${field} passt zu keiner erlaubten Variante (${childMessages.slice(0, 3).join(' oder ')})`
        : `${field} passt zu keiner erlaubten Variante`,
    );
  }
  for (const error of errors) {
    if (consumed.has(error) || error.keyword === 'if') continue;
    messages.push(germanMessage(error));
  }
  return [...new Set(messages)];
}

/** Prüft eine Modelleingabe gegen das Eingabeschema; Meldungen auf Deutsch. */
export function validateInput(schema: JsonSchema, input: unknown): ValidationResult {
  const validator = compile(schema);
  if (validator instanceof Error) {
    return { ok: true, errors: [], warnings: [`Schema nicht lokal prüfbar (${validator.message.slice(0, 120)}) – fal prüft beim Absenden`] };
  }
  const valid = validator(input) as boolean;
  const warnings: string[] = [];
  const props = isPlainObject(schema.properties) ? schema.properties : undefined;
  if (props && isPlainObject(input) && schema.additionalProperties !== false) {
    for (const key of Object.keys(input)) {
      if (!(key in props)) warnings.push(`Unbekannter Parameter „${key}“ – wird vom Modell vermutlich ignoriert`);
    }
  }
  const errors = valid ? [] : summarize(validator.errors ?? []);
  return warnings.length ? { ok: valid, errors, warnings } : { ok: valid, errors };
}
