import { snapToNearest, type Marker, type Timeline } from '@studio/core';

/** Geometrie der Timeline-Bühne: Frames ↔ Pixel, Lineal-Raster, Beat-Snapping, Sichtbereich. */

/** Linker Innenabstand im Inhalt, damit Frame 0 gut klickbar ist. */
export const TIMELINE_PAD = 8;
/** Zoom ohne gemessene Breite (z. B. jsdom) und Startwert. */
export const DEFAULT_PX_PER_SECOND = 50;
export const MIN_PX_PER_SECOND = 0.5;
export const MAX_PX_PER_SECOND = 2000;
/** Snap-Toleranz in Pixeln (Beat-Raster: nächster Schlag innerhalb dieser Strecke). */
export const SNAP_TOLERANCE_PX = 12;
/** Ab dieser Mausbewegung wird aus einem Klick ein Ziehen. */
export const DRAG_THRESHOLD_PX = 4;

/** Senkrechte Anatomie der Timeline (DESIGN.md §7.9): Markerleiste · Lineal · Abschnitte. */
export const STRIP_H = 16;
/** Die Trefferzone der Markerleiste ragt so weit ins Lineal (dort stehen keine Labels; §8.4). */
export const STRIP_HIT_EXTRA = 4;
export const RULER_H = 22;
export const SECTIONS_H = 20;
/** Unterhalb dieses Abstands gelten zwei Marker-Tags als „nah“ (Versatz bzw. Sammel-Tag; §8.3). */
export const MARKER_PROXIMITY_PX = 18;
/** Breite des Marker-Tags: 16 px, ab zwei Ziffern 20 px. */
export function markerTagWidth(n: number): number {
  return n >= 10 ? 20 : 16;
}

/**
 * Zone eines Pointers in der Kopfzone der Timeline (`y` relativ zur Oberkante der Markerleiste): `true` = Markerleiste
 * (16 px plus 4 px Trefferzone im Lineal), sonst Scrub-Zone. `blocked` steht für ein Element, das selbst reagiert
 * (Kappe des Abspielkopfs, Dokument-Raute), und nimmt die Trefferzone im Lineal zurück.
 */
export function markerStripHit(y: number, opts: { blocked?: boolean } = {}): boolean {
  if (y < 0) return false;
  if (y < STRIP_H) return true;
  return !opts.blocked && y < STRIP_H + STRIP_HIT_EXTRA;
}

/** Ein Tag in der Markerleiste: Lage `normal`, bei Nähe `low` (früherer) bzw. `high` (späterer, 6 px höher). */
export interface MarkerTagLayout<T> {
  type: 'tag';
  marker: T;
  x: number;
  level: 'normal' | 'low' | 'high';
}
/** Sammel-Tag für mehr als drei Marker innerhalb von 18 px; ein Klick zoomt auf `from`…`to`. */
export interface MarkerCollectorLayout<T> {
  type: 'collector';
  markers: T[];
  x: number;
  from: number;
  to: number;
}
export type MarkerLayoutItem<T> = MarkerTagLayout<T> | MarkerCollectorLayout<T>;

/**
 * Ordnet die Marker-Tags der Leiste an (§8.3): Jeder Tag steht zentriert auf `frameToX`. Liegen zwei Tags näher als
 * 18 px, steht der spätere 6 px höher und überlappt den früheren um die Hälfte (innerhalb einer Kette abwechselnd).
 * Mehr als drei Tags innerhalb von 18 px werden zu einem Sammel-Tag.
 */
export function layoutMarkerTags<T extends { frame: number }>(markers: readonly T[], pps: number, fps: number): MarkerLayoutItem<T>[] {
  const sorted = [...markers].sort((a, b) => a.frame - b.frame);
  const xs = sorted.map((m) => frameToX(m.frame, fps, pps));
  const items: MarkerLayoutItem<T>[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && xs[j + 1]! - xs[i]! < MARKER_PROXIMITY_PX) j++;
    if (j - i + 1 > 3) {
      const group = sorted.slice(i, j + 1);
      items.push({ type: 'collector', markers: group, x: (xs[i]! + xs[j]!) / 2, from: group[0]!.frame, to: group[group.length - 1]!.frame });
      i = j + 1;
      continue;
    }
    items.push({ type: 'tag', marker: sorted[i]!, x: xs[i]!, level: 'normal' });
    i++;
  }
  // Ketten naher Einzel-Tags: abwechselnd tief und hoch, damit jede Nummer lesbar bleibt
  for (let k = 1; k < items.length; k++) {
    const prev = items[k - 1]!;
    const item = items[k]!;
    if (prev.type !== 'tag' || item.type !== 'tag' || item.x - prev.x >= MARKER_PROXIMITY_PX) continue;
    if (prev.level === 'normal') prev.level = 'low';
    item.level = prev.level === 'high' ? 'low' : 'high';
  }
  return items;
}

/** Abschnitt (Section-Marker) mit Ende am nächsten Abschnitt bzw. am Ende der Timeline. */
export interface SectionSpan {
  marker: Marker;
  from: number;
  to: number;
}

export function sectionSpans(markers: readonly Marker[], totalFrames: number): SectionSpan[] {
  const sections = markers.filter((m) => m.kind === 'section').sort((a, b) => a.frame - b.frame);
  return sections.map((marker, i) => ({ marker, from: marker.frame, to: Math.max(marker.frame, sections[i + 1]?.frame ?? totalFrames) }));
}

/** Tempo aus den Beat-Markern (Median der Abstände); `null` ohne Beats. */
export function beatsPerMinute(beats: readonly number[], fps: number): number | null {
  if (beats.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i++) if (beats[i]! > beats[i - 1]!) gaps.push(beats[i]! - beats[i - 1]!);
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return Math.round((60 * fps) / median);
}

/** Nächster Schlag vor (-1) bzw. nach (1) `frame`; `null`, wenn es keinen gibt. */
export function adjacentBeat(beats: readonly number[], frame: number, direction: -1 | 1): number | null {
  if (direction > 0) return beats.find((b) => b > frame) ?? null;
  let found: number | null = null;
  for (const b of beats) {
    if (b >= frame) break;
    found = b;
  }
  return found;
}

export function frameToX(frame: number, fps: number, pxPerSecond: number): number {
  return TIMELINE_PAD + (frame / fps) * pxPerSecond;
}

export function xToFrame(x: number, fps: number, pxPerSecond: number): number {
  return Math.max(0, Math.round(((x - TIMELINE_PAD) * fps) / pxPerSecond));
}

export function framesToWidth(frames: number, fps: number, pxPerSecond: number): number {
  return (frames / fps) * pxPerSecond;
}

export function contentWidth(timeline: Pick<Timeline, 'durationFrames' | 'fps'>, pxPerSecond: number): number {
  return TIMELINE_PAD * 2 + framesToWidth(Math.max(timeline.durationFrames, timeline.fps), timeline.fps, pxPerSecond);
}

export function clampZoom(pxPerSecond: number): number {
  return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond));
}

/** Zoom, bei dem die ganze Timeline in `width` Pixel passt. */
export function fitZoom(timeline: Pick<Timeline, 'durationFrames' | 'fps'>, width: number): number {
  const seconds = Math.max(timeline.durationFrames / timeline.fps, 1);
  return clampZoom((width - TIMELINE_PAD * 2) / seconds);
}

const STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Beschriftete Hauptschritte (Sekunden) mit ≥ 80 px Abstand, dazu Nebenschritte. */
export function rulerSteps(pxPerSecond: number): { major: number; minor: number } {
  const major = STEPS.find((s) => s * pxPerSecond >= 80) ?? 600;
  const index = STEPS.indexOf(major);
  let minor = major;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = STEPS[i]!;
    if (candidate * pxPerSecond < 8) break;
    if (Math.abs(major / candidate - Math.round(major / candidate)) < 1e-9) {
      minor = candidate;
      if (major / candidate >= 4) break;
    }
  }
  return { major, minor };
}

export function formatRulerLabel(seconds: number, step: number): string {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs - m * 60;
  if (step >= 1) return `${sign}${m}:${String(Math.floor(s + 1e-9)).padStart(2, '0')}`;
  const decimals = step >= 0.1 ? 1 : 2;
  return `${sign}${m}:${s.toFixed(decimals).padStart(decimals + 3, '0')}`;
}

/** Sichtbarer Frame-Bereich mit Überhang; ohne gemessene Breite: alles. */
export function visibleFrames(
  scrollLeft: number,
  width: number,
  fps: number,
  pxPerSecond: number,
  totalFrames: number,
  overscanPx = 400,
): [number, number] {
  if (width <= 0) return [0, totalFrames];
  const from = xToFrame(Math.max(0, scrollLeft - overscanPx), fps, pxPerSecond);
  const to = xToFrame(scrollLeft + width + overscanPx, fps, pxPerSecond);
  return [Math.max(0, from - 1), Math.min(totalFrames, to + 1)];
}

export function beatFrames(markers: readonly Marker[]): number[] {
  return markers
    .filter((m) => m.kind === 'beat' || m.kind === 'downbeat')
    .map((m) => m.frame)
    .sort((a, b) => a - b);
}

/** Snapt auf den nächsten Beat/Downbeat innerhalb der Pixeltoleranz. */
export function snapToBeat(frame: number, beats: readonly number[], fps: number, pxPerSecond: number): number {
  if (beats.length === 0) return frame;
  const tolerance = Math.max(1, (SNAP_TOLERANCE_PX / pxPerSecond) * fps);
  return snapToNearest(frame, beats, tolerance);
}

/** Erstes Element ≥ `frame` per binärer Suche (Marker sind nach Frame sortiert). */
export function lowerBound(sortedFrames: readonly { frame: number }[], frame: number): number {
  let lo = 0;
  let hi = sortedFrames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedFrames[mid]!.frame < frame) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
