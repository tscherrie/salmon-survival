import { describe, expect, it } from 'vitest';
import { extractMediaOutputs } from '../src/index.ts';

const F = 'https://v3.fal.media/files';

describe('extractMediaOutputs', () => {
  it('images array with dimensions; kind from content_type or extension', () => {
    const out = extractMediaOutputs({
      images: [{ url: `${F}/a.png`, content_type: 'image/png', width: 1024, height: 768, file_name: 'a.png' }, { url: `${F}/b.jpg` }],
      seed: 42,
      prompt: 'https://not-a-media-field.example/but-a-url-in-text?no',
      has_nsfw_concepts: [false],
    });
    expect(out).toEqual([
      { url: `${F}/a.png`, kind: 'image', contentType: 'image/png', width: 1024, height: 768, fileName: 'a.png', path: 'images[0]' },
      { url: `${F}/b.jpg`, kind: 'image', contentType: 'image/jpeg', path: 'images[1]' },
    ]);
  });

  it('single image / video / audio objects', () => {
    expect(extractMediaOutputs({ image: { url: `${F}/x.webp` } })).toEqual([{ url: `${F}/x.webp`, kind: 'image', contentType: 'image/webp', path: 'image' }]);
    expect(
      extractMediaOutputs({
        video: { url: `${F}/clip`, content_type: 'video/mp4', duration: 5.04, resolution: { width: 1344, height: 768 }, thumbnail: { url: `${F}/thumb.jpg` } },
      }),
    ).toEqual([{ url: `${F}/clip`, kind: 'video', contentType: 'video/mp4', durationSec: 5.04, width: 1344, height: 768, path: 'video' }]);
    expect(extractMediaOutputs({ audio: { url: `${F}/speech.wav`, duration_ms: 1500 } })).toEqual([
      { url: `${F}/speech.wav`, kind: 'audio', contentType: 'audio/wav', durationSec: 1.5, path: 'audio' },
    ]);
  });

  it('audio_file objects and bare *_url strings', () => {
    expect(extractMediaOutputs({ audio_file: { url: `${F}/out`, content_type: 'audio/mpeg' } })[0]).toMatchObject({ kind: 'audio', path: 'audio_file' });
    expect(extractMediaOutputs({ audio_url: `${F}/out.mp3`, duration: 3 })).toEqual([{ url: `${F}/out.mp3`, kind: 'audio', contentType: 'audio/mpeg', path: 'audio_url' }]);
    expect(extractMediaOutputs({ video_url: `${F}/no-extension` })[0]).toMatchObject({ kind: 'video', path: 'video_url' });
  });

  it('stems (demucs) via key names', () => {
    const out = extractMediaOutputs({ vocals: { url: `${F}/s1` }, drums: { url: `${F}/s2` }, other: { url: `${F}/s3`, content_type: 'audio/mpeg' }, bass: null });
    expect(out.map((o) => [o.path, o.kind])).toEqual([
      ['vocals', 'audio'],
      ['drums', 'audio'],
      ['other', 'audio'],
    ]);
  });

  it('nested arrays, string arrays and masks', () => {
    const out = extractMediaOutputs({
      data: { outputs: [{ image: { url: `${F}/1.png` } }, [{ image: { url: `${F}/2.png` } }]] },
      image_urls: [`${F}/3.png`],
      masks: [{ url: `${F}/m0` }],
    });
    expect(out.map((o) => o.path)).toEqual(['data.outputs[0].image', 'data.outputs[1][0].image', 'image_urls[0]', 'masks[0]']);
    expect(out.every((o) => o.kind === 'image')).toBe(true);
  });

  it('dedupes by URL and skips queue URLs', () => {
    const out = extractMediaOutputs({
      image: { url: `${F}/same.png` },
      images: [{ url: `${F}/same.png` }],
      status_url: 'https://queue.fal.run/a/b/requests/1/status',
      response_url: 'https://queue.fal.run/a/b/requests/1',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('image');
  });

  it('data URIs (sync_mode), text files and generic files', () => {
    const out = extractMediaOutputs({
      image: { url: 'data:image/png;base64,iVBORw0KGgo=' },
      subtitles: `${F}/subs.srt`,
      file: { url: `${F}/scene.glb` },
      archive: { url: `${F}/blob` },
    });
    expect(out.map((o) => [o.path, o.kind, o.contentType])).toEqual([
      ['image', 'image', 'image/png'],
      ['subtitles', 'text', 'application/x-subrip'],
      ['file', 'file', undefined],
      ['archive', 'file', undefined],
    ]);
  });

  it('handles empty and primitive results', () => {
    expect(extractMediaOutputs(null)).toEqual([]);
    expect(extractMediaOutputs({ text: 'Hallo' })).toEqual([]);
    expect(extractMediaOutputs(`${F}/root.mp4`)).toEqual([{ url: `${F}/root.mp4`, kind: 'video', contentType: 'video/mp4', path: '' }]);
  });
});
