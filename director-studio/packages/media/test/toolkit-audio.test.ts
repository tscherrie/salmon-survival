import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { timelineSchema, type TimelineInput } from '@studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaToolkit } from '../src/index.ts';
import { clickTrackPcm, ff, makeTmpDir, mean } from './helpers.ts';

const tk = new MediaToolkit();
let dir = '';
let cleanup: () => Promise<void> = async () => {};
const p = (name: string) => join(dir, name);

/** Float32-PCM als 16-Bit-WAV schreiben (für synthetische Signale aus JS). */
async function writeWav(path: string, samples: Float32Array, sampleRate: number): Promise<void> {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  await writeFile(path, Buffer.concat([header, data]));
}

function rms(values: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += values[i]! * values[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

beforeAll(async () => {
  ({ dir, cleanup } = await makeTmpDir('audio'));
  await mkdir(dir, { recursive: true });
  await Promise.all([
    // 1-kHz-Sinus, Amplitude 0,5, mono, 5 s → −3,01 − 6,02 ≈ −9,03 LUFS, True Peak ≈ −6,02 dBTP
    ff(['-f', 'lavfi', '-i', 'aevalsrc=exprs=0.5*sin(2*PI*1000*t):s=48000:d=5', p('sine 1k.wav')]),
    // Leiser Stereo-Sinus (L 440 Hz, R 660 Hz) mit 1 s Stille am Ende
    ff(['-f', 'lavfi', '-i', 'aevalsrc=exprs=0.05*sin(2*PI*440*t)*lt(t\\,3)|0.05*sin(2*PI*660*t)*lt(t\\,3):s=44100:d=4', p('quiet stereo.wav')]),
    // Musikbett (220 Hz, konstant), stille Stimme (nur Schlüssel für Ducking), Rauschen als „Stimme“
    ff(['-f', 'lavfi', '-i', 'aevalsrc=exprs=0.3*sin(2*PI*220*t):s=48000:d=10', p('music.wav')]),
    ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '3', p('silence.wav')]),
    ff(['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.25:sample_rate=48000:duration=3:seed=7', p('voice.wav')]),
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=25:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('stumm.mp4')]),
    // Video mit Originalton (440 Hz, Amplitude 0,3)
    ff([
      '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=25:duration=3',
      '-f', 'lavfi', '-i', 'aevalsrc=exprs=0.3*sin(2*PI*440*t):s=48000:d=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', p('mit ton.mp4'),
    ]),
    writeWav(p('click 120.wav'), clickTrackPcm({ bpm: 120, durationSec: 12, sampleRate: 44100, offsetSec: 0.25, accentIndex: 2, noise: 0.003 }), 44100),
  ]);
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe('Fähigkeiten', () => {
  it('ermittelt Version, Filter und Encoder einmalig', async () => {
    const caps = await tk.capabilities();
    expect(caps.version.length).toBeGreaterThan(0);
    expect(caps.filters.has('ebur128')).toBe(true);
    expect(caps.filters.has('sidechaincompress')).toBe(true);
    expect(caps.encoders.has('aac')).toBe(true);
    expect(await tk.capabilities()).toBe(caps);
    expect(await tk.hasFilter('gibtsnicht')).toBe(false);
  });
});

describe('Analyse', () => {
  it('peaks: Länge, Wertebereich und Dauer', async () => {
    const { peaks, durationMs } = await tk.peaks(p('sine 1k.wav'), { points: 500 });
    expect(peaks).toHaveLength(1000);
    expect(Math.abs(durationMs - 5000)).toBeLessThanOrEqual(5);
    for (const v of peaks) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    expect(Math.max(...peaks)).toBeCloseTo(0.5, 1);
    expect(Math.min(...peaks)).toBeCloseTo(-0.5, 1);

    const stereo = await tk.peaks(p('quiet stereo.wav'), { points: 40 });
    expect(stereo.peaks).toHaveLength(80);
    expect(Math.max(...stereo.peaks.slice(0, 40))).toBeCloseTo(0.05, 2);
    // Letzte Sekunde ist still
    expect(stereo.peaks.slice(-10).every((v) => v === 0)).toBe(true);
    // Standard: 2000 Paare
    expect((await tk.peaks(p('music.wav'))).peaks).toHaveLength(4000);
  });

  it('loudness: Sinus bekannter Amplitude innerhalb der Toleranz', async () => {
    const l = await tk.loudness(p('sine 1k.wav'));
    expect(Math.abs(l.integratedLufs - -9.03)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(l.truePeakDb - -6.02)).toBeLessThanOrEqual(0.5);
    expect(l.lra).toBeLessThan(1);
    await expect(tk.loudness(p('stumm.mp4'))).rejects.toMatchObject({ code: 'no_audio' });
  });

  it('decodePcm: mono (Standard 22 050 Hz) und interleaved Stereo', async () => {
    const mono = await tk.decodePcm(p('sine 1k.wav'));
    expect(mono.sampleRate).toBe(22050);
    expect(mono.channels).toBe(1);
    expect(Math.abs(mono.samples.length - 5 * 22050)).toBeLessThanOrEqual(64);
    expect(rms(mono.samples, 0, mono.samples.length)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    const stereo = await tk.decodePcm(p('quiet stereo.wav'), { sampleRate: 8000, mono: false });
    expect(stereo.channels).toBe(2);
    expect(Math.abs(stereo.samples.length - 4 * 8000 * 2)).toBeLessThanOrEqual(64);
  });

  it('envelope: RMS mit 100 Hz', async () => {
    const env = await tk.envelope(p('quiet stereo.wav'));
    expect(env.rateHz).toBe(100);
    expect(Math.abs(env.values.length - 400)).toBeLessThanOrEqual(1);
    expect(mean(env.values.slice(10, 290))).toBeCloseTo(0.05 / Math.SQRT2, 3);
    expect(Math.max(...env.values.slice(310))).toBeLessThan(1e-4);
  });

  it('detectBeats: 120-BPM-Klickspur (±2 BPM), Beat-Abstand ≈ 0,5 s, Downbeats an der Betonung', async () => {
    const r = await tk.detectBeats(p('click 120.wav'));
    expect(Math.abs(r.bpm - 120)).toBeLessThanOrEqual(2);
    const ibis = r.beats.slice(1).map((b, i) => b - r.beats[i]!);
    expect(ibis.length).toBeGreaterThanOrEqual(20);
    expect(Math.abs(mean(ibis) - 0.5)).toBeLessThan(0.01);
    for (const b of r.beats) {
      const k = Math.round((b - 0.25) / 0.5);
      expect(Math.abs(b - (0.25 + k * 0.5))).toBeLessThan(0.02);
    }
    for (const d of r.downbeats) expect(Math.round((d - 0.25) / 0.5) % 4).toBe(2);
    expect(r.confidence).toBeGreaterThan(0.6);
  });
});

describe('Bearbeitung', () => {
  it('cutAudio: Dauer inkl. Handles und Begrenzung auf die Datei', async () => {
    const cut = await tk.cutAudio(p('sine 1k.wav'), p('cuts/mitte.wav'), { fromSec: 1, toSec: 2, handlesSec: 0.25 });
    expect(cut).toMatchObject({ fromSec: 0.75, toSec: 2.25 });
    const info = await tk.probe(cut.path);
    expect(Math.abs(info.durationMs - 1500)).toBeLessThanOrEqual(2);

    const clamped = await tk.cutAudio(p('sine 1k.wav'), p('cuts/ende.m4a'), { fromSec: 4.5, toSec: 9, handlesSec: 1, sampleRate: 44100 });
    expect(clamped).toMatchObject({ fromSec: 3.5, toSec: 5 });
    const ci = await tk.probe(clamped.path);
    expect(ci.sampleRate).toBe(44100);
    expect(Math.abs(ci.durationMs - 1500)).toBeLessThanOrEqual(60);

    const start = await tk.cutAudio(p('sine 1k.wav'), p('cuts/start.wav'), { fromSec: 0.1, toSec: 0.5, handlesSec: 0.5 });
    expect(start).toMatchObject({ fromSec: 0, toSec: 1 });

    await expect(tk.cutAudio(p('sine 1k.wav'), p('cuts/x.wav'), { fromSec: 6, toSec: 7 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(tk.cutAudio(p('sine 1k.wav'), p('cuts/x.wav'), { fromSec: 2, toSec: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('normalizeLoudness: erreicht das Ziel ±1 LU (laut → −14, leise → −16)', async () => {
    const loud = await tk.normalizeLoudness(p('sine 1k.wav'), p('norm/laut.wav'));
    expect(Math.abs((await tk.loudness(loud)).integratedLufs - -14)).toBeLessThanOrEqual(1);
    const quiet = await tk.normalizeLoudness(p('quiet stereo.wav'), p('norm/leise.m4a'), { targetLufs: -16, truePeakDb: -1.5 });
    const l = await tk.loudness(quiet);
    expect(Math.abs(l.integratedLufs - -16)).toBeLessThanOrEqual(1);
    expect(l.truePeakDb).toBeLessThanOrEqual(-1);
    expect((await tk.probe(quiet)).sampleRate).toBe(44100);
    await expect(tk.normalizeLoudness(p('silence.wav'), p('norm/still.wav'))).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('renderAudioMix', () => {
  const paths: Record<string, string> = {};
  beforeAll(() => {
    Object.assign(paths, { music: p('music.wav'), silence: p('silence.wav'), voice: p('voice.wav'), stumm: p('stumm.mp4'), video: p('mit ton.mp4'), fehlt: p('gibt es nicht.wav') });
  });
  const resolve = (id: string) => paths[id];
  const make = (input: Partial<TimelineInput> & { tracks: TimelineInput['tracks'] }) =>
    timelineSchema.parse({ kind: 'timeline', fps: 30, width: 1920, height: 1080, durationFrames: 240, ...input });

  it('rendert korrekte Dauer, nicht still; Ducking senkt die Musik um ≈ duck.db', async () => {
    const tl = make({
      tracks: [
        { id: 'V1', kind: 'video', clips: [] },
        { id: 'A1', kind: 'audio', role: 'voice', clips: [{ id: 'leer', assetId: 'silence', start: 90, duration: 60 }] },
        { id: 'A2', kind: 'audio', role: 'music', duck: { byTrackId: 'A1', db: -12 }, clips: [{ id: 'bett', assetId: 'music', start: 0, duration: 240 }] },
      ],
    });
    const warnings: string[] = [];
    const out = await tk.renderAudioMix(tl, resolve, p('mix/ducking.wav'), { onWarning: (w) => warnings.push(w) });
    expect(warnings).toEqual([]);
    const info = await tk.probe(out);
    expect(info).toMatchObject({ sampleRate: 48000, channels: 2, audioCodec: 'pcm_s16le' });
    expect(Math.abs(info.durationMs - 8000)).toBeLessThanOrEqual(1);
    const env = await tk.envelope(out, { rateHz: 20 });
    const before = rms(env.values, 20, 50); // 1,0–2,5 s
    const ducked = rms(env.values, 70, 98); // 3,5–4,9 s (Stimme 3–5 s, Attack abgeklungen)
    const after = rms(env.values, 140, 155); // 7,0–7,75 s (Release vorbei)
    expect(before).toBeGreaterThan(0.05);
    const reductionDb = 20 * Math.log10(before / ducked);
    expect(Math.abs(reductionDb - 12)).toBeLessThanOrEqual(0.75);
    expect(Math.abs(20 * Math.log10(before / after))).toBeLessThan(0.5);
  });

  it('platziert Clips mit Gain, Versatz und Tempo; überspringt Assets ohne Ton', async () => {
    const tl = make({
      fps: 1000,
      durationFrames: 4000,
      tracks: [
        { id: 'A1', kind: 'audio', clips: [{ id: 'm', assetId: 'music', start: 1000, duration: 1000, in: 2000, gainDb: -6 }] },
        { id: 'A2', kind: 'audio', clips: [{ id: 'schnell', assetId: 'voice', start: 2500, duration: 1000, speed: 2, fadeInFrames: 200 }] },
        { id: 'A3', kind: 'audio', clips: [{ id: 'ohne', assetId: 'stumm', start: 0, duration: 1000 }] },
      ],
    });
    const warnings: string[] = [];
    const out = await tk.renderAudioMix(tl, resolve, p('mix/placement.m4a'), { onWarning: (w) => warnings.push(w) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/keine Audiospur/);
    const info = await tk.probe(out);
    expect(info.audioCodec).toBe('aac');
    expect(Math.abs(info.durationMs - 4000)).toBeLessThanOrEqual(50);
    const env = await tk.envelope(out, { rateHz: 100 });
    // 0–1 s still, 1–2 s Musik mit −6 dB (0,3 → 0,15 Amplitude; Mono-Hüllkurve ≈ 0,15/√2), 2–2,5 s still
    expect(rms(env.values, 10, 90)).toBeLessThan(0.002);
    expect(rms(env.values, 120, 180)).toBeCloseTo(0.15 / Math.SQRT2, 2);
    expect(rms(env.values, 210, 240)).toBeLessThan(0.002);
    // Fade-in: Anfang des schnellen Clips leiser als später
    expect(rms(env.values, 251, 260)).toBeLessThan(rms(env.values, 300, 340));
  });

  it('übergibt lange Filtergraphen über eine Datei (viele Clips)', async () => {
    const clips = Array.from({ length: 64 }, (_, i) => ({ id: `k${i}`, assetId: 'music', start: i * 100, duration: 50, in: i * 10, gainDb: -1, fadeInFrames: 5, fadeOutFrames: 5 }));
    const tl = make({ fps: 1000, durationFrames: 6500, tracks: [{ id: 'A1', kind: 'audio', clips }] });
    const out = await tk.renderAudioMix(tl, resolve, p('mix/viele clips.wav'));
    expect(Math.abs((await tk.probe(out)).durationMs - 6500)).toBeLessThanOrEqual(1);
    const env = await tk.envelope(out, { rateHz: 100 });
    // Clip i liegt bei [i·0,1 s, i·0,1 s + 0,05 s) → Mitte laut, Lücke still
    expect(rms(env.values, 302, 304)).toBeGreaterThan(0.1);
    expect(rms(env.values, 306, 309)).toBeLessThan(0.01);
  });

  it('rendert Teilbereiche und meldet fehlende Dateien', async () => {
    const tl = make({ tracks: [{ id: 'A1', kind: 'audio', clips: [{ id: 'm', assetId: 'music', start: 30, duration: 150, fadeInFrames: 30 }] }] });
    const out = await tk.renderAudioMix(tl, resolve, p('mix/bereich.wav'), { fromFrame: 45, toFrame: 105, sampleRate: 44100 });
    const info = await tk.probe(out);
    expect(info.sampleRate).toBe(44100);
    expect(Math.abs(info.durationMs - 2000)).toBeLessThanOrEqual(1);
    const env = await tk.envelope(out, { rateHz: 100 });
    // Startet mitten im Fade-in (0,5 s von 1 s) → ≈ halbe Amplitude, danach voll
    expect(rms(env.values, 0, 3) / rms(env.values, 100, 150)).toBeGreaterThan(0.35);
    expect(rms(env.values, 0, 3) / rms(env.values, 100, 150)).toBeLessThan(0.65);

    const broken = make({ tracks: [{ id: 'A1', kind: 'audio', clips: [{ id: 'x', assetId: 'fehlt', start: 0, duration: 30 }] }] });
    await expect(tk.renderAudioMix(broken, resolve, p('mix/broken.wav'))).rejects.toMatchObject({ code: 'invalid_input' });
    const empty = make({ durationFrames: 60, tracks: [] });
    const silent = await tk.renderAudioMix(empty, resolve, p('mix/leer.wav'));
    expect(Math.abs((await tk.probe(silent)).durationMs - 2000)).toBeLessThanOrEqual(1);
  });
  it('mischt den Originalton von Videoclips mit includeSourceAudio; Videos ohne Ton werden gemeldet', async () => {
    const tl = make({
      durationFrames: 150,
      tracks: [
        {
          id: 'V1',
          kind: 'video',
          clips: [
            { id: 'ohne-flag', assetId: 'video', start: 0, duration: 30 },
            { id: 'o-ton', assetId: 'video', start: 30, duration: 60, in: 15, gainDb: -6, includeSourceAudio: true },
            { id: 'stummes-video', assetId: 'stumm', start: 90, duration: 30, includeSourceAudio: true },
          ],
        },
        { id: 'A1', kind: 'audio', clips: [] },
      ],
    });
    const warnings: string[] = [];
    const out = await tk.renderAudioMix(tl, resolve, p('mix/originalton.wav'), { onWarning: (w) => warnings.push(w) });
    expect(warnings).toEqual([expect.stringMatching(/"stummes-video".*keine Audiospur/)]);
    expect(Math.abs((await tk.probe(out)).durationMs - 5000)).toBeLessThanOrEqual(1);
    const env = await tk.envelope(out, { rateHz: 100 });
    expect(rms(env.values, 5, 95)).toBeLessThan(0.002); // Videoclip ohne includeSourceAudio bleibt stumm
    expect(rms(env.values, 110, 290)).toBeCloseTo(0.15 / Math.SQRT2, 2); // 0,3 bei −6 dB
    expect(rms(env.values, 305, 500)).toBeLessThan(0.002);
  });

  it('equal-power-Fade: Mitte des Fade-ins bei ≈ −3 dB (linear: −6 dB)', async () => {
    const build = (fadeCurve: 'linear' | 'equal-power') =>
      make({ durationFrames: 120, tracks: [{ id: 'A1', kind: 'audio', clips: [{ id: 'm', assetId: 'music', start: 0, duration: 120, fadeInFrames: 60, fadeCurve }] }] });
    const ratioAtMid = async (fadeCurve: 'linear' | 'equal-power') => {
      const out = await tk.renderAudioMix(build(fadeCurve), resolve, p(`mix/fade ${fadeCurve}.wav`));
      const env = await tk.envelope(out, { rateHz: 100 });
      return rms(env.values, 98, 102) / rms(env.values, 300, 380);
    };
    const [lin, ep] = await Promise.all([ratioAtMid('linear'), ratioAtMid('equal-power')]);
    expect(lin).toBeCloseTo(0.5, 1);
    expect(ep).toBeCloseTo(Math.SQRT1_2, 1);
    expect(ep - lin).toBeGreaterThan(0.15);
  });

  it('track.duck: releaseMs verkürzt die Rückkehr, leadMs duckt im Modus signal schon vor der Stimme', async () => {
    const musicTrack = (duck: Record<string, unknown>) => ({ id: 'A2', kind: 'audio' as const, role: 'music' as const, duck: { byTrackId: 'A1', db: -12, ...duck }, clips: [{ id: 'bett', assetId: 'music', start: 0, duration: 240 }] });
    /** Absenkung (dB) im Hüllkurvenbereich [a, b) (20 Hz) gegenüber 1,0–2,5 s. */
    const reduction = async (name: string, keyAsset: string, duck: Record<string, unknown>, [a, b]: [number, number]) => {
      const tl = make({ tracks: [{ id: 'A1', kind: 'audio', clips: [{ id: 'key', assetId: keyAsset, start: 90, duration: 60 }] }, musicTrack(duck)] });
      const out = await tk.renderAudioMix(tl, resolve, p(`mix/${name}.wav`));
      const env = await tk.envelope(out, { rateHz: 20 });
      const ref = rms(env.values, 20, 50); // 1,0–2,5 s: ungeduckt
      return 20 * Math.log10(ref / rms(env.values, a, b));
    };
    // Stiller Schlüssel 3–5 s (Modus clips): 5,3–5,8 s nach dem Ende
    const fastRelease = await reduction('release kurz', 'silence', { releaseMs: 40 }, [106, 116]);
    const slowRelease = await reduction('release standard', 'silence', {}, [106, 116]);
    expect(fastRelease).toBeLessThan(0.75);
    expect(slowRelease).toBeGreaterThan(2);
    // Stimme ab 3 s (Modus signal): 2,6–2,9 s davor nur mit Vorlauf abgesenkt
    const withLead = await reduction('signal vorlauf', 'voice', { mode: 'signal', leadMs: 500, attackMs: 5 }, [52, 58]);
    const noLead = await reduction('signal ohne vorlauf', 'voice', { mode: 'signal', attackMs: 5 }, [52, 58]);
    expect(withLead).toBeGreaterThan(4);
    expect(Math.abs(noLead)).toBeLessThan(0.75);
  });
});
