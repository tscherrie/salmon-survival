import { describe, expect, it } from 'vitest';
import {
  alignClicksToWords,
  composerLength,
  composerToDisplayText,
  formatSeconds,
  formatTimecode,
  insertRefAt,
  isComposerEmpty,
  normalizeRef,
  normalizeSegments,
  parseRefTag,
  parseSerializedComposer,
  parseTimecode,
  parseTimecodeToFrames,
  refEquals,
  refLabel,
  secondsToFrames,
  serializeComposer,
  serializeRef,
  snapToNearest,
  type ComposerSegment,
  type Ref,
} from '../src/index.ts';

describe('time', () => {
  it('formats and parses timecodes', () => {
    expect(formatSeconds(12.4)).toBe('00:12.400');
    expect(formatSeconds(3725.5)).toBe('1:02:05.500');
    expect(formatSeconds(-1.25)).toBe('-00:01.250');
    expect(formatTimecode(372, 30)).toBe('00:12.400');
    expect(parseTimecode('00:12.400')).toBeCloseTo(12.4);
    expect(parseTimecode('1:02:05.5')).toBeCloseTo(3725.5);
    expect(parseTimecode('7')).toBe(7);
    expect(parseTimecodeToFrames('00:12.400', 30)).toBe(372);
    expect(() => parseTimecode('ab:cd')).toThrow(/Ungültiger Timecode/);
    expect(() => secondsToFrames(1, 0)).toThrow(/Bildrate/);
  });

  it('snaps to nearest candidate within tolerance', () => {
    expect(snapToNearest(101, [90, 100, 120], 3)).toBe(100);
    expect(snapToNearest(110, [90, 100, 120], 3)).toBe(110);
  });
});

describe('refs', () => {
  const refs: Ref[] = [
    { kind: 'time', frame: 372 },
    { kind: 'range', from: 372, to: 540, trackId: 'V1' },
    { kind: 'clip', clipId: 'shot_07', trackId: 'V1' },
    { kind: 'marker', markerId: 'm1' },
    { kind: 'asset', assetId: 'ast_8f2' },
    { kind: 'slide', slideId: 's3' },
    { kind: 'element', doc: 'deck', slideId: 's3', elementId: 'title' },
    { kind: 'element', doc: 'site', page: '/about', selector: 'main > h1', source: { file: 'src/About.tsx', line: 12, column: 5 }, bbox: { x: 10, y: 20, width: 300, height: 40.5 } },
    { kind: 'region', doc: 'canvas', rect: { x: 1, y: 2, width: 3, height: 4 } },
    { kind: 'region', doc: 'timeline', rect: { x: 100, y: 50, width: 400, height: 300 }, frame: 90 },
    { kind: 'version', versionNumber: 23 },
  ];

  it('round-trips every reference kind through the ref tag', () => {
    refs.forEach((ref, i) => {
      const tag = serializeRef(ref, `r${i}`, 30);
      const parsed = parseRefTag(tag, 30);
      expect(parsed.id).toBe(`r${i}`);
      expect(refEquals(parsed.ref, ref)).toBe(true);
    });
  });

  it('escapes attribute values', () => {
    const ref: Ref = { kind: 'element', doc: 'site', selector: 'a[href="/x"] > b' };
    const tag = serializeRef(ref, 'r1');
    expect(tag).toContain('&quot;');
    expect(parseRefTag(tag).ref).toEqual(ref);
  });

  it('normalizes swapped ranges and rejects invalid refs', () => {
    expect(normalizeRef({ kind: 'range', from: 50, to: 10 })).toEqual({ kind: 'range', from: 10, to: 50 });
    expect(() => normalizeRef({ kind: 'time', frame: -1 })).toThrow();
  });

  it('labels refs for chips', () => {
    expect(refLabel({ kind: 'range', from: 372, to: 540 }, { fps: 30 })).toBe('⏱ 00:12.400–00:18.000');
    expect(refLabel({ kind: 'asset', assetId: 'ast_1' }, { names: { ast_1: 'Mira v3' } })).toBe('📎 Mira v3');
    expect(refLabel({ kind: 'slide', slideId: 's3' }, { slideNumbers: { s3: 3 } })).toBe('🗂 Folie 3');
    expect(refLabel({ kind: 'element', doc: 'deck', slideId: 's3', elementId: 'title' }, { slideNumbers: { s3: 3 } })).toBe('◳ Folie 3 · title');
    expect(refLabel({ kind: 'version', versionNumber: 4 })).toBe('🕘 v4');
  });
});

describe('composer', () => {
  const range: Ref = { kind: 'range', from: 372, to: 540 };
  const asset: Ref = { kind: 'asset', assetId: 'ast_8f2' };

  it('inserts refs at positions and normalizes', () => {
    let segs: ComposerSegment[] = [{ type: 'text', text: 'Mach  dunkler' }];
    segs = insertRefAt(segs, 5, range);
    expect(segs).toEqual([
      { type: 'text', text: 'Mach ' },
      { type: 'ref', ref: range },
      { type: 'text', text: ' dunkler' },
    ]);
    expect(composerLength(segs)).toBe(5 + 1 + 8);
    segs = insertRefAt(segs, 999, asset);
    expect(segs[segs.length - 1]).toEqual({ type: 'ref', ref: asset });
    segs = insertRefAt(segs, 0, asset);
    expect(segs[0]).toEqual({ type: 'ref', ref: asset });
  });

  it('serializes with shared ids for identical refs and parses back', () => {
    const message = {
      segments: [
        { type: 'text' as const, text: 'Mach ' },
        { type: 'ref' as const, ref: range },
        { type: 'text' as const, text: ' wie ' },
        { type: 'ref' as const, ref: asset },
        { type: 'text' as const, text: ' und nochmal ' },
        { type: 'ref' as const, ref: range },
      ],
    };
    const out = serializeComposer(message, 30);
    expect(out.refs.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(out.text.match(/id="r1"/g)).toHaveLength(2);
    expect(parseSerializedComposer(out.text, 30)).toEqual(normalizeSegments(message.segments));
  });

  it('detects empty composer and renders display text', () => {
    expect(isComposerEmpty([{ type: 'text', text: '   ' }])).toBe(true);
    expect(isComposerEmpty([{ type: 'ref', ref: asset }])).toBe(false);
    expect(composerToDisplayText([{ type: 'text', text: 'Nimm ' }, { type: 'ref', ref: asset }], { names: { ast_8f2: 'Mira' } })).toBe('Nimm [📎 Mira]');
  });
});

describe('voice alignment', () => {
  const words = [
    { text: 'Mach', start: 0.1, end: 0.4 },
    { text: 'diese', start: 0.45, end: 0.7 },
    { text: 'Stelle', start: 0.75, end: 1.1 },
    { text: 'dunkler', start: 1.2, end: 1.6 },
    { text: 'bis', start: 1.9, end: 2.0 },
    { text: 'hier', start: 2.05, end: 2.3 },
    { text: '.', start: 2.3, end: 2.31 },
  ];

  it('places clicks after the word being spoken', () => {
    const a: Ref = { kind: 'time', frame: 100 };
    const b: Ref = { kind: 'time', frame: 200 };
    const segs = alignClicksToWords(words, [
      { atMs: 2200, ref: b },
      { atMs: 900, ref: a },
    ]);
    expect(segs).toEqual([
      { type: 'text', text: 'Mach diese Stelle ' },
      { type: 'ref', ref: a },
      { type: 'text', text: ' dunkler bis hier ' },
      { type: 'ref', ref: b },
      { type: 'text', text: '.' },
    ]);
  });

  it('puts early clicks first and keeps click order for ties', () => {
    const a: Ref = { kind: 'asset', assetId: 'a' };
    const b: Ref = { kind: 'asset', assetId: 'b' };
    const segs = alignClicksToWords(words.slice(0, 2), [
      { atMs: 0, ref: a },
      { atMs: 0, ref: b },
    ]);
    expect(segs).toEqual([
      { type: 'ref', ref: a },
      { type: 'text', text: ' ' },
      { type: 'ref', ref: b },
      { type: 'text', text: ' Mach diese' },
    ]);
  });

  it('handles no words', () => {
    const a: Ref = { kind: 'time', frame: 1 };
    expect(alignClicksToWords([], [{ atMs: 10, ref: a }])).toEqual([{ type: 'ref', ref: a }]);
    expect(alignClicksToWords([], [])).toEqual([]);
  });
});
