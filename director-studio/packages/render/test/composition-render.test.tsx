// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Player, Thumbnail } from '@remotion/player';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineComposition, type OverlayComponentProps, type TimelineCompositionProps } from '../src/browser.ts';
import { timeline } from './helpers.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.body.innerHTML = '';
});

async function renderAt(props: TimelineCompositionProps, frame: number, size = { width: 1920, height: 1080 }) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Thumbnail
        component={TimelineComposition as never}
        inputProps={props as never}
        compositionWidth={size.width}
        compositionHeight={size.height}
        durationInFrames={Math.max(1, props.timeline.durationFrames)}
        fps={props.timeline.fps}
        frameToDisplay={frame}
      />,
    );
  });
  cleanups.push(() => act(() => root.unmount()));
  return host;
}

/** Testkomponente: legt alle relevanten Props als data-Attribute ab. */
function Probe(p: OverlayComponentProps) {
  return (
    <div
      data-probe=""
      data-frame={p.frame}
      data-duration={p.durationInFrames}
      data-size={`${p.width}x${p.height}`}
      data-color={String(p.props.color ?? '')}
      data-r1={p.random('a').toFixed(8)}
      data-r2={p.random('b').toFixed(8)}
      data-words={p.words.map((w) => w.text).join(' ')}
    />
  );
}

function Wipe(p: OverlayComponentProps) {
  return (
    <div data-wipe="" data-progress={p.progress?.toFixed(3)} style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${(1 - (p.progress ?? 1)) * 100}% 0 0)` }}>
      {p.children}
    </div>
  );
}

function Boom(): never {
  throw new Error('Absichtlicher Fehler');
}

const assets = {
  img: { id: 'img', kind: 'image' as const, url: 'https://example.invalid/bild.png' },
  img2: { id: 'img2', kind: 'image' as const, url: 'https://example.invalid/bild2.png', width: 4000, height: 2000 },
  vid: { id: 'vid', kind: 'video' as const, url: 'https://example.invalid/clip.mp4', durationMs: 10000 },
  song: { id: 'song', kind: 'audio' as const, url: 'https://example.invalid/song.mp3' },
};

describe('TimelineComposition (jsdom)', () => {
  it('zeichnet Spuren in richtiger Reihenfolge und überspringt ausgeblendete', async () => {
    const tl = timeline({
      tracks: [
        { id: 'T1', kind: 'text', clips: [{ id: 'txt', start: 0, duration: 60, text: 'Oben', style: 'title' }] },
        { id: 'V1', kind: 'video', clips: [{ id: 'bg', start: 0, duration: 60, assetId: 'img' }] },
        { id: 'O1', kind: 'overlay', clips: [{ id: 'ov', start: 0, duration: 60, componentId: 'probe' }] },
        { id: 'H1', kind: 'overlay', hidden: true, clips: [{ id: 'hid', start: 0, duration: 60, componentId: 'probe' }] },
        { id: 'A1', kind: 'audio', role: 'music', clips: [{ id: 'mus', start: 0, duration: 60, assetId: 'song' }] },
      ],
      components: { probe: { assetId: 'code1', name: 'Probe' } },
    });
    const host = await renderAt({ timeline: tl, assets, components: { probe: Probe } }, 5);
    const order = Array.from(host.querySelectorAll('[data-track-id]')).map((el) => el.getAttribute('data-track-id'));
    expect(order).toEqual(['V1', 'T1', 'O1']);
    expect(host.querySelector('[data-clip-id="hid"]')).toBeNull();
    expect(host.querySelector('audio')).toBeNull();
    const img = host.querySelector('[data-clip-id="bg"] img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://example.invalid/bild.png');
    expect(img.style.objectFit).toBe('cover');
    expect(host.querySelector('[data-text-style="title"]')?.textContent).toBe('Oben');
    expect(host.querySelector('[data-studio-timeline]')?.getAttribute('lang')).toBe('de');
  });

  it('rendert Clips nur innerhalb ihres Zeitfensters', async () => {
    const tl = timeline({ tracks: [{ id: 'T1', kind: 'text', clips: [{ id: 'a', start: 10, duration: 20, text: 'A' }, { id: 'b', start: 40, duration: 20, text: 'B' }] }] });
    const at5 = await renderAt({ timeline: tl, assets: {} }, 5);
    expect(at5.textContent).not.toContain('A');
    const at15 = await renderAt({ timeline: tl, assets: {} }, 15);
    expect(at15.querySelector('[data-clip-id="a"]')).not.toBeNull();
    expect(at15.querySelector('[data-clip-id="b"]')).toBeNull();
    const at45 = await renderAt({ timeline: tl, assets: {} }, 45);
    expect(at45.querySelector('[data-clip-id="b"]')?.textContent).toBe('B');
  });

  it('übergibt Overlay-Komponenten relative Frames, Props, Wörter und deterministischen Zufall', async () => {
    const tl = timeline({
      tracks: [{ id: 'O1', kind: 'overlay', clips: [{ id: 'ov', start: 30, duration: 30, componentId: 'probe', props: { color: 'rot' } }] }],
      components: { probe: { assetId: 'code1', name: 'Probe' } },
    });
    const words = [
      { text: 'vorher', start: 0.2, end: 0.5 },
      { text: 'drin', start: 1.2, end: 1.5 },
      { text: 'danach', start: 2.5, end: 2.8 },
    ];
    const a = await renderAt({ timeline: tl, assets: {}, components: { probe: Probe }, words }, 40);
    const probe = a.querySelector('[data-probe]')!;
    expect(probe.getAttribute('data-frame')).toBe('10');
    expect(probe.getAttribute('data-duration')).toBe('30');
    expect(probe.getAttribute('data-size')).toBe('1920x1080');
    expect(probe.getAttribute('data-color')).toBe('rot');
    expect(probe.getAttribute('data-words')).toBe('drin');
    expect(probe.getAttribute('data-r1')).not.toBe(probe.getAttribute('data-r2'));
    const b = await renderAt({ timeline: tl, assets: {}, components: { probe: Probe }, words }, 40);
    expect(b.querySelector('[data-probe]')!.getAttribute('data-r1')).toBe(probe.getAttribute('data-r1'));
    const c = await renderAt({ timeline: tl, assets: {}, components: { probe: Probe }, words }, 41);
    expect(c.querySelector('[data-probe]')!.getAttribute('data-r1')).not.toBe(probe.getAttribute('data-r1'));
  });

  it('Überblendung: vorheriger Clip läuft weiter, neuer blendet über die Dauer ein', async () => {
    const tl = timeline({
      tracks: [
        {
          id: 'V1',
          kind: 'video',
          clips: [
            { id: 'a', start: 0, duration: 30, assetId: 'img' },
            { id: 'b', start: 30, duration: 30, assetId: 'img2', transitionIn: { type: 'crossfade', durationFrames: 10 } },
          ],
        },
      ],
    });
    const host = await renderAt({ timeline: tl, assets }, 35);
    expect(host.querySelector('[data-clip-id="a"]')).not.toBeNull();
    const b = host.querySelector('[data-clip-id="b"]') as HTMLElement;
    expect(Number(b.style.opacity)).toBeCloseTo(0.5, 5);
    const later = await renderAt({ timeline: tl, assets }, 45);
    expect(later.querySelector('[data-clip-id="a"]')).toBeNull();
    expect(Number((later.querySelector('[data-clip-id="b"]') as HTMLElement).style.opacity)).toBe(1);
  });

  it('Abblende (dip): Farbfläche am Ende des vorherigen und am Anfang des neuen Clips', async () => {
    const tl = timeline({
      tracks: [
        {
          id: 'V1',
          kind: 'video',
          clips: [
            { id: 'a', start: 0, duration: 30, assetId: 'img' },
            { id: 'b', start: 30, duration: 30, assetId: 'img', transitionIn: { type: 'dip', durationFrames: 10, props: { color: '#ffffff' } } },
          ],
        },
      ],
    });
    const tail = await renderAt({ timeline: tl, assets }, 29);
    const dipA = tail.querySelector('[data-clip-id="a"] [data-dip]') as HTMLElement;
    expect(Number(dipA.style.opacity)).toBe(1);
    expect(dipA.style.backgroundColor).toBe('rgb(255, 255, 255)');
    const head = await renderAt({ timeline: tl, assets }, 32);
    const dipB = head.querySelector('[data-clip-id="b"] [data-dip]') as HTMLElement;
    expect(Number(dipB.style.opacity)).toBeCloseTo(0.6, 5);
  });

  it('Komponenten-Übergang umschließt den eingehenden Clip mit Fortschritt', async () => {
    const tl = timeline({
      tracks: [
        {
          id: 'V1',
          kind: 'video',
          clips: [
            { id: 'a', start: 0, duration: 30, assetId: 'img' },
            { id: 'b', start: 30, duration: 30, assetId: 'img2', transitionIn: { type: 'component', componentId: 'wipe', durationFrames: 20 } },
          ],
        },
      ],
      components: { wipe: { assetId: 'code2', name: 'Wipe' } },
    });
    const host = await renderAt({ timeline: tl, assets, components: { wipe: Wipe } }, 35);
    const wipe = host.querySelector('[data-clip-id="b"] [data-wipe]')!;
    expect(wipe.getAttribute('data-progress')).toBe('0.250');
    expect(wipe.querySelector('img')?.getAttribute('src')).toBe(assets.img2.url);
    expect(host.querySelector('[data-clip-id="a"] img')).not.toBeNull();
  });

  it('Reframing je Format mit bekannten Medienmaßen', async () => {
    const tl = timeline({
      formats: [
        { id: '16:9', width: 1920, height: 1080 },
        { id: '9:16', width: 1080, height: 1920 },
      ],
      tracks: [{ id: 'V1', kind: 'video', clips: [{ id: 'a', start: 0, duration: 30, assetId: 'img2', transform: { fit: 'cover', reframe: { '9:16': { x: 0.25, y: 0.5 } } } }] }],
    });
    const host = await renderAt({ timeline: tl, assets, formatId: '9:16' }, 1, { width: 1080, height: 1920 });
    const img = host.querySelector('img') as HTMLImageElement;
    // 4000×2000 auf 1080×1920 (cover): Skalierung 0,96 → 3840×1920; Mittelpunkt x=0,25 → left = 540 − 960 = −420
    expect(img.style.width).toBe('3840px');
    expect(img.style.left).toBe('-420px');
  });

  it('Karaoke markiert gesprochene, aktuelle und kommende Wörter', async () => {
    const tl = timeline({ tracks: [{ id: 'T1', kind: 'text', clips: [{ id: 'k', start: 0, duration: 90, text: 'eins zwei drei', style: 'karaoke' }] }] });
    const words = [
      { text: 'eins', start: 0, end: 0.9 },
      { text: 'zwei', start: 1, end: 1.9 },
      { text: 'drei', start: 2, end: 2.9 },
    ];
    const host = await renderAt({ timeline: tl, assets: {}, words }, 36);
    const states = Array.from(host.querySelectorAll('[data-word-state]')).map((el) => `${el.textContent}:${el.getAttribute('data-word-state')}`);
    expect(states).toEqual(['eins:past', 'zwei:current', 'drei:future']);
    const wbw = timeline({ tracks: [{ id: 'T1', kind: 'text', clips: [{ id: 'w', start: 0, duration: 90, text: 'x', style: 'word-by-word' }] }] });
    const host2 = await renderAt({ timeline: wbw, assets: {}, words }, 65);
    expect(host2.querySelector('[data-current-word]')?.textContent).toBe('drei');
  });

  it('Untertitel: Standardstil, deutsche Silbentrennung, Safe Area', async () => {
    const tl = timeline({ tracks: [{ id: 'T1', kind: 'text', clips: [{ id: 's', start: 0, duration: 30, text: 'Donaudampfschifffahrtsgesellschaft' }] }] });
    const host = await renderAt({ timeline: tl, assets: {} }, 10);
    const el = host.querySelector('[data-text-style="subtitle"]') as HTMLElement;
    expect(el.getAttribute('lang')).toBe('de');
    expect(el.style.hyphens).toBe('auto');
    expect(el.style.justifyContent).toBe('flex-end');
    expect(el.style.padding).toContain('86px');
  });

  it('Player-Vorschau: Video als stummes <video>, Audio-Spuren nur mit includeAudio', async () => {
    const prev = process.env.NODE_ENV;
    // Remotion behandelt NODE_ENV=test als „Rendern“ – für die Player-Vorschau umschalten.
    process.env.NODE_ENV = 'development';
    try {
      const tl = timeline({
        tracks: [
          { id: 'V1', kind: 'video', clips: [{ id: 'v', start: 0, duration: 60, assetId: 'vid', in: 15 }] },
          { id: 'A1', kind: 'audio', role: 'music', clips: [{ id: 'mus', start: 0, duration: 60, assetId: 'song' }] },
          { id: 'O1', kind: 'overlay', clips: [{ id: 'miss', start: 0, duration: 60, componentId: 'nope' }] },
        ],
        components: { nope: { assetId: 'c1', name: 'Nope' } },
      });
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(
          <Player
            component={TimelineComposition as never}
            inputProps={{ timeline: tl, assets, includeAudio: true } as never}
            compositionWidth={1920}
            compositionHeight={1080}
            durationInFrames={90}
            fps={30}
            initialFrame={5}
            acknowledgeRemotionLicense
          />,
        );
      });
      cleanups.push(() => act(() => root.unmount()));
      const video = host.querySelector('[data-clip-id="v"] video') as HTMLVideoElement;
      expect(video).not.toBeNull();
      expect(video.muted).toBe(true);
      expect(video.getAttribute('src')).toContain('https://example.invalid/clip.mp4');
      // Vorschau zeigt Platzhalter für fehlende Komponenten
      expect(host.querySelector('[data-clip-id="miss"]')?.textContent).toContain('Komponente fehlt: nope');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('Platzhalter für fehlende Komponenten und Fehlergrenze für defekte', async () => {
    const onComponentError = vi.fn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tl = timeline({
      tracks: [
        { id: 'O1', kind: 'overlay', clips: [{ id: 'miss', start: 0, duration: 30, componentId: 'nope' }] },
        { id: 'O2', kind: 'overlay', clips: [{ id: 'boom', start: 0, duration: 30, componentId: 'boom' }] },
      ],
      components: { nope: { assetId: 'c1', name: 'Nope' }, boom: { assetId: 'c2', name: 'Boom' } },
    });
    const hidden = await renderAt({ timeline: tl, assets: {}, components: { boom: Boom }, showPlaceholders: false }, 3);
    expect(hidden.querySelector('[data-placeholder]')).toBeNull();
    // Vorschau (Thumbnail/Player): Platzhalter standardmäßig sichtbar
    const host = await renderAt({ timeline: tl, assets: {}, components: { boom: Boom }, onComponentError }, 3);
    expect(host.querySelector('[data-clip-id="miss"]')?.textContent).toContain('Komponente fehlt: nope');
    expect(host.querySelector('[data-clip-id="boom"]')?.textContent).toContain('Absichtlicher Fehler');
    expect(onComponentError).toHaveBeenCalledWith({ componentId: 'boom', clipId: 'boom', message: 'Absichtlicher Fehler' });
    expect(err.mock.calls.some((c) => String(c[0]).startsWith('[studio:component-error]'))).toBe(true);
    err.mockRestore();
  });
});
