/** Test-Hilfen: aufzeichnendes Fake-`fetch` (kein Netzwerk). */

export interface RecordedRequest {
  url: string;
  method: string;
  /** Header mit kleingeschriebenen Namen. */
  headers: Record<string, string>;
  /** JSON-geparster Body (falls möglich), sonst Rohwert. */
  body: unknown;
  rawBody: unknown;
}

export type Handler = (req: RecordedRequest, index: number) => Response | Promise<Response>;

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  new Headers(headers).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function createFakeFetch(handler: Handler): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fake = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const rawBody = init.body;
    let body: unknown = rawBody;
    if (typeof rawBody === 'string') {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
    const req: RecordedRequest = { url, method: (init.method ?? 'GET').toUpperCase(), headers: normalizeHeaders(init.headers), body, rawBody };
    requests.push(req);
    const signal = init.signal;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = Promise.resolve(handler(req, requests.length - 1));
    if (!signal) return result;
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      result.then(
        (r) => {
          signal.removeEventListener('abort', onAbort);
          resolve(r);
        },
        (e: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(e);
        },
      );
    });
  }) as typeof fetch;
  return { fetch: fake, requests };
}

export const API_KEY = 'key-id-123:secret-abc-456';
