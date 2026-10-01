/**
 * Grundkonfiguration für alle fal-Clients. Der API-Key wird nur als `Authorization`-Header an
 * fal-eigene Hosts geschickt – nie in URLs, Fehlermeldungen oder Logs.
 */

export interface FalConfig {
  apiKey: string;
  /** Injizierbares `fetch` (Tests, Proxy). Standard: globales `fetch`. */
  fetch?: typeof fetch;
  /** Plattform-API, Standard `https://api.fal.ai/v1`. */
  platformBaseUrl?: string;
  /** Queue-API, Standard `https://queue.fal.run`. */
  queueBaseUrl?: string;
  /** Storage-REST-API, Standard `https://rest.fal.ai` (wie `@fal-ai/client` 1.10.1). */
  storageBaseUrl?: string;
}

export const FAL_PLATFORM_BASE_URL = 'https://api.fal.ai/v1';
export const FAL_QUEUE_BASE_URL = 'https://queue.fal.run';
/** `@fal-ai/client` 1.10.1 (`config.getRestApiUrl()`) nutzt `https://rest.fal.ai`; ältere Versionen `rest.alpha.fal.ai`. */
export const FAL_STORAGE_BASE_URL = 'https://rest.fal.ai';

/** OpenAI-kompatibler LLM-Router von fal (Director-Fallback). Auth: `Authorization: Key …`. */
export const FAL_OPENAI_BASE_URL = 'https://fal.run/openrouter/router/openai/v1';

/**
 * Hosts, die die App erreichen muss (Einstellungen, Firewall-Doku). `*.fal.media` deckt die CDN-Varianten
 * (`v3.fal.media`, `v3b.fal.media`, …) für Ergebnis-Downloads und signierte Upload-URLs ab.
 * `fal.ai` wird nur als Fallback für OpenAPI-Dokumente genutzt, `storage.googleapis.com` für ältere Ergebnis-URLs.
 */
export const FAL_HOSTS: string[] = [
  'api.fal.ai',
  'queue.fal.run',
  'fal.run',
  'rest.fal.ai',
  'rest.alpha.fal.ai',
  'fal.media',
  'v3.fal.media',
  'v3b.fal.media',
  '*.fal.media',
  'fal.ai',
  'storage.googleapis.com',
];

export function falAuthHeader(apiKey: string): { Authorization: string } {
  return { Authorization: `Key ${apiKey}` };
}

/** Header, mit dem fal die JSON-Payloads (Ein-/Ausgaben) nicht 30 Tage speichert (nicht im offiziellen Client). */
export const STORE_IO_HEADER = 'X-Fal-Store-IO';
/** Lifecycle der von fal erzeugten Objekte (Queue/Run), Wert: JSON `{ "expiration_duration_seconds": n }`. */
export const OBJECT_LIFECYCLE_PREFERENCE_HEADER = 'X-Fal-Object-Lifecycle-Preference';
/** Lifecycle eines Uploads beim Storage-`initiate` (wie `@fal-ai/client`). */
export const UPLOAD_LIFECYCLE_HEADER = 'X-Fal-Object-Lifecycle';

export interface ResolvedFalConfig {
  apiKey: string;
  fetch: typeof fetch;
  platformBaseUrl: string;
  queueBaseUrl: string;
  storageBaseUrl: string;
}

export function resolveConfig(cfg: FalConfig): ResolvedFalConfig {
  const fetchImpl = cfg.fetch ?? (globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined);
  if (!fetchImpl) throw new Error('Kein fetch verfügbar (Node ≥ 18 erforderlich)');
  return {
    apiKey: (cfg.apiKey ?? '').trim(),
    fetch: fetchImpl,
    platformBaseUrl: trimSlash(cfg.platformBaseUrl ?? FAL_PLATFORM_BASE_URL),
    queueBaseUrl: trimSlash(cfg.queueBaseUrl ?? FAL_QUEUE_BASE_URL),
    storageBaseUrl: trimSlash(cfg.storageBaseUrl ?? FAL_STORAGE_BASE_URL),
  };
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Endpoint-IDs wie `fal-ai/flux/dev` oder `minimax/h3-max/text-to-video` (mind. zwei Segmente). */
const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9._~-]+)+$/;

export function assertEndpointId(endpointId: string): void {
  if (!ENDPOINT_ID.test(endpointId) || endpointId.split('/').some((s) => s === '.' || s === '..')) {
    throw new Error(`Ungültige fal-Endpoint-ID: „${endpointId}“`);
  }
}
