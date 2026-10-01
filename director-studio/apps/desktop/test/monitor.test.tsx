import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StudioApi } from '@studio/core';
import { Monitor } from '../src/renderer/components/monitor/Monitor.tsx';
import { clipAtPlayhead, fitBox, safeAreasFor } from '../src/renderer/components/monitor/VideoMonitor.tsx';
import { Stage } from '../src/renderer/components/stage/Stage.tsx';
import { createStudioStore } from '../src/renderer/state/store.ts';
import { DEMO_AUDIO_PATH, DEMO_CANVAS_PATH, DEMO_DECK_PATH, DEMO_VIDEO_PATH, DEMO_WEB_PATH, renderStudio, setupStudio } from './helpers.tsx';

function refs(studio: Awaited<ReturnType<typeof setupStudio>>) {
  return studio.store.getState().composer.flatMap((s) => (s.type === 'ref' ? [s.ref] : []));
}

/** Klick bzw. Ziehen auf der Zeigerebene (jsdom: Koordinaten = Dokument-Pixel). */
function pointerClick(el: Element, x: number, y: number, init: MouseEventInit = {}) {
  fireEvent.mouseDown(el, { clientX: x, clientY: y, button: 0, ...init });
  fireEvent.mouseUp(window, { clientX: x, clientY: y, ...init });
}

function pointerDrag(el: Element, from: [number, number], to: [number, number]) {
  fireEvent.mouseDown(el, { clientX: from[0], clientY: from[1], button: 0 });
  fireEvent.mouseMove(window, { clientX: to[0], clientY: to[1] });
  fireEvent.mouseUp(window, { clientX: to[0], clientY: to[1] });
}

describe('Monitor: Transport (Video)', () => {
  it('Format-Segment, Safe Areas, Timecode und Meta stehen im Transport unter dem Bild', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { container } = renderStudio(<Monitor />, studio);
    expect(await screen.findByTestId('remotion-player')).toBeInTheDocument();
    const monitor = screen.getByRole('region', { name: 'Monitor' });
    expect(monitor).toHaveClass('always-dark');
    // Keine obere Leiste mehr: Der Transport ist das letzte Element unter dem Bild
    expect(container.querySelector('.monitor-toolbar')).toBeNull();
    const transport = screen.getByRole('toolbar', { name: 'Transport' });
    expect(transport.previousElementSibling).toHaveClass('monitor-stage');

    const group = within(transport).getByRole('group', { name: 'Format' });
    expect(within(group).getByRole('button', { name: '16:9' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(group).getByRole('button', { name: '9:16' }));
    expect(studio.store.getState().formatId).toBe('9:16');
    await userEvent.click(within(transport).getByRole('button', { name: /Safe Areas/ }));
    expect(document.querySelectorAll('.safe-area').length).toBe(2);
    expect(safeAreasFor({ id: '9:16', width: 1080, height: 1920 })[0]!.kind).toBe('ui');

    // Timecode (SMPTE, Frames gedämpft) und Gesamtdauer; Meta aus dem Clip unter dem Abspielkopf
    expect(screen.getByRole('timer')).toHaveAccessibleName('Abspielkopf 00:00:00:00 von 00:01:00:00');
    expect(transport.querySelector('.tp-tc .ff')).toHaveTextContent(':00');
    expect(transport.querySelector('.tp-meta')).toHaveTextContent(/^Intro: Stadt bei Nacht · V1 · v3$/);
    act(() => studio.store.getState().requestSeek(305));
    expect(screen.getByRole('timer')).toHaveAccessibleName('Abspielkopf 00:00:10:05 von 00:01:00:00');
  });

  it('Wiedergabe: Play, Bild vor/zurück; ohne Marker springen die äußeren Knöpfe an Anfang und Ende', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Monitor />, studio);
    await screen.findByTestId('remotion-player');
    const transport = screen.getByRole('toolbar', { name: 'Transport' });
    const toggle = vi.fn();
    const pause = vi.fn();
    act(() => studio.store.getState().setTransport({ play: vi.fn(), pause, toggle, isPlaying: () => false }));
    await userEvent.click(within(transport).getByRole('button', { name: 'Abspielen' }));
    expect(toggle).toHaveBeenCalled();
    act(() => studio.store.getState().setPlaying(true));
    expect(within(transport).getByRole('button', { name: 'Anhalten' })).toBeInTheDocument();

    act(() => studio.store.getState().requestSeek(100));
    await userEvent.click(within(transport).getByRole('button', { name: 'Bild vor' }));
    expect(pause).toHaveBeenCalled();
    expect(studio.store.getState().playhead).toBe(101);
    await userEvent.click(within(transport).getByRole('button', { name: 'Bild zurück' }));
    await userEvent.click(within(transport).getByRole('button', { name: 'Bild zurück' }));
    expect(studio.store.getState().playhead).toBe(99);

    await userEvent.click(within(transport).getByRole('button', { name: 'Ans Ende' }));
    expect(studio.store.getState().playhead).toBe(1799);
    await userEvent.click(within(transport).getByRole('button', { name: 'An den Anfang' }));
    expect(studio.store.getState().playhead).toBe(0);
  });

  it('Mit Nutzer-Markern springen die äußeren Knöpfe zum vorigen bzw. nächsten Marker', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Monitor />, studio);
    await screen.findByTestId('remotion-player');
    act(() => {
      studio.store.getState().addMarkerAt(300);
      studio.store.getState().addMarkerAt(900);
    });
    const transport = screen.getByRole('toolbar', { name: 'Transport' });
    expect(within(transport).queryByRole('button', { name: 'An den Anfang' })).toBeNull();
    await userEvent.click(within(transport).getByRole('button', { name: 'Nächster Marker' }));
    expect(studio.store.getState().playhead).toBe(300);
    await userEvent.click(within(transport).getByRole('button', { name: 'Nächster Marker' }));
    expect(studio.store.getState().playhead).toBe(900);
    await userEvent.click(within(transport).getByRole('button', { name: 'Vorheriger Marker' }));
    expect(studio.store.getState().playhead).toBe(300);
  });

  it('Ton aus/an schaltet den Knopf um', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Monitor />, studio);
    await screen.findByTestId('remotion-player');
    const transport = screen.getByRole('toolbar', { name: 'Transport' });
    await userEvent.click(within(transport).getByRole('button', { name: 'Ton aus' }));
    expect(within(transport).getByRole('button', { name: 'Ton an' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Bildgröße nach §2.4: Breite − 24, Höhe − 12, im Seitenverhältnis', () => {
    // 1440×900: Monitorspalte 800 × 492, Transport 44 → Bildbereich 800 × 448 (gemessen ohne Transport)
    expect(fitBox({ width: 1920, height: 1080 }, { width: 800, height: 448 })).toEqual({ width: 775, height: 436 });
    expect(fitBox({ width: 1920, height: 1080 }, { width: 1196, height: 594 })).toEqual({ width: 1034, height: 582 });
  });

  it('Banner für alte Versionen steht im Monitor und führt zurück', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Monitor />, studio);
    await act(() => studio.store.getState().viewVersion(2));
    const banner = await screen.findByText('Du siehst v2 (nur ansehen)');
    expect(banner.closest('.version-banner')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Monitor' })).toHaveClass('is-viewing-old');
    await userEvent.click(screen.getByRole('button', { name: 'Zur aktuellen Version' }));
    expect(studio.store.getState().viewing).toBeNull();
    expect(screen.queryByText('Du siehst v2 (nur ansehen)')).toBeNull();
  });

  it('clipAtPlayhead: erste sichtbare Spur mit einem Clip an der Stelle', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const doc = studio.store.getState().document;
    if (doc?.kind !== 'timeline') throw new Error('Timeline erwartet');
    expect(clipAtPlayhead(doc, 0)?.trackId).toBe('V1');
    expect(clipAtPlayhead(doc, doc.durationFrames + 10)).toBeNull();
  });

  it('Audio-Projekt: Mix-Wellenform statt Bild, Transport ohne Format und Safe Areas', async () => {
    const studio = await setupStudio({ project: DEMO_AUDIO_PATH });
    renderStudio(<Monitor />, studio);
    expect(await screen.findByRole('img', { name: 'Mix-Wellenform' })).toBeInTheDocument();
    const transport = screen.getByRole('toolbar', { name: 'Transport' });
    expect(within(transport).queryByRole('group', { name: 'Format' })).toBeNull();
    expect(within(transport).queryByRole('button', { name: /Safe Areas/ })).toBeNull();
    expect(within(transport).getByRole('button', { name: 'Abspielen' })).toBeInTheDocument();
  });
});

describe('Monitor: Zeigen auf Inhalte', () => {
  it('Präsentation: Klick auf ein Element → Element-Referenz; leere Stelle → Folie; Ziehen → Region', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    renderStudio(<Monitor />, studio);
    const overlay = screen.getByRole('application', { name: /Folie 1 von 4/ });
    // Titel-Element liegt bei x 160–1560, y 360–560
    pointerClick(overlay, 400, 420);
    pointerClick(overlay, 1800, 1000);
    pointerDrag(overlay, [100, 100], [300, 250]);
    expect(refs(studio)).toEqual([
      { kind: 'element', doc: 'deck', slideId: 's_title', elementId: 'el_title', bbox: { x: 160, y: 360, width: 1400, height: 200 } },
      { kind: 'slide', slideId: 's_title' },
      { kind: 'region', doc: 'deck', slideId: 's_title', rect: { x: 100, y: 100, width: 200, height: 150 } },
    ]);
    // Nächste Folie (Leiste unter dem Bild: ‹ 2 / 4 ›)
    const bar = screen.getByRole('toolbar', { name: 'Monitor' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Nächste Folie' }));
    expect(screen.getByRole('application', { name: /Folie 2 von 4/ })).toBeInTheDocument();
    expect(bar.querySelector('.tp-count')).toHaveTextContent('2/4');
  });

  it('Referenzierte Stellen tragen ein Tag mit derselben Nummer wie der Chip; Hover verknüpft', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    const { container } = renderStudio(<Monitor />, studio);
    const overlay = screen.getByRole('application', { name: /Folie 1 von 4/ });
    act(() => studio.store.getState().insertRef({ kind: 'time', frame: 0 }));
    pointerClick(overlay, 400, 620); // Untertitel
    pointerDrag(overlay, [1300, 760], [1800, 1000]);
    const boxes = [...container.querySelectorAll<HTMLElement>('.sel-box.is-ref')];
    expect(boxes.map((b) => b.querySelector('.n')?.textContent)).toEqual(['2', '3']);
    expect(boxes[0]!.querySelector('.sel-label')).toHaveTextContent('Untertitel · 1200 × 80');
    expect(boxes[1]!.querySelector('.sel-label')).toHaveTextContent('500 × 240');
    expect(boxes[0]!.style.left).toBe(`${(160 / 1920) * 100}%`);
    // Chip-Hover (hoveredRefKey) → Rahmen verknüpft
    act(() => studio.store.getState().setHoveredRef(boxes[0]!.dataset.refKey!));
    expect(boxes[0]).toHaveClass('is-linked');
    // Hover über einer referenzierten Stelle im Monitor → Chip-Verknüpfung
    act(() => studio.store.getState().setHoveredRef(null));
    fireEvent.mouseMove(overlay, { clientX: 1500, clientY: 900 });
    expect(studio.store.getState().hoveredRefKey).toBe(boxes[1]!.dataset.refKey);
    fireEvent.mouseLeave(overlay);
    expect(studio.store.getState().hoveredRefKey).toBeNull();
  });

  it('Hover zeigt den gestrichelten Rahmen nur im Element-Modus; Region-Modus: Klick tut nichts', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    const { container } = renderStudio(<Monitor />, studio);
    const overlay = screen.getByRole('application', { name: /Folie 1 von 4/ });
    fireEvent.mouseMove(overlay, { clientX: 400, clientY: 420 });
    expect(container.querySelector('.sel-box.is-hover')).not.toBeNull();
    const modes = screen.getByRole('group', { name: 'Zeigen' });
    expect(within(modes).getByRole('button', { name: 'Element' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(modes).getByRole('button', { name: 'Region' }));
    fireEvent.mouseMove(overlay, { clientX: 400, clientY: 420 });
    expect(container.querySelector('.sel-box.is-hover')).toBeNull();
    pointerClick(overlay, 400, 420);
    expect(refs(studio)).toEqual([]);
    pointerDrag(overlay, [100, 100], [300, 250]);
    expect(refs(studio)).toEqual([{ kind: 'region', doc: 'deck', slideId: 's_title', rect: { x: 100, y: 100, width: 200, height: 150 } }]);
  });

  it('Toast „Referenz 1 hinzugefügt“ mit Rückgängig; der Zeige-Hinweis erscheint nur bis zum ersten Zeigen', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    renderStudio(<Monitor />, studio);
    const bar = screen.getByRole('toolbar', { name: 'Monitor' });
    expect(within(bar).getByText('Klick: Element · Ziehen: Region')).toBeInTheDocument();
    pointerClick(screen.getByRole('application', { name: /Folie 1 von 4/ }), 400, 420);
    expect(studio.store.getState().coach.monitorPointing).toBe('done');
    expect(within(bar).queryByText('Klick: Element · Ziehen: Region')).toBeNull();
    const toast = studio.store.getState().toasts.at(-1)!;
    expect(toast.text).toBe('Referenz 1 hinzugefügt');
    expect(toast.action?.label).toBe('Rückgängig');
    act(() => toast.action!.run());
    expect(refs(studio)).toEqual([]);
    // Duplikat: Derselbe Klick fügt nichts ein und meldet keinen neuen Toast
    pointerClick(screen.getByRole('application', { name: /Folie 1 von 4/ }), 400, 420);
    const count = studio.store.getState().toasts.length;
    pointerClick(screen.getByRole('application', { name: /Folie 1 von 4/ }), 400, 420);
    expect(refs(studio)).toHaveLength(1);
    expect(studio.store.getState().toasts).toHaveLength(count);
  });

  it('Präsentation: Tastatur wählt Elemente reihum, Enter referenziert; Notizen-Schalter', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    renderStudio(<Monitor />, studio);
    const overlay = screen.getByRole('application', { name: /Folie 1 von 4/ });
    overlay.focus();
    fireEvent.keyDown(overlay, { key: 'ArrowRight' });
    fireEvent.keyDown(overlay, { key: 'ArrowRight' });
    fireEvent.keyDown(overlay, { key: 'Enter' });
    expect(refs(studio)).toEqual([{ kind: 'element', doc: 'deck', slideId: 's_title', elementId: 'el_sub', bbox: { x: 160, y: 580, width: 1200, height: 80 } }]);
    await userEvent.click(screen.getByRole('button', { name: /Notizen/ }));
    expect(screen.getByRole('note', { name: 'Notizen' })).toHaveTextContent('Keine Notizen zu dieser Folie.');
  });

  it('Leinwand: Klick → oberste Ebene, Alt+Klick → übergeordnete Gruppe, Ziehen → Region; Zoom und Einpassen', async () => {
    const studio = await setupStudio({ project: DEMO_CANVAS_PATH });
    renderStudio(<Monitor />, studio);
    const overlay = screen.getByRole('application', { name: 'Klick: Element · Ziehen: Region' });
    pointerClick(overlay, 200, 150); // Titel (Teil der Titelgruppe)
    pointerClick(overlay, 200, 150, { altKey: true });
    pointerDrag(overlay, [10, 10], [60, 90]);
    expect(refs(studio)).toEqual([
      { kind: 'element', doc: 'canvas', elementId: 'ly_title', bbox: { x: 80, y: 90, width: 920, height: 160 } },
      { kind: 'element', doc: 'canvas', elementId: 'grp_title', bbox: { x: 80, y: 80, width: 920, height: 260 } },
      { kind: 'region', doc: 'canvas', rect: { x: 10, y: 10, width: 50, height: 80 } },
    ]);
    const bar = screen.getByRole('toolbar', { name: 'Monitor' });
    const fit = within(bar).getByRole('button', { name: 'Einpassen' });
    expect(fit).toBeDisabled();
    await userEvent.click(within(bar).getByRole('button', { name: 'Vergrößern' }));
    expect(fit).toBeEnabled();
    await userEvent.click(fit);
    expect(fit).toBeDisabled();
  });

  it('Web (Browser-Modus): iframe mit Sandbox, Viewport-Segment, Modus-Segment, Picks als Chip mit Toast', async () => {
    const studio = await setupStudio({ project: DEMO_WEB_PATH });
    const pickMode = vi.spyOn(studio.api, 'previewSetPickMode');
    const external = vi.spyOn(studio.api, 'previewOpenExternal');
    renderStudio(<Monitor />, studio);
    const frame = await waitFor(() => {
      const el = document.querySelector('iframe.web-frame');
      if (!el) throw new Error('kein iframe');
      return el;
    });
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame.getAttribute('src')).toMatch(/^data:text\/html.*#\/$/);
    await userEvent.click(screen.getByRole('button', { name: 'Mobil' }));
    expect(studio.store.getState().viewport).toBe('mobile');
    await waitFor(() => expect(document.querySelector('iframe.web-frame')).toHaveAttribute('width', '390'));
    const modes = screen.getByRole('group', { name: 'Zeigen' });
    expect(within(modes).getByRole('button', { name: 'Ansehen' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(modes).getByRole('button', { name: 'Element' }));
    expect(pickMode).toHaveBeenLastCalledWith(studio.store.getState().projectId, true);
    await userEvent.click(screen.getByRole('button', { name: 'Im Browser öffnen' }));
    expect(external).toHaveBeenCalled();
    // Pick aus der Vorschau (wie vom Main-Prozess gemeldet)
    act(() =>
      studio.api.debug.emit({
        type: 'preview_pick',
        projectId: studio.store.getState().projectId!,
        ref: { kind: 'element', doc: 'site', page: '/', selector: 'main h1', source: { file: 'src/pages/Home.tsx', line: 7, column: 7 }, bbox: { x: 0, y: 0, width: 400, height: 80 } },
        label: 'Guten Morgen',
      }),
    );
    expect(refs(studio)).toEqual([
      { kind: 'element', doc: 'site', page: '/', selector: 'main h1', source: { file: 'src/pages/Home.tsx', line: 7, column: 7 }, bbox: { x: 0, y: 0, width: 400, height: 80 } },
    ]);
    expect(studio.store.getState().toasts.at(-1)?.text).toBe('Referenz 1 hinzugefügt');
    expect(studio.store.getState().coach.monitorPointing).toBe('done');
    // Die Auswahl steht mit Nummer über der Vorschau
    expect(document.querySelector('.sel-box.is-ref .sel-label')).toHaveTextContent('main h1 · 400 × 80');
    await userEvent.click(within(modes).getByRole('button', { name: 'Ansehen' }));
    expect(pickMode).toHaveBeenLastCalledWith(studio.store.getState().projectId, false);
  });

  it('Web: Region ziehen (Browser-Modus) und Neu laden', async () => {
    const studio = await setupStudio({ project: DEMO_WEB_PATH });
    renderStudio(<Monitor />, studio);
    await waitFor(() => expect(document.querySelector('iframe.web-frame')).not.toBeNull());
    await userEvent.click(within(screen.getByRole('group', { name: 'Zeigen' })).getByRole('button', { name: 'Region' }));
    const overlay = screen.getByRole('application', { name: 'Ziehen: Region' });
    pointerDrag(overlay, [20, 30], [220, 130]);
    expect(refs(studio)).toEqual([{ kind: 'region', doc: 'site', page: '/', rect: { x: 20, y: 30, width: 200, height: 100 } }]);
    const before = document.querySelector('iframe.web-frame');
    await userEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
    expect(document.querySelector('iframe.web-frame')).not.toBe(before);
  });

  it('Web (Electron): meldet die Position der nativen Vorschau und blendet sie bei Dialogen aus', async () => {
    const fake = await setupStudio({ project: DEMO_WEB_PATH });
    // „Electron“-API: kein FakeStudioApi-Exemplar → apiMode = electron
    const calls: Array<[string, unknown]> = [];
    const electronApi: StudioApi = {
      ...Object.fromEntries(Object.getOwnPropertyNames(Object.getPrototypeOf(fake.api)).filter((k) => k !== 'constructor').map((k) => [k, (fake.api as unknown as Record<string, (...a: unknown[]) => unknown>)[k]!.bind(fake.api)])),
      previewSetBounds: async (_id: string, bounds: unknown) => {
        calls.push(['bounds', bounds]);
      },
    } as unknown as StudioApi;
    const store = createStudioStore(electronApi);
    await store.getState().openProject(DEMO_WEB_PATH);
    const view = renderStudio(<Monitor />, { api: electronApi as never, store });
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('[data-preview-host]')).not.toBeNull();
    // Region ziehen braucht eine DOM-Ebene über der Vorschau: in Electron nicht angeboten
    expect(within(screen.getByRole('group', { name: 'Zeigen' })).queryByRole('button', { name: 'Region' })).toBeNull();
    // jsdom misst 0×0 → ausgeblendet (null); bei offenem Overlay ebenfalls null
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    act(() => store.getState().pushOverlay());
    expect(calls.at(-1)).toEqual(['bounds', null]);
    view.unmount();
    expect(calls.at(-1)).toEqual(['bounds', null]);
  });
});

describe('Bühne für Dokumente', () => {
  it('Folienstreifen: Index-Spalte, Klick wählt die Folie und fügt eine Folien-Referenz mit Nummer ein', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    const { container } = renderStudio(<Stage />, studio);
    expect(container.querySelector('.doc-index .doc-readout-value')).toHaveTextContent('1/4');
    expect(container.querySelector('.doc-index-title')).toHaveTextContent('Titel');
    const thumb = screen.getByRole('button', { name: /Folie 3: Produkt/ });
    await userEvent.click(thumb);
    expect(studio.store.getState().selectedSlideId).toBe('s_product');
    expect(refs(studio)).toEqual([{ kind: 'slide', slideId: 's_product' }]);
    expect(thumb).toHaveClass('is-ref', 'is-selected');
    expect(thumb.querySelector('.doc-ref-n')).toHaveTextContent('1');
    expect(container.querySelector('.doc-index .doc-readout-value')).toHaveTextContent('3/4');
    // Zweiter Klick: kein Duplikat, der Chip blitzt
    await userEvent.click(thumb);
    expect(refs(studio)).toHaveLength(1);
    expect(studio.store.getState().flash?.key).toBe('slide:s_product');
    // Hover auf der Karte verknüpft mit dem Chip
    fireEvent.mouseEnter(thumb);
    expect(studio.store.getState().hoveredRefKey).toBe('slide:s_product');
  });

  it('Folienstreifen: Abschnittsköpfe nur mit Abschnittsfolien; ausgeblendete Folien gedämpft und gezählt', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    const { container } = renderStudio(<Stage />, studio);
    expect(container.querySelector('.slide-group-label')).toBeNull();
    const deck = studio.store.getState().document;
    if (deck?.kind !== 'deck') throw new Error('Deck erwartet');
    act(() =>
      studio.store.setState({
        document: { ...deck, slides: deck.slides.map((s, i) => (i === 1 ? { ...s, layout: 'section', title: 'Markt' } : i === 2 ? { ...s, hidden: true } : s)) },
      }),
    );
    expect([...container.querySelectorAll('.slide-group-label')].map((l) => l.textContent)).toEqual(['', 'Markt']);
    expect(container.querySelectorAll('.slide-group')[1]!.querySelectorAll('.slide-thumb')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Folie 3: Produkt/ })).toHaveClass('is-hidden');
    expect(container.querySelector('.doc-index')).toHaveTextContent('1 ausgeblendet');
  });

  it('Leerzustand der Bühne im Leerstil (Icon, Titel)', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    const deck = studio.store.getState().document;
    if (deck?.kind !== 'deck') throw new Error('Deck erwartet');
    studio.store.setState({ document: { ...deck, slides: [] } });
    renderStudio(<Stage />, studio);
    const empty = screen.getByRole('status');
    expect(empty).toHaveClass('stage-empty');
    expect(empty.querySelector('.stage-empty-title')).toHaveTextContent('Noch keine Folien.');
  });

  it('Ebenenliste: Index-Spalte, Klick fügt die Ebene als Element-Referenz mit Badge ein', async () => {
    const studio = await setupStudio({ project: DEMO_CANVAS_PATH });
    const { container } = renderStudio(<Stage />, studio);
    expect(container.querySelector('.doc-index .doc-readout')).toHaveTextContent('7Ebenen');
    expect(container.querySelector('.doc-index-meta')).toHaveTextContent('1080 × 1350');
    const tree = screen.getByRole('tree', { name: 'Ebenen' });
    const row = within(tree).getByRole('treeitem', { name: /Ebene Sticker/ });
    await userEvent.click(row);
    expect(refs(studio)).toEqual([{ kind: 'element', doc: 'canvas', elementId: 'ly_sticker', bbox: { x: 760, y: 300, width: 220, height: 220 } }]);
    expect(row.querySelector('.doc-ref-n')).toHaveTextContent('1');
  });

  it('Seitenkarten: Klick zeigt die Seite im Monitor und fügt eine Seiten-Referenz ein', async () => {
    const studio = await setupStudio({ project: DEMO_WEB_PATH });
    const { container } = renderStudio(<Stage />, studio);
    expect(container.querySelector('.doc-index .doc-readout')).toHaveTextContent('3Seiten');
    expect(container.querySelector('.page-row')).toBeNull();
    const card = screen.getByRole('button', { name: /Speisekarte/ });
    expect(card).toHaveClass('page-card');
    await userEvent.click(card);
    expect(studio.store.getState().selectedPageId).toBe('menu');
    expect(refs(studio)).toEqual([{ kind: 'element', doc: 'site', page: '/karte', selector: 'body', source: { file: 'src/pages/Menu.tsx', line: 1 } }]);
    expect(card).toHaveAttribute('aria-current', 'page');
    expect(card.querySelector('.doc-ref-n')).toHaveTextContent('1');
    expect(screen.queryByRole('button', { name: 'Seite referenzieren' })).toBeNull();
  });
});
