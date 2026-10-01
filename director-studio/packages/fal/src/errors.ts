/**
 * Fehler der fal-Clients. Meldungen sind deutsch und enthalten nie den API-Key oder signierte URLs.
 */

export type FalErrorCode =
  | 'missing_key'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'failed'
  | 'canceled'
  | 'bad_response'
  | 'http';

export interface FalErrorOptions {
  status?: number | undefined;
  body?: unknown;
  retryable?: boolean | undefined;
  code?: FalErrorCode | undefined;
  /** Einzelmeldungen (z. B. Validierungsdetails aus `detail[]`). */
  details?: string[] | undefined;
  requestId?: string | undefined;
  /** Wartezeit laut `Retry-After` (Sekunden). */
  retryAfterSec?: number | undefined;
  cause?: unknown;
}

export class FalError extends Error {
  override readonly name = 'FalError';
  readonly status?: number | undefined;
  readonly body?: unknown;
  readonly retryable: boolean;
  readonly code: FalErrorCode;
  readonly details: string[];
  readonly requestId?: string | undefined;
  readonly retryAfterSec?: number | undefined;

  constructor(message: string, options: FalErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.status = options.status;
    this.body = options.body;
    this.code = options.code ?? 'http';
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? [];
    this.requestId = options.requestId;
    this.retryAfterSec = options.retryAfterSec;
  }
}

export function isFalError(error: unknown): error is FalError {
  return error instanceof FalError;
}

/** Abbruch (AbortSignal) als `AbortError`, kompatibel zu `fetch`-Abbrüchen. */
export function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error && (reason.name === 'AbortError' || reason.name === 'TimeoutError')) return reason;
  const error = new Error('Vorgang abgebrochen');
  error.name = 'AbortError';
  if (reason !== undefined) (error as Error & { cause?: unknown }).cause = reason;
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Entfernt Query-Strings (signierte Tokens) aus URLs für Fehlermeldungen. */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:') return 'data:…';
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0]?.slice(0, 200) ?? '';
  }
}

/** Ersetzt einen Geheimwert in beliebigem Text (Sicherheitsnetz für Fehlermeldungen). */
export function redact(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join('***');
}

/** Liest eine fal-Validierungs-/Fehlerantwort (`detail` als String oder Liste `{loc,msg,type}`). */
export function errorDetails(body: unknown): string[] {
  if (!body || typeof body !== 'object') return typeof body === 'string' && body.trim() ? [truncate(body.trim(), 300)] : [];
  const record = body as Record<string, unknown>;
  const detail = record.detail ?? record.errors;
  if (typeof detail === 'string') return [truncate(detail, 300)];
  if (Array.isArray(detail)) {
    return detail
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (!entry || typeof entry !== 'object') return '';
        const e = entry as Record<string, unknown>;
        const loc = Array.isArray(e.loc) ? e.loc.filter((part) => part !== 'body').join('.') : '';
        const msg = typeof e.msg === 'string' ? e.msg : typeof e.message === 'string' ? e.message : JSON.stringify(e).slice(0, 200);
        const type = typeof e.type === 'string' ? ` [${e.type}]` : '';
        return loc ? `${loc}: ${msg}${type}` : `${msg}${type}`;
      })
      .filter(Boolean)
      .map((line) => truncate(line, 300));
  }
  for (const key of ['message', 'error', 'msg']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return [truncate(value.trim(), 300)];
  }
  return [];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Baut aus einer HTTP-Fehlerantwort einen `FalError`. `context` beschreibt den Vorgang („Statusabfrage“ …).
 * Mapping: 401 → Key ungültig, 403 → keine Berechtigung/Guthaben, 422 → Validierungsdetails,
 * 429/408/5xx → wiederholbar (bzw. laut `X-Fal-Retryable`).
 */
export function falErrorFromStatus(
  status: number,
  body: unknown,
  context: string,
  options: { retryableHeader?: string | null; requestId?: string | null; secret?: string; retryAfter?: string | null } = {},
): FalError {
  const details = errorDetails(body).map((line) => redact(line, options.secret));
  const suffix = details.length ? `: ${details.join('; ')}` : '';
  const headerRetryable = parseRetryableHeader(options.retryableHeader);
  const requestId = options.requestId ?? undefined;
  const retryAfter = options.retryAfter != null && options.retryAfter.trim() !== '' ? Number(options.retryAfter) : NaN;
  const base = { status, body, details, requestId, retryAfterSec: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined };
  if (status === 401) {
    return new FalError(`fal-API-Key ungültig (401) – bitte in den Einstellungen prüfen. (${context})`, { ...base, code: 'unauthorized', retryable: false });
  }
  if (status === 403) {
    return new FalError(`fal hat den Zugriff verweigert (403) bei ${context}${suffix || ' – fehlende Berechtigung oder Guthaben aufgebraucht'}`, {
      ...base,
      code: 'forbidden',
      retryable: false,
    });
  }
  if (status === 404) {
    return new FalError(`Nicht gefunden (404) bei ${context}${suffix}`, { ...base, code: 'not_found', retryable: false });
  }
  if (status === 422 || status === 400) {
    return new FalError(`Ungültige Eingabe (${status}) bei ${context}${suffix || ' – keine Details geliefert'}`, {
      ...base,
      code: 'validation',
      retryable: headerRetryable ?? false,
    });
  }
  if (status === 429) {
    return new FalError(`Zu viele Anfragen an fal (429) bei ${context} – später erneut versuchen${suffix}`, {
      ...base,
      code: 'rate_limit',
      retryable: true,
    });
  }
  if (status === 408 || status === 504) {
    return new FalError(`Zeitüberschreitung bei fal (${status}) bei ${context}${suffix}`, { ...base, code: 'timeout', retryable: headerRetryable ?? true });
  }
  if (status >= 500) {
    return new FalError(`fal-Serverfehler (${status}) bei ${context}${suffix}`, { ...base, code: 'server', retryable: headerRetryable ?? true });
  }
  return new FalError(`fal antwortete mit HTTP ${status} bei ${context}${suffix}`, { ...base, code: 'http', retryable: headerRetryable ?? false });
}

function parseRetryableHeader(value: string | null | undefined): boolean | undefined {
  if (value == null) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}
