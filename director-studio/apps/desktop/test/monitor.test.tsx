import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StudioApi } from '@studio/core';
import { Monitor } from '../src/renderer/components/monitor/Monitor.tsx';
import { safeAreasFor } from '../src/renderer/components/monitor/VideoMonitor.tsx';
import { Stage } from '../src/renderer/components/stage/Stage.tsx';
import { createStudioStore } from '../src/renderer/state/store.ts';
import { DEMO_CANVAS_PATH, DEMO_DECK_PATH, DEMO_VIDEO_PATH, DEMO_WEB_PATH, renderStudio, setupStudio } from './helpers.tsx';

function refs(studio: Awaited<ReturnType<typeof setupStudio>>) {
  return studio.store.getState().composer.flatMap((s) => (s.type === 'ref' ? [s.ref] : []));
}

/** Klick bzw. Ziehen auf der Zeigerebene (jsdom: Koordinaten = Dokument-Pixel). */
function pointerClick(el: Element, x: number, y: number, init: MouseEventInit = {}) {
  fireEvent.mouseDown(el, { clientX: x, clientY: y, button: 0, ...init });
  fireEvent.mouseUp(window, { clientX: x, clientY: y, ...init });
}

describe('Monitor', () => {
  it('Video: Player, Formatumschalter und Safe Areas', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Monitor />, studio);
    expect(await screen.findByTestId('remotion-player')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Format' });
    expect(within(group).getByRole('button', { name: '16:9' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(group).getByRole('button', { name: '9:16' }));
    expect(studio.store.getState().formatId).toBe('9:16');
    await userEvent.click(screen.getByRole('button', { name: /Safe Areas/ }));
    expect(document.querySelectorAll('.safe-area').length).toBe(2);
    expect(safeAreasFor({ id: '9:16', width: 1080, height: 1920 })[0]!.kind).toBe('ui');
  });

  it('Präsentation: Klick auf ein Element → Element-Referenz; leere Stelle → Folie; Ziehen → Region', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    renderStudio(<Monitor />, studio);
    const overlay = screen.getByRole('application', { name: /Folie 1 von 4/ });
    // Titel-Element liegt bei x 160–1560, y 360–560
    pointerClick(overlay, 400, 420);
    pointerClick(overlay, 1800, 1000);
    fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 250 });
    fireEvent.mouseUp(window, { clientX: 300, clientY: 250 });
    expect(refs(studio)).toEqual([
      { kind: 'element', doc: 'deck', slideId: 's_title', elementId: 'el_title', bbox: { x: 160, y: 360, width: 1400, height: 200 } },
      { kind: 'slide', slideId: 's_title' },
      { kind: 'region', doc: 'deck', slideId: 's_title', rect: { x: 100, y: 100, width: 200, height: 150 } },
    ]);
    // Nächste Folie
    await userEvent.click(screen.getByRole('button', { name: 'Nächste Folie' }));
    expect(screen.getByText('Folie 2 von 4')).toBeInTheDocument();
  });

  it('Präsentation: Tastatur wählt Elemente reihum, Enter referenziert', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    renderStudio(<Monitor />, studio);
    const overlay = screen.getByRole('application', { name: /Folie 1 von 4/ });
    overlay.focus();
    fireEvent.keyDown(overlay, { key: 'ArrowRight' });
    fireEvent.keyDown(overlay, { key: 'ArrowRight' });
    fireEvent.keyDown(overlay, { key: 'Enter' });
    expect(refs(studio)).toEqual([{ kind: 'element', doc: 'deck', slideId: 's_title', elementId: 'el_sub', bbox: { x: 160, y: 580, width: 1200, height: 80 } }]);
  });

  it('Leinwand: Klick → oberste Ebene, Alt+Klick → übergeordnete Gruppe, Ziehen → Region', async () => {
    const studio = await setupStudio({ project: DEMO_CANVAS_PATH });
    renderStudio(<Monitor />, studio);
    const overlay = screen.getByRole('application', { name: 'Klick: Element · Ziehen: Region' });
    pointerClick(overlay, 200, 150); // Titel (Teil der Titelgruppe)
    pointerClick(overlay, 200, 150, { altKey: true });
    fireEvent.mouseDown(overlay, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(window, { clientX: 60, clientY: 90 });
    fireEvent.mouseUp(window, { clientX: 60, clientY: 90 });
    expect(refs(studio)).toEqual([
      { kind: 'element', doc: 'canvas', elementId: 'ly_title', bbox: { x: 80, y: 90, width: 920, height: 160 } },
      { kind: 'element', doc: 'canvas', elementId: 'grp_title', bbox: { x: 80, y: 80, width: 920, height: 260 } },
      { kind: 'region', doc: 'canvas', rect: { x: 10, y: 10, width: 50, height: 80 } },
    ]);
  });

  it('Web (Browser-Modus): iframe mit Sandbox, Viewport-Umschalter, Picks als Chip', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: /Element wählen/ }));
    expect(pickMode).toHaveBeenLastCalledWith(studio.store.getState().projectId, true);
    await userEvent.click(screen.getByRole('button', { name: /Im Browser öffnen/ }));
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
    // jsdom misst 0×0 → ausgeblendet (null); bei offenem Overlay ebenfalls null
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    act(() => store.getState().pushOverlay());
    expect(calls.at(-1)).toEqual(['bounds', null]);
    view.unmount();
    expect(calls.at(-1)).toEqual(['bounds', null]);
  });
});

describe('Bühne für Dokumente', () => {
  it('Folienstreifen: Klick wählt die Folie und fügt eine Folien-Referenz ein', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    renderStudio(<Stage />, studio);
    await userEvent.click(screen.getByRole('button', { name: /Folie 3: Produkt/ }));
    expect(studio.store.getState().selectedSlideId).toBe('s_product');
    expect(refs(studio)).toEqual([{ kind: 'slide', slideId: 's_product' }]);
  });

  it('Ebenenliste: Klick fügt die Ebene als Element-Referenz ein', async () => {
    const studio = await setupStudio({ project: DEMO_CANVAS_PATH });
    renderStudio(<Stage />, studio);
    const tree = screen.getByRole('tree', { name: 'Ebenen' });
    await userEvent.click(within(tree).getByRole('treeitem', { name: /Ebene Sticker/ }));
    expect(refs(studio)).toEqual([{ kind: 'element', doc: 'canvas', elementId: 'ly_sticker', bbox: { x: 760, y: 300, width: 220, height: 220 } }]);
  });

  it('Seitenkarte: Klick navigiert, „Seite referenzieren“ fügt eine Seiten-Referenz ein', async () => {
    const studio = await setupStudio({ project: DEMO_WEB_PATH });
    renderStudio(<Stage />, studio);
    await userEvent.click(screen.getByRole('button', { name: /Speisekarte/ }));
    expect(studio.store.getState().selectedPageId).toBe('menu');
    const rows = screen.getAllByRole('listitem');
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Seite referenzieren' }));
    expect(refs(studio)).toEqual([{ kind: 'element', doc: 'site', page: '/karte', selector: 'body', source: { file: 'src/pages/Menu.tsx', line: 1 } }]);
  });
});
