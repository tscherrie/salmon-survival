import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FalError, FalPlatformClient, ModelRegistry, SEED_MODELS, toModelInfo, mergeCurated, parseModelRecord } from '../src/index.ts';
import { fluxOpenApi, h3MaxOpenApi, modelEntry } from './fixtures.ts';
import { API_KEY, createFakeFetch, json, type RecordedRequest } from './helpers.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fal-registry-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface FakeCatalog {
  byCategory: Record<string, unknown[]>;
  prices: Record<string, { unit_price: number; unit: string }>;
  openapi?: Record<string, unknown>;
  pricingStatus?: number;
  modelsStatus?: number;
}

function fakePlatform(catalog: FakeCatalog) {
  const fake = createFakeFetch((req: RecordedRequest) => {
    const url = new URL(req.url);
    if (url.pathname === '/v1/models/pricing') {
      if (catalog.pricingStatus) return json({ detail: 'kaputt' }, { status: catalog.pricingStatus });
      const ids = url.searchParams.get('endpoint_id')!.split(',');
      return json({ prices: ids.filter((id) => catalog.prices[id]).map((id) => ({ endpoint_id: id, currency: 'USD', ...catalog.prices[id] })) });
    }
    if (url.pathname === '/v1/models') {
      if (catalog.modelsStatus) return json({ detail: 'nope' }, { status: catalog.modelsStatus });
      const endpointId = url.searchParams.get('endpoint_id');
      if (endpointId) {
        const doc = catalog.openapi?.[endpointId];
        return json({ models: doc ? [modelEntry(endpointId, 'text-to-image', {}, doc)] : [] });
      }
      return json({ models: catalog.byCategory[url.searchParams.get('category') ?? ''] ?? [], has_more: false });
    }
    return json({ detail: 'unknown route' }, { status: 404 });
  });
  const platform = new FalPlatformClient({ apiKey: API_KEY, fetch: fake.fetch, retries: 0, openapiFallbackUrl: null });
  return { platform, requests: fake.requests };
}

const offlinePlatform = () =>
  new FalPlatformClient({
    apiKey: API_KEY,
    fetch: (async () => {
      throw new Error('Netzwerk in diesem Test verboten');
    }) as typeof fetch,
    retries: 0,
    openapiFallbackUrl: null,
  });

describe('ModelRegistry (seed)', () => {
  const registry = new ModelRegistry();

  it('lists a modality with recommended first, then by name, incl. alsoModalities', () => {
    const video = registry.list('video');
    expect(video[0]!.id).toBe('minimax/h3-max/text-to-video');
    const rest = video.slice(1).map((m) => m.displayName);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })));
    expect(video.map((m) => m.id)).toContain('minimax/h3-max/lip-sync/image-to-video');
    const lipsync = registry.list('lipsync').map((m) => m.id);
    expect(lipsync[0]).toBe('fal-ai/sync-lipsync/v2');
    expect(lipsync).toContain('minimax/h3-max/reference-to-video');
    expect(registry.list().length).toBe(SEED_MODELS.length);
    expect(registry.updatedAt).toBeNull();
  });

  it('every seed entry is consistent', () => {
    const ids = new Set<string>();
    for (const m of SEED_MODELS) {
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect(m.provider).toBe('fal');
      expect(m.tags).toContain('seed');
      if (m.price) {
        expect(m.tags).toContain('preis-ungeprüft');
        expect(m.description).toMatch(/Preis Stand 2026-10-01 \(Websuche\), ungeprüft\./);
      }
    }
    for (const modality of ['image', 'video', 'lipsync', 'voice', 'music', 'sound', 'tools'] as const) {
      expect(registry.list(modality).length).toBeGreaterThan(0);
      expect(registry.list(modality).filter((m) => m.recommended && m.modality === modality)).toHaveLength(1);
    }
  });

  it('searches by text and capability filters', () => {
    expect(registry.search({ text: 'h3 turbo' }).map((m) => m.id)).toEqual(['minimax/h3-max-turbo/text-to-video', 'minimax/h3-max-turbo/image-to-video']);
    expect(registry.search({ modality: 'tools', capabilities: { wordTimestamps: true } }).map((m) => m.id)).toEqual([
      'fal-ai/elevenlabs/speech-to-text/scribe-v2',
      'fal-ai/whisper',
    ]);
    expect(registry.search({ modality: 'video', capabilities: { audioInput: true } }).map((m) => m.id)).toEqual([
      'minimax/h3-max/lip-sync/image-to-video',
      'minimax/h3-max/reference-to-video',
    ]);
    expect(registry.search({ modality: 'video', text: 'wortzeitstempel' })).toEqual([]);
    // Teilstring-Treffer (z. B. „Wortzeitstempel“) bleiben, Wortanfang-Treffer stehen vorn.
    const stems = registry.search({ text: 'stem' }).map((m) => m.id);
    expect(stems[0]).toBe('fal-ai/demucs');
    expect(stems).toContain('fal-ai/whisper');
    expect(registry.search({ modality: 'image', capabilities: { imageInput: false } }).map((m) => m.id)).toEqual(['fal-ai/nano-banana-pro', 'fal-ai/flux-2-pro']);
  });

  it('estimates locally and rejects unknown models', async () => {
    expect((await registry.estimate('minimax/h3-max/text-to-video', { duration: 5, resolution: '768P' })).usd).toBeCloseTo(0.4);
    await expect(registry.estimate('nope/x', {})).rejects.toThrow(/Unbekanntes Modell/);
  });

  it('needs a platform for sync and schemas', async () => {
    await expect(registry.sync()).rejects.toThrow(/kein fal-Plattform-Client/);
    await expect(registry.getInputSchema('fal-ai/flux-2-pro')).rejects.toThrow(/kein fal-Plattform-Client/);
  });
});

describe('ModelRegistry.sync + cache', () => {
  const catalog: FakeCatalog = {
    byCategory: {
      'text-to-video': [
        modelEntry('minimax/h3-max/text-to-video', 'text-to-video', { display_name: 'MiniMax H3 Max', license_type: 'commercial' }, h3MaxOpenApi),
        modelEntry('acme/new-video', 'text-to-video'),
        { broken: true },
      ],
      'text-to-speech': [modelEntry('fal-ai/elevenlabs/tts/eleven-v3', 'text-to-speech')],
      training: [modelEntry('fal-ai/flux-lora-fast-training', 'training')],
    },
    prices: {
      'minimax/h3-max/text-to-video': { unit_price: 0.16, unit: 'seconds' },
      'acme/new-video': { unit_price: 0.1, unit: 'seconds' },
    },
  };

  it('merges live data over the seed, persists atomically and round-trips', async () => {
    const cacheFile = join(dir, 'models.json');
    const { platform, requests } = fakePlatform(catalog);
    const registry = new ModelRegistry({ platform, cacheFile, now: () => '2026-10-01T12:00:00.000Z' });
    await registry.load();
    const result = await registry.sync({ categories: ['text-to-video', 'text-to-speech', 'training'] });
    expect(result).toEqual({ count: 3, updatedAt: '2026-10-01T12:00:00.000Z' });
    expect(registry.updatedAt).toBe('2026-10-01T12:00:00.000Z');

    const listUrl = new URL(requests[0]!.url);
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({ category: 'text-to-video', status: 'active', expand: 'openapi-3.0' });
    const pricingUrl = requests.find((r) => r.url.includes('/pricing'))!;
    expect(new URL(pricingUrl.url).searchParams.get('endpoint_id')!.split(',').sort()).toEqual(
      ['acme/new-video', 'fal-ai/elevenlabs/tts/eleven-v3', 'fal-ai/flux-lora-fast-training', 'minimax/h3-max/text-to-video'].sort(),
    );

    const h3 = registry.get('minimax/h3-max/text-to-video')!;
    expect(h3).toMatchObject({
      displayName: 'MiniMax H3 Max',
      description: 'Live description of minimax/h3-max/text-to-video',
      recommended: true,
      vendor: 'MiniMax · fal',
      license: 'commercial',
      price: { unitPrice: 0.16, unit: 'seconds', currency: 'USD' },
      status: 'active',
    });
    expect(h3.capabilities).toMatchObject({ nativeAudio: true, audioInput: true, seed: true, aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] });
    expect(h3.alsoModalities).toEqual(['lipsync']);
    expect(h3.tags).not.toContain('preis-ungeprüft');
    expect(h3.tags).toContain('live');

    // Live ohne Preis behält den Seed-Preis (inkl. Hinweis-Tag).
    const tts = registry.get('fal-ai/elevenlabs/tts/eleven-v3')!;
    expect(tts.price?.unitPrice).toBe(0.1);
    expect(tts.tags).toContain('preis-ungeprüft');
    expect(tts.recommended).toBe(true);

    expect(registry.get('acme/new-video')).toMatchObject({ modality: 'video', vendor: 'Acme', price: { unitPrice: 0.1 } });
    expect(registry.get('fal-ai/flux-lora-fast-training')).toBeUndefined();
    expect(registry.get('fal-ai/lyria2')).toBeDefined(); // Seed bleibt

    const cache = JSON.parse(await readFile(cacheFile, 'utf8')) as { version: number; updatedAt: string; models: Array<{ id: string }>; schemas: Record<string, unknown> };
    expect(cache.version).toBe(1);
    expect(cache.updatedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(cache.models.some((m) => m.id === 'acme/new-video')).toBe(true);
    expect(Object.keys(cache.schemas)).toEqual(['minimax/h3-max/text-to-video']);

    // Neuer Prozess: Cache laden, Schema ohne Netzwerk.
    const reloaded = new ModelRegistry({ platform: offlinePlatform(), cacheFile });
    await reloaded.load();
    expect(reloaded.updatedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(reloaded.get('acme/new-video')?.price?.unitPrice).toBe(0.1);
    expect(reloaded.get('minimax/h3-max/text-to-video')?.recommended).toBe(true);
    const schema = await reloaded.getInputSchema('minimax/h3-max/text-to-video');
    expect(schema.required).toEqual(['prompt']);
    expect((await reloaded.validate('minimax/h3-max/text-to-video', { prompt: 'x', duration: 3 })).errors).toEqual([
      '„duration“ muss einer der Werte sein: 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15',
    ]);
  });

  it('falls back to the seed when the cache is missing or corrupt', async () => {
    const cacheFile = join(dir, 'broken.json');
    await writeFile(cacheFile, '{"models": [ {"id": "x"');
    const registry = new ModelRegistry({ cacheFile });
    await registry.load();
    expect(registry.updatedAt).toBeNull();
    expect(registry.list().length).toBe(SEED_MODELS.length);
    const missing = new ModelRegistry({ cacheFile: join(dir, 'nope', 'models.json') });
    await missing.load();
    expect(missing.list().length).toBe(SEED_MODELS.length);
  });

  it('skips invalid cached entries', async () => {
    const cacheFile = join(dir, 'models.json');
    await writeFile(
      cacheFile,
      JSON.stringify({ version: 1, updatedAt: '2026-09-01T00:00:00Z', models: [{ id: 'a/b', modality: 'nope', displayName: 'x' }, { id: 'c/d', modality: 'image', displayName: 'CD' }] }),
    );
    const registry = new ModelRegistry({ cacheFile });
    await registry.load();
    expect(registry.get('a/b')).toBeUndefined();
    expect(registry.get('c/d')).toMatchObject({ provider: 'fal', description: '', capabilities: {} });
  });

  it('keeps going with warnings when pricing fails, but propagates auth errors', async () => {
    const registry = new ModelRegistry({ platform: fakePlatform({ ...catalog, pricingStatus: 500 }).platform, now: () => 't1' });
    const result = await registry.sync({ categories: ['text-to-video'] });
    expect(result.count).toBe(2);
    expect(result.warnings?.[0]).toMatch(/^Preise nicht geladen: fal-Serverfehler \(500\)/);
    expect(registry.get('minimax/h3-max/text-to-video')?.price?.unitPrice).toBe(0.08); // Seed-Preis bleibt

    const unauthorized = new ModelRegistry({ platform: fakePlatform({ ...catalog, pricingStatus: 401 }).platform });
    await expect(unauthorized.sync({ categories: ['text-to-video'] })).rejects.toMatchObject({ code: 'unauthorized' });

    const down = new ModelRegistry({ platform: fakePlatform({ ...catalog, modelsStatus: 503 }).platform });
    await expect(down.sync({ categories: ['text-to-video', 'llm'] })).rejects.toBeInstanceOf(FalError);
    expect(down.list().length).toBe(SEED_MODELS.length);
  });
});

describe('ModelRegistry.getInputSchema / describe', () => {
  it('fetches once (deduplicated), enriches capabilities and persists', async () => {
    const cacheFile = join(dir, 'models.json');
    const fluxPro = { ...fluxOpenApi, paths: { '/fal-ai/flux-2-pro': fluxOpenApi.paths['/fal-ai/flux/dev'] } };
    const { platform, requests } = fakePlatform({ byCategory: {}, prices: {}, openapi: { 'fal-ai/flux-2-pro': fluxPro } });
    const registry = new ModelRegistry({ platform, cacheFile });
    const [a, b] = await Promise.all([registry.getInputSchema('fal-ai/flux-2-pro'), registry.getInputSchema('fal-ai/flux-2-pro')]);
    expect(a).toBe(b);
    expect(requests).toHaveLength(1);
    await registry.getInputSchema('fal-ai/flux-2-pro');
    expect(requests).toHaveLength(1);
    expect(registry.get('fal-ai/flux-2-pro')?.capabilities.aspectRatios).toEqual(['1:1', '3:4', '9:16', '4:3', '16:9']);
    const cache = JSON.parse(await readFile(cacheFile, 'utf8')) as { schemas: Record<string, unknown> };
    expect(Object.keys(cache.schemas)).toEqual(['fal-ai/flux-2-pro']);
  });

  it('describe(): header with price, example and capabilities plus parameters', async () => {
    const { platform } = fakePlatform({ byCategory: {}, prices: {}, openapi: { 'minimax/h3-max/text-to-video': h3MaxOpenApi } });
    const registry = new ModelRegistry({ platform });
    const text = await registry.describe('minimax/h3-max/text-to-video');
    const lines = text.split('\n');
    expect(lines[0]).toBe('H3 Max (minimax/h3-max/text-to-video) · MiniMax · fal');
    expect(lines[1]).toBe('Modalität: Video · Kategorie: text-to-video · empfohlen');
    expect(lines[2]).toBe('Preis: $0.080 / s · Beispiel: 5 s ≈ $0.40');
    expect(lines[3]).toMatch(/^Fähigkeiten: Native Tonspur, Dauer: 5–15 s, Formate: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16, Auflösung: 480P, 768P, 1080P, Seed/);
    expect(text).toContain('Parameter (* = Pflicht):');
    expect(text).toContain('- prompt* (string; Länge 0–4000)');
  });

  it('describe() degrades gracefully for unknown models and missing schemas', async () => {
    const registry = new ModelRegistry({ platform: offlinePlatform() });
    const text = await registry.describe('nope/model');
    expect(text).toContain('nope/model (nicht im Katalog)');
    expect(text).toContain('Eingabeschema nicht verfügbar');
  });
});

describe('toModelInfo / mergeCurated', () => {
  it('maps records and drops unsupported categories', () => {
    const rec = parseModelRecord(modelEntry('fal-ai/demucs', 'audio-to-audio', { status: 'beta' }))!;
    expect(toModelInfo(rec, { endpointId: 'fal-ai/demucs', unitPrice: 0.0007, unit: 'seconds', currency: 'USD' })).toMatchObject({
      id: 'fal-ai/demucs',
      modality: 'tools',
      status: 'beta',
      price: { unitPrice: 0.0007 },
    });
    expect(toModelInfo(parseModelRecord(modelEntry('fal-ai/x', 'image-to-3d'))!)).toBeNull();
  });

  it('curated modality, vendor and recommendation survive the merge', () => {
    const live = toModelInfo(parseModelRecord(modelEntry('minimax/h3-max/lip-sync/image-to-video', 'image-to-video'))!)!;
    const curated = SEED_MODELS.find((m) => m.id === 'minimax/h3-max/lip-sync/image-to-video');
    const merged = mergeCurated(live, curated);
    expect(merged.modality).toBe('lipsync');
    expect(merged.alsoModalities).toEqual(['video']);
    expect(merged.capabilities.audioInput).toBe(true);
  });
});
