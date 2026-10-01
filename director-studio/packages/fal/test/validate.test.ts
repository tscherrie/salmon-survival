import { describe, expect, it } from 'vitest';
import { extractInputSchema, toAjvSchema, validateInput } from '../src/index.ts';
import { fluxOpenApi, h3MaxOpenApi } from './fixtures.ts';

const h3 = extractInputSchema(h3MaxOpenApi, 'minimax/h3-max/text-to-video');
const flux = extractInputSchema(fluxOpenApi, 'fal-ai/flux/dev');

describe('validateInput', () => {
  it('accepts valid input', () => {
    expect(validateInput(h3, { prompt: 'Ein Lachs springt', duration: 10, resolution: '1080P', aspect_ratio: '9:16', seed: null })).toEqual({ ok: true, errors: [] });
    expect(validateInput(flux, { prompt: 'x', image_size: { width: 1024, height: 768 } }).ok).toBe(true);
    expect(validateInput(flux, { prompt: 'x', image_size: 'square_hd' }).ok).toBe(true);
  });

  it('reports German messages for required, enum, type and ranges', () => {
    const result = validateInput(h3, { duration: 20, resolution: '4K', seed: 'abc', reference_audio_urls: ['a', 'b', 'c', 'd'] });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Pflichtfeld „prompt“ fehlt');
    expect(result.errors).toContain('„duration“ muss einer der Werte sein: 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15');
    expect(result.errors).toContain('„resolution“ muss einer der Werte sein: 480P, 768P, 1080P');
    expect(result.errors.some((e) => e.startsWith('„seed“ passt zu keiner erlaubten Variante'))).toBe(true);
    expect(result.errors).toContain('„reference_audio_urls“ darf höchstens 3 Einträge haben');
  });

  it('summarizes anyOf failures in one message', () => {
    const result = validateInput(flux, { prompt: 'x', image_size: 'huge' });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^„image_size“ passt zu keiner erlaubten Variante \(.*Objekt.*square_hd/);
  });

  it('reports nested paths and min/max', () => {
    const result = validateInput(flux, { prompt: 'x', image_size: { width: 0, height: 99999 }, num_images: 9 });
    expect(result.errors).toContain('„num_images“ muss ≤ 4 sein');
    expect(result.errors.join(' ')).toContain('„image_size.width“ muss ≥ 1 sein');
  });

  it('warns about unknown parameters but stays ok', () => {
    const result = validateInput(flux, { prompt: 'x', foo: 1 });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(['Unbekannter Parameter „foo“ – wird vom Modell vermutlich ignoriert']);
  });

  it('enforces additionalProperties: false', () => {
    const result = validateInput({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }, { a: 'x', b: 1 });
    expect(result).toMatchObject({ ok: false, errors: ['Unbekannter Parameter „b“'] });
  });

  it('rejects non-object input', () => {
    expect(validateInput(flux, 'prompt').errors).toEqual(['„Eingabe“ muss vom Typ Objekt sein']);
  });

  it('handles OpenAPI 3.0 nullable, boolean exclusiveMinimum and tuple items', () => {
    const schema = {
      type: 'object',
      properties: {
        strength: { type: 'number', minimum: 0, exclusiveMinimum: true, maximum: 1, nullable: true },
        timestamp: { type: 'array', items: [{ type: 'number' }, { type: 'number' }] },
        mode: { type: 'string', enum: ['a', 'b'], nullable: true },
      },
    };
    expect(validateInput(schema, { strength: null, timestamp: [1, 2], mode: null }).ok).toBe(true);
    expect(validateInput(schema, { strength: 0 }).errors).toEqual(['„strength“ muss > 0 sein']);
    expect(validateInput(schema, { timestamp: [1, 'x'] }).errors).toEqual(['„timestamp[1]“ muss vom Typ Zahl sein']);
    expect(toAjvSchema({ items: [{ type: 'string' }], additionalItems: false })).toEqual({ prefixItems: [{ type: 'string' }], items: false });
  });

  it('ignores unknown formats and keywords, validates known formats', () => {
    const schema = { type: 'object', properties: { a: { type: 'string', format: 'fal-media-url', 'x-fal': 1, examples: ['x'] }, u: { type: 'string', format: 'uri' } } };
    expect(validateInput(schema, { a: 'anything' }).ok).toBe(true);
    expect(validateInput(schema, { u: 'not a uri' }).errors).toEqual(['„u“ hat kein gültiges Format (uri)']);
    expect(validateInput(schema, { u: 'https://v3.fal.media/files/a.png' }).ok).toBe(true);
  });

  it('treats an uncompilable schema as unverifiable instead of failing', () => {
    const result = validateInput({ type: 'object', properties: { a: { $ref: '#/nope' } } }, { a: 1 });
    expect(result.ok).toBe(true);
    expect(result.warnings?.[0]).toMatch(/Schema nicht lokal prüfbar/);
  });
});
