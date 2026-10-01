import { z } from 'zod';
import {
  assertEndpointId,
  type FalConfig,
  OBJECT_LIFECYCLE_PREFERENCE_HEADER,
  resolveConfig,
  type ResolvedFalConfig,
  STORE_IO_HEADER,
  trimSlash,
} from './config.ts';
import { abortError, FalError, isAbortError } from './errors.ts';
import { requestJson, sleep, withQuery } from './http.ts';

/**
 * Queue-Runner (submit → status → result, mit Abbruch und Wiederaufnahme). Webhooks erreichen keine lokale App,
 * deshalb wird gepollt (Start ~1 s, Backoff bis ~5 s).
 *
 * Verifiziert gegen `@fal-ai/client` 1.10.1 (`src/queue.js`, `src/request.js`, `src/utils.js`):
 * - Submit: `POST https://queue.fal.run/<endpoint_id>` (volle ID inkl. Sub-Pfad), Body = Eingabe als JSON,
 *   Antwort `{ request_id, status_url, response_url, cancel_url, queue_position }`.
 * - Status/Ergebnis/Abbruch laufen über die App-Wurzel `<owner>/<alias>` (Namespaces `workflows`/`comfy` mit Präfix):
 *   `GET …/requests/<id>/status?logs=1`, `GET …/requests/<id>`, `PUT …/requests/<id>/cancel`.
 *   Deshalb werden bevorzugt die zurückgegebenen URLs genutzt (nur bei gleicher Origin wie die Queue-Basis).
 * - Status: `IN_QUEUE` (queue_position) | `IN_PROGRESS` | `COMPLETED`; ein Fehlschlag erscheint laut fal-Doku als
 *   `COMPLETED` mit `error`/`error_type`; Validierungsfehler erst beim Ergebnisabruf (HTTP 422 + `detail`).
 *   `FAILED`/`CANCELED` werden zusätzlich tolerant akzeptiert.
 * - `X-Fal-Store-IO: 0` (fal-Doku „Data Retention“, nicht im Client) verhindert die 30-tägige Payload-Speicherung.
 *   Annahme: Das Ergebnis bleibt über `response_url` abrufbar (betrifft nur die Request-Historie im Dashboard).
 */

export interface QueueHandle {
  endpointId: string;
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
}

export type QueueState = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELED';

export interface QueueStatus {
  state: QueueState;
  queuePosition?: number;
  logs: string[];
  error?: string;
  /** Maschinenlesbarer Fehlertyp von fal, z. B. `request_timeout`, `runner_disconnected`, `client_cancelled`. */
  errorType?: string;
  raw: unknown;
}

export interface FalQueueOptions extends FalConfig {
  /** `true` erlaubt fal, Ein-/Ausgaben 30 Tage zu speichern. Standard `false` → `X-Fal-Store-IO: 0`. */
  storeIo?: boolean;
  /** Lebensdauer der erzeugten Ausgabedateien bei fal (Sekunden) → `X-Fal-Object-Lifecycle-Preference`. */
  objectLifecycleSeconds?: number;
  /** Obergrenze des Poll-Intervalls (Standard 5000 ms). */
  maxPollIntervalMs?: number;
  /** Aufeinanderfolgende vorübergehende Statusfehler, die toleriert werden (Standard 5). */
  maxStatusErrors?: number;
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Start-Intervall (Standard 1000 ms), wächst ×1,5 bis `maxPollIntervalMs`. */
  pollIntervalMs?: number;
  timeoutMs?: number;
  onStatus?: (s: QueueStatus) => void;
  /** Wird nach dem Submit aufgerufen (z. B. Journal mit request_id). Wirft er, wird die Anfrage storniert. */
  onSubmitted?: (h: QueueHandle) => void | Promise<void>;
}

export type ResumeOptions = Omit<RunOptions, 'onSubmitted'>;

export interface RunResult {
  handle: QueueHandle;
  output: unknown;
  /** Abgerechnete Einheiten laut Header `x-fal-billable-units` (falls geliefert). */
  billableUnits?: number;
}

const ENDPOINT_NAMESPACES = ['workflows', 'comfy'];
/** Fehlertypen, bei denen ein erneuter Versuch sinnvoll ist (fal-Doku „Request errors“). */
const RETRYABLE_ERROR_TYPES = new Set(['request_timeout', 'startup_timeout', 'runner_disconnected', 'runner_error', 'internal_error', 'runner_scheduling_failure']);

const submitResponseSchema = z.looseObject({
  request_id: z.string().min(1),
  status_url: z.string().optional().catch(undefined),
  response_url: z.string().optional().catch(undefined),
  cancel_url: z.string().optional().catch(undefined),
  queue_position: z.number().optional().catch(undefined),
});

const statusResponseSchema = z.looseObject({
  status: z.string().catch('IN_PROGRESS'),
  queue_position: z.number().optional().catch(undefined),
  logs: z.array(z.unknown()).nullish().catch(null),
  error: z.unknown().optional(),
  error_type: z.string().nullish().catch(null),
});

/** Backoff des Pollings: ×1,5 je Runde bis zur Obergrenze. */
export function nextPollInterval(current: number, max: number): number {
  return Math.min(max, Math.max(current * 1.5, 1));
}

/** App-Wurzel einer Endpoint-ID wie im offiziellen Client (`owner/alias`, ggf. mit Namespace). */
export function appIdOf(endpointId: string): string {
  const parts = endpointId.split('/').filter(Boolean);
  if (ENDPOINT_NAMESPACES.includes(parts[0] ?? '') && parts.length >= 3) return parts.slice(0, 3).join('/');
  return parts.slice(0, 2).join('/');
}

/** Baut einen Handle aus Endpoint-ID und request_id (z. B. für alte Journal-Einträge ohne URLs). */
export function queueHandleFor(endpointId: string, requestId: string, queueBaseUrl = 'https://queue.fal.run'): QueueHandle {
  const base = `${trimSlash(queueBaseUrl)}/${appIdOf(endpointId)}/requests/${encodeURIComponent(requestId)}`;
  return { endpointId, requestId, statusUrl: `${base}/status`, responseUrl: base, cancelUrl: `${base}/cancel` };
}

function logLines(logs: unknown[] | null | undefined): string[] {
  if (!logs) return [];
  return logs
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const message = (entry as Record<string, unknown>).message;
        return typeof message === 'string' ? message : JSON.stringify(entry);
      }
      return '';
    })
    .filter(Boolean);
}

function errorText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.detail === 'string') return record.detail;
  }
  return JSON.stringify(value).slice(0, 300);
}

/** Normalisiert eine Statusantwort (tolerant gegenüber Abweichungen). */
export function parseQueueStatus(raw: unknown): QueueStatus {
  const parsed = statusResponseSchema.safeParse(raw && typeof raw === 'object' ? raw : {});
  const data = parsed.success ? parsed.data : { status: 'IN_PROGRESS', logs: null, error: undefined, error_type: null, queue_position: undefined };
  const status = data.status.toUpperCase();
  const error = errorText(data.error);
  const errorType = data.error_type ?? undefined;
  let state: QueueState;
  if (status === 'IN_QUEUE' || status === 'QUEUED') state = 'IN_QUEUE';
  else if (status === 'COMPLETED' || status === 'OK' || status === 'SUCCEEDED') {
    if (errorType === 'client_cancelled') state = 'CANCELED';
    else state = error || errorType ? 'FAILED' : 'COMPLETED';
  } else if (status === 'FAILED' || status === 'ERROR') state = 'FAILED';
  else if (status === 'CANCELED' || status === 'CANCELLED' || status === 'CANCELLATION_REQUESTED') state = 'CANCELED';
  else state = 'IN_PROGRESS';
  const result: QueueStatus = { state, logs: logLines(data.logs), raw };
  if (data.queue_position !== undefined) result.queuePosition = data.queue_position;
  if (error) result.error = error;
  if (errorType) result.errorType = errorType;
  return result;
}

export class FalQueueClient {
  private readonly cfg: ResolvedFalConfig;
  private readonly storeIo: boolean;
  private readonly lifecycleSeconds: number | undefined;
  private readonly maxPollIntervalMs: number;
  private readonly maxStatusErrors: number;
  private readonly trustedOrigin: string;

  constructor(cfg: FalQueueOptions) {
    this.cfg = resolveConfig(cfg);
    this.storeIo = cfg.storeIo ?? false;
    this.lifecycleSeconds = cfg.objectLifecycleSeconds;
    this.maxPollIntervalMs = cfg.maxPollIntervalMs ?? 5000;
    this.maxStatusErrors = cfg.maxStatusErrors ?? 5;
    this.trustedOrigin = new URL(this.cfg.queueBaseUrl).origin;
  }

  /** Header für das Einreichen: Speicher-Opt-out und Lifecycle. */
  submitHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (!this.storeIo) headers[STORE_IO_HEADER] = '0';
    if (this.lifecycleSeconds !== undefined && Number.isFinite(this.lifecycleSeconds) && this.lifecycleSeconds > 0) {
      headers[OBJECT_LIFECYCLE_PREFERENCE_HEADER] = JSON.stringify({ expiration_duration_seconds: Math.round(this.lifecycleSeconds) });
    }
    return headers;
  }

  async submit(endpointId: string, input: Record<string, unknown>, opts: { signal?: AbortSignal } = {}): Promise<QueueHandle> {
    assertEndpointId(endpointId);
    const url = `${this.cfg.queueBaseUrl}/${endpointId}`;
    const { data } = await requestJson(this.cfg, url, {
      method: 'POST',
      body: input ?? {},
      headers: this.submitHeaders(),
      signal: opts.signal,
      context: `Einreichen bei ${endpointId}`,
      // Nur 429 wiederholen: Bei 5xx ist unklar, ob fal den Auftrag angenommen hat (Doppelkosten vermeiden).
      retries: 0,
    }).catch(async (error: unknown) => {
      if (error instanceof FalError && error.code === 'rate_limit' && !opts.signal?.aborted) {
        await sleep(2000, opts.signal);
        return requestJson(this.cfg, url, { method: 'POST', body: input ?? {}, headers: this.submitHeaders(), signal: opts.signal, context: `Einreichen bei ${endpointId}` });
      }
      throw error;
    });
    const parsed = submitResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new FalError(`fal hat beim Einreichen keine request_id geliefert (${endpointId})`, { code: 'bad_response', body: data });
    }
    const fallback = queueHandleFor(endpointId, parsed.data.request_id, this.cfg.queueBaseUrl);
    return {
      endpointId,
      requestId: parsed.data.request_id,
      statusUrl: this.trusted(parsed.data.status_url) ?? fallback.statusUrl,
      responseUrl: this.trusted(parsed.data.response_url) ?? fallback.responseUrl,
      cancelUrl: this.trusted(parsed.data.cancel_url) ?? fallback.cancelUrl,
    };
  }

  async status(h: QueueHandle, opts: { logs?: boolean; signal?: AbortSignal } = {}): Promise<QueueStatus> {
    const handle = this.normalize(h);
    const { data } = await requestJson(this.cfg, withQuery(handle.statusUrl, { logs: opts.logs ? '1' : '0' }), {
      signal: opts.signal,
      context: `Statusabfrage ${handle.endpointId}`,
    });
    return parseQueueStatus(data);
  }

  async result<T = unknown>(h: QueueHandle, opts: { signal?: AbortSignal } = {}): Promise<T> {
    return (await this.resultWithMeta(h, opts)).output as T;
  }

  /** Ergebnis plus abgerechnete Einheiten (`x-fal-billable-units`, falls vorhanden). */
  async resultWithMeta(h: QueueHandle, opts: { signal?: AbortSignal; retries?: number } = {}): Promise<{ output: unknown; billableUnits?: number }> {
    const handle = this.normalize(h);
    const { data, headers } = await requestJson(this.cfg, handle.responseUrl, {
      signal: opts.signal,
      context: `Ergebnisabruf ${handle.endpointId}`,
      retries: opts.retries ?? 2,
      retryDelayMs: 1000,
    });
    const units = Number(headers.get('x-fal-billable-units'));
    return Number.isFinite(units) && units > 0 && headers.has('x-fal-billable-units') ? { output: data, billableUnits: units } : { output: data };
  }

  /** Storniert eine Anfrage. „Schon fertig“ (400/404/409) gilt nicht als Fehler. */
  async cancel(h: QueueHandle, opts: { signal?: AbortSignal } = {}): Promise<void> {
    const handle = this.normalize(h);
    try {
      await requestJson(this.cfg, handle.cancelUrl, { method: 'PUT', signal: opts.signal, context: `Abbruch ${handle.endpointId}` });
    } catch (error) {
      if (error instanceof FalError && (error.status === 400 || error.status === 404 || error.status === 409)) return;
      throw error;
    }
  }

  async run(endpointId: string, input: Record<string, unknown>, opts: RunOptions = {}): Promise<RunResult> {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    const handle = await this.submit(endpointId, input, opts.signal ? { signal: opts.signal } : {});
    if (opts.onSubmitted) {
      try {
        await opts.onSubmitted(handle);
      } catch (error) {
        await this.cancelQuietly(handle);
        throw error;
      }
    }
    const { output, billableUnits } = await this.waitAndFetch(handle, opts);
    return billableUnits !== undefined ? { handle, output, billableUnits } : { handle, output };
  }

  /** Absturz-Wiederaufnahme: pollt eine bereits eingereichte Anfrage weiter (fehlende URLs werden rekonstruiert). */
  async resume(h: Pick<QueueHandle, 'endpointId' | 'requestId'> & Partial<QueueHandle>, opts: ResumeOptions = {}): Promise<unknown> {
    const handle = this.normalize(h);
    return (await this.waitAndFetch(handle, opts)).output;
  }

  private async waitAndFetch(handle: QueueHandle, opts: ResumeOptions): Promise<{ output: unknown; billableUnits?: number }> {
    const signal = opts.signal;
    const deadline = opts.timeoutMs && opts.timeoutMs > 0 ? Date.now() + opts.timeoutMs : Number.POSITIVE_INFINITY;
    let interval = Math.max(0, opts.pollIntervalMs ?? 1000);
    let statusErrors = 0;
    const abort = async (): Promise<never> => {
      await this.cancelQuietly(handle);
      throw abortError(signal);
    };
    for (;;) {
      if (signal?.aborted) return abort();
      if (Date.now() > deadline) {
        await this.cancelQuietly(handle);
        throw new FalError(`Zeitüberschreitung: ${handle.endpointId} nach ${Math.round((opts.timeoutMs ?? 0) / 1000)} s nicht fertig – Anfrage storniert`, {
          code: 'timeout',
          retryable: true,
          requestId: handle.requestId,
        });
      }
      let status: QueueStatus | undefined;
      try {
        status = await this.status(handle, signal ? { logs: true, signal } : { logs: true });
        statusErrors = 0;
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) return abort();
        if (!(error instanceof FalError) || !error.retryable || ++statusErrors > this.maxStatusErrors) throw error;
      }
      if (status) {
        try {
          opts.onStatus?.(status);
        } catch {
          // Fehler im Beobachter dürfen das Polling nicht abbrechen.
        }
        if (status.state === 'COMPLETED') return this.resultWithMeta(handle, signal ? { signal } : {});
        if (status.state === 'FAILED') throw await this.failure(handle, status);
        if (status.state === 'CANCELED') {
          throw new FalError(`Anfrage ${handle.requestId} wurde bei fal abgebrochen`, { code: 'canceled', requestId: handle.requestId, body: status.raw });
        }
      }
      const wait = Math.min(interval, Math.max(0, deadline - Date.now()));
      try {
        await sleep(wait, signal);
      } catch {
        return abort();
      }
      interval = nextPollInterval(interval, this.maxPollIntervalMs);
    }
  }

  /** Baut den Fehler für einen fehlgeschlagenen Auftrag; Details liefert ggf. der Ergebnisabruf. */
  private async failure(handle: QueueHandle, status: QueueStatus): Promise<FalError> {
    let details: string[] = [];
    let httpStatus: number | undefined;
    try {
      await this.resultWithMeta(handle, { retries: 0, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (error instanceof FalError) {
        details = error.details;
        httpStatus = error.status;
      }
    }
    const reason = status.error ?? (details.length ? details.join('; ') : (status.errorType ?? 'unbekannter Fehler'));
    const extra = details.length && status.error ? ` (${details.join('; ')})` : '';
    return new FalError(`Generierung fehlgeschlagen (${handle.endpointId}): ${reason}${extra}`, {
      code: 'failed',
      status: httpStatus,
      retryable: status.errorType ? RETRYABLE_ERROR_TYPES.has(status.errorType) : false,
      details,
      requestId: handle.requestId,
      body: status.raw,
    });
  }

  private async cancelQuietly(handle: QueueHandle): Promise<void> {
    try {
      await this.cancel(handle, { signal: AbortSignal.timeout(10_000) });
    } catch {
      // best effort
    }
  }

  private trusted(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
      return new URL(url).origin === this.trustedOrigin ? url : undefined;
    } catch {
      return undefined;
    }
  }

  /** Ergänzt fehlende/fremde URLs eines Handles (der Key geht nur an die Queue-Origin). */
  private normalize(h: Pick<QueueHandle, 'endpointId' | 'requestId'> & Partial<QueueHandle>): QueueHandle {
    if (!h.requestId) throw new Error('QueueHandle ohne requestId');
    assertEndpointId(h.endpointId);
    const fallback = queueHandleFor(h.endpointId, h.requestId, this.cfg.queueBaseUrl);
    return {
      endpointId: h.endpointId,
      requestId: h.requestId,
      statusUrl: this.trusted(h.statusUrl) ?? fallback.statusUrl,
      responseUrl: this.trusted(h.responseUrl) ?? fallback.responseUrl,
      cancelUrl: this.trusted(h.cancelUrl) ?? fallback.cancelUrl,
    };
  }
}
