import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { serializeComposer, type ComposerSegment } from '@studio/core';
import { Composer } from '../src/renderer/components/composer/Composer.tsx';
import { parseDom, positionOf, renderSegments, setCaretPosition } from '../src/renderer/components/composer/editorDom.ts';
import { insertSegmentsAt, trimSegments } from '../src/renderer/lib/composerOps.ts';
import { DEMO_VIDEO_ID, DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';

const TIME_REF = { kind: 'time' as const, frame: 372 };
const ASSET_REF = { kind: 'asset' as const, assetId: 'ast_char_mira' };

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
    act(() => studio.store.setState({ composer: segments, caret: 0, composerRevision: 1 }));
    renderStudio(<Composer />, studio);
    const editor = screen.getByTestId('composer-editor');
    expect(editor.querySelectorAll('.chip')).toHaveLength(2);
    expect(editor).toHaveTextContent('Mach ⏱ 00:12.400–00:18.000 · Video');
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

  it('entfernt Chips per ×-Knopf und per Rücktaste', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    act(() =>
      studio.store.setState({
        composer: [
          { type: 'text', text: 'A ' },
          { type: 'ref', ref: TIME_REF },
          { type: 'text', text: ' B ' },
          { type: 'ref', ref: ASSET_REF },
        ],
        composerRevision: 1,
      }),
    );
    renderStudio(<Composer />, studio);
    const editor = screen.getByTestId('composer-editor');
    // × am ersten Chip
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Referenz entfernen: ⏱ 00:12.400' }));
    expect(studio.store.getState().composer).toEqual([
      { type: 'text', text: 'A  B ' },
      { type: 'ref', ref: ASSET_REF },
    ]);
    // Rücktaste direkt hinter dem letzten Chip
    editor.focus();
    setCaretPosition(editor, 6);
    fireEvent.keyDown(editor, { key: 'Backspace' });
    expect(studio.store.getState().composer).toEqual([{ type: 'text', text: 'A  B ' }]);
    expect(editor.querySelectorAll('.chip')).toHaveLength(0);
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

  it('reiht Nachrichten ein, solange der Director arbeitet, und sendet sie danach', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const send = vi.spyOn(studio.api, 'sendMessage').mockResolvedValue();
    const interrupt = vi.spyOn(studio.api, 'interrupt');
    renderStudio(<Composer />, studio);
    act(() => studio.api.debug.emit({ type: 'run_state', projectId: DEMO_VIDEO_ID, runId: 'run_x', state: 'running' }));
    act(() => studio.store.getState().insertSegments([{ type: 'text', text: 'Danach bitte Musik' }]));
    await userEvent.click(screen.getByRole('button', { name: 'Einreihen' }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText('1 Nachricht(en) in der Warteschlange')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stopp' }));
    expect(interrupt).toHaveBeenCalledWith(DEMO_VIDEO_ID);
    act(() => studio.api.debug.emit({ type: 'run_state', projectId: DEMO_VIDEO_ID, runId: 'run_x', state: 'idle' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![1].segments).toEqual([{ type: 'text', text: 'Danach bitte Musik' }]);
    expect(studio.store.getState().queue).toEqual([]);
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
    renderSegments(root, segments, {}, (l) => l);
    expect(parseDom(root)).toEqual(segments);
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
