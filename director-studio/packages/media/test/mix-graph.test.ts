import { timelineSchema, type TimelineInput } from '@studio/core';
import { describe, expect, it } from 'vitest';
import { DUCKING, buildAudioMixGraph, keyRanges } from '../src/index.ts';

const PATHS: Record<string, string> = {
  voice: '/media/Mein Projekt/voice.wav',
  music: 'C:\\Users\\Ana\\Musik\\song 1.mp3',
  sfx: '/media/sfx.wav',
};
const resolve = (id: string) => PATHS[id];

function timeline(input: Partial<TimelineInput> & { tracks: TimelineInput['tracks'] }) {
  return timelineSchema.parse({ kind: 'timeline', fps: 1000, width: 1920, height: 1080, durationFrames: 8000, ...input });
}

/** Filterkette (Teil zwischen `;`), die mit dem Label endet. */
function chainFor(graph: string, label: string): string {
  const chain = graph.split(';').find((c) => c.endsWith(`[${label}]`));
  if (!chain) throw new Error(`Kette [${label}] fehlt in:\n${graph}`);
  return chain;
}

describe('buildAudioMixGraph', () => {
  it('ordnet Eingänge nach Spur- und Clip-Reihenfolge und setzt Verzögerungen samplegenau', () => {
    const g = buildAudioMixGraph(
      timeline({
        tracks: [
          { id: 'V1', kind: 'video', clips: [{ id: 'shot', assetId: 'music', start: 0, duration: 8000 }] },
          { id: 'A1', kind: 'audio', clips: [{ id: 'v2', assetId: 'voice', start: 5000, duration: 1000 }, { id: 'v1', assetId: 'voice', start: 2000, duration: 2000 }] },
          { id: 'A2', kind: 'audio', clips: [{ id: 'm1', assetId: 'music', start: 0, duration: 6000 }] },
        ],
      }),
      resolve,
    );
    expect(g.inputs.map((i) => i.clipId)).toEqual(['v1', 'v2', 'm1']);
    expect(g.inputs.map((i) => i.trackId)).toEqual(['A1', 'A1', 'A2']);
    expect(g.inputs[0]).toMatchObject({ path: PATHS.voice, seekSec: 0, durationSec: 2.1 });
    expect(chainFor(g.filterComplex, 'c0')).toMatch(/^\[0:a:0\]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,/);
    expect(chainFor(g.filterComplex, 'c0')).toContain('adelay=delays=96000S:all=1');
    expect(chainFor(g.filterComplex, 'c1')).toContain('adelay=delays=240000S:all=1');
    expect(chainFor(g.filterComplex, 'c2')).not.toContain('adelay');
    // Zwei Clips auf A1 → Spur-Summe, dann Master über beide Spuren
    expect(chainFor(g.filterComplex, 'b1')).toMatch(/^\[c0\]\[c1\]amix=inputs=2:normalize=0:duration=longest,apad=whole_len=384000,atrim=end_sample=384000\[b1\]$/);
    expect(chainFor(g.filterComplex, 'mix')).toMatch(/^\[b1\]\[b2\]amix=inputs=2:normalize=0:duration=longest,alimiter=.*level=0:latency=1,apad=whole_len=384000,atrim=end_sample=384000\[mix\]$/);
    expect(g.outputLabel).toBe('mix');
    expect(g.durationSec).toBe(8);
    expect(g.totalSamples).toBe(384000);
    expect(g.warnings).toEqual([]);
  });

  it('summiert Clip- und Spur-Gain und setzt Fades in Clip-Zeit', () => {
    const g = buildAudioMixGraph(
      timeline({
        tracks: [
          {
            id: 'A1',
            kind: 'audio',
            gainDb: -2,
            clips: [{ id: 'm1', assetId: 'music', start: 1000, duration: 6000, gainDb: -3.5, fadeInFrames: 100, fadeOutFrames: 1000 }],
          },
          { id: 'A2', kind: 'audio', clips: [{ id: 's1', assetId: 'sfx', start: 0, duration: 500 }] },
        ],
      }),
      resolve,
    );
    const c0 = chainFor(g.filterComplex, 'c0');
    expect(c0).toContain('volume=-5.5dB');
    expect(c0).toContain('afade=t=in:st=0:d=0.1');
    expect(c0).toContain('afade=t=out:st=5:d=1');
    expect(c0.indexOf('afade')).toBeLessThan(c0.indexOf('atrim'));
    expect(c0.indexOf('atrim')).toBeLessThan(c0.indexOf('adelay'));
    expect(chainFor(g.filterComplex, 'c1')).not.toMatch(/volume|afade/);
  });

  it('überspringt stumme Spuren, Nicht-Audiospuren, fehlende Assets und Dateien ohne Tonspur', () => {
    const g = buildAudioMixGraph(
      timeline({
        tracks: [
          { id: 'A1', kind: 'audio', muted: true, clips: [{ id: 'muted', assetId: 'voice', start: 0, duration: 1000 }] },
          { id: 'A2', kind: 'audio', clips: [{ id: 'gone', assetId: 'unbekannt', start: 0, duration: 1000 }, { id: 'silent', assetId: 'sfx', start: 2000, duration: 1000 }] },
          { id: 'T1', kind: 'text', clips: [{ id: 'txt', text: 'Hallo', start: 0, duration: 1000 }] },
          { id: 'A3', kind: 'audio', clips: [{ id: 'ok', assetId: 'music', start: 0, duration: 1000 }] },
        ],
      }),
      resolve,
      { silentPaths: new Set([PATHS.sfx!]) },
    );
    expect(g.inputs.map((i) => i.clipId)).toEqual(['ok']);
    expect(g.warnings).toHaveLength(2);
    expect(g.warnings[0]).toMatch(/"gone".*nicht auffindbar/);
    expect(g.warnings[1]).toMatch(/"silent".*keine Audiospur/);
    expect(chainFor(g.filterComplex, 'mix')).toMatch(/^\[b3\]alimiter/);
  });

  it('übersetzt Geschwindigkeit in eine atempo-Kette und liest entsprechend mehr Quelle', () => {
    const g = buildAudioMixGraph(
      timeline({ fps: 30, durationFrames: 300, tracks: [{ id: 'A1', kind: 'audio', clips: [{ id: 'fast', assetId: 'music', start: 30, duration: 60, in: 45, speed: 3 }] }] }),
      resolve,
    );
    expect(g.inputs[0]).toMatchObject({ seekSec: 1.5, durationSec: 6.3 }); // 2 s Timeline × 3 + 0,1 s × 3 Reserve
    const c0 = chainFor(g.filterComplex, 'c0');
    expect(c0).toContain('atempo=2,atempo=1.5');
    expect(c0).toContain('atrim=start_sample=0:end_sample=96000');
    expect(c0).toContain('adelay=delays=48000S:all=1');
    expect(g.durationSec).toBe(10);
    expect(g.totalSamples).toBe(480000);
  });

  it('rendert Teilbereiche: Clip-Anfang abgeschnitten, Fade-in bleibt korrekt', () => {
    const tl = timeline({
      tracks: [
        { id: 'A1', kind: 'audio', clips: [{ id: 'a', assetId: 'music', start: 1000, duration: 4000, in: 500 }] },
        { id: 'A2', kind: 'audio', clips: [{ id: 'b', assetId: 'voice', start: 1000, duration: 4000, fadeInFrames: 2000 }] },
        { id: 'A3', kind: 'audio', clips: [{ id: 'later', assetId: 'sfx', start: 7000, duration: 500 }] },
      ],
    });
    const g = buildAudioMixGraph(tl, resolve, { fromFrame: 2000, toFrame: 4000 });
    expect(g.durationSec).toBe(2);
    expect(g.totalSamples).toBe(96000);
    // Ohne Fade: direkt an die sichtbare Stelle springen (in 0,5 s + 1 s übersprungen)
    expect(g.inputs[0]).toMatchObject({ clipId: 'a', seekSec: 1.5 });
    const ca = chainFor(g.filterComplex, 'c0');
    expect(ca).toContain('atrim=start_sample=0:end_sample=96000');
    expect(ca).not.toContain('adelay');
    // Mit Fade-in über den Schnitt: ab Clip-Anfang dekodieren, Fade anwenden, 1 s verwerfen
    expect(g.inputs[1]).toMatchObject({ clipId: 'b', seekSec: 0 });
    const cb = chainFor(g.filterComplex, 'c1');
    expect(cb).toContain('afade=t=in:st=0:d=2');
    expect(cb).toContain('atrim=start_sample=48000:end_sample=144000');
    expect(g.inputs.map((i) => i.clipId)).not.toContain('later');
  });

  it('beginnt bei einem Start im Fade-out den Fade relativ zum Dekodierbeginn', () => {
    const g = buildAudioMixGraph(
      timeline({ tracks: [{ id: 'A1', kind: 'audio', clips: [{ id: 'a', assetId: 'music', start: 0, duration: 6000, fadeOutFrames: 2000 }] }] }),
      resolve,
      { fromFrame: 5000 },
    );
    expect(g.inputs[0]).toMatchObject({ seekSec: 4 });
    const c0 = chainFor(g.filterComplex, 'c0');
    expect(c0).toContain('afade=t=out:st=0:d=2');
    expect(c0).toContain('atrim=start_sample=48000:end_sample=96000');
  });

  it('duckt per sidechaincompress mit Clip-Bereichen als Schlüssel (exakte Absenkung)', () => {
    const g = buildAudioMixGraph(
      timeline({
        tracks: [
          { id: 'A1', kind: 'audio', role: 'voice', clips: [{ id: 'v1', assetId: 'voice', start: 2000, duration: 2000 }, { id: 'v2', assetId: 'voice', start: 4300, duration: 700 }] },
          { id: 'A2', kind: 'audio', role: 'music', duck: { byTrackId: 'A1', db: -12 }, clips: [{ id: 'm1', assetId: 'music', start: 0, duration: 8000 }] },
        ],
      }),
      resolve,
    );
    const key = chainFor(g.filterComplex, 'k1');
    // Lücke 0,3 s < mergeGap → ein Bereich; Vorlauf 0,15 s
    expect(key).toBe(`aevalsrc=exprs=between(t\\,1.85\\,5):c=stereo:s=48000:d=9,atrim=end_sample=384000[k1]`);
    const duck = chainFor(g.filterComplex, 'd1');
    const threshold = Number(/threshold=([\d.]+)/.exec(duck)?.[1]);
    // Absenkung = −20·log10(threshold)·(1 − 1/ratio) = 12 dB
    expect(-20 * Math.log10(threshold) * (1 - 1 / DUCKING.ratio)).toBeCloseTo(12, 3);
    expect(duck).toMatch(/^\[b1\]\[k1\]sidechaincompress=threshold=[\d.]+:ratio=20:attack=200:release=1200:knee=1:detection=rms:link=maximum:makeup=1\[d1\]$/);
    expect(chainFor(g.filterComplex, 'mix')).toMatch(/^\[b0\]\[d1\]amix=inputs=2/);
  });

  it('duckt nicht, wenn die Schlüsselspur stumm ist; Modus „signal“ teilt die Schlüsselspur auf', () => {
    const tracks: TimelineInput['tracks'] = [
      { id: 'A1', kind: 'audio', clips: [{ id: 'v1', assetId: 'voice', start: 2000, duration: 2000 }] },
      { id: 'A2', kind: 'audio', duck: { byTrackId: 'A1', db: -9 }, clips: [{ id: 'm1', assetId: 'music', start: 0, duration: 8000 }] },
    ];
    const mutedKey = buildAudioMixGraph(timeline({ tracks: [{ ...tracks[0]!, muted: true }, tracks[1]!] }), resolve);
    expect(mutedKey.filterComplex).not.toContain('sidechaincompress');

    const sig = buildAudioMixGraph(timeline({ tracks }), resolve, { ducking: 'signal' });
    expect(sig.filterComplex).toContain('[b0]asplit=2[b0m][b0k0]');
    expect(chainFor(sig.filterComplex, 'd1')).toMatch(/^\[b1\]\[b0k0\]sidechaincompress=/);
    expect(chainFor(sig.filterComplex, 'mix')).toMatch(/^\[b0m\]\[d1\]amix=inputs=2/);
    expect(sig.filterComplex).not.toContain('aevalsrc');
  });

  it('liefert ohne Clips Stille in Timeline-Länge', () => {
    const g = buildAudioMixGraph(timeline({ fps: 30, durationFrames: 90, tracks: [{ id: 'A1', kind: 'audio', clips: [] }] }), resolve, { sampleRate: 44100 });
    expect(g.inputs).toEqual([]);
    expect(g.filterComplex).toBe('anullsrc=r=44100:cl=stereo,atrim=end_sample=132300[mix]');
    expect(g.durationSec).toBe(3);
  });

  it('lässt den Limiter auf Wunsch weg und prüft Bereiche', () => {
    const tl = timeline({ tracks: [{ id: 'A1', kind: 'audio', clips: [{ id: 'a', assetId: 'music', start: 0, duration: 1000 }] }] });
    expect(buildAudioMixGraph(tl, resolve, { limiter: false }).filterComplex).not.toContain('alimiter');
    expect(() => buildAudioMixGraph(tl, resolve, { fromFrame: 5000, toFrame: 4000 })).toThrow(/toFrame/);
    expect(() => buildAudioMixGraph(tl, resolve, { sampleRate: 100 })).toThrow(/Abtastrate/);
  });

  it('keyRanges: Vorlauf, Lücken überbrücken, auf den Renderbereich begrenzen', () => {
    const track = timelineSchema.parse({
      kind: 'timeline',
      fps: 1000,
      width: 1,
      height: 1,
      durationFrames: 20000,
      tracks: [{ id: 'A1', kind: 'audio', clips: [{ id: 'a', assetId: 'x', start: 100, duration: 900 }, { id: 'b', assetId: 'x', start: 1200, duration: 800 }, { id: 'c', assetId: 'x', start: 5000, duration: 1000 }] }],
    }).tracks[0]!;
    expect(keyRanges(track, 0, 20000, 1000, 20)).toEqual([[0, 2], [4.85, 6]]);
    expect(keyRanges(track, 5500, 20000, 1000, 14.5)).toEqual([[0, 0.5]]);
  });
});
