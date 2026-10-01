import { snapToNearest, type Marker, type Timeline } from '@studio/core';

/** Geometrie der Timeline-Bühne: Frames ↔ Pixel, Lineal-Raster, Beat-Snapping, Sichtbereich. */

/** Linker Innenabstand im Inhalt, damit Frame 0 gut klickbar ist. */
export const TIMELINE_PAD = 8;
/** Zoom ohne gemessene Breite (z. B. jsdom) und Startwert. */
export const DEFAULT_PX_PER_SECOND = 50;
export const MIN_PX_PER_SECOND = 0.5;
export const MAX_PX_PER_SECOND = 2000;
/** Snap-Toleranz in Pixeln (Shift-Klick auf Beat/Downbeat). */
export const SNAP_TOLERANCE_PX = 12;
/** Ab dieser Mausbewegung wird aus einem Klick ein Ziehen. */
export const DRAG_THRESHOLD_PX = 4;

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
  return markers.filter((m) => m.kind === 'beat' || m.kind === 'downbeat').map((m) => m.frame);
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
