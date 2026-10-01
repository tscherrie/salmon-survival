import { z } from 'zod';
import { type FalConfig, resolveConfig, type ResolvedFalConfig } from './config.ts';
import { FalError } from './errors.ts';
import { requestJson } from './http.ts';

/**
 * Client für die fal-Plattform-API (`https://api.fal.ai/v1`): Modellsuche, Preise, Kostenschätzung, OpenAPI.
 *
 * Verifizierte Formen (Doku-Snippets + Open-Source-Nutzer, Stand 2026-10):
 * - `GET /models?category=&q=&status=&limit=&cursor=&endpoint_id=&expand=openapi-3.0`
 *   → `{ models: [{ endpoint_id, metadata: { display_name, category, description, status, tags, … }, openapi? }], next_cursor, has_more }`
 * - `GET /models/pricing?endpoint_id=a,b,c` (1–50 IDs) → `{ prices: [{ endpoint_id, unit_price, unit, currency }], next_cursor?, has_more? }`
 * - `POST /models/pricing/estimate` mit `{ estimate_type: 'unit_price' | 'historical_api_price', endpoints: { id: { unit_quantity | call_quantity } } }`
 *   → `{ estimate_type, total_cost, currency }`
 * Alles Weitere wird tolerant gelesen (unbekannte Felder bleiben in `raw`).
 */

export interface FalModelRecord {
  endpointId: string;
  displayName: string;
  category: string;
  description: string;
  status?: string;
  tags?: string[];
  vendor?: string;
  thumbnailUrl?: string;
  openapi?: unknown;
  raw: unknown;
}

export interface FalPrice {
  endpointId: string;
  unitPrice: number;
  unit: string;
  currency: string;
}

export interface ListModelsParams {
  category?: string;
  q?: string;
  status?: string;
  limit?: number;
  cursor?: string;
  expandOpenapi?: boolean;
  /** „Find“-Modus: bestimmte Endpoint-IDs abrufen. */
  endpointId?: string | string[];
}

export interface EstimateRequest {
  endpointId: string;
  /** Abrechnungseinheiten (Bilder, Sekunden …) → `estimate_type: unit_price`. */
  unitQuantity?: number;
  /** Anzahl Aufrufe → `estimate_type: historical_api_price`. */
  callQuantity?: number;
}

export interface FalPlatformOptions extends FalConfig {
  /** Fallback-Quelle für OpenAPI-Dokumente (öffentlich, ohne Key); `null` deaktiviert. */
  openapiFallbackUrl?: string | null;
  /** Wiederholungen für GET-Anfragen bei 429/5xx/Netzwerkfehlern. */
  retries?: number;
  retryDelayMs?: number;
}

/** Öffentliche OpenAPI-Quelle von fal (Annahme aus fal-Doku/Community, nur Fallback). */
export const FAL_OPENAPI_FALLBACK_URL = 'https://fal.ai/api/openapi/queue/openapi.json';
/** Die Preis-API akzeptiert höchstens 50 Endpoint-IDs je Anfrage. */
export const PRICING_BATCH_SIZE = 50;

const optionalString = z.string().optional().catch(undefined);

const rawModelSchema = z.looseObject({
  endpoint_id: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional().catch(undefined),
  openapi: z.unknown().optional(),
});

const metadataSchema = z.looseObject({
  display_name: optionalString,
  category: optionalString,
  description: optionalString,
  status: optionalString,
  tags: z.array(z.unknown()).optional().catch(undefined),
  thumbnail_url: optionalString,
  vendor: optionalString,
  owner: optionalString,
});

const modelsPageSchema = z.looseObject({
  models: z.array(z.unknown()).catch([]),
  next_cursor: z.string().nullish().catch(null),
  has_more: z.boolean().optional().catch(undefined),
});

const priceEntrySchema = z.looseObject({
  endpoint_id: z.string().min(1),
  unit_price: z.coerce.number().refine(Number.isFinite),
  unit: z.string().optional().catch(undefined),
  billing_unit: z.string().optional().catch(undefined),
  currency: z.string().optional().catch(undefined),
});

const pricingPageSchema = z.looseObject({
  prices: z.array(z.unknown()).catch([]),
  next_cursor: z.string().nullish().catch(null),
  has_more: z.boolean().optional().catch(undefined),
});

const estimateResponseSchema = z.looseObject({
  total_cost: z.coerce.number().refine(Number.isFinite),
  currency: z.string().optional().catch(undefined),
  estimate_type: z.string().optional().catch(undefined),
});

/** Anbieter aus der Endpoint-ID ableiten (falls fal keinen liefert). */
const VENDOR_BY_PREFIX: Array<[string, string]> = [
  ['minimax', 'MiniMax'],
  ['elevenlabs', 'ElevenLabs'],
  ['bytedance', 'ByteDance'],
  ['kling', 'Kling'],
  ['veo', 'Google'],
  ['nano-banana', 'Google'],
  ['lyria', 'Google'],
  ['imagen', 'Google'],
  ['flux', 'Black Forest Labs'],
  ['bria', 'Bria'],
  ['recraft', 'Recraft'],
  ['topaz', 'Topaz Labs'],
  ['sync-lipsync', 'Sync Labs'],
  ['stable-audio', 'Stability AI'],
  ['seedvr', 'ByteDance'],
  ['seedream', 'ByteDance'],
  ['sam', 'Meta'],
  ['whisper', 'OpenAI'],
  ['wizper', 'fal'],
  ['openai', 'OpenAI'],
  ['wan', 'Alibaba'],
  ['qwen', 'Alibaba'],
  ['hunyuan', 'Tencent'],
  ['pixverse', 'PixVerse'],
  ['luma', 'Luma'],
  ['runway', 'Runway'],
  ['ideogram', 'Ideogram'],
  ['cassetteai', 'CassetteAI'],
  ['beatoven', 'Beatoven'],
  ['mmaudio', 'MMAudio'],
  ['demucs', 'Meta'],
  ['birefnet', 'BiRefNet'],
];

export function deriveVendor(endpointId: string): string | undefined {
  const parts = endpointId.toLowerCase().split('/');
  const owner = parts[0] ?? '';
  const key = owner === 'fal-ai' || owner === 'fal' ? (parts[1] ?? owner) : owner;
  for (const [prefix, name] of VENDOR_BY_PREFIX) {
    if (key.startsWith(prefix)) return name;
  }
  if (!key) return undefined;
  if (owner === 'fal-ai' || owner === 'fal') return 'fal';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Wandelt einen Rohdatensatz der Modellsuche tolerant in `FalModelRecord` um (`null`, wenn unbrauchbar). */
export function parseModelRecord(raw: unknown): FalModelRecord | null {
  const parsed = rawModelSchema.safeParse(raw);
  if (!parsed.success) return null;
  const top = parsed.data as Record<string, unknown>;
  // Manche Antworten liefern die Metadaten flach statt unter `metadata` → beide zusammenführen.
  const meta = metadataSchema.parse({ ...top, ...(parsed.data.metadata ?? {}) });
  const endpointId = parsed.data.endpoint_id;
  const tags = (meta.tags ?? []).filter((t): t is string => typeof t === 'string' && t.length > 0);
  const record: FalModelRecord = {
    endpointId,
    displayName: meta.display_name?.trim() || endpointId,
    category: meta.category?.trim() || '',
    description: meta.description?.trim() || '',
    raw,
  };
  if (meta.status) record.status = meta.status;
  if (tags.length) record.tags = tags;
  const vendor = meta.vendor || meta.owner || deriveVendor(endpointId);
  if (vendor) record.vendor = vendor;
  if (meta.thumbnail_url) record.thumbnailUrl = meta.thumbnail_url;
  if (parsed.data.openapi !== undefined && parsed.data.openapi !== null) record.openapi = parsed.data.openapi;
  return record;
}

export function parsePriceEntry(raw: unknown): FalPrice | null {
  const parsed = priceEntrySchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    endpointId: parsed.data.endpoint_id,
    unitPrice: parsed.data.unit_price,
    unit: (parsed.data.unit ?? parsed.data.billing_unit ?? '').trim(),
    currency: (parsed.data.currency ?? 'USD').toUpperCase(),
  };
}

export class FalPlatformClient {
  private readonly cfg: ResolvedFalConfig;
  private readonly openapiFallbackUrl: string | null;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(cfg: FalPlatformOptions) {
    this.cfg = resolveConfig(cfg);
    this.openapiFallbackUrl = cfg.openapiFallbackUrl === undefined ? FAL_OPENAPI_FALLBACK_URL : cfg.openapiFallbackUrl;
    this.retries = cfg.retries ?? 2;
    this.retryDelayMs = cfg.retryDelayMs ?? 500;
  }

  /** Eine Seite der Modellsuche. Ohne Key funktioniert die Suche ebenfalls (niedrigere Limits). */
  async listModels(p: ListModelsParams = {}): Promise<{ models: FalModelRecord[]; nextCursor: string | null }> {
    const url = new URL(`${this.cfg.platformBaseUrl}/models`);
    if (p.category) url.searchParams.set('category', p.category);
    if (p.q) url.searchParams.set('q', p.q);
    if (p.status) url.searchParams.set('status', p.status);
    if (p.limit !== undefined) url.searchParams.set('limit', String(Math.max(1, Math.floor(p.limit))));
    if (p.cursor) url.searchParams.set('cursor', p.cursor);
    const ids = p.endpointId === undefined ? [] : Array.isArray(p.endpointId) ? p.endpointId : [p.endpointId];
    for (const id of ids) url.searchParams.append('endpoint_id', id);
    if (p.expandOpenapi) url.searchParams.set('expand', 'openapi-3.0');
    const { data } = await requestJson(this.cfg, url.toString(), {
      context: 'fal-Modellsuche',
      auth: Boolean(this.cfg.apiKey),
      retries: this.retries,
      retryDelayMs: this.retryDelayMs,
    });
    const page = modelsPageSchema.parse(data && typeof data === 'object' ? data : {});
    const models = page.models.map(parseModelRecord).filter((m): m is FalModelRecord => m !== null);
    const nextCursor = page.has_more === false ? null : (page.next_cursor ?? null);
    return { models, nextCursor };
  }

  /** Alle Seiten (Cursor-Paginierung) mit Schutz vor Endlosschleifen; dedupliziert nach Endpoint-ID. */
  async listAllModels(p: Omit<ListModelsParams, 'cursor'> & { maxPages?: number } = {}): Promise<FalModelRecord[]> {
    const { maxPages = 100, ...params } = p;
    const byId = new Map<string, FalModelRecord>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const result = await this.listModels(cursor ? { ...params, cursor } : params);
      for (const model of result.models) if (!byId.has(model.endpointId)) byId.set(model.endpointId, model);
      if (!result.nextCursor || seenCursors.has(result.nextCursor)) break;
      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    return [...byId.values()];
  }

  /** Einheitspreise in Blöcken zu 50 IDs; abgelehnte Blöcke werden halbiert, damit eine unbekannte ID nicht alle anderen kostet. */
  async getPricing(endpointIds: string[]): Promise<FalPrice[]> {
    const unique = [...new Set(endpointIds.map((id) => id.trim()).filter(Boolean))];
    const result = new Map<string, FalPrice>();
    for (let i = 0; i < unique.length; i += PRICING_BATCH_SIZE) {
      for (const price of await this.fetchPriceBatch(unique.slice(i, i + PRICING_BATCH_SIZE))) result.set(price.endpointId, price);
    }
    return [...result.values()];
  }

  private async fetchPriceBatch(ids: string[]): Promise<FalPrice[]> {
    try {
      return await this.fetchPricePages(ids);
    } catch (error) {
      const rejected = error instanceof FalError && (error.code === 'validation' || error.code === 'not_found');
      if (!rejected) throw error;
      if (ids.length <= 1) return [];
      const mid = Math.ceil(ids.length / 2);
      return [...(await this.fetchPriceBatch(ids.slice(0, mid))), ...(await this.fetchPriceBatch(ids.slice(mid)))];
    }
  }

  private async fetchPricePages(ids: string[]): Promise<FalPrice[]> {
    const out: FalPrice[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const url = new URL(`${this.cfg.platformBaseUrl}/models/pricing`);
      url.searchParams.set('endpoint_id', ids.join(','));
      if (cursor) url.searchParams.set('cursor', cursor);
      const { data } = await requestJson(this.cfg, url.toString(), {
        context: 'fal-Preisabfrage',
        retries: this.retries,
        retryDelayMs: this.retryDelayMs,
      });
      const parsed = pricingPageSchema.parse(data && typeof data === 'object' ? data : {});
      for (const entry of parsed.prices) {
        const price = parsePriceEntry(entry);
        if (price) out.push(price);
      }
      cursor = parsed.has_more ? (parsed.next_cursor ?? null) : null;
      if (!cursor || seen.has(cursor)) break;
      seen.add(cursor);
    }
    return out;
  }

  /**
   * Kostenschätzung über fal. Einträge mit `unitQuantity` → `unit_price`, sonst `historical_api_price`
   * (Standard `callQuantity` 1). Gemischte Anfragen werden als zwei Aufrufe gesendet und summiert.
   * Hinweis: fal limitiert diesen Endpunkt stark (~1 Anfrage/s).
   */
  async estimate(req: EstimateRequest[]): Promise<{ totalUsd: number; raw: unknown }> {
    const unit: Record<string, { unit_quantity: number }> = {};
    const calls: Record<string, { call_quantity: number }> = {};
    for (const entry of req) {
      if (!entry.endpointId) continue;
      if (entry.unitQuantity !== undefined) {
        const prev = unit[entry.endpointId]?.unit_quantity ?? 0;
        unit[entry.endpointId] = { unit_quantity: prev + Math.max(0, entry.unitQuantity) };
      } else {
        const prev = calls[entry.endpointId]?.call_quantity ?? 0;
        calls[entry.endpointId] = { call_quantity: prev + Math.max(0, entry.callQuantity ?? 1) };
      }
    }
    const bodies: Array<{ estimate_type: string; endpoints: Record<string, unknown> }> = [];
    if (Object.keys(unit).length) bodies.push({ estimate_type: 'unit_price', endpoints: unit });
    if (Object.keys(calls).length) bodies.push({ estimate_type: 'historical_api_price', endpoints: calls });
    if (!bodies.length) return { totalUsd: 0, raw: null };
    const raws: unknown[] = [];
    let total = 0;
    for (const body of bodies) {
      const { data } = await requestJson(this.cfg, `${this.cfg.platformBaseUrl}/models/pricing/estimate`, {
        method: 'POST',
        body,
        context: 'fal-Kostenschätzung',
        retries: this.retries,
        retryDelayMs: Math.max(this.retryDelayMs, 1000),
      });
      const parsed = estimateResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new FalError('fal-Kostenschätzung lieferte keine gültige Summe (total_cost fehlt)', { code: 'bad_response', body: data });
      }
      if (parsed.data.currency && parsed.data.currency.toUpperCase() !== 'USD') {
        throw new FalError(`fal-Kostenschätzung in unerwarteter Währung ${parsed.data.currency}`, { code: 'bad_response', body: data });
      }
      total += parsed.data.total_cost;
      raws.push(data);
    }
    return { totalUsd: Math.round(total * 1e6) / 1e6, raw: raws.length === 1 ? raws[0] : raws };
  }

  /** OpenAPI-Dokument eines Endpoints (über `expand=openapi-3.0`, sonst öffentlicher Fallback). */
  async getOpenApi(endpointId: string): Promise<unknown> {
    const { models } = await this.listModels({ endpointId, expandOpenapi: true });
    const match = models.find((m) => m.endpointId === endpointId) ?? (models.length === 1 ? models[0] : undefined);
    if (match?.openapi && typeof match.openapi === 'object') return match.openapi;
    if (this.openapiFallbackUrl) {
      const url = new URL(this.openapiFallbackUrl);
      url.searchParams.set('endpoint_id', endpointId);
      try {
        const { data } = await requestJson(this.cfg, url.toString(), { context: 'OpenAPI-Abruf', auth: false });
        if (data && typeof data === 'object' && 'paths' in data) return data;
      } catch {
        // Fallback ist optional; unten folgt die eigentliche Fehlermeldung.
      }
    }
    if (!match) throw new FalError(`Modell „${endpointId}“ ist bei fal nicht bekannt`, { code: 'not_found', status: 404 });
    throw new FalError(`Kein OpenAPI-Schema für „${endpointId}“ verfügbar`, { code: 'not_found' });
  }
}
