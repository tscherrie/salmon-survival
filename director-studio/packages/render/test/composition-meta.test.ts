import { describe, expect, it } from 'vitest';
import {
  clipFadeFactor,
  computeClipVolume,
  computeCompositionMeta,
  computeMediaStyle,
  duckingDb,
  getSafeArea,
  makeClipRandom,
  orderVisualTracks,
  planTrackClips,
  resolveFormat,
  seededRandom,
  synthesizeWords,
  wordsInClip,
} from '../src/browser.ts';
import { timeline } from './helpers.ts';

describe('Formate und Metadaten', () => {
  const tl = timeline({
    tracks: [],
    durationFrames: 450,
    formats: [
      { id: '16:9', width: 1920, height: 1080 },
      { id: 'quadrat', width: 1200, height: 1200 },
    ],
  });

  it('resolveFormat: eigene, Standard- und freie Formate', () => {
    expect(resolveFormat(tl)).toEqual({ id: '16:9', width: 1920, height: 1080 });
    expect(resolveFormat(tl, 'quadrat')).toEqual({ id: 'quadrat', width: 1200, height: 1200 });
    expect(resolveFormat(tl, '9:16')).toEqual({ id: '9:16', width: 1080, height: 1920 });
    expect(resolveFormat(tl, '4:5')).toEqual({ id: '4:5', width: 1080, height: 1350 });
    expect(resolveFormat(tl, '21:9')).toEqual({ id: '21:9', width: 2520, height: 1080 });
    expect(() => resolveFormat(tl, 'kino')).toThrow(/Unbekanntes Format "kino"/);
    expect(resolveFormat({ width: 640, height: 360, formats: [] })).toEqual({ id: '640x360', width: 640, height: 360 });
  });

  it('computeCompositionMeta füllt das gewählte Format', () => {
    expect(computeCompositionMeta(tl)).toEqual({ width: 1920, height: 1080, fps: 30, durationInFrames: 450 });
    expect(computeCompositionMeta(tl, '9:16')).toEqual({ width: 1080, height: 1920, fps: 30, durationInFrames: 450 });
    expect(computeCompositionMeta({ ...tl, durationFrames: 0 }).durationInFrames).toBe(1);
  });

  it('Safe Area je Seitenverhältnis', () => {
    const wide = getSafeArea(1920, 1080);
    const tall = getSafeArea(1080, 1920);
    expect(wide.bottom).toBe(86);
    expect(tall.bottom).toBe(384);
    expect(tall.top).toBeGreaterThan(wide.top);
  });
});

describe('Deterministischer Zufall', () => {
  it('seededRandom ist reproduzierbar und gleichverteilt-ish', () => {
    const a = seededRandom('clip-1');
    const b = seededRandom('clip-1');
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    const c = seededRandom('clip-2');
    expect(c()).not.toBe(seqA[0]);
    const r = seededRandom('verteilung');
    const values = Array.from({ length: 2000 }, () => r());
    const mean = values.reduce((x, y) => x + y, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('makeClipRandom hängt von Clip, Frame und Salt ab – und von nichts sonst', () => {
    const r = makeClipRandom('ov_1', 12);
    expect(r('x')).toBe(r('x'));
    expect(r('x')).toBe(makeClipRandom('ov_1', 12)('x'));
    expect(r('x')).not.toBe(r('y'));
    expect(r('x')).not.toBe(makeClipRandom('ov_1', 13)('x'));
    expect(r()).toBe(r(''));
  });
});

describe('Medien-Layout', () => {
  it('cover mit bekannten Maßen zentriert exakt und klemmt an den Rand', () => {
    const s = computeMediaStyle({ boxWidth: 1080, boxHeight: 1920, mediaWidth: 1920, mediaHeight: 1080, fit: 'cover', centerX: 0.62, centerY: 0.5 });
    // Skalierung 1920/1080 → 3413,33 × 1920; left = 540 − 0,62·3413,33 = −1576,27
    expect(s.width).toBeCloseTo(3413.33, 1);
    expect(s.left).toBeCloseTo(-1576.27, 1);
    const clamped = computeMediaStyle({ boxWidth: 1080, boxHeight: 1920, mediaWidth: 1920, mediaHeight: 1080, fit: 'cover', centerX: 1 });
    expect(clamped.left).toBeCloseTo(1080 - 3413.33, 1);
  });

  it('ohne Maße: object-fit/object-position', () => {
    const s = computeMediaStyle({ boxWidth: 100, boxHeight: 100, fit: 'contain', centerX: 0.2, centerY: 0.8, zoom: 1.5 });
    expect(s.objectFit).toBe('contain');
    expect(s.objectPosition).toBe('20% 80%');
    expect(s.transform).toBe('scale(1.5)');
  });
});

describe('Spurplanung, Ebenen und Ton', () => {
  it('orderVisualTracks: Video unten, Audio/ausgeblendet raus', () => {
    const tl = timeline({
      tracks: [
        { id: 'T1', kind: 'text' },
        { id: 'A1', kind: 'audio' },
        { id: 'V2', kind: 'video' },
        { id: 'O1', kind: 'overlay' },
        { id: 'V1', kind: 'video', hidden: true },
      ],
    });
    expect(orderVisualTracks(tl).map((t) => t.id)).toEqual(['V2', 'T1', 'O1']);
  });

  it('planTrackClips verlängert den Vorgänger bei Überblendung (begrenzt durch Quelllänge)', () => {
    const plan = planTrackClips(
      {
        clips: [
          { id: 'a', start: 0, duration: 30, in: 0, speed: 1, assetId: 'v' },
          { id: 'b', start: 30, duration: 30, in: 0, speed: 1, assetId: 'v', transitionIn: { type: 'crossfade', durationFrames: 12 } },
          { id: 'c', start: 60, duration: 30, in: 0, speed: 1, assetId: 'v', transitionIn: { type: 'dip', durationFrames: 9 } },
        ],
      },
      { v: { id: 'v', kind: 'video', url: 'x', durationMs: 1200 } },
      30,
    );
    // Quelle: 36 Frames → a kann nur 6 Frames verlängert werden
    expect(plan[0]!.renderDuration).toBe(36);
    expect(plan[1]!.renderDuration).toBe(30);
    expect(plan[1]!.tailDipFrames).toBe(5);
    expect(plan[2]!.renderDuration).toBe(30);
  });

  it('Clip-Fades und Lautstärke mit Ducking', () => {
    const clip = { start: 0, duration: 100, fadeInFrames: 9, fadeOutFrames: 9 };
    expect(clipFadeFactor(clip, 0)).toBeCloseTo(0.1, 5);
    expect(clipFadeFactor(clip, 50)).toBe(1);
    expect(clipFadeFactor(clip, 99)).toBeCloseTo(0.1, 5);
    const tl = timeline({
      tracks: [
        { id: 'A1', kind: 'audio', role: 'voice', clips: [{ id: 'vo', start: 40, duration: 20, assetId: 'x' }] },
        { id: 'A2', kind: 'audio', role: 'music', gainDb: -6, duck: { byTrackId: 'A1', db: -12 }, clips: [{ id: 'm', start: 0, duration: 90, assetId: 'y' }] },
      ],
    });
    const music = tl.tracks[1]!;
    expect(duckingDb(tl, music, 10, 30)).toBe(0);
    expect(duckingDb(tl, music, 45, 30)).toBe(-12);
    // Standard wie im Export-Mix: 150 ms Vorlauf (4,5 Frames), 200 ms Attack (6 Frames) → bei Frame 37 ein Viertel.
    expect(duckingDb(tl, music, 37, 30)).toBeCloseTo(-3, 5);
    expect(computeClipVolume(tl, music, music.clips[0]!, 10)).toBeCloseTo(10 ** (-6 / 20), 5);
    expect(computeClipVolume(tl, music, music.clips[0]!, 45)).toBeCloseTo(10 ** (-18 / 20), 5);
  });

  it('Wörter im Clipfenster und synthetische Verteilung', () => {
    const words = [
      { text: 'a', start: 0, end: 0.4 },
      { text: 'b', start: 0.9, end: 1.2 },
      { text: 'c', start: 2, end: 2.5 },
    ];
    expect(wordsInClip(words, { start: 30, duration: 30 }, 30).map((w) => w.text)).toEqual(['b']);
    const synth = synthesizeWords('ein langes Wort', { start: 30, duration: 60 }, 30);
    expect(synth.map((w) => w.text)).toEqual(['ein', 'langes', 'Wort']);
    expect(synth[0]!.start).toBe(1);
    expect(synth[2]!.end).toBeCloseTo(3, 10);
  });
});
