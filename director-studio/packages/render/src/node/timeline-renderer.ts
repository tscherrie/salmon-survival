import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChromiumOptions } from '@remotion/renderer';
import { clipPropAssetRefs, type Timeline } from '@studio/core';
import { computeCompositionMeta } from '../composition/meta.ts';
import type { AssetMedia, MediaErrorInfo, TimedWord } from '../composition/types.ts';
import { resolveChromiumExecutable } from './chromium.ts';
import { compileComponent, isCompiledComponent } from './compile.ts';
import { localPathOf, probeMedia } from './media-probe.ts';
import { AssetFileServer } from './static-server.ts';

/**
 * Server-Rendering der Timeline mit Remotion (Render-Worker, Node).
 *
 * Ablauf:
 * 1. `bundle(componentCodes)` erzeugt in `workDir/bundles/<hash>/` eine Einstiegsdatei
 *    (`registerRoot` + `<Composition>` mit `calculateMetadata` aus den inputProps), bettet die
 *    übersetzten Director-Komponenten als Strings ein und bündelt mit `@remotion/bundler`. Das Bündel
 *    wird über den Hash der Komponenten-Codes (+ Paketversion) zwischengespeichert.
 * 2. `renderStill`/`renderVideo` wählen die Komposition (`selectComposition`) und rendern mit
 *    `@remotion/renderer` über die Chromium-Headless-Shell (`browserExecutable`).
 *
 * Assets: Lokale Dateien (Pfad oder `file://`) werden über einen kleinen HTTP-Server auf 127.0.0.1
 * mit zufälligem Token-Pfad und Range-Unterstützung bereitgestellt (OffthreadVideo/Img laden per HTTP);
 * `http(s)://`-URLs bleiben unverändert. Kein Kopieren in Remotions `public/`.
 *
 * Ton: Videos werden STUMM gerendert (`muted`); ffmpeg mischt den Ton separat.
 *
 * Kaputte Medien: Bild-/Video-Assets sichtbarer Clips werden vorab geprüft (`probeMedia`: Datei da,
 * Signatur passt zur Art, MP4 vollständig mit Videospur). Defekte bekommen `error` und werden von der
 * Komposition ausgelassen; Laufzeitfehler fängt die Komposition selbst ab. Beides meldet `onMediaError`
 * (aus den Browser-Logs `[studio:media-error]`) – das Rendern läuft weiter.
 */

export const COMPOSITION_ID = 'StudioTimeline';
const RENDER_PACKAGE_VERSION = '0.1.1';
const MEDIA_ERROR_PREFIX = '[studio:media-error]';
const COMPONENT_ERROR_PREFIX = '[studio:component-error]';

export interface TimelineRendererOptions {
  /** Chromium-Headless-Shell (sonst `STUDIO_CHROMIUM_PATH`, sonst Remotions eigener Download). */
  browserExecutable?: string;
  /** Arbeitsverzeichnis für Einstiegsdateien, Bündel und Caches. */
  workDir: string;
  /** Parallele Frames bei `renderVideo` (Standard: Remotion-Standard). */
  concurrency?: number;
  /** Chromium-Optionen (Standard: `{ gl: 'swangle' }` unter Linux). */
  chromiumOptions?: ChromiumOptions;
  /** Remotion-Loglevel (Standard `error`). */
  logLevel?: 'verbose' | 'info' | 'warn' | 'error';
  /**
   * `bundle` (Standard): Komponenten-Code wird ins Bündel eingebettet (Cache je Code-Hash).
   * `inputProps`: ein Basis-Bündel ohne Komponenten; der Code reist in den inputProps mit
   * (kein Neubündeln bei jeder Komponentenänderung – schneller für Director-QA-Schleifen).
   */
  componentMode?: 'bundle' | 'inputProps';
  /** Bei Komponentenfehlern im Browser-Log das Rendern abbrechen (Standard: true). */
  failOnComponentError?: boolean;
  /** Zeitlimit je Frame in ms (Remotion `timeoutInMilliseconds`, Standard 30000). */
  timeoutMs?: number;
  /**
   * Pfad zu `browser.ts` dieses Pakets (Quelltext, den das Remotion-Bündel einbindet). Standard: neben
   * diesem Modul bzw. `STUDIO_RENDER_BROWSER_ENTRY`. Nötig, wenn dieses Modul in ein anderes Bündel
   * (z. B. Electron-Main) eingebettet ist und `import.meta.url` nicht mehr auf die Paketquellen zeigt.
   */
  browserEntry?: string;
  /** Bild-/Video-Assets vor dem Rendern prüfen und defekte auslassen (Standard: true). */
  probeMedia?: boolean;
}

export interface RenderInputBase {
  timeline: Timeline;
  assets: Record<string, AssetMedia>;
  /** Komponenten-ID → TSX-Quelltext oder bereits übersetzter Code (`compileComponent`). */
  componentCodes?: Record<string, string>;
  formatId?: string;
  words?: TimedWord[];
  /** Sprache der Texte (Standard `de`). */
  lang?: string;
  /**
   * Fehlende/defekte Medien (je Clip und Medium einmal). Das Medium wird ausgelassen, das Rendern läuft
   * weiter. Wird während des Renderns aufgerufen.
   */
  onMediaError?: (info: MediaErrorInfo) => void;
}

export interface RenderStillInput extends RenderInputBase {
  frame: number;
  out: string;
  /** Pixel-Faktor (Standard 1). */
  scale?: number;
}

export interface RenderVideoInput extends RenderInputBase {
  out: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  codec?: 'h264' | 'h265' | 'prores';
  /** Nur einen Bereich rendern (Frames, inklusiv). */
  frameRange?: [number, number];
  /** Qualität (CRF) für h264/h265. */
  crf?: number;
  /** Pixel-Faktor (z. B. 0.5 für schnelle Vorschau-Renderings). */
  scale?: number;
}

type RendererModule = typeof import('@remotion/renderer');
type BundlerModule = typeof import('@remotion/bundler');
type HeadlessBrowser = Awaited<ReturnType<RendererModule['openBrowser']>>;

const require = createRequire(import.meta.url);
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fingerprints = new Map<string, string>();

/**
 * Fingerabdruck der Browser-Quellen (alle `.ts`/`.tsx` neben `browser.ts`, ohne `node/`): Ändert sich die
 * Komposition, wird neu gebündelt statt ein veraltetes Bündel aus dem Cache zu nehmen.
 */
function sourceFingerprint(entry: string): string {
  const dir = path.dirname(entry);
  const cached = fingerprints.get(dir);
  if (cached) return cached;
  const hash = createHash('sha256');
  const walk = (d: string) => {
    let names: string[];
    try {
      names = readdirSync(d).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(d, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (name !== 'node' && name !== 'node_modules') walk(full);
      } else if (/\.(?:ts|tsx)$/.test(name)) {
        hash.update(path.relative(dir, full)).update('\0');
        try {
          hash.update(readFileSync(full));
        } catch {
          // nicht lesbar: nur der Name zählt
        }
      }
    }
  };
  walk(dir);
  const value = hash.digest('hex').slice(0, 16);
  fingerprints.set(dir, value);
  return value;
}

/** Sammelt Komponenten- und Medienfehler aus den Browser-Logs eines Render-Laufs. */
class LogCollector {
  readonly componentErrors: string[] = [];
  private readonly seenMedia = new Set<string>();

  constructor(private readonly onMediaError: ((info: MediaErrorInfo) => void) | undefined) {}

  readonly onBrowserLog = (log: { text: string; type: string }) => {
    const c = log.text.indexOf(COMPONENT_ERROR_PREFIX);
    if (c >= 0) {
      try {
        const info = JSON.parse(log.text.slice(c + COMPONENT_ERROR_PREFIX.length).trim()) as { componentId: string; clipId: string; message: string };
        this.componentErrors.push(`Komponente „${info.componentId}“ (Clip ${info.clipId}): ${info.message}`);
      } catch {
        this.componentErrors.push(log.text);
      }
      return;
    }
    const m = log.text.indexOf(MEDIA_ERROR_PREFIX);
    if (m >= 0) {
      try {
        const info = JSON.parse(log.text.slice(m + MEDIA_ERROR_PREFIX.length).trim()) as MediaErrorInfo;
        const key = `${info.clipId}\0${info.assetId}\0${info.message}`;
        if (this.seenMedia.has(key)) return;
        this.seenMedia.add(key);
        this.onMediaError?.(info);
      } catch {
        // unlesbare Meldung ignorieren
      }
    }
  };
}

/** node_modules-Verzeichnis, in dem `remotion` liegt (für die Modulauflösung des Bündels). */
function remotionNodeModules(): string {
  const pkg = require.resolve('remotion/package.json');
  return path.resolve(path.dirname(pkg), '..');
}

export class TimelineRenderer {
  private readonly opts: TimelineRendererOptions;
  private readonly bundles = new Map<string, Promise<string>>();
  private assetServer: Promise<AssetFileServer> | undefined;
  private browser: Promise<HeadlessBrowser> | undefined;
  private readonly probeCache = new Map<string, Promise<string | undefined>>();

  constructor(opts: TimelineRendererOptions) {
    this.opts = opts;
  }

  private get browserExecutable(): string | null {
    return resolveChromiumExecutable(this.opts.browserExecutable) ?? null;
  }

  private get chromiumOptions(): ChromiumOptions {
    return this.opts.chromiumOptions ?? (process.platform === 'linux' ? { gl: 'swangle' } : {});
  }

  /** Übersetzt Quelltexte (falls nötig); wirft mit deutschen Fehlermeldungen. */
  private async compileAll(componentCodes: Record<string, string>): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [id, code] of Object.entries(componentCodes).sort(([a], [b]) => a.localeCompare(b))) {
      if (isCompiledComponent(code)) {
        out[id] = code;
        continue;
      }
      const result = await compileComponent(code, { fileName: `${id}.tsx` });
      if (!result.ok || !result.code) throw new Error(`Komponente „${id}“ lässt sich nicht übersetzen:\n${result.errors.join('\n')}`);
      out[id] = result.code;
    }
    return out;
  }

  /** Bündelt Komposition + Komponenten; liefert die serveUrl (Verzeichnis des Bündels). Gecacht. */
  async bundle(componentCodes: Record<string, string> = {}): Promise<string> {
    const compiled = await this.compileAll(componentCodes);
    const hash = createHash('sha256')
      .update(JSON.stringify({ v: RENDER_PACKAGE_VERSION, src: sourceFingerprint(this.browserEntry()), remotion: require('remotion/package.json').version, compiled }))
      .digest('hex')
      .slice(0, 20);
    const cached = this.bundles.get(hash);
    if (cached) return cached;
    const promise = this.doBundle(hash, compiled);
    this.bundles.set(hash, promise);
    promise.catch(() => this.bundles.delete(hash));
    return promise;
  }

  private browserEntry(): string {
    return this.opts.browserEntry ?? process.env.STUDIO_RENDER_BROWSER_ENTRY ?? path.join(SRC_DIR, 'browser.ts');
  }

  private async doBundle(hash: string, compiled: Record<string, string>): Promise<string> {
    const dir = path.join(path.resolve(this.opts.workDir), 'bundles', hash);
    const outDir = path.join(dir, 'out');
    if (existsSync(path.join(outDir, 'index.html'))) return outDir;
    const srcDir = path.join(dir, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(path.join(srcDir, 'components.generated.ts'), `// Automatisch erzeugt – nicht bearbeiten.\nexport const COMPONENT_CODES: Record<string, string> = ${JSON.stringify(compiled, null, 2)};\n`, 'utf8');
    await writeFile(path.join(srcDir, 'index.tsx'), entrySource(), 'utf8');
    const { bundle } = (await import('@remotion/bundler')) as BundlerModule;
    const tmpOut = `${outDir}.tmp-${process.pid}`;
    await rm(tmpOut, { recursive: true, force: true });
    const nodeModules = remotionNodeModules();
    await bundle({
      entryPoint: path.join(srcDir, 'index.tsx'),
      outDir: tmpOut,
      rootDir: dir,
      enableCaching: true,
      publicDir: null,
      onProgress: () => undefined,
      ignoreRegisterRootWarning: true,
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          modules: ['node_modules', nodeModules, ...((config.resolve?.modules as string[] | undefined) ?? [])],
          alias: { ...(config.resolve?.alias as Record<string, string> | undefined), '@studio/render-browser': this.browserEntry() },
        },
      }),
    });
    await rm(outDir, { recursive: true, force: true });
    await rename(tmpOut, outDir);
    return outDir;
  }

  private async getAssetServer(): Promise<AssetFileServer> {
    this.assetServer ??= AssetFileServer.start();
    return this.assetServer;
  }

  /**
   * Prüft ein Medium (gecacht je Datei-Stand bzw. URL); `undefined` = ladbar/unbekannt, sonst Fehlertext.
   */
  async probeAsset(asset: AssetMedia): Promise<string | undefined> {
    const local = localPathOf(asset.url);
    let key = `${asset.kind}\0${asset.url}`;
    if (local) {
      const st = await stat(local).catch(() => undefined);
      key += st ? `\0${st.size}\0${st.mtimeMs}` : '\0fehlt';
    }
    let result = this.probeCache.get(key);
    if (!result) {
      result = probeMedia(asset.url, asset.kind).catch(() => undefined);
      this.probeCache.set(key, result);
      // Entfernte URLs nicht dauerhaft cachen (Netzwerkfehler können vorübergehend sein).
      if (!local) setTimeout(() => this.probeCache.delete(key), 60_000).unref?.();
    }
    return result;
  }

  /**
   * Lokale Asset-URLs (Pfad/`file://`) → HTTP-URLs des Asset-Servers. Mit `probeIds` werden diese
   * Bild-/Video-Assets vorab geprüft; defekte bekommen `error` (die Komposition lässt sie aus).
   */
  async prepareAssets(assets: Record<string, AssetMedia>, probeIds?: ReadonlySet<string>): Promise<Record<string, AssetMedia>> {
    const out: Record<string, AssetMedia> = {};
    const probes = new Map<string, Promise<string | undefined>>();
    if (probeIds && this.opts.probeMedia !== false) {
      for (const id of probeIds) {
        const asset = assets[id];
        if (asset && !asset.error && (asset.kind === 'image' || asset.kind === 'video')) probes.set(id, this.probeAsset(asset));
      }
    }
    for (const [id, original] of Object.entries(assets)) {
      const problem = await probes.get(id);
      const asset = problem ? { ...original, error: problem } : original;
      const url = asset.url;
      if (/^https?:\/\//i.test(url) || url.startsWith('data:')) {
        out[id] = asset;
      } else if (url.startsWith('file:') || path.isAbsolute(url)) {
        const server = await this.getAssetServer();
        out[id] = { ...asset, url: server.register(url) };
      } else if (asset.error || !url) {
        out[id] = asset.error ? asset : { ...asset, error: 'keine Datei angegeben' };
      } else {
        throw new Error(`Asset „${id}“: URL „${url}“ ist im Render-Worker nicht ladbar (erwartet Dateipfad, file:// oder http(s)://)`);
      }
    }
    return out;
  }

  private async getBrowser(): Promise<HeadlessBrowser> {
    if (!this.browser) {
      const { openBrowser } = (await import('@remotion/renderer')) as RendererModule;
      this.browser = openBrowser('chrome', {
        browserExecutable: this.browserExecutable,
        chromiumOptions: this.chromiumOptions,
        logLevel: this.opts.logLevel ?? 'error',
      });
      this.browser.catch(() => {
        this.browser = undefined;
      });
    }
    return this.browser;
  }

  private async prepare(input: RenderInputBase) {
    const used = new Set<string>();
    const visualAssets = new Set<string>();
    // Asset-Referenzen in Clip-Props (`rotoscope`, `…Asset`, `…AssetId`) – für Director-Komponenten.
    const propRefs: Array<{ clipId: string; assetId: string; path: string }> = [];
    for (const t of input.timeline.tracks) {
      if (t.hidden) continue;
      for (const c of t.clips) {
        if (c.componentId) used.add(c.componentId);
        if (c.transitionIn?.componentId) used.add(c.transitionIn.componentId);
        if (t.kind !== 'audio' && c.assetId && !c.componentId && c.text === undefined) visualAssets.add(c.assetId);
        for (const ref of clipPropAssetRefs(c)) {
          propRefs.push({ clipId: c.id, ...ref });
          visualAssets.add(ref.assetId);
        }
      }
    }
    const codes = input.componentCodes ?? {};
    const missing = [...used].filter((id) => !(id in codes));
    if (missing.length) throw new Error(`Für folgende Komponenten fehlt Code: ${missing.join(', ')}`);
    const mode = this.opts.componentMode ?? 'bundle';
    const compiled = mode === 'inputProps' ? await this.compileAll(codes) : undefined;
    const serveUrl = await this.bundle(mode === 'bundle' ? codes : {});
    const assets = await this.prepareAssets(input.assets, visualAssets);
    // Defekte Prop-Assets meldet die Komposition nicht selbst (Komponenten sehen `assets[id].error`).
    for (const ref of propRefs) {
      const asset = assets[ref.assetId];
      if (!asset?.error) continue;
      try {
        input.onMediaError?.({ clipId: ref.clipId, assetId: ref.assetId, kind: asset.kind, url: input.assets[ref.assetId]?.url ?? '', message: `${ref.path}: ${asset.error}` });
      } catch {
        // Fehler im Melde-Callback ignorieren
      }
    }
    const inputProps: Record<string, unknown> = {
      timeline: input.timeline,
      assets,
      ...(input.formatId ? { formatId: input.formatId } : {}),
      ...(input.words ? { words: input.words } : {}),
      ...(input.lang ? { lang: input.lang } : {}),
      ...(compiled ? { componentCodes: compiled } : {}),
    };
    const renderer = (await import('@remotion/renderer')) as RendererModule;
    const puppeteerInstance = await this.getBrowser();
    const composition = await renderer.selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      browserExecutable: this.browserExecutable,
      chromiumOptions: this.chromiumOptions,
      puppeteerInstance,
      logLevel: this.opts.logLevel ?? 'error',
      timeoutInMilliseconds: this.opts.timeoutMs ?? 30000,
    });
    return { renderer, serveUrl, inputProps, composition, puppeteerInstance };
  }

  private checkComponentErrors(collector: LogCollector): void {
    const errors = collector.componentErrors;
    if (errors.length && this.opts.failOnComponentError !== false) {
      throw new Error(`Fehler in Director-Komponenten:\n${[...new Set(errors)].join('\n')}`);
    }
  }

  /** Rendert einen einzelnen Frame (PNG/JPEG nach Dateiendung). */
  async renderStill(input: RenderStillInput): Promise<string> {
    const { renderer, serveUrl, inputProps, composition, puppeteerInstance } = await this.prepare(input);
    if (input.frame < 0 || input.frame >= composition.durationInFrames) {
      throw new Error(`Frame ${input.frame} liegt außerhalb der Timeline (0–${composition.durationInFrames - 1})`);
    }
    await mkdir(path.dirname(path.resolve(input.out)), { recursive: true });
    const logs = new LogCollector(input.onMediaError);
    await renderer.renderStill({
      composition,
      serveUrl,
      output: input.out,
      frame: input.frame,
      inputProps,
      imageFormat: /\.jpe?g$/i.test(input.out) ? 'jpeg' : 'png',
      scale: input.scale ?? 1,
      browserExecutable: this.browserExecutable,
      chromiumOptions: this.chromiumOptions,
      puppeteerInstance,
      overwrite: true,
      logLevel: this.opts.logLevel ?? 'error',
      timeoutInMilliseconds: this.opts.timeoutMs ?? 30000,
      onBrowserLog: logs.onBrowserLog,
    });
    this.checkComponentErrors(logs);
    return input.out;
  }

  /** Rendert das Video STUMM (Ton mischt ffmpeg separat). */
  async renderVideo(input: RenderVideoInput): Promise<string> {
    const { renderer, serveUrl, inputProps, composition, puppeteerInstance } = await this.prepare(input);
    await mkdir(path.dirname(path.resolve(input.out)), { recursive: true });
    const { cancelSignal, cancel } = renderer.makeCancelSignal();
    const onAbort = () => cancel();
    if (input.signal?.aborted) throw new Error('Rendern abgebrochen');
    input.signal?.addEventListener('abort', onAbort, { once: true });
    const codec = input.codec ?? 'h264';
    const logs = new LogCollector(input.onMediaError);
    try {
      await renderer.renderMedia({
        composition,
        serveUrl,
        codec,
        outputLocation: input.out,
        inputProps,
        muted: true,
        ...(codec === 'prores' ? { proResProfile: 'hq' as const } : {}),
        ...(input.crf !== undefined && codec !== 'prores' ? { crf: input.crf } : {}),
        ...(input.frameRange ? { frameRange: input.frameRange } : {}),
        ...(input.scale ? { scale: input.scale } : {}),
        ...(this.opts.concurrency ? { concurrency: this.opts.concurrency } : {}),
        browserExecutable: this.browserExecutable,
        chromiumOptions: this.chromiumOptions,
        puppeteerInstance,
        overwrite: true,
        cancelSignal,
        logLevel: this.opts.logLevel ?? 'error',
        timeoutInMilliseconds: this.opts.timeoutMs ?? 30000,
        onBrowserLog: logs.onBrowserLog,
        onProgress: ({ progress }) => input.onProgress?.(progress),
      });
    } catch (error) {
      if (input.signal?.aborted) throw new Error('Rendern abgebrochen');
      throw error;
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
    }
    this.checkComponentErrors(logs);
    return input.out;
  }

  /** Schließt Browser und Asset-Server. */
  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    if (browser) {
      const b = await browser.catch(() => undefined);
      await b?.close({ silent: true }).catch(() => undefined);
    }
    const server = this.assetServer;
    this.assetServer = undefined;
    if (server) await (await server).close();
  }
}

/** Einstiegsdatei des Remotion-Bündels. */
function entrySource(): string {
  return `// Automatisch erzeugt von @studio/render – nicht bearbeiten.
import React from 'react';
import * as ReactNS from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as remotion from 'remotion';
import { Composition, registerRoot } from 'remotion';
import { TimelineComposition, computeCompositionMeta, loadCompiledComponent, studioFx } from '@studio/render-browser';
import { COMPONENT_CODES } from './components.generated';

const cache = new Map<string, unknown>();
function load(codes: Record<string, string>) {
  const out: Record<string, any> = {};
  for (const [id, code] of Object.entries(codes)) {
    if (!cache.has(code)) cache.set(code, loadCompiledComponent(code, { React: ReactNS, jsxRuntime, remotion, fx: studioFx }));
    out[id] = cache.get(code);
  }
  return out;
}

const Main: React.FC<any> = (props) => {
  const components = React.useMemo(() => load({ ...COMPONENT_CODES, ...(props.componentCodes ?? {}) }), [props.componentCodes]);
  return <TimelineComposition timeline={props.timeline} assets={props.assets ?? {}} formatId={props.formatId} words={props.words} lang={props.lang} components={components} includeAudio={false} videoComponent="offthread" showPlaceholders={false} />;
};

const Root: React.FC = () => (
  <Composition
    id="${COMPOSITION_ID}"
    component={Main}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={1}
    defaultProps={{ timeline: { kind: 'timeline', fps: 30, width: 1920, height: 1080, durationFrames: 1, formats: [], tracks: [], markers: [], components: {} }, assets: {} } as any}
    calculateMetadata={({ props }: any) => computeCompositionMeta(props.timeline, props.formatId)}
  />
);

registerRoot(Root);
`;
}
