import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Composer } from '../src/renderer/components/composer/Composer.tsx';
import { Stage } from '../src/renderer/components/stage/Stage.tsx';
import { DEFAULT_PX_PER_SECOND, TIMELINE_PAD } from '../src/renderer/lib/timelineGeometry.ts';
import { DEMO_AUDIO_PATH, DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';

/**
 * Timeline-Bühne (DESIGN.md §7.9, §8; Test-Vertrag §15). jsdom misst nichts: `getBoundingClientRect` liefert 0, der
 * Zoom bleibt beim Standard (50 px/s). `clientX` entspricht damit der x-Position im Inhalt, `clientY` der Höhe ab
 * Oberkante der Markerleiste. Das Demo hat 120 BPM bei 30 fps: Schläge alle 15 Frames, Beat-Raster standardmäßig an.
 */
const xFor = (frame: number, fps = 30) => TIMELINE_PAD + (frame / fps) * DEFAULT_PX_PER_SECOND;

function lane(container: HTMLElement, trackId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-lane-track="${trackId}"]`);
  if (!el) throw new Error(`Spur ${trackId} fehlt`);
  return el;
}

function strip(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-marker-strip]');
  if (!el) throw new Error('Markerleiste fehlt');
  return el;
}

function click(el: Element, clientX: number, init: MouseEventInit = {}) {
  fireEvent.mouseDown(el, { clientX, clientY: 8, button: 0, ...init });
  fireEvent.mouseUp(el, { clientX, clientY: 8, button: 0, ...init });
}

const refsOf = (studio: Awaited<ReturnType<typeof setupStudio>>) => studio.store.getState().composer.flatMap((s) => (s.type === 'ref' ? [s.ref] : []));

describe('Timeline-Bühne: Zonen und Gesten (§8.4)', () => {
  it('Klick in die Markerleiste erzeugt einen nummerierten Zeit-Chip; der Abspielkopf bleibt stehen', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(
      <>
        <Stage />
        <Composer />
      </>,
      studio,
    );
    act(() => studio.store.getState().requestSeek(90));
    // Umschalt kehrt das Beat-Raster um: framegenau
    click(strip(container), xFor(372), { shiftKey: true });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'time', frame: 372 } }]);
    expect(studio.store.getState().playhead).toBe(90);
    const chip = screen.getByTestId('composer-editor').querySelector<HTMLElement>('.chip')!;
    expect(chip.querySelector('.n')).toHaveTextContent('1');
    expect(chip.querySelector('.chip-label')).toHaveTextContent('00:12:12');
    expect(chip.dataset.refKey).toBe('time:372');
    // Der Marker steht nummeriert in der Leiste
    expect(within(screen.getByRole('toolbar', { name: 'Marker' })).getByRole('button', { name: /^Marker 1 bei 00:12:12/ })).toBeInTheDocument();
  });

  it('Beat-Raster: Klick in die Leiste rastet auf den nächsten Schlag (12 px), Umschalt hebt das auf, B schaltet es ab', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    click(strip(container), xFor(37));
    expect(refsOf(studio)).toEqual([{ kind: 'time', frame: 30 }]);
    click(strip(container), xFor(52), { shiftKey: true });
    expect(refsOf(studio).at(-1)).toEqual({ kind: 'time', frame: 52 });
    // Weit weg von jedem Schlag (Toleranz 12 px ≈ 7 Frames): kein Einrasten
    const toggle = screen.getByRole('button', { name: 'Beat-Raster' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('director-studio.timeline.beatGrid')).toBe('off');
    expect(studio.store.getState().announcement).toBe('Beat-Raster aus');
    click(strip(container), xFor(98));
    expect(refsOf(studio).at(-1)).toEqual({ kind: 'time', frame: 98 });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('Die Trefferzone der Leiste ragt 4 px ins Lineal; darunter ist das Lineal Scrub-Zone', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    const ruler = container.querySelector('[data-ruler]')!;
    click(ruler, xFor(300), { clientY: 18 });
    expect(refsOf(studio)).toEqual([{ kind: 'time', frame: 300 }]);
    click(ruler, xFor(450), { clientY: 30 });
    expect(refsOf(studio)).toHaveLength(1);
    expect(studio.store.getState().playhead).toBe(450);
  });

  it('Ziehen in der Markerleiste ist ohne Funktion (keine Spanne, kein Marker)', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    fireEvent.mouseDown(strip(container), { clientX: xFor(60), clientY: 8, button: 0 });
    fireEvent.mouseMove(window, { clientX: xFor(180) });
    fireEvent.mouseUp(window, { clientX: xFor(180) });
    expect(studio.store.getState().composer).toEqual([]);
    expect(studio.store.getState().playhead).toBe(0);
  });

  it('Klick in einer Spur setzt nur den Abspielkopf (eingerastet), kein Chip; die Spur wird aktiv', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    click(lane(container, 'A2'), xFor(37));
    expect(studio.store.getState().composer).toEqual([]);
    expect(studio.store.getState().playhead).toBe(30);
    expect(studio.store.getState().activeTrackId).toBe('A2');
    click(lane(container, 'V1'), xFor(372), { shiftKey: true });
    expect(studio.store.getState().playhead).toBe(372);
    expect(container.querySelector('.tl-selection')).toBeNull();
  });

  it('Ziehen in einer Spur scrubbt framegenau, pausiert die Wiedergabe und erzeugt keinen Chip', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    act(() => studio.store.getState().setPlaying(true));
    const v1 = lane(container, 'V1');
    fireEvent.mouseDown(v1, { clientX: xFor(60), button: 0 });
    fireEvent.mouseMove(window, { clientX: xFor(120) });
    expect(studio.store.getState().playing).toBe(false);
    fireEvent.mouseMove(window, { clientX: xFor(187) });
    // Framegenau, ohne Einrasten (187 liegt 2 Frames neben einem Schlag)
    expect(studio.store.getState().playhead).toBe(187);
    fireEvent.mouseUp(window, { clientX: xFor(187) });
    expect(studio.store.getState().composer).toEqual([]);
    expect(studio.store.getState().playing).toBe(false);
  });

  it('Die Kappe des Abspielkopfs ist greifbar: Ziehen scrubbt, ohne Sprung beim Greifen und ohne Marker', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    act(() => studio.store.getState().requestSeek(300));
    const cap = container.querySelector<HTMLElement>('.tl-playhead-cap')!;
    // Die Kappe liegt im oberen Band des Lineals (Trefferzone der Leiste) und hat dort Vorrang
    fireEvent.mouseDown(cap, { clientX: xFor(302), clientY: 18, button: 0 });
    expect(studio.store.getState().playhead).toBe(300);
    expect(container.querySelector('.tl')).toHaveClass('is-grabbing');
    fireEvent.mouseMove(window, { clientX: xFor(331) });
    expect(studio.store.getState().playhead).toBe(331);
    fireEvent.mouseUp(window, { clientX: xFor(331) });
    expect(container.querySelector('.tl')).not.toHaveClass('is-grabbing');
    expect(studio.store.getState().composer).toEqual([]);
  });

  it('Alt+Klick auf einen Clip referenziert ihn (Ring und Nummer am Clip); ohne Alt nur Sprung', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(
      <>
        <Stage />
        <Composer />
      </>,
      studio,
    );
    const clip = container.querySelector<HTMLElement>('[data-clip-id="c_sb03"]')!;
    expect(clip).toHaveAttribute('aria-label', expect.stringContaining('Strophe: Tunnel'));
    fireEvent.mouseDown(clip, { clientX: xFor(500), button: 0, altKey: true });
    fireEvent.mouseUp(clip, { clientX: xFor(500), altKey: true });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'clip', clipId: 'c_sb03', trackId: 'V1' } }]);
    const chip = screen.getByTestId('composer-editor').querySelector<HTMLElement>('.chip')!;
    expect(chip.querySelector('.chip-label')).toHaveTextContent('Strophe: Tunnel');
    expect(chip.dataset.refKey).toBe('clip:c_sb03');
    const refClip = container.querySelector<HTMLElement>('[data-clip-id="c_sb03"]')!;
    expect(refClip).toHaveClass('is-ref');
    expect(refClip.querySelector('.clip-n')).toHaveTextContent('1');
    expect(studio.store.getState().coach.altReference).toBe('done');
  });

  it('Nach drei Klicks in die Spuren ohne Alt erscheint einmal der Hinweis auf Alt+Klick', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    for (const frame of [30, 60, 90]) click(lane(container, 'V1'), xFor(frame));
    expect(studio.store.getState().toasts.map((t) => t.text)).toEqual(['Alt+Klick auf einen Clip referenziert ihn']);
    expect(studio.store.getState().coach.altReference).toBe('done');
    click(lane(container, 'V1'), xFor(120));
    expect(studio.store.getState().toasts).toHaveLength(1);
  });

  it('Abschnitt „Refrain 1“: Klick springt, Alt+Klick erzeugt den Marker-Ref', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Stage />, studio);
    const section = screen.getByRole('button', { name: 'Abschnitt Refrain 1 bei 00:24:00. Alt+Klick referenziert.' });
    fireEvent.mouseDown(section, { button: 0, clientY: 48 });
    expect(studio.store.getState().playhead).toBe(720);
    expect(studio.store.getState().composer).toEqual([]);
    fireEvent.mouseDown(section, { button: 0, clientY: 48, altKey: true });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'marker', markerId: 'sec_3' } }]);
    // Referenziert: Nummer am Label; der aktuelle Abschnitt ist hervorgehoben
    expect(section).toHaveClass('is-ref', 'is-current');
    expect(section.querySelector('.tl-ref-n')).toHaveTextContent('1');
  });

  it('Dokument-Rauten (Notiz, Prüfpunkt): Klick springt, Alt+Klick referenziert', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Stage />, studio);
    const qa = screen.getByRole('button', { name: 'Sync prüfen bei 00:30:00. Alt+Klick referenziert.' });
    fireEvent.mouseDown(qa, { button: 0, clientY: 34 });
    expect(studio.store.getState().playhead).toBe(900);
    fireEvent.mouseDown(screen.getByRole('button', { name: /^Tunnel länger\? bei 00:16:00/ }), { button: 0, clientY: 34, altKey: true });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'marker', markerId: 'note_tunnel' } }]);
  });

  it('Audio-Projekte (1000 fps) nutzen dieselbe Bühne mit Millisekunden-Frames', async () => {
    const studio = await setupStudio({ project: DEMO_AUDIO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    click(strip(container), xFor(12_400, 1000), { shiftKey: true });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'time', frame: 12_400 } }]);
    click(lane(container, 'A1'), xFor(20_000, 1000));
    expect(studio.store.getState().playhead).toBe(20_000);
  });
});

describe('Timeline-Bühne: Tastatur (§8.5)', () => {
  it('Enter setzt einen Marker am Abspielkopf (ohne Einrasten); Umschalt+Enter referenziert den Clip der aktiven Spur', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Stage />, studio);
    act(() => studio.store.getState().requestSeek(500));
    const timeline = screen.getByRole('group', { name: 'Timeline, nur lesbar. Enter setzt Marker am Abspielkopf. Klammern springen zwischen Markern.' });
    timeline.focus();
    fireEvent.keyDown(timeline, { key: 'Enter' });
    expect(studio.store.getState().announcement).toBe('Marker 1 bei 00:16:20 gesetzt');
    fireEvent.keyDown(timeline, { key: 'ArrowDown' }); // erste Spur → V1 … nächste: V2
    fireEvent.keyDown(timeline, { key: 'ArrowUp' }); // zurück zu V1
    fireEvent.keyDown(timeline, { key: 'Enter', shiftKey: true });
    expect(refsOf(studio)).toEqual([
      { kind: 'time', frame: 500 },
      { kind: 'clip', clipId: 'c_sb03', trackId: 'V1' },
    ]);
    expect(studio.store.getState().announcement).toContain('Referenz hinzugefügt');
  });

  it('Alt+Enter setzt einen Marker, auch aus dem Composer heraus', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(
      <>
        <Stage />
        <Composer />
      </>,
      studio,
    );
    act(() => studio.store.getState().requestSeek(240));
    const editor = screen.getByTestId('composer-editor');
    editor.focus();
    const event = fireEvent.keyDown(editor, { key: 'Enter', altKey: true });
    expect(event).toBe(false); // verarbeitet (kein Zeilenumbruch)
    expect(refsOf(studio)).toEqual([{ kind: 'time', frame: 240 }]);
  });

  it('Enter in einem Textfeld oder auf einem Knopf setzt keinen Marker', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(
      <>
        <Stage />
        <input aria-label="Feld" />
      </>,
      studio,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Feld' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Einpassen' }), { key: 'Enter' });
    expect(studio.store.getState().composer).toEqual([]);
  });

  it('Umschalt+←/→ springt zum vorigen bzw. nächsten Schlag; Alt+[ / Alt+] zu den Abschnitten', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Stage />, studio);
    act(() => studio.store.getState().requestSeek(100));
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(studio.store.getState().playhead).toBe(105);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', shiftKey: true });
    expect(studio.store.getState().playhead).toBe(90);
    fireEvent.keyDown(document.body, { key: '“', code: 'BracketRight', altKey: true });
    expect(studio.store.getState().playhead).toBe(240);
    fireEvent.keyDown(document.body, { key: '‘', code: 'BracketRight', altKey: true });
    expect(studio.store.getState().playhead).toBe(720);
    fireEvent.keyDown(document.body, { key: '“', code: 'BracketLeft', altKey: true });
    expect(studio.store.getState().playhead).toBe(240);
    expect(studio.store.getState().composer).toEqual([]);
  });

  it('Ohne Beats springt Umschalt+→ um eine Sekunde', async () => {
    const studio = await setupStudio({ project: DEMO_AUDIO_PATH });
    renderStudio(<Stage />, studio);
    act(() => studio.store.getState().requestSeek(1000));
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(studio.store.getState().playhead).toBe(2000);
  });

  it('+ / − zoomen, Umschalt+Z passt ein', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    const content = container.querySelector<HTMLElement>('.tl-content')!;
    const before = parseFloat(content.style.width);
    fireEvent.keyDown(document.body, { key: '+' });
    expect(parseFloat(content.style.width)).toBeGreaterThan(before);
    fireEvent.keyDown(document.body, { key: '-' });
    fireEvent.keyDown(document.body, { key: '-' });
    expect(parseFloat(content.style.width)).toBeLessThan(before);
    fireEvent.keyDown(document.body, { key: 'Z', shiftKey: true });
    expect(parseFloat(content.style.width)).toBe(before);
  });
});

describe('Timeline-Bühne: Anatomie (§7.9)', () => {
  it('zeigt Index-Spalte, Spuren, Clips mit Namen und Filmstreifen, Abschnitte und Rauten', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    expect(container.querySelectorAll('.tl-track-header')).toHaveLength(6);
    const clip = container.querySelector<HTMLElement>('[data-clip-id="c_sb01"]')!;
    expect(within(clip).getByText('Intro: Stadt bei Nacht')).toBeInTheDocument();
    expect(clip.querySelector('.clip-no')).toHaveTextContent('01');
    // Filmstreifen-Thumbnail (jsdom verwirft lange data:-URLs im CSSOM, daher nur Existenz prüfen)
    expect(clip.querySelector('.clip-thumbs')).not.toBeNull();
    // Text-Clips zeigen ihren Text; Audio nach Rolle getönt
    expect(within(container.querySelector<HTMLElement>('[data-clip-id="lyr_02"]')!).getByText('Lichter ziehen vorbei')).toBeInTheDocument();
    expect(container.querySelector('[data-clip-id="song"]')).toHaveClass('tone-music');
    expect(container.querySelector('[data-clip-id="voc"]')).toHaveClass('tone-voice');
    expect(container.querySelector('[data-clip-id="sfx_whoosh"]')).toHaveClass('tone-sfx');
    expect(screen.getByRole('button', { name: 'Abschnitt Bridge bei 00:40:00. Alt+Klick referenziert.' })).toBeInTheDocument();
    // Index: großer Timecode (SMPTE), Legenden, Marker-Zähler
    expect(container.querySelector('.tl-index-tc')).toHaveTextContent('00:00:00:00');
    expect(screen.getByText('Zeit')).toBeInTheDocument();
    expect(screen.getByText('120 BPM')).toBeInTheDocument();
    expect(container.querySelector('.tl-index-count')).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Vorheriger Marker' })).toBeDisabled();
    // Keine dauerhafte Hinweisprosa mehr, dafür der einmalige Hinweis in der Leiste
    expect(screen.queryByText(/Ziehen: Spanne/)).toBeNull();
    expect(screen.getByText('Klick hier setzt einen Marker · Enter setzt einen am Abspielkopf')).toBeInTheDocument();
  });

  it('Der einmalige Hinweis verschwindet beim Betreten der Leiste und nach dem ersten Marker für immer', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container, unmount } = renderStudio(<Stage />, studio);
    const coach = 'Klick hier setzt einen Marker · Enter setzt einen am Abspielkopf';
    const head = container.querySelector<HTMLElement>('.tl-head')!;
    fireEvent.mouseMove(strip(container), { clientX: xFor(184), clientY: 8 });
    expect(screen.queryByText(coach)).toBeNull();
    // Geister-Marker mit Timecode in der Leiste (kein schwebender Kasten), eingerastet mit Magnet
    expect(container.querySelector('.mk-ghost')).not.toBeNull();
    expect(container.querySelector('.mk-ghost-tc')).toHaveTextContent('00:06:00');
    expect(container.querySelector('.mk-ghost-tc .icon')).not.toBeNull();
    fireEvent.mouseLeave(head);
    expect(screen.getByText(coach)).toBeInTheDocument();
    click(strip(container), xFor(184));
    expect(screen.queryByText(coach)).toBeNull();
    act(() => studio.store.getState().removeRefByKey('time:180'));
    expect(studio.store.getState().composer).toEqual([]);
    expect(screen.queryByText(coach)).toBeNull();
    unmount();
    expect(JSON.parse(localStorage.getItem('director-studio.coach')!)).toMatchObject({ markerStrip: 'done' });
  });

  it('Eingeklappt bleibt nur die Leiste; der Abspielkopf-Timecode steht dann neben dem Titel', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    // Ohne Layout-Kontext ist die Bühne offen: kein TC in der Leiste, dafür groß im Index
    expect(container.querySelector('.stage-tc')).toBeNull();
    expect(container.querySelector('.tl-index-tc')).not.toBeNull();
  });
});
