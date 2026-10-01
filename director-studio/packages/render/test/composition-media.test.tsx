// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, Thumbnail } from '@remotion/player';
import { DUCK_DEFAULTS, type TimedWord as CoreTimedWord, type Track } from '@studio/core';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  audibleClips,
  clipFadeGain,
  computeClipVolume,
  duckingDb,
  TimelineComposition,
  type MediaErrorInfo,
  type TimedWord,
  type TimelineCompositionProps,
} from '../src/browser.ts';
import { timeline } from './helpers.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHY = '\u00AD';
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function thumbnail(props: TimelineCompositionProps, frame: number) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Thumbnail
        component={TimelineComposition as never}
        inputProps={props as never}
        compositionWidth={1920}
        compositionHeight={1080}
        durationInFrames={Math.max(1, props.timeline.durationFrames)}
        fps={props.timeline.fps}
        frameToDisplay={frame}
      />,
    );
  });
  cleanups.push(() => act(() => root.unmount()));
  return host;
}

/** Player-Vorschau (Remotion behandelt NODE_ENV=test als „Rendern“ – daher umschalten). */
async function player(props: TimelineCompositionProps, frame: number, sharedAudioTags?: number) {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  cleanups.push(() => {
    process.env.NODE_ENV = prev;
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Player
        component={TimelineComposition as never}
        inputProps={props as never}
        compositionWidth={1920}
        compositionHeight={1080}
        durationInFrames={Math.max(1, props.timeline.durationFrames)}
        fps={props.timeline.fps}
        initialFrame={frame}
        acknowledgeRemotionLicense
        {...(sharedAudioTags !== undefined ? { numberOfSharedAudioTags: sharedAudioTags } : {})}
      />,
    );
  });
  cleanups.unshift(() => act(() => root.unmount()));
  return host;
}

async function fireError(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new Event('error'));
  });
}

const assets = {
  img: { id: 'img', kind: 'image' as const, url: 'https://example.invalid/kaputt.png' },
  ok: { id: 'ok', kind: 'image' as const, url: 'https://example.invalid/gut.png' },
  vid: { id: 'vid', kind: 'video' as const, url: 'https://example.invalid/bild-statt-video.png', durationMs: 10000 },
  song: { id: 'song', kind: 'audio' as const, url: 'https://example.invalid/song.mp3' },
};

describe('TimelineComposition: fehlende/defekte Medien', () => {
  it('Bild lädt nicht (404/Dekodierfehler): Platzhalter in der Vorschau, onMediaError einmal, Rest bleibt', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onMediaError = vi.fn<(info: MediaErrorInfo) => void>();
    const tl = timeline({
      tracks: [
        { id: 'V1', kind: 'video', clips: [{ id: 'kaputt', start: 0, duration: 60, assetId: 'img' }] },
        { id: 'V2', kind: 'video', clips: [{ id: 'gut', start: 0, duration: 60, assetId: 'ok' }] },
        { id: 'T1', kind: 'text', clips: [{ id: 'txt', start: 0, duration: 60, text: 'Hallo' }] },
      ],
    });
    const host = await thumbnail({ timeline: tl, assets, onMediaError, showPlaceholders: true }, 5);
    const img = host.querySelector('[data-clip-id="kaputt"] img');
    // Erster Fehler → ein Wiederholversuch, zweiter Fehler → defekt.
    await fireError(img);
    expect(onMediaError).not.toHaveBeenCalled();
    await fireError(img);
    expect(host.querySelector('[data-clip-id="kaputt"] img')).toBeNull();
    expect(host.querySelector('[data-clip-id="kaputt"] [data-placeholder]')?.textContent).toContain('Bild nicht ladbar');
    expect(onMediaError).toHaveBeenCalledTimes(1);
    expect(onMediaError.mock.calls[0]![0]).toMatchObject({ clipId: 'kaputt', assetId: 'img', kind: 'image', url: assets.img.url });
    expect(host.querySelector('[data-clip-id="gut"] img')?.getAttribute('src')).toBe(assets.ok.url);
    expect(host.querySelector('[data-clip-id="txt"]')?.textContent).toBe('Hallo');
    expect((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.some((c) => String(c[0]).startsWith('[studio:media-error]'))).toBe(true);
  });

  it('beim Rendern (ohne Platzhalter) wird das defekte Medium still ausgelassen', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onMediaError = vi.fn();
    const tl = timeline({ tracks: [{ id: 'V1', kind: 'video', clips: [{ id: 'kaputt', start: 0, duration: 60, assetId: 'img' }] }] });
    const host = await thumbnail({ timeline: tl, assets, onMediaError, showPlaceholders: false }, 5);
    await fireError(host.querySelector('img'));
    await fireError(host.querySelector('img'));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[data-placeholder]')).toBeNull();
    expect(host.querySelector('[data-clip-id="kaputt"]')).not.toBeNull();
    expect(onMediaError).toHaveBeenCalledTimes(1);
  });

  it('fehlendes Asset, bekannter Vorab-Fehler und nicht darstellbare Art werden gemeldet, ohne zu laden', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onMediaError = vi.fn<(info: MediaErrorInfo) => void>();
    const tl = timeline({
      tracks: [
        { id: 'V1', kind: 'video', clips: [{ id: 'weg', start: 0, duration: 60, assetId: 'gibtsnicht' }] },
        { id: 'V2', kind: 'video', clips: [{ id: 'vorab', start: 0, duration: 60, assetId: 'img' }] },
        { id: 'V3', kind: 'video', clips: [{ id: 'ton', start: 0, duration: 60, assetId: 'song' }] },
      ],
    });
    const media = { ...assets, img: { ...assets.img, error: 'Datei fehlt' } };
    const host = await thumbnail({ timeline: tl, assets: media, onMediaError, showPlaceholders: true }, 5);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[data-clip-id="weg"]')?.textContent).toContain('Asset fehlt: gibtsnicht');
    expect(host.querySelector('[data-clip-id="vorab"]')?.textContent).toContain('nicht ladbar: Datei fehlt');
    const byClip = Object.fromEntries(onMediaError.mock.calls.map(([info]) => [info.clipId, info]));
    expect(byClip.weg).toMatchObject({ assetId: 'gibtsnicht', kind: 'unknown', message: 'Asset fehlt: gibtsnicht' });
    expect(byClip.vorab).toMatchObject({ assetId: 'img', kind: 'image', message: 'Asset img nicht ladbar: Datei fehlt' });
    expect(byClip.ton).toMatchObject({ assetId: 'song', kind: 'audio' });
    expect(onMediaError).toHaveBeenCalledTimes(3);
  });

  it('Player: Video lässt sich nicht dekodieren (Bild-URL am Video-Asset) → Platzhalter statt Absturz', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onMediaError = vi.fn<(info: MediaErrorInfo) => void>();
    const tl = timeline({
      tracks: [
        { id: 'V1', kind: 'video', clips: [{ id: 'v', start: 0, duration: 60, assetId: 'vid' }] },
        { id: 'T1', kind: 'text', clips: [{ id: 'txt', start: 0, duration: 60, text: 'Weiter' }] },
      ],
    });
    const host = await player({ timeline: tl, assets, onMediaError }, 5);
    await fireError(host.querySelector('[data-clip-id="v"] video'));
    expect(host.querySelector('[data-clip-id="v"] video')).toBeNull();
    expect(host.querySelector('[data-clip-id="v"] [data-placeholder]')?.textContent).toContain('Video nicht ladbar');
    expect(onMediaError).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'v', assetId: 'vid', kind: 'video' }));
    expect(host.querySelector('[data-clip-id="txt"]')?.textContent).toBe('Weiter');
  });
});

describe('TimelineComposition: Originalton von Videoclips (includeSourceAudio)', () => {
  const tl = timeline({
    tracks: [
      {
        id: 'V1',
        kind: 'video',
        gainDb: -6,
        clips: [
          { id: 'mitTon', start: 0, duration: 30, assetId: 'clip', includeSourceAudio: true, in: 15 },
          { id: 'stumm', start: 30, duration: 30, assetId: 'clip2' },
          { id: 'bild', start: 60, duration: 30, assetId: 'still', includeSourceAudio: true },
        ],
      },
      { id: 'A1', kind: 'audio', role: 'music', clips: [{ id: 'mus', start: 0, duration: 90, assetId: 'song' }] },
    ],
  });
  const media = {
    clip: { id: 'clip', kind: 'video' as const, url: 'https://example.invalid/mit-ton.mp4' },
    clip2: { id: 'clip2', kind: 'video' as const, url: 'https://example.invalid/ohne.mp4' },
    still: { id: 'still', kind: 'image' as const, url: 'https://example.invalid/bild.png' },
    song: assets.song,
  };

  it('audibleClips: Videospur liefert nur Clips mit includeSourceAudio und Video-Asset', () => {
    expect(audibleClips(tl.tracks[0]!, media).map((c) => c.clip.id)).toEqual(['mitTon']);
    expect(audibleClips(tl.tracks[1]!, media).map((c) => c.clip.id)).toEqual(['mus']);
    expect(audibleClips(tl.tracks[0]!, { ...media, clip: { ...media.clip, error: 'Datei fehlt' } })).toEqual([]);
    // Lautstärke folgt Spur-/Clip-Gain wie bei Audiospuren
    expect(computeClipVolume(tl, tl.tracks[0]!, tl.tracks[0]!.clips[0]!, 5)).toBeCloseTo(10 ** (-6 / 20), 5);
  });

  it('Player mit includeAudio spielt den Ton des Videos mit; ohne includeAudio nicht', async () => {
    // Ohne geteilte Audio-Tags rendert jedes <Html5Audio> sein eigenes <audio> (prüfbar im DOM).
    const host = await player({ timeline: tl, assets: media, includeAudio: true }, 5, 0);
    const srcs = Array.from(host.querySelectorAll('audio')).map((a) => a.getAttribute('src') ?? '');
    expect(srcs.some((s) => s.includes('mit-ton.mp4'))).toBe(true);
    expect(srcs.some((s) => s.includes('song.mp3'))).toBe(true);
    expect(srcs.some((s) => s.includes('ohne.mp4'))).toBe(false);
    // Das sichtbare Video bleibt stumm.
    expect((host.querySelector('[data-clip-id="mitTon"] video') as HTMLVideoElement).muted).toBe(true);
    const silent = await player({ timeline: tl, assets: media, includeAudio: false }, 5, 0);
    expect(Array.from(silent.querySelectorAll('audio')).some((a) => (a.getAttribute('src') ?? '').includes('mit-ton.mp4'))).toBe(false);
  });

  it('defekte Tondatei: Meldung statt Absturz, das <audio> wird entfernt', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const onMediaError = vi.fn<(info: MediaErrorInfo) => void>();
    const host = await player({ timeline: tl, assets: media, includeAudio: true, onMediaError }, 5, 0);
    const song = Array.from(host.querySelectorAll('audio')).find((a) => (a.getAttribute('src') ?? '').includes('song.mp3'));
    await fireError(song ?? null);
    expect(onMediaError).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'mus', assetId: 'song', kind: 'audio' }));
    expect(Array.from(host.querySelectorAll('audio')).some((a) => (a.getAttribute('src') ?? '').includes('song.mp3'))).toBe(false);
    expect(Array.from(host.querySelectorAll('audio')).some((a) => (a.getAttribute('src') ?? '').includes('mit-ton.mp4'))).toBe(true);
  });
});

describe('Ton-Hüllkurven: Ducking-Rampen und Fade-Kurven', () => {
  const tl = timeline({
    tracks: [
      { id: 'A1', kind: 'audio', role: 'voice', clips: [{ id: 'vo', start: 60, duration: 30, assetId: 'x' }] },
      { id: 'A2', kind: 'audio', role: 'music', duck: { byTrackId: 'A1', db: -12, attackMs: 1000, releaseMs: 2000, leadMs: 500 }, clips: [{ id: 'm', start: 0, duration: 90, assetId: 'y' }] },
    ],
    durationFrames: 200,
  });
  const music = tl.tracks[1]!;

  it('attackMs/leadMs/releaseMs bestimmen die Rampen (Vorschau wie Export: Absenkung beginnt leadMs vor dem Clip)', () => {
    // Vorlauf 0,5 s = 15 Frames → Absenkung beginnt bei Frame 45; Attack 1 s = 30 Frames → voll ab Frame 75.
    expect(duckingDb(tl, music, 44, 30)).toBe(0);
    expect(duckingDb(tl, music, 45, 30)).toBe(0);
    expect(duckingDb(tl, music, 60, 30)).toBeCloseTo(-6, 5);
    expect(duckingDb(tl, music, 75, 30)).toBe(-12);
    // Release 2 s = 60 Frames ab dem Ende (Frame 90).
    expect(duckingDb(tl, music, 120, 30)).toBeCloseTo(-6, 5);
    expect(duckingDb(tl, music, 150, 30)).toBe(0);
  });

  it('Standardwerte, Lückenbrücke und Schlüssel-Clips wie im Export-Mix (DUCK_DEFAULTS)', () => {
    const fps = 30;
    const base = timeline({
      tracks: [
        // Zwei Sprach-Clips mit 0,4 s Lücke (< 0,5 s) → eine durchgehende Absenkung
        { id: 'A1', kind: 'audio', role: 'voice', clips: [{ id: 'v1', start: 30, duration: 30, assetId: 'x' }, { id: 'v2', start: 72, duration: 30, assetId: 'x' }] },
        { id: 'A2', kind: 'audio', role: 'music', duck: { byTrackId: 'A1', db: -10 }, clips: [{ id: 'm', start: 0, duration: 200, assetId: 'y' }] },
        // Videospur ohne Originalton taugt nicht als Schlüssel
        { id: 'V1', kind: 'video', clips: [{ id: 'c', start: 0, duration: 100, assetId: 'z' }] },
        { id: 'A3', kind: 'audio', duck: { byTrackId: 'V1', db: -10 }, clips: [{ id: 'm2', start: 0, duration: 200, assetId: 'y' }] },
        // Positive Werte senken (wie im Export) nicht ab
        { id: 'A4', kind: 'audio', duck: { byTrackId: 'A1', db: 6 }, clips: [{ id: 'm3', start: 0, duration: 200, assetId: 'y' }] },
      ],
      durationFrames: 300,
    });
    const [, music, , underVideo, positive] = base.tracks as [unknown, Track, unknown, Track, Track];
    const lead = (DUCK_DEFAULTS.clips.leadMs / 1000) * fps;
    const attack = (DUCK_DEFAULTS.clips.attackMs / 1000) * fps;
    const release = (DUCK_DEFAULTS.clips.releaseMs / 1000) * fps;
    expect(duckingDb(base, music, 30 - lead + attack / 2, fps)).toBeCloseTo(-5, 5);
    // In der überbrückten Lücke (Frame 60–67,5) bleibt die Musik voll abgesenkt.
    expect(duckingDb(base, music, 64, fps)).toBe(-10);
    expect(duckingDb(base, music, 102 + release / 2, fps)).toBeCloseTo(-5, 5);
    expect(duckingDb(base, music, 102 + release, fps)).toBe(0);
    expect(duckingDb(base, underVideo, 50, fps)).toBe(0);
    const withSound = { ...base, tracks: base.tracks.map((t) => (t.id === 'V1' ? { ...t, clips: t.clips.map((c) => ({ ...c, includeSourceAudio: true })) } : t)) };
    expect(duckingDb(withSound, underVideo, 50, fps)).toBe(-10);
    expect(duckingDb(base, positive, 50, fps)).toBe(0);
    // signal-Modus: eigene Standards (kein Vorlauf, 20 ms Attack)
    const signal: Track = { ...music, duck: { byTrackId: 'A1', db: -10, mode: 'signal' } };
    expect(duckingDb(base, signal, 29, fps)).toBe(0);
    expect(duckingDb(base, signal, 31, fps)).toBe(-10);
  });

  it('fadeCurve equal-power: Viertelsinus statt linear', () => {
    const clip = { duration: 100, fadeInFrames: 9, fadeOutFrames: 9 };
    expect(clipFadeGain(clip, 4)).toBeCloseTo(0.5, 5);
    expect(clipFadeGain({ ...clip, fadeCurve: 'equal-power' as const }, 4)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(clipFadeGain({ ...clip, fadeCurve: 'equal-power' as const }, 50)).toBe(1);
  });
});

describe('Textclips: deutsche Silbentrennung', () => {
  it('Untertitel bekommen bedingte Trennstriche; hyphens none/lang en schalten ab', async () => {
    const tl = timeline({
      tracks: [
        {
          id: 'T1',
          kind: 'text',
          clips: [
            { id: 'de', start: 0, duration: 30, text: 'Die Geschwindigkeitsbegrenzung' },
            { id: 'aus', start: 0, duration: 30, text: 'Geschwindigkeitsbegrenzung', style: 'caption', props: { hyphens: 'none' } },
            { id: 'en', start: 0, duration: 30, text: 'Geschwindigkeitsbegrenzung', style: 'title', props: { lang: 'en' } },
          ],
        },
      ],
    });
    const host = await thumbnail({ timeline: tl, assets: {} }, 5);
    expect(host.querySelector('[data-clip-id="de"]')?.textContent).toBe(`Die Ge${SHY}schwin${SHY}dig${SHY}keits${SHY}be${SHY}gren${SHY}zung`);
    expect(host.querySelector('[data-clip-id="aus"]')?.textContent).toBe('Geschwindigkeitsbegrenzung');
    const en = host.querySelector('[data-text-style][data-clip-id="en"]')!;
    expect(en.textContent).toBe('Geschwindigkeitsbegrenzung');
    expect(en.getAttribute('lang')).toBe('en');
    const english = await thumbnail({ timeline: tl, assets: {}, lang: 'en' }, 5);
    expect(english.querySelector('[data-clip-id="de"]')?.textContent).toBe('Die Geschwindigkeitsbegrenzung');
    expect(english.querySelector('[data-studio-timeline]')?.getAttribute('lang')).toBe('en');
  });

  it('Karaoke trennt lange Wörter, ohne die Wortzustände zu ändern', async () => {
    const tl = timeline({ tracks: [{ id: 'T1', kind: 'text', clips: [{ id: 'k', start: 0, duration: 90, text: 'x', style: 'karaoke' }] }] });
    const words = [
      { text: 'Lichterkette', start: 0, end: 0.9 },
      { text: 'leuchtet', start: 1, end: 1.9 },
    ];
    const host = await thumbnail({ timeline: tl, assets: {}, words }, 36);
    const states = Array.from(host.querySelectorAll('[data-word-state]')).map((el) => `${el.textContent}:${el.getAttribute('data-word-state')}`);
    expect(states).toEqual([`Lich${SHY}ter${SHY}ket${SHY}te:past`, 'leuchtet:current']);
  });

  it('TimedWord ist der Typ aus @studio/core', () => {
    expectTypeOf<TimedWord>().toEqualTypeOf<CoreTimedWord>();
  });
});
