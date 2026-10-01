import { Component, useCallback, useMemo, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  Html5Video,
  Img,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useRemotionEnvironment,
  useVideoConfig,
} from 'remotion';
import type { Clip, Timeline, Track } from '@studio/core';
import { clipLayerTransform, computeMediaStyle, type MediaFit } from './layout.ts';
import { dbToGain, resolveFormat } from './meta.ts';
import { makeClipRandom } from './random.ts';
import { TextClipView, wordsInClip } from './text.tsx';
import type { AssetMedia, OverlayComponentProps, TimedWord, TimelineCompositionProps } from './types.ts';

/**
 * Die eine Remotion-Komposition für Vorschau (Player) UND Export (renderStill/renderMedia).
 *
 * Ebenenreihenfolge: Videospuren unten, Overlay-/Textspuren darüber; innerhalb dieser Gruppen gilt die
 * Dokumentreihenfolge (spätere Spur liegt oben). Ausgeblendete Spuren werden übersprungen.
 * Ton: Videos sind immer stumm; Audiospuren erklingen nur mit `includeAudio` (Vorschau). Beim Export
 * mischt ffmpeg den Ton separat.
 */
export function TimelineComposition(props: TimelineCompositionProps) {
  const { timeline, assets, components, formatId, includeAudio = false, words } = props;
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
  };
  const visual = useMemo(() => orderVisualTracks(timeline), [timeline]);
  const audio = includeAudio ? timeline.tracks.filter((t) => t.kind === 'audio' && !t.hidden && !t.muted) : [];
  return (
    <AbsoluteFill lang="de" data-studio-timeline="" style={{ backgroundColor: timeline.backgroundColor ?? '#000000', overflow: 'hidden' }}>
      {visual.map((track) => (
        <VisualTrack key={track.id} track={track} ctx={ctx} />
      ))}
      {audio.map((track) => (
        <AudioTrack key={track.id} track={track} ctx={ctx} />
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
    return <TextClipView clip={clip} frame={frame} fps={ctx.fps} width={ctx.width} height={ctx.height} words={ctx.words} />;
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

function MediaView({ clip, ctx, frame }: { clip: Clip; ctx: RenderContext; frame: number }): ReactNode {
  const asset = clip.assetId ? ctx.assets[clip.assetId] : undefined;
  if (!asset) return ctx.showPlaceholders ? <Placeholder text={`Asset fehlt: ${clip.assetId}`} /> : null;
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
  if (asset.kind === 'image') return <Img src={asset.url} style={style} alt="" />;
  if (asset.kind === 'video') {
    const trimBefore = clip.in > 0 ? clip.in : undefined;
    return ctx.videoTag === 'offthread' ? (
      <OffthreadVideo src={asset.url} muted trimBefore={trimBefore} playbackRate={clip.speed} style={style} />
    ) : (
      <Html5Video src={asset.url} muted trimBefore={trimBefore} playbackRate={clip.speed} style={style} />
    );
  }
  return ctx.showPlaceholders ? <Placeholder text={`Asset ${asset.id} (${asset.kind}) ist nicht darstellbar`} /> : null;
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

/** Ducking-Absenkung (dB, ≤ 0) einer Spur zum absoluten Frame. Rampen: 0,2 s. */
export function duckingDb(timeline: Pick<Timeline, 'tracks'>, track: Pick<Track, 'duck'>, absoluteFrame: number, fps: number): number {
  if (!track.duck) return 0;
  const by = timeline.tracks.find((t) => t.id === track.duck?.byTrackId);
  if (!by || by.muted) return 0;
  const ramp = Math.max(1, Math.round(fps * 0.2));
  let amount = 0;
  for (const c of by.clips) {
    const start = c.start;
    const end = c.start + c.duration;
    let w = 0;
    if (absoluteFrame >= start && absoluteFrame < end) w = 1;
    else if (absoluteFrame < start && absoluteFrame >= start - ramp) w = 1 - (start - absoluteFrame) / ramp;
    else if (absoluteFrame >= end && absoluteFrame < end + ramp) w = 1 - (absoluteFrame - end + 1) / ramp;
    amount = Math.max(amount, w);
  }
  return amount > 0 ? -Math.abs(track.duck.db) * amount : 0;
}

/** Lautstärke (linear, 0..1) eines Audio-Clips zum Frame relativ zum Clip-Start. */
export function computeClipVolume(timeline: Pick<Timeline, 'tracks' | 'fps'>, track: Pick<Track, 'gainDb' | 'duck'>, clip: Pick<Clip, 'start' | 'duration' | 'gainDb' | 'fadeInFrames' | 'fadeOutFrames'>, frame: number): number {
  const db = (track.gainDb ?? 0) + (clip.gainDb ?? 0) + duckingDb(timeline, track, clip.start + frame, timeline.fps);
  return Math.min(1, Math.max(0, dbToGain(db) * clipFadeFactor(clip, frame)));
}

function AudioTrack({ track, ctx }: { track: Track; ctx: RenderContext }) {
  return (
    <>
      {track.clips.map((clip) => {
        const asset = clip.assetId ? ctx.assets[clip.assetId] : undefined;
        if (!asset || (asset.kind !== 'audio' && asset.kind !== 'video')) return null;
        return (
          <Sequence key={clip.id} from={clip.start} durationInFrames={clip.duration} layout="none" name={clip.name ?? clip.id}>
            <AudioClip clip={clip} track={track} asset={asset} timeline={ctx.timeline} />
          </Sequence>
        );
      })}
    </>
  );
}

function AudioClip({ clip, track, asset, timeline }: { clip: Clip; track: Track; asset: AssetMedia; timeline: Timeline }) {
  const volume = useCallback((f: number) => computeClipVolume(timeline, track, clip, f), [timeline, track, clip]);
  return <Html5Audio src={asset.url} trimBefore={clip.in > 0 ? clip.in : undefined} playbackRate={clip.speed} volume={volume} />;
}
