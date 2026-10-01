import type { ResolvedFalConfig } from './config.ts';
import { falAuthHeader } from './config.ts';
import { abortError, FalError, falErrorFromStatus, redact, safeUrl } from './errors.ts';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** JSON-Body (wird serialisiert). */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
  /** Vorgang für Fehlermeldungen, z. B. „Modellsuche“. */
  context: string;
  /** `Authorization: Key …` mitsenden (Standard `true`). Nur für fal-eigene Hosts! */
  auth?: boolean;
  /** Wiederholungen bei wiederholbaren Fehlern (429, 5xx, Netzwerk). Standard 0. */
  retries?: number;
  retryDelayMs?: number;
}

export interface HttpResult<T> {
  data: T;
  status: number;
  headers: Headers;
}

/** Wartet `ms` Millisekunden; bricht mit `AbortError` ab, sobald `signal` feuert. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Liest einen Antwort-Body tolerant: JSON, sonst Text, leer → `null`. */
export async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get('content-type') ?? '';
  const looksJson = /^[\s]*[[{"]/.test(text) || /^\s*(true|false|null|-?\d)/.test(text);
  if (contentType.includes('json') || looksJson) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

/** JSON-Anfrage an eine fal-API mit Fehler-Mapping, Abbruch und optionalen Wiederholungen. */
export async function requestJson<T = unknown>(cfg: ResolvedFalConfig, url: string, opts: RequestOptions): Promise<HttpResult<T>> {
  const retries = Math.max(0, opts.retries ?? 0);
  let attempt = 0;
  for (;;) {
    try {
      return await requestOnce<T>(cfg, url, opts);
    } catch (error) {
      if (!(error instanceof FalError) || !error.retryable || attempt >= retries || opts.signal?.aborted) throw error;
      await sleep(retryDelay(error, opts.retryDelayMs ?? 500, attempt), opts.signal);
      attempt++;
    }
  }
}

async function requestOnce<T>(cfg: ResolvedFalConfig, url: string, opts: RequestOptions): Promise<HttpResult<T>> {
  const method = opts.method ?? 'GET';
  const useAuth = opts.auth ?? true;
  if (useAuth && !cfg.apiKey) {
    throw new FalError(`Kein fal-API-Key konfiguriert (${opts.context}) – bitte in den Einstellungen hinterlegen.`, { code: 'missing_key' });
  }
  if (opts.signal?.aborted) throw abortError(opts.signal);
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (useAuth) Object.assign(headers, falAuthHeader(cfg.apiKey));
  let body: string | undefined;
  if (opts.body !== undefined && method !== 'GET') {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await cfg.fetch(url, { method, headers, body, signal: opts.signal });
  } catch (error) {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    if (error instanceof Error && error.name === 'AbortError') throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new FalError(`Netzwerkfehler bei ${opts.context} (${safeUrl(url)}): ${redact(reason, cfg.apiKey)}`, {
      code: 'network',
      retryable: true,
      cause: error,
    });
  }
  let data: unknown;
  try {
    data = await readBody(response);
  } catch (error) {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    throw new FalError(`Antwort von fal unlesbar bei ${opts.context}`, { code: 'bad_response', status: response.status, retryable: true, cause: error });
  }
  if (!response.ok) {
    throw falErrorFromStatus(response.status, data, opts.context, {
      retryableHeader: response.headers.get('x-fal-retryable'),
      requestId: response.headers.get('x-fal-request-id'),
      retryAfter: response.headers.get('retry-after'),
      secret: cfg.apiKey,
    });
  }
  return { data: data as T, status: response.status, headers: response.headers };
}

/** Wartezeit vor einem neuen Versuch: `Retry-After` (max. 60 s), sonst exponentiell. */
export function retryDelay(error: FalError, baseMs: number, attempt: number): number {
  if (error.retryAfterSec !== undefined) return Math.min(error.retryAfterSec, 60) * 1000;
  return baseMs * 2 ** attempt;
}

/** Hängt Query-Parameter an eine URL an (bestehende Query bleibt erhalten). */
export function withQuery(url: string, params: Record<string, string | number | boolean | undefined | null>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}
