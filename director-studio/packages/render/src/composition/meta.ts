import { STANDARD_FORMATS, type FormatSpec, type Timeline } from '@studio/core';

/** Formate, Kompositions-Metadaten und Safe Areas. */

export interface ResolvedFormat {
  id: string;
  width: number;
  height: number;
}

/**
 * Löst eine Formatvariante auf: zuerst `timeline.formats`, dann Standardformate (`16:9`, `9:16`, `1:1`,
 * `4:5`), dann ein beliebiges Seitenverhältnis `B:H` (kurze Kante = kurze Kante der Timeline).
 * Ohne `formatId`: erstes Format der Timeline bzw. Timeline-Größe.
 */
export function resolveFormat(timeline: Pick<Timeline, 'width' | 'height' | 'formats'>, formatId?: string): ResolvedFormat {
  const formats: FormatSpec[] = timeline.formats ?? [];
  if (formatId) {
    const own = formats.find((f) => f.id === formatId);
    if (own) return { id: own.id, width: own.width, height: own.height };
    const std = STANDARD_FORMATS[formatId];
    if (std) return { id: std.id, width: std.width, height: std.height };
    const ratio = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/.exec(formatId.trim());
    if (ratio) {
      const rw = Number(ratio[1]);
      const rh = Number(ratio[2]);
      if (rw > 0 && rh > 0) {
        const short = Math.min(timeline.width, timeline.height);
        const width = rw >= rh ? even((short * rw) / rh) : even(short);
        const height = rw >= rh ? even(short) : even((short * rh) / rw);
        return { id: formatId, width, height };
      }
    }
    throw new Error(`Unbekanntes Format "${formatId}" (bekannt: ${[...formats.map((f) => f.id), ...Object.keys(STANDARD_FORMATS)].filter((v, i, a) => a.indexOf(v) === i).join(', ')})`);
  }
  const first = formats[0];
  if (first) return { id: first.id, width: first.width, height: first.height };
  return { id: `${timeline.width}x${timeline.height}`, width: timeline.width, height: timeline.height };
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export interface CompositionMeta {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

/** Metadaten für `<Composition>`/`calculateMetadata` und den Player. */
export function computeCompositionMeta(timeline: Pick<Timeline, 'width' | 'height' | 'formats' | 'fps' | 'durationFrames'>, formatId?: string): CompositionMeta {
  const format = resolveFormat(timeline, formatId);
  return {
    width: format.width,
    height: format.height,
    fps: timeline.fps,
    durationInFrames: Math.max(1, Math.round(timeline.durationFrames)),
  };
}

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Titel-Safe-Area in Pixeln. Hochformat (9:16) reserviert oben/unten Platz für die UI sozialer
 * Plattformen, Querformat nutzt klassische Title-Safe-Ränder.
 */
export function getSafeArea(width: number, height: number): SafeArea {
  const aspect = width / height;
  if (aspect < 0.7) {
    return { top: Math.round(height * 0.12), bottom: Math.round(height * 0.2), left: Math.round(width * 0.065), right: Math.round(width * 0.065) };
  }
  if (aspect <= 1.05) {
    return { top: Math.round(height * 0.07), bottom: Math.round(height * 0.1), left: Math.round(width * 0.07), right: Math.round(width * 0.07) };
  }
  return { top: Math.round(height * 0.06), bottom: Math.round(height * 0.08), left: Math.round(width * 0.06), right: Math.round(width * 0.06) };
}

/** Dezibel → linearer Faktor. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
