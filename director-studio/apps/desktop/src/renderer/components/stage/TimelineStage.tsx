import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clipsAtFrame, formatTimecode, type Asset, type Clip, type Marker, type Timeline, type Track, type TrackKind } from '@studio/core';
import { useT } from '../../i18n.ts';
import { usePeaks, waveformPath } from '../../lib/hooks.ts';
import { clipDisplayName } from '../../lib/labels.ts';
import {
  DEFAULT_PX_PER_SECOND,
  DRAG_THRESHOLD_PX,
  beatFrames,
  clampZoom,
  contentWidth,
  fitZoom,
  formatRulerLabel,
  frameToX,
  framesToWidth,
  lowerBound,
  rulerSteps,
  snapToBeat,
  visibleFrames,
  xToFrame,
} from '../../lib/timelineGeometry.ts';
import { useActions, useApi, useAssetUrl, useStudio, useStudioStore } from '../../state/context.tsx';
import { Icon, TRACK_KIND_ICONS } from '../common/Icon.tsx';

/**
 * Multi-Track-Timeline (nur lesend). Klick → Zeitpunkt, Ziehen → Spanne (in einer Spur: spurgebunden),
 * Alt+Klick auf Clip → Clip, Klick auf Marker → Marker, Shift → Beat-Raster.
 * Performance: nur sichtbare Clips/Marker werden gerendert, Beats als ein SVG-Pfad.
 */

export const RULER_HEIGHT = 24;
const LANE_HEIGHTS: Record<TrackKind, number> = { video: 36, overlay: 22, text: 24, audio: 30 };
const AUDIO_PROJECT_LANE = 56;

export function laneHeight(track: Track, audioProject: boolean): number {
  return audioProject && track.kind === 'audio' ? AUDIO_PROJECT_LANE : LANE_HEIGHTS[track.kind];
}

// ───────────────────────── Clip ─────────────────────────

const ClipWave = memo(function ClipWave({ assetId, clip, fps, width, height }: { assetId: string; clip: Clip; fps: number; width: number; height: number }) {
  const api = useApi();
  const projectId = useStudio((s) => s.projectId);
  const peaks = usePeaks(api, projectId, assetId);
  const d = useMemo(() => {
    if (!peaks) return '';
    const fromMs = (clip.in / fps) * 1000;
    const toMs = fromMs + (clip.duration / fps) * 1000 * (clip.speed ?? 1);
    return waveformPath(peaks.peaks, peaks.durationMs, fromMs, toMs, Math.min(width, 16000), height);
  }, [peaks, clip.in, clip.duration, clip.speed, fps, width, height]);
  if (!d) return null;
  return (
    <svg className="clip-wave" width={width} height={height} viewBox={`0 0 ${Math.min(width, 16000)} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
});

const ClipView = memo(function ClipView({
  clip,
  track,
  left,
  width,
  height,
  name,
  fps,
  thumbUrl,
  waveAssetId,
}: {
  clip: Clip;
  track: Track;
  left: number;
  width: number;
  height: number;
  name: string;
  fps: number;
  thumbUrl: string | null;
  waveAssetId: string | null;
}) {
  const t = useT();
  const label = t('stage.clipAria', { name, from: formatTimecode(clip.start, fps), to: formatTimecode(clip.start + clip.duration, fps) });
  return (
    <div
      className={`clip clip-${track.kind}${track.role ? ` clip-role-${track.role}` : ''}`}
      data-clip-id={clip.id}
      data-track-id={track.id}
      style={{ left, width: Math.max(2, width) }}
      aria-label={label}
      title={`${name} · ${formatTimecode(clip.start, fps)}–${formatTimecode(clip.start + clip.duration, fps)}`}
    >
      {thumbUrl && <div className="clip-thumbs" style={{ backgroundImage: `url("${thumbUrl}")` }} />}
      {waveAssetId && width > 6 && <ClipWave assetId={waveAssetId} clip={clip} fps={fps} width={Math.max(2, width)} height={height - 2} />}
      {width > 24 && <span className="clip-label">{name}</span>}
    </div>
  );
});

// ───────────────────────── Lineal & Marker ─────────────────────────

const Ruler = memo(function Ruler({ fps, pps, from, to, width }: { fps: number; pps: number; from: number; to: number; width: number }) {
  const { major, minor } = rulerSteps(pps);
  const startSec = Math.floor(from / fps / minor) * minor;
  const endSec = to / fps;
  const minorPath: string[] = [];
  const labels: Array<{ x: number; text: string }> = [];
  const count = Math.min(5000, Math.ceil((endSec - startSec) / minor) + 1);
  for (let i = 0; i < count; i++) {
    const sec = startSec + i * minor;
    const x = frameToX(sec * fps, fps, pps);
    const isMajor = Math.abs(sec / major - Math.round(sec / major)) < 1e-6;
    minorPath.push(`M${x.toFixed(1)},${isMajor ? 8 : 15}V${RULER_HEIGHT}`);
    if (isMajor) labels.push({ x, text: formatRulerLabel(sec, major) });
  }
  return (
    <div className="tl-ruler" style={{ width }} data-ruler>
      <svg className="tl-ruler-ticks" width={width} height={RULER_HEIGHT} aria-hidden="true">
        <path d={minorPath.join('')} />
      </svg>
      {labels.map((l) => (
        <span key={l.x} className="tl-ruler-label" style={{ left: l.x + 3 }} aria-hidden="true">
          {l.text}
        </span>
      ))}
    </div>
  );
});

const MarkerFlags = memo(function MarkerFlags({ markers, fps, pps, onMarker }: { markers: Marker[]; fps: number; pps: number; onMarker: (m: Marker) => void }) {
  const t = useT();
  return (
    <>
      {markers.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`marker-flag marker-${m.kind}`}
          data-marker-id={m.id}
          style={{ left: frameToX(m.frame, fps, pps) }}
          aria-label={t('stage.markerAria', { label: m.label ?? m.kind, time: formatTimecode(m.frame, fps) })}
          title={`${m.label ?? m.kind} · ${formatTimecode(m.frame, fps)}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onMarker(m)}
        >
          {m.kind === 'section' ? <span>{m.label ?? ''}</span> : <Icon name="marker" size={11} />}
        </button>
      ))}
    </>
  );
});

const GridLines = memo(function GridLines({ markers, fps, pps, width, height, from, to }: { markers: Marker[]; fps: number; pps: number; width: number; height: number; from: number; to: number }) {
  const beat: string[] = [];
  const down: string[] = [];
  const section: string[] = [];
  const words: string[] = [];
  const start = lowerBound(markers, from);
  for (let i = start; i < markers.length; i++) {
    const m = markers[i]!;
    if (m.frame > to) break;
    const x = frameToX(m.frame, fps, pps).toFixed(1);
    if (m.kind === 'beat') beat.push(`M${x},0V${height}`);
    else if (m.kind === 'downbeat') down.push(`M${x},0V${height}`);
    else if (m.kind === 'section') section.push(`M${x},0V${height}`);
    else if (m.kind === 'word') words.push(`M${x},0V6`);
  }
  // Bei sehr kleinem Zoom Beats ausdünnen, damit das Raster ruhig bleibt.
  const showBeats = (60 / 120) * pps >= 4;
  return (
    <svg className="tl-grid" width={width} height={height} aria-hidden="true">
      {showBeats && <path className="grid-beat" d={beat.join('')} />}
      <path className="grid-downbeat" d={down.join('')} />
      <path className="grid-section" d={section.join('')} />
      <path className="grid-word" d={words.join('')} />
    </svg>
  );
});

function Playhead({ fps, pps, height, scrollRef }: { fps: number; pps: number; height: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const playhead = useStudio((s) => s.playhead);
  const playing = useStudio((s) => s.playing);
  const x = frameToX(playhead, fps, pps);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing || el.clientWidth === 0) return;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1);
  }, [x, playing, scrollRef]);
  return <div className="tl-playhead" style={{ left: x, height }} aria-hidden="true" />;
}

function PlayheadTime({ fps }: { fps: number }) {
  const playhead = useStudio((s) => s.playhead);
  return <span className="tl-time">{formatTimecode(playhead, fps)}</span>;
}

// ───────────────────────── Timeline ─────────────────────────

export function TimelineStage({ timeline, audioProject = false }: { timeline: Timeline; audioProject?: boolean }) {
  const t = useT();
  const actions = useActions();
  const store = useStudioStore();
  const assets = useStudio((s) => s.assets);
  const activeTrackId = useStudio((s) => s.activeTrackId);
  const assetUrl = useAssetUrl();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(DEFAULT_PX_PER_SECOND);
  const [view, setView] = useState({ left: 0, width: 0 });
  const [selection, setSelection] = useState<{ from: number; to: number; trackId?: string | undefined } | null>(null);
  const fitted = useRef(false);
  /** Hat der Nutzer selbst gezoomt? Sonst wird bei wachsender Dauer neu eingepasst. */
  const userZoomed = useRef(false);
  const anchor = useRef<{ frame: number; offset: number } | null>(null);
  const raf = useRef(0);

  const { fps, durationFrames: total } = timeline;
  const width = contentWidth(timeline, pps);
  const assetMap = useMemo(() => new Map<string, Asset>(assets.map((a) => [a.id, a])), [assets]);
  const titles = useMemo(() => new Map(assets.map((a) => [a.id, a.title])), [assets]);
  const beats = useMemo(() => beatFrames(timeline.markers), [timeline.markers]);
  const flags = useMemo(() => timeline.markers.filter((m) => m.kind !== 'beat' && m.kind !== 'downbeat' && m.kind !== 'word'), [timeline.markers]);
  const lanes = useMemo(() => {
    let top = 0;
    return timeline.tracks.map((track) => {
      const height = laneHeight(track, audioProject);
      const lane = { track, top, height };
      top += height;
      return lane;
    });
  }, [timeline.tracks, audioProject]);
  const lanesHeight = lanes.reduce((h, l) => h + l.height, 0);
  const [from, to] = visibleFrames(view.left, view.width, fps, pps, total);

  // Breite messen; beim ersten Messen die ganze Timeline einpassen.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setView((v) => (v.width === w && v.left === el.scrollLeft ? v : { left: el.scrollLeft, width: w }));
      if (!fitted.current && w > 0) {
        fitted.current = true;
        setPps(fitZoom(timeline, w));
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dauer geändert (z. B. Director verlängert die Timeline) → neu einpassen, solange nicht manuell gezoomt
  useEffect(() => {
    const w = scrollRef.current?.clientWidth ?? 0;
    if (!userZoomed.current && fitted.current && w > 0) setPps(fitZoom({ durationFrames: total, fps }, w));
  }, [total, fps]);

  // Zoom um einen Ankerpunkt (Mausposition bzw. Mitte)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!anchor.current || !el) return;
    el.scrollLeft = Math.max(0, frameToX(anchor.current.frame, fps, pps) - anchor.current.offset);
    anchor.current = null;
    setView({ left: el.scrollLeft, width: el.clientWidth });
  }, [pps, fps]);

  const zoomBy = (factor: number, clientX?: number) => {
    const el = scrollRef.current;
    const rect = el?.getBoundingClientRect();
    const offset = clientX !== undefined && rect ? clientX - rect.left : (el?.clientWidth ?? 0) / 2;
    anchor.current = { frame: xToFrame((el?.scrollLeft ?? 0) + offset, fps, pps), offset };
    userZoomed.current = true;
    setPps((p) => clampZoom(p * factor));
  };
  const zoomFit = () => {
    const w = scrollRef.current?.clientWidth ?? 0;
    anchor.current = { frame: 0, offset: 0 };
    userZoomed.current = false;
    setPps(w > 0 ? fitZoom(timeline, w) : DEFAULT_PX_PER_SECOND);
  };

  // Strg/⌘ + Mausrad zoomt (nicht-passiver Listener, damit preventDefault greift)
  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomRef.current(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) setView({ left: el.scrollLeft, width: el.clientWidth });
    });
  };

  const frameAt = (clientX: number, snap: boolean): number => {
    const rect = contentRef.current!.getBoundingClientRect();
    const frame = Math.min(total, xToFrame(clientX - rect.left, fps, pps));
    return snap ? snapToBeat(frame, beats, fps, pps) : frame;
  };

  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-marker-id]')) return;
    event.preventDefault();
    scrollRef.current?.focus({ preventScroll: true });
    const clipEl = target.closest<HTMLElement>('[data-clip-id]');
    if (event.altKey && clipEl) {
      const trackId = clipEl.dataset.trackId;
      actions.insertRef({ kind: 'clip', clipId: clipEl.dataset.clipId!, ...(trackId ? { trackId } : {}) });
      return;
    }
    const laneEl = target.closest<HTMLElement>('[data-lane-track]');
    const trackId = laneEl?.dataset.laneTrack;
    const snapStart = event.shiftKey;
    const startX = event.clientX;
    const startFrame = frameAt(event.clientX, snapStart);
    let dragging = false;
    const move = (e: MouseEvent) => {
      if (!dragging && Math.abs(e.clientX - startX) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      const end = frameAt(e.clientX, e.shiftKey || snapStart);
      setSelection({ from: Math.min(startFrame, end), to: Math.max(startFrame, end), trackId });
    };
    const up = (e: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setSelection(null);
      if (trackId) actions.setActiveTrack(trackId);
      if (dragging) {
        const end = frameAt(e.clientX, e.shiftKey || snapStart);
        const range = { from: Math.min(startFrame, end), to: Math.max(startFrame, end) };
        if (range.to > range.from) {
          actions.insertRef({ kind: 'range', ...range, ...(trackId ? { trackId } : {}) });
          actions.requestSeek(range.from);
          return;
        }
      }
      actions.insertRef({ kind: 'time', frame: startFrame });
      actions.requestSeek(startFrame);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onMarker = (marker: Marker) => {
    actions.insertRef({ kind: 'marker', markerId: marker.id });
    actions.requestSeek(marker.frame);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const tracks = timeline.tracks;
    const activeIndex = Math.max(0, tracks.findIndex((tr) => tr.id === activeTrackId));
    if (event.key === 'Enter') {
      event.preventDefault();
      const frame = Math.min(store.getState().playhead, total);
      if (event.altKey) {
        const hits = clipsAtFrame(timeline, frame);
        const hit = hits.find((h) => h.track.id === activeTrackId) ?? hits[0];
        if (hit) actions.insertRef({ kind: 'clip', clipId: hit.clip.id, trackId: hit.track.id });
      } else {
        actions.insertRef({ kind: 'time', frame });
      }
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = tracks[Math.max(0, Math.min(tracks.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        actions.setActiveTrack(next.id);
        actions.announce(next.name ?? next.id);
      }
    } else if ((event.key === '+' || event.key === '=') && !event.ctrlKey && !event.metaKey) {
      zoomBy(1.4);
    } else if (event.key === '-' && !event.ctrlKey && !event.metaKey) {
      zoomBy(1 / 1.4);
    }
  };

  const fullHeight = RULER_HEIGHT + lanesHeight;
  const selectionLane = selection?.trackId ? lanes.find((l) => l.track.id === selection.trackId) : undefined;

  return (
    <div className="tl" data-testid="timeline">
      <div className="tl-toolbar">
        <PlayheadTime fps={fps} />
        <span className="hint">{t('stage.hint')}</span>
        <span className="spacer" />
        <button type="button" className="icon-button" onClick={() => zoomBy(1 / 1.5)} aria-label={t('stage.zoomOut')}>
          <Icon name="minus" />
        </button>
        <button type="button" className="icon-button" onClick={zoomFit} aria-label={t('stage.zoomFit')}>
          <Icon name="fit" />
        </button>
        <button type="button" className="icon-button" onClick={() => zoomBy(1.5)} aria-label={t('stage.zoomIn')}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="tl-body">
        <div className="tl-headers">
          <div className="tl-header-spacer" style={{ height: RULER_HEIGHT }} />
          {lanes.map(({ track, height }) => (
            <div
              key={track.id}
              className={`tl-track-header${track.id === activeTrackId ? ' is-active' : ''}${track.hidden ? ' is-hidden' : ''}`}
              style={{ height }}
              title={`${track.id} · ${t(`stage.track.${track.kind}`)}`}
            >
              <Icon name={TRACK_KIND_ICONS[track.kind]} size={13} />
              <span className="tl-track-id">{track.id}</span>
              <span className="tl-track-name">{track.name ?? track.role ?? ''}</span>
              {track.muted && <Icon name="muted" size={13} title={t('stage.muted')} />}
            </div>
          ))}
        </div>
        <div
          ref={scrollRef}
          className="tl-scroll"
          tabIndex={0}
          role="group"
          aria-roledescription={t('stage.timeline')}
          aria-label={t('stage.ariaTimeline')}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
        >
          <div ref={contentRef} className="tl-content" style={{ width, height: fullHeight }} onMouseDown={onMouseDown}>
            <Ruler fps={fps} pps={pps} from={from} to={to} width={width} />
            <MarkerFlags markers={flags.filter((m) => m.frame >= from && m.frame <= to)} fps={fps} pps={pps} onMarker={onMarker} />
            <div className="tl-lanes" style={{ top: RULER_HEIGHT, height: lanesHeight }}>
              {lanes.map(({ track, top, height }) => (
                <div
                  key={track.id}
                  className={`lane lane-${track.kind}${track.id === activeTrackId ? ' is-active' : ''}${track.muted ? ' is-muted' : ''}${track.hidden ? ' is-hidden' : ''}`}
                  data-lane-track={track.id}
                  style={{ top, height }}
                >
                  {track.clips.map((clip) => {
                    if (clip.start > to || clip.start + clip.duration < from) return null;
                    const asset = clip.assetId ? assetMap.get(clip.assetId) : undefined;
                    const visual = asset && (asset.kind === 'image' || asset.kind === 'video') && (track.kind === 'video' || track.kind === 'overlay');
                    const wave = asset && (asset.kind === 'audio' || (asset.kind === 'video' && track.kind === 'audio'));
                    return (
                      <ClipView
                        key={clip.id}
                        clip={clip}
                        track={track}
                        left={frameToX(clip.start, fps, pps)}
                        width={framesToWidth(clip.duration, fps, pps)}
                        height={height}
                        name={clipDisplayName(clip, titles)}
                        fps={fps}
                        thumbUrl={visual && clip.assetId ? assetUrl(clip.assetId, 'thumb') : null}
                        waveAssetId={wave && clip.assetId ? clip.assetId : null}
                      />
                    );
                  })}
                </div>
              ))}
              <GridLines markers={timeline.markers} fps={fps} pps={pps} width={width} height={lanesHeight} from={from} to={to} />
            </div>
            {selection && (
              <div
                className="tl-selection"
                style={{
                  left: frameToX(selection.from, fps, pps),
                  width: framesToWidth(selection.to - selection.from, fps, pps),
                  top: selectionLane ? RULER_HEIGHT + selectionLane.top : 0,
                  height: selectionLane ? selectionLane.height : fullHeight,
                }}
                aria-hidden="true"
              />
            )}
            <Playhead fps={fps} pps={pps} height={fullHeight} scrollRef={scrollRef} />
          </div>
        </div>
      </div>
      {timeline.tracks.every((tr) => tr.clips.length === 0) && <div className="tl-empty">{t('stage.emptyTimeline')}</div>}
    </div>
  );
}
