import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFalServices,
  downloadToFile,
  extractMediaOutputs,
  FAL_HOSTS,
  FAL_OPENAI_BASE_URL,
  falAuthHeader,
  FalPlatformClient,
  FalQueueClient,
  FalStorage,
  ModelRegistry,
} from '../src/index.ts';
import { API_KEY, createFakeFetch, json } from './helpers.ts';

describe('constants', () => {
  it('exposes the OpenAI-compatible router and the Key auth header', () => {
    expect(FAL_OPENAI_BASE_URL).toBe('https://fal.run/openrouter/router/openai/v1');
    expect(falAuthHeader('abc')).toEqual({ Authorization: 'Key abc' });
  });

  it('lists all hosts the app must reach', () => {
    for (const host of ['api.fal.ai', 'queue.fal.run', 'fal.run', 'rest.fal.ai', 'rest.alpha.fal.ai', 'fal.media', '*.fal.media']) expect(FAL_HOSTS).toContain(host);
  });
});

describe('createFalServices', () => {
  it('wires platform, registry, queue and storage with one config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fal-services-'));
    try {
      const fake = createFakeFetch((req) => {
        const url = new URL(req.url);
        if (url.hostname === 'queue.example') {
          if (req.method === 'POST') return json({ request_id: 'r1' });
          if (url.pathname.endsWith('/status')) return json({ status: 'COMPLETED' });
          return json({ images: [{ url: 'https://cdn.example/files/out.png', content_type: 'image/png' }] });
        }
        if (url.hostname === 'cdn.example') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
        return json({ models: [] });
      });
      const services = createFalServices({ apiKey: API_KEY, fetch: fake.fetch, queueBaseUrl: 'https://queue.example', cacheFile: join(dir, 'models.json'), objectLifecycleSeconds: 600 });
      expect(services.platform).toBeInstanceOf(FalPlatformClient);
      expect(services.registry).toBeInstanceOf(ModelRegistry);
      expect(services.queue).toBeInstanceOf(FalQueueClient);
      expect(services.storage).toBeInstanceOf(FalStorage);
      await services.registry.load();
      expect(services.registry.get('minimax/h3-max/text-to-video')?.recommended).toBe(true);

      // Ende-zu-Ende: generieren → Ausgaben finden → herunterladen
      const { output } = await services.queue.run('fal-ai/nano-banana-pro', { prompt: 'Lachs' }, { pollIntervalMs: 1 });
      const [media] = extractMediaOutputs(output);
      expect(media).toMatchObject({ kind: 'image', path: 'images[0]' });
      const file = await downloadToFile(media!.url, dir, { fetch: fake.fetch });
      expect(file).toMatchObject({ contentType: 'image/png', bytes: 3 });

      const submit = fake.requests.find((r) => r.method === 'POST')!;
      expect(submit.url).toBe('https://queue.example/fal-ai/nano-banana-pro');
      expect(submit.headers['x-fal-store-io']).toBe('0');
      expect(JSON.parse(submit.headers['x-fal-object-lifecycle-preference']!)).toEqual({ expiration_duration_seconds: 600 });
      expect(fake.requests.find((r) => r.url.startsWith('https://cdn.example'))!.headers.authorization).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
