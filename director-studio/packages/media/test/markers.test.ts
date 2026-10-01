import { applyTimelineOps, createTimeline, markerSchema } from '@studio/core';
import { describe, expect, it } from 'vitest';
import { beatMarkers, type BeatAnalysis } from '../src/index.ts';

const analysis = (beats: number[], downbeats: number[]): BeatAnalysis => ({ bpm: 120, beats, downbeats, onsets: [], confidence: 0.9 });

describe('beatMarkers', () => {
  it('erzeugt beat/downbeat-Marker mit frame = round(sec·fps), sortiert, Downbeat statt Beat', () => {
    const markers = beatMarkers(analysis([0.5, 1, 1.5, 2, 2.5], [0.5, 2.5]), 30);
    expect(markers.map((m) => [m.frame, m.kind])).toEqual([
      [15, 'downbeat'],
      [30, 'beat'],
      [45, 'beat'],
      [60, 'beat'],
      [75, 'downbeat'],
    ]);
    expect(new Set(markers.map((m) => m.id)).size).toBe(markers.length);
    expect(markers[0]!.id).toBe('beat_db0');
    expect(markers[1]!.id).toBe('beat_b1');
    for (const m of markers) expect(markerSchema.parse(m)).toEqual(m);
  });

  it('includeBeats=false liefert nur Downbeats; idPrefix wird verwendet', () => {
    const markers = beatMarkers(analysis([0.5, 1, 1.5, 2, 2.5], [0.5, 2.5]), 25, { idPrefix: 'song7', includeBeats: false });
    expect(markers).toEqual([
      { id: 'song7_db0', frame: 13, kind: 'downbeat' },
      { id: 'song7_db1', frame: 63, kind: 'downbeat' },
    ]);
  });

  it('ein Marker pro Frame: Rundungskollisionen werden zusammengefasst, Downbeat gewinnt auch bei minimal abweichender Zeit', () => {
    const markers = beatMarkers(analysis([0.4999, 0.52, 1.0, 1.01], [0.5001]), 10);
    expect(markers.map((m) => [m.frame, m.kind, m.id])).toEqual([
      [5, 'downbeat', 'beat_db0'],
      [10, 'beat', 'beat_b2'],
    ]);
  });

  it('verwirft negative und ungültige Zeiten, berücksichtigt offsetSec', () => {
    const markers = beatMarkers(analysis([-0.5, Number.NaN, 0.25, 1], [Number.POSITIVE_INFINITY]), 24, { offsetSec: 2 });
    // −0,5 + 2 = 1,5 s ist gültig; NaN/∞ fallen weg
    expect(markers.map((m) => m.frame)).toEqual([36, 54, 72]);
    expect(beatMarkers(analysis([0.1], []), 30, { offsetSec: -1 })).toEqual([]);
    expect(beatMarkers(analysis([], []), 30)).toEqual([]);
  });

  it('lehnt ungültige Bildraten und Versätze ab', () => {
    expect(() => beatMarkers(analysis([1], []), 0)).toThrow(/Bildrate/);
    expect(() => beatMarkers(analysis([1], []), Number.NaN)).toThrow(/Bildrate/);
    expect(() => beatMarkers(analysis([1], []), 30, { offsetSec: Number.NaN })).toThrow(/Versatz/);
  });

  it('lässt sich per add_marker auf eine Timeline schreiben (eindeutige IDs)', () => {
    const tl = createTimeline({ fps: 30, durationFrames: 300 });
    const beats = Array.from({ length: 16 }, (_, i) => 0.25 + i * 0.5);
    const markers = beatMarkers(analysis(beats, beats.filter((_, i) => i % 4 === 0)), tl.fps, { idPrefix: 'ast1' });
    const next = applyTimelineOps(tl, markers.map((marker) => ({ op: 'add_marker' as const, marker })));
    expect(next.markers).toHaveLength(16);
    expect(next.markers.filter((m) => m.kind === 'downbeat').map((m) => m.frame)).toEqual([8, 68, 128, 188]);
  });
});
