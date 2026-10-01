import type { ComposerSegment, VoiceClick } from '@studio/core';
import { refKey } from '../lib/refNumbers.ts';
import type { StudioData } from './types.ts';

/**
 * Abgeleitete Daten des Stores. Selektoren, die neue Arrays bauen, merken sich ihr letztes Ergebnis, damit
 * `useStudio(selector)` eine stabile Referenz bekommt.
 */

/** Ein Nutzer-Marker der Timeline: ein `time`-Chip im Composer (DESIGN.md §8.1). */
export interface UserMarker {
  key: string;
  frame: number;
  /** Nummer des Chips; 0, solange der Marker schwebt. */
  n: number;
  /** Während der Sprachaufnahme gesetzt: Tag als Umriss, ohne Nummer, bis die Transkription die Chips einsetzt. */
  pending: boolean;
}

function dedupeByKey<T extends { key: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)));
}

/** Marker aus Composer (nummeriert) und laufender Aufnahme (schwebend), nach Frame sortiert, ohne Duplikate. */
export function computeUserMarkers(s: Pick<StudioData, 'composer' | 'refNumbers' | 'voice'>): UserMarker[] {
  const fromComposer = s.composer.flatMap((seg) =>
    seg.type === 'ref' && seg.ref.kind === 'time' ? [{ key: refKey(seg.ref), frame: seg.ref.frame, n: s.refNumbers[refKey(seg.ref)] ?? 0, pending: false }] : [],
  );
  const fromVoice = s.voice.recording
    ? s.voice.clicks.flatMap((c) => (c.ref.kind === 'time' ? [{ key: refKey(c.ref), frame: c.ref.frame, n: 0, pending: true }] : []))
    : [];
  return dedupeByKey([...fromComposer, ...fromVoice]).sort((a, b) => a.frame - b.frame);
}

let lastInput: { composer: ComposerSegment[]; refNumbers: Record<string, number>; recording: boolean; clicks: VoiceClick[] } | null = null;
let lastMarkers: UserMarker[] = [];

/** Wie `computeUserMarkers`, aber mit stabiler Referenz, solange sich die Eingaben nicht ändern. */
export function selectUserMarkers(s: StudioData): UserMarker[] {
  const input = { composer: s.composer, refNumbers: s.refNumbers, recording: s.voice.recording, clicks: s.voice.clicks };
  if (
    lastInput &&
    lastInput.composer === input.composer &&
    lastInput.refNumbers === input.refNumbers &&
    lastInput.recording === input.recording &&
    lastInput.clicks === input.clicks
  ) {
    return lastMarkers;
  }
  lastInput = input;
  lastMarkers = computeUserMarkers(s);
  return lastMarkers;
}

/** Nummer einer Referenz (über ihren Schlüssel); `undefined` bei Assets, Versionen und nicht vorhandenen Refs. */
export function selectRefNumber(s: StudioData, key: string): number | undefined {
  return s.refNumbers[key];
}
