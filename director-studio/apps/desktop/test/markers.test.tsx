import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Composer } from '../src/renderer/components/composer/Composer.tsx';
import { Stage } from '../src/renderer/components/stage/Stage.tsx';
import { Workspace } from '../src/renderer/components/workspace/Workspace.tsx';
import {
  DEFAULT_PX_PER_SECOND,
  MARKER_PROXIMITY_PX,
  TIMELINE_PAD,
  layoutMarkerTags,
  markerStripHit,
  markerTagWidth,
} from '../src/renderer/lib/timelineGeometry.ts';
import { selectUserMarkers } from '../src/renderer/state/selectors.ts';
import { DEMO_VIDEO_PATH, renderStudio, setupStudio, type Studio } from './helpers.tsx';

/**
 * Markerleiste (DESIGN.md §8; Test-Vertrag §15): Ein Nutzer-Marker ist ein Zeit-Chip im Composer. Nummern, Entfernen,
 * Sprünge, Duplikate, Tastatur der Leiste und die Verknüpfung in beide Richtungen. jsdom misst nichts: `clientX`
 * entspricht der x-Position im Inhalt (50 px/s, 30 fps); Umschalt schaltet das standardmäßig aktive Beat-Raster ab.
 */
const xFor = (frame: number, fps = 30) => TIMELINE_PAD + (frame / fps) * DEFAULT_PX_PER_SECOND;

async function setup(withComposer = true): Promise<Studio & { container: HTMLElement }> {
  const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
  const { container } = renderStudio(
    withComposer ? (
      <>
        <Stage />
        <Composer />
      </>
    ) : (
      <Stage />
    ),
    studio,
  );
  return { ...studio, container };
}

/** Klick in die Markerleiste (framegenau). */
function setMarker(container: HTMLElement, frame: number) {
  const strip = container.querySelector<HTMLElement>('[data-marker-strip]')!;
  fireEvent.mouseDown(strip, { clientX: xFor(frame), clientY: 8, button: 0, shiftKey: true });
  fireEvent.mouseUp(strip, { clientX: xFor(frame), clientY: 8, button: 0, shiftKey: true });
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Marker' });
const tagLabels = () => within(toolbar()).queryAllByRole('button').map((b) => b.getAttribute('aria-label'));
const tag = (n: number) => within(toolbar()).getByRole('button', { name: new RegExp(`^Marker ${n} bei`) });
const chips = () => Array.from(screen.getByTestId('composer-editor').querySelectorAll<HTMLElement>('.chip'));

describe('Markerleiste: Geometrie (§8.3, §8.4)', () => {
  it('markerStripHit: 16 px Leiste plus 4 px im Lineal, außer über Kappe oder Raute', () => {
    expect(markerStripHit(0)).toBe(true);
    expect(markerStripHit(15.9)).toBe(true);
    expect(markerStripHit(19)).toBe(true);
    expect(markerStripHit(19, { blocked: true })).toBe(false);
    expect(markerStripHit(20)).toBe(false);
    expect(markerStripHit(-1)).toBe(false);
  });

  it('layoutMarkerTags: zentriert, bei Nähe versetzt, ab vier Markern innerhalb von 18 px ein Sammel-Tag', () => {
    const pps = 30; // 1 Frame = 1 px bei 30 fps
    const at = (frame: number) => ({ frame });
    const items = layoutMarkerTags([at(100), at(110), at(400), at(404), at(408), at(412), at(700)], pps, 30);
    expect(items.map((i) => (i.type === 'tag' ? [i.type, i.x, i.level] : [i.type, i.markers.length, i.from, i.to]))).toEqual([
      ['tag', TIMELINE_PAD + 100, 'low'],
      ['tag', TIMELINE_PAD + 110, 'high'],
      ['collector', 4, 400, 412],
      ['tag', TIMELINE_PAD + 700, 'normal'],
    ]);
    // Genau an der Grenze gilt der Abstand nicht mehr als nah
    const far = layoutMarkerTags([at(0), at(MARKER_PROXIMITY_PX)], pps, 30);
    expect(far.map((i) => i.type === 'tag' && i.level)).toEqual(['normal', 'normal']);
    // Drei nahe Marker bleiben einzeln (abwechselnd tief/hoch)
    const three = layoutMarkerTags([at(0), at(5), at(10)], pps, 30);
    expect(three.map((i) => i.type === 'tag' && i.level)).toEqual(['low', 'high', 'low']);
    expect([markerTagWidth(9), markerTagWidth(10)]).toEqual([16, 20]);
  });
});

describe('Markerleiste: Verhalten (§8.1–8.5)', () => {
  it('Nummern: der neue Marker bekommt die kleinste freie Nummer', async () => {
    const { container, store } = await setup();
    setMarker(container, 300);
    setMarker(container, 600);
    setMarker(container, 900);
    expect(tagLabels()).toEqual([
      'Marker 1 bei 00:10:00. Enter springt dorthin, Entf entfernt.',
      'Marker 2 bei 00:20:00. Enter springt dorthin, Entf entfernt.',
      'Marker 3 bei 00:30:00. Enter springt dorthin, Entf entfernt.',
    ]);
    act(() => store.getState().removeRefByKey('time:300'));
    setMarker(container, 1200);
    // Lücke 1 wird wiederverwendet; die Tags stehen nach Zeit, nicht nach Nummer
    expect(tagLabels().map((l) => l?.slice(0, 20))).toEqual(['Marker 2 bei 00:20:0', 'Marker 3 bei 00:30:0', 'Marker 1 bei 00:40:0']);
    expect(container.querySelector('.tl-index-count')).toHaveTextContent('3');
    // Ein neuer Marker „setzt sich“ (§5)
    expect(tag(1)).toHaveClass('is-settling');
  });

  it('Chip entfernen (×) entfernt den Marker samt Linie', async () => {
    const { container, store } = await setup();
    setMarker(container, 300);
    setMarker(container, 600);
    expect(container.querySelectorAll('.tl-lanes .mk-line')).toHaveLength(2);
    const remove = chips()[0]!.querySelector('.chip-remove')!;
    fireEvent.mouseDown(remove);
    expect(store.getState().composer.filter((s) => s.type === 'ref')).toEqual([{ type: 'ref', ref: { kind: 'time', frame: 600 } }]);
    expect(tagLabels()).toEqual(['Marker 2 bei 00:20:00. Enter springt dorthin, Entf entfernt.']);
    expect(container.querySelectorAll('.tl-lanes .mk-line')).toHaveLength(1);
    expect(store.getState().announcement).toBe('Marker 1 entfernt');
  });

  it('Klick auf einen Marker setzt den Abspielkopf (harter Sprung), fokussiert ihn und lässt den Chip blitzen', async () => {
    const { container, store } = await setup();
    setMarker(container, 450);
    expect(store.getState().playhead).toBe(0);
    const marker = tag(1);
    fireEvent.mouseDown(marker, { button: 0 });
    marker.focus();
    fireEvent.click(marker);
    expect(store.getState().playhead).toBe(450);
    expect(store.getState().seekRequest?.frame).toBe(450);
    expect(document.activeElement).toBe(marker);
    expect(store.getState().flash?.key).toBe('time:450');
    await waitFor(() => expect(chips()[0]).toHaveClass('is-flash'));
    // Kein zweiter Marker durch den Klick auf den Tag
    expect(store.getState().composer.filter((s) => s.type === 'ref')).toHaveLength(1);
  });

  it('Enter am Abspielkopf setzt einen Marker (auch während der Wiedergabe, ohne den Abspielkopf zu bewegen)', async () => {
    const { store } = await setup();
    act(() => {
      store.getState().requestSeek(372);
      store.getState().setPlaying(true);
    });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'time', frame: 372 } }]);
    expect(store.getState().playhead).toBe(372);
    expect(store.getState().playing).toBe(true);
    expect(store.getState().announcement).toBe('Marker 1 bei 00:12:12 gesetzt');
    expect(tag(1)).toBeInTheDocument();
  });

  it('[ und ] springen zwischen den Markern; am Ende nur die Ansage', async () => {
    const { container, store } = await setup();
    setMarker(container, 300);
    setMarker(container, 600);
    act(() => store.getState().requestSeek(450));
    fireEvent.keyDown(document.body, { key: ']' });
    expect(store.getState().playhead).toBe(600);
    fireEvent.keyDown(document.body, { key: ']' });
    expect(store.getState().playhead).toBe(600);
    expect(store.getState().announcement).toBe('Kein weiterer Marker');
    fireEvent.keyDown(document.body, { key: '[' });
    expect(store.getState().playhead).toBe(300);
    // Deutsche Tastatur (macOS): Wahl+5 erzeugt „[“ – zählt als Klammer, nicht als Abschnittssprung
    act(() => store.getState().requestSeek(700));
    fireEvent.keyDown(document.body, { key: '[', code: 'Digit5', altKey: true });
    expect(store.getState().playhead).toBe(600);
    // Die Knöpfe in der Index-Spalte tun dasselbe
    fireEvent.click(screen.getByRole('button', { name: 'Vorheriger Marker' }));
    expect(store.getState().playhead).toBe(300);
    fireEvent.click(screen.getByRole('button', { name: 'Nächster Marker' }));
    expect(store.getState().playhead).toBe(600);
  });

  it('Duplikat am selben Frame: kein zweiter Chip, stattdessen Blitz und Ansage', async () => {
    const { container, store } = await setup();
    setMarker(container, 300);
    setMarker(container, 300);
    expect(store.getState().composer.filter((s) => s.type === 'ref')).toHaveLength(1);
    expect(store.getState().announcement).toBe('Marker 1 ist bereits gesetzt');
    expect(store.getState().flash?.key).toBe('time:300');
    // Auch Enter am Abspielkopf auf demselben Frame
    act(() => store.getState().requestSeek(300));
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(store.getState().composer.filter((s) => s.type === 'ref')).toHaveLength(1);
    expect(tagLabels()).toHaveLength(1);
  });

  it('Entf auf einem fokussierten Marker entfernt Marker und Chip; der Fokus geht zum Nachbarn, zuletzt zur Timeline', async () => {
    const { container, store } = await setup();
    setMarker(container, 300);
    setMarker(container, 600);
    setMarker(container, 900);
    // Roving-Tabindex: genau ein Marker ist per Tab erreichbar
    expect(within(toolbar()).getAllByRole('button').filter((b) => b.tabIndex === 0)).toEqual([tag(1)]);
    tag(1).focus();
    // ← / → bewegen nur den Fokus, der Abspielkopf bleibt
    fireEvent.keyDown(tag(1), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tag(2));
    expect(store.getState().playhead).toBe(0);
    fireEvent.keyDown(tag(2), { key: 'Delete' });
    expect(store.getState().composer.filter((s) => s.type === 'ref').map((s) => s.type === 'ref' && s.ref)).toEqual([
      { kind: 'time', frame: 300 },
      { kind: 'time', frame: 900 },
    ]);
    expect(store.getState().announcement).toBe('Marker 2 entfernt');
    expect(document.activeElement).toBe(tag(3));
    fireEvent.keyDown(tag(3), { key: 'Backspace' });
    expect(document.activeElement).toBe(tag(1));
    // Enter auf dem fokussierten Marker springt (nativer Klick), statt einen neuen zu setzen
    fireEvent.click(tag(1));
    expect(store.getState().playhead).toBe(300);
    fireEvent.keyDown(tag(1), { key: 'Delete' });
    expect(store.getState().composer.filter((s) => s.type === 'ref')).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole('group', { name: /^Timeline, nur lesbar/ }));
  });

  it('Esc in der Leiste kehrt zur Timeline zurück', async () => {
    const { container } = await setup(false);
    setMarker(container, 300);
    tag(1).focus();
    fireEvent.keyDown(tag(1), { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('group', { name: /^Timeline, nur lesbar/ }));
  });

  it('Hover-Verknüpfung in beide Richtungen (.is-linked an Chip, Tag und Linie)', async () => {
    const { container, store } = await setup();
    setMarker(container, 300);
    setMarker(container, 600);
    // Tag → Chip
    fireEvent.mouseEnter(tag(2));
    expect(store.getState().hoveredRefKey).toBe('time:600');
    expect(chips().map((c) => c.classList.contains('is-linked'))).toEqual([false, true]);
    expect(container.querySelector('.tl-lanes .mk-line.is-linked')).not.toBeNull();
    fireEvent.mouseLeave(tag(2));
    expect(chips().some((c) => c.classList.contains('is-linked'))).toBe(false);
    // Chip → Tag und Linie
    fireEvent.mouseOver(chips()[0]!);
    expect(store.getState().hoveredRefKey).toBe('time:300');
    expect(tag(1)).toHaveClass('is-linked');
    expect(tag(2)).not.toHaveClass('is-linked');
    expect(container.querySelectorAll('.mk-line.is-linked')).toHaveLength(2); // Kopfzone und Spuren
  });

  it('Rechtsklick öffnet das Kontextmenü: Hierhin springen · Marker entfernen', async () => {
    const { container, store } = await setup();
    setMarker(container, 300);
    fireEvent.contextMenu(tag(1), { clientX: 100, clientY: 100 });
    const menu = screen.getByRole('menu', { name: 'Marker 1' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Hierhin springen' }));
    expect(store.getState().playhead).toBe(300);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(tag(1), { clientX: 100, clientY: 100 });
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Marker entfernen/ }));
    expect(store.getState().composer).toEqual([]);
    expect(tagLabels()).toEqual([]);
  });

  it('Während der Aufnahme schweben Marker (Umriss, ohne Nummer, nicht bedienbar)', async () => {
    const { container, store } = await setup(false);
    act(() => store.getState().startVoice(performance.now()));
    setMarker(container, 300);
    expect(store.getState().composer).toEqual([]);
    expect(selectUserMarkers(store.getState())).toEqual([{ key: 'time:300', frame: 300, n: 0, pending: true }]);
    expect(container.querySelector('.mk.is-pending')).not.toBeNull();
    expect(container.querySelector('.mk-line.is-pending')).not.toBeNull();
    expect(tagLabels()).toEqual([]);
  });

  it('Das Sammel-Tag zoomt auf seinen Bereich', async () => {
    const { container, store } = await setup(false);
    // Vier Marker innerhalb von 18 px (bei 50 px/s sind 6 Frames 10 px)
    for (const frame of [300, 303, 306, 309]) act(() => store.getState().addMarkerAt(frame));
    const collector = within(toolbar()).getByRole('button', { name: /^4 Marker zwischen 00:10:00 und 00:10:09/ });
    const content = container.querySelector<HTMLElement>('.tl-content')!;
    const before = parseFloat(content.style.width);
    fireEvent.click(collector);
    expect(parseFloat(content.style.width)).toBeGreaterThan(before * 5);
    expect(tagLabels()).toHaveLength(4);
  });

  it('Im Arbeitsbereich hat die Timeline Vorrang: Umschalt+→ springt zum Schlag, Enter setzt einen Marker', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Workspace />, studio);
    act(() => studio.store.getState().requestSeek(100));
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(studio.store.getState().playhead).toBe(105);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'time', frame: 105 } }]);
    // Bild für Bild (←/→) bleibt beim Arbeitsbereich
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(studio.store.getState().playhead).toBe(106);
  });
});
