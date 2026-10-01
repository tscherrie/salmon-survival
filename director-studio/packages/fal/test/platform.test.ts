import { describe, expect, it } from 'vitest';
import { FalError, FalPlatformClient, parseModelRecord, parsePriceEntry, deriveVendor } from '../src/index.ts';
import { fluxOpenApi, modelEntry } from './fixtures.ts';
import { API_KEY, createFakeFetch, json } from './helpers.ts';

function client(handler: Parameters<typeof createFakeFetch>[0], extra: Record<string, unknown> = {}) {
  const fake = createFakeFetch(handler);
  const platform = new FalPlatformClient({ apiKey: API_KEY, fetch: fake.fetch, retries: 2, retryDelayMs: 0, openapiFallbackUrl: null, ...extra });
  return { platform, requests: fake.requests };
}

describe('FalPlatformClient.listModels', () => {
  it('builds the search URL with all parameters and sends the Key header', async () => {
    const { platform, requests } = client(() => json({ models: [modelEntry('fal-ai/flux/dev', 'text-to-image')], next_cursor: 'c2', has_more: true }));
    const page = await platform.listModels({ category: 'text-to-image', q: 'flux', status: 'active', limit: 20, cursor: 'c1', expandOpenapi: true });
    const url = new URL(requests[0]!.url);
    expect(url.origin + url.pathname).toBe('https://api.fal.ai/v1/models');
    expect(Object.fromEntries(url.searchParams)).toEqual({ category: 'text-to-image', q: 'flux', status: 'active', limit: '20', cursor: 'c1', expand: 'openapi-3.0' });
    expect(requests[0]!.headers.authorization).toBe(`Key ${API_KEY}`);
    expect(page.nextCursor).toBe('c2');
    expect(page.models[0]).toMatchObject({
      endpointId: 'fal-ai/flux/dev',
      displayName: 'Live fal-ai/flux/dev',
      category: 'text-to-image',
      status: 'active',
      tags: ['live'],
      vendor: 'Black Forest Labs',
      thumbnailUrl: 'https://fal.media/thumbs/fal-ai_flux_dev.png',
    });
  });

  it('is tolerant to drift: skips entries without endpoint_id, accepts flat metadata, ignores unknown fields', async () => {
    const { platform } = client(() =>
      json({
        models: [
          { metadata: { display_name: 'no id' } },
          { endpoint_id: 'acme/thing', display_name: 'Flat', category: 'text-to-video', extra: { deep: true } },
          { endpoint_id: 'fal-ai/x', metadata: { display_name: 42, tags: ['a', 7, null] } },
          'garbage',
        ],
        has_more: false,
        next_cursor: 'ignored',
        unexpected: 1,
      }),
    );
    const page = await platform.listModels();
    expect(page.nextCursor).toBeNull();
    expect(page.models.map((m) => m.endpointId)).toEqual(['acme/thing', 'fal-ai/x']);
    expect(page.models[0]).toMatchObject({ displayName: 'Flat', category: 'text-to-video', vendor: 'Acme' });
    expect(page.models[1]).toMatchObject({ displayName: 'fal-ai/x', tags: ['a'], category: '' });
  });

  it('works without API key (no Authorization header)', async () => {
    const fake = createFakeFetch(() => json({ models: [] }));
    const platform = new FalPlatformClient({ apiKey: '', fetch: fake.fetch });
    await platform.listModels({ q: 'x' });
    expect(fake.requests[0]!.headers.authorization).toBeUndefined();
  });

  it('paginates with listAllModels and stops on repeated cursors', async () => {
    const pages = [
      { models: [modelEntry('a/one', 'text-to-image')], next_cursor: 'p2', has_more: true },
      { models: [modelEntry('a/two', 'text-to-image'), modelEntry('a/one', 'text-to-image')], next_cursor: 'p3', has_more: true },
      { models: [modelEntry('a/three', 'text-to-image')], next_cursor: 'p2', has_more: true },
    ];
    const { platform, requests } = client((_req, i) => json(pages[i] ?? { models: [] }));
    const all = await platform.listAllModels({ category: 'text-to-image' });
    expect(all.map((m) => m.endpointId)).toEqual(['a/one', 'a/two', 'a/three']);
    expect(requests).toHaveLength(3);
    expect(new URL(requests[1]!.url).searchParams.get('cursor')).toBe('p2');
  });

  it('respects maxPages', async () => {
    const { platform, requests } = client((_req, i) => json({ models: [modelEntry(`a/m${i}`, 'llm')], next_cursor: `c${i + 1}`, has_more: true }));
    const all = await platform.listAllModels({ maxPages: 2 });
    expect(all).toHaveLength(2);
    expect(requests).toHaveLength(2);
  });
});

describe('FalPlatformClient.getPricing', () => {
  it('chunks large lists into ≤50 ids, comma-joined', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `fal-ai/model-${i}`);
    const { platform, requests } = client((req) => {
      const batch = new URL(req.url).searchParams.get('endpoint_id')!.split(',');
      return json({ prices: batch.map((id) => ({ endpoint_id: id, unit_price: 0.01, unit: 'images', currency: 'USD' })), has_more: false });
    });
    const prices = await platform.getPricing([...ids, ids[0]!]);
    expect(prices).toHaveLength(120);
    expect(requests.map((r) => new URL(r.url).searchParams.get('endpoint_id')!.split(',').length)).toEqual([50, 50, 20]);
    expect(new URL(requests[0]!.url).pathname).toBe('/v1/models/pricing');
    expect(prices[0]).toEqual({ endpointId: 'fal-ai/model-0', unitPrice: 0.01, unit: 'images', currency: 'USD' });
  });

  it('bisects a rejected batch so one unknown id does not lose the others', async () => {
    const { platform } = client((req) => {
      const batch = new URL(req.url).searchParams.get('endpoint_id')!.split(',');
      if (batch.includes('bad/id')) return json({ detail: 'Unknown endpoint bad/id' }, { status: 422 });
      return json({ prices: batch.map((id) => ({ endpoint_id: id, unit_price: '0.5', billing_unit: 'seconds' })) });
    });
    const prices = await platform.getPricing(['a/1', 'bad/id', 'a/2', 'a/3']);
    expect(prices.map((p) => p.endpointId).sort()).toEqual(['a/1', 'a/2', 'a/3']);
    expect(prices[0]).toMatchObject({ unitPrice: 0.5, unit: 'seconds', currency: 'USD' });
  });

  it('parses price entries tolerantly', () => {
    expect(parsePriceEntry({ endpoint_id: 'x/y', unit_price: 0.2, unit: ' 5 seconds ', currency: 'usd' })).toEqual({ endpointId: 'x/y', unitPrice: 0.2, unit: '5 seconds', currency: 'USD' });
    expect(parsePriceEntry({ endpoint_id: 'x/y', unit_price: 'n/a' })).toBeNull();
    expect(parsePriceEntry({ unit_price: 1 })).toBeNull();
  });
});

describe('FalPlatformClient.estimate', () => {
  it('sends unit_price and historical_api_price requests and sums the totals', async () => {
    const { platform, requests } = client((req) => {
      const body = req.body as { estimate_type: string };
      return json({ estimate_type: body.estimate_type, total_cost: body.estimate_type === 'unit_price' ? 1.6 : 0.25, currency: 'USD' });
    });
    const result = await platform.estimate([
      { endpointId: 'minimax/h3-max/text-to-video', unitQuantity: 5 },
      { endpointId: 'minimax/h3-max/text-to-video', unitQuantity: 5 },
      { endpointId: 'fal-ai/flux/dev', callQuantity: 10 },
      { endpointId: 'fal-ai/nano-banana-pro' },
    ]);
    expect(result.totalUsd).toBeCloseTo(1.85);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ method: 'POST', url: 'https://api.fal.ai/v1/models/pricing/estimate' });
    expect(requests[0]!.headers['content-type']).toBe('application/json');
    expect(requests[0]!.body).toEqual({ estimate_type: 'unit_price', endpoints: { 'minimax/h3-max/text-to-video': { unit_quantity: 10 } } });
    expect(requests[1]!.body).toEqual({
      estimate_type: 'historical_api_price',
      endpoints: { 'fal-ai/flux/dev': { call_quantity: 10 }, 'fal-ai/nano-banana-pro': { call_quantity: 1 } },
    });
    expect(Array.isArray(result.raw)).toBe(true);
  });

  it('rejects responses without total_cost', async () => {
    const { platform } = client(() => json({ currency: 'USD' }));
    await expect(platform.estimate([{ endpointId: 'a/b', unitQuantity: 1 }])).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('returns 0 for an empty request without network', async () => {
    const { platform, requests } = client(() => json({}));
    expect(await platform.estimate([])).toEqual({ totalUsd: 0, raw: null });
    expect(requests).toHaveLength(0);
  });
});

describe('FalPlatformClient.getOpenApi', () => {
  it('uses find mode with expand=openapi-3.0', async () => {
    const { platform, requests } = client(() => json({ models: [modelEntry('fal-ai/flux/dev', 'text-to-image', {}, fluxOpenApi)] }));
    const doc = await platform.getOpenApi('fal-ai/flux/dev');
    expect(doc).toEqual(fluxOpenApi);
    const url = new URL(requests[0]!.url);
    expect(url.searchParams.get('endpoint_id')).toBe('fal-ai/flux/dev');
    expect(url.searchParams.get('expand')).toBe('openapi-3.0');
  });

  it('falls back to the public OpenAPI URL without sending the key', async () => {
    const { platform, requests } = client(
      (req) => (req.url.startsWith('https://fal.example/openapi') ? json(fluxOpenApi) : json({ models: [modelEntry('fal-ai/flux/dev', 'text-to-image')] })),
      { openapiFallbackUrl: 'https://fal.example/openapi.json' },
    );
    expect(await platform.getOpenApi('fal-ai/flux/dev')).toEqual(fluxOpenApi);
    expect(requests[1]!.headers.authorization).toBeUndefined();
    expect(new URL(requests[1]!.url).searchParams.get('endpoint_id')).toBe('fal-ai/flux/dev');
  });

  it('throws not_found for unknown endpoints', async () => {
    const { platform } = client(() => json({ models: [] }));
    await expect(platform.getOpenApi('nope/nothing')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('error mapping', () => {
  it('401 → German message, not retryable, no key leaked', async () => {
    const { platform, requests } = client(() => json({ detail: `Invalid key ${API_KEY}` }, { status: 401 }));
    const error = await platform.listModels().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FalError);
    const fe = error as FalError;
    expect(fe.message).toContain('fal-API-Key ungültig');
    expect(fe).toMatchObject({ status: 401, code: 'unauthorized', retryable: false });
    expect(fe.message).not.toContain('secret-abc');
    expect(JSON.stringify(fe.details)).not.toContain('secret-abc');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).not.toContain('secret');
  });

  it('403 carries the detail (e.g. exhausted balance)', async () => {
    const { platform } = client(() => json({ detail: 'User is locked. Reason: Exhausted balance.' }, { status: 403 }));
    await expect(platform.getPricing(['a/b'])).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('Exhausted balance') });
  });

  it('retries 429/5xx and then succeeds', async () => {
    const { platform, requests } = client((_req, i) =>
      i === 0 ? json({ detail: 'slow down' }, { status: 429 }) : i === 1 ? new Response('upstream', { status: 503 }) : json({ models: [] }),
    );
    await expect(platform.listModels()).resolves.toEqual({ models: [], nextCursor: null });
    expect(requests).toHaveLength(3);
  });

  it('honours Retry-After instead of the exponential backoff', async () => {
    const { platform, requests } = client((_req, i) => (i === 0 ? json({ detail: 'rate' }, { status: 429, headers: { 'retry-after': '0' } }) : json({ models: [] })), {
      retryDelayMs: 60_000,
    });
    const started = Date.now();
    await platform.listModels();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(requests).toHaveLength(2);
  });

  it('marks 429 as retryable when retries are exhausted', async () => {
    const { platform } = client(() => json({ detail: 'rate' }, { status: 429 }), { retries: 0 });
    await expect(platform.listModels()).rejects.toMatchObject({ code: 'rate_limit', retryable: true, status: 429 });
  });

  it('422 lists validation details', async () => {
    const { platform } = client(() =>
      json({ detail: [{ loc: ['body', 'endpoints'], msg: 'field required', type: 'missing' }, { loc: ['body', 'estimate_type'], msg: 'bad', type: 'enum' }] }, { status: 422 }),
    );
    const error = (await platform.estimate([{ endpointId: 'a/b', unitQuantity: 1 }]).catch((e: unknown) => e)) as FalError;
    expect(error.code).toBe('validation');
    expect(error.details).toEqual(['endpoints: field required [missing]', 'estimate_type: bad [enum]']);
    expect(error.message).toContain('endpoints: field required');
  });

  it('maps network errors to retryable FalErrors', async () => {
    const { platform } = client(() => {
      throw new TypeError('fetch failed');
    }, { retries: 0 });
    await expect(platform.listModels()).rejects.toMatchObject({ code: 'network', retryable: true });
  });
});

describe('helpers', () => {
  it('derives vendors from endpoint ids', () => {
    expect(deriveVendor('fal-ai/elevenlabs/tts/eleven-v3')).toBe('ElevenLabs');
    expect(deriveVendor('minimax/h3-max/text-to-video')).toBe('MiniMax');
    expect(deriveVendor('fal-ai/some-new-model')).toBe('fal');
    expect(deriveVendor('acme/model')).toBe('Acme');
  });

  it('parseModelRecord keeps openapi and raw', () => {
    const raw = modelEntry('fal-ai/flux/dev', 'text-to-image', {}, fluxOpenApi);
    const rec = parseModelRecord(raw);
    expect(rec?.openapi).toBe(fluxOpenApi);
    expect(rec?.raw).toBe(raw);
  });
});
