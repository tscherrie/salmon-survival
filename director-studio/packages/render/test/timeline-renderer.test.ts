import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileComponent, TimelineRenderer, type MediaErrorInfo } from '../src/index.ts';
import { decodePng, HAS_CHROMIUM, solidPng, testChromiumPath, timeline, tmpDir } from './helpers.ts';

/**
 * Integration: echtes Remotion-Bündel (@remotion/bundler) + Rendern mit der Headless-Shell.
 * Dauert beim ersten Bündeln ~15 s.
 */

const FFMPEG = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p));

const CORNER = `
import { AbsoluteFill } from 'remotion';
import type { OverlayComponentProps } from '@studio/render';
export default function Corner({ frame, props, random }: OverlayComponentProps) {
  const size = Number(props.size ?? 40);
  return (
    <AbsoluteFill>
      <div data-r={random('x')} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, background: 'rgb(255, 0, 0)' }} />
      <div style={{ position: 'absolute', right: 0, bottom: 0, width: 20 + frame, height: 20, background: 'rgb(0, 255, 0)' }} />
    </AbsoluteFill>
  );
}
`;

const BROKEN = `export default function Broken() { throw new Error('Kaputt im Render'); }`;

let dir: string;
let imagePath: string;
let videoPath: string | undefined;
let rendererBundle: TimelineRenderer;
let rendererProps: TimelineRenderer;

beforeAll(async () => {
  dir = await tmpDir('studio-remotion-test-');
  imagePath = path.join(dir, 'hintergrund.png');
  await writeFile(imagePath, solidPng(640, 360, [20, 160, 140]));
  if (FFMPEG) {
    videoPath = path.join(dir, 'blau.mp4');
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x0000ff:s=320x180:d=2:r=30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', videoPath]);
  }
  const workDir = path.join(dir, 'work');
  rendererBundle = new TimelineRenderer({ workDir, browserExecutable: testChromiumPath(), concurrency: 2 });
  rendererProps = new TimelineRenderer({ workDir, browserExecutable: testChromiumPath(), concurrency: 2, componentMode: 'inputProps' });
});

afterAll(async () => {
  await rendererBundle?.close();
  await rendererProps?.close();
  await rm(dir, { recursive: true, force: true });
});

function testTimeline() {
  return timeline({
    width: 320,
    height: 180,
    durationFrames: 30,
    formats: [
      { id: '16:9', width: 320, height: 180 },
      { id: '9:16', width: 180, height: 320 },
    ],
    tracks: [
      { id: 'V1', kind: 'video', clips: [{ id: 'bg', start: 0, duration: 30, assetId: 'bild' }] },
      { id: 'O1', kind: 'overlay', clips: [{ id: 'ecke', start: 0, duration: 30, componentId: 'corner', props: { size: 40 } }] },
      { id: 'T1', kind: 'text', clips: [{ id: 'hero', start: 0, duration: 30, text: 'Hallo', style: 'hero' }] },
    ],
    components: { corner: { assetId: 'code_corner', name: 'Corner' } },
  });
}

const assets = () => ({ bild: { id: 'bild', kind: 'image' as const, url: pathToFileURL(imagePath).href, width: 640, height: 360 } });

describe.skipIf(!HAS_CHROMIUM)('TimelineRenderer (Remotion)', () => {
  it('renderStill: Bild, Director-Komponente (TSX) und Text in einem Frame', async () => {
    const out = path.join(dir, 'still.png');
    await rendererBundle.renderStill({ timeline: testTimeline(), assets: assets(), componentCodes: { corner: CORNER }, frame: 10, out });
    const img = decodePng(await readFile(out));
    expect([img.width, img.height]).toEqual([320, 180]);
    expect(img.pixel(10, 10).slice(0, 3)).toEqual([255, 0, 0]);
    const bg = img.pixel(300, 20);
    expect(Math.abs(bg[0] - 20) + Math.abs(bg[1] - 160) + Math.abs(bg[2] - 140)).toBeLessThan(6);
    expect(img.pixel(310, 170).slice(0, 3)).toEqual([0, 255, 0]);
    // Frame-abhängig: grüner Balken ist 20 + frame breit
    expect(img.pixel(320 - 29, 170).slice(0, 3)).toEqual([0, 255, 0]);
    // Bündel wird wiederverwendet (Cache)
    const t0 = Date.now();
    const serveUrl = await rendererBundle.bundle({ corner: CORNER });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(existsSync(path.join(serveUrl, 'index.html'))).toBe(true);
  }, 180000);

  it('Formatvariante 9:16 und Skalierung', async () => {
    const out = path.join(dir, 'still-916.png');
    await rendererBundle.renderStill({ timeline: testTimeline(), assets: assets(), componentCodes: { corner: CORNER }, frame: 0, formatId: '9:16', scale: 2, out });
    const img = decodePng(await readFile(out));
    expect([img.width, img.height]).toEqual([360, 640]);
  }, 120000);

  it('fehlender Komponenten-Code und Frame außerhalb werden gemeldet', async () => {
    await expect(rendererBundle.renderStill({ timeline: testTimeline(), assets: assets(), frame: 0, out: path.join(dir, 'x.png') })).rejects.toThrow('Für folgende Komponenten fehlt Code: corner');
    await expect(rendererBundle.renderStill({ timeline: testTimeline(), assets: assets(), componentCodes: { corner: CORNER }, frame: 30, out: path.join(dir, 'x.png') })).rejects.toThrow('Frame 30 liegt außerhalb');
    await expect(rendererBundle.bundle({ corner: 'export default () => fetch("x")' })).rejects.toThrow('fetch() ist nicht erlaubt');
  }, 60000);

  it('inputProps-Modus: kein Neubündeln je Komponente; Komponentenfehler brechen ab', async () => {
    const compiled = await compileComponent(CORNER);
    const out = path.join(dir, 'still-props.png');
    await rendererProps.renderStill({ timeline: testTimeline(), assets: assets(), componentCodes: { corner: compiled.code! }, frame: 3, out });
    expect(decodePng(await readFile(out)).pixel(5, 5).slice(0, 3)).toEqual([255, 0, 0]);
    const broken = testTimeline();
    await expect(rendererProps.renderStill({ timeline: broken, assets: assets(), componentCodes: { corner: BROKEN }, frame: 3, out: path.join(dir, 'broken.png') })).rejects.toThrow(/Komponente „corner“ \(Clip ecke\): Kaputt im Render/);
  }, 180000);

  it.skipIf(!FFMPEG)('renderVideo: stummes MP4 mit OffthreadVideo-Quelle, Fortschritt, Abbruch', async () => {
    const tl = timeline({
      width: 320,
      height: 180,
      durationFrames: 15,
      formats: [{ id: '16:9', width: 320, height: 180 }],
      tracks: [
        { id: 'V1', kind: 'video', clips: [{ id: 'clip', start: 0, duration: 15, assetId: 'video', in: 5 }] },
        { id: 'O1', kind: 'overlay', clips: [{ id: 'ecke', start: 0, duration: 15, componentId: 'corner' }] },
      ],
      components: { corner: { assetId: 'code_corner', name: 'Corner' } },
    });
    const media = { video: { id: 'video', kind: 'video' as const, url: videoPath!, width: 320, height: 180, durationMs: 2000, fps: 30 } };
    const still = path.join(dir, 'video-frame.png');
    await rendererProps.renderStill({ timeline: tl, assets: media, componentCodes: { corner: CORNER }, frame: 7, out: still });
    const px = decodePng(await readFile(still)).pixel(200, 90);
    expect(px[2]).toBeGreaterThan(200);
    expect(px[0]).toBeLessThan(40);
    const progress: number[] = [];
    const out = path.join(dir, 'video.mp4');
    await rendererProps.renderVideo({ timeline: tl, assets: media, componentCodes: { corner: CORNER }, out, codec: 'h264', onProgress: (p) => progress.push(p) });
    expect((await stat(out)).size).toBeGreaterThan(1000);
    expect(progress.at(-1)).toBe(1);
    const probe = execFileSync(FFMPEG!.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,nb_frames', '-of', 'json', out], { encoding: 'utf8' });
    const streams = (JSON.parse(probe) as { streams: Array<{ codec_type: string; width?: number; height?: number; nb_frames?: string }> }).streams;
    expect(streams.map((s) => s.codec_type)).toEqual(['video']);
    expect(streams[0]).toMatchObject({ width: 320, height: 180, nb_frames: '15' });
    const controller = new AbortController();
    controller.abort();
    await expect(rendererProps.renderVideo({ timeline: tl, assets: media, componentCodes: { corner: CORNER }, out: path.join(dir, 'abgebrochen.mp4'), signal: controller.signal })).rejects.toThrow('Rendern abgebrochen');
  }, 180000);

  it('kaputte Medien: Vorabprüfung lässt sie aus, Rendern läuft weiter, onMediaError meldet', async () => {
    const brokenVideo = path.join(dir, 'bild-statt-video.mp4');
    await writeFile(brokenVideo, solidPng(32, 32, [255, 0, 255]));
    const tl = timeline({
      width: 320,
      height: 180,
      durationFrames: 10,
      formats: [{ id: '16:9', width: 320, height: 180 }],
      tracks: [
        { id: 'V1', kind: 'video', clips: [{ id: 'bg', start: 0, duration: 10, assetId: 'bild' }] },
        { id: 'V2', kind: 'video', clips: [{ id: 'weg', start: 0, duration: 10, assetId: 'fehlt' }] },
        { id: 'V3', kind: 'video', clips: [{ id: 'falsch', start: 0, duration: 10, assetId: 'video' }] },
        { id: 'O1', kind: 'overlay', clips: [{ id: 'logo', start: 0, duration: 10, componentId: 'corner', props: { size: 10, logoAsset: 'logo' } }] },
      ],
      components: { corner: { assetId: 'code_corner', name: 'Corner' } },
    });
    const media = {
      ...assets(),
      fehlt: { id: 'fehlt', kind: 'image' as const, url: path.join(dir, 'gibtsnicht.png') },
      video: { id: 'video', kind: 'video' as const, url: pathToFileURL(brokenVideo).href, durationMs: 2000 },
      logo: { id: 'logo', kind: 'image' as const, url: path.join(dir, 'logo-fehlt.png') },
    };
    const errors: MediaErrorInfo[] = [];
    const out = path.join(dir, 'kaputt.png');
    await rendererProps.renderStill({ timeline: tl, assets: media, componentCodes: { corner: CORNER }, frame: 3, out, onMediaError: (e) => errors.push(e) });
    const px = decodePng(await readFile(out)).pixel(160, 90);
    expect(Math.abs(px[0] - 20) + Math.abs(px[1] - 160) + Math.abs(px[2] - 140)).toBeLessThan(6);
    const byClip = Object.fromEntries(errors.map((e) => [e.clipId, e.message]));
    expect(byClip.weg).toContain('Datei fehlt');
    expect(byClip.falsch).toContain('Datei ist ein Bild (png), kein Video');
    expect(byClip.logo).toBe('props.logoAsset: Datei fehlt');
    expect(errors.length).toBe(3);
  }, 180000);

  it('ohne Vorabprüfung: Dekodierfehler von OffthreadVideo/Img hängen das Rendern nicht auf', async () => {
    const brokenVideo = path.join(dir, 'bild-statt-video-2.mp4');
    await writeFile(brokenVideo, solidPng(32, 32, [255, 0, 255]));
    const brokenImage = path.join(dir, 'text-statt-bild.png');
    await writeFile(brokenImage, 'kein Bild');
    const renderer = new TimelineRenderer({ workDir: path.join(dir, 'work'), browserExecutable: testChromiumPath(), componentMode: 'inputProps', probeMedia: false, timeoutMs: 20000 });
    try {
      const tl = timeline({
        width: 320,
        height: 180,
        durationFrames: 10,
        formats: [{ id: '16:9', width: 320, height: 180 }],
        tracks: [
          { id: 'V1', kind: 'video', clips: [{ id: 'bg', start: 0, duration: 10, assetId: 'bild' }] },
          { id: 'V2', kind: 'video', clips: [{ id: 'vid', start: 0, duration: 10, assetId: 'video' }] },
          { id: 'V3', kind: 'video', clips: [{ id: 'img', start: 0, duration: 10, assetId: 'kaputt' }] },
        ],
      });
      const media = {
        ...assets(),
        video: { id: 'video', kind: 'video' as const, url: brokenVideo, durationMs: 2000 },
        kaputt: { id: 'kaputt', kind: 'image' as const, url: brokenImage },
      };
      const errors: MediaErrorInfo[] = [];
      const out = path.join(dir, 'kaputt-ohne-probe.png');
      const t0 = Date.now();
      await renderer.renderStill({ timeline: tl, assets: media, frame: 2, out, onMediaError: (e) => errors.push(e) });
      expect(Date.now() - t0).toBeLessThan(60000);
      const px = decodePng(await readFile(out)).pixel(160, 90);
      expect(Math.abs(px[0] - 20) + Math.abs(px[1] - 160) + Math.abs(px[2] - 140)).toBeLessThan(6);
      expect(errors.map((e) => e.clipId).sort()).toEqual(['img', 'vid']);
      expect(errors.find((e) => e.clipId === 'vid')?.message).toContain('Video nicht ladbar');
    } finally {
      await renderer.close();
    }
  }, 180000);
});
