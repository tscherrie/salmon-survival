import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  exampleCost,
  formatPrice,
  MODALITIES,
  MODALITY_LABELS,
  type Modality,
  type ModelCapabilities,
  type ModelInfo,
  modelMatchesModality,
} from '@studio/core';
import { z } from 'zod';
import { alsoModalitiesFor, deriveCapabilities, describeCapabilities, modalityForCategory } from './capabilities.ts';
import { type CostEstimate, type CostHints, estimateCostUsd } from './cost.ts';
import { FalError } from './errors.ts';
import type { FalModelRecord, FalPlatformClient, FalPrice } from './platform.ts';
import { describeSchema, extractInputSchema, isPlainObject, type JsonSchema } from './schema.ts';
import { SEED_MODELS } from './seed.ts';
import { type ValidationResult, validateInput } from './validate.ts';

/**
 * Modellkatalog für Picker und Director: Seed-Katalog offline, Live-Sync über die Plattform-API,
 * Cache als JSON-Datei (atomar geschrieben), Eingabeschemata je Endpoint (Speicher + Cache).
 */

export interface ModelRegistryOptions {
  platform?: FalPlatformClient;
  cacheFile?: string;
  now?: () => string;
  seed?: ModelInfo[];
}

export interface SyncOptions {
  categories?: string[];
  /** OpenAPI je Modell mitladen (Fähigkeiten aus dem Schema). Standard `true`. */
  expandOpenapi?: boolean;
  /** Max. Seiten je Kategorie. */
  maxPages?: number;
}

export interface SyncResult {
  count: number;
  updatedAt: string;
  /** Nicht fatale Probleme (z. B. Preise nicht abrufbar). */
  warnings?: string[];
}

/** fal-Kategorien, die auf Picker-Modalitäten abgebildet werden. */
export const DEFAULT_SYNC_CATEGORIES = [
  'text-to-image',
  'image-to-image',
  'text-to-video',
  'image-to-video',
  'video-to-video',
  'audio-to-video',
  'text-to-speech',
  'speech-to-speech',
  'text-to-audio',
  'audio-to-audio',
  'video-to-audio',
  'speech-to-text',
  'audio-to-text',
  'vision',
  'llm',
];

const CACHE_VERSION = 1;
const TAG_UNVERIFIED = 'preis-ungeprüft';

const cachedModelSchema = z.looseObject({
  id: z.string().min(1),
  provider: z.enum(['fal', 'anthropic']).catch('fal'),
  modality: z.enum(MODALITIES),
  displayName: z.string(),
  description: z.string().catch(''),
  capabilities: z.record(z.string(), z.unknown()).catch({}),
});

const cacheFileSchema = z.looseObject({
  version: z.number().optional(),
  updatedAt: z.string().nullable().optional().catch(null),
  models: z.array(z.unknown()).catch([]),
  schemas: z.record(z.string(), z.unknown()).optional().catch({}),
});

const STATUS_MAP: Record<string, ModelInfo['status']> = {
  active: 'active',
  beta: 'beta',
  preview: 'beta',
  experimental: 'beta',
  deprecated: 'deprecated',
  inactive: 'deprecated',
  disabled: 'deprecated',
};

/** Baut aus einem Plattform-Datensatz (+ Preis, + Schema) ein `ModelInfo`; `null` bei nicht unterstützter Kategorie. */
export function toModelInfo(record: FalModelRecord, price?: FalPrice, schema?: JsonSchema): ModelInfo | null {
  const modality = modalityForCategory(record.category, record.endpointId, record.tags);
  if (!modality) return null;
  const capabilities = schema ? deriveCapabilities(schema) : {};
  const info: ModelInfo = {
    id: record.endpointId,
    provider: 'fal',
    modality,
    displayName: record.displayName || record.endpointId,
    description: record.description,
    capabilities,
  };
  if (record.category) info.category = record.category;
  if (record.vendor) info.vendor = record.vendor;
  const also = alsoModalitiesFor(modality, capabilities);
  if (also) info.alsoModalities = also;
  const status = record.status ? STATUS_MAP[record.status.toLowerCase()] : undefined;
  if (status) info.status = status;
  if (price) info.price = { unitPrice: price.unitPrice, unit: price.unit, currency: price.currency };
  if (record.tags?.length) info.tags = [...record.tags];
  const meta = isPlainObject(record.raw) && isPlainObject(record.raw.metadata) ? record.raw.metadata : {};
  const license = meta.license_type ?? meta.license;
  if (typeof license === 'string' && license) info.license = license;
  return info;
}

function definedCaps(caps: ModelCapabilities): ModelCapabilities {
  return Object.fromEntries(Object.entries(caps).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as ModelCapabilities;
}

/** Live-Daten überschreiben den Seed; kuratierte Felder (Empfehlung, Modalität, Zusatzfähigkeiten) bleiben. */
export function mergeCurated(live: ModelInfo, curated: ModelInfo | undefined): ModelInfo {
  if (!curated) return live;
  const tags = [...new Set([...(curated.tags ?? []), ...(live.tags ?? [])])].filter((t) => !(live.price && t === TAG_UNVERIFIED));
  const also = [...new Set([...(curated.alsoModalities ?? []), ...(live.alsoModalities ?? [])])].filter((m) => m !== curated.modality);
  const merged: ModelInfo = {
    ...curated,
    ...Object.fromEntries(Object.entries(live).filter(([, v]) => v !== undefined)),
    modality: curated.modality,
    displayName: live.displayName && live.displayName !== live.id ? live.displayName : curated.displayName,
    description: live.description || curated.description,
    capabilities: { ...curated.capabilities, ...definedCaps(live.capabilities) },
    tags,
  } as ModelInfo;
  if (curated.vendor) merged.vendor = curated.vendor;
  const price = live.price ?? curated.price;
  if (price) merged.price = price;
  if (also.length) merged.alsoModalities = also;
  else delete merged.alsoModalities;
  if (curated.recommended) merged.recommended = true;
  return merged;
}

function compareModels(a: ModelInfo, b: ModelInfo): number {
  const rec = Number(Boolean(b.recommended)) - Number(Boolean(a.recommended));
  if (rec) return rec;
  const dep = Number(a.status === 'deprecated') - Number(b.status === 'deprecated');
  if (dep) return dep;
  return a.displayName.localeCompare(b.displayName, 'de', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capabilityPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return value > 0;
  return Boolean(value);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export class ModelRegistry {
  private readonly platform: FalPlatformClient | undefined;
  private readonly cacheFile: string | undefined;
  private readonly now: () => string;
  private readonly seedModels: Map<string, ModelInfo>;
  private models: Map<string, ModelInfo>;
  private readonly schemas = new Map<string, JsonSchema>();
  private readonly inflight = new Map<string, Promise<JsonSchema>>();
  private writeChain: Promise<void> = Promise.resolve();
  private _updatedAt: string | null = null;

  constructor(opts: ModelRegistryOptions = {}) {
    this.platform = opts.platform;
    this.cacheFile = opts.cacheFile;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.seedModels = new Map((opts.seed ?? SEED_MODELS).map((m) => [m.id, m]));
    this.models = new Map(this.seedModels);
  }

  /** Zeitpunkt des letzten erfolgreichen Syncs (`null` = nur Seed). */
  get updatedAt(): string | null {
    return this._updatedAt;
  }

  /** Lädt den Cache; fehlt er oder ist er beschädigt, gilt der Seed-Katalog. */
  async load(): Promise<void> {
    this.models = new Map(this.seedModels);
    this._updatedAt = null;
    if (!this.cacheFile) return;
    let text: string;
    try {
      text = await readFile(this.cacheFile, 'utf8');
    } catch {
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return; // beschädigter Cache → Seed; der nächste Sync überschreibt ihn
    }
    const parsed = cacheFileSchema.safeParse(json);
    if (!parsed.success) return;
    for (const raw of parsed.data.models) {
      const model = cachedModelSchema.safeParse(raw);
      if (!model.success) continue;
      const info = model.data as unknown as ModelInfo;
      this.models.set(info.id, mergeCurated(info, this.seedModels.get(info.id)));
    }
    for (const [id, schema] of Object.entries(parsed.data.schemas ?? {})) {
      if (isPlainObject(schema)) this.schemas.set(id, schema);
    }
    this._updatedAt = parsed.data.updatedAt ?? null;
  }

  /** Lädt den Live-Katalog (+ Preise, + Fähigkeiten aus OpenAPI) und schreibt den Cache. */
  async sync(opts: SyncOptions = {}): Promise<SyncResult> {
    const platform = this.requirePlatform('Katalog-Sync');
    const categories = opts.categories?.length ? opts.categories : DEFAULT_SYNC_CATEGORIES;
    const expandOpenapi = opts.expandOpenapi ?? true;
    const warnings: string[] = [];
    const records = new Map<string, FalModelRecord>();
    let failures = 0;
    for (const category of categories) {
      try {
        const list = await platform.listAllModels({ category, status: 'active', expandOpenapi, ...(opts.maxPages ? { maxPages: opts.maxPages } : {}) });
        for (const record of list) if (!records.has(record.endpointId)) records.set(record.endpointId, record);
      } catch (error) {
        if (error instanceof FalError && (error.code === 'unauthorized' || error.code === 'forbidden')) throw error;
        failures++;
        warnings.push(`Kategorie „${category}“ nicht geladen: ${(error as Error).message}`);
      }
    }
    if (failures === categories.length) throw new FalError(`Katalog-Sync fehlgeschlagen: ${warnings.join(' | ')}`, { code: 'network', retryable: true });

    let prices = new Map<string, FalPrice>();
    try {
      prices = new Map((await platform.getPricing([...records.keys()])).map((p) => [p.endpointId, p]));
    } catch (error) {
      if (error instanceof FalError && (error.code === 'unauthorized' || error.code === 'forbidden' || error.code === 'missing_key')) throw error;
      warnings.push(`Preise nicht geladen: ${(error as Error).message}`);
    }

    const next = new Map(this.seedModels);
    let count = 0;
    for (const record of records.values()) {
      let schema: JsonSchema | undefined;
      if (record.openapi) {
        try {
          schema = extractInputSchema(record.openapi, record.endpointId);
          this.schemas.set(record.endpointId, schema);
        } catch {
          schema = this.schemas.get(record.endpointId);
        }
      } else {
        schema = this.schemas.get(record.endpointId);
      }
      const live = toModelInfo(record, prices.get(record.endpointId), schema);
      if (!live) continue;
      const merged = mergeCurated(live, this.seedModels.get(live.id));
      if (!merged.price) {
        // Preis-API ohne Eintrag (oder ausgefallen): letzten bekannten Preis behalten.
        const previous = this.models.get(live.id)?.price;
        if (previous) merged.price = previous;
      }
      next.set(live.id, merged);
      count++;
    }
    this.models = next;
    this._updatedAt = this.now();
    await this.persist();
    return warnings.length ? { count, updatedAt: this._updatedAt, warnings } : { count, updatedAt: this._updatedAt };
  }

  /** Modelle einer Modalität (inkl. `alsoModalities`), Empfehlungen zuerst, dann nach Name. */
  list(modality?: Modality): ModelInfo[] {
    const all = [...this.models.values()];
    return (modality ? all.filter((m) => modelMatchesModality(m, modality)) : all).sort(compareModels);
  }

  get(id: string): ModelInfo | undefined {
    return this.models.get(id);
  }

  search(q: { modality?: Modality; text?: string; capabilities?: Partial<Record<keyof ModelCapabilities, boolean>> } = {}): ModelInfo[] {
    const terms = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const scored: Array<{ model: ModelInfo; score: number }> = [];
    for (const model of this.list(q.modality)) {
      const name = `${model.displayName} ${model.id}`.toLowerCase();
      const haystack = [name, model.description, model.vendor ?? '', model.category ?? '', ...(model.tags ?? []), ...describeCapabilities(model.capabilities)]
        .join(' ')
        .toLowerCase();
      if (!terms.every((t) => haystack.includes(t))) continue;
      let ok = true;
      for (const [key, wanted] of Object.entries(q.capabilities ?? {})) {
        if (wanted === undefined) continue;
        const present = capabilityPresent(model.capabilities[key as keyof ModelCapabilities]);
        if (present !== wanted) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      // Teilstring genügt (deutsche Komposita), Treffer am Wortanfang bzw. im Namen ranken höher.
      const wordStart = (text: string, term: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}`, 'u').test(text);
      const score =
        terms.reduce((sum, t) => sum + (name.includes(t) ? 2 : 0) + (wordStart(name, t) ? 2 : 0) + (wordStart(haystack, t) ? 1 : 0), 0) + (model.recommended ? 1 : 0);
      scored.push({ model, score });
    }
    return scored.sort((a, b) => b.score - a.score || compareModels(a.model, b.model)).map((s) => s.model);
  }

  /** Eingabeschema (Speicher → Cache → Plattform); reichert die Fähigkeiten des Modells an. */
  async getInputSchema(id: string): Promise<JsonSchema> {
    const cached = this.schemas.get(id);
    if (cached) return cached;
    const running = this.inflight.get(id);
    if (running) return running;
    const task = (async () => {
      const platform = this.requirePlatform(`Schema für „${id}“`);
      const openapi = await platform.getOpenApi(id);
      const schema = extractInputSchema(openapi, id);
      this.schemas.set(id, schema);
      const model = this.models.get(id);
      if (model) {
        const derived = definedCaps(deriveCapabilities(schema));
        const capabilities = { ...model.capabilities, ...derived };
        const updated: ModelInfo = { ...model, capabilities };
        const also = alsoModalitiesFor(model.modality, capabilities);
        if (also && !model.alsoModalities?.length) updated.alsoModalities = also;
        this.models.set(id, updated);
      }
      await this.persist();
      return schema;
    })();
    this.inflight.set(id, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(id);
    }
  }

  /** Kopf (Name, Preis, Fähigkeiten, Beschreibung) + Parameterliste. Schemafehler werden als Hinweis ausgegeben. */
  async describe(id: string): Promise<string> {
    const model = this.models.get(id);
    const lines: string[] = [];
    if (model) {
      lines.push(`${model.displayName} (${model.id})${model.vendor ? ` · ${model.vendor}` : ''}`);
      const meta = [`Modalität: ${MODALITY_LABELS[model.modality]}`];
      if (model.category) meta.push(`Kategorie: ${model.category}`);
      if (model.status && model.status !== 'active') meta.push(`Status: ${model.status}`);
      if (model.recommended) meta.push('empfohlen');
      lines.push(meta.join(' · '));
      const example = exampleCost(model);
      lines.push(`Preis: ${formatPrice(model.price)}${example ? ` · Beispiel: ${example}` : ''}`);
      const caps = describeCapabilities(model.capabilities);
      if (caps.length) lines.push(`Fähigkeiten: ${caps.join(', ')}`);
      if (model.license) lines.push(`Lizenz: ${model.license}`);
      if (model.description) lines.push(`Beschreibung: ${model.description}`);
      if (model.tags?.length) lines.push(`Tags: ${model.tags.join(', ')}`);
    } else {
      lines.push(`${id} (nicht im Katalog)`);
    }
    lines.push('');
    try {
      lines.push(describeSchema(await this.getInputSchema(id)));
    } catch (error) {
      lines.push(`Eingabeschema nicht verfügbar: ${(error as Error).message}`);
    }
    return lines.join('\n');
  }

  async validate(id: string, input: unknown): Promise<ValidationResult> {
    return validateInput(await this.getInputSchema(id), input);
  }

  /** Lokale Kostenschätzung; unbekanntes Modell → Fehler. */
  async estimate(id: string, input: Record<string, unknown>, hints?: CostHints): Promise<CostEstimate> {
    const model = this.models.get(id);
    if (!model) throw new Error(`Unbekanntes Modell „${id}“ – keine Kostenschätzung möglich`);
    return estimateCostUsd(model, isPlainObject(input) ? input : {}, hints);
  }

  private requirePlatform(what: string): FalPlatformClient {
    if (!this.platform) throw new Error(`${what}: kein fal-Plattform-Client konfiguriert`);
    return this.platform;
  }

  /** Schreibt den Cache seriell (letzter Stand gewinnt). */
  private persist(): Promise<void> {
    const file = this.cacheFile;
    if (!file) return Promise.resolve();
    const run = async () => {
      const payload = {
        version: CACHE_VERSION,
        updatedAt: this._updatedAt,
        models: [...this.models.values()],
        schemas: Object.fromEntries(this.schemas),
      };
      await writeJsonAtomic(file, payload);
    };
    const next = this.writeChain.then(run, run);
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}
