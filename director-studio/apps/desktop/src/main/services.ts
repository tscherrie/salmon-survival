import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  clipAssetIds,
  CLAUDE_MODELS,
  modelMatchesModality,
  type Asset,
  type Deck,
  type Modality,
  type ModelInfo,
  type Timeline,
} from '@studio/core';
import type { CostEstimate, GenerationPort, MediaPort, ModelCatalogPort, RenderPort, SiteViewport, TranscribePort } from '@studio/director';
import { createFalServices, downloadToFile, extractMediaOutputs, normalizeTranscript, type FalServices } from '@studio/fal';
import type { MediaToolkit } from '@studio/media';
import type { ProjectStore } from '@studio/project';
import type { AssetMedia, MediaErrorInfo } from '@studio/render/browser';

/** Standard-Modell für Push-to-Talk und das `transcribe`-Tool (Wortzeitstempel, Deutsch). */
export const DEFAULT_STT_ENDPOINT = 'fal-ai/elevenlabs/speech-to-text/scribe-v2';

export class MissingKeyError extends Error {
  constructor(what: string) {
    super(what);
    this.name = 'MissingKeyError';
  }
}

// ───────────────────────── Modellkatalog (fal + Claude) ─────────────────────────

/** Katalog für Picker und Director: Claude-Modelle (Director/Text) + fal-Registry. */
export class CombinedCatalog implements ModelCatalogPort {
  constructor(private readonly fal: () => FalServices) {}

  list(modality?: Modality): ModelInfo[] {
    const claude = CLAUDE_MODELS.filter((m) => !modality || modelMatchesModality(m, modality));
    const falModels = modality === 'director' ? [] : this.fal().registry.list(modality);
    return [...claude, ...falModels];
  }

  get(id: string): ModelInfo | undefined {
    return CLAUDE_MODELS.find((m) => m.id === id) ?? this.fal().registry.get(id);
  }

  search(q: { modality?: Modality; text?: string }): ModelInfo[] {
    const text = q.text?.toLowerCase().trim();
    const claude = CLAUDE_MODELS.filter(
      (m) => (!q.modality || modelMatchesModality(m, q.modality)) && (!text || `${m.id} ${m.displayName} ${m.description}`.toLowerCase().includes(text)),
    );
    return [...claude, ...this.fal().registry.search(q)];
  }

  describe(id: string): Promise<string> {
    const claude = CLAUDE_MODELS.find((m) => m.id === id);
    if (claude) return Promise.resolve(`${claude.displayName} (${claude.vendor}): ${claude.description}`);
    return this.fal().registry.describe(id);
  }

  getInputSchema(id: string): Promise<Record<string, unknown>> {
    return this.fal().registry.getInputSchema(id);
  }

  validate(id: string, input: unknown): Promise<{ ok: boolean; errors: string[] }> {
    return this.fal().registry.validate(id, input);
  }

  estimate(id: string, input: unknown): Promise<CostEstimate> {
    return this.fal().registry.estimate(id, (input ?? {}) as Record<string, unknown>);
  }
}

// ───────────────────────── fal-Dienste ─────────────────────────

/** Hält die fal-Clients; ohne Key funktionieren Katalog (Seed/Cache) und Schätzungen, Generierung nicht. */
export class FalHub {
  private services: FalServices | null = null;
  private keyValue: string | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly cacheFile: string) {}

  /** Setzt den Key; die Clients werden neu erzeugt, der Katalog-Cache bleibt. */
  setKey(key: string | null): void {
    if (key === this.keyValue && this.services) return;
    this.keyValue = key;
    this.services = null;
    this.loading = null;
  }

  get hasKey(): boolean {
    return Boolean(this.keyValue);
  }

  get(): FalServices {
    // Ohne Key bekommt der Client einen Platzhalter; Aufrufe der Plattform scheitern dann mit 401.
    this.services ??= createFalServices({ apiKey: this.keyValue ?? '', cacheFile: this.cacheFile });
    return this.services;
  }

  /** Lädt den Katalog (Cache bzw. Seed) einmalig. */
  async ready(): Promise<FalServices> {
    const services = this.get();
    this.loading ??= services.registry.load();
    await this.loading;
    return services;
  }

  requireKey(): FalServices {
    if (!this.keyValue) throw new MissingKeyError('Kein fal-Key hinterlegt – bitte in den Einstellungen eintragen.');
    return this.get();
  }

  generationPort(): GenerationPort {
    const hub = this;
    return {
      async run(endpointId, input, opts) {
        const { queue } = hub.requireKey();
        const result = await queue.run(endpointId, input, opts);
        return { output: result.output, ...(result.billableUnits !== undefined ? { billableUnits: result.billableUnits } : {}) };
      },
      async resume(handle, opts) {
        const { queue } = hub.requireKey();
        // Mit abgerechneten Einheiten, damit auch wiederaufgenommene Jobs zu exakten Kosten gebucht werden.
        const result = await queue.resumeWithMeta(handle, opts);
        return { output: result.output, ...(result.billableUnits !== undefined ? { billableUnits: result.billableUnits } : {}) };
      },
      uploadFile(path, contentType) {
        return hub.requireKey().storage.uploadFile(path, contentType);
      },
      extractMediaOutputs: (result) => extractMediaOutputs(result),
      download: (url, destDir) => downloadToFile(url, destDir),
    };
  }

  transcribePort(endpoint = DEFAULT_STT_ENDPOINT): TranscribePort {
    const hub = this;
    return {
      async transcribe(path, opts) {
        const { queue, storage } = hub.requireKey();
        const audioUrl = await storage.uploadFile(path);
        const input: Record<string, unknown> = { audio_url: audioUrl };
        if (opts?.language && endpoint.includes('whisper')) input.language = opts.language;
        const { output } = await queue.run(endpoint, input, {});
        return normalizeTranscript(output);
      },
    };
  }
}

// ───────────────────────── Rendering ─────────────────────────

export interface RenderServiceOptions {
  workDir: string;
  /** Chromium-Headless-Shell passend zu Electrons Chromium (sonst `STUDIO_CHROMIUM_PATH`). */
  browserExecutable?: string | undefined;
  /** Quelltext-Einstieg der Remotion-Komposition (`@studio/render/browser`); Standard: Modulauflösung. */
  browserEntry?: string | undefined;
  /**
   * Ausgelieferte App: Fehlt ein Chromium (`STUDIO_CHROMIUM_PATH`), lädt Remotion beim ersten Rendern seine
   * Headless-Shell (einmalig, in den Arbeitsordner der App) und Playwright (Folien, Leinwand, Screenshots) nutzt
   * dieselbe Datei. In der Entwicklung bleibt es bei Playwrights eigenem Browser.
   */
  provisionChromium?: boolean | undefined;
  /** Für Tests: Ersatz für Remotions `ensureBrowser` (liefert den Pfad zur Headless-Shell). */
  ensureBrowser?: (() => Promise<string | undefined>) | undefined;
}

/** Findet `packages/render/src/browser.ts` (das Remotion-Bündel kompiliert die Komposition aus den Quellen). */
export function resolveRenderBrowserEntry(): string | undefined {
  if (process.env.STUDIO_RENDER_BROWSER_ENTRY) return process.env.STUDIO_RENDER_BROWSER_ENTRY;
  try {
    return createRequire(import.meta.url).resolve('@studio/render/browser');
  } catch {
    return undefined;
  }
}

type RenderModule = typeof import('@studio/render');

/** Lädt `@studio/render` (Remotion, Playwright) erst bei Bedarf – der App-Start bleibt schnell. */
export class RenderService {
  private module: Promise<RenderModule> | null = null;
  private renderer: InstanceType<RenderModule['TimelineRenderer']> | null = null;
  private chromium: Promise<string | undefined> | null = null;

  constructor(private readonly options: RenderServiceOptions) {}

  /**
   * Sorgt für ein Chromium vor Renderings im Browser. Mit ausdrücklichem Pfad (Option oder `STUDIO_CHROMIUM_PATH`)
   * oder ohne `provisionChromium` passiert nichts. Sonst wird die Headless-Shell über Remotion bereitgestellt
   * (Download nur beim ersten Mal) und als `STUDIO_CHROMIUM_PATH` für Remotion und Playwright gesetzt.
   */
  async ensureChromium(): Promise<string | undefined> {
    const explicit = this.options.browserExecutable || process.env.STUDIO_CHROMIUM_PATH;
    if (explicit) return explicit;
    if (!this.options.provisionChromium) return undefined;
    this.chromium ??= (async () => {
      let path: string | undefined;
      try {
        path = this.options.ensureBrowser ? await this.options.ensureBrowser() : await remotionHeadlessShell();
      } catch (error) {
        throw new Error(`Chromium für das Rendern konnte nicht geladen werden (einmalig ca. 100 MB, Internetverbindung nötig): ${(error as Error).message}`);
      }
      if (!path) throw new Error('Chromium für das Rendern ist nicht verfügbar');
      process.env.STUDIO_CHROMIUM_PATH = path;
      return path;
    })();
    this.chromium.catch(() => {
      this.chromium = null;
    });
    return this.chromium;
  }

  load(): Promise<RenderModule> {
    this.module ??= import('@studio/render');
    return this.module;
  }

  async timelineRenderer(): Promise<InstanceType<RenderModule['TimelineRenderer']>> {
    await this.ensureChromium();
    const mod = await this.load();
    this.renderer ??= new mod.TimelineRenderer({
      workDir: join(this.options.workDir, 'remotion'),
      ...(this.options.browserExecutable ? { browserExecutable: this.options.browserExecutable } : {}),
      componentMode: 'inputProps',
      browserEntry: this.options.browserEntry ?? resolveRenderBrowserEntry(),
    });
    return this.renderer;
  }

  /** Asset-Medien einer Timeline als file://-URLs (der Renderer liefert sie über einen lokalen Server aus). */
  timelineAssets(store: ProjectStore, timeline: Timeline): Record<string, AssetMedia> {
    const out: Record<string, AssetMedia> = {};
    const ids = new Set<string>();
    // `assetId` plus Asset-Referenzen in den Props (`rotoscope`, `…Asset`, `…AssetId`, auch im Übergang).
    for (const track of timeline.tracks) for (const clip of track.clips) for (const id of clipAssetIds(clip)) ids.add(id);
    for (const id of ids) {
      const asset = store.getAsset(id);
      const file = asset && store.assetFilePath(asset);
      if (!asset || !file) continue;
      out[id] = toAssetMedia(asset, pathToFileURL(file).href);
    }
    return out;
  }

  /** Quelltexte der registrierten Director-Komponenten. */
  async componentSources(store: ProjectStore, timeline: Timeline): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [componentId, ref] of Object.entries(timeline.components)) {
      try {
        out[componentId] = await store.readAssetText(ref.assetId);
      } catch {
        // fehlende Komponente → Platzhalter im Render
      }
    }
    return out;
  }

  /**
   * Fehlende oder defekte Medien lässt der Renderer aus und meldet sie über `onMediaError` (das Rendern läuft weiter).
   */
  async renderTimelineStill(
    store: ProjectStore,
    input: { frame: number; formatId?: string | undefined; out: string; scale?: number; onMediaError?: ((info: MediaErrorInfo) => void) | undefined },
  ): Promise<string> {
    const doc = await requireDocument(store, 'timeline');
    const renderer = await this.timelineRenderer();
    await mkdir(dirname(input.out), { recursive: true });
    return renderer.renderStill({
      timeline: doc,
      assets: this.timelineAssets(store, doc),
      componentCodes: await this.componentSources(store, doc),
      frame: Math.max(0, Math.min(input.frame, Math.max(0, doc.durationFrames - 1))),
      out: input.out,
      ...(input.formatId ? { formatId: input.formatId } : {}),
      ...(input.scale ? { scale: input.scale } : {}),
      ...(input.onMediaError ? { onMediaError: input.onMediaError } : {}),
    });
  }

  async renderTimelineVideo(
    store: ProjectStore,
    input: {
      out: string;
      formatId?: string | undefined;
      frameRange?: [number, number];
      scale?: number;
      signal?: AbortSignal;
      onProgress?: (p: number) => void;
      onMediaError?: ((info: MediaErrorInfo) => void) | undefined;
    },
  ): Promise<string> {
    const doc = await requireDocument(store, 'timeline');
    const renderer = await this.timelineRenderer();
    await mkdir(dirname(input.out), { recursive: true });
    return renderer.renderVideo({
      timeline: doc,
      assets: this.timelineAssets(store, doc),
      componentCodes: await this.componentSources(store, doc),
      out: input.out,
      ...(input.formatId ? { formatId: input.formatId } : {}),
      ...(input.frameRange ? { frameRange: input.frameRange } : {}),
      ...(input.scale ? { scale: input.scale } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      ...(input.onMediaError ? { onMediaError: input.onMediaError } : {}),
    });
  }

  async renderDocumentPng(store: ProjectStore, input: { slideId?: string | undefined; out: string }): Promise<string> {
    const doc = await store.getDocument();
    if (!doc) throw new Error('Das Projekt hat noch kein Dokument');
    if (doc.kind === 'deck' || doc.kind === 'canvas') await this.ensureChromium();
    const mod = await this.load();
    const assetUrl = (id: string) => assetFileUrl(store, id);
    await mkdir(dirname(input.out), { recursive: true });
    if (doc.kind === 'deck') {
      const slideId = input.slideId ?? doc.slides[0]?.id;
      if (!slideId) throw new Error('Das Deck hat noch keine Folien');
      const tmp = join(dirname(input.out), `.render-${Date.now()}`);
      const { pngs } = await mod.renderDeck(doc, { assetUrl, outDir: tmp, formats: ['png'], slideIds: [slideId] });
      const first = pngs[0];
      if (!first) throw new Error('Folie konnte nicht gerendert werden');
      await writeFile(input.out, await readFile(first));
      return input.out;
    }
    if (doc.kind === 'canvas') {
      return mod.renderCanvas(doc, { assetUrl, out: input.out, format: 'png' });
    }
    if (doc.kind === 'timeline') return this.renderTimelineStill(store, { frame: 0, out: input.out });
    throw new Error('Für Websites bitte screenshot_site verwenden');
  }

  async screenshotSite(url: string, input: { viewports: SiteViewport[]; outDir: string; path?: string | undefined }) {
    await this.ensureChromium();
    const mod = await this.load();
    const target = input.path ? new URL(input.path, url).href : url;
    const result = await mod.screenshotSite(target, { viewports: input.viewports, outDir: input.outDir });
    return {
      shots: result.shots.map((s) => ({ viewport: s.viewport, path: s.path })),
      consoleErrors: result.consoleErrors,
      pageErrors: result.pageErrors,
    };
  }

  async close(): Promise<void> {
    await this.renderer?.close?.();
    this.renderer = null;
    if (this.module) await (await this.module).closeDefaultBrowserPool();
  }
}

/** Remotions Headless-Shell (lädt sie beim ersten Aufruf herunter; Zielordner hängt vom Arbeitsordner ab). */
async function remotionHeadlessShell(): Promise<string | undefined> {
  const { ensureBrowser } = await import('@remotion/renderer');
  const status = await ensureBrowser({ logLevel: 'error', chromeMode: 'headless-shell' });
  return 'path' in status ? status.path : undefined;
}

export function toAssetMedia(asset: Asset, url: string): AssetMedia {
  return {
    id: asset.id,
    kind: asset.kind,
    url,
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
    ...(asset.durationMs ? { durationMs: asset.durationMs } : {}),
    ...(asset.fps ? { fps: asset.fps } : {}),
  };
}

export function assetFileUrl(store: ProjectStore, assetId: string): string {
  const asset = store.getAsset(assetId);
  const file = asset && store.assetFilePath(asset);
  return file ? pathToFileURL(file).href : '';
}

export async function requireDocument<K extends 'timeline' | 'deck'>(store: ProjectStore, kind: K): Promise<K extends 'timeline' ? Timeline : Deck> {
  const doc = await store.getDocument();
  if (!doc || doc.kind !== kind) throw new Error(`Diese Aktion braucht ein Dokument vom Typ „${kind}“`);
  return doc as K extends 'timeline' ? Timeline : Deck;
}

// ───────────────────────── abgeleitete Medien (Thumbnails, Proxies, Peaks) ─────────────────────────

/** Erzeugt Vorschaumedien im Ordner `assets/derived/<assetId>/` und merkt sie im Asset-Metadatum. */
export class DerivedMedia {
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(private readonly media: () => MediaToolkit) {}

  thumbPath(store: ProjectStore, asset: Asset): Promise<string | null> {
    if (asset.kind === 'image') return Promise.resolve(store.assetFilePath(asset) ?? null);
    if (asset.kind !== 'video') return Promise.resolve(null);
    return this.once(`${store.manifest.id}:${asset.id}:thumb`, async () => {
      const out = join(store.derivedDir(asset.id), 'thumb.jpg');
      if (await fileExists(out)) return out;
      const src = store.assetFilePath(asset);
      if (!src) return null;
      await mkdir(dirname(out), { recursive: true });
      const at = asset.durationMs ? Math.min(1, asset.durationMs / 2000) : 0;
      await this.media().thumbnail(src, out, { atSec: at, width: 480 });
      return out;
    });
  }

  proxyPath(store: ProjectStore, asset: Asset): Promise<string | null> {
    if (asset.kind !== 'video') return Promise.resolve(null);
    return this.once(`${store.manifest.id}:${asset.id}:proxy`, async () => {
      const out = join(store.derivedDir(asset.id), 'proxy.mp4');
      if (await fileExists(out)) return out;
      const src = store.assetFilePath(asset);
      if (!src) return null;
      await mkdir(dirname(out), { recursive: true });
      await this.media().proxy(src, out, { height: 540 });
      return out;
    });
  }

  async peaks(store: ProjectStore, asset: Asset): Promise<{ peaks: number[]; durationMs: number } | null> {
    if (asset.kind !== 'audio' && asset.kind !== 'video') return null;
    const out = join(store.derivedDir(asset.id), 'peaks.json');
    if (await fileExists(out)) return JSON.parse(await readFile(out, 'utf8')) as { peaks: number[]; durationMs: number };
    const src = store.assetFilePath(asset);
    if (!src) return null;
    const result = await this.once(`${store.manifest.id}:${asset.id}:peaks`, async () => {
      const data = await this.media().peaks(src, { points: 2000 });
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(data));
      return out;
    });
    return result ? (JSON.parse(await readFile(result, 'utf8')) as { peaks: number[]; durationMs: number }) : null;
  }

  /** Probe-Daten (Dauer, Größe) ins Asset übernehmen, falls noch nicht vorhanden. */
  async enrich(store: ProjectStore, asset: Asset): Promise<Asset> {
    if (asset.kind !== 'video' && asset.kind !== 'audio' && asset.kind !== 'image') return asset;
    if (asset.durationMs !== undefined && (asset.kind === 'audio' || asset.width)) return asset;
    const src = store.assetFilePath(asset);
    if (!src) return asset;
    try {
      const info = await this.media().probe(src);
      return await store.updateAsset(asset.id, {
        ...(info.durationMs ? { durationMs: info.durationMs } : {}),
        ...(info.width ? { width: info.width } : {}),
        ...(info.height ? { height: info.height } : {}),
        ...(info.fps ? { fps: info.fps } : {}),
      });
    } catch {
      return asset;
    }
  }

  private once(key: string, fn: () => Promise<string | null>): Promise<string | null> {
    let p = this.inflight.get(key);
    if (!p) {
      p = fn().catch(() => null).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

/** RenderPort des Directors für ein Projekt (bindet Projekt/Dokument und Vorschau-Server). */
export function renderPortFor(
  store: ProjectStore,
  render: RenderService,
  options: { siteUrl: () => Promise<string>; exportProject: (target: string) => Promise<{ path: string }> },
): RenderPort {
  return {
    async compileComponent(source, opts) {
      const mod = await render.load();
      return mod.compileComponent(source, opts);
    },
    // Ausgelassene Medien gehen an das Tool zurück (es nennt sie im Ergebnis), nicht nur ins Log.
    renderTimelineStill: (input) => render.renderTimelineStill(store, input),
    renderTimelinePreview: (input) =>
      render.renderTimelineVideo(store, {
        out: input.out,
        formatId: input.formatId,
        frameRange: [input.fromFrame, input.toFrame],
        scale: input.scale ?? 0.5,
        onMediaError: input.onMediaError,
      }),
    renderDocumentPng: (input) => render.renderDocumentPng(store, input),
    screenshotSite: async (input) => render.screenshotSite(await options.siteUrl(), input),
    exportProject: (target) => options.exportProject(target),
  };
}

/** MediaToolkit erfüllt den MediaPort des Directors direkt. */
export function mediaPortFor(media: MediaToolkit): MediaPort {
  return media as unknown as MediaPort;
}
