import { describe, expect, it } from 'vitest';
import { alsoModalitiesFor, deriveCapabilities, describeCapabilities, extractInputSchema, modalityForCategory, parseDurationValue } from '../src/index.ts';
import { editSchema, fluxOpenApi, h3MaxOpenApi, lipsyncSchema, musicSchema, samOpenApi, sfxSchema, veoSchema, whisperSchema } from './fixtures.ts';

describe('deriveCapabilities', () => {
  it('h3-max: durations, max, aspect ratios, resolutions, seed, audio + multi-image references', () => {
    const caps = deriveCapabilities(extractInputSchema(h3MaxOpenApi, 'minimax/h3-max/text-to-video'));
    expect(caps).toEqual({
      durations: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      maxDurationSec: 15,
      resolutions: ['480P', '768P', '1080P'],
      aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      seed: true,
      audioInput: true,
      imageInput: true,
      multiImageInput: true,
    });
  });

  it('flux: image_size presets → aspect ratios; counts/sizes are not image inputs', () => {
    const caps = deriveCapabilities(extractInputSchema(fluxOpenApi, 'fal-ai/flux/dev'));
    expect(caps).toEqual({ aspectRatios: ['1:1', '3:4', '9:16', '4:3', '16:9'], seed: true });
  });

  it('veo: string durations ("8s") and native audio flag', () => {
    expect(deriveCapabilities(veoSchema)).toEqual({
      aspectRatios: ['16:9', '9:16'],
      durations: [4, 6, 8],
      maxDurationSec: 8,
      resolutions: ['720p', '1080p'],
      nativeAudio: true,
      seed: true,
    });
  });

  it('whisper: audio input + word timestamps via chunk_level', () => {
    expect(deriveCapabilities(whisperSchema)).toEqual({ audioInput: true, wordTimestamps: true });
  });

  it('lipsync: video + audio input; enum strings are not media', () => {
    expect(deriveCapabilities(lipsyncSchema)).toEqual({ videoInput: true, audioInput: true });
  });

  it('edit: multiple image urls, aspect ratios without "auto"', () => {
    expect(deriveCapabilities(editSchema)).toEqual({
      imageInput: true,
      multiImageInput: true,
      aspectRatios: ['16:9', '1:1', '4:5', '9:16'],
      resolutions: ['1K', '2K', '4K'],
    });
  });

  it('max duration from numeric ranges, including milliseconds', () => {
    expect(deriveCapabilities(sfxSchema)).toEqual({ maxDurationSec: 22 });
    expect(deriveCapabilities(musicSchema)).toEqual({ maxDurationSec: 600 });
  });

  it('image input detected from description; segmentation prompts are no media', () => {
    expect(deriveCapabilities(extractInputSchema(samOpenApi, 'fal-ai/sam-3/image'))).toEqual({ imageInput: true });
    expect(deriveCapabilities({ properties: { source: { type: 'string', description: 'URL of the image to upscale' } } })).toEqual({ imageInput: true });
    expect(deriveCapabilities({ properties: { start_image_url: { type: 'string' }, first_frame_url: { type: 'string' } } })).toEqual({ imageInput: true });
    expect(deriveCapabilities({ properties: { audio_format: { type: 'string' }, voice: { type: 'string' }, image_size: { type: 'string' }, num_images: { type: 'integer' } } })).toEqual({});
  });

  it('parses duration values', () => {
    expect(parseDurationValue('8s')).toBe(8);
    expect(parseDurationValue('10')).toBe(10);
    expect(parseDurationValue(5)).toBe(5);
    expect(parseDurationValue(3000, true)).toBe(3);
    expect(parseDurationValue('1500ms')).toBe(1.5);
    expect(parseDurationValue('auto')).toBeUndefined();
  });

  it('describes capabilities as German badges', () => {
    expect(describeCapabilities({ audioInput: true, imageInput: true, multiImageInput: true, nativeAudio: true, durations: [5, 6, 7, 8, 9, 10], aspectRatios: ['16:9'], seed: true, wordTimestamps: true })).toEqual([
      'Audio-Eingang',
      'Bild-Eingang (mehrere Referenzbilder)',
      'Native Tonspur',
      'Dauer: 5–10 s',
      'Formate: 16:9',
      'Seed',
      'Wortzeitstempel',
    ]);
    expect(describeCapabilities({ durations: [4, 6, 8] })).toEqual(['Dauer: 4/6/8 s']);
    expect(describeCapabilities({ maxDurationSec: 22 })).toEqual(['max. 22 s']);
  });
});

describe('modalityForCategory', () => {
  const cases: Array<[string, string, string | null]> = [
    ['text-to-image', 'fal-ai/flux/dev', 'image'],
    ['image-to-image', 'fal-ai/nano-banana-pro/edit', 'image'],
    ['text-to-video', 'minimax/h3-max/text-to-video', 'video'],
    ['image-to-video', 'fal-ai/kling-video/v2.6/pro/image-to-video', 'video'],
    ['video-to-video', 'minimax/h3-max/extend-video', 'video'],
    ['video-to-video', 'fal-ai/sync-lipsync/v2', 'lipsync'],
    ['image-to-video', 'fal-ai/bytedance/omnihuman/v1.5', 'lipsync'],
    ['image-to-video', 'minimax/h3-max/lip-sync/image-to-video', 'lipsync'],
    ['text-to-video', 'fal-ai/kling-video/lipsync/audio-to-video', 'lipsync'],
    ['audio-to-video', 'argil/avatars/audio-to-video', 'lipsync'],
    ['text-to-speech', 'fal-ai/elevenlabs/tts/turbo-v2.5', 'voice'],
    ['text-to-audio', 'fal-ai/elevenlabs/tts/eleven-v3', 'voice'],
    ['text-to-audio', 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3', 'voice'],
    ['speech-to-speech', 'fal-ai/chatterbox/speech-to-speech', 'voice'],
    ['text-to-audio', 'fal-ai/lyria2', 'music'],
    ['text-to-audio', 'fal-ai/stable-audio-25/text-to-audio', 'music'],
    ['text-to-audio', 'fal-ai/elevenlabs/music', 'music'],
    ['text-to-audio', 'fal-ai/ace-step/prompt-to-audio', 'music'],
    ['text-to-audio', 'fal-ai/elevenlabs/sound-effects/v2', 'sound'],
    ['text-to-audio', 'cassetteai/sound-effects-generator', 'sound'],
    ['text-to-audio', 'fal-ai/mmaudio-v2/text-to-audio', 'sound'],
    ['video-to-video', 'fal-ai/mmaudio-v2', 'sound'],
    ['video-to-video', 'fal-ai/hunyuan-video-foley', 'sound'],
    ['video-to-audio', 'fal-ai/some-v2a', 'sound'],
    ['text-to-audio', 'fal-ai/unknown-audio-thing', 'sound'],
    ['speech-to-text', 'fal-ai/wizper', 'tools'],
    ['audio-to-text', 'fal-ai/whatever', 'tools'],
    ['audio-to-audio', 'fal-ai/demucs', 'tools'],
    ['audio-to-audio', 'fal-ai/elevenlabs/audio-isolation', 'tools'],
    ['audio-to-audio', 'fal-ai/elevenlabs/voice-changer', 'voice'],
    ['audio-to-audio', 'fal-ai/ace-step/audio-to-audio', 'music'],
    ['image-to-image', 'fal-ai/seedvr/upscale/image', 'tools'],
    ['video-to-video', 'fal-ai/topaz/upscale/video', 'tools'],
    ['image-to-image', 'fal-ai/birefnet/v2', 'tools'],
    ['video-to-video', 'bria/video/background-removal', 'tools'],
    ['image-to-image', 'fal-ai/sam-3/image', 'tools'],
    ['image-to-image', 'fal-ai/sam2/image', 'tools'],
    ['image-to-image', 'fal-ai/image-preprocessors/depth-anything/v2', 'tools'],
    ['image-to-image', 'fal-ai/flux-control-lora-depth/image-to-image', 'image'],
    ['text-to-image', 'fal-ai/flux-lora-depth', 'image'],
    ['image-to-image', 'fal-ai/dwpose', 'tools'],
    ['video-to-video', 'fal-ai/rife/video', 'tools'],
    ['video-to-video', 'fal-ai/film/video', 'tools'],
    ['image-to-image', 'fal-ai/recraft/vectorize', 'tools'],
    ['text-to-image', 'fal-ai/recraft/v4/text-to-vector', 'image'],
    ['llm', 'openrouter/router', 'text'],
    ['vision', 'fal-ai/moondream', 'text'],
    ['training', 'fal-ai/flux-lora-fast-training', null],
    ['image-to-3d', 'fal-ai/hunyuan3d/v2', null],
    ['text-to-image', 'fal-ai/flux-2-trainer', null],
    ['', 'fal-ai/some-video-model', 'video'],
    ['weird-new-category', 'x/y', null],
  ];
  it.each(cases)('%s · %s → %s', (category, id, expected) => {
    expect(modalityForCategory(category, id)).toBe(expected);
  });

  it('uses tags as additional hints', () => {
    expect(modalityForCategory('image-to-image', 'acme/model', ['upscaling'])).toBe('tools');
    expect(modalityForCategory('image-to-video', 'acme/model', ['lipsync'])).toBe('lipsync');
  });

  it('adds lipsync to video models with audio input', () => {
    expect(alsoModalitiesFor('video', { audioInput: true })).toEqual(['lipsync']);
    expect(alsoModalitiesFor('video', {})).toBeUndefined();
    expect(alsoModalitiesFor('lipsync', {})).toEqual(['video']);
  });
});
