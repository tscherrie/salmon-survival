import type { ModelInfo } from '@studio/core';
import { describe, expect, it } from 'vitest';
import { estimateCostUsd, outputDimensions, parseUnit, SEED_MODELS } from '../src/index.ts';

const seed = (id: string): ModelInfo => {
  const m = SEED_MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Seed fehlt: ${id}`);
  return m;
};

const model = (unitPrice: number, unit: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({
  id: 'acme/model',
  provider: 'fal',
  modality: 'video',
  displayName: 'Acme',
  description: '',
  capabilities: {},
  price: { unitPrice, unit, currency: 'USD' },
  ...extra,
});

describe('parseUnit', () => {
  it.each([
    ['seconds', 'second', 1],
    ['second', 'second', 1],
    ['5 seconds', 'second', 5],
    ['10 second of generated audio', 'second', 10],
    ['minutes', 'minute', 1],
    ['input audio minutes', 'minute', 1],
    ['images', 'image', 1],
    ['image', 'image', 1],
    ['megapixels', 'megapixel', 1],
    ['megapixel of input and output', 'megapixel', 1],
    ['megapixel of generated video data', 'video_megapixel', 1],
    ['1k characters', 'characters', 1000],
    ['1000 characters', 'characters', 1000],
    ['1M input tokens', 'tokens', 1_000_000],
    ['videos', 'video', 1],
    ['video', 'video', 1],
    ['requests', 'request', 1],
    ['generation', 'request', 1],
    ['compute seconds', 'compute_second', 1],
    ['30 frames', 'frame', 30],
    ['units', 'unknown', 1],
    ['', 'unknown', 1],
  ])('%s → %s × %d', (unit, kind, size) => {
    expect(parseUnit(unit)).toMatchObject({ kind, size });
  });
});

describe('estimateCostUsd · seconds', () => {
  const h3 = seed('minimax/h3-max/text-to-video');

  it('duration × price at the default resolution is exact', () => {
    expect(estimateCostUsd(h3, { prompt: 'x', duration: 10, resolution: '768P' })).toEqual({ usd: 0.8, basis: '10 s × $0.080/s ≈ $0.80', exact: true });
  });

  it('applies the h3-max resolution tier (1080P = ×2)', () => {
    const est = estimateCostUsd(h3, { duration: 10, resolution: '1080P' });
    expect(est.usd).toBeCloseTo(1.6);
    expect(est.exact).toBe(false);
    expect(est.basis).toBe('10 s × $0.080/s × 2 ≈ $1.60 (1080P: ×2 ggü. 768P (Staffel ungeprüft))');
    expect(estimateCostUsd(h3, { duration: 5, resolution: '480p' }).usd).toBeCloseTo(0.25);
    expect(estimateCostUsd(seed('minimax/h3-max-turbo/text-to-video'), { duration: 5, resolution: '1080P' }).usd).toBeCloseTo(0.4);
  });

  it('defaults to the smallest allowed duration', () => {
    const est = estimateCostUsd(h3, { prompt: 'x' });
    expect(est.usd).toBeCloseTo(0.4);
    expect(est.exact).toBe(false);
    expect(est.basis).toContain('kleinste erlaubte');
    expect(est.basis).toContain('768P-Preis angenommen');
  });

  it('reads string durations and the veo audio rule', () => {
    const veo = seed('fal-ai/veo3.1');
    expect(estimateCostUsd(veo, { duration: '6s' }).usd).toBeCloseTo(2.4);
    expect(estimateCostUsd(veo, { duration: '6s', generate_audio: false }).usd).toBeCloseTo(1.2);
  });

  it('num_frames ÷ fps', () => {
    const est = estimateCostUsd(model(0.1, 'seconds'), { num_frames: 121, fps: 24 });
    expect(est.usd).toBeCloseTo(0.504167, 5);
    expect(est.exact).toBe(true);
    expect(est.basis).toContain('121 Frames ÷ 24 fps');
  });

  it('step units ("5 seconds") round up', () => {
    const est = estimateCostUsd(model(0.1, '5 seconds'), { duration: 12 });
    expect(est.usd).toBeCloseTo(0.3);
    expect(est.basis).toBe('3 × 5 s (12 s) × $0.100/5 s ≈ $0.30');
  });

  it('input-media billing uses hints and the kling 5-s rounding', () => {
    const kling = seed('fal-ai/kling-video/lipsync/audio-to-video');
    const est = estimateCostUsd(kling, { video_url: 'https://x/v.mp4', audio_url: 'https://x/a.mp3' }, { mediaDurationSec: 3 });
    expect(est.usd).toBeCloseTo(0.07);
    expect(est.basis).toContain('auf 5-s-Schritte aufgerundet');
    expect(estimateCostUsd(seed('fal-ai/demucs'), { audio_url: 'x' }, { mediaDurationSec: 200 }).usd).toBeCloseTo(0.14);
  });

  it('sound effects use duration_seconds', () => {
    expect(estimateCostUsd(seed('fal-ai/elevenlabs/sound-effects/v2'), { text: 'whoosh', duration_seconds: 4 })).toMatchObject({ usd: 0.008, exact: true });
  });
});

describe('estimateCostUsd · minutes', () => {
  it('uses the input media duration (STT per audio minute)', () => {
    const scribe = seed('fal-ai/elevenlabs/speech-to-text/scribe-v2');
    expect(estimateCostUsd(scribe, { audio_url: 'x' }, { mediaDurationSec: 90 })).toMatchObject({ usd: 0.012, exact: true });
    const unknown = estimateCostUsd(scribe, { audio_url: 'x' });
    expect(unknown).toMatchObject({ usd: 0.008, exact: false });
    expect(unknown.basis).toContain('60 s angenommen');
  });

  it('reads millisecond durations (music_length_ms)', () => {
    expect(estimateCostUsd(seed('fal-ai/elevenlabs/music'), { prompt: 'x', music_length_ms: 90_000 })).toMatchObject({ usd: 1.2, exact: true });
  });
});

describe('estimateCostUsd · images and megapixels', () => {
  it('images × num_images with nano-banana-pro modifiers', () => {
    const nano = seed('fal-ai/nano-banana-pro');
    expect(estimateCostUsd(nano, { prompt: 'x', num_images: 2 })).toEqual({ usd: 0.3, basis: '2 Bilder × $0.150/Bild ≈ $0.30', exact: true });
    expect(estimateCostUsd(nano, { prompt: 'x', resolution: '4K' }).usd).toBeCloseTo(0.3);
    expect(estimateCostUsd(nano, { prompt: 'x', resolution: '4K', enable_web_search: true }).usd).toBeCloseTo(0.315);
  });

  it('megapixels from presets, width/height, resolution and aspect ratio (1 MP = 1024², rounded up per image)', () => {
    const mp = model(0.025, 'megapixels', { modality: 'image' });
    expect(estimateCostUsd(mp, { image_size: 'landscape_16_9' })).toMatchObject({ usd: 0.025, exact: true });
    expect(estimateCostUsd(mp, { image_size: { width: 1920, height: 1080 } })).toMatchObject({ usd: 0.05, exact: true });
    expect(estimateCostUsd(mp, { resolution: '1080p', aspect_ratio: '16:9', num_images: 2 }).usd).toBeCloseTo(0.1);
    expect(estimateCostUsd(mp, { aspect_ratio: '1:1' })).toMatchObject({ usd: 0.025, exact: false });
    expect(estimateCostUsd(mp, {}).basis).toContain('Bildgröße geschätzt');
  });

  it('FLUX.2 [pro]: first MP full price, additional MPs half price', () => {
    const flux = seed('fal-ai/flux-2-pro');
    expect(estimateCostUsd(flux, { image_size: { width: 1024, height: 1024 } }).usd).toBeCloseTo(0.03);
    expect(estimateCostUsd(flux, { image_size: { width: 1920, height: 1080 } }).usd).toBeCloseTo(0.045);
  });

  it('video megapixels = width × height × frames / 1e6', () => {
    const est = estimateCostUsd(model(0.001, 'megapixel of generated video data'), { resolution: '1080p', duration: 5 });
    expect(est.usd).toBeCloseTo(0.248832, 6);
    expect(est.exact).toBe(false);
  });

  it('outputDimensions understands K resolutions and portrait ratios', () => {
    expect(outputDimensions({ resolution: '2K', aspect_ratio: '1:1' })).toEqual({ width: 2048, height: 2048, exact: true });
    expect(outputDimensions({ resolution: '720p', aspect_ratio: '9:16' })).toEqual({ width: 720, height: 1280, exact: true });
    expect(outputDimensions({ resolution: '1280x720' })).toEqual({ width: 1280, height: 720, exact: true });
    expect(outputDimensions({}, { mediaWidth: 640, mediaHeight: 480 })).toEqual({ width: 640, height: 480, exact: false });
  });
});

describe('estimateCostUsd · characters, tokens, flat, compute, unknown', () => {
  it('1k characters from text length', () => {
    const tts = seed('fal-ai/elevenlabs/tts/eleven-v3');
    expect(estimateCostUsd(tts, { text: 'a'.repeat(2500) })).toEqual({ usd: 0.25, basis: '2500 Zeichen × $0.100/1k Zeichen ≈ $0.25', exact: true });
    expect(estimateCostUsd(tts, { text: 'Grüße 👋' }).usd).toBeCloseTo(0.0007, 6);
    expect(estimateCostUsd(tts, {})).toMatchObject({ usd: 0.1, exact: false });
  });

  it('tokens are a heuristic', () => {
    const est = estimateCostUsd(model(4, '1M input tokens', { modality: 'text' }), { prompt: 'x'.repeat(400) });
    expect(est.usd).toBeCloseTo(0.0044, 6);
    expect(est.exact).toBe(false);
  });

  it('flat per request / per video', () => {
    expect(estimateCostUsd(seed('fal-ai/lyria2'), { prompt: 'x' })).toMatchObject({ usd: 0.1, exact: true });
    expect(estimateCostUsd(model(0.2, 'videos'), { num_videos: 3 })).toMatchObject({ usd: 0.6, exact: true });
    expect(estimateCostUsd(seed('fal-ai/sam-3/image'), { image_url: 'x' })).toMatchObject({ usd: 0.005, exact: true });
  });

  it('compute seconds use a heuristic', () => {
    expect(estimateCostUsd(seed('fal-ai/birefnet/v2'), { image_url: 'x' })).toMatchObject({ usd: 0.008, exact: false });
    expect(estimateCostUsd(seed('fal-ai/rife/video'), { video_url: 'x' }, { mediaDurationSec: 30 }).usd).toBeCloseTo(0.039);
  });

  it('unknown units → 1 × unit price, not exact', () => {
    const est = estimateCostUsd(model(0.05, 'units'), {});
    expect(est).toMatchObject({ usd: 0.05, exact: false });
    expect(est.basis).toContain('Einheit „units“ unbekannt');
  });

  it('no price → 0 and not exact; foreign currency is flagged', () => {
    expect(estimateCostUsd(seed('fal-ai/wizper'), {})).toEqual({ usd: 0, basis: 'Kein Preis bekannt – Kosten unbekannt', exact: false });
    const eur = estimateCostUsd(model(1, 'requests', { price: { unitPrice: 1, unit: 'requests', currency: 'EUR' } }), {});
    expect(eur.exact).toBe(false);
    expect(eur.basis).toContain('Währung EUR');
  });

  it('tolerates non-object input', () => {
    expect(estimateCostUsd(seed('fal-ai/lyria2'), null as unknown as Record<string, unknown>).usd).toBeCloseTo(0.1);
  });
});
