import { describe, expect, it } from 'vitest';
import { createTimeline, createCanvas, createDeck, assetSchema } from '@studio/core';
import { usedAssets } from '../src/assets.ts';
import { encodeWav } from '../src/media.ts';
import { parseLoudness } from '../src/audio.ts';
import { wordsForTimeline } from '../src/words.ts';

describe('portable media contracts', () => {
  it('does not miss component/prop/mask/font media during export validation', () => {
    const timeline = createTimeline(); timeline.components.overlay = { assetId: 'code', name: 'Overlay' }; timeline.tracks[1]!.clips.push({ id: 'c', start: 0, duration: 30, in: 0, speed: 1, props: { logoAsset: 'logo', rotoscope: 'mask' } });
    expect(usedAssets(timeline).sort()).toEqual(['code', 'logo', 'mask']);
    const canvas = createCanvas(); canvas.layers.push({ id: 'g', type: 'group', x: 0, y: 0, width: 100, height: 100, children: [{ id: 'i', type: 'image', x: 0, y: 0, width: 100, height: 100, assetId: 'photo', maskAssetId: 'alpha' }] });
    expect(usedAssets(canvas).sort()).toEqual(['alpha', 'photo']);
    const deck = createDeck(); deck.theme.fontAssets = { Demo: 'font' }; deck.slides.push({ id: 's', background: { assetId: 'bg' }, elements: [{ id: 'i', type: 'image', x: 0, y: 0, width: 10, height: 10, assetId: 'image' }] });
    expect(usedAssets(deck).sort()).toEqual(['bg', 'font', 'image']);
  });
  it('writes real interleaved PCM with channel/sample rate metadata and clamps clipping', async () => {
    const blob = encodeWav([new Float32Array([0, 1, -1, 2]), new Float32Array([.5, -.5, 0, -2])], 48000), bytes = await blob.arrayBuffer(), view = new DataView(bytes);
    expect(blob.type).toBe('audio/wav'); expect(view.getUint16(22, true)).toBe(2); expect(view.getUint32(24, true)).toBe(48000); expect(view.getUint32(40, true)).toBe(16); expect(view.getInt16(44 + 6 * 2, true)).toBe(32767); expect(view.getInt16(44 + 7 * 2, true)).toBe(-32768);
  });
  it('maps timed words through source offset and speed, clipping them at clip boundaries', () => {
    const timeline = createTimeline({ fps: 30, durationFrames: 180 }); timeline.tracks[3]!.clips.push({ id: 'voice', assetId: 'a', start: 60, duration: 60, in: 30, speed: 2 });
    const asset = assetSchema.parse({ id: 'a', kind: 'audio', title: 'Voice', source: 'imported', createdAt: '2026-10-01T00:00:00Z', metadata: { transcript: { words: [{ text: 'early', start: .5, end: 1.2 }, { text: 'word', start: 2, end: 3 }, { text: 'late', start: 4.8, end: 5.5 }, { text: 'outside', start: 6, end: 7 }] } } });
    expect(wordsForTimeline(timeline, [asset])).toEqual([{ text: 'early', start: 2, end: 2.1 }, { text: 'word', start: 2.5, end: 3 }, { text: 'late', start: 3.9, end: 4 }]);
  });
  it('keeps EBU loudness unavailable for silence instead of inventing a finite measurement', () => {
    expect(parseLoudness('log\n{"input_i":"-inf","input_tp":"-inf","input_lra":"0.00"}')).toMatchObject({ integratedLufs: null, truePeakDb: null, rangeLu: 0 });
    expect(parseLoudness('{"input_i":"-18.40","input_tp":"-2.11","input_lra":"3.10"}')).toMatchObject({ integratedLufs: -18.4, truePeakDb: -2.11, rangeLu: 3.1 });
  });
});
