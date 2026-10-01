import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaError, MediaToolkit } from '../src/index.ts';
import { FFMPEG, FFPROBE, burstGate, ff, ffprobeLines, makeTmpDir, mean } from './helpers.ts';

const tk = new MediaToolkit();
let dir = '';
let cleanup: () => Promise<void> = async () => {};
const p = (name: string) => join(dir, name);

beforeAll(async () => {
  ({ dir, cleanup } = await makeTmpDir('video'));
  await mkdir(dir, { recursive: true });
  const gate = burstGate();
  const delayedGate = burstGate('(t-0.2)');
  await Promise.all([
    // 320×240 @ 25 fps, 3 s, mit Sinuston
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p('clip.mp4')]),
    // Ohne Ton
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('silent video.mp4')]),
    // Ungerade Abmessungen (verlustfrei, damit der Encoder sie akzeptiert)
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=333x211:rate=30:duration=1', '-c:v', 'ffv1', p('odd.mkv')]),
    // Standbild
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=200x100', '-frames:v', '1', p('still.png')]),
    // Bewegtes Kästchen vs. ruhendes Bild
    ff(['-f', 'lavfi', '-i', 'color=black:size=160x120:rate=25:duration=3', '-f', 'lavfi', '-i', 'color=white:size=40x40:rate=25:duration=3', '-filter_complex', "[0:v][1:v]overlay=x='mod(t*80,120)':y=70", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('moving.mp4')]),
    ff(['-f', 'lavfi', '-i', 'color=gray:size=160x120:rate=25:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('static.mp4')]),
    // Sprachähnliche Referenz (Rausch-Bursts, unregelmäßig)
    ff(['-f', 'lavfi', '-i', `aevalsrc=exprs='0.4*(random(0)*2-1)*${gate}':s=48000:d=8`, p('ref.wav')]),
    // Ohne Ton: Kästchen leuchtet, solange die (um 200 ms verzögerte) Stimme aktiv ist
    ff(['-f', 'lavfi', '-i', 'color=black:size=160x120:rate=25:duration=8', '-vf', `drawbox=x=40:y=40:w=80:h=40:color=white:t=fill:enable='${delayedGate}'`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('mouth.mp4')]),
    writeFile(p('notes.txt'), 'kein Medium'),
  ]);
  // Video, dessen Ton die Referenz 200 ms verzögert bzw. 120 ms verfrüht enthält
  await Promise.all([
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=25:duration=8', '-i', p('ref.wav'), '-filter_complex', '[1:a]adelay=200|200[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p('late.mp4')]),
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=25:duration=8', '-i', p('ref.wav'), '-filter_complex', '[1:a]atrim=start=0.12,asetpts=PTS-STARTPTS[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', p('early.mp4')]),
  ]);
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe('probe', () => {
  it('liest Video mit Ton', async () => {
    const info = await tk.probe(p('clip.mp4'));
    expect(info).toMatchObject({ hasVideo: true, hasAudio: true, width: 320, height: 240, fps: 25, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000, channels: 1 });
    expect(Math.abs(info.durationMs - 3000)).toBeLessThan(60);
    expect(info.bitRate).toBeGreaterThan(0);
  });

  it('erkennt Videos ohne Ton, Standbilder und ungeeignete Dateien', async () => {
    expect(await tk.probe(p('silent video.mp4'))).toMatchObject({ hasVideo: true, hasAudio: false });
    expect(await tk.probe(p('still.png'))).toMatchObject({ hasVideo: true, isStillImage: true, durationMs: 0, width: 200, height: 100 });
    await expect(tk.probe(p('fehlt.mp4'))).rejects.toMatchObject({ code: 'invalid_input' });
    const error = await tk.probe(p('notes.txt')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MediaError);
    expect((error as MediaError).message.length).toBeGreaterThan(10);
  });
});

describe('Bilder', () => {
  it('thumbnail: JPEG mit Breite, PNG nahe am Ende', async () => {
    const jpg = await tk.thumbnail(p('clip.mp4'), p('thumbs/a.jpg'), { atSec: 1, width: 160 });
    expect(await tk.probe(jpg)).toMatchObject({ width: 160, height: 120, videoCodec: 'mjpeg' });
    const png = await tk.thumbnail(p('clip.mp4'), p('thumbs/end.png'), { atSec: 99 });
    expect(await tk.probe(png)).toMatchObject({ width: 320, height: 240, videoCodec: 'png' });
    const still = await tk.thumbnail(p('still.png'), p('thumbs/still.jpg'), { atSec: 5, width: 100 });
    expect(await tk.probe(still)).toMatchObject({ width: 100, height: 50 });
    await expect(tk.thumbnail(p('ref.wav'), p('thumbs/x.png'))).rejects.toMatchObject({ code: 'no_video' });
    await expect(tk.thumbnail(p('clip.mp4'), p('thumbs/x.gif'))).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('extractFrames: ein PNG je Zeitpunkt, Reihenfolge erhalten, auf die Dauer begrenzt', async () => {
    const frames = await tk.extractFrames(p('clip.mp4'), [0, 1.5, 2.5, 10, -3, 0.04, 0.08, 0.12, 0.16, 0.2], p('frames'), { width: 100 });
    expect(frames).toHaveLength(10);
    expect(frames[0]).toMatch(/frame_001_0ms\.png$/);
    expect(frames[3]).toMatch(/frame_004_2960ms\.png$/);
    expect(frames[4]).toMatch(/frame_005_0ms\.png$/);
    for (const f of [frames[0]!, frames[3]!, frames[9]!]) {
      const info = await tk.probe(f);
      expect(info.width).toBe(100);
      expect(info.height! % 2).toBe(0);
      expect(Math.abs(info.height! - 75)).toBeLessThanOrEqual(1);
    }
    // Unterschiedliche Zeitpunkte → unterschiedliche Bilder
    const [a, b] = await Promise.all([readFile(frames[0]!), readFile(frames[1]!)]);
    expect(a.equals(b)).toBe(false);
  });

  it('filmstrip: horizontaler Streifen mit erwarteten Abmessungen', async () => {
    const strip = await tk.filmstrip(p('clip.mp4'), p('strip.jpg'), { count: 5, height: 48 });
    expect(strip).toMatchObject({ frameWidth: 64, frameHeight: 48, count: 5 });
    expect(await tk.probe(strip.path)).toMatchObject({ width: 320, height: 48 });
  });

  it('contactSheet: Raster mit Zeitstempeln (und Rückfall ohne Beschriftung)', async () => {
    const sheet = await tk.contactSheet(p('clip.mp4'), p('sheet.png'), { count: 6, tileWidth: 160 });
    expect(sheet).toMatchObject({ columns: 3, rows: 2, tileWidth: 160, tileHeight: 120, labeled: true });
    expect(sheet.timesSec).toEqual([0.25, 0.75, 1.25, 1.75, 2.25, 2.75]);
    // 3·160 + 2·4 (Abstand) + 2·4 (Rand) = 496; 2·120 + 4 + 8 = 252
    expect(await tk.probe(sheet.path)).toMatchObject({ width: 496, height: 252 });

    const custom = await tk.contactSheet(p('clip.mp4'), p('sheet2.jpg'), { timesSec: [0.5, 2, 99], columns: 2, tileWidth: 100, labels: false });
    expect(custom).toMatchObject({ columns: 2, rows: 2, labeled: false });
    expect(custom.timesSec[2]).toBeCloseTo(2.96, 2);
    expect(await tk.probe(custom.path)).toMatchObject({ width: 2 * 100 + 4 + 8, height: 2 * 76 + 4 + 8 });

  });

  it.skipIf(process.platform === 'win32')('contactSheet: fällt ohne Beschriftung zurück, wenn drawtext scheitert (eigener ffmpeg-Pfad)', async () => {
    // Wrapper als konfiguriertes ffmpeg, der jeden drawtext-Aufruf ablehnt
    const wrapper = p('ffmpeg-ohne-drawtext.mjs');
    await writeFile(
      wrapper,
      [
        '#!/usr/bin/env node',
        "import { spawnSync } from 'node:child_process';",
        'const args = process.argv.slice(2);',
        "if (args.some((a) => a.includes('drawtext='))) { console.error('No such filter: drawtext'); process.exit(1); }",
        `const r = spawnSync(${JSON.stringify(FFMPEG)}, args, { stdio: 'inherit' });`,
        'process.exit(r.status ?? 1);',
      ].join('\n'),
    );
    await chmod(wrapper, 0o755);
    const broken = new MediaToolkit({ ffmpegPath: wrapper, ffprobePath: FFPROBE });
    const fallback = await broken.contactSheet(p('clip.mp4'), p('sheet3.png'), { count: 2, tileWidth: 80 });
    expect(fallback.labeled).toBe(false);
    expect(await tk.probe(fallback.path)).toMatchObject({ width: 2 * 80 + 4 + 8 });
  });
});

describe('proxy', () => {
  it('H.264/AAC, gerade Abmessungen, Keyframe je Sekunde, faststart', async () => {
    const progress: number[] = [];
    const out = await tk.proxy(p('clip.mp4'), p('proxies/clip proxy.mp4'), { height: 120, onProgress: (r) => progress.push(r) });
    const info = await tk.probe(out);
    expect(info).toMatchObject({ width: 160, height: 120, videoCodec: 'h264', audioCodec: 'aac', channels: 2, sampleRate: 48000, fps: 25 });
    const keyframes = (await ffprobeLines(['-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', out])).map((l) => Number.parseFloat(l));
    expect(keyframes.map((t) => Math.round(t))).toEqual([0, 1, 2]);
    const bytes = await readFile(out);
    expect(bytes.indexOf('moov')).toBeLessThan(bytes.indexOf('mdat'));
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('macht ungerade Quellen gerade, vergrößert nicht und lehnt Standbilder ab', async () => {
    const out = await tk.proxy(p('odd.mkv'), p('proxies/odd.mp4'));
    const info = await tk.probe(out);
    expect(info.height).toBe(210);
    expect(info.width! % 2).toBe(0);
    expect(info.hasAudio).toBe(false);
    await expect(tk.proxy(p('still.png'), p('proxies/still.mp4'))).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('lässt sich abbrechen', async () => {
    const controller = new AbortController();
    const pending = tk.proxy(p('ref.wav'), p('proxies/x.mp4'), { signal: controller.signal });
    await expect(pending).rejects.toMatchObject({ code: 'no_video' });
    controller.abort();
    await expect(tk.proxy(p('clip.mp4'), p('proxies/aborted.mp4'), { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('motionEnergy', () => {
  it('reagiert auf Bewegung, nicht auf ruhende Bilder; ROI grenzt ein', async () => {
    const moving = await tk.motionEnergy(p('moving.mp4'));
    const still = await tk.motionEnergy(p('static.mp4'));
    expect(moving.rateHz).toBe(25);
    expect(Math.abs(moving.values.length - 75)).toBeLessThanOrEqual(1);
    expect(moving.values[0]).toBe(0);
    expect(mean(moving.values)).toBeGreaterThan(0.005);
    expect(mean(still.values)).toBeLessThan(0.0005);
    // Oberes Viertel: das Kästchen bewegt sich nur in der unteren Hälfte
    const top = await tk.motionEnergy(p('moving.mp4'), { roi: { x: 0, y: 0, width: 1, height: 0.25 }, rateHz: 10 });
    expect(top.rateHz).toBe(10);
    expect(Math.abs(top.values.length - 30)).toBeLessThanOrEqual(1);
    expect(mean(top.values)).toBeLessThan(0.0005);
    await expect(tk.motionEnergy(p('moving.mp4'), { roi: { x: 0.8, y: 0, width: 0.5, height: 1 } })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('checkAvSync', () => {
  it('misst +200 ms Versatz per Audio-Kreuzkorrelation (±30 ms)', async () => {
    const r = await tk.checkAvSync({ videoPath: p('late.mp4'), referenceAudioPath: p('ref.wav') });
    expect(r.method).toBe('audio');
    expect(Math.abs(r.offsetMs - 200)).toBeLessThanOrEqual(30);
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.note).toMatch(/später/);
  });

  it('misst negativen Versatz (Video zu früh)', async () => {
    const r = await tk.checkAvSync({ videoPath: p('early.mp4'), referenceAudioPath: p('ref.wav'), maxLagMs: 500 });
    expect(r.method).toBe('audio');
    expect(Math.abs(r.offsetMs + 120)).toBeLessThanOrEqual(30);
  });

  it('nutzt ohne Tonspur die Bewegungsenergie im ROI (±1–2 Frames)', async () => {
    const r = await tk.checkAvSync({ videoPath: p('mouth.mp4'), referenceAudioPath: p('ref.wav'), roi: { x: 0.2, y: 0.2, width: 0.6, height: 0.5 } });
    expect(r.method).toBe('motion');
    expect(Math.abs(r.offsetMs - 200)).toBeLessThanOrEqual(60);
    expect(r.confidence).toBeGreaterThan(0.3);
    expect(r.note).toMatch(/Bewegungsenergie im Ausschnitt/);
  });
});

describe('mux', () => {
  it('kopiert das Video, kodiert AAC und endet mit der kürzeren Spur', async () => {
    const out = await tk.mux(p('silent video.mp4'), p('ref.wav'), p('muxed.mp4'));
    const info = await tk.probe(out);
    expect(info).toMatchObject({ hasVideo: true, hasAudio: true, videoCodec: 'h264', audioCodec: 'aac', width: 320, height: 240 });
    expect(info.durationMs).toBeLessThan(2300);
    await expect(tk.mux(p('silent video.mp4'), p('silent video.mp4'), p('x.mp4'))).rejects.toMatchObject({ code: 'no_audio' });
  });
});
