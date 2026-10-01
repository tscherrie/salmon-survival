import { z } from 'zod';
import type { ChatMessage, IdGenerator } from '@studio/core';
import type { ProjectStore } from '@studio/project';
import type { Clock, GenerationPort, MediaPort, ModelCatalogPort, RenderPort, TranscribePort, UiPort, WebPort } from '../ports.ts';
import type { ImageMediaType } from '../util.ts';
import type { GenerationManager } from './generation.ts';
import type { SkillLibrary } from '../skills.ts';

/**
 * Provider-neutrale Tool-Registry: Jedes Studio-Tool ist einmal definiert (Name, Beschreibung für das
 * Modell, Zod-Schema, Seiteneffekt-Klasse, Handler). Adapter übersetzen es für die Anthropic Messages
 * API, OpenAI-kompatible Function-Calls (fal-Router) und das Claude Agent SDK.
 */

export type ToolSideEffect = 'none' | 'local' | 'paid';

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; mediaType: ImageMediaType; data: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface SubagentRequest {
  task: string;
  model: string;
  toolNames: string[];
  maxIterations?: number;
}

export type SubagentRunner = (request: SubagentRequest, ctx: { runId: string; signal: AbortSignal }) => Promise<{ text: string; costUsd: number; iterations: number }>;

/** Alles, was ein Tool zur Laufzeit braucht. */
export interface ToolContext {
  project: ProjectStore;
  catalog: ModelCatalogPort;
  generation: GenerationPort;
  media?: MediaPort | undefined;
  render?: RenderPort | undefined;
  transcribe?: TranscribePort | undefined;
  web?: WebPort | undefined;
  ui: UiPort;
  runId: string;
  signal: AbortSignal;
  emitProgress(text: string): void;
  projectDir: string;
  projectId: string;
  clock: Clock;
  ids: IdGenerator;
  /** Hintergrund-Generierungen dieser Session. */
  jobs: GenerationManager;
  skills: SkillLibrary;
  /** Verschachtelter Lauf für `delegate` (nur im eigenen Tool-Loop verfügbar). */
  runSubagent?: SubagentRunner | undefined;
  /** Schreibt eine Director-Nachricht wörtlich ins Panel (persistiert + Ereignis). */
  postMessage(text: string): Promise<ChatMessage>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface DirectorTool<S extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  /** Für das Modell geschrieben: präzise, wann das Tool zu verwenden ist. */
  description: string;
  input: S;
  sideEffect: ToolSideEffect;
  run(input: z.output<S>, ctx: ToolContext): Promise<ToolResult>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDirectorTool = DirectorTool<any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineTool<S extends z.ZodObject<any>>(def: DirectorTool<S>): DirectorTool<S> {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(def.name)) throw new Error(`Ungültiger Tool-Name: ${def.name}`);
  return def;
}

// ───────────────────────── Ergebnis-Helfer ─────────────────────────

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function resultText(result: ToolResult): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

/** Validiert eine Modell-Eingabe gegen das Tool-Schema. */
export function parseToolInput(tool: AnyDirectorTool, input: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (input && typeof input === 'object' && '__invalid_json' in (input as Record<string, unknown>)) {
    return { ok: false, error: JSON.stringify({ INVALID_JSON: String((input as Record<string, unknown>).__invalid_json) }) };
  }
  const parsed = tool.input.safeParse(input ?? {});
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return { ok: false, error: `Ungültige Eingabe für ${tool.name}: ${issues}` };
}

// ───────────────────────── JSON-Schema ─────────────────────────

type Json = Record<string, unknown>;

/** JSON-Schema eines Tools (Eingabeseite), alle Objekte mit `additionalProperties: false`. */
export function toolJsonSchema(tool: AnyDirectorTool): Json {
  const raw = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' }) as Json;
  delete raw.$schema;
  return closeObjects(raw) as Json;
}

function closeObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (k === 'properties' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(Object.entries(v as Json).map(([pk, pv]) => [pk, closeObjects(pv)]));
    } else {
      out[k] = closeObjects(v);
    }
  }
  if ((out.type === 'object' || out.properties) && out.additionalProperties === undefined && out.properties) {
    out.additionalProperties = false;
  }
  return out;
}

const STRICT_STRING_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);

export interface StrictSchemaResult {
  schema: Json;
  /** `false`, wenn das Schema Freiform-Teile enthält (z. B. `z.record`, `z.unknown`) → kein `strict`. */
  compatible: boolean;
  optionalParams: number;
  unionParams: number;
}

/**
 * Wandelt ein JSON-Schema in die von „strict tool use“ unterstützte Teilmenge um (angelehnt an
 * `transformJSONSchema` des Anthropic-SDK): nicht unterstützte Einschränkungen (min/max, Längen,
 * Defaults, Muster) wandern in die Beschreibung und werden clientseitig per Zod geprüft.
 */
export function toStrictJsonSchema(schema: Json): StrictSchemaResult {
  const state = { compatible: true, optionalParams: 0, unionParams: 0 };
  const result = transformStrict(structuredClone(schema), state);
  return { schema: result, ...state };
}

function transformStrict(node: Json, state: { compatible: boolean; optionalParams: number; unionParams: number }): Json {
  const out: Json = {};
  const rest: Json = { ...node };
  const take = (key: string) => {
    const v = rest[key];
    delete rest[key];
    return v;
  };
  if (take('$ref') !== undefined || take('$defs') !== undefined) state.compatible = false;
  let type = take('type');
  const anyOf = take('anyOf') ?? take('oneOf');
  const allOf = take('allOf');
  const enumValues = take('enum');
  const constValue = take('const');
  const description = take('description');
  const title = take('title');

  if (Array.isArray(type)) {
    // `type: ["string","null"]` → anyOf (strict unterstützt anyOf).
    const variants = (type as string[]).map((t) => ({ type: t }));
    state.unionParams += 1;
    out.anyOf = variants;
    type = undefined;
  } else if (Array.isArray(anyOf)) {
    state.unionParams += 1;
    out.anyOf = (anyOf as Json[]).map((v) => transformStrict(v, state));
  } else if (Array.isArray(allOf)) {
    out.allOf = (allOf as Json[]).map((v) => transformStrict(v, state));
  } else if (type !== undefined) {
    out.type = type;
  } else if (enumValues === undefined && constValue === undefined) {
    // Freiform (`{}`): mit strict nicht darstellbar.
    state.compatible = false;
  }
  if (enumValues !== undefined) out.enum = enumValues;
  if (constValue !== undefined) out.const = constValue;
  if (description !== undefined) out.description = description;
  if (title !== undefined) out.title = title;

  if (type === 'object') {
    const properties = (take('properties') as Json | undefined) ?? {};
    const additional = take('additionalProperties');
    if (additional !== undefined && additional !== false) state.compatible = false;
    take('propertyNames');
    out.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, transformStrict(v as Json, state)]));
    out.additionalProperties = false;
    const required = (take('required') as string[] | undefined) ?? [];
    if (required.length) out.required = required;
    state.optionalParams += Object.keys(properties).filter((k) => !required.includes(k)).length;
  } else if (type === 'string') {
    const format = take('format');
    if (typeof format === 'string' && STRICT_STRING_FORMATS.has(format)) out.format = format;
    else if (format !== undefined) rest.format = format;
  } else if (type === 'array') {
    const items = take('items');
    if (items && typeof items === 'object' && !Array.isArray(items)) out.items = transformStrict(items as Json, state);
    else if (items !== undefined) state.compatible = false;
    const minItems = take('minItems');
    if (minItems === 0 || minItems === 1) out.minItems = minItems;
    else if (minItems !== undefined) rest.minItems = minItems;
  }

  const leftovers = Object.entries(rest).filter(([, v]) => v !== undefined);
  if (leftovers.length) {
    const note = `{${leftovers.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')}}`;
    out.description = out.description ? `${String(out.description)}\n\n${note}` : note;
  }
  return out;
}

// ───────────────────────── Adapter ─────────────────────────

export interface AnthropicToolOptions {
  /** `strict: true` für kompatible Schemas (Standard: an). */
  strict?: boolean;
  /** `eager_input_streaming` (nur sinnvoll bei Streaming-Anfragen; Standard: an). */
  eagerInputStreaming?: boolean;
  /**
   * Komplexitätsgrenzen für strict-Schemas. Die Werte entsprechen den dokumentierten Grenzen für
   * strukturierte Ausgaben (aus dem Gedächtnis, lokal nicht verifiziert) – konservativ, denn ein
   * nicht-strict Tool wird trotzdem clientseitig per Zod geprüft.
   */
  maxStrictTools?: number;
  maxStrictOptionalParams?: number;
  maxStrictUnionParams?: number;
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: { type: 'object'; [k: string]: unknown };
  strict?: boolean;
  eager_input_streaming?: boolean;
}

const SIDE_EFFECT_PRIORITY: Record<ToolSideEffect, number> = { paid: 0, local: 1, none: 2 };

/** Tools für die Anthropic Messages API (deterministisch nach Namen sortiert – Cache-Präfix). */
export function toAnthropicTools(tools: readonly AnyDirectorTool[], options: AnthropicToolOptions = {}): AnthropicToolDefinition[] {
  const strictEnabled = options.strict ?? true;
  const eager = options.eagerInputStreaming ?? true;
  const limits = {
    tools: options.maxStrictTools ?? 20,
    optional: options.maxStrictOptionalParams ?? 24,
    unions: options.maxStrictUnionParams ?? 16,
  };
  const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const strictNames = new Set<string>();
  const strictSchemas = new Map<string, Json>();
  if (strictEnabled) {
    let used = { tools: 0, optional: 0, unions: 0 };
    const byPriority = [...sorted].sort((a, b) => SIDE_EFFECT_PRIORITY[a.sideEffect] - SIDE_EFFECT_PRIORITY[b.sideEffect] || (a.name < b.name ? -1 : 1));
    for (const tool of byPriority) {
      const strict = toStrictJsonSchema(toolJsonSchema(tool));
      if (!strict.compatible) continue;
      const next = { tools: used.tools + 1, optional: used.optional + strict.optionalParams, unions: used.unions + strict.unionParams };
      if (next.tools > limits.tools || next.optional > limits.optional || next.unions > limits.unions) continue;
      used = next;
      strictNames.add(tool.name);
      strictSchemas.set(tool.name, strict.schema);
    }
  }
  return sorted.map((tool) => {
    const isStrict = strictNames.has(tool.name);
    const schema = (isStrict ? strictSchemas.get(tool.name)! : toolJsonSchema(tool)) as AnthropicToolDefinition['input_schema'];
    const def: AnthropicToolDefinition = { name: tool.name, description: tool.description, input_schema: { ...schema, type: 'object' } };
    if (isStrict) def.strict = true;
    if (eager) def.eager_input_streaming = true;
    return def;
  });
}

export interface OpenAIToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Json };
}

/** Function-Definitionen für OpenAI-kompatible Endpunkte (fal-Router). */
export function toOpenAITools(tools: readonly AnyDirectorTool[]): OpenAIToolDefinition[] {
  return [...tools]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((tool) => ({ type: 'function' as const, function: { name: tool.name, description: tool.description, parameters: toolJsonSchema(tool) } }));
}
