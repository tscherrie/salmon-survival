import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from '@studio/core';
import { AssetBrowser } from '../src/renderer/components/assets/AssetBrowser.tsx';
import { DirectorPanel } from '../src/renderer/components/director/DirectorPanel.tsx';
import { COACH_KEY } from '../src/renderer/lib/coach.ts';
import { selectUserMarkers } from '../src/renderer/state/selectors.ts';
import { FLASH_MS } from '../src/renderer/state/store.ts';
import { DEMO_DECK_PATH, DEMO_VIDEO_ID, DEMO_VIDEO_PATH, DEMO_WEB_PATH, renderStudio, setupStudio } from './helpers.tsx';

/** Store-Aktionen der Referenz-Infrastruktur (DESIGN.md §8.7, §9.3, §9.4). */

const refs = (studio: Awaited<ReturnType<typeof setupStudio>>): Ref[] => studio.store.getState().composer.flatMap((s) => (s.type === 'ref' ? [s.ref] : []));

afterEach(() => {
  vi.useRealTimers();
  try {
    localStorage.removeItem(COACH_KEY);
  } catch {
    // ignorieren
  }
});

describe('Marker-Aktionen', () => {
  it('addMarkerAt: Zeit-Chip am Caret, kleinste freie Nummer, Abspielkopf bleibt stehen, Ansage', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const s = () => studio.store.getState();
    act(() => s().requestSeek(100));
    act(() => s().insertSegments([{ type: 'text', text: 'Von  bis' }]));
    act(() => s().setCaret(4));
    act(() => s().addMarkerAt(372.4));
    expect(s().composer).toEqual([{ type: 'text', text: 'Von ' }, { type: 'ref', ref: { kind: 'time', frame: 372 } }, { type: 'text', text: ' bis' }]);
    expect(s().playhead).toBe(100);
    expect(s().lastMarkerKey).toBe('time:372');
    expect(s().announcement).toBe('Marker 1 bei 00:12:12 gesetzt');
    // Begrenzt auf 0 … Dauer
    act(() => s().addMarkerAt(-50));
    act(() => s().addMarkerAt(99_999));
    expect(refs(studio)).toEqual([
      { kind: 'time', frame: 372 },
      { kind: 'time', frame: 0 },
      { kind: 'time', frame: 1800 },
    ]);
    expect(selectUserMarkers(s()).map((m) => [m.frame, m.n])).toEqual([
      [0, 2],
      [372, 1],
      [1800, 3],
    ]);
    // Duplikat am selben Frame: nichts einfügen, Chip blitzt, Ansage
    act(() => s().addMarkerAt(372));
    expect(refs(studio)).toHaveLength(3);
    expect(s().announcement).toBe('Marker 1 ist bereits gesetzt');
    expect(s().flash?.key).toBe('time:372');
  });

  it('addMarkerAt schließt den Marker-Hinweis dauerhaft; resetCoach öffnet ihn wieder', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const s = () => studio.store.getState();
    expect(s().coach.markerStrip).toBe('open');
    act(() => s().addMarkerAt(30));
    expect(s().coach.markerStrip).toBe('done');
    expect(JSON.parse(localStorage.getItem(COACH_KEY)!)).toMatchObject({ markerStrip: 'done' });
    // Ein neuer Store (Neustart) liest den gespeicherten Zustand
    const again = await setupStudio({ project: DEMO_VIDEO_PATH });
    expect(again.store.getState().coach.markerStrip).toBe('done');
    act(() => s().resetCoach());
    expect(s().coach).toEqual({ markerStrip: 'open', monitorPointing: 'open', altReference: 'open' });
    expect(JSON.parse(localStorage.getItem(COACH_KEY)!)).toMatchObject({ markerStrip: 'open' });
    act(() => s().completeCoach('altReference'));
    expect(s().coach.altReference).toBe('done');
  });

  it('addMarkerAt wirkt nur bei Timeline-Kategorien', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    act(() => studio.store.getState().addMarkerAt(30));
    expect(studio.store.getState().composer).toEqual([]);
  });

  it('removeRefByKey entfernt alle Chips mit dem Schlüssel und rückt den Caret nach', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const s = () => studio.store.getState();
    act(() =>
      s().setComposer(
        [
          { type: 'ref', ref: { kind: 'time', frame: 60 } },
          { type: 'text', text: ' bis ' },
          { type: 'ref', ref: { kind: 'time', frame: 90 } },
          { type: 'text', text: ' und ' },
          { type: 'ref', ref: { kind: 'time', frame: 60 } },
          { type: 'text', text: '!' },
        ],
        12,
      ),
    );
    expect(s().refNumbers).toEqual({ 'time:60': 1, 'time:90': 2 });
    act(() => s().setHoveredRef('time:60'));
    act(() => s().removeRefByKey('time:60'));
    expect(s().composer).toEqual([{ type: 'text', text: ' bis ' }, { type: 'ref', ref: { kind: 'time', frame: 90 } }, { type: 'text', text: ' und !' }]);
    expect(s().caret).toBe(11);
    expect(s().refNumbers).toEqual({ 'time:90': 2 });
    expect(s().hoveredRefKey).toBeNull();
    expect(s().announcement).toBe('Marker 1 entfernt');
    // Unbekannter Schlüssel: keine Änderung
    const revision = s().composerRevision;
    act(() => s().removeRefByKey('time:1234'));
    expect(s().composerRevision).toBe(revision);
  });

  it('jumpToMarker springt zum vorigen bzw. nächsten Marker; am Ende nur die Ansage', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const s = () => studio.store.getState();
    act(() => s().addMarkerAt(600));
    act(() => s().addMarkerAt(300));
    act(() => s().requestSeek(400));
    act(() => s().jumpToMarker(1));
    expect(s().playhead).toBe(600);
    expect(s().flash?.key).toBe('time:600');
    expect(s().announcement).toBe('Angezeigt: Marker 1 bei 00:20:00');
    act(() => s().jumpToMarker(1));
    expect(s().playhead).toBe(600);
    expect(s().announcement).toBe('Kein weiterer Marker');
    act(() => s().jumpToMarker(-1));
    expect(s().playhead).toBe(300);
    act(() => s().jumpToMarker(-1));
    expect(s().playhead).toBe(300);
    expect(s().announcement).toBe('Kein weiterer Marker');
  });
});

describe('Verknüpfung und Zeigen (§9.4)', () => {
  it('revealRef: Zeit, Dokument-Marker und Clip setzen den Abspielkopf; der Clip aktiviert seine Spur', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const s = () => studio.store.getState();
    act(() => s().revealRef({ kind: 'time', frame: 450 }));
    expect(s().playhead).toBe(450);
    expect(s().announcement).toBe('Angezeigt: 00:15:00');
    act(() => s().revealRef({ kind: 'marker', markerId: 'sec_3' }));
    expect(s().playhead).toBe(720);
    act(() => s().revealRef({ kind: 'clip', clipId: 'c_sb03', trackId: 'V1' }));
    expect(s().playhead).toBe(480);
    expect(s().activeTrackId).toBe('V1');
    expect(s().flash?.key).toBe('clip:c_sb03');
    expect(s().announcement).toBe('Angezeigt: Strophe: Tunnel');
  });

  it('revealRef: Folie und Element wählen die Folie, Seite wählt die Seite', async () => {
    const deck = await setupStudio({ project: DEMO_DECK_PATH });
    act(() => deck.store.getState().revealRef({ kind: 'slide', slideId: 's_product' }));
    expect(deck.store.getState().selectedSlideId).toBe('s_product');
    act(() => deck.store.getState().revealRef({ kind: 'element', doc: 'deck', slideId: 's_status', elementId: 'el_chart' }));
    expect(deck.store.getState().selectedSlideId).toBe('s_status');
    expect(deck.store.getState().announcement).toBe('Angezeigt: Folie 2 · Umsatz je Quartal');
    const web = await setupStudio({ project: DEMO_WEB_PATH });
    act(() => web.store.getState().revealRef({ kind: 'element', doc: 'site', page: '/karte', selector: 'body' }));
    expect(web.store.getState().selectedPageId).toBe('menu');
    expect(web.store.getState().flash?.key).toBe('page:/karte');
  });

  it('revealRef auf ein Asset: Die Karte blitzt und scrollt ins Bild; Hover über einen Asset-Chip verknüpft die Karte', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const card = document.querySelector('[data-asset-id="ast_char_mira"]')!;
    expect(card).toHaveAttribute('data-ref-key', 'asset:ast_char_mira');
    act(() => studio.store.getState().revealRef({ kind: 'asset', assetId: 'ast_char_mira' }));
    expect(card).toHaveClass('is-flash');
    expect(scroll).toHaveBeenCalled();
    act(() => studio.store.getState().setHoveredRef('asset:ast_char_mira'));
    expect(card).toHaveClass('is-linked');
  });

  it('flashRef blitzt 600 ms; ein neuer Blitz beginnt von vorn', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const s = () => studio.store.getState();
    act(() => s().flashRef('time:10'));
    const first = s().flash!;
    expect(first.key).toBe('time:10');
    act(() => vi.advanceTimersByTime(FLASH_MS - 100));
    act(() => s().flashRef('time:10'));
    expect(s().flash!.nonce).toBeGreaterThan(first.nonce);
    // Der erste Zeitgeber löscht den neueren Blitz nicht
    act(() => vi.advanceTimersByTime(150));
    expect(s().flash).not.toBeNull();
    act(() => vi.advanceTimersByTime(FLASH_MS));
    expect(s().flash).toBeNull();
  });

  it('statische Chips im Verlauf: ohne Emoji, Hover verknüpft, Klick zeigt die Stelle', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    vi.spyOn(studio.api, 'sendMessage').mockResolvedValue();
    renderStudio(<DirectorPanel />, studio);
    act(() =>
      studio.api.debug.emit({
        type: 'message',
        projectId: DEMO_VIDEO_ID,
        message: {
          id: 'm_user',
          role: 'user',
          text: '',
          createdAt: new Date().toISOString(),
          segments: [
            { type: 'text', text: 'Bei ' },
            { type: 'ref', ref: { kind: 'time', frame: 372 } },
            { type: 'text', text: ' wie ' },
            { type: 'ref', ref: { kind: 'clip', clipId: 'c_sb03', trackId: 'V1' } },
          ],
        },
      }),
    );
    const chip = screen.getByRole('button', { name: '00:12:12' });
    expect(chip).toHaveClass('chip', 'chip-static', 'chip-time');
    expect(chip).toHaveAttribute('data-ref-key', 'time:372');
    expect(chip.querySelector('.n')).toBeNull();
    expect(screen.getByRole('button', { name: 'Strophe: Tunnel' })).toHaveAttribute('title', 'Strophe: Tunnel');
    fireEvent.mouseEnter(chip);
    expect(studio.store.getState().hoveredRefKey).toBe('time:372');
    expect(chip).toHaveClass('is-linked');
    fireEvent.mouseLeave(chip);
    expect(studio.store.getState().hoveredRefKey).toBeNull();
    fireEvent.click(chip);
    expect(studio.store.getState().playhead).toBe(372);
    expect(chip).toHaveClass('is-flash');
  });
});

describe('writeComposer als einziger Schreibweg (§8.7)', () => {
  it('Picks aus der Web-Vorschau laufen über insertRef: nummeriert und ohne Duplikat', async () => {
    const studio = await setupStudio({ project: DEMO_WEB_PATH });
    const pick = { kind: 'element' as const, doc: 'site' as const, page: '/', selector: 'main h1', elementId: 'hero' };
    act(() => studio.api.debug.emit({ type: 'preview_pick', projectId: studio.store.getState().projectId!, ref: pick, label: 'Guten Morgen' }));
    expect(refs(studio)).toEqual([pick]);
    expect(studio.store.getState().announcement).toBe('Referenz hinzugefügt: Guten Morgen');
    expect(Object.values(studio.store.getState().refNumbers)).toEqual([1]);
    act(() => studio.api.debug.emit({ type: 'preview_pick', projectId: studio.store.getState().projectId!, ref: { ...pick, bbox: { x: 0, y: 0, width: 10, height: 10 } } }));
    expect(refs(studio)).toHaveLength(1);
  });

  it('jede Änderung erhöht composerRevision; Snapshot neu laden behält Chips und Nummern; Projekt schließen setzt zurück', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const s = () => studio.store.getState();
    const start = s().composerRevision;
    act(() => s().setComposer([{ type: 'text', text: 'a' }], 1));
    expect(s().composerRevision).toBe(start + 1);
    act(() => s().addMarkerAt(60));
    act(() => s().addMarkerAt(30));
    act(() => s().removeComposerSegment(1, 1));
    expect(s().refNumbers).toEqual({ 'time:30': 2 });
    await act(() => s().refreshSnapshot());
    expect(refs(studio)).toEqual([{ kind: 'time', frame: 30 }]);
    expect(s().refNumbers).toEqual({ 'time:30': 2 });
    act(() => s().closeProject());
    expect(s().composer).toEqual([]);
    expect(s().refNumbers).toEqual({});
    expect(s().composerRevision).toBeGreaterThan(start);
  });
});
