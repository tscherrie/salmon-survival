import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelPickerBar } from '../src/renderer/components/picker/ModelPickerBar.tsx';
import { DEMO_VIDEO_ID, DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';

describe('Modell-Picker', () => {
  it('zeigt Auswahl + Preis, wählt ein Modell und ruft setPicker auf', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const setPicker = vi.spyOn(studio.api, 'setPicker');
    renderStudio(<ModelPickerBar />, studio);
    const trigger = await screen.findByRole('button', { name: 'Video: h3-max, $0.16 / s' });
    expect(within(trigger).getByText('$0.16 / s')).toBeInTheDocument();
    // Auto-Picker ohne Preis
    expect(screen.getByRole('button', { name: 'Bild: Auto' })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(trigger);
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
    expect(await screen.findByRole('button', { name: 'Video: Kling 3 Pro, $0.11 / s' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Suche filtert, Auto setzt zurück, Tastatur wählt aus', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const setPicker = vi.spyOn(studio.api, 'setPicker');
    renderStudio(<ModelPickerBar />, studio);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Bild: Auto/ }));
    const search = screen.getByRole('searchbox', { name: 'Modelle durchsuchen' });
    await waitFor(() => expect(search).toHaveFocus());
    await user.type(search, 'flux');
    const list = screen.getByRole('listbox', { name: 'Bild' });
    expect(within(list).getAllByRole('option')).toHaveLength(2); // Auto + FLUX.2 Pro
    await user.keyboard('{ArrowDown}{Enter}');
    expect(setPicker).toHaveBeenLastCalledWith(DEMO_VIDEO_ID, 'image', { mode: 'model', modelId: 'fal-ai/flux-2/pro' });

    await user.click(screen.getByRole('button', { name: /^Bild: FLUX\.2 Pro/ }));
    await user.click(within(screen.getByRole('listbox', { name: 'Bild' })).getByRole('option', { name: /^Auto/ }));
    expect(setPicker).toHaveBeenLastCalledWith(DEMO_VIDEO_ID, 'image', { mode: 'auto' });
  });

  it('Director-Picker hat eine Denktiefe-Auswahl (setEffort) und Aktualisieren (refreshModels)', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const setEffort = vi.spyOn(studio.api, 'setEffort');
    const refresh = vi.spyOn(studio.api, 'refreshModels');
    renderStudio(<ModelPickerBar />, studio);
    expect(await screen.findByRole('button', { name: /^Director: Claude Opus 5\.5/ })).toBeInTheDocument();
    const effort = screen.getByRole('combobox', { name: 'Denktiefe' });
    expect(effort).toHaveValue('xhigh');
    await userEvent.selectOptions(effort, 'max');
    expect(setEffort).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'max');
    expect(studio.store.getState().manifest?.director.effort).toBe('max');
    await userEvent.click(screen.getByRole('button', { name: 'Modellkatalog aktualisieren' }));
    expect(refresh).toHaveBeenCalled();
  });
});
