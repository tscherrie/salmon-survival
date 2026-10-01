import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Composer } from '../src/renderer/components/composer/Composer.tsx';
import { Stage } from '../src/renderer/components/stage/Stage.tsx';
import { DEFAULT_PX_PER_SECOND, TIMELINE_PAD } from '../src/renderer/lib/timelineGeometry.ts';
import { DEMO_AUDIO_PATH, DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';

/** clientX für einen Frame (jsdom: getBoundingClientRect = 0, Zoom = Standard 50 px/s, 30 fps). */
const xFor = (frame: number, fps = 30) => TIMELINE_PAD + (frame / fps) * DEFAULT_PX_PER_SECOND;

function lane(container: HTMLElement, trackId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-lane-track="${trackId}"]`);
  if (!el) throw new Error(`Spur ${trackId} fehlt`);
  return el;
}

function click(el: Element, clientX: number, init: MouseEventInit = {}) {
  fireEvent.mouseDown(el, { clientX, button: 0, ...init });
  fireEvent.mouseUp(el, { clientX, button: 0, ...init });
}

describe('Timeline-Bühne', () => {
  it('Klick auf eine Spur fügt eine framegenaue Zeit-Referenz als Chip ein', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(
      <>
        <Stage />
        <Composer />
      </>,
      studio,
    );
    click(lane(container, 'V1'), xFor(372));
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'time', frame: 372 } }]);
    const editor = screen.getByTestId('composer-editor');
    expect(editor.querySelector('.chip')).toHaveTextContent('⏱ 00:12.400');
    // Abspielkopf folgt dem Klick
    expect(studio.store.getState().playhead).toBe(372);
  });

  it('Ziehen innerhalb einer Spur erzeugt eine spurgebundene Spanne', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    const v1 = lane(container, 'V1');
    fireEvent.mouseDown(v1, { clientX: xFor(60), button: 0 });
    fireEvent.mouseMove(window, { clientX: xFor(120) });
    // Auswahl wird während des Ziehens angezeigt
    expect(container.querySelector('.tl-selection')).not.toBeNull();
    fireEvent.mouseMove(window, { clientX: xFor(180) });
    fireEvent.mouseUp(window, { clientX: xFor(180) });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'range', from: 60, to: 180, trackId: 'V1' } }]);
    expect(container.querySelector('.tl-selection')).toBeNull();
  });

  it('Ziehen im Lineal erzeugt eine Spanne ohne Spur; rückwärts wird normalisiert', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    const ruler = container.querySelector('[data-ruler]')!;
    fireEvent.mouseDown(ruler, { clientX: xFor(300), button: 0 });
    fireEvent.mouseMove(window, { clientX: xFor(150) });
    fireEvent.mouseUp(window, { clientX: xFor(150) });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'range', from: 150, to: 300 } }]);
  });

  it('Shift-Klick rastet auf den nächsten Beat ein (nur innerhalb der Toleranz)', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    // Beats liegen alle 15 Frames (120 BPM @ 30 fps); Toleranz 12 px ≈ 7 Frames
    click(lane(container, 'A2'), xFor(37), { shiftKey: true });
    click(lane(container, 'A2'), xFor(37));
    const refs = studio.store.getState().composer.flatMap((s) => (s.type === 'ref' ? [s.ref] : []));
    expect(refs).toEqual([
      { kind: 'time', frame: 30 },
      { kind: 'time', frame: 37 },
    ]);
  });

  it('Alt+Klick auf einen Clip referenziert den Clip', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(
      <>
        <Stage />
        <Composer />
      </>,
      studio,
    );
    const clip = container.querySelector('[data-clip-id="c_sb03"]')!;
    expect(clip).toHaveAttribute('aria-label', expect.stringContaining('Strophe: Tunnel'));
    fireEvent.mouseDown(clip, { clientX: xFor(500), button: 0, altKey: true });
    fireEvent.mouseUp(clip, { clientX: xFor(500), altKey: true });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'clip', clipId: 'c_sb03', trackId: 'V1' } }]);
    expect(screen.getByTestId('composer-editor').querySelector('.chip')).toHaveTextContent('🎬 Strophe: Tunnel');
  });

  it('Klick auf einen Marker fügt eine Marker-Referenz ein', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Stage />, studio);
    fireEvent.click(screen.getByRole('button', { name: 'Marker Refrain 1 bei 00:24.000' }));
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'marker', markerId: 'sec_3' } }]);
    expect(studio.store.getState().playhead).toBe(720);
  });

  it('Tastatur: Enter fügt den Zeitpunkt am Abspielkopf ein, Alt+Enter den Clip der gewählten Spur', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Stage />, studio);
    studio.store.getState().requestSeek(500);
    const timeline = screen.getByRole('group', { name: /Timeline\. Pfeiltasten/ });
    timeline.focus();
    fireEvent.keyDown(timeline, { key: 'Enter' });
    fireEvent.keyDown(timeline, { key: 'ArrowDown' }); // erste Spur → V1 … nächste: V2
    fireEvent.keyDown(timeline, { key: 'ArrowUp' }); // zurück zu V1
    fireEvent.keyDown(timeline, { key: 'Enter', altKey: true });
    const refs = studio.store.getState().composer.flatMap((s) => (s.type === 'ref' ? [s.ref] : []));
    expect(refs).toEqual([
      { kind: 'time', frame: 500 },
      { kind: 'clip', clipId: 'c_sb03', trackId: 'V1' },
    ]);
    // Screenreader-Ansage
    expect(studio.store.getState().announcement).toContain('Referenz hinzugefügt');
  });

  it('zeigt Spuren, Clips mit Namen und Thumbnails sowie Sections', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    expect(container.querySelectorAll('.tl-track-header')).toHaveLength(6);
    const clip = container.querySelector<HTMLElement>('[data-clip-id="c_sb01"]')!;
    expect(within(clip).getByText('Intro: Stadt bei Nacht')).toBeInTheDocument();
    // Filmstreifen-Thumbnail (jsdom verwirft lange data:-URLs im CSSOM, daher nur Existenz prüfen)
    expect(clip.querySelector('.clip-thumbs')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Marker Bridge bei 00:40.000' })).toBeInTheDocument();
  });

  it('Audio-Projekte (1000 fps) nutzen dieselbe Bühne mit Millisekunden-Frames', async () => {
    const studio = await setupStudio({ project: DEMO_AUDIO_PATH });
    const { container } = renderStudio(<Stage />, studio);
    click(lane(container, 'A1'), xFor(12_400, 1000));
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'time', frame: 12_400 } }]);
  });
});
