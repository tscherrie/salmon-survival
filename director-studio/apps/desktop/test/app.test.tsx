import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../src/renderer/App.tsx';
import { FakeStudioApi } from '../src/renderer/fake/FakeStudioApi.ts';
import { DEFAULT_PX_PER_SECOND, TIMELINE_PAD } from '../src/renderer/lib/timelineGeometry.ts';

describe('App (Integration mit Fake-Backend)', () => {
  it('Arbeitsbereich: Referenz → Senden → Rückfrage → Checkpoint → neue Version', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    render(<App api={api} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Musikvideo „Nachtfahrt“/ }));

    // Alle Bereiche des Wireframes sind da
    expect(screen.getByRole('region', { name: 'Monitor' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Director' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Bühne (nur lesbar)' })).toBeInTheDocument();
    // Modellwahl steckt in der Composer-Werkzeugleiste (DESIGN.md §7.8), nicht mehr als eigene Zeile
    expect(screen.getByRole('button', { name: 'Modelle' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nachricht an den Director' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Asset-Browser' })).toBeInTheDocument();

    // Klick in die Markerleiste → Marker = Zeit-Chip (DESIGN.md §8.4); Frame 300 liegt auf einem Schlag
    const strip = document.querySelector('[data-marker-strip]')!;
    const x = TIMELINE_PAD + (300 / 30) * DEFAULT_PX_PER_SECOND;
    fireEvent.mouseDown(strip, { clientX: x, clientY: 8, button: 0 });
    fireEvent.mouseUp(strip, { clientX: x, clientY: 8, button: 0 });
    const editor = screen.getByTestId('composer-editor');
    // Nummerierter Zeit-Chip ohne Emoji (DESIGN.md §7.7.2): Nummer 1, Timecode MM:SS:FF
    const chip = editor.querySelector<HTMLElement>('.chip')!;
    expect(chip.querySelector('.n')).toHaveTextContent('1');
    expect(chip.querySelector('.chip-label')).toHaveTextContent('00:10:00');
    expect(chip.dataset.refKey).toBe('time:300');
    await user.click(editor);
    await user.keyboard(' heller');
    expect(editor).toHaveTextContent('heller');
    await user.click(screen.getByRole('button', { name: 'Senden' }));

    const panel = screen.getByRole('complementary', { name: 'Director' });
    await waitFor(() => expect(within(panel).getAllByText(/Bevor ich ein Treatment schreibe/).length).toBeGreaterThan(0), { timeout: 5000 });
    expect(within(panel).getByText(/Die Stelle bei/)).toHaveTextContent('Strophe: Mira am Steuer');

    const question = await within(panel).findByRole('form', { name: 'Rückfrage' }, { timeout: 5000 });
    await user.click(within(question).getByLabelText(/YouTube \(16:9\)/));
    await user.click(within(question).getByLabelText(/Papier-Rotoscope/));
    await user.click(within(question).getByRole('button', { name: 'Antworten' }));

    const card = await within(panel).findByRole('article', { name: 'Checkpoint zur Freigabe: Treatment' }, { timeout: 5000 });
    await user.click(within(card).getByRole('button', { name: 'Freigeben (Budget $12.50)' }));
    expect(await screen.findByRole('button', { name: 'Versionen: v4' }, { timeout: 8000 })).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getAllByText(/Fertig/).length).toBeGreaterThan(0), { timeout: 5000 });
    // Neues Asset aus der Generierung im Browser
    expect(await screen.findByText('Storyboard 07 – Refrain Neon', {}, { timeout: 5000 })).toBeInTheDocument();
    // Zurück zum Start
    await user.click(screen.getByRole('button', { name: 'Projekte' }));
    expect(await screen.findByRole('heading', { name: 'Zuletzt geöffnet' })).toBeInTheDocument();
  });
});
