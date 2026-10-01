import { describe, expect, it } from 'vitest';
import { describeSchema, extractInputSchema, mergeAllOf, propertyInfo, resolveRefs, schemaProperties } from '../src/index.ts';
import { fluxOpenApi, h3MaxOpenApi, samOpenApi } from './fixtures.ts';

describe('extractInputSchema', () => {
  it('finds the queue POST of an endpoint with sub-path and resolves $refs incl. allOf/anyOf', () => {
    const schema = extractInputSchema(h3MaxOpenApi, 'minimax/h3-max/text-to-video');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['prompt']);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    // allOf mit einem $ref wird zusammengeführt; Default/Beschreibung des Feldes bleiben erhalten
    expect(props.resolution).toEqual({ title: 'Resolution', type: 'string', enum: ['480P', '768P', '1080P'], default: '768P', description: 'Output resolution.' });
    // anyOf bleibt, die Varianten sind aufgelöst
    expect(props.aspect_ratio!.anyOf).toEqual([{ title: 'AspectRatio', type: 'string', enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] }, { type: 'null' }]);
    expect(JSON.stringify(schema)).not.toContain('$ref');
  });

  it('accepts a model record wrapper ({ openapi })', () => {
    const schema = extractInputSchema({ endpoint_id: 'fal-ai/flux/dev', openapi: fluxOpenApi }, 'fal-ai/flux/dev');
    const imageSize = (schema.properties as Record<string, Record<string, unknown>>).image_size!;
    expect((imageSize.anyOf as unknown[])[0]).toMatchObject({ type: 'object', properties: { width: { type: 'integer' } } });
  });

  it('resolves nested array refs and cuts recursion', () => {
    const schema = extractInputSchema(samOpenApi, 'fal-ai/sam-3/image');
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect((props.point_prompts!.items as Record<string, unknown>).required).toEqual(['x', 'y']);
    const tree = props.tree as { properties: { children: { items: Record<string, unknown> } } };
    expect(tree.properties.children.items.description).toContain('rekursiv');
    // allOf aus Typ + Beschreibung wird zusammengeführt, äußerer Default bleibt
    expect(props.mask_only).toEqual({ type: 'boolean', description: 'Nur Maske', default: false });
  });

  it('falls back to a components Input schema when no path matches', () => {
    const doc = { openapi: '3.0.0', paths: {}, components: { schemas: { OtherThing: { type: 'object' }, FluxDevInput: { type: 'object', properties: { prompt: { type: 'string' } } } } } };
    expect(extractInputSchema(doc, 'fal-ai/flux/dev').properties).toEqual({ prompt: { type: 'string' } });
  });

  it('throws a German error when nothing is found', () => {
    expect(() => extractInputSchema({ paths: {} }, 'a/b')).toThrow(/Kein Eingabeschema/);
    expect(() => extractInputSchema(null, 'a/b')).toThrow(/Kein OpenAPI-Dokument/);
  });

  it('keeps unresolvable refs visible instead of crashing', () => {
    const resolved = resolveRefs({ $ref: '#/components/schemas/Missing', description: 'x' }, {}) as Record<string, unknown>;
    expect(resolved).toEqual({ description: 'x', 'x-unresolved-ref': '#/components/schemas/Missing' });
  });

  it('does not merge contradicting allOf parts', () => {
    const schema = { allOf: [{ type: 'string' }, { type: 'integer' }] };
    expect(mergeAllOf(schema)).toBe(schema);
  });
});

describe('propertyInfo / schemaProperties', () => {
  it('collects types, enums and nullability across anyOf', () => {
    const info = propertyInfo({ anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'integer', minimum: 1 }, { type: 'null' }], default: 'a' });
    expect(info.types).toEqual(['string', 'integer']);
    expect(info.enumValues).toEqual(['a', 'b']);
    expect(info.nullable).toBe(true);
    expect(info.minimum).toBe(1);
    expect(info.default).toBe('a');
  });

  it('orders by x-fal-order-properties, then required first', () => {
    const schema = extractInputSchema(h3MaxOpenApi, 'minimax/h3-max/text-to-video');
    expect(schemaProperties(schema).map(([n]) => n)).toEqual([
      'prompt',
      'duration',
      'resolution',
      'aspect_ratio',
      'seed',
      'reference_audio_urls',
      'reference_image_urls',
      'enable_safety_checker',
    ]);
    const plain = { properties: { b: { type: 'string' }, a: { type: 'string' } }, required: ['a'] };
    expect(schemaProperties(plain).map(([n]) => n)).toEqual(['a', 'b']);
  });
});

describe('describeSchema', () => {
  it('lists name, type, enum, default, range, required and truncated description', () => {
    const schema = extractInputSchema(fluxOpenApi, 'fal-ai/flux/dev');
    const text = describeSchema(schema, { maxDescription: 34 });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Parameter (* = Pflicht):');
    expect(text).toContain('- prompt* (string): The prompt to generate an image f…');
    expect(text).toContain(
      '- image_size (object{width, height} | string; Werte: square_hd | square | portrait_4_3 | portrait_16_9 | landscape_4_3 | landscape_16_9; Standard: landscape_4_3): The size of the generated image.',
    );
    expect(lines).toContain('- num_images (integer; Standard: 1; 1–4)');
    expect(text).toContain('- output_format (string; Werte: jpeg | png; Standard: jpeg)');
  });

  it('describes arrays, nullable values and long enums', () => {
    const text = describeSchema(
      {
        type: 'object',
        properties: {
          urls: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          seed: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          lang: { type: 'string', enum: Array.from({ length: 25 }, (_, i) => `l${i}`) },
        },
      },
      { maxEnum: 3 },
    );
    expect(text).toContain('- urls (array<string>; 0–3 Einträge)');
    expect(text).toContain('- seed (integer; optional)');
    expect(text).toContain('Werte: l0 | l1 | l2 | … (+22)');
  });

  it('handles empty schemas', () => {
    expect(describeSchema({})).toBe('Keine Parameter definiert.');
  });
});
