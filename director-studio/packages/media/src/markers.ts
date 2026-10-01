import type { Marker } from '@studio/core';
import type { BeatAnalysis } from './types.ts';

export interface BeatMarkerOptions {
  /** Präfix der Marker-IDs (Standard `beat`); je Quelle eindeutig wählen, damit IDs nicht mit vorhandenen kollidieren. */
  idPrefix?: string;
  /** Auch normale Beats erzeugen, nicht nur Downbeats (Standard true). */
  includeBeats?: boolean;
  /** Startzeit des analysierten Audios auf der Timeline (s), wird zu jeder Zeit addiert (Standard 0). */
  offsetSec?: number;
}

/**
 * Wandelt eine Beat-Analyse in Timeline-Marker um (`beat`/`downbeat`, `frame = round(sec·fps)`).
 * Pro Frame entsteht höchstens ein Marker; fällt ein Beat auf denselben Frame wie ein Downbeat,
 * gewinnt der Downbeat. Zeiten vor 0 und ungültige Werte werden verworfen. IDs sind eindeutig und
 * stabil (`<präfix>_db<i>` bzw. `<präfix>_b<i>` mit dem Index in `downbeats`/`beats`), Ergebnis nach Frame sortiert.
 */
export function beatMarkers(analysis: BeatAnalysis, fps: number, opts: BeatMarkerOptions = {}): Marker[] {
  if (!(fps > 0) || !Number.isFinite(fps)) throw new Error(`Ungültige Bildrate: ${fps}`);
  const offset = opts.offsetSec ?? 0;
  if (!Number.isFinite(offset)) throw new Error(`Ungültiger Versatz: ${offset}`);
  const prefix = opts.idPrefix ?? 'beat';
  const byFrame = new Map<number, Marker>();
  const add = (times: readonly number[], kind: 'beat' | 'downbeat', tag: string) => {
    times.forEach((sec, i) => {
      if (!Number.isFinite(sec)) return;
      const frame = Math.round((sec + offset) * fps);
      if (!(frame >= 0) || byFrame.has(frame)) return;
      byFrame.set(frame, { id: `${prefix}_${tag}${i}`, frame, kind });
    });
  };
  add(analysis.downbeats, 'downbeat', 'db');
  if (opts.includeBeats !== false) add(analysis.beats, 'beat', 'b');
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}
