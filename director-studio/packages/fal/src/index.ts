/**
 * @studio/fal – fal.ai-Anbindung: Plattform-API (Katalog, Preise, Schätzung), Registry mit Fähigkeiten aus OpenAPI,
 * Schema-Validierung, Kostenschätzung, Queue-Runner, Storage-Upload, Ergebnis-Ingest und Transkript-Normalisierung.
 */
import type { FalConfig } from './config.ts';
import { FalPlatformClient, type FalPlatformOptions } from './platform.ts';
import { FalQueueClient, type FalQueueOptions } from './queue.ts';
import { ModelRegistry } from './registry.ts';
import { FalStorage, type FalStorageOptions } from './storage.ts';

export * from './config.ts';
export * from './errors.ts';
export { readBody, requestJson, sleep, withQuery, type HttpResult, type RequestOptions } from './http.ts';
export * from './platform.ts';
export * from './schema.ts';
export * from './validate.ts';
export * from './capabilities.ts';
export * from './cost.ts';
export * from './seed.ts';
export * from './registry.ts';
export * from './queue.ts';
export * from './storage.ts';
export * from './outputs.ts';
export * from './transcript.ts';

export interface FalServicesConfig extends FalConfig {
  /** Pfad der Katalog-Cache-Datei (App-Datenordner). */
  cacheFile?: string;
  /** Queue: Payload-Speicherung bei fal erlauben (Standard `false`). */
  storeIo?: boolean;
  /** Lebensdauer erzeugter/hochgeladener Dateien bei fal in Sekunden. */
  objectLifecycleSeconds?: number;
}

export interface FalServices {
  platform: FalPlatformClient;
  registry: ModelRegistry;
  queue: FalQueueClient;
  storage: FalStorage;
}

/** Verdrahtet alle Clients mit einer Konfiguration. `registry.load()` muss der Aufrufer noch ausführen. */
export function createFalServices(cfg: FalServicesConfig): FalServices {
  const { cacheFile, storeIo, objectLifecycleSeconds, ...base } = cfg;
  const platform = new FalPlatformClient(base satisfies FalPlatformOptions);
  const queueOptions: FalQueueOptions = { ...base };
  if (storeIo !== undefined) queueOptions.storeIo = storeIo;
  if (objectLifecycleSeconds !== undefined) queueOptions.objectLifecycleSeconds = objectLifecycleSeconds;
  const storageOptions: FalStorageOptions = { ...base };
  if (objectLifecycleSeconds !== undefined) storageOptions.objectLifecycleSeconds = objectLifecycleSeconds;
  const registry = new ModelRegistry(cacheFile ? { platform, cacheFile } : { platform });
  return { platform, registry, queue: new FalQueueClient(queueOptions), storage: new FalStorage(storageOptions) };
}
