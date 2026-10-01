import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { serializeComposer, type ComposerSegment } from '@studio/core';
import { Composer } from '../src/renderer/components/composer/Composer.tsx';
import { parseDom, positionOf, renderSegments, setCaretPosition } from '../src/renderer/components/composer/editorDom.ts';
import { insertSegmentsAt, trimSegments } from '../src/renderer/lib/composerOps.ts';
import { DEMO_CANVAS_PATH, DEMO_DECK_PATH, DEMO_VIDEO_ID, DEMO_VIDEO_PATH, DEMO_WEB_PATH, renderStudio, setupStudio } from './helpers.tsx';

const TIME_REF = { kind: 'time' as const, frame: 372 };
const ASSET_REF = { kind: 'asset' as const, assetId: 'ast_char_mira' };

/** Keine Emoji in Chips (DESIGN.md §17 P1.5): keine Codepoints ab U+1F000 und kein ⏱. */
function expectNoEmoji(text: string | null) {
  expect([...(text ?? '')].filter((c) => c.codePointAt(0)! >= 0x1f000 || c === '⏱')).toEqual([]);
}

describe('Composer', () => {
  it('sendet die Segmente (Text + Chips) an api.sendMessage und leert sich', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const send = vi.spyOn(studio.api, 'sendMessage');
    const segments: ComposerSegment[] = [
      { type: 'text', text: 'Mach ' },
      { type: 'ref', ref: { kind: 'range', from: 372, to: 540, trackId: 'V1' } },
      { type: 'text', text: ' dunkler, nimm ' },
      { type: 'ref', ref: ASSET_REF },
      { type: 'text', text: '.  ' },
    ];
    act(() => studio.store.getState().setComposer(segments, 0));
    renderStudio(<Composer />, studio);
    const editor = screen.getByTestId('composer-editor');
    const chips = editor.querySelectorAll<HTMLElement>('.chip');
    expect(chips).toHaveLength(2);
    // Spanne (alt): Nummer und MM:SS:FF–MM:SS:FF; Asset: ohne Nummer
    expect(chips[0]!.querySelector('.n')).toHaveTextContent('1');
    expect(chips[0]!.querySelector('.chip-label')).toHaveTextContent('00:12:12–00:18:00 · Video');
    expect(chips[1]!.querySelector('.n')).toBeNull();
    expect(chips[1]!.querySelector('.chip-label')).toHaveTextContent('Mira – Charakterblatt v3');
    expectNoEmoji(editor.textContent);
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(send).toHaveBeenCalledTimes(1);
    const [projectId, message] = send.mock.calls[0]!;
    expect(projectId).toBe(DEMO_VIDEO_ID);
    expect(message.segments).toEqual([
      { type: 'text', text: 'Mach ' },
      { type: 'ref', ref: { kind: 'range', from: 372, to: 540, trackId: 'V1' } },
      { type: 'text', text: ' dunkler, nimm ' },
      { type: 'ref', ref: ASSET_REF },
      { type: 'text', text: '.' },
    ]);
    expect(serializeComposer(message).text).toBe(
      'Mach <ref id="r1" type="range" from="00:12.400" to="00:18.000" fromFrame="372" toFrame="540" track="V1"/> dunkler, nimm <ref id="r2" type="asset" asset="ast_char_mira"/>.',
    );
    expect(studio.store.getState().composer).toEqual([]);
    // Senden setzt die Nummern zurück (DESIGN.md §9.3)
    expect(studio.store.getState().refNumbers).toEqual({});
    expect(editor.querySelectorAll('.chip')).toHaveLength(0);
  });

  it('Senden ist bei leerem Composer deaktiviert; Strg+Enter sendet', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const send = vi.spyOn(studio.api, 'sendMessage');
    renderStudio(<Composer />, studio);
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
    act(() => studio.store.getState().insertRef(TIME_REF));
    expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled();
    fireEvent.keyDown(screen.getByTestId('composer-editor'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![1].segments).toEqual([{ type: 'ref', ref: TIME_REF }]);
  });

  it('Tippen aktualisiert die Segmente; Chips werden an der Cursorposition eingefügt', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Composer />, studio);
    const editor = screen.getByTestId('composer-editor');
    const user = userEvent.setup();
    await user.click(editor);
    await user.keyboard('Mach hier dunkler');
    expect(studio.store.getState().composer).toEqual([{ type: 'text', text: 'Mach hier dunkler' }]);
    // Cursor hinter „Mach hier“ setzen und einen Chip einfügen (wie ein Bühnenklick)
    act(() => studio.store.getState().setCaret(9));
    act(() => studio.store.getState().insertRef(TIME_REF));
    expect(studio.store.getState().composer).toEqual([
      { type: 'text', text: 'Mach hier' },
      { type: 'ref', ref: TIME_REF },
      { type: 'text', text: ' dunkler' },
    ]);
    expect(studio.store.getState().caret).toBe(10);
    expect(editor.querySelectorAll('.chip')).toHaveLength(1);
  });

  it('entfernt Chips per ×-Knopf und per Rücktaste über removeComposerSegment, ohne direktes setState', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    act(() =>
      studio.store.getState().setComposer([
        { type: 'text', text: 'A ' },
        { type: 'ref', ref: TIME_REF },
        { type: 'text', text: ' B ' },
        { type: 'ref', ref: ASSET_REF },
      ]),
    );
    renderStudio(<Composer />, studio);
    const editor = screen.getByTestId('composer-editor');
    const setState = vi.spyOn(studio.store, 'setState');
    const remove = vi.spyOn(studio.store.getState(), 'removeComposerSegment');
    expect(studio.store.getState().refNumbers).toEqual({ 'time:372': 1 });
    // × am ersten Chip: der Zeit-Chip (= Marker) verschwindet samt Nummer
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Referenz entfernen: 00:12:12' }));
    expect(studio.store.getState().composer).toEqual([
      { type: 'text', text: 'A  B ' },
      { type: 'ref', ref: ASSET_REF },
    ]);
    expect(studio.store.getState().refNumbers).toEqual({});
    expect(studio.store.getState().announcement).toBe('Marker 1 entfernt');
    // Rücktaste direkt hinter dem letzten Chip
    editor.focus();
    setCaretPosition(editor, 6);
    fireEvent.keyDown(editor, { key: 'Backspace' });
    expect(studio.store.getState().composer).toEqual([{ type: 'text', text: 'A  B ' }]);
    expect(editor.querySelectorAll('.chip')).toHaveLength(0);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(setState).not.toHaveBeenCalled();
  });

  it('Duplikatschutz: dieselbe Stelle wird nicht zweimal eingefügt, der vorhandene Chip blitzt', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Composer />, studio);
    const editor = screen.getByTestId('composer-editor');
    let inserted = false;
    act(() => void (inserted = studio.store.getState().insertRef(TIME_REF)));
    expect(inserted).toBe(true);
    act(() => void (inserted = studio.store.getState().insertRef({ kind: 'time', frame: 372 })));
    expect(inserted).toBe(false);
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: TIME_REF }]);
    expect(studio.store.getState().announcement).toBe('Marker 1 ist bereits gesetzt');
    expect(studio.store.getState().flash).toEqual({ key: 'time:372', nonce: expect.any(Number) });
    expect(editor.querySelector('.chip')).toHaveClass('is-flash');
    // Auch Assets werden nicht doppelt eingefügt
    act(() => void studio.store.getState().insertRef(ASSET_REF));
    act(() => void studio.store.getState().insertRef(ASSET_REF));
    expect(studio.store.getState().composer.filter((seg) => seg.type === 'ref')).toHaveLength(2);
    expect(studio.store.getState().announcement).toBe('Mira – Charakterblatt v3 ist bereits referenziert');
  });

  it('nummeriert Chips (kleinste freie Nummer, stabil) und trägt Schlüssel und Nummer am Chip', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Composer />, studio);
    const editor = screen.getByTestId('composer-editor');
    const s = () => studio.store.getState();
    act(() => void s().insertRef({ kind: 'time', frame: 372 }));
    act(() => void s().insertRef({ kind: 'time', frame: 600 }));
    act(() => void s().insertRef({ kind: 'clip', clipId: 'c_sb03', trackId: 'V1' }));
    expect(s().refNumbers).toEqual({ 'time:372': 1, 'time:600': 2, 'clip:c_sb03': 3 });
    // Den ersten entfernen: die anderen behalten ihre Nummern, die Lücke wird neu vergeben
    act(() => s().removeComposerSegment(0, 0));
    expect(s().refNumbers).toEqual({ 'time:600': 2, 'clip:c_sb03': 3 });
    act(() => void s().insertRef({ kind: 'time', frame: 900 }));
    expect(s().refNumbers).toEqual({ 'time:600': 2, 'clip:c_sb03': 3, 'time:900': 1 });
    const chips = Array.from(editor.querySelectorAll<HTMLElement>('.chip'));
    expect(chips.map((c) => [c.dataset.refKey, c.dataset.refN, c.querySelector('.n')?.textContent])).toEqual([
      ['time:900', '1', '1'],
      ['time:600', '2', '2'],
      ['clip:c_sb03', '3', '3'],
    ]);
    // Zeit-Chips: Timecode in Mono mit gedämpften Frames, kein Icon; Clips: Filmstreifen-Icon
    expect(chips[1]!.querySelector('.chip-label.tc')).toHaveTextContent('00:20:00');
    expect(chips[1]!.querySelector('.ff')).toHaveTextContent(':00');
    expect(chips[1]!.querySelector('.chip-icon')).toBeNull();
    expect(chips[2]!.querySelector('.chip-icon')).not.toBeNull();
    expect(chips[2]!.title).toBe('Strophe: Tunnel');
    expectNoEmoji(editor.textContent);
  });

  it('verknüpft Chips in beide Richtungen: Hover meldet den Schlüssel, Gegenstücke schalten .is-linked; Klick zeigt die Stelle', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Composer />, studio);
    const editor = screen.getByTestId('composer-editor');
    act(() => void studio.store.getState().insertRef(TIME_REF));
    const chip = () => editor.querySelector<HTMLElement>('.chip')!;
    fireEvent.mouseOver(chip().querySelector('.chip-label')!);
    expect(studio.store.getState().hoveredRefKey).toBe('time:372');
    expect(chip()).toHaveClass('is-linked');
    fireEvent.mouseLeave(editor);
    expect(studio.store.getState().hoveredRefKey).toBeNull();
    expect(chip()).not.toHaveClass('is-linked');
    // Umgekehrt: ein Gegenstück (z. B. der Marker auf der Bühne) setzt den Schlüssel
    act(() => studio.store.getState().setHoveredRef('time:372'));
    expect(chip()).toHaveClass('is-linked');
    act(() => studio.store.getState().setHoveredRef(null));
    // Klick auf den Chip (nicht auf das ×): Abspielkopf springt, der Chip blitzt
    fireEvent.click(chip().querySelector('.chip-label')!);
    expect(studio.store.getState().playhead).toBe(372);
    expect(studio.store.getState().flash?.key).toBe('time:372');
    expect(studio.store.getState().announcement).toBe('Angezeigt: Marker 1 bei 00:12:12');
  });

  it('fügt beim Einfügen nur Klartext ein', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Composer />, studio);
    const editor = screen.getByTestId('composer-editor');
    editor.focus();
    fireEvent.paste(editor, { clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'Zeile 1\r\nZeile 2' : '<b>fett</b>') } });
    expect(studio.store.getState().composer).toEqual([{ type: 'text', text: 'Zeile 1\nZeile 2' }]);
    expect(editor.querySelector('b')).toBeNull();
  });

  it('reiht Nachrichten ein, solange der Director arbeitet, und sendet sie danach; Stopp steht nicht im Composer', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const send = vi.spyOn(studio.api, 'sendMessage').mockResolvedValue();
    renderStudio(<Composer />, studio);
    act(() => studio.api.debug.emit({ type: 'run_state', projectId: DEMO_VIDEO_ID, runId: 'run_x', state: 'running' }));
    // Stopp gehört in den Director-Kopf (DESIGN.md §7.7.1)
    expect(screen.queryByRole('button', { name: /Stopp/ })).toBeNull();
    // Leer heißt der Knopf auch während des Laufs „Senden“ (deaktiviert)
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
    act(() => studio.store.getState().insertSegments([{ type: 'text', text: 'Danach bitte Musik' }]));
    const queueButton = screen.getByRole('button', { name: 'Einreihen' });
    expect(queueButton).not.toHaveClass('primary');
    await userEvent.click(queueButton);
    expect(send).not.toHaveBeenCalled();
    // Warteschlange über dem Text: Kopf, Zeile mit Klartext, „Jetzt senden“ (deaktiviert, solange der Director arbeitet)
    expect(screen.getByText('1 in Warteschlange')).toBeInTheDocument();
    const queue = screen.getByRole('list', { name: 'Warteschlange' });
    expect(within(queue).getByText('Danach bitte Musik')).toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: 'Jetzt senden' })).toBeDisabled();
    act(() => studio.api.debug.emit({ type: 'run_state', projectId: DEMO_VIDEO_ID, runId: 'run_x', state: 'idle' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![1].segments).toEqual([{ type: 'text', text: 'Danach bitte Musik' }]);
    expect(studio.store.getState().queue).toEqual([]);
    expect(screen.queryByText('1 in Warteschlange')).toBeNull();
  });

  it('Warteschlange: × entfernt eine Nachricht, „Jetzt senden“ schickt sie, sobald der Director bereit ist', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const send = vi.spyOn(studio.api, 'sendMessage').mockResolvedValue();
    renderStudio(<Composer />, studio);
    act(() => studio.store.setState({ queue: [{ segments: [{ type: 'text', text: 'Erste' }] }, { segments: [{ type: 'text', text: 'Zweite' }, { type: 'ref', ref: TIME_REF }] }] }));
    expect(screen.getByText('2 in Warteschlange')).toBeInTheDocument();
    const queue = screen.getByRole('list', { name: 'Warteschlange' });
    // Klartext ohne Emoji (displayText)
    expectNoEmoji(queue.textContent);
    await userEvent.click(within(queue).getAllByRole('button', { name: 'Aus der Warteschlange entfernen' })[0]!);
    expect(studio.store.getState().queue).toHaveLength(1);
    await userEvent.click(within(queue).getByRole('button', { name: 'Jetzt senden' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![1].segments[0]).toEqual({ type: 'text', text: 'Zweite' });
  });

  it('Senden-Zustände: Tungsten-Primär nur mit Inhalt, bereitem Director und ohne offene Entscheidung', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Composer />, studio);
    const button = () => screen.getByRole('button', { name: /^(Senden|Einreihen)$/ });
    // Leer: secondary, deaktiviert – kein Tungsten im Composer
    expect(button()).toHaveAccessibleName('Senden');
    expect(button()).toBeDisabled();
    expect(button()).not.toHaveClass('primary');
    // Inhalt, Director bereit: primary
    act(() => studio.store.getState().insertSegments([{ type: 'text', text: 'Los' }]));
    expect(button()).toHaveAccessibleName('Senden');
    expect(button()).toHaveClass('primary');
    // Offene Entscheidung (z. B. Rückfrage): Senden bleibt aktiv, aber secondary – das Dock hat den Primärknopf
    act(() => studio.store.setState({ question: { questionId: 'q1', questions: [], runId: null } }));
    expect(button()).toHaveAccessibleName('Senden');
    expect(button()).toBeEnabled();
    expect(button()).not.toHaveClass('primary');
    act(() => studio.store.setState({ question: null, checkpoints: studio.store.getState().checkpoints.map((c, i) => (i === 0 ? { ...c, status: 'proposed' as const } : c)) }));
    expect(button()).not.toHaveClass('primary');
    // Director arbeitet: „Einreihen“, secondary
    act(() => studio.store.setState({ checkpoints: [], runState: 'running' }));
    expect(button()).toHaveAccessibleName('Einreihen');
    expect(button()).toBeEnabled();
    expect(button()).not.toHaveClass('primary');
  });

  it('Positionsknopf und Alt+Enter setzen einen Marker am Abspielkopf (Chip am Caret), mit Anzahl', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Composer />, studio);
    const editor = screen.getByTestId('composer-editor');
    const user = userEvent.setup();
    await user.click(editor);
    await user.keyboard('Ab hier wärmer');
    act(() => studio.store.getState().requestSeek(372));
    // Alt+Enter im Composer: Marker am Caret (hinter „Ab hier“), kein Zeilenumbruch
    act(() => studio.store.getState().setCaret(7));
    setCaretPosition(editor, 7);
    fireEvent.keyDown(editor, { key: 'Enter', altKey: true });
    expect(studio.store.getState().composer).toEqual([
      { type: 'text', text: 'Ab hier' },
      { type: 'ref', ref: { kind: 'time', frame: 372 } },
      { type: 'text', text: ' wärmer' },
    ]);
    expect(studio.store.getState().playhead).toBe(372);
    // Der Knopf zeigt die Anzahl; ein Klick setzt einen weiteren Marker am Abspielkopf
    const marker = screen.getByRole('button', { name: /^Marker/ });
    expect(marker).toHaveAccessibleName('Marker, 1 gesetzt');
    act(() => studio.store.getState().requestSeek(600));
    await user.click(marker);
    expect(studio.store.getState().refNumbers).toEqual({ 'time:372': 1, 'time:600': 2 });
    expect(marker).toHaveTextContent('Marker2');
    expect(editor.querySelectorAll('.chip-time')).toHaveLength(2);
  });

  it('Positionsknopf je Kategorie: Folie und Seite referenzieren die aktuelle Stelle; Grafik hat keinen', async () => {
    const deck = await setupStudio({ project: DEMO_DECK_PATH });
    const { unmount } = renderStudio(<Composer />, deck);
    const slide = deck.store.getState().document!;
    if (slide.kind !== 'deck') throw new Error('Deck erwartet');
    expect(screen.getByTestId('composer-editor').parentElement).toHaveTextContent('Zeige auf Folien');
    act(() => deck.store.getState().selectSlide(slide.slides[2]!.id));
    await userEvent.click(screen.getByRole('button', { name: 'Folie' }));
    expect(deck.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'slide', slideId: slide.slides[2]!.id } }]);
    // Alt+Enter: dieselbe Folie ist schon referenziert – kein Duplikat
    fireEvent.keyDown(screen.getByTestId('composer-editor'), { key: 'Enter', altKey: true });
    expect(deck.store.getState().composer.filter((s) => s.type === 'ref')).toHaveLength(1);
    unmount();

    const web = await setupStudio({ project: DEMO_WEB_PATH });
    const second = renderStudio(<Composer />, web);
    await userEvent.click(screen.getByRole('button', { name: 'Seite' }));
    const ref = web.store.getState().composer[0];
    expect(ref?.type === 'ref' && ref.ref.kind === 'element' && ref.ref.selector === 'body').toBe(true);
    expect(screen.getByTestId('composer-editor').querySelector<HTMLElement>('.chip')!.dataset.refKey).toMatch(/^page:\//);
    second.unmount();

    const canvas = await setupStudio({ project: DEMO_CANVAS_PATH });
    renderStudio(<Composer />, canvas);
    expect(screen.queryByRole('button', { name: /^(Marker|Folie|Seite)/ })).toBeNull();
  });

  it('„+“: Datei einfügen verknüpft und setzt Asset-Chips; Asset einfügen fokussiert die Asset-Suche', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const importFiles = vi.spyOn(studio.api, 'importFiles');
    renderStudio(
      <>
        <section className="assets">
          <input type="search" aria-label="Assets durchsuchen" />
        </section>
        <Composer />
      </>,
      studio,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Einfügen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Datei einfügen …' }));
    await waitFor(() => expect(studio.store.getState().composer.filter((s) => s.type === 'ref')).toHaveLength(2));
    expect(importFiles).toHaveBeenCalledWith(DEMO_VIDEO_ID, expect.any(Array), 'link');
    expect(screen.getByTestId('composer-editor').querySelectorAll('.chip-asset')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Einfügen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Asset einfügen …' }));
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Assets durchsuchen' })).toHaveFocus());
  });

  it('Werkzeugleiste ohne Keycaps in Knöpfen; Kürzel stehen in der Beschreibung', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Composer />, studio);
    const composer = screen.getByRole('region', { name: 'Nachricht an den Director' });
    expect(composer.querySelector('button kbd, button .kbd')).toBeNull();
    expect(screen.getByTestId('composer-editor')).toHaveAccessibleDescription(/Strg\+Enter sendet · Alt\+Enter referenziert die aktuelle Stelle/);
    // Modellwahl als Zusammenfassung in der Leiste
    expect(within(composer).getByRole('button', { name: 'Modelle' })).toHaveAttribute('aria-haspopup', 'dialog');
  });
});

describe('Composer-DOM und -Operationen', () => {
  it('liest Segmente aus dem DOM (Chips, Zeilenumbrüche, Null-Breite-Anker)', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const segments: ComposerSegment[] = [
      { type: 'text', text: 'Hallo ' },
      { type: 'ref', ref: TIME_REF },
      { type: 'ref', ref: ASSET_REF },
    ];
    renderSegments(root, segments, {}, (l) => l, { numbers: { 'time:372': 4 } });
    expect(parseDom(root)).toEqual(segments);
    // Nummer und Beschriftung gehen nicht in den Inhalt ein; nur Bühnen-Referenzen sind nummeriert
    expect(root.querySelector<HTMLElement>('.chip-time')!.dataset.refN).toBe('4');
    expect(root.querySelector<HTMLElement>('.chip-asset')!.dataset.refN).toBeUndefined();
    root.appendChild(document.createElement('br'));
    root.appendChild(document.createTextNode('Zeile'));
    root.appendChild(document.createElement('br'));
    expect(parseDom(root)).toEqual([...segments, { type: 'text', text: '\nZeile' }]);
    // Position hinter dem ersten Chip = 7 (6 Zeichen + 1 Chip)
    expect(positionOf(root, root, 2)).toBe(7);
    root.remove();
  });

  it('insertSegmentsAt ergänzt Leerzeichen an den Nahtstellen', () => {
    const base: ComposerSegment[] = [{ type: 'text', text: 'Bitte' }];
    const result = insertSegmentsAt(base, 5, [{ type: 'text', text: 'hier' }, { type: 'ref', ref: TIME_REF }]);
    expect(result.segments).toEqual([{ type: 'text', text: 'Bitte hier' }, { type: 'ref', ref: TIME_REF }]);
    expect(result.caret).toBe(11);
    expect(trimSegments([{ type: 'text', text: '  a ' }, { type: 'ref', ref: TIME_REF }, { type: 'text', text: ' ' }])).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'ref', ref: TIME_REF },
    ]);
  });
});
