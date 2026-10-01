import { describe, expect, it } from 'vitest';
import { appIdOf, FalError, FalQueueClient, nextPollInterval, parseQueueStatus, queueHandleFor, type QueueStatus } from '../src/index.ts';
import { API_KEY, createFakeFetch, json, type RecordedRequest } from './helpers.ts';

const BASE = 'https://queue.fal.run';

function submitted(app: string, id: string, extra: Record<string, unknown> = {}) {
  const base = `${BASE}/${app}/requests/${id}`;
  return json({ request_id: id, status_url: `${base}/status`, response_url: base, cancel_url: `${base}/cancel`, queue_position: 0, ...extra });
}

/** Router: Submit → Statusfolge → Ergebnis; Abbruch wird aufgezeichnet. */
function queueFake(opts: {
  app: string;
  statuses: Array<Response | (() => Response)>;
  result?: () => Response;
  submit?: () => Response;
}) {
  let statusIndex = 0;
  return createFakeFetch((req: RecordedRequest) => {
    const url = new URL(req.url);
    if (req.method === 'POST') return opts.submit ? opts.submit() : submitted(opts.app, 'req-1');
    if (req.method === 'PUT') return json({ status: 'CANCELLATION_REQUESTED' }, { status: 202 });
    if (url.pathname.endsWith('/status')) {
      const entry = opts.statuses[Math.min(statusIndex++, opts.statuses.length - 1)]!;
      return typeof entry === 'function' ? entry() : entry.clone();
    }
    return opts.result ? opts.result() : json({ ok: true });
  });
}

const fast = { pollIntervalMs: 1 };

describe('FalQueueClient.submit', () => {
  it('posts the raw input with Key auth, X-Fal-Store-IO: 0 and lifecycle header', async () => {
    const fake = queueFake({ app: 'fal-ai/flux', statuses: [] });
    const queue = new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch, objectLifecycleSeconds: 3600 });
    const handle = await queue.submit('fal-ai/flux/dev', { prompt: 'Lachs', num_images: 2 });
    const req = fake.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://queue.fal.run/fal-ai/flux/dev');
    expect(req.body).toEqual({ prompt: 'Lachs', num_images: 2 });
    expect(req.headers.authorization).toBe(`Key ${API_KEY}`);
    expect(req.headers['x-fal-store-io']).toBe('0');
    expect(req.headers['content-type']).toBe('application/json');
    expect(JSON.parse(req.headers['x-fal-object-lifecycle-preference']!)).toEqual({ expiration_duration_seconds: 3600 });
    expect(handle).toEqual({
      endpointId: 'fal-ai/flux/dev',
      requestId: 'req-1',
      statusUrl: 'https://queue.fal.run/fal-ai/flux/requests/req-1/status',
      responseUrl: 'https://queue.fal.run/fal-ai/flux/requests/req-1',
      cancelUrl: 'https://queue.fal.run/fal-ai/flux/requests/req-1/cancel',
    });
  });

  it('omits X-Fal-Store-IO when storeIo is allowed', async () => {
    const fake = queueFake({ app: 'fal-ai/flux', statuses: [] });
    await new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch, storeIo: true }).submit('fal-ai/flux/dev', {});
    expect(fake.requests[0]!.headers['x-fal-store-io']).toBeUndefined();
    expect(fake.requests[0]!.headers['x-fal-object-lifecycle-preference']).toBeUndefined();
  });

  it('never trusts URLs on foreign origins (key stays on the queue host)', async () => {
    const fake = queueFake({
      app: 'minimax/h3-max',
      statuses: [json({ status: 'COMPLETED' })],
      submit: () => json({ request_id: 'r1', status_url: 'https://evil.example/s', response_url: 'https://evil.example/r', cancel_url: 'nonsense' }),
      result: () => json({ video: { url: 'https://v3.fal.media/files/x.mp4' } }),
    });
    const queue = new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch });
    const { handle } = await queue.run('minimax/h3-max/text-to-video', { prompt: 'x' }, fast);
    expect(handle.statusUrl).toBe('https://queue.fal.run/minimax/h3-max/requests/r1/status');
    expect(fake.requests.every((r) => r.url.startsWith(BASE))).toBe(true);
  });

  it('rejects responses without request_id and invalid endpoint ids', async () => {
    const fake = queueFake({ app: 'a/b', statuses: [], submit: () => json({ status: 'IN_QUEUE' }) });
    const queue = new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch });
    await expect(queue.submit('a/b', {})).rejects.toMatchObject({ code: 'bad_response' });
    await expect(queue.submit('../etc', {})).rejects.toThrow(/Ungültige fal-Endpoint-ID/);
    await expect(queue.submit('single', {})).rejects.toThrow(/Ungültige fal-Endpoint-ID/);
  });

  it('requires an API key', async () => {
    const fake = queueFake({ app: 'a/b', statuses: [] });
    await expect(new FalQueueClient({ apiKey: ' ', fetch: fake.fetch }).submit('a/b', {})).rejects.toMatchObject({ code: 'missing_key' });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('FalQueueClient.run', () => {
  it('happy path: queue → progress → completed, with onSubmitted, onStatus, logs and billable units', async () => {
    const fake = queueFake({
      app: 'minimax/h3-max',
      statuses: [
        json({ status: 'IN_QUEUE', queue_position: 2 }),
        json({ status: 'IN_PROGRESS', logs: [{ message: 'Schritt 1', level: 'INFO' }, 'roh'] }),
        json({ status: 'COMPLETED', logs: [] }),
      ],
      submit: () => submitted('minimax/h3-max', 'abc'),
      result: () => json({ video: { url: 'https://v3.fal.media/files/out.mp4', content_type: 'video/mp4' } }, { headers: { 'x-fal-billable-units': '5' } }),
    });
    const queue = new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch });
    const events: string[] = [];
    const statuses: QueueStatus[] = [];
    const result = await queue.run('minimax/h3-max/text-to-video', { prompt: 'x', duration: 5 }, {
      ...fast,
      onSubmitted: async (h) => {
        events.push(`submitted:${h.requestId}:${fake.requests.length}`);
      },
      onStatus: (s) => statuses.push(s),
    });
    expect(events).toEqual(['submitted:abc:1']);
    expect(statuses.map((s) => s.state)).toEqual(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']);
    expect(statuses[0]!.queuePosition).toBe(2);
    expect(statuses[1]!.logs).toEqual(['Schritt 1', 'roh']);
    expect(result.output).toEqual({ video: { url: 'https://v3.fal.media/files/out.mp4', content_type: 'video/mp4' } });
    expect(result.billableUnits).toBe(5);
    expect(result.handle.requestId).toBe('abc');
    const statusReq = fake.requests[1]!;
    expect(statusReq.method).toBe('GET');
    expect(statusReq.url).toBe('https://queue.fal.run/minimax/h3-max/requests/abc/status?logs=1');
    expect(statusReq.headers.authorization).toBe(`Key ${API_KEY}`);
    expect(statusReq.headers['x-fal-store-io']).toBeUndefined();
    expect(fake.requests.at(-1)!.url).toBe('https://queue.fal.run/minimax/h3-max/requests/abc');
  });

  it('FAILED (COMPLETED + error) throws FalError with details from the result endpoint', async () => {
    const fake = queueFake({
      app: 'fal-ai/flux',
      statuses: [json({ status: 'COMPLETED', error: 'Runner crashed', error_type: 'runner_disconnected' })],
      result: () => json({ detail: 'Internal failure' }, { status: 500 }),
    });
    const queue = new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch });
    const error = (await queue.run('fal-ai/flux/dev', { prompt: 'x' }, fast).catch((e: unknown) => e)) as FalError;
    expect(error).toBeInstanceOf(FalError);
    expect(error).toMatchObject({ code: 'failed', retryable: true, requestId: 'req-1', details: ['Internal failure'] });
    expect(error.message).toBe('Generierung fehlgeschlagen (fal-ai/flux/dev): Runner crashed (Internal failure)');
  });

  it('explicit FAILED status is not retryable without a transient error type', async () => {
    const fake = queueFake({ app: 'fal-ai/flux', statuses: [json({ status: 'FAILED', error: { message: 'NSFW erkannt' } })], result: () => json({}, { status: 400 }) });
    const error = (await new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch }).run('fal-ai/flux/dev', {}, fast).catch((e: unknown) => e)) as FalError;
    expect(error).toMatchObject({ code: 'failed', retryable: false });
    expect(error.message).toContain('NSFW erkannt');
  });

  it('validation errors surface on the result request (422 → details)', async () => {
    const fake = queueFake({
      app: 'fal-ai/flux',
      statuses: [json({ status: 'COMPLETED' })],
      result: () => json({ detail: [{ loc: ['body', 'prompt'], msg: 'field required', type: 'missing' }] }, { status: 422 }),
    });
    const error = (await new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch }).run('fal-ai/flux/dev', {}, fast).catch((e: unknown) => e)) as FalError;
    expect(error).toMatchObject({ code: 'validation', status: 422, retryable: false, details: ['prompt: field required [missing]'] });
    expect(error.message).toContain('Ungültige Eingabe (422)');
  });

  it('server-side cancellation → canceled', async () => {
    const fake = queueFake({ app: 'fal-ai/flux', statuses: [json({ status: 'COMPLETED', error_type: 'client_cancelled' })] });
    await expect(new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch }).run('fal-ai/flux/dev', {}, fast)).rejects.toMatchObject({ code: 'canceled' });
  });

  it('abort → best-effort cancel (PUT) and AbortError', async () => {
    const fake = queueFake({ app: 'fal-ai/flux', statuses: [json({ status: 'IN_PROGRESS' })] });
    const queue = new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch });
    const controller = new AbortController();
    let polls = 0;
    const error = (await queue
      .run('fal-ai/flux/dev', { prompt: 'x' }, {
        ...fast,
        signal: controller.signal,
        onStatus: () => {
          if (++polls === 2) controller.abort();
        },
      })
      .catch((e: unknown) => e)) as Error;
    expect(error.name).toBe('AbortError');
    const cancel = fake.requests.find((r) => r.method === 'PUT');
    expect(cancel?.url).toBe('https://queue.fal.run/fal-ai/flux/requests/req-1/cancel');
    expect(cancel?.headers.authorization).toBe(`Key ${API_KEY}`);
  });

  it('abort before submit does not touch the network', async () => {
    const fake = queueFake({ app: 'a/b', statuses: [] });
    const controller = new AbortController();
    controller.abort();
    await expect(new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch }).run('a/b', {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.requests).toHaveLength(0);
  });

  it('timeout → cancel + retryable timeout error', async () => {
    const fake = queueFake({ app: 'fal-ai/flux', statuses: [json({ status: 'IN_QUEUE', queue_position: 9 })] });
    const error = (await new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch })
      .run('fal-ai/flux/dev', {}, { pollIntervalMs: 5, timeoutMs: 30 })
      .catch((e: unknown) => e)) as FalError;
    expect(error).toMatchObject({ code: 'timeout', retryable: true });
    expect(fake.requests.some((r) => r.method === 'PUT')).toBe(true);
  });

  it('tolerates transient status errors, but not too many', async () => {
    const flaky = () => queueFake({ app: 'fal-ai/flux', statuses: [new Response('busy', { status: 503 }), json({ detail: 'slow' }, { status: 429 }), json({ status: 'COMPLETED' })] });
    const ok = flaky();
    await expect(new FalQueueClient({ apiKey: API_KEY, fetch: ok.fetch }).run('fal-ai/flux/dev', {}, fast)).resolves.toMatchObject({ output: { ok: true } });
    const strict = flaky();
    await expect(new FalQueueClient({ apiKey: API_KEY, fetch: strict.fetch, maxStatusErrors: 1 }).run('fal-ai/flux/dev', {}, fast)).rejects.toMatchObject({ code: 'rate_limit' });
    const fatal = queueFake({ app: 'fal-ai/flux', statuses: [json({ detail: 'no' }, { status: 401 })] });
    await expect(new FalQueueClient({ apiKey: API_KEY, fetch: fatal.fetch }).run('fal-ai/flux/dev', {}, fast)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('cancels the request when onSubmitted (journal) fails', async () => {
    const fake = queueFake({ app: 'fal-ai/flux', statuses: [json({ status: 'IN_QUEUE' })] });
    await expect(
      new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch }).run('fal-ai/flux/dev', {}, {
        onSubmitted: () => {
          throw new Error('Journal voll');
        },
      }),
    ).rejects.toThrow('Journal voll');
    expect(fake.requests.map((r) => r.method)).toEqual(['POST', 'PUT']);
  });
});

describe('FalQueueClient.resume / cancel / status', () => {
  it('resumes a partial handle by rebuilding URLs from the app root', async () => {
    const fake = queueFake({ app: 'minimax/h3-max', statuses: [json({ status: 'IN_PROGRESS' }), json({ status: 'COMPLETED' })], result: () => json({ video: { url: 'u' } }) });
    const queue = new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch });
    const output = await queue.resume({ endpointId: 'minimax/h3-max/text-to-video', requestId: 'r 9' }, fast);
    expect(output).toEqual({ video: { url: 'u' } });
    expect(fake.requests[0]!.url).toBe('https://queue.fal.run/minimax/h3-max/requests/r%209/status?logs=1');
    expect(fake.requests.at(-1)!.url).toBe('https://queue.fal.run/minimax/h3-max/requests/r%209');
  });

  it('cancel() treats "already completed" as success but reports real errors', async () => {
    const handle = queueHandleFor('fal-ai/flux/dev', 'x');
    const done = createFakeFetch(() => json({ status: 'ALREADY_COMPLETED' }, { status: 400 }));
    await expect(new FalQueueClient({ apiKey: API_KEY, fetch: done.fetch }).cancel(handle)).resolves.toBeUndefined();
    expect(done.requests[0]).toMatchObject({ method: 'PUT', url: 'https://queue.fal.run/fal-ai/flux/requests/x/cancel' });
    const broken = createFakeFetch(() => json({ detail: 'boom' }, { status: 500 }));
    await expect(new FalQueueClient({ apiKey: API_KEY, fetch: broken.fetch }).cancel(handle)).rejects.toMatchObject({ code: 'server' });
  });

  it('status() without logs sends logs=0 and result() returns the JSON', async () => {
    const fake = createFakeFetch((req) => (req.url.includes('/status') ? json({ status: 'IN_QUEUE', queue_position: 1 }) : json({ text: 'hi' })));
    const queue = new FalQueueClient({ apiKey: API_KEY, fetch: fake.fetch, queueBaseUrl: 'https://queue.test/' });
    const handle = queueHandleFor('fal-ai/wizper', 'q', 'https://queue.test/');
    expect((await queue.status(handle)).state).toBe('IN_QUEUE');
    expect(fake.requests[0]!.url).toBe('https://queue.test/fal-ai/wizper/requests/q/status?logs=0');
    expect(await queue.result<{ text: string }>(handle)).toEqual({ text: 'hi' });
  });
});

describe('helpers', () => {
  it('parseQueueStatus maps states tolerantly', () => {
    expect(parseQueueStatus({ status: 'IN_QUEUE', queue_position: 3 })).toMatchObject({ state: 'IN_QUEUE', queuePosition: 3, logs: [] });
    expect(parseQueueStatus({ status: 'COMPLETED', error: null, error_type: null })).toMatchObject({ state: 'COMPLETED' });
    expect(parseQueueStatus({ status: 'COMPLETED', error: 'x', error_type: 'request_timeout' })).toMatchObject({ state: 'FAILED', error: 'x', errorType: 'request_timeout' });
    expect(parseQueueStatus({ status: 'CANCELLED' }).state).toBe('CANCELED');
    expect(parseQueueStatus({ status: 'SOMETHING_NEW' }).state).toBe('IN_PROGRESS');
    expect(parseQueueStatus('garbage').state).toBe('IN_PROGRESS');
  });

  it('appIdOf mirrors the official client (namespaces)', () => {
    expect(appIdOf('fal-ai/flux/dev')).toBe('fal-ai/flux');
    expect(appIdOf('minimax/h3-max/lip-sync/image-to-video')).toBe('minimax/h3-max');
    expect(appIdOf('workflows/acme/pipeline/v2')).toBe('workflows/acme/pipeline');
    expect(appIdOf('fal-ai/wizper')).toBe('fal-ai/wizper');
  });

  it('polling backs off from ~1 s to ~5 s', () => {
    const steps = [1000];
    for (let i = 0; i < 6; i++) steps.push(nextPollInterval(steps.at(-1)!, 5000));
    expect(steps).toEqual([1000, 1500, 2250, 3375, 5000, 5000, 5000]);
  });
});
