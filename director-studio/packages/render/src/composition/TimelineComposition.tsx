import { Component, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import {
  AbsoluteFill,
  continueRender,
  Html5Audio,
  Html5Video,
  Img,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useRemotionEnvironment,
  useVideoConfig,
} from 'remotion';
import { DUCK_DEFAULTS, type Clip, type Timeline, type Track } from '@studio/core';
import { clipLayerTransform, computeMediaStyle, type MediaFit } from './layout.ts';
import { dbToGain, resolveFormat } from './meta.ts';
import { makeClipRandom } from './random.ts';
import { TextClipView, wordsInClip } from './text.tsx';
import type { AssetMedia, MediaErrorInfo, OverlayComponentProps, TimedWord, TimelineCompositionProps } from './types.ts';

/**
 * Die eine Remotion-Komposition für Vorschau (Player) UND Export (renderStill/renderMedia).
 *
 * Ebenenreihenfolge: Videospuren unten, Overlay-/Textspuren darüber; innerhalb dieser Gruppen gilt die
 * Dokumentreihenfolge (spätere Spur liegt oben). Ausgeblendete Spuren werden übersprungen.
 * Ton: Videos sind immer stumm; Audiospuren – und der Originalton von Videoclips mit
 * `includeSourceAudio` – erklingen nur mit `includeAudio` (Vorschau). Beim Export mischt ffmpeg den Ton separat.
 * Fehlende oder nicht dekodierbare Medien bringen die Komposition nie zum Absturz (siehe `onMediaError`).
 */
export function TimelineComposition(props: TimelineCompositionProps) {
  const { timeline, assets, components, formatId, includeAudio = false, words, lang = 'de' } = props;
  const { width, height } = useVideoConfig();
  const isRendering = useRemotionEnvironment().isRendering;
  const formatKey = useMemo(() => {
    try {
      return resolveFormat(timeline, formatId).id;
    } catch {
      return formatId ?? '';
    }
  }, [timeline, formatId]);
  const mode = props.videoComponent ?? 'auto';
  const ctx: RenderContext = {
    timeline,
    assets,
    components: components ?? {},
    words: words ?? [],
    width,
    height,
    fps: timeline.fps,
    formatKey,
    showPlaceholders: props.showPlaceholders ?? !isRendering,
    videoTag: mode === 'offthread' || (mode === 'auto' && isRendering) ? 'offthread' : 'html5',
    onComponentError: props.onComponentError,
    onMediaError: props.onMediaError,
    lang,
  };
  const visual = useMemo(() => orderVisualTracks(timeline), [timeline]);
  // Audiospuren und Videospuren mit Originalton-Clips (nur Vorschau).
  const audio = includeAudio
    ? timeline.tracks.filter((t) => !t.hidden && !t.muted && (t.kind === 'audio' || (t.kind === 'video' && t.clips.some((c) => c.includeSourceAudio))))
    : [];
  return (
    <AbsoluteFill lang={lang} data-studio-timeline="" style={{ backgroundColor: timeline.backgroundColor ?? '#000000', overflow: 'hidden' }}>
      {visual.map((track) => (
        <VisualTrack key={track.id} track={track} ctx={ctx} />
      ))}
      {audio.map((track) => (
        <AudioTrack key={`audio-${track.id}`} track={track} ctx={ctx} />
      ))}
    </AbsoluteFill>
  );
}

interface RenderContext {
  timeline: Timeline;
  assets: Record<string, AssetMedia>;
  components: Record<string, ComponentType<OverlayComponentProps>>;
  words: TimedWord[];
  width: number;
  height: number;
  fps: number;
  formatKey: string;
  showPlaceholders: boolean;
  videoTag: 'offthread' | 'html5';
  onComponentError: TimelineCompositionProps['onComponentError'];
  onMediaError: TimelineCompositionProps['onMediaError'];
  lang: string;
}

/** Wiederholungen beim Laden eines Bildes, bevor es als defekt gilt (Remotion-Standard: 2 mit Backoff). */
const MEDIA_MAX_RETRIES = 1;

/** Kennzeichnet Konsolenmeldungen über Medienfehler (der Render-Worker liest sie aus den Browser-Logs). */
export const MEDIA_ERROR_LOG_PREFIX = '[studio:media-error]';

/**
 * Liefert eine stabile Melde-Funktion für Medienfehler eines Clips: höchstens eine Meldung je Medium-URL
 * und Text, als Konsolenwarnung und über `onMediaError`.
 */
function useMediaReporter(ctx: RenderContext, clip: Clip, asset: AssetMedia | undefined): (message: string) => void {
  const callback = useRef(ctx.onMediaError);
  callback.current = ctx.onMediaError;
  const reported = useRef(new Set<string>());
  const assetId = clip.assetId ?? '';
  const kind = asset?.kind ?? 'unknown';
  const url = asset?.url ?? '';
  return useCallback(
    (message: string) => {
      const key = `${url}\u0000${message}`;
      if (reported.current.has(key)) return;
      reported.current.add(key);
      const info: MediaErrorInfo = { clipId: clip.id, assetId, kind, url, message };
      console.warn(`${MEDIA_ERROR_LOG_PREFIX} ${JSON.stringify(info)}`);
      try {
        callback.current?.(info);
      } catch {
        // Fehler im Melde-Callback dürfen die Komposition nicht stören.
      }
    },
    [clip.id, assetId, kind, url],
  );
}

/**
 * `<OffthreadVideo>` gibt sein `delayRender` bei einem Ladefehler NICHT frei (Remotion 4) – das Rendern
 * liefe dann ins Zeitlimit. Die offenen Handles dieser Quelle erkennen wir an ihrem Label
 * („Fetching <proxy-URL mit src=…> from server“) und geben sie frei. Ändern sich Remotions Interna, greift
 * nur noch die Vorabprüfung des Render-Workers (kein Fehler).
 */
function releaseOffthreadDelays(src: string): void {
  try {
    const timeouts = (globalThis as { remotion_delayRenderTimeouts?: Record<string, { label?: string | null } | undefined> }).remotion_delayRenderTimeouts;
    if (!timeouts || typeof window === 'undefined') return;
    const needle = encodeURIComponent(new URL(src, window.location.href).href);
    for (const [handle, entry] of Object.entries(timeouts)) {
      const label = entry?.label ?? '';
      if (label.startsWith('Fetching ') && label.includes(needle)) continueRender(Number(handle));
    }
  } catch {
    // Remotion-Interna nicht wie erwartet – ignorieren.
  }
}

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unbekannter Fehler';
  return raw.length > 300 ? `${raw.slice(0, 299)}…` : raw;
}

const VISUAL_RANK: Record<Track['kind'], number> = { video: 0, overlay: 1, text: 1, audio: -1 };

/** Sichtbare Spuren in Zeichenreihenfolge (unten → oben). */
export function orderVisualTracks(timeline: Pick<Timeline, 'tracks'>): Track[] {
  return timeline.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.kind !== 'audio' && !track.hidden)
    .sort((a, b) => VISUAL_RANK[a.track.kind] - VISUAL_RANK[b.track.kind] || a.index - b.index)
    .map(({ track }) => track);
}

export interface PlannedClip {
  clip: Clip;
  /** Gerenderte Länge inkl. Verlängerung für einen folgenden Überblend-/Komponenten-Übergang. */
  renderDuration: number;
  /** Frames am Ende, in denen zur Abblendfarbe ausgeblendet wird (folgender `dip`). */
  tailDipFrames: number;
  /** Farbe der Abblende am Ende. */
  tailDipColor?: string | undefined;
}

/**
 * Plant die Clips einer Spur: Folgt direkt (ohne Lücke) ein Clip mit `transitionIn` vom Typ
 * `crossfade`/`component`, wird der vorherige Clip um die Übergangsdauer verlängert (er läuft unter dem
 * eingeblendeten Clip weiter). Bei `dip` blendet der vorherige Clip in der ersten Hälfte zur Farbe ab.
 */
export function planTrackClips(track: Pick<Track, 'clips'>, assets: Record<string, AssetMedia>, fps: number): PlannedClip[] {
  const clips = [...track.clips].sort((a, b) => a.start - b.start);
  return clips.map((clip, i) => {
    const next = clips[i + 1];
    let renderDuration = clip.duration;
    let tailDipFrames = 0;
    let tailDipColor: string | undefined;
    const end = clip.start + clip.duration;
    const tr = next?.transitionIn;
    if (next && tr && tr.durationFrames > 0 && next.start === end) {
      if (tr.type === 'crossfade' || tr.type === 'component') {
        let ext = tr.durationFrames;
        const asset = clip.assetId ? assets[clip.assetId] : undefined;
        if (asset?.kind === 'video' && asset.durationMs) {
          const sourceFrames = (asset.durationMs / 1000) * fps;
          const available = Math.floor((sourceFrames - (clip.in ?? 0)) / (clip.speed || 1) - clip.duration);
          ext = Math.max(0, Math.min(ext, available));
        }
        renderDuration += ext;
      } else if (tr.type === 'dip') {
        tailDipFrames = Math.min(clip.duration, Math.ceil(tr.durationFrames / 2));
        tailDipColor = typeof tr.props?.color === 'string' ? tr.props.color : '#000000';
      }
    }
    return { clip, renderDuration, tailDipFrames, ...(tailDipColor ? { tailDipColor } : {}) };
  });
}

function VisualTrack({ track, ctx }: { track: Track; ctx: RenderContext }) {
  const plan = useMemo(() => planTrackClips(track, ctx.assets, ctx.fps), [track, ctx.assets, ctx.fps]);
  return (
    <AbsoluteFill data-track-id={track.id} data-track-kind={track.kind}>
      {plan.map((item) => {
        const asset = item.clip.assetId ? ctx.assets[item.clip.assetId] : undefined;
        return (
          <Sequence
            key={item.clip.id}
            from={item.clip.start}
            durationInFrames={item.renderDuration}
            name={item.clip.name ?? item.clip.id}
            premountFor={asset?.kind === 'video' ? Math.round(ctx.fps) : 0}
          >
            <ClipView item={item} ctx={ctx} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Deckkraft durch Clip-Fades (`fadeInFrames`/`fadeOutFrames`). */
export function clipFadeFactor(clip: Pick<Clip, 'duration' | 'fadeInFrames' | 'fadeOutFrames'>, frame: number): number {
  let v = 1;
  const f = Math.min(frame, clip.duration - 1);
  if (clip.fadeInFrames && clip.fadeInFrames > 0) v *= clamp01((f + 1) / (clip.fadeInFrames + 1));
  if (clip.fadeOutFrames && clip.fadeOutFrames > 0) v *= clamp01((clip.duration - f) / (clip.fadeOutFrames + 1));
  return v;
}

function ClipView({ item, ctx }: { item: PlannedClip; ctx: RenderContext }) {
  const frame = useCurrentFrame();
  const { clip } = item;
  const tr = clip.transitionIn;
  const dt = tr && tr.durationFrames > 0 ? tr.durationFrames : 0;
  let opacity = (clip.opacity ?? 1) * clipFadeFactor(clip, frame);
  if (tr?.type === 'crossfade' && dt > 0) opacity *= clamp01(frame / dt);

  let content = <ClipContent clip={clip} ctx={ctx} frame={frame} />;
  if (tr?.type === 'component' && tr.componentId && dt > 0 && frame < dt) {
    content = (
      <ComponentHost clip={clip} componentId={tr.componentId} ctx={ctx} frame={frame} durationInFrames={dt} props={tr.props ?? {}} progress={clamp01(frame / dt)}>
        {content}
      </ComponentHost>
    );
  }

  let dipOpacity = 0;
  let dipColor = '#000000';
  if (tr?.type === 'dip' && dt > 0) {
    const half = Math.max(1, Math.floor(dt / 2));
    dipOpacity = Math.max(dipOpacity, clamp01(1 - frame / half));
    if (typeof tr.props?.color === 'string') dipColor = tr.props.color;
  }
  if (item.tailDipFrames > 0) {
    const startDip = clip.duration - item.tailDipFrames;
    if (frame >= startDip) {
      dipOpacity = Math.max(dipOpacity, clamp01((frame - startDip + 1) / item.tailDipFrames));
      dipColor = item.tailDipColor ?? dipColor;
    }
  }

  const transform = clipLayerTransform(clip.transform, ctx.width, ctx.height);
  const blend = normalizeBlend(clip.blend);
  return (
    <AbsoluteFill data-clip-id={clip.id} style={{ opacity, ...(blend ? { mixBlendMode: blend } : {}) }}>
      <AbsoluteFill style={transform ? { transform } : undefined}>{content}</AbsoluteFill>
      {dipOpacity > 0 ? <AbsoluteFill data-dip="" style={{ backgroundColor: dipColor, opacity: dipOpacity }} /> : null}
    </AbsoluteFill>
  );
}

const BLENDS = new Set(['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter']);

function normalizeBlend(blend: string | undefined): CSSProperties['mixBlendMode'] | undefined {
  if (!blend) return undefined;
  const v = blend.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).toLowerCase();
  return BLENDS.has(v) ? (v as CSSProperties['mixBlendMode']) : undefined;
}

function ClipContent({ clip, ctx, frame }: { clip: Clip; ctx: RenderContext; frame: number }): ReactNode {
  if (clip.componentId) {
    return <ComponentHost clip={clip} componentId={clip.componentId} ctx={ctx} frame={frame} durationInFrames={clip.duration} props={clip.props ?? {}} />;
  }
  if (clip.text !== undefined) {
    return <TextClipView clip={clip} frame={frame} fps={ctx.fps} width={ctx.width} height={ctx.height} words={ctx.words} lang={ctx.lang} />;
  }
  if (clip.assetId) return <MediaView clip={clip} ctx={ctx} frame={frame} />;
  return null;
}

function zoomFor(clip: Clip, frame: number): number {
  const z = clip.props?.zoom;
  if (typeof z === 'number' && z > 0) return z;
  if (Array.isArray(z) && typeof z[0] === 'number' && typeof z[1] === 'number') {
    const p = clamp01(frame / Math.max(1, clip.duration - 1));
    return z[0] + (z[1] - z[0]) * p;
  }
  return 1;
}

/** Bekanntes Problem eines Clip-Mediums (vor dem Laden erkennbar) oder `undefined`. */
function knownMediaProblem(clip: Clip, asset: AssetMedia | undefined): string | undefined {
  if (!asset) return `Asset fehlt: ${clip.assetId}`;
  if (asset.error) return `Asset ${asset.id} nicht ladbar: ${asset.error}`;
  if (!asset.url) return `Asset ${asset.id} hat keine Datei`;
  if (asset.kind !== 'image' && asset.kind !== 'video') return `Asset ${asset.id} (${asset.kind}) ist nicht darstellbar`;
  return undefined;
}

function MediaView({ clip, ctx, frame }: { clip: Clip; ctx: RenderContext; frame: number }): ReactNode {
  const asset = clip.assetId ? ctx.assets[clip.assetId] : undefined;
  const url = asset?.url ?? '';
  const report = useMediaReporter(ctx, clip, asset);
  const [failure, setFailure] = useState<{ url: string; message: string } | null>(null);
  const known = knownMediaProblem(clip, asset);
  useEffect(() => {
    if (known) report(known);
  }, [known, report]);
  const onMediaFailure = useCallback(
    (err: unknown) => {
      const message = `${asset?.kind === 'video' ? 'Video' : 'Bild'} nicht ladbar oder nicht dekodierbar: ${errorMessage(err)}`;
      if (asset?.kind === 'video' && ctx.videoTag === 'offthread') releaseOffthreadDelays(url);
      setFailure({ url, message });
      report(message);
    },
    [asset?.kind, url, report, ctx.videoTag],
  );
  if (known || !asset) return ctx.showPlaceholders ? <Placeholder text={known ?? `Asset fehlt: ${clip.assetId}`} /> : null;
  // Defektes Medium: Element aushängen (gibt Remotions delayRender frei) – Platzhalter bzw. nichts.
  if (failure && failure.url === url) return ctx.showPlaceholders ? <Placeholder text={failure.message} /> : null;
  const reframe = clip.transform?.reframe?.[ctx.formatKey];
  const fit: MediaFit = clip.transform?.fit ?? 'cover';
  const style = computeMediaStyle({
    boxWidth: ctx.width,
    boxHeight: ctx.height,
    mediaWidth: asset.width,
    mediaHeight: asset.height,
    fit,
    centerX: reframe?.x,
    centerY: reframe?.y,
    zoom: (reframe?.scale ?? 1) * zoomFor(clip, frame),
  });
  if (asset.kind === 'image') return <Img src={url} style={style} alt="" maxRetries={MEDIA_MAX_RETRIES} onImageError={onMediaFailure} />;
  const trimBefore = clip.in > 0 ? clip.in : undefined;
  return ctx.videoTag === 'offthread' ? (
    <OffthreadVideo src={url} muted trimBefore={trimBefore} playbackRate={clip.speed} style={style} onError={onMediaFailure} />
  ) : (
    <Html5Video src={url} muted trimBefore={trimBefore} playbackRate={clip.speed} style={style} onError={onMediaFailure} />
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <AbsoluteFill
      data-placeholder=""
      style={{
        border: '3px dashed rgba(255,255,255,0.55)',
        background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 18px, rgba(0,0,0,0.06) 18px 36px)',
        color: 'rgba(255,255,255,0.85)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 28,
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 24,
      }}
    >
      {text}
    </AbsoluteFill>
  );
}

interface ComponentHostProps {
  clip: Clip;
  componentId: string;
  ctx: RenderContext;
  frame: number;
  durationInFrames: number;
  props: Record<string, unknown>;
  progress?: number;
  children?: ReactNode;
}

function ComponentHost({ clip, componentId, ctx, frame, durationInFrames, props, progress, children }: ComponentHostProps): ReactNode {
  const Comp = ctx.components[componentId];
  const random = useMemo(() => makeClipRandom(clip.id, frame), [clip.id, frame]);
  const words = useMemo(() => wordsInClip(ctx.words, clip, ctx.fps), [ctx.words, clip, ctx.fps]);
  if (!Comp) {
    if (children) return children;
    return ctx.showPlaceholders ? <Placeholder text={`Komponente fehlt: ${componentId}`} /> : null;
  }
  return (
    <ComponentErrorBoundary componentId={componentId} clipId={clip.id} resetKey={frame} showPlaceholder={ctx.showPlaceholders} onError={ctx.onComponentError}>
      <Comp
        clip={clip}
        frame={frame}
        durationInFrames={durationInFrames}
        fps={ctx.fps}
        width={ctx.width}
        height={ctx.height}
        props={props}
        assets={ctx.assets}
        words={words}
        random={random}
        {...(progress !== undefined ? { progress } : {})}
      >
        {children}
      </Comp>
    </ComponentErrorBoundary>
  );
}

interface BoundaryProps {
  componentId: string;
  clipId: string;
  resetKey: number;
  showPlaceholder: boolean;
  onError: TimelineCompositionProps['onComponentError'];
  children?: ReactNode;
}

interface BoundaryState {
  error: Error | null;
  resetKey: number;
}

/** Fängt Fehler einer Director-Komponente ab (pro Frame zurückgesetzt) und meldet sie. */
class ComponentErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const info = { componentId: this.props.componentId, clipId: this.props.clipId, message };
    // Der Render-Worker liest diese Zeile aus den Browser-Logs (siehe TimelineRenderer).
    console.error(`[studio:component-error] ${JSON.stringify(info)}`);
    this.props.onError?.(info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return this.props.showPlaceholder ? (
        <Placeholder text={`Komponente ${this.props.componentId} fehlerhaft: ${this.state.error.message}`} />
      ) : null;
    }
    return this.props.children;
  }
}

// ───────────────────────── Audio (nur Vorschau) ─────────────────────────

/**
 * Ducking-Absenkung (dB, ≤ 0) einer Spur zum absoluten Frame – Näherung dessen, was der Export-Mix
 * (`@studio/media`, sidechaincompress) hörbar macht, mit denselben Standardwerten ({@link DUCK_DEFAULTS}):
 * Schlüsselbereiche sind die tonführenden Clips der Schlüsselspur (Audiospur: alle; Videospur: nur
 * `includeSourceAudio`) ab `leadMs` davor; Lücken unter `mergeGapMs` werden überbrückt. Ab Bereichsbeginn
 * sinkt der Pegel linear über `attackMs`, nach dem Bereichsende kehrt er über `releaseMs` zurück. Den Modus
 * `signal` (Hüllkurve des Schlüsselsignals) nähert die Vorschau über die Clip-Bereiche mit den signal-Standards an.
 */
export function duckingDb(timeline: Pick<Timeline, 'tracks'>, track: Pick<Track, 'duck'>, absoluteFrame: number, fps: number): number {
  const duck = track.duck;
  // Wie im Export: nur negative Werte senken ab (Grenze −57 dB wie sidechaincompress).
  if (!duck || !(duck.db < 0)) return 0;
  const by = timeline.tracks.find((t) => t.id === duck.byTrackId);
  if (!by || by.muted || by === track) return 0;
  const defaults = duck.mode === 'signal' ? DUCK_DEFAULTS.signal : DUCK_DEFAULTS.clips;
  const toFrames = (ms: number | undefined, fallbackMs: number) => (Math.max(0, ms !== undefined && Number.isFinite(ms) ? ms : fallbackMs) / 1000) * fps;
  const attack = Math.max(1, toFrames(duck.attackMs, defaults.attackMs));
  const release = Math.max(1, toFrames(duck.releaseMs, defaults.releaseMs));
  const lead = toFrames(duck.leadMs, defaults.leadMs);
  const mergeGap = duck.mode === 'signal' ? 0 : (DUCK_DEFAULTS.mergeGapMs / 1000) * fps;
  const ranges = by.clips
    .filter((c) => by.kind !== 'video' || c.includeSourceAudio === true)
    .map((c) => [c.start - lead, c.start + c.duration] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of ranges) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] < mergeGap) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  let amount = 0;
  for (const [a, b] of merged) {
    let w = 0;
    if (absoluteFrame >= a && absoluteFrame < b) w = Math.min(1, (absoluteFrame - a) / attack);
    else if (absoluteFrame >= b && absoluteFrame < b + release) w = Math.min(1, (b - a) / attack) * (1 - (absoluteFrame - b) / release);
    amount = Math.max(amount, w);
  }
  return amount > 0 ? Math.max(-57, duck.db) * amount : 0;
}

/** Verstärkung durch Clip-Fades für Ton: `linear` (Standard) oder `equal-power` (Viertelsinus). */
export function clipFadeGain(clip: Pick<Clip, 'duration' | 'fadeInFrames' | 'fadeOutFrames' | 'fadeCurve'>, frame: number): number {
  if (clip.fadeCurve !== 'equal-power') return clipFadeFactor(clip, frame);
  const f = Math.min(frame, clip.duration - 1);
  let v = 1;
  if (clip.fadeInFrames && clip.fadeInFrames > 0) v *= Math.sin((clamp01((f + 1) / (clip.fadeInFrames + 1)) * Math.PI) / 2);
  if (clip.fadeOutFrames && clip.fadeOutFrames > 0) v *= Math.sin((clamp01((clip.duration - f) / (clip.fadeOutFrames + 1)) * Math.PI) / 2);
  return v;
}

/** Lautstärke (linear, 0..1) eines Audio-Clips zum Frame relativ zum Clip-Start. */
export function computeClipVolume(
  timeline: Pick<Timeline, 'tracks' | 'fps'>,
  track: Pick<Track, 'gainDb' | 'duck'>,
  clip: Pick<Clip, 'start' | 'duration' | 'gainDb' | 'fadeInFrames' | 'fadeOutFrames' | 'fadeCurve'>,
  frame: number,
): number {
  const db = (track.gainDb ?? 0) + (clip.gainDb ?? 0) + duckingDb(timeline, track, clip.start + frame, timeline.fps);
  return Math.min(1, Math.max(0, dbToGain(db) * clipFadeGain(clip, frame)));
}

/** Clips einer Spur, die in der Vorschau Ton liefern (Audiospur: alle; Videospur: nur `includeSourceAudio`). */
export function audibleClips(track: Pick<Track, 'kind' | 'clips'>, assets: Record<string, AssetMedia>): Array<{ clip: Clip; asset: AssetMedia }> {
  const out: Array<{ clip: Clip; asset: AssetMedia }> = [];
  for (const clip of track.clips) {
    if (track.kind === 'video' && !clip.includeSourceAudio) continue;
    if (track.kind !== 'audio' && track.kind !== 'video') continue;
    const asset = clip.assetId ? assets[clip.assetId] : undefined;
    if (!asset || asset.error || !asset.url) continue;
    if (track.kind === 'audio' ? asset.kind !== 'audio' && asset.kind !== 'video' : asset.kind !== 'video') continue;
    out.push({ clip, asset });
  }
  return out;
}

function AudioTrack({ track, ctx }: { track: Track; ctx: RenderContext }) {
  const clips = useMemo(() => audibleClips(track, ctx.assets), [track, ctx.assets]);
  return (
    <>
      {clips.map(({ clip, asset }) => (
        <Sequence key={clip.id} from={clip.start} durationInFrames={clip.duration} layout="none" name={clip.name ?? clip.id}>
          <AudioClip clip={clip} track={track} asset={asset} ctx={ctx} />
        </Sequence>
      ))}
    </>
  );
}

function sameMediaUrl(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    const base = typeof window !== 'undefined' ? window.location.href : undefined;
    return new URL(a, base).href === new URL(b, base).href;
  } catch {
    return a === b;
  }
}

function AudioClip({ clip, track, asset, ctx }: { clip: Clip; track: Track; asset: AssetMedia; ctx: RenderContext }) {
  const { timeline } = ctx;
  const volume = useCallback((f: number) => computeClipVolume(timeline, track, clip, f), [timeline, track, clip]);
  const report = useMediaReporter(ctx, clip, asset);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onError = useCallback(
    (err: unknown) => {
      setFailedUrl(asset.url);
      report(`Ton nicht ladbar oder nicht dekodierbar: ${errorMessage(err)}`);
    },
    [asset.url, report],
  );
  // In der Vorschau reicht Remotion Ladefehler des <audio> nicht an `onError` weiter – selbst lauschen.
  // (Geteilte Audio-Tags: nur Fehler zählen, solange das Element unsere Quelle trägt.)
  const failed = failedUrl === asset.url;
  useEffect(() => {
    const el = audioRef.current;
    if (!el || failed || typeof el.addEventListener !== 'function') return;
    const handler = () => {
      if (!sameMediaUrl(el.currentSrc || el.src, asset.url)) return;
      onError(new Error(el.error?.message || `Code ${el.error?.code ?? '?'}`));
    };
    el.addEventListener('error', handler);
    return () => el.removeEventListener('error', handler);
  }, [asset.url, onError, failed]);
  if (failed) return null;
  return <Html5Audio ref={audioRef} src={asset.url} trimBefore={clip.in > 0 ? clip.in : undefined} playbackRate={clip.speed} volume={volume} onError={onError} />;
}
