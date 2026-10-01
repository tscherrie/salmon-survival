import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { clipsAtFrame, type Asset, type Clip, type Marker, type Timeline, type Track } from '@studio/core';
import { t as translate, useT } from '../../i18n.ts';
import { usePeaks, waveformPath } from '../../lib/hooks.ts';
import { clipDisplayName } from '../../lib/labels.ts';
import { trackHeight, useTrackHeights } from '../../lib/layout.ts';
import { formatTc, tcParts } from '../../lib/timecode.ts';
import {
  DEFAULT_PX_PER_SECOND,
  DRAG_THRESHOLD_PX,
  RULER_H,
  SECTIONS_H,
  STRIP_H,
  adjacentBeat,
  beatFrames,
  beatsPerMinute,
  clampZoom,
  contentWidth,
  fitZoom,
  frameToX,
  framesToWidth,
  lowerBound,
  markerStripHit,
  rulerSteps,
  sectionSpans,
  snapToBeat,
  visibleFrames,
  xToFrame,
  type SectionSpan,
} from '../../lib/timelineGeometry.ts';
import { useActions, useApi, useAssetUrl, useStudio, useStudioStore } from '../../state/context.tsx';
import { selectUserMarkers, type UserMarker } from '../../state/selectors.ts';
import { Icon } from '../common/Icon.tsx';
import { Tooltip } from '../common/Tooltip.tsx';
import { MarkerStrip, type StripGhost } from './MarkerStrip.tsx';
import { StageTools } from './StageTools.tsx';
import { TimelineIndex, trackTone } from './TimelineIndex.tsx';

/**
 * Multi-Track-Timeline (nur lesend; DESIGN.md §7.9, §8). Senkrecht: Markerleiste 16 (Klick = Marker) · Lineal 22 ·
 * Abschnitte 20 · Spuren. Alles unterhalb der Markerleiste ist Scrub-Zone: Klick springt, Ziehen scrubbt
 * framegenau. Spannen per Ziehen gibt es nicht mehr; Bereiche entstehen aus zwei Markern und Text.
 * Alt+Klick auf Clip bzw. Abschnitt referenziert ihn. Performance: nur sichtbare Clips, Raster als SVG-Pfade.
 */

/** Kanten-Streifen, in dem das Scrubben die Ansicht mitscrollt (§8.4). */
const AUTOSCROLL_EDGE_PX = 24;
/** Nach so vielen Klicks in die Spuren ohne Alt erscheint einmal der Hinweis auf Alt+Klick (§8.6). */
const ALT_COACH_CLICKS = 3;

// ───────────────────────── Beat-Raster (gespeichert, §10) ─────────────────────────

const BEAT_GRID_KEY = 'director-studio.timeline.beatGrid';
const beatGridListeners = new Set<() => void>();
/** Ersatz, falls der Speicher nicht verfügbar ist. */
let beatGridMemory: boolean | null = null;

function readBeatGrid(): boolean | null {
  try {
    const value = localStorage.getItem(BEAT_GRID_KEY);
    if (value === 'on') return true;
    if (value === 'off') return false;
  } catch {
    return beatGridMemory;
  }
  return null;
}

/** Beat-Raster ein/aus (Toggle in der Leiste, Taste B). */
export function setBeatGrid(on: boolean): void {
  try {
    localStorage.setItem(BEAT_GRID_KEY, on ? 'on' : 'off');
  } catch {
    beatGridMemory = on;
  }
  beatGridListeners.forEach((listener) => listener());
}

function subscribeBeatGrid(listener: () => void): () => void {
  beatGridListeners.add(listener);
  return () => beatGridListeners.delete(listener);
}

/** Beat-Raster an? Standard: an (wirkt nur, wenn es Beats gibt). */
export function useBeatGrid(): boolean {
  return useSyncExternalStore(subscribeBeatGrid, readBeatGrid, readBeatGrid) ?? true;
}

// ───────────────────────── Globale Tasten (§8.5) ─────────────────────────

function isTextInput(el: HTMLElement | null): boolean {
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
}

/** Elemente, die Enter selbst auswerten (Knöpfe, Links, Menüs …). */
function handlesEnter(el: HTMLElement | null): boolean {
  return !!el?.closest?.('button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="separator"], [role="slider"]');
}

/**
 * Timeline-Kürzel, die ohne Fokus in der Timeline gelten (kein Textfeld fokussiert, Timeline-Kategorie offen):
 * Enter (Marker am Abspielkopf), Alt+Enter (dasselbe, auch im Composer), `[`/`]` (Marker), `Alt+[`/`Alt+]`
 * (Abschnitte), Umschalt+←/→ (Schlag bzw. ±1 s) und B (Beat-Raster). Wird von `Stage` eingebunden, damit die Kürzel
 * auch bei eingeklappter Bühne greifen. Der Listener hängt am `document`: Er läuft nach den Handlern der Elemente
 * und vor den Fenster-Kürzeln des Arbeitsbereichs, die ein `defaultPrevented` respektieren.
 */
export function useTimelineShortcuts(): void {
  const actions = useActions();
  const store = useStudioStore();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const state = store.getState();
      const doc = state.viewing?.document ?? state.document;
      if (doc?.kind !== 'timeline' || state.overlays > 0) return;
      const target = event.target as HTMLElement | null;
      const typing = isTextInput(target);

      if (event.key === 'Enter' && event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        // Alt+Enter: Marker am Abspielkopf, auch aus dem Composer heraus (nicht aus anderen Feldern)
        if (typing && !target?.closest('.composer')) return;
        event.preventDefault();
        actions.addMarkerAt(state.playhead);
        return;
      }
      if (typing || event.metaKey) return;

      // Klammern: `[`/`]` springen zwischen Markern, Alt+[`/`] zwischen Abschnitten. Auf Layouts, auf denen die Klammer
      // selbst Alt bzw. AltGr braucht (z. B. Deutsch), zählt das erzeugte Zeichen.
      const bracketCode = event.code === 'BracketLeft' ? -1 : event.code === 'BracketRight' ? 1 : 0;
      if (bracketCode !== 0 && event.altKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        const sections = sectionSpans(doc.markers, doc.durationFrames);
        const target = bracketCode > 0 ? sections.find((s) => s.from > state.playhead) : [...sections].reverse().find((s) => s.from < state.playhead);
        if (target) actions.revealRef({ kind: 'marker', markerId: target.marker.id });
        return;
      }
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        actions.jumpToMarker(event.key === '[' ? -1 : 1);
        return;
      }
      if (event.ctrlKey || event.altKey) return;

      if (event.key === 'Enter' && !event.shiftKey) {
        if (handlesEnter(target)) return;
        event.preventDefault();
        actions.addMarkerAt(state.playhead);
        return;
      }
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.shiftKey) {
        if (target?.closest('[role="separator"], [role="slider"], [role="toolbar"], [role="menu"]')) return;
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const beats = beatFrames(doc.markers);
        const beat = beats.length > 0 ? adjacentBeat(beats, state.playhead, direction) : null;
        state.transport?.pause();
        if (beats.length > 0) {
          if (beat !== null) actions.requestSeek(beat);
        } else {
          actions.requestSeek(state.playhead + direction * Math.round(doc.fps));
        }
        return;
      }
      if ((event.key === 'b' || event.key === 'B') && !event.shiftKey) {
        if (target?.closest('[role="menu"], [role="listbox"], [role="dialog"]')) return;
        event.preventDefault();
        const next = !(readBeatGrid() ?? true);
        setBeatGrid(next);
        actions.announce(translate(next ? 'stage.beatGridOn' : 'stage.beatGridOff'));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [actions, store]);
}

// ───────────────────────── Clips ─────────────────────────

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
  index,
  left,
  width,
  height,
  name,
  fps,
  thumbUrl,
  tileWidth,
  waveAssetId,
}: {
  clip: Clip;
  track: Track;
  /** Laufende Nummer in der Spur (Reiter `01`). */
  index: number;
  left: number;
  width: number;
  height: number;
  name: string;
  fps: number;
  thumbUrl: string | null;
  tileWidth: number;
  waveAssetId: string | null;
}) {
  const t = useT();
  const actions = useActions();
  const key = `clip:${clip.id}`;
  const n = useStudio((s) => s.refNumbers[key]);
  const linked = useStudio((s) => s.hoveredRefKey === key);
  const flash = useStudio((s) => (s.flash?.key === key ? s.flash.nonce : 0));
  const w = Math.max(2, width);
  const label = t('stage.clipAria', { name, from: formatTc(clip.start, fps, 'short'), to: formatTc(clip.start + clip.duration, fps, 'short') });
  const kind = track.kind;
  return (
    <div
      className={`clip clip-${kind} tone-${trackTone(track)}${kind === 'video' ? ' always-dark' : ''}${n ? ' is-ref' : ''}${linked ? ' is-linked' : ''}`}
      data-clip-id={clip.id}
      data-track-id={track.id}
      data-ref-key={key}
      style={{ left, width: w }}
      aria-label={label}
      onMouseEnter={n ? () => actions.setHoveredRef(key) : undefined}
      onMouseLeave={n ? () => actions.setHoveredRef(null) : undefined}
    >
      {kind === 'video' && thumbUrl && (
        <div className="clip-thumbs" style={{ backgroundImage: `url("${thumbUrl}")`, '--tile': `${tileWidth}px` } as React.CSSProperties} />
      )}
      {waveAssetId && w > 6 && <ClipWave assetId={waveAssetId} clip={clip} fps={fps} width={w} height={Math.max(2, height - 4)} />}
      {w > 24 &&
        (kind === 'video' ? (
          <span className="clip-label clip-tab">
            <span className="clip-no mono">{String(index).padStart(2, '0')}</span>
            {name}
          </span>
        ) : kind === 'overlay' ? (
          <span className="clip-label">
            {thumbUrl && <span className="clip-mini" style={{ backgroundImage: `url("${thumbUrl}")` }} />}
            {name}
          </span>
        ) : kind === 'text' ? (
          <span className="clip-label">{clip.text ?? name}</span>
        ) : (
          <span className="clip-label clip-tab">{name}</span>
        ))}
      {n ? <span className="clip-n mono">{n}</span> : null}
      {flash ? <span key={flash} className="ref-flash-ring" aria-hidden="true" /> : null}
    </div>
  );
});

// ───────────────────────── Lineal, Abschnitte, Dokument-Marker ─────────────────────────

const Ruler = memo(function Ruler({
  fps,
  pps,
  from,
  to,
  width,
  rhythm,
}: {
  fps: number;
  pps: number;
  from: number;
  to: number;
  width: number;
  /** Beat- und Downbeat-Marker, nach Frame sortiert. */
  rhythm: readonly Marker[];
}) {
  const { major, minor } = rulerSteps(pps);
  const startSec = Math.floor(from / fps / major) * major;
  const endSec = to / fps;
  const labelTicks: string[] = [];
  const labels: Array<{ x: number; head: string; frames: string }> = [];
  const count = Math.min(2000, Math.ceil((endSec - startSec) / major) + 1);
  let lastText = '';
  for (let i = 0; i < count; i++) {
    const sec = startSec + i * major;
    const x = frameToX(sec * fps, fps, pps);
    const parts = tcParts(Math.round(sec * fps), fps, 'ruler', { pps });
    const text = parts.head + parts.frames;
    // Keine Doppel bei Teilframe-Schritten; Labels, die über das Ende hinausragten, entfallen (Mono 10 ≈ 6 px je Zeichen)
    if (text === lastText || x + 4 + text.length * 6 > width) continue;
    lastText = text;
    labelTicks.push(`M${(Math.round(x) + 0.5).toFixed(1)},5V14`);
    labels.push({ x, ...parts });
  }
  // Unterkante: Takt-Ticks 8 px, Schlag-Ticks 4 px; ohne Beats Nebenschritte der Zeit (4 px)
  const bars: string[] = [];
  const hits: string[] = [];
  const bottom = RULER_H - 1;
  if (rhythm.length > 0) {
    // Schläge ausdünnen, wenn sie weniger als 4 px auseinanderliegen (Takte bleiben)
    const thin = (60 / 120) * pps < 4;
    for (let i = lowerBound(rhythm, from); i < rhythm.length; i++) {
      const m = rhythm[i]!;
      if (m.frame > to) break;
      const x = (Math.round(frameToX(m.frame, fps, pps)) + 0.5).toFixed(1);
      if (m.kind === 'downbeat') bars.push(`M${x},${bottom - 8}V${bottom}`);
      else if (!thin) hits.push(`M${x},${bottom - 4}V${bottom}`);
    }
  } else if (minor < major) {
    const minorCount = Math.min(5000, Math.ceil((endSec - startSec) / minor) + 1);
    for (let i = 0; i < minorCount; i++) {
      const sec = startSec + i * minor;
      const x = (Math.round(frameToX(sec * fps, fps, pps)) + 0.5).toFixed(1);
      hits.push(`M${x},${bottom - 4}V${bottom}`);
    }
  }
  return (
    <div className="tl-ruler" style={{ width }} data-ruler="">
      <svg className="tl-ruler-ticks" width={width} height={RULER_H} aria-hidden="true">
        <path className="tick-label" d={labelTicks.join('')} />
        <path className="tick-bar" d={bars.join('')} />
        <path className="tick-beat" d={hits.join('')} />
      </svg>
      {labels.map((l) => (
        <span key={l.x} className="tl-ruler-label mono" style={{ left: l.x + 4 }} aria-hidden="true">
          {l.head}
          {l.frames && <span className="ff">{l.frames}</span>}
        </span>
      ))}
    </div>
  );
});

/** Anzeige-Name eines Dokument-Markers (Checkpoint, Prüfpunkt, Notiz). */
function docMarkerLabel(marker: Marker): string {
  if (marker.label) return marker.label;
  return marker.kind === 'qa' || marker.kind === 'note' || marker.kind === 'checkpoint' ? translate(`stage.docMarker.${marker.kind}`) : marker.kind;
}

/** Dokument-Marker (qa/note/checkpoint) als 7-px-Rauten an der Unterkante des Lineals. Klick springt, Alt+Klick referenziert. */
const DocMarkers = memo(function DocMarkers({ markers, fps, pps }: { markers: readonly Marker[]; fps: number; pps: number }) {
  const t = useT();
  const actions = useActions();
  const refNumbers = useStudio((s) => s.refNumbers);
  const hoveredKey = useStudio((s) => s.hoveredRefKey);
  return (
    <>
      {markers.map((m) => {
        const key = `marker:${m.id}`;
        const n = refNumbers[key];
        return (
          <button
            key={m.id}
            type="button"
            tabIndex={-1}
            className={`tl-doc-marker kind-${m.kind}${n ? ' is-ref' : ''}${hoveredKey === key ? ' is-linked' : ''}`}
            style={{ left: frameToX(m.frame, fps, pps) }}
            data-marker-id={m.id}
            data-ref-key={key}
            aria-label={t('stage.docMarkerAria', { label: docMarkerLabel(m), time: formatTc(m.frame, fps, 'short') })}
            onMouseEnter={n ? () => actions.setHoveredRef(key) : undefined}
            onMouseLeave={n ? () => actions.setHoveredRef(null) : undefined}
          >
            {n ? <span className="tl-ref-n mono">{n}</span> : null}
          </button>
        );
      })}
    </>
  );
});

/** Index des Abschnitts unter dem Abspielkopf (−1 vor dem ersten). */
function sectionIndexAt(spans: readonly SectionSpan[], frame: number): number {
  let index = -1;
  for (let i = 0; i < spans.length; i++) if (spans[i]!.from <= frame) index = i;
  return index;
}

/** Abschnittszeile (20 px): Mikro-Labels mit Startzeit; der Abschnitt unter dem Abspielkopf ist hervorgehoben. */
const Sections = memo(function Sections({ spans, fps, pps, width }: { spans: readonly SectionSpan[]; fps: number; pps: number; width: number }) {
  const t = useT();
  const actions = useActions();
  const current = useStudio((s) => sectionIndexAt(spans, s.playhead));
  const refNumbers = useStudio((s) => s.refNumbers);
  const hoveredKey = useStudio((s) => s.hoveredRefKey);
  const flash = useStudio((s) => s.flash);
  return (
    <div className="tl-sections" style={{ width }}>
      {spans.map((span, i) => {
        const m = span.marker;
        const key = `marker:${m.id}`;
        const n = refNumbers[key];
        const left = frameToX(span.from, fps, pps);
        const w = framesToWidth(span.to - span.from, fps, pps);
        const label = m.label ?? '';
        // Startzeit nur, wenn Platz für Label + 40 px bleibt (Mikro-Label ca. 7 px je Zeichen)
        const showTime = w >= label.length * 7 + 16 + 40;
        return (
          <button
            key={m.id}
            type="button"
            tabIndex={-1}
            className={`tl-section${i === current ? ' is-current' : ''}${n ? ' is-ref' : ''}${hoveredKey === key ? ' is-linked' : ''}`}
            style={{ left, width: w }}
            data-marker-id={m.id}
            data-ref-key={key}
            aria-label={t('stage.sectionAria', { label, time: formatTc(m.frame, fps, 'short') })}
            onMouseEnter={n ? () => actions.setHoveredRef(key) : undefined}
            onMouseLeave={n ? () => actions.setHoveredRef(null) : undefined}
          >
            <span className="tl-section-inner">
              {n ? <span className="tl-ref-n mono">{n}</span> : null}
              <span className="tl-section-label">{label}</span>
              {showTime && <span className="tl-section-tc mono">· {tcParts(m.frame, fps, 'ruler').head}</span>}
            </span>
            {flash?.key === key ? <span key={flash.nonce} className="ref-flash-ring" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
});

// ───────────────────────── Raster, Marker-Linien, Abspielkopf ─────────────────────────

/** Raster der Spuren: `rhythm` = Schläge und Takte hinter den Clips, `sections` = Abschnittsgrenzen darüber. */
const GridLines = memo(function GridLines({
  markers,
  fps,
  pps,
  width,
  height,
  from,
  to,
  layer,
}: {
  markers: Marker[];
  fps: number;
  pps: number;
  width: number;
  height: number;
  from: number;
  to: number;
  layer: 'rhythm' | 'sections';
}) {
  const beat: string[] = [];
  const down: string[] = [];
  const section: string[] = [];
  const start = lowerBound(markers, from);
  for (let i = start; i < markers.length; i++) {
    const m = markers[i]!;
    if (m.frame > to) break;
    const x = (Math.round(frameToX(m.frame, fps, pps)) + 0.5).toFixed(1);
    if (m.kind === 'beat') beat.push(`M${x},0V${height}`);
    else if (m.kind === 'downbeat') down.push(`M${x},0V${height}`);
    else if (m.kind === 'section') section.push(`M${x},0V${height}`);
  }
  // Schläge ausdünnen, wenn sie weniger als 4 px auseinanderliegen
  const showBeats = (60 / 120) * pps >= 4;
  if (layer === 'sections') {
    return (
      <svg className="tl-grid tl-grid-sections" width={width} height={height} aria-hidden="true">
        <path className="grid-section" d={section.join('')} />
      </svg>
    );
  }
  return (
    <svg className="tl-grid" width={width} height={height} aria-hidden="true">
      {showBeats && <path className="grid-beat" d={beat.join('')} />}
      <path className="grid-downbeat" d={down.join('')} />
    </svg>
  );
});

/** Gestrichelte Daylight-Linien der Nutzer-Marker (Kopfzone ab Unterkante der Leiste bzw. alle Spuren). */
const MarkerLines = memo(function MarkerLines({ markers, fps, pps, top, height }: { markers: readonly UserMarker[]; fps: number; pps: number; top: number; height: number }) {
  const hoveredKey = useStudio((s) => s.hoveredRefKey);
  return (
    <>
      {markers.map((m) => (
        <span
          key={m.key}
          className={`mk-line${m.pending ? ' is-pending' : ''}${hoveredKey === m.key ? ' is-linked' : ''}`}
          style={{ left: Math.round(frameToX(m.frame, fps, pps)), top, height }}
          aria-hidden="true"
        />
      ))}
    </>
  );
});

/** Abspielkopf in der Kopfzone: Linie ab Oberkante der Markerleiste, Kappe im Lineal (greifbar). Nie animiert. */
function PlayheadHead({ fps, pps, height }: { fps: number; pps: number; height: number }) {
  const playhead = useStudio((s) => s.playhead);
  return (
    <div className="tl-playhead" style={{ left: Math.round(frameToX(playhead, fps, pps)), height }} aria-hidden="true">
      <span className="tl-playhead-cap" />
    </div>
  );
}

/** Abspielkopf über den Spuren; folgt bei laufender Wiedergabe mit der Ansicht. */
function PlayheadLanes({ fps, pps, height, scrollRef }: { fps: number; pps: number; height: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const playhead = useStudio((s) => s.playhead);
  const playing = useStudio((s) => s.playing);
  const x = Math.round(frameToX(playhead, fps, pps));
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing || el.clientWidth === 0) return;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1);
  }, [x, playing, scrollRef]);
  return <div className="tl-playhead" style={{ left: x, height }} aria-hidden="true" />;
}

// ───────────────────────── Kopfzone (Markerleiste, Lineal, Abschnitte) ─────────────────────────

/** Frame unter dem Pointer (begrenzt auf die Dauer); mit `snap` auf den nächsten Schlag innerhalb von 12 px. */
function pointerFrame(clientX: number, originLeft: number, fps: number, pps: number, total: number, beats: readonly number[], snap: boolean): number {
  const frame = Math.min(total, xToFrame(clientX - originLeft, fps, pps));
  return snap ? Math.min(total, snapToBeat(frame, beats, fps, pps)) : frame;
}

const TimelineHead = memo(function TimelineHead({
  fps,
  pps,
  width,
  view,
  total,
  from,
  to,
  beats,
  rhythm,
  snapOn,
  spans,
  docMarkers,
  markers,
  height,
  onZoomTo,
  onExit,
}: {
  fps: number;
  pps: number;
  width: number;
  view: { left: number; width: number };
  total: number;
  from: number;
  to: number;
  beats: readonly number[];
  rhythm: readonly Marker[];
  snapOn: boolean;
  spans: readonly SectionSpan[];
  docMarkers: readonly Marker[];
  markers: readonly UserMarker[];
  height: number;
  onZoomTo: (from: number, to: number) => void;
  onExit: () => void;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<StripGhost | null>(null);
  const [inStrip, setInStrip] = useState(false);
  const coachOpen = useStudio((s) => s.coach.markerStrip !== 'done');
  const pointer = useRef<{ x: number; y: number; target: HTMLElement } | null>(null);

  /** Geister-Marker aus der Pointer-Position (nicht über bestehenden Markern, Kappe oder Rauten). */
  const track = useCallback(
    (clientX: number, clientY: number, target: HTMLElement, shift: boolean) => {
      const el = headRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const blocked = !!target.closest('.tl-playhead-cap, .tl-doc-marker');
      const hit = markerStripHit(clientY - rect.top, { blocked });
      setInStrip(hit);
      if (!hit || target.closest('.mk, .tl-menu')) {
        setGhost(null);
        return;
      }
      const snap = snapOn !== shift && beats.length > 0;
      const frame = pointerFrame(clientX, rect.left, fps, pps, total, beats, snap);
      if (markers.some((m) => m.frame === frame)) {
        setGhost(null);
        return;
      }
      setGhost({ frame, x: frameToX(frame, fps, pps), snapped: snap && beats.includes(frame) });
    },
    [beats, fps, markers, pps, snapOn, total],
  );

  // Umschalt kehrt das Einrasten um: Der Geist folgt sofort, auch ohne Mausbewegung
  useEffect(() => {
    if (!inStrip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || !pointer.current) return;
      track(pointer.current.x, pointer.current.y, pointer.current.target, e.type === 'keydown');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [inStrip, track]);

  // Neue Marker, Zoom oder Scrollen: Geist neu berechnen (sonst stünde er auf dem gerade gesetzten Marker)
  useEffect(() => {
    if (pointer.current) setGhost(null);
  }, [markers, pps]);

  const hasSections = spans.length > 0;
  return (
    <div
      ref={headRef}
      className={`tl-head${inStrip ? ' is-strip' : ''}`}
      style={{ height, width }}
      onMouseMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY, target: e.target as HTMLElement };
        track(e.clientX, e.clientY, e.target as HTMLElement, e.shiftKey);
      }}
      onMouseLeave={() => {
        pointer.current = null;
        setGhost(null);
        setInStrip(false);
      }}
    >
      <MarkerStrip
        fps={fps}
        pps={pps}
        width={width}
        view={view}
        markers={markers}
        ghost={ghost}
        coach={coachOpen && markers.length === 0 && !inStrip}
        onZoomTo={onZoomTo}
        onExit={onExit}
      />
      <div className="tl-strip-band" aria-hidden="true" />
      <Ruler fps={fps} pps={pps} from={from} to={to} width={width} rhythm={rhythm} />
      <div className="tl-doc-markers">
        <DocMarkers markers={docMarkers.filter((m) => m.frame >= from && m.frame <= to)} fps={fps} pps={pps} />
      </div>
      {hasSections && <Sections spans={spans} fps={fps} pps={pps} width={width} />}
      <MarkerLines markers={markers} fps={fps} pps={pps} top={STRIP_H} height={height - STRIP_H} />
      <PlayheadHead fps={fps} pps={pps} height={height} />
    </div>
  );
});

// ───────────────────────── Timeline ─────────────────────────

export function TimelineStage({ timeline, audioProject = false }: { timeline: Timeline; audioProject?: boolean }) {
  const t = useT();
  const actions = useActions();
  const store = useStudioStore();
  const assets = useStudio((s) => s.assets);
  const activeTrackId = useStudio((s) => s.activeTrackId);
  const markers = useStudio(selectUserMarkers);
  const assetUrl = useAssetUrl();
  const beatGrid = useBeatGrid();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const indexTracksRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(DEFAULT_PX_PER_SECOND);
  const [view, setView] = useState({ left: 0, width: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const fitted = useRef(false);
  /** Hat der Nutzer selbst gezoomt? Sonst wird bei wachsender Dauer neu eingepasst. */
  const userZoomed = useRef(false);
  const anchor = useRef<{ frame: number; offset: number } | null>(null);
  const raf = useRef(0);
  const plainClicks = useRef(0);

  const { fps, durationFrames: total } = timeline;
  const width = contentWidth(timeline, pps);
  const assetMap = useMemo(() => new Map<string, Asset>(assets.map((a) => [a.id, a])), [assets]);
  const titles = useMemo(() => new Map(assets.map((a) => [a.id, a.title])), [assets]);
  const beats = useMemo(() => beatFrames(timeline.markers), [timeline.markers]);
  const rhythm = useMemo(() => timeline.markers.filter((m) => m.kind === 'beat' || m.kind === 'downbeat').sort((a, b) => a.frame - b.frame), [timeline.markers]);
  const bpm = useMemo(() => beatsPerMinute(beats, fps), [beats, fps]);
  const spans = useMemo(() => sectionSpans(timeline.markers, total), [timeline.markers, total]);
  const docMarkers = useMemo(() => timeline.markers.filter((m) => m.kind === 'qa' || m.kind === 'note' || m.kind === 'checkpoint'), [timeline.markers]);
  const snapOn = beatGrid && beats.length > 0;
  const headH = STRIP_H + RULER_H + (spans.length > 0 ? SECTIONS_H : 0);
  // Spurhöhen je Breakpoint (DESIGN.md §2.3)
  const { heights, audioProjectHeight } = useTrackHeights();
  const lanes = useMemo(() => {
    let top = 0;
    return timeline.tracks.map((track) => {
      const height = trackHeight(track, heights, audioProject ? audioProjectHeight : undefined);
      const lane = { track, top, height };
      top += height;
      return lane;
    });
  }, [timeline.tracks, audioProject, heights, audioProjectHeight]);
  const lanesHeight = lanes.reduce((h, l) => h + l.height, 0);
  const [from, to] = visibleFrames(view.left, view.width, fps, pps, total);
  const aspect = timeline.width / Math.max(1, timeline.height);

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
  /** Sammel-Tag: auf den Bereich zoomen (Bereich in der Mitte, halbe Breite). */
  const zoomTo = useCallback(
    (a: number, b: number) => {
      const w = scrollRef.current?.clientWidth ?? 0;
      const seconds = Math.max((b - a) / fps, 0.25);
      anchor.current = { frame: Math.round((a + b) / 2), offset: w / 2 };
      userZoomed.current = true;
      setPps(clampZoom((Math.max(w, 200) * 0.5) / seconds));
    },
    [fps],
  );

  // Strg/⌘ + Mausrad zoomt (nicht-passiver Listener, damit preventDefault greift); +/− und Umschalt+Z global
  const zoomRef = useRef({ zoomBy, zoomFit });
  zoomRef.current = { zoomBy, zoomFit };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomRef.current.zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTextInput(e.target as HTMLElement)) return;
      if (store.getState().overlays > 0) return;
      if (e.key === '+' || e.key === '=') zoomRef.current.zoomBy(1.4);
      else if (e.key === '-' && !e.shiftKey) zoomRef.current.zoomBy(1 / 1.4);
      else if ((e.key === 'Z' || e.key === 'z') && e.shiftKey) zoomRef.current.zoomFit();
      else return;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKey);
    };
  }, [store]);

  const onScroll = () => {
    const el = scrollRef.current;
    // Spurköpfe scrollen senkrecht synchron mit den Spuren
    if (el && indexTracksRef.current) indexTracksRef.current.scrollTop = el.scrollTop;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) setView((v) => (v.left === node.scrollLeft && v.width === node.clientWidth ? v : { left: node.scrollLeft, width: node.clientWidth }));
    });
  };

  const originLeft = () => contentRef.current!.getBoundingClientRect().left;

  /** Wiedergabe anhalten (Scrubben, §8.4); ohne Player nur den Zustand. */
  const pausePlayback = () => {
    const state = store.getState();
    if (state.transport) state.transport.pause();
    else if (state.playing) actions.setPlaying(false);
  };

  /** Klick in die Markerleiste: Marker setzen, sobald die Maus ohne Ziehen losgelassen wird. */
  const startStripClick = (event: React.MouseEvent) => {
    const startX = event.clientX;
    const frame = pointerFrame(event.clientX, originLeft(), fps, pps, total, beats, snapOn !== event.shiftKey && beats.length > 0);
    const up = (e: MouseEvent) => {
      window.removeEventListener('mouseup', up);
      // Ziehen in der Leiste ist ohne Funktion (keine Spannen, kein Verschieben)
      if (Math.abs(e.clientX - startX) >= DRAG_THRESHOLD_PX) return;
      actions.addMarkerAt(frame);
    };
    window.addEventListener('mouseup', up);
  };

  /** Scrub-Zone: Klick springt (eingerastet), Ziehen scrubbt framegenau mit Auto-Scroll am Rand und pausiert. */
  const startScrub = (event: React.MouseEvent, opts: { trackId?: string | undefined; fromCap: boolean }) => {
    const scroller = scrollRef.current;
    const startX = event.clientX;
    let lastX = event.clientX;
    let dragging = false;
    let loop = 0;
    if (!opts.fromCap) {
      actions.requestSeek(pointerFrame(event.clientX, originLeft(), fps, pps, total, beats, snapOn !== event.shiftKey && beats.length > 0));
    }
    if (opts.trackId) actions.setActiveTrack(opts.trackId);
    if (opts.fromCap) setGrabbing(true);

    const seekToPointer = () => actions.requestSeek(pointerFrame(lastX, originLeft(), fps, pps, total, beats, false));
    const autoScroll = () => {
      loop = 0;
      if (!dragging || !scroller) return;
      const rect = scroller.getBoundingClientRect();
      const leftGap = lastX - rect.left;
      const rightGap = rect.right - lastX;
      let delta = 0;
      if (leftGap < AUTOSCROLL_EDGE_PX) delta = -Math.ceil((AUTOSCROLL_EDGE_PX - Math.max(0, leftGap)) / 2);
      else if (rightGap < AUTOSCROLL_EDGE_PX) delta = Math.ceil((AUTOSCROLL_EDGE_PX - Math.max(0, rightGap)) / 2);
      if (delta !== 0) {
        const before = scroller.scrollLeft;
        scroller.scrollLeft = before + delta;
        if (scroller.scrollLeft !== before) seekToPointer();
      }
      loop = requestAnimationFrame(autoScroll);
    };
    const move = (e: MouseEvent) => {
      lastX = e.clientX;
      if (!dragging) {
        if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        pausePlayback();
        loop = requestAnimationFrame(autoScroll);
      }
      seekToPointer();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (loop) cancelAnimationFrame(loop);
      dragging = false;
      setGrabbing(false);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => dragging;
  };

  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    // Marker-Tags und das Kontextmenü reagieren selbst
    if (target.closest('.mk, .tl-menu')) return;
    const head = target.closest<HTMLElement>('.tl-head');
    const cap = target.closest('.tl-playhead-cap');
    const docMarker = target.closest<HTMLElement>('[data-marker-id]');
    if (head && markerStripHit(event.clientY - head.getBoundingClientRect().top, { blocked: !!cap || !!docMarker })) {
      // Markerleiste: Der Abspielkopf bleibt stehen, der Fokus bleibt, wo er war
      event.preventDefault();
      startStripClick(event);
      return;
    }
    event.preventDefault();
    if (docMarker && !cap) {
      // Abschnitt bzw. Dokument-Raute: Klick springt, Alt+Klick referenziert
      const marker = timeline.markers.find((m) => m.id === docMarker.dataset.markerId);
      if (!marker) return;
      if (event.altKey) actions.insertRef({ kind: 'marker', markerId: marker.id });
      else actions.requestSeek(marker.frame);
      return;
    }
    scrollRef.current?.focus({ preventScroll: true });
    const clipEl = target.closest<HTMLElement>('[data-clip-id]');
    if (event.altKey && clipEl) {
      const trackId = clipEl.dataset.trackId;
      actions.insertRef({ kind: 'clip', clipId: clipEl.dataset.clipId!, ...(trackId ? { trackId } : {}) });
      actions.completeCoach('altReference');
      return;
    }
    const laneEl = target.closest<HTMLElement>('[data-lane-track]');
    const isDragging = startScrub(event, { trackId: laneEl?.dataset.laneTrack, fromCap: !!cap });
    if (laneEl && !cap) {
      // Einmaliger Hinweis nach dem dritten Klick (ohne Ziehen) in die Spuren
      const up = () => {
        window.removeEventListener('mouseup', up, { capture: true });
        if (isDragging() || store.getState().coach.altReference === 'done') return;
        plainClicks.current += 1;
        if (plainClicks.current >= ALT_COACH_CLICKS) {
          actions.toast('info', t('stage.altReferenceCoach'));
          actions.completeCoach('altReference');
        }
      };
      window.addEventListener('mouseup', up, { capture: true });
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Nur die Spurfläche selbst: In der Markerleiste gelten deren Tasten
    if (event.target !== event.currentTarget) return;
    const tracks = timeline.tracks;
    const activeIndex = Math.max(0, tracks.findIndex((tr) => tr.id === activeTrackId));
    if (event.key === 'Enter' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      // Umschalt+Enter: Clip unter dem Abspielkopf auf der aktiven Spur referenzieren
      event.preventDefault();
      const frame = Math.min(store.getState().playhead, total);
      const hits = clipsAtFrame(timeline, frame);
      const hit = hits.find((h) => h.track.id === activeTrackId) ?? hits[0];
      if (hit) actions.insertRef({ kind: 'clip', clipId: hit.clip.id, trackId: hit.track.id });
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const next = tracks[Math.max(0, Math.min(tracks.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        actions.setActiveTrack(next.id);
        actions.announce(next.name ?? next.id);
      }
    }
  };

  const focusTimeline = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), []);
  const empty = timeline.tracks.every((tr) => tr.clips.length === 0);
  const viewBox = useMemo(() => ({ left: view.left, width: view.width }), [view.left, view.width]);

  return (
    <div className={`tl${grabbing ? ' is-grabbing' : ''}`} data-testid="timeline">
      <StageTools>
        {beats.length > 0 && (
          <Tooltip label={t('stage.beatGrid')} keys={['B']}>
            <button type="button" className="toggle tl-beatgrid" aria-pressed={beatGrid} aria-keyshortcuts="B" onClick={() => setBeatGrid(!beatGrid)}>
              <span className="led" aria-hidden="true" />
              {t('stage.beatGrid')}
            </button>
          </Tooltip>
        )}
        <span className="tl-tools-gap" aria-hidden="true" />
        <Tooltip label={t('stage.zoomOut')} keys={['-']}>
          <button type="button" className="ibtn" onClick={() => zoomBy(1 / 1.5)} aria-label={t('stage.zoomOut')} aria-keyshortcuts="-">
            <Icon name="minus" size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t('stage.zoomFit')} keys={['shift', 'Z']}>
          <button type="button" className="ibtn" onClick={zoomFit} aria-label={t('stage.zoomFit')} aria-keyshortcuts="Shift+Z">
            <Icon name="fit" size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t('stage.zoomIn')} keys={['+']}>
          <button type="button" className="ibtn" onClick={() => zoomBy(1.5)} aria-label={t('stage.zoomIn')} aria-keyshortcuts="+">
            <Icon name="plus" size={14} />
          </button>
        </Tooltip>
      </StageTools>
      <TimelineIndex
        fps={fps}
        lanes={lanes}
        hasSections={spans.length > 0}
        bpm={bpm}
        markerCount={markers.filter((m) => !m.pending).length}
        activeTrackId={activeTrackId}
        tracksRef={indexTracksRef}
      />
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
        <div ref={contentRef} className="tl-content" style={{ width, height: headH + lanesHeight }} onMouseDown={onMouseDown}>
          <TimelineHead
            fps={fps}
            pps={pps}
            width={width}
            view={viewBox}
            total={total}
            from={from}
            to={to}
            beats={beats}
            rhythm={rhythm}
            snapOn={snapOn}
            spans={spans}
            docMarkers={docMarkers}
            markers={markers}
            height={headH}
            onZoomTo={zoomTo}
            onExit={focusTimeline}
          />
          <div className="tl-lanes" style={{ height: lanesHeight }}>
            <GridLines markers={timeline.markers} fps={fps} pps={pps} width={width} height={lanesHeight} from={from} to={to} layer="rhythm" />
            {lanes.map(({ track, top, height }) => {
              let index = 0;
              return (
                <div
                  key={track.id}
                  className={`lane lane-${track.kind}${track.id === activeTrackId ? ' is-active' : ''}${track.muted ? ' is-muted' : ''}${track.hidden ? ' is-hidden' : ''}`}
                  data-lane-track={track.id}
                  style={{ top, height }}
                >
                  {track.clips.map((clip) => {
                    index += 1;
                    if (clip.start > to || clip.start + clip.duration < from) return null;
                    const asset = clip.assetId ? assetMap.get(clip.assetId) : undefined;
                    const visual = asset && (asset.kind === 'image' || asset.kind === 'video') && (track.kind === 'video' || track.kind === 'overlay');
                    const wave = asset && (asset.kind === 'audio' || (asset.kind === 'video' && track.kind === 'audio'));
                    return (
                      <ClipView
                        key={clip.id}
                        clip={clip}
                        track={track}
                        index={index}
                        left={frameToX(clip.start, fps, pps)}
                        width={framesToWidth(clip.duration, fps, pps)}
                        height={height}
                        name={clipDisplayName(clip, titles)}
                        fps={fps}
                        thumbUrl={visual && clip.assetId ? assetUrl(clip.assetId, 'thumb') : null}
                        tileWidth={Math.max(8, Math.round((height - 3) * aspect))}
                        waveAssetId={wave && clip.assetId ? clip.assetId : null}
                      />
                    );
                  })}
                </div>
              );
            })}
            <GridLines markers={timeline.markers} fps={fps} pps={pps} width={width} height={lanesHeight} from={from} to={to} layer="sections" />
            <MarkerLines markers={markers} fps={fps} pps={pps} top={0} height={lanesHeight} />
            <PlayheadLanes fps={fps} pps={pps} height={lanesHeight} scrollRef={scrollRef} />
          </div>
        </div>
        {empty && (
          <div className="tl-empty" style={{ top: headH }}>
            {t('stage.emptyTimeline')}
          </div>
        )}
      </div>
    </div>
  );
}
