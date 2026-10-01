import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { STANDARD_FORMATS, type RecentProject } from '@studio/core';
import { App } from '../src/renderer/App.tsx';
import { FakeStudioApi } from '../src/renderer/fake/FakeStudioApi.ts';
import { getLanguage } from '../src/renderer/i18n.ts';

function setup(options: { seed?: false; recent?: RecentProject[] } = {}) {
  const api = new FakeStudioApi({ delayMs: 0, ...(options.seed === false ? { seed: false } : {}) });
  if (options.recent) vi.spyOn(api, 'listRecentProjects').mockResolvedValue(options.recent);
  render(<App api={api} />);
  return api;
}

const recentRegion = () => screen.getByRole('main', { name: 'Zuletzt geöffnet' });

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
    // Ohne Dokument: Bühne zeigt den Planungs-Platzhalter, Monitor einen Hinweis, das Planungsgespräch ist bedienbar.
    const stage = screen.getByRole('region', { name: 'Bühne (nur lesbar)' });
    expect(within(stage).getByTestId('stage-planning')).toHaveTextContent('Kategorie wird im Planungsgespräch festgelegt');
    expect(within(screen.getByRole('region', { name: 'Monitor' })).getByText('Noch kein Dokument – die Kategorie wird im Planungsgespräch festgelegt.')).toBeInTheDocument();
    const panel = screen.getByRole('complementary', { name: 'Director' });
    expect(within(panel).getByText(/Er beginnt mit einem kurzen Planungsgespräch/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nachricht an den Director' })).toBeInTheDocument();
  });

  it('Projekt ohne Kategorie: Planungsgespräch legt die Kategorie fest, danach erscheint die Bühne', async () => {
    const api = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Neues Projekt' }));
    const dialog = screen.getByRole('dialog', { name: 'Neues Projekt' });
    await user.type(within(dialog).getByLabelText('Titel'), 'Sommeridee');
    await user.click(within(dialog).getByLabelText('Noch offen – im Gespräch klären'));
    await user.click(within(dialog).getByRole('button', { name: 'Projekt anlegen' }));
    expect(await screen.findByTestId('stage-planning')).toBeInTheDocument();
    const editor = screen.getByTestId('composer-editor');
    await user.click(editor);
    await user.keyboard('Etwas für den Sommer');
    await user.click(screen.getByRole('button', { name: 'Senden' }));
    const panel = screen.getByRole('complementary', { name: 'Director' });
    const question = await within(panel).findByRole('form', { name: 'Rückfrage' }, { timeout: 5000 });
    await user.click(within(question).getByLabelText(/Präsentation/));
    await user.click(within(question).getByLabelText(/Beides/));
    await user.click(within(question).getByLabelText(/Analogfilm/));
    await user.click(within(question).getByRole('button', { name: 'Antworten' }));
    // Nach `set_category` lädt die UI den Snapshot neu: Folienbühne statt Platzhalter
    await waitFor(() => expect(screen.queryByTestId('stage-planning')).toBeNull(), { timeout: 5000 });
    const stage = screen.getByRole('region', { name: 'Bühne (nur lesbar)' });
    await waitFor(() => expect(stage.querySelector('.slide-strip, .stage-empty')).not.toBeNull(), { timeout: 5000 });
    expect(stage).not.toHaveTextContent('Kategorie wird im Planungsgespräch festgelegt');
    expect(screen.getByText('Präsentation', { selector: '.badge-category' })).toBeInTheDocument();
    expect(api.debug.calls.some((c) => c.method === 'getSnapshot')).toBe(true);
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

describe('Startbildschirm nach DESIGN.md §7.12', () => {
  it('links Frage, Aktionen und „Neu aus Kategorie“; eine Kategorie öffnet „Neues Projekt“ mit dieser Kategorie', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Was produzieren wir heute?' })).toBeInTheDocument();
    const cats = screen.getByRole('list', { name: 'Neu aus Kategorie' });
    const buttons = within(cats).getAllByRole('button');
    expect(buttons.map((b) => b.querySelector('.launch-cat-name')?.textContent)).toEqual(['Video', 'Audio', 'Präsentation', 'Grafik', 'Website']);
    // Beispiele beschreiben die Zeile, gehören aber nicht zum Namen (sonst träfe „Musikvideo“ die Kategorie)
    const grafik = within(cats).getByRole('button', { name: 'Grafik' });
    expect(grafik).toHaveAccessibleDescription('Collage, Plakat, Key Visual');
    await userEvent.setup().click(grafik);
    const dialog = screen.getByRole('dialog', { name: 'Neues Projekt' });
    expect(within(dialog).getByLabelText('Grafik')).toBeChecked();
  });

  it('Feature = zuletzt bearbeitetes Projekt mit Checkpoint und Budget; danach Karten, ohne Standbild die Kategorie-Kachel', async () => {
    setup();
    const open = await screen.findByRole('button', { name: 'Musikvideo „Nachtfahrt“ öffnen' });
    const feature = open.closest('article')!;
    expect(within(feature).getByRole('heading', { name: 'Musikvideo „Nachtfahrt“' })).toBeInTheDocument();
    expect(feature).toHaveTextContent('Schritt 1 von 5');
    expect(within(feature).getByRole('img', { name: /^Budget: \$\d+\.\d\d von \$\d+\.\d\d ausgegeben$/ })).toBeInTheDocument();
    // Video mit verwendeten Bildern: Standbild; Podcast ohne Bild: ruhige Kachel mit Icon und Titel
    expect(feature.querySelector('.feature-picture img')).not.toBeNull();
    const podcast = within(recentRegion()).getByRole('button', { name: 'Podcast Folge 12' });
    expect(podcast.querySelector('.pcard-picture.is-tile')).toHaveTextContent('Podcast Folge 12');
    expect(podcast.querySelector('img')).toBeNull();
    expect(podcast).toHaveAccessibleDescription(/Audio/);
  });

  it('zeigt nur vorhandene Daten: wartende Freigabe, Standbild-URL; ohne Felder keine Leiste und kein Budget', async () => {
    setup({
      recent: [
        {
          path: '/p/a.dstudio',
          title: 'Nachtfahrt',
          category: 'video',
          updatedAt: '2026-09-28T11:45:00.000Z',
          poster: 'studio-asset://prj_a/ast_1?v=thumb',
          checkpoint: { index: 3, total: 5, title: 'Storyboard & Animatic', status: 'proposed' },
          budget: { spentUsd: 6.84, approvedUsd: 20 },
        },
        { path: '/p/b.dstudio', title: 'Ohne Daten', category: 'slides', updatedAt: '2026-09-20T10:00:00.000Z' },
      ],
    });
    const open = await screen.findByRole('button', { name: 'Nachtfahrt öffnen' });
    const feature = open.closest('article')!;
    expect(feature).toHaveTextContent('Der Director wartet auf deine Freigabe: Storyboard & Animatic');
    expect(feature.querySelector('img')).toHaveAttribute('src', 'studio-asset://prj_a/ast_1?v=thumb');
    expect(feature.querySelectorAll('.mini-steps i')).toHaveLength(5);
    expect(feature.querySelectorAll('.mini-steps i.is-done')).toHaveLength(2);
    expect(feature).toHaveTextContent('$6.84 / $20.00');
    const card = screen.getByRole('button', { name: 'Ohne Daten' });
    expect(card.querySelector('.is-tile')).not.toBeNull();
    expect(card).not.toHaveTextContent('Schritt');
    expect(card.querySelector('.budget-bar')).toBeNull();
  });

  it('Suche filtert, ohne Treffer gibt es „Filter zurücksetzen“; Raster/Liste schaltet um', async () => {
    setup();
    const user = userEvent.setup();
    const search = await screen.findByRole('searchbox', { name: 'Projekte durchsuchen' });
    await user.type(search, 'plakat');
    expect(within(recentRegion()).getAllByRole('button', { name: /Plakat Sommerfest/ })).toHaveLength(1);
    expect(within(recentRegion()).queryByRole('button', { name: /Pitch-Deck/ })).toBeNull();
    await user.clear(search);
    await user.type(search, 'zzz');
    expect(screen.getByText('Keine Treffer für „zzz“')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Liste' }));
    expect(screen.getByRole('button', { name: 'Liste' })).toHaveAttribute('aria-pressed', 'true');
    expect(recentRegion().querySelector('.feature')).toBeNull();
    expect(recentRegion().querySelectorAll('.prow')).toHaveLength(5);
  });

  it('ohne Projekte: Leerzustand statt Liste', async () => {
    setup({ seed: false });
    expect(await screen.findByText('Noch keine Projekte')).toBeInTheDocument();
    expect(screen.getByText('Lege ein neues Projekt an oder öffne einen vorhandenen Projektordner.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('Strg+N öffnet „Neues Projekt“, Strg+O „Projekt öffnen …“; der Anmeldestatus bietet „Schlüssel hinterlegen“', async () => {
    const api = setup();
    const choose = vi.spyOn(api, 'chooseDirectory');
    await screen.findByRole('heading', { name: 'Zuletzt geöffnet' });
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Neues Projekt' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    expect(choose).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(within(screen.getByTestId('auth-status')).getByRole('button', { name: 'Schlüssel hinterlegen' }));
    expect(screen.getByRole('dialog', { name: 'Einstellungen' })).toBeInTheDocument();
  });
});

describe('Kürzel-Übersicht (DESIGN.md §13.4)', () => {
  it('„?“ öffnet die Übersicht (nicht in Textfeldern), Esc schließt; die Einstellungen öffnen sie ebenfalls', async () => {
    setup();
    const user = userEvent.setup();
    const search = await screen.findByRole('searchbox', { name: 'Projekte durchsuchen' });
    await user.type(search, '?');
    expect(screen.queryByRole('dialog', { name: 'Tastenkürzel' })).toBeNull();
    await user.clear(search);
    act(() => search.blur());
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Tastenkürzel' });
    for (const group of ['Allgemein', 'Layout', 'Composer', 'Timeline', 'Markerleiste']) {
      expect(within(dialog).getByRole('region', { name: group })).toBeInTheDocument();
    }
    expect(within(dialog).getByText('Marker am Abspielkopf')).toBeInTheDocument();
    expect(within(dialog).getByText('Voriger / nächster Marker')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Tastenkürzel' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Einstellungen' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Einstellungen' })).getByRole('button', { name: 'Anzeigen' }));
    expect(screen.getByRole('dialog', { name: 'Tastenkürzel' })).toBeInTheDocument();
  });
});
