import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelPicker, ModelPickerPanel, openModelPicker } from '../src/renderer/components/picker/ModelPicker.tsx';
import { DEMO_VIDEO_ID, DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';

describe('Modell-Picker', () => {
  it('Ebene 1 zeigt Auswahl + Preis; Ebene 2 ersetzt sie, nach der Wahl zurück auf Ebene 1', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const setPicker = vi.spyOn(studio.api, 'setPicker');
    renderStudio(<ModelPickerPanel />, studio);
    expect(screen.getByText('Modelle für dieses Projekt')).toBeInTheDocument();
    const trigger = await screen.findByRole('button', { name: 'Video: h3-max, $0.16 / s' });
    expect(within(trigger).getByText('$0.16 / s')).toBeInTheDocument();
    // Auto-Zeile ohne Preis; alle neun Modalitäten sind erreichbar
    expect(screen.getByRole('button', { name: 'Bild: Auto' })).toBeInTheDocument();
    for (const name of ['Director', 'Text', 'Bild', 'Video', 'Lipsync', 'Stimme', 'Musik', 'Sound', 'Werkzeuge']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}: `) })).toBeInTheDocument();
    }

    const user = userEvent.setup();
    await user.click(trigger);
    // Ebene 2 an derselben Stelle: Ebene 1 ist weg, ein Zurück-Knopf führt zurück
    expect(screen.queryByRole('button', { name: 'Bild: Auto' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Zurück: Video' })).toBeInTheDocument();
    const list = screen.getByRole('listbox', { name: 'Video' });
    const options = within(list).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Auto');
    const kling = within(list).getByRole('option', { name: /Kling 3 Pro/ });
    expect(kling).toHaveTextContent('$0.11 / s');
    expect(kling).toHaveTextContent('5 s ≈ $0.55');
    expect(kling).toHaveTextContent('Referenzbild');
    const h3 = within(list).getByRole('option', { name: /h3-max/ });
    expect(h3).toHaveAttribute('aria-selected', 'true');
    expect(h3).toHaveTextContent('Audio-In');
    expect(h3).toHaveTextContent('≤15 s');
    expect(h3).toHaveTextContent('Ton');
    expect(h3).toHaveTextContent('1080p');
    expect(within(list).getByRole('option', { name: /Veo 3 Fast/ })).toHaveTextContent('Veraltet');

    await user.click(kling);
    expect(setPicker).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'video', { mode: 'model', modelId: 'fal-ai/kling-video/v3/pro' });
    // Zurück auf Ebene 1 mit der neuen Auswahl; der Fokus steht auf der Zeile
    const row = await screen.findByRole('button', { name: 'Video: Kling 3 Pro, $0.11 / s' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(row).toHaveFocus();
  });

  it('Suche filtert, Auto setzt zurück, Tastatur wählt aus; Esc und ← gehen eine Ebene zurück', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const setPicker = vi.spyOn(studio.api, 'setPicker');
    renderStudio(<ModelPickerPanel />, studio);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Bild: Auto/ }));
    const search = screen.getByRole('searchbox', { name: 'Modelle durchsuchen' });
    await waitFor(() => expect(search).toHaveFocus());
    await user.type(search, 'flux');
    const list = screen.getByRole('listbox', { name: 'Bild' });
    expect(within(list).getAllByRole('option')).toHaveLength(2); // Auto + FLUX.2 Pro
    await user.keyboard('{ArrowDown}{Enter}');
    expect(setPicker).toHaveBeenLastCalledWith(DEMO_VIDEO_ID, 'image', { mode: 'model', modelId: 'fal-ai/flux-2/pro' });

    await user.click(await screen.findByRole('button', { name: /^Bild: FLUX\.2 Pro/ }));
    await user.click(within(screen.getByRole('listbox', { name: 'Bild' })).getByRole('option', { name: /^Auto/ }));
    expect(setPicker).toHaveBeenLastCalledWith(DEMO_VIDEO_ID, 'image', { mode: 'auto' });

    // Tastatur auf Ebene 1: ↓ wechselt die Zeile, → öffnet Ebene 2, ← (Cursor am Anfang) bzw. Esc gehen zurück
    const imageRow = await screen.findByRole('button', { name: /^Bild: Auto/ });
    expect(imageRow).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^Video: / })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('listbox', { name: 'Video' })).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: /^Video: / })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('listbox', { name: 'Video' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Director-Zeile hat eine Denktiefe-Auswahl (setEffort) und Aktualisieren (refreshModels)', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const setEffort = vi.spyOn(studio.api, 'setEffort');
    const refresh = vi.spyOn(studio.api, 'refreshModels');
    renderStudio(<ModelPickerPanel />, studio);
    expect(await screen.findByRole('button', { name: /^Director: Claude Opus 5\.5/ })).toBeInTheDocument();
    const effort = screen.getByRole('combobox', { name: 'Denktiefe' });
    expect(effort).toHaveValue('xhigh');
    expect(within(effort).getAllByRole('option').map((o) => o.textContent)).toEqual(['Niedrig', 'Mittel', 'Hoch', 'Sehr hoch', 'Max']);
    await userEvent.selectOptions(effort, 'max');
    expect(setEffort).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'max');
    expect(studio.store.getState().manifest?.director.effort).toBe('max');
    await userEvent.click(screen.getByRole('button', { name: 'Modellkatalog aktualisieren' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('Zusammenfassung zeigt die gebundenen Modelle, öffnet das Popover (auch mit mod+M) und bleibt nach der Wahl offen', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<ModelPicker />, studio);
    const summary = await screen.findByRole('button', { name: 'Modelle' });
    expect(summary).toHaveAttribute('aria-haspopup', 'dialog');
    // Director mit Denktiefe, gebundene Modalitäten mit Kurzname, der Rest gezählt
    await waitFor(() => expect(summary).toHaveTextContent('Opus 5.5· sehr hoch'));
    expect(summary).toHaveTextContent('h3-max');
    expect(summary).toHaveTextContent('+7 Auto');
    expect(summary).not.toHaveTextContent('Claude');

    const user = userEvent.setup();
    await user.click(summary);
    const dialog = screen.getByRole('dialog', { name: 'Modellwahl' });
    // Der Fokus springt in die erste Zeile
    expect(within(dialog).getByRole('button', { name: /^Director: / })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: /^Bild: Auto/ }));
    await user.click(within(screen.getByRole('listbox', { name: 'Bild' })).getByRole('option', { name: /Nano Banana Pro/ }));
    // Ebene 1 kommt zurück, das Popover bleibt offen; die Zusammenfassung nennt das neue Modell
    expect(screen.getByRole('dialog', { name: 'Modellwahl' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Bild: Nano Banana Pro/ })).toBeInTheDocument();
    expect(summary).toHaveTextContent('Nano Banana Pro');
    expect(summary).toHaveTextContent('+6 Auto');
    // Esc auf Ebene 1 schließt und gibt den Fokus an die Zusammenfassung zurück
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Modellwahl' })).toBeNull();
    expect(summary).toHaveFocus();

    // mod+M öffnet und schließt
    fireEvent.keyDown(window, { key: 'm', code: 'KeyM', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Modellwahl' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'm', code: 'KeyM', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Modellwahl' })).toBeNull();

    // Von außen (z. B. „Anderes Modell …“) direkt auf Ebene 2 einer Modalität
    act(() => openModelPicker('video'));
    expect(screen.getByRole('listbox', { name: 'Video' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Modelle durchsuchen' })).toHaveFocus());
  });
});
