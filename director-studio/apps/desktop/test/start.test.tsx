import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { STANDARD_FORMATS } from '@studio/core';
import { App } from '../src/renderer/App.tsx';
import { FakeStudioApi } from '../src/renderer/fake/FakeStudioApi.ts';
import { getLanguage } from '../src/renderer/i18n.ts';

function setup() {
  const api = new FakeStudioApi({ delayMs: 0 });
  render(<App api={api} />);
  return api;
}

describe('Startbildschirm', () => {
  it('listet zuletzt geöffnete Projekte und zeigt den Anmeldestatus', async () => {
    setup();
    expect(await screen.findByRole('button', { name: /Musikvideo „Nachtfahrt“/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pitch-Deck Q4/ })).toBeInTheDocument();
    const auth = screen.getByTestId('auth-status');
    expect(auth).toHaveTextContent('Aktiver Director: Anthropic');
    expect(auth).toHaveTextContent('fal.ai: nicht eingerichtet');
    expect(screen.getByText('Browser-Modus (Fake-Backend)')).toBeInTheDocument();
  });

  it('legt ein neues Projekt an (Titel, Kategorie, Formate, Ordner) und öffnet den Arbeitsbereich', async () => {
    const api = setup();
    const create = vi.spyOn(api, 'createProject');
    api.debug.setNextDirectory('/Users/demo/Kunden');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Neues Projekt' }));
    const dialog = screen.getByRole('dialog', { name: 'Neues Projekt' });
    // Ohne Titel → Hinweis
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Bitte einen Titel angeben.');
    await user.type(within(dialog).getByLabelText('Titel'), 'Sommerkampagne');
    await user.click(within(dialog).getByLabelText('Video'));
    await user.click(within(dialog).getByLabelText('9:16'));
    await user.click(within(dialog).getByRole('button', { name: 'Ordner wählen …' }));
    expect(await within(dialog).findByText('/Users/demo/Kunden')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));
    expect(create).toHaveBeenCalledWith({
      title: 'Sommerkampagne',
      category: 'video',
      directory: '/Users/demo/Kunden',
      formats: [STANDARD_FORMATS['16:9'], STANDARD_FORMATS['9:16']],
    });
    expect(await screen.findByRole('heading', { name: 'Sommerkampagne' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: 'Bühne (nur lesbar)' })).toBeInTheDocument();
  });

  it('„Noch offen“ legt ein Projekt ohne Kategorie an', async () => {
    const api = setup();
    const create = vi.spyOn(api, 'createProject');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Neues Projekt' }));
    const dialog = screen.getByRole('dialog', { name: 'Neues Projekt' });
    await user.type(within(dialog).getByLabelText('Titel'), 'Idee');
    await user.click(within(dialog).getByLabelText('Noch offen – im Gespräch klären'));
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));
    expect(create.mock.calls[0]![0]).toMatchObject({ title: 'Idee', category: null });
    expect(await screen.findByText('Kategorie offen')).toBeInTheDocument();
    expect(screen.getAllByText('Noch kein Dokument – die Kategorie wird im Planungsgespräch geklärt.').length).toBeGreaterThan(0);
  });

  it('„Projekt öffnen …“ nutzt chooseDirectory; Fehler erscheinen als Meldung', async () => {
    const api = setup();
    const user = userEvent.setup();
    api.debug.setNextDirectory('/Users/demo/Nirgendwo');
    await user.click(await screen.findByRole('button', { name: 'Projekt öffnen …' }));
    expect(await screen.findByText('Projekt konnte nicht geöffnet werden: Kein Projekt unter /Users/demo/Nirgendwo')).toBeInTheDocument();
    api.debug.setNextDirectory(api.debug.demoProjectPath);
    await user.click(screen.getByRole('button', { name: 'Projekt öffnen …' }));
    expect(await screen.findByRole('heading', { name: 'Musikvideo „Nachtfahrt“' })).toBeInTheDocument();
  });
});

describe('Einstellungen', () => {
  it('speichert Schlüssel per setSecret, ohne sie je wieder anzuzeigen', async () => {
    const api = setup();
    const setSecret = vi.spyOn(api, 'setSecret');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Einstellungen' }));
    const dialog = screen.getByRole('dialog', { name: 'Einstellungen' });
    const falInput = within(dialog).getByLabelText(/fal\.ai-Key/);
    expect(falInput).toHaveAttribute('type', 'password');
    expect(falInput).toHaveValue('');
    expect(within(dialog).getByTestId('auth-status')).toHaveTextContent('fal.ai: nicht eingerichtet');
    await user.type(falInput, 'fal-geheim-123');
    const falRow = falInput.closest('.secret-field') as HTMLElement;
    await user.click(within(falRow).getByRole('button', { name: 'Schlüssel speichern' }));
    expect(setSecret).toHaveBeenCalledWith('fal', 'fal-geheim-123');
    // Eingabe sofort geleert, Wert nirgends im DOM, Protokoll maskiert
    expect(falInput).toHaveValue('');
    expect(document.body.innerHTML).not.toContain('fal-geheim-123');
    expect(JSON.stringify(api.debug.calls)).not.toContain('fal-geheim-123');
    await waitFor(() => expect(within(dialog).getByTestId('auth-status')).toHaveTextContent('fal.ai: eingerichtet'));
    // Entfernen
    await user.click(within(falRow).getByRole('button', { name: 'Schlüssel entfernen' }));
    expect(setSecret).toHaveBeenLastCalledWith('fal', null);
  });

  it('speichert Laufzeit, Claude-Abo-Erlaubnis, Sprache und Denktiefe', async () => {
    const api = setup();
    const update = vi.spyOn(api, 'updateSettings');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Einstellungen' }));
    const dialog = screen.getByRole('dialog', { name: 'Einstellungen' });
    expect(within(dialog).getByText(/nur für die eigene Nutzung zulässig/, { selector: 'p' })).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText('Claude Agent SDK (Claude-Abo)'));
    await user.click(within(dialog).getByRole('switch', { name: 'Claude-Abo-Login erlauben (nur Eigennutzung)' }));
    await user.selectOptions(within(dialog).getByLabelText('Standard-Denktiefe'), 'max');
    await user.selectOptions(within(dialog).getByLabelText('Sprache'), 'en');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(update).toHaveBeenCalledWith({ language: 'en', defaultEffort: 'max', preferredRuntime: 'agent-sdk', allowClaudeSubscription: true });
    await waitFor(() => expect(getLanguage()).toBe('en'));
    // Oberfläche jetzt englisch; aktive Laufzeit = Agent SDK
    expect(await screen.findByText('Recent projects')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('Active Director: Agent SDK (Claude subscription)'));
  });
});
