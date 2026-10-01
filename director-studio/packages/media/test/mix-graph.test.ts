import { timelineSchema, type TimelineInput, type TrackDuck, type TrackInput } from '@studio/core';
import { describe, expect, it } from 'vitest';
import { DUCKING, buildAudioMixGraph, clipContributesAudio, keyRanges, timelineHasMixAudio } from '../src/index.ts';

const PATHS: Record<string, string> = {
  voice: '/media/Mein Projekt/voice.wav',
  music: 'C:\\Users\\Ana\\Musik\\song 1.mp3',
  sfx: '/media/sfx.wav',
  shot: '/media/shot 1.mp4',
  mute: '/media/ohne ton.mp4',
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

describe('buildAudioMixGraph: Fade-Kurven (fadeCurve)', () => {
  it('equal-power → afade mit curve=qsin für Ein- und Ausblendung; linear bleibt ohne Kurvenangabe', () => {
    const g = buildAudioMixGraph(
      timeline({
        tracks: [
          { id: 'A1', kind: 'audio', clips: [{ id: 'ep', assetId: 'music', start: 0, duration: 4000, fadeInFrames: 500, fadeOutFrames: 1000, fadeCurve: 'equal-power' }] },
          { id: 'A2', kind: 'audio', clips: [{ id: 'lin', assetId: 'voice', start: 0, duration: 4000, fadeInFrames: 500, fadeOutFrames: 1000, fadeCurve: 'linear' }] },
          { id: 'A3', kind: 'audio', clips: [{ id: 'std', assetId: 'sfx', start: 0, duration: 4000, fadeInFrames: 500 }] },
        ],
      }),
      resolve,
    );
    const ep = chainFor(g.filterComplex, 'c0');
    expect(ep).toContain('afade=t=in:st=0:d=0.5:curve=qsin,');
    expect(ep).toContain('afade=t=out:st=3:d=1:curve=qsin,');
    for (const label of ['c1', 'c2']) {
      const chain = chainFor(g.filterComplex, label);
      expect(chain).toContain('afade=t=in:st=0:d=0.5,');
      expect(chain).not.toContain('curve=');
    }
  });

  it('equal-power ohne Fades erzeugt keine afade-Filter', () => {
    const g = buildAudioMixGraph(
      timeline({ tracks: [{ id: 'A1', kind: 'audio', clips: [{ id: 'ep', assetId: 'music', start: 0, duration: 4000, fadeCurve: 'equal-power' }] }] }),
      resolve,
    );
    expect(g.filterComplex).not.toContain('afade');
  });
});

describe('buildAudioMixGraph: Originalton von Videoclips (includeSourceAudio)', () => {
  it('mischt Videoclips mit includeSourceAudio wie Audioclips (Ausschnitt, Tempo, Gain, Fades), andere Videoclips nicht', () => {
    const g = buildAudioMixGraph(
      timeline({
        tracks: [
          {
            id: 'V1',
            kind: 'video',
            gainDb: -1,
            clips: [
              { id: 'stumm', assetId: 'shot', start: 0, duration: 1000 },
              { id: 'o-ton', assetId: 'shot', start: 2000, duration: 2000, in: 500, speed: 2, gainDb: -2, fadeOutFrames: 500, fadeCurve: 'equal-power', includeSourceAudio: true },
            ],
          },
          { id: 'V2', kind: 'overlay', clips: [{ id: 'ov', assetId: 'shot', start: 0, duration: 1000 }] },
          { id: 'A1', kind: 'audio', clips: [{ id: 'm1', assetId: 'music', start: 0, duration: 8000 }] },
        ],
      }),
      resolve,
    );
    expect(g.inputs.map((i) => [i.clipId, i.trackId])).toEqual([
      ['o-ton', 'V1'],
      ['m1', 'A1'],
    ]);
    expect(g.inputs[0]).toMatchObject({ path: PATHS.shot, seekSec: 0.5, durationSec: 4.2 });
    const c0 = chainFor(g.filterComplex, 'c0');
    expect(c0).toMatch(/^\[0:a:0\]aresample=48000,/);
    expect(c0).toContain('atempo=2');
    expect(c0).toContain('volume=-3dB');
    expect(c0).toContain('afade=t=out:st=1.5:d=0.5:curve=qsin');
    expect(c0).toContain('adelay=delays=96000S:all=1');
    expect(chainFor(g.filterComplex, 'b0')).toMatch(/^\[c0\]apad=/);
    expect(chainFor(g.filterComplex, 'mix')).toMatch(/^\[b0\]\[b2\]amix=inputs=2/);
    expect(g.warnings).toEqual([]);
  });

  it('überspringt stumme Videospuren und meldet Videos ohne Tonspur', () => {
    const tracks: TimelineInput['tracks'] = [
      { id: 'V1', kind: 'video', clips: [{ id: 'leise', assetId: 'mute', start: 0, duration: 1000, includeSourceAudio: true }, { id: 'laut', assetId: 'shot', start: 1000, duration: 1000, includeSourceAudio: true }] },
    ];
    const g = buildAudioMixGraph(timeline({ tracks }), resolve, { silentPaths: new Set([PATHS.mute!]) });
    expect(g.inputs.map((i) => i.clipId)).toEqual(['laut']);
    expect(g.warnings).toEqual([expect.stringMatching(/"leise".*keine Audiospur/)]);

    const muted = buildAudioMixGraph(timeline({ tracks: [{ ...tracks[0]!, muted: true }] }), resolve);
    expect(muted.inputs).toEqual([]);
    expect(muted.filterComplex).toMatch(/^anullsrc=/);
  });

  it('clipContributesAudio / timelineHasMixAudio', () => {
    expect(clipContributesAudio({ kind: 'audio' }, {})).toBe(true);
    expect(clipContributesAudio({ kind: 'video' }, {})).toBe(false);
    expect(clipContributesAudio({ kind: 'video' }, { includeSourceAudio: true })).toBe(true);
    expect(clipContributesAudio({ kind: 'overlay' }, { includeSourceAudio: true })).toBe(false);
    const onlyVideo = timeline({ tracks: [{ id: 'V1', kind: 'video', clips: [{ id: 'a', assetId: 'shot', start: 0, duration: 100 }] }, { id: 'A1', kind: 'audio', clips: [] }] });
    expect(timelineHasMixAudio(onlyVideo)).toBe(false);
    onlyVideo.tracks[0]!.clips[0]!.includeSourceAudio = true;
    expect(timelineHasMixAudio(onlyVideo)).toBe(true);
    onlyVideo.tracks[0]!.muted = true;
    expect(timelineHasMixAudio(onlyVideo)).toBe(false);
  });
});

describe('buildAudioMixGraph: Ducking-Parameter je Spur (track.duck)', () => {
  const voice: TrackInput = { id: 'A1', kind: 'audio', clips: [{ id: 'v1', assetId: 'voice', start: 2000, duration: 2000 }] };
  const music = (duck: TrackDuck): TrackInput => ({
    id: 'A2',
    kind: 'audio',
    duck,
    clips: [{ id: 'm1', assetId: 'music', start: 0, duration: 8000 }],
  });

  it('attackMs/releaseMs/leadMs im Modus clips', () => {
    const g = buildAudioMixGraph(timeline({ tracks: [voice, music({ byTrackId: 'A1', db: -10, attackMs: 50, releaseMs: 300.5, leadMs: 400 })] }), resolve);
    expect(chainFor(g.filterComplex, 'k1')).toContain('between(t\\,1.6\\,4)');
    expect(chainFor(g.filterComplex, 'd1')).toContain(':attack=50:release=300.5:');
  });

  it('leadMs 0 und Grenzwerte: Rampen werden auf den Bereich von sidechaincompress begrenzt', () => {
    const g = buildAudioMixGraph(timeline({ tracks: [voice, music({ byTrackId: 'A1', db: -10, attackMs: 0, releaseMs: 20000, leadMs: 0 })] }), resolve);
    expect(chainFor(g.filterComplex, 'k1')).toContain('between(t\\,2\\,4)');
    expect(chainFor(g.filterComplex, 'd1')).toContain(':attack=0.01:release=9000:');
  });

  it('duck.mode überschreibt den globalen Standard (ducking-Option)', () => {
    const viaTrack = buildAudioMixGraph(timeline({ tracks: [voice, music({ byTrackId: 'A1', db: -9, mode: 'signal' })] }), resolve);
    expect(viaTrack.filterComplex).toContain('[b0]asplit=2[b0m][b0k0]');
    expect(chainFor(viaTrack.filterComplex, 'd1')).toMatch(/^\[b1\]\[b0k0\]sidechaincompress=.*:attack=20:release=400:/);
    expect(viaTrack.filterComplex).not.toContain('aevalsrc');

    const forcedClips = buildAudioMixGraph(timeline({ tracks: [voice, music({ byTrackId: 'A1', db: -9, mode: 'clips' })] }), resolve, { ducking: 'signal' });
    expect(forcedClips.filterComplex).not.toContain('asplit');
    expect(chainFor(forcedClips.filterComplex, 'd1')).toMatch(/^\[b1\]\[k1\]sidechaincompress=.*:attack=200:release=1200:/);
  });

  it('Modus signal: leadMs zieht die Schlüsselkopie nach vorn (Look-ahead), eigene Rampen', () => {
    const g = buildAudioMixGraph(
      timeline({
        tracks: [
          voice,
          music({ byTrackId: 'A1', db: -12, mode: 'signal', leadMs: 250, attackMs: 5, releaseMs: 800 }),
          { id: 'A3', kind: 'audio', duck: { byTrackId: 'A1', db: -6, mode: 'signal' }, clips: [{ id: 's1', assetId: 'sfx', start: 0, duration: 8000 }] },
        ],
      }),
      resolve,
    );
    expect(g.filterComplex).toContain('[b0]asplit=3[b0m][b0k0][b0k1]');
    expect(chainFor(g.filterComplex, 'b0k0l')).toBe('[b0k0]atrim=start_sample=12000,asetpts=PTS-STARTPTS,apad=whole_len=384000[b0k0l]');
    expect(chainFor(g.filterComplex, 'd1')).toMatch(/^\[b1\]\[b0k0l\]sidechaincompress=.*:attack=5:release=800:/);
    // Zweite geduckte Spur ohne Vorlauf nutzt die unveränderte Kopie
    expect(chainFor(g.filterComplex, 'd2')).toMatch(/^\[b2\]\[b0k1\]sidechaincompress=.*:attack=20:release=400:/);
    expect(chainFor(g.filterComplex, 'mix')).toMatch(/^\[b0m\]\[d1\]\[d2\]amix=inputs=3/);
  });

  it('Modus signal ohne Ton auf der Schlüsselspur fällt mit Clip-Standardwerten auf clips zurück', () => {
    const g = buildAudioMixGraph(
      timeline({ tracks: [{ ...voice, clips: [{ id: 'v1', assetId: 'unbekannt', start: 2000, duration: 2000 }] }, music({ byTrackId: 'A1', db: -9, mode: 'signal' })] }),
      resolve,
    );
    expect(g.warnings.some((w) => /liefert kein Audio/.test(w))).toBe(true);
    expect(chainFor(g.filterComplex, 'k1')).toContain('between(t\\,1.85\\,4)');
    expect(chainFor(g.filterComplex, 'd1')).toContain(':attack=200:release=1200:');
  });

  it('Videospur als Schlüssel: nur Clips mit Originalton zählen (clips und signal)', () => {
    const video: TrackInput = {
      id: 'V1',
      kind: 'video',
      clips: [
        { id: 'bild', assetId: 'shot', start: 0, duration: 2000 },
        { id: 'o-ton', assetId: 'shot', start: 3000, duration: 1000, includeSourceAudio: true },
      ],
    };
    const bed = { id: 'A1', kind: 'audio' as const, duck: { byTrackId: 'V1', db: -8 }, clips: [{ id: 'm1', assetId: 'music', start: 0, duration: 8000 }] };
    const clips = buildAudioMixGraph(timeline({ tracks: [video, bed] }), resolve);
    expect(chainFor(clips.filterComplex, 'k1')).toContain('exprs=between(t\\,2.85\\,4):');

    const sig = buildAudioMixGraph(timeline({ tracks: [video, { ...bed, duck: { ...bed.duck, mode: 'signal' as const } }] }), resolve);
    expect(sig.filterComplex).toContain('[b0]asplit=2[b0m][b0k0]');
    expect(chainFor(sig.filterComplex, 'd1')).toMatch(/^\[b1\]\[b0k0\]sidechaincompress=/);

    const noSource = buildAudioMixGraph(timeline({ tracks: [{ ...video, clips: [video.clips![0]!] }, bed] }), resolve);
    expect(noSource.filterComplex).not.toContain('sidechaincompress');
    expect(noSource.warnings).toEqual([expect.stringMatching(/Videospur "V1".*includeSourceAudio/)]);
  });

  it('Ducking einer Videospur mit Originalton (z. B. Atmo unter der Stimme)', () => {
    const g = buildAudioMixGraph(
      timeline({
        tracks: [
          { id: 'V1', kind: 'video', duck: { byTrackId: 'A1', db: -15 }, clips: [{ id: 'atmo', assetId: 'shot', start: 0, duration: 8000, includeSourceAudio: true }] },
          voice,
        ],
      }),
      resolve,
    );
    expect(chainFor(g.filterComplex, 'd0')).toMatch(/^\[b0\]\[k0\]sidechaincompress=/);
    expect(chainFor(g.filterComplex, 'mix')).toMatch(/^\[d0\]\[b1\]amix=inputs=2/);
  });
});

describe('keyRanges: Optionen', () => {
  const track = timelineSchema.parse({
    kind: 'timeline',
    fps: 1000,
    width: 1,
    height: 1,
    durationFrames: 20000,
    tracks: [{ id: 'A1', kind: 'audio', clips: [{ id: 'a', assetId: 'x', start: 1000, duration: 1000 }, { id: 'b', assetId: 'x', start: 2300, duration: 700 }, { id: 'c', assetId: 'x', start: 6000, duration: 500 }] }],
  }).tracks[0]!;

  it('eigener Vorlauf (leadSec)', () => {
    expect(keyRanges(track, 0, 20000, 1000, 20, { leadSec: 0.5 })).toEqual([[0.5, 3], [5.5, 6.5]]);
    expect(keyRanges(track, 0, 20000, 1000, 20, { leadSec: 0 })).toEqual([[1, 3], [6, 6.5]]); // Lücke 0,3 s überbrückt
    expect(keyRanges(track, 0, 20000, 1000, 20, { leadSec: 0.05 })).toEqual([[0.95, 3], [5.95, 6.5]]);
  });

  it('Teilbereich: überbrückte Lücke vor dem Renderbeginn bleibt erhalten (wie im ganzen Mix)', () => {
    // Ganzer Mix: a und b zu [0,85; 3] verbunden → bei Renderbeginn 2,1 s ist die Absenkung aktiv.
    expect(keyRanges(track, 2100, 20000, 1000, 17.9)).toEqual([[0, 0.9], [3.75, 4.4]]);
  });

  it('Clip knapp nach dem Renderende wirkt mit seinem Vorlauf noch hinein', () => {
    expect(keyRanges(track, 0, 5900, 1000, 5.9, { leadSec: 0.3 })).toEqual([[0.7, 3], [5.7, 5.9]]);
  });
});

