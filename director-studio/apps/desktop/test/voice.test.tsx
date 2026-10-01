import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/renderer/components/composer/Composer.tsx';
import { selectUserMarkers } from '../src/renderer/state/selectors.ts';
import { DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';
import { MediaRecorderStub } from './setup.ts';

const WORDS = [
  { text: 'Mach', start: 0.0, end: 0.3 },
  { text: 'diese', start: 0.4, end: 0.7 },
  { text: 'Stelle', start: 0.8, end: 1.1 },
  { text: 'dunkler', start: 1.2, end: 1.5 },
  { text: 'und', start: 1.6, end: 1.8 },
  { text: 'hier', start: 1.9, end: 2.1 },
  { text: 'lauter', start: 2.2, end: 2.5 },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Push-to-Talk', () => {
  it('nimmt auf, sammelt Marker mit Zeitstempel und setzt die Chips hinter die passenden Wörter', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    studio.api.debug.setTranscript(WORDS);
    const transcribe = vi.spyOn(studio.api, 'transcribe');
    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    renderStudio(<Composer />, studio);
    const mic = screen.getByRole('button', { name: 'Halten zum Sprechen' });
    fireEvent.pointerDown(mic);
    await waitFor(() => expect(studio.store.getState().voice.recording).toBe(true));
    expect(MediaRecorderStub.instances).toHaveLength(1);
    // Die Aufnahmeanzeige ersetzt den linken Teil der Werkzeugleiste (DESIGN.md §7.7)
    expect(screen.getByText('Aufnahme')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Marker/ })).toBeNull();
    expect(mic).toHaveAttribute('aria-pressed', 'true');

    // Marker während der Aufnahme (Klick in die Markerleiste bzw. Enter rufen `addMarkerAt` auf, §8.4)
    // 0,9 s nach Start: „Stelle“ hat begonnen
    now = 10_900;
    act(() => studio.store.getState().addMarkerAt(372));
    // 2,0 s: „hier“ hat begonnen
    now = 12_000;
    act(() => studio.store.getState().addMarkerAt(600));
    // Während der Aufnahme landen Klicks noch nicht im Composer
    expect(studio.store.getState().composer).toEqual([]);
    expect(studio.store.getState().voice.clicks).toHaveLength(2);
    expect(screen.getByText('2 Klicks')).toBeInTheDocument();

    now = 12_600;
    fireEvent.pointerUp(mic);
    await waitFor(() => expect(studio.store.getState().composer.length).toBeGreaterThan(0));
    expect(transcribe).toHaveBeenCalledWith(studio.store.getState().projectId, expect.any(ArrayBuffer), 'audio/webm');
    expect(studio.store.getState().composer).toEqual([
      { type: 'text', text: 'Mach diese Stelle ' },
      { type: 'ref', ref: { kind: 'time', frame: 372 } },
      { type: 'text', text: ' dunkler und hier ' },
      { type: 'ref', ref: { kind: 'time', frame: 600 } },
      { type: 'text', text: ' lauter' },
    ]);
    expect(studio.store.getState().voice.recording).toBe(false);
    const chips = Array.from(screen.getByTestId('composer-editor').querySelectorAll('.chip'));
    // Nummerierte Zeit-Chips ohne Emoji (DESIGN.md §7.7.2)
    expect(chips.map((c) => [c.querySelector('.n')?.textContent, c.querySelector('.chip-label')?.textContent])).toEqual([
      ['1', '00:12:12'],
      ['2', '00:20:00'],
    ]);
  });

  it('während der Aufnahme gibt es keinen Duplikatschutz: Marker schweben, gleiche Stellen teilen sich danach eine Nummer', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    studio.api.debug.setTranscript(WORDS);
    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    renderStudio(<Composer />, studio);
    const mic = screen.getByRole('button', { name: 'Halten zum Sprechen' });
    fireEvent.pointerDown(mic);
    await waitFor(() => expect(studio.store.getState().voice.recording).toBe(true));
    now = 10_900;
    act(() => studio.store.getState().addMarkerAt(372));
    now = 12_000;
    act(() => void studio.store.getState().insertRef({ kind: 'time', frame: 372 }));
    expect(studio.store.getState().voice.clicks).toHaveLength(2);
    // Schwebende Marker (Umriss, ohne Nummer), auf der Leiste nur einmal
    expect(selectUserMarkers(studio.store.getState())).toEqual([{ key: 'time:372', frame: 372, n: 0, pending: true }]);
    now = 12_600;
    fireEvent.pointerUp(mic);
    await waitFor(() => expect(studio.store.getState().composer.length).toBeGreaterThan(0));
    const refs = studio.store.getState().composer.filter((seg) => seg.type === 'ref');
    expect(refs).toHaveLength(2);
    expect(studio.store.getState().refNumbers).toEqual({ 'time:372': 1 });
    const numbers = Array.from(screen.getByTestId('composer-editor').querySelectorAll('.chip .n')).map((n) => n.textContent);
    expect(numbers).toEqual(['1', '1']);
    expect(selectUserMarkers(studio.store.getState())).toEqual([{ key: 'time:372', frame: 372, n: 1, pending: false }]);
  });

  it('Strg+Shift+Leertaste startet und beendet die Aufnahme; Diktat wird am Cursor eingefügt', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    studio.api.debug.setTranscript([
      { text: 'bitte', start: 0, end: 0.2 },
      { text: 'wärmer', start: 0.3, end: 0.6 },
    ]);
    renderStudio(<Composer />, studio);
    act(() => studio.store.getState().insertSegments([{ type: 'text', text: 'Der Himmel,' }]));
    fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(studio.store.getState().voice.recording).toBe(true));
    fireEvent.keyUp(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(studio.store.getState().composer).toEqual([{ type: 'text', text: 'Der Himmel, bitte wärmer' }]));
  });

  it('meldet ein fehlendes Mikrofon verständlich', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const getUserMedia = navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>;
    getUserMedia.mockRejectedValueOnce(new Error('Permission denied'));
    renderStudio(<Composer />, studio);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Halten zum Sprechen' }));
    await waitFor(() => expect(studio.store.getState().toasts.at(-1)?.text).toBe('Mikrofon nicht verfügbar: Permission denied'));
    expect(studio.store.getState().voice.recording).toBe(false);
  });
});
