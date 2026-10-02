import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetSchema, createCanvas, createTimeline } from '@studio/core';
import { timelineSrt } from '../src/subtitles.ts';
import { exportProject } from '../src/export.ts';
import { executeMediaJob } from '../src/jobs.ts';
import { wordsForTimeline } from '../src/words.ts';

afterEach(() => vi.unstubAllGlobals());

describe('timeline SRT export', () => {
  it('delivers the native export job target as UTF-8 SRT without fetching unrelated media or evaluating components', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('No media fetch expected'))); vi.stubGlobal('fetch', fetch);
    const timeline = createTimeline({ fps: 30, durationFrames: 120 });
    timeline.tracks[0]!.clips.push({ id: 'video', assetId: 'missing-video', start: 0, duration: 120, in: 0, speed: 1 });
    timeline.components.unused = { name: 'Unrelated code', assetId: 'missing-code' };
    const output = await executeMediaJob({ kind: 'export_project', input: { target: 'srt', format: '16:9' } }, {
      document: timeline, assets: {}, filename: 'Kurs.mp4', components: { unused: 'throw new Error("must not execute")' },
      words: [{ text: 'Grüße', start: 1, end: 1.4 }, { text: 'aus', start: 1.4, end: 1.6 }, { text: 'Sofia!', start: 1.6, end: 2 }],
    });
    expect(output.files).toHaveLength(1); expect(output.files[0]!.filename).toBe('Kurs.srt');
    expect(output.files[0]!.blob.type).toBe('application/x-subrip;charset=utf-8');
    expect(await output.files[0]!.blob.text()).toBe('1\r\n00:00:01,000 --> 00:00:02,000\r\nGrüße aus Sofia!\r\n\r\n');
    expect(output.result).toMatchObject({ filename: 'Kurs.srt', mime: 'application/x-subrip;charset=utf-8', warnings: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves edited caption text and authored frame intervals instead of remapping or duplicating transcript words', async () => {
    const timeline = createTimeline({ fps: 30, durationFrames: 108060 });
    timeline.tracks[2]!.clips.push({ id: 'caption', text: 'Überarbeitung\r\n\r\nZweite Zeile', style: 'caption', start: 107999, duration: 46, in: 900, speed: 2 });
    timeline.tracks[2]!.clips.push({ id: 'title', text: 'Film title', style: 'title', start: 0, duration: 30, in: 0, speed: 1 });
    timeline.tracks.push({ id: 'hidden', kind: 'text', hidden: true, clips: [{ id: 'hidden-caption', text: 'Hidden', start: 0, duration: 30, in: 0, speed: 1 }] });
    expect(await timelineSrt(timeline, [{ text: 'old transcript', start: 1, end: 2 }]).text()).toBe('1\r\n00:59:59,967 --> 01:00:01,500\r\nÜberarbeitung\r\nZweite Zeile\r\n\r\n');
  });

  it('maps source transcript trim and double speed, retaining boundary overlaps and gaps', async () => {
    const timeline = createTimeline({ fps: 30, durationFrames: 180 });
    timeline.tracks[3]!.clips.push({ id: 'voice', assetId: 'a', start: 60, duration: 60, in: 30, speed: 2 });
    const asset = assetSchema.parse({ id: 'a', kind: 'audio', title: 'Voice', source: 'imported', createdAt: '2026-10-02T00:00:00Z', metadata: { transcript: { words: [
      { text: 'before', start: .2, end: 1 }, { text: 'early', start: .5, end: 1.2 }, { text: 'word', start: 2, end: 3 }, { text: 'late', start: 4.8, end: 5.5 }, { text: 'outside', start: 6, end: 7 },
    ] } } });
    const expected = '1\r\n00:00:02,000 --> 00:00:03,000\r\nearly word\r\n\r\n2\r\n00:00:03,900 --> 00:00:04,000\r\nlate\r\n\r\n';
    expect(await timelineSrt(timeline, undefined, { a: asset }).text()).toBe(expected);
    // This is exactly how BrowserStudioApi supplies words to export jobs.
    expect(await timelineSrt(timeline, wordsForTimeline(timeline, [asset]), { a: asset }).text()).toBe(expected);
  });

  it('uses supplied timeline word timings without applying clip speed or source offset twice', async () => {
    const timeline = createTimeline({ fps: 30, durationFrames: 180 });
    timeline.tracks[3]!.clips.push({ id: 'voice', assetId: 'a', start: 60, duration: 60, in: 30, speed: 2 });
    expect(await timelineSrt(timeline, [{ text: 'Already aligned.', start: 2.5, end: 3 }]).text()).toBe('1\r\n00:00:02,500 --> 00:00:03,000\r\nAlready aligned.\r\n\r\n');
  });

  it('clips authored captions at the actual timeline end and excludes captions outside it', async () => {
    const timeline = createTimeline({ fps: 30, durationFrames: 90 });
    timeline.tracks[2]!.clips.push({ id: 'end', text: 'Ende.', start: 75, duration: 60, in: 0, speed: 1 });
    timeline.tracks[2]!.clips.push({ id: 'outside', text: 'Outside', start: 120, duration: 30, in: 0, speed: 1 });
    expect(await timelineSrt(timeline).text()).toBe('1\r\n00:00:02,500 --> 00:00:03,000\r\nEnde.\r\n\r\n');
  });

  it('maps a slowed repeated source clip and omits muted speech or video without source audio', async () => {
    const timeline = createTimeline({ fps: 25, durationFrames: 350 });
    timeline.tracks[3]!.clips.push({ id: 'voice', assetId: 'a', start: 250, duration: 50, in: 50, speed: .5 });
    timeline.tracks[0]!.clips.push({ id: 'silent-video', assetId: 'a', start: 0, duration: 50, in: 50, speed: 1, includeSourceAudio: false });
    timeline.tracks[4]!.muted = true; timeline.tracks[4]!.clips.push({ id: 'muted', assetId: 'a', start: 0, duration: 50, in: 50, speed: 1 });
    const assets = { a: { id: 'a', metadata: { transcript: { words: [{ text: 'Langsam.', start: 2, end: 2.5 }] } } } };
    expect(await timelineSrt(timeline, undefined, assets).text()).toBe('1\r\n00:00:10,000 --> 00:00:11,000\r\nLangsam.\r\n\r\n');
  });

  it('sorts, joins punctuation, deduplicates identical words, and clips cues at the timeline end', async () => {
    const timeline = createTimeline({ fps: 30, durationFrames: 90 });
    const blob = timelineSrt(timeline, [
      { text: 'Welt', start: .4, end: .8 }, { text: 'Hallo', start: -.1, end: .2 }, { text: ',', start: .2, end: .2 },
      { text: 'Hallo', start: -.1, end: .2 }, { text: '!', start: .8, end: .9 }, { text: 'Später.', start: 2, end: 4 }, { text: 'Outside', start: 4, end: 5 },
    ]);
    expect(await blob.text()).toBe('1\r\n00:00:00,000 --> 00:00:00,900\r\nHallo, Welt!\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nSpäter.\r\n\r\n');
  });

  it('bounds long continuous word lists with real cue endpoints', async () => {
    const timeline = createTimeline({ fps: 30, durationFrames: 300 });
    const words = Array.from({ length: 5 }, (_, i) => ({ text: `Wort${i + 1}`, start: i, end: i + 1 }));
    expect(await timelineSrt(timeline, words).text()).toBe('1\r\n00:00:00,000 --> 00:00:04,000\r\nWort1 Wort2 Wort3 Wort4\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nWort5\r\n\r\n');
  });

  it('fails clearly for absent or untimed transcript data instead of producing an empty or guessed SRT', async () => {
    const timeline = createTimeline({ fps: 30, durationFrames: 90 });
    timeline.tracks[3]!.clips.push({ id: 'voice', assetId: 'a', start: 0, duration: 90, in: 0, speed: 1 });
    expect(() => timelineSrt(timeline)).toThrow('Keine Untertitel vorhanden');
    expect(() => timelineSrt(timeline, undefined, { a: { id: 'a', metadata: { transcript: { text: 'No word timings' } } } })).toThrow('Wortzeiten hinzufügen');
    await expect(exportProject({ document: timeline, assets: {}, format: 'srt' })).rejects.toThrow('Keine Untertitel vorhanden');
  });

  it('rejects malformed timing data, non-timeline SRT and cancelled exports', async () => {
    const timeline = createTimeline({ fps: 30, durationFrames: 90 });
    expect(() => timelineSrt(timeline, [{ text: 'Bad', start: Number.NaN, end: 1 }])).toThrow('Ungültige Wortzeiten');
    await expect(exportProject({ document: createCanvas(), assets: {}, format: 'srt' })).rejects.toThrow('passt nicht zu canvas');
    const controller = new AbortController(); controller.abort();
    await expect(exportProject({ document: timeline, assets: {}, format: 'srt', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
