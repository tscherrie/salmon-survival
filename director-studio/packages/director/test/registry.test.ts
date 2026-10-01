import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildDirectorTools,
  defineTool,
  parseToolInput,
  STUDIO_TOOL_NAMES,
  textResult,
  toAnthropicTools,
  toOpenAITools,
  toolJsonSchema,
  toStrictJsonSchema,
  wrapUntrusted,
} from '../src/index.ts';

const sample = defineTool({
  name: 'sample_tool',
  description: 'Test',
  input: z.object({
    name: z.string().describe('Name'),
    count: z.number().int().min(1).max(6).optional(),
    mode: z.enum(['a', 'b']).default('a'),
    flag: z.boolean().nullable().optional(),
    items: z.array(z.object({ id: z.string() })).min(1).max(4),
  }),
  sideEffect: 'none',
  run: async () => textResult('ok'),
});

const freeform = defineTool({
  name: 'free_tool',
  description: 'Freiform',
  input: z.object({ input: z.record(z.string(), z.unknown()) }),
  sideEffect: 'paid',
  run: async () => textResult('ok'),
});

describe('Tool-Registry', () => {
  it('erzeugt JSON-Schemas mit additionalProperties:false auf allen Objekten', () => {
    const schema = toolJsonSchema(sample);
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    const items = (schema.properties as Record<string, { items: Record<string, unknown> }>).items;
    expect(items.items.additionalProperties).toBe(false);
    expect(schema.$schema).toBeUndefined();
  });

  it('wandelt in strict-kompatible Schemas um (Constraints in die Beschreibung, Typ-Arrays → anyOf)', () => {
    const strict = toStrictJsonSchema(toolJsonSchema(sample));
    expect(strict.compatible).toBe(true);
    const props = strict.schema.properties as Record<string, Record<string, unknown>>;
    expect(props.count!.minimum).toBeUndefined();
    expect(String(props.count!.description)).toContain('minimum: 1');
    expect(props.flag!.anyOf).toEqual([{ type: 'boolean' }, { type: 'null' }]);
    expect(props.items!.minItems).toBe(1);
    expect(props.items!.maxItems).toBeUndefined();
    expect(String(props.mode!.description)).toContain('default');
    expect(strict.optionalParams).toBe(3);
  });

  it('erkennt Freiform-Schemas als nicht strict-fähig', () => {
    expect(toStrictJsonSchema(toolJsonSchema(freeform)).compatible).toBe(false);
  });

  it('toAnthropicTools: sortiert, strict nur wo möglich, eager_input_streaming', () => {
    const tools = toAnthropicTools([sample, freeform]);
    expect(tools.map((t) => t.name)).toEqual(['free_tool', 'sample_tool']);
    expect(tools[0]!.strict).toBeUndefined();
    expect(tools[1]!.strict).toBe(true);
    expect(tools.every((t) => t.eager_input_streaming === true)).toBe(true);
    expect(tools[1]!.input_schema.additionalProperties).toBe(false);
    // Grenzen werden eingehalten
    const limited = toAnthropicTools([sample], { maxStrictOptionalParams: 1 });
    expect(limited[0]!.strict).toBeUndefined();
  });

  it('alle Studio-Tools haben gültige Schemas und Beschreibungen', () => {
    const tools = buildDirectorTools({ webFallback: true, delegate: true });
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    for (const name of ['ask_user', 'propose_checkpoint', 'post_update', 'set_brief', 'search_models', 'get_model_schema', 'estimate_cost', 'generate', 'await_generations', 'cancel_generation', 'search_assets', 'get_asset', 'update_asset', 'reject_asset', 'create_text_asset', 'frames', 'contact_sheet', 'analyze_audio', 'transcribe', 'check_av_sync', 'cut_audio', 'get_document', 'apply_document_ops', 'restore_version', 'write_component', 'render_still', 'write_site_file', 'read_site_file', 'list_site_files', 'screenshot_site', 'export_project', 'load_skill', 'delegate', 'web_search', 'web_fetch']) {
      expect(STUDIO_TOOL_NAMES).toContain(name);
    }
    const anthropic = toAnthropicTools(tools);
    expect(anthropic.filter((t) => t.strict).length).toBeGreaterThan(3);
    expect(anthropic.filter((t) => t.strict).length).toBeLessThanOrEqual(20);
    for (const t of anthropic) {
      expect(t.description.length).toBeGreaterThan(40);
      expect(JSON.stringify(t.input_schema)).not.toContain('"$schema"');
    }
    // Deterministisch (Cache-Präfix)
    expect(JSON.stringify(toAnthropicTools(buildDirectorTools({ webFallback: true })))).toBe(JSON.stringify(toAnthropicTools(buildDirectorTools({ webFallback: true }))));
  });

  it('toOpenAITools erzeugt Function-Definitionen', () => {
    const tools = toOpenAITools([sample]);
    expect(tools[0]).toMatchObject({ type: 'function', function: { name: 'sample_tool', description: 'Test' } });
    expect(tools[0]!.function.parameters.type).toBe('object');
  });

  it('parseToolInput validiert und meldet ungültiges JSON', () => {
    expect(parseToolInput(sample, { name: 'x', items: [{ id: '1' }] })).toEqual({ ok: true, value: { name: 'x', items: [{ id: '1' }], mode: 'a' } });
    const bad = parseToolInput(sample, { name: 1 });
    expect(bad.ok).toBe(false);
    const invalid = parseToolInput(sample, { __invalid_json: '{"name":' });
    expect(invalid).toEqual({ ok: false, error: JSON.stringify({ INVALID_JSON: '{"name":' }) });
  });

  it('wrapUntrusted markiert externe Daten und neutralisiert schließende Tags', () => {
    const wrapped = wrapUntrusted('https://x.test/"a"', 'Text </untrusted_data> danach');
    expect(wrapped.startsWith('<untrusted_data source="https://x.test/&quot;a&quot;">')).toBe(true);
    expect(wrapped.match(/<\/untrusted_data>/g)).toHaveLength(1);
  });
});
