import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refLabel, type Asset, type Ref, type StudioApi, type StudioEvent } from '@studio/core';
import { App } from '../src/renderer/App.tsx';
import { AssetBrowser } from '../src/renderer/components/assets/AssetBrowser.tsx';
import { ComposerEditor } from '../src/renderer/components/composer/ComposerEditor.tsx';
import { Monitor } from '../src/renderer/components/monitor/Monitor.tsx';
import { Stage } from '../src/renderer/components/stage/Stage.tsx';
import { FakeStudioApi } from '../src/renderer/fake/FakeStudioApi.ts';
import { probeLinkedFile } from '../src/renderer/lib/assets.ts';
import { refChipLabel, refChipTitle } from '../src/renderer/lib/labels.ts';
import { PICK_MESSAGE } from '../src/renderer/lib/previewMessages.ts';
import { createStudioStore, type StudioStore } from '../src/renderer/state/store.ts';
import { DEMO_VIDEO_ID, DEMO_VIDEO_PATH, DEMO_WEB_PATH, renderStudio, setupStudio } from './helpers.tsx';

/**
 * Übernahme der Vertragsänderungen (A: ProjectSnapshot/StudioApi/AuthStatus, B: Element-Referenzen mit Text/Tag)
 * in UI und Fake-Backend.
 */

/** „Electron“-API: Methoden des Fakes ohne `isFake`-Markierung (apiMode = electron), einzelne Methoden ersetzbar. */
function electronApi(fake: FakeStudioApi, overrides: Partial<StudioApi> = {}): StudioApi {
  const bound = Object.fromEntries(
    Object.getOwnPropertyNames(Object.getPrototypeOf(fake))
      .filter((k) => k !== 'constructor')
      .map((k) => [k, (fake as unknown as Record<string, (...a: unknown[]) => unknown>)[k]!.bind(fake)]),
  );
  return { ...bound, ...overrides } as unknown as StudioApi;
}

async function setupElectron(path: string, overrides: Partial<StudioApi> = {}): Promise<{ fake: FakeStudioApi; api: StudioApi; store: StudioStore }> {
  const fake = new FakeStudioApi({ delayMs: 0 });
  const api = electronApi(fake, overrides);
  const store = createStudioStore(api);
  await store.getState().init();
  if (!(await store.getState().openProject(path))) throw new Error(`Projekt ${path} ließ sich nicht öffnen`);
  return { fake, api, store };
}

const studioAssetUrl = (projectId: string, assetId: string, variant: 'original' | 'proxy' | 'thumb' = 'original') =>
  `studio-asset://${projectId}/${assetId}${variant === 'original' ? '' : `?v=${variant}`}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Vertrag A: Projekt ohne Dokument', () => {
  it('Fake-Snapshot liefert `document: null` und nach der Kategorie ein Dokument', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const snap = await api.createProject({ title: 'Offen', category: null });
    expect(snap.document).toBeNull();
    expect(snap.usedAssetIds).toEqual([]);
    expect(snap.versions).toEqual([]);
  });

  it('Bühne zeigt den Planungs-Platzhalter, Monitor einen Hinweis', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const snap = await api.createProject({ title: 'Offen', category: null });
    const store = createStudioStore(api);
    store.getState().loadSnapshot(snap);
    renderStudio(
      <>
        <Monitor />
        <Stage />
      </>,
      { api, store },
    );
    const placeholder = screen.getByTestId('stage-planning');
    expect(placeholder).toHaveAttribute('role', 'status');
    expect(placeholder).toHaveTextContent('Kategorie wird im Planungsgespräch festgelegt');
    expect(screen.getByText('Noch kein Dokument – die Kategorie wird im Planungsgespräch festgelegt.')).toBeInTheDocument();
  });
});

describe('Vertrag A: Herkunft über api.getLineage', () => {
  it('Fake liefert Lineage-Kanten mit Relation', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const mira = await api.getLineage(DEMO_VIDEO_ID, 'ast_char_mira');
    expect(mira.children).toHaveLength(6);
    expect(mira.children.every((e) => e.parentId === 'ast_char_mira' && e.relation === 'input')).toBe(true);
    expect(await api.getLineage(DEMO_VIDEO_ID, 'ast_beats')).toEqual({ parents: [{ parentId: 'ast_song', childId: 'ast_beats', relation: 'derived' }], children: [] });
    expect((await api.getLineage(DEMO_VIDEO_ID, 'ast_vocals')).parents).toEqual([{ parentId: 'ast_song', childId: 'ast_vocals', relation: 'input' }]);
    await expect(api.getLineage(DEMO_VIDEO_ID, 'ast_gibtsnicht')).rejects.toThrow('Unbekanntes Asset');
  });

  it('Drawer lädt die Herkunft über getLineage, zeigt die Relation und lädt bei neuen Assets nach', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const lineage = vi.spyOn(studio.api, 'getLineage');
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Beat-Analyse Nachtfahrt – Details' }));
    const drawer = screen.getByRole('complementary', { name: 'Details: Beat-Analyse Nachtfahrt' });
    const parent = await within(drawer).findByRole('button', { name: /Nachtfahrt \(Demo-Mix\)/ });
    expect(parent.closest('li')).toHaveTextContent('abgeleitet');
    expect(lineage).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'ast_beats');

    // Neues Kind-Asset (z. B. aus einer Generierung) → Herkunft wird neu geladen
    const child: Asset = { id: 'ast_beats_v2', kind: 'data', title: 'Beat-Analyse v2', tags: [], status: 'active', source: 'derived', createdAt: new Date().toISOString(), metadata: { parentIds: ['ast_beats'] } };
    studio.api.debug.project(DEMO_VIDEO_ID).assets.push(child);
    act(() => studio.api.debug.emit({ type: 'asset', projectId: DEMO_VIDEO_ID, asset: child }));
    expect(await within(drawer).findByRole('button', { name: /Beat-Analyse v2/ })).toBeInTheDocument();
  });

  it('Fehler beim Laden der Herkunft erscheint im Drawer', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    vi.spyOn(studio.api, 'getLineage').mockRejectedValue(new Error('Index beschädigt'));
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    await userEvent.click(screen.getByRole('button', { name: 'Gesang (Stem) – Details' }));
    const drawer = screen.getByRole('complementary', { name: 'Details: Gesang (Stem)' });
    expect(await within(drawer).findByText('Herkunft konnte nicht geladen werden: Index beschädigt')).toBeInTheDocument();
  });
});

describe('Vertrag A: Erneut verknüpfen (chooseFiles + relinkAsset)', () => {
  it('Fake: relinkAsset prüft Inhalt, setzt den Pfad und hebt „fehlt“ auf', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const events: StudioEvent[] = [];
    api.onEvent((e) => events.push(e));
    const before = api.assetUrl(DEMO_VIDEO_ID, 'ast_logo', 'thumb');
    expect(api.debug.setLinkedMissing(DEMO_VIDEO_ID, 'ast_logo').metadata).toEqual({ missing: true });
    expect(api.assetUrl(DEMO_VIDEO_ID, 'ast_logo', 'thumb')).not.toBe(before);
    await expect(api.relinkAsset(DEMO_VIDEO_ID, 'ast_logo', '/Users/demo/Neu/label-logo.wav')).rejects.toThrow('anderen Inhalt');
    await expect(api.relinkAsset(DEMO_VIDEO_ID, 'ast_sb_01', '/Users/demo/Neu/sb.png')).rejects.toThrow('keine verknüpfte Datei');
    await expect(api.relinkAsset(DEMO_VIDEO_ID, 'ast_logo', '  ')).rejects.toThrow('Kein Dateipfad');
    const relinked = await api.relinkAsset(DEMO_VIDEO_ID, 'ast_logo', '/Users/demo/Neu/label-logo.png');
    expect(relinked).toMatchObject({ id: 'ast_logo', source: 'linked', path: '/Users/demo/Neu/label-logo.png' });
    expect(relinked.metadata).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: 'asset', projectId: DEMO_VIDEO_ID, asset: { id: 'ast_logo', path: '/Users/demo/Neu/label-logo.png' } });
    expect(api.assetUrl(DEMO_VIDEO_ID, 'ast_logo', 'thumb')).toBe(before);
    const snap = await api.getSnapshot(DEMO_VIDEO_ID);
    expect(snap.assets.find((a) => a.id === 'ast_logo')).toMatchObject({ path: '/Users/demo/Neu/label-logo.png' });
  });

  it('Drawer: fehlende Datei → „Erneut verknüpfen …“ wählt eine Datei und ruft relinkAsset auf', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    studio.api.debug.setLinkedMissing(DEMO_VIDEO_ID, 'ast_logo');
    const relink = vi.spyOn(studio.api, 'relinkAsset');
    const choose = vi.spyOn(studio.api, 'chooseFiles');
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const user = userEvent.setup();
    const card = () => document.querySelector<HTMLElement>('[data-asset-id="ast_logo"]')!;
    expect(card()).toHaveTextContent('Datei fehlt');
    await user.click(within(card()).getByRole('button', { name: 'Label-Logo – Details' }));
    const drawer = screen.getByRole('complementary', { name: 'Details: Label-Logo' });
    expect(within(drawer).getByRole('alert')).toHaveTextContent('Datei nicht gefunden – wurde sie verschoben oder umbenannt?');

    // Dateiauswahl abgebrochen → kein relinkAsset
    studio.api.debug.setNextFiles([]);
    await user.click(within(drawer).getByRole('button', { name: 'Erneut verknüpfen …' }));
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
    expect(relink).not.toHaveBeenCalled();

    // Andere Datei → Fehlermeldung, Hinweis bleibt
    studio.api.debug.setNextFiles(['/Users/demo/Neu/Interview.wav']);
    await user.click(within(drawer).getByRole('button', { name: 'Erneut verknüpfen …' }));
    await waitFor(() => expect(studio.store.getState().toasts.at(-1)).toMatchObject({ kind: 'error', text: 'Erneut verknüpfen fehlgeschlagen: Die neue Datei hat einen anderen Inhalt' }));
    expect(within(drawer).getByRole('alert')).toBeInTheDocument();

    // Richtige Datei → Pfad aktualisiert, Hinweis und Chip verschwinden
    studio.api.debug.setNextFiles(['/Users/demo/Neu/label-logo.png']);
    await user.click(within(drawer).getByRole('button', { name: 'Erneut verknüpfen …' }));
    await waitFor(() => expect(within(drawer).queryByRole('alert')).toBeNull());
    expect(relink).toHaveBeenLastCalledWith(DEMO_VIDEO_ID, 'ast_logo', '/Users/demo/Neu/label-logo.png');
    expect(choose).toHaveBeenCalledTimes(3);
    expect(drawer).toHaveTextContent('/Users/demo/Neu/label-logo.png');
    expect(card()).not.toHaveTextContent('Datei fehlt');
    expect(studio.store.getState().toasts.at(-1)).toMatchObject({ kind: 'success', text: '„Label-Logo“ ist wieder verknüpft.' });
  });

  it('Vorhandene verknüpfte und nicht verknüpfte Dateien zeigen keinen Hinweis', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Label-Logo – Details' }));
    expect(within(screen.getByRole('complementary', { name: 'Details: Label-Logo' })).queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Gesang (Stem) – Details' }));
    expect(within(screen.getByRole('complementary', { name: 'Details: Gesang (Stem)' })).queryByRole('button', { name: 'Erneut verknüpfen …' })).toBeNull();
  });

  it('Electron: fehlende Datei wird per HEAD-Anfrage auf die Asset-URL erkannt (404)', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => ({ status: url.endsWith('/ast_logo') && init?.method === 'HEAD' ? 404 : 200, ok: !url.endsWith('/ast_logo') }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const relink = vi.fn(async (_p: string, _a: string, newPath: string): Promise<Asset> => ({ id: 'ast_logo', kind: 'image', title: 'Label-Logo', tags: [], status: 'active', source: 'linked', path: newPath, createdAt: '2026-09-28T09:18:00.000Z' }));
    const { api, store, fake } = await setupElectron(DEMO_VIDEO_PATH, { assetUrl: studioAssetUrl, relinkAsset: relink });
    fake.debug.setNextFiles(['/Volumes/Neu/label-logo.png']);
    renderStudio(<AssetBrowser searchDelayMs={0} />, { api: api as never, store });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Label-Logo – Details' }));
    const drawer = screen.getByRole('complementary', { name: 'Details: Label-Logo' });
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('Datei nicht gefunden');
    expect(fetchMock).toHaveBeenCalledWith(`studio-asset://${DEMO_VIDEO_ID}/ast_logo`, expect.objectContaining({ method: 'HEAD' }));
    // Nach dem Neu-Verknüpfen antwortet die Asset-URL wieder → Hinweis weg
    fetchMock.mockImplementation(async () => ({ status: 200, ok: true }) as Response);
    await user.click(within(drawer).getByRole('button', { name: 'Erneut verknüpfen …' }));
    await waitFor(() => expect(within(drawer).queryByRole('alert')).toBeNull());
    expect(relink).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'ast_logo', '/Volumes/Neu/label-logo.png');
    expect(store.getState().assets.find((a) => a.id === 'ast_logo')?.path).toBe('/Volumes/Neu/label-logo.png');
  });

  it('probeLinkedFile: metadata.missing, HEAD-Status, nicht prüfbare URLs', async () => {
    const linked: Asset = { id: 'a', kind: 'image', title: 'x', tags: [], status: 'active', source: 'linked', createdAt: '2026-01-01T00:00:00.000Z' };
    const respond = (status: number) => vi.fn(async () => ({ status, ok: status >= 200 && status < 300 }) as Response);
    const url = 'studio-asset://p/a';
    const notFound = respond(404);
    expect(await probeLinkedFile({ ...linked, source: 'imported' }, url, notFound)).toBe('ok');
    expect(notFound).not.toHaveBeenCalled();
    expect(await probeLinkedFile({ ...linked, metadata: { missing: true } }, url, respond(200))).toBe('missing');
    expect(await probeLinkedFile(linked, 'data:image/svg+xml,x', notFound)).toBe('unknown');
    expect(await probeLinkedFile(linked, url, notFound)).toBe('missing');
    expect(notFound).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'HEAD' }));
    expect(await probeLinkedFile(linked, url, respond(200))).toBe('ok');
    expect(await probeLinkedFile(linked, url, respond(500))).toBe('unknown');
    expect(
      await probeLinkedFile(linked, url, async () => {
        throw new TypeError('blockiert');
      }),
    ).toBe('unknown');
  });
});

describe('Vertrag A: Web-Vorschau navigiert per previewNavigate', () => {
  it('Electron: Seitenkarte und Seitenauswahl im Monitor navigieren die native Vorschau', async () => {
    const navigate = vi.fn(async (_projectId: string, _path: string) => undefined);
    const { api, store } = await setupElectron(DEMO_WEB_PATH, { previewNavigate: navigate, previewSetBounds: async () => undefined });
    const projectId = store.getState().projectId!;
    renderStudio(
      <>
        <Monitor />
        <Stage />
      </>,
      { api: api as never, store },
    );
    const user = userEvent.setup();
    await waitFor(() => expect(store.getState().preview.status).toBe('ready'));
    await act(async () => undefined);
    // Direkt nach dem Öffnen steht die Vorschau auf „/“ – kein zusätzlicher Aufruf
    expect(navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Speisekarte/ }));
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(projectId, '/karte'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Seite' }), 'contact');
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(projectId, '/kontakt'));
    expect(store.getState().selectedPageId).toBe('contact');

    // Viewport-Wechsel öffnet die Vorschau neu (Startseite) → aktuelle Seite erneut ansteuern
    const count = navigate.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Mobil' }));
    await waitFor(() => expect(navigate.mock.calls.length).toBe(count + 1));
    expect(navigate).toHaveBeenLastCalledWith(projectId, '/kontakt');

    // Zurück zur Startseite navigiert ebenfalls
    await user.selectOptions(screen.getByRole('combobox', { name: 'Seite' }), 'home');
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(projectId, '/'));
  });

  it('Electron: Fehler beim Navigieren erscheinen als Meldung', async () => {
    const { api, store } = await setupElectron(DEMO_WEB_PATH, {
      previewNavigate: async () => {
        throw new Error('Die Web-Vorschau ist nicht geöffnet');
      },
      previewSetBounds: async () => undefined,
    });
    renderStudio(<Monitor />, { api: api as never, store });
    await waitFor(() => expect(store.getState().preview.status).toBe('ready'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Seite' }), 'menu');
    await waitFor(() => expect(store.getState().toasts.at(-1)).toMatchObject({ kind: 'error', text: 'Vorschau-Fehler: Die Web-Vorschau ist nicht geöffnet' }));
  });

  it('Browser-Modus: Seitenauswahl ändert den iframe-Hash, ohne previewNavigate', async () => {
    const studio = await setupStudio({ project: DEMO_WEB_PATH });
    const navigate = vi.spyOn(studio.api, 'previewNavigate');
    renderStudio(<Monitor />, studio);
    await waitFor(() => expect(document.querySelector('iframe.web-frame')).not.toBeNull());
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Seite' }), 'menu');
    await waitFor(() => expect(document.querySelector('iframe.web-frame')!.getAttribute('src')).toMatch(/#\/karte$/));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('Fake: previewNavigate akzeptiert nur Seitenpfade', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const snap = await api.openProject(DEMO_WEB_PATH);
    await expect(api.previewNavigate(snap.manifest.id, '/karte')).resolves.toBeUndefined();
    await expect(api.previewNavigate(snap.manifest.id, 'https://example.com/')).rejects.toThrow('Ungültiger Seitenpfad');
    await expect(api.previewNavigate(snap.manifest.id, '//example.com/x')).rejects.toThrow('Ungültiger Seitenpfad');
    expect(api.debug.calls.filter((c) => c.method === 'previewNavigate').map((c) => c.args[1])).toEqual(['/karte', 'https://example.com/', '//example.com/x']);
  });
});

describe('Vertrag A: Anthropic-Anmeldung (API-Key vs. Login-Profil)', () => {
  it('Fake meldet beide Wege getrennt', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    expect((await api.getAuthStatus()).anthropic).toEqual({ apiKey: true, oauthProfile: false });
    await api.setSecret('anthropic', null);
    expect(await api.getAuthStatus()).toMatchObject({ active: null, anthropic: { apiKey: false, oauthProfile: false } });
    api.debug.setAnthropicProfile(true);
    expect(await api.getAuthStatus()).toMatchObject({ active: 'anthropic', anthropic: { apiKey: false, oauthProfile: true } });
  });

  it('Einstellungen zeigen API-Key und Login getrennt; das Schlüsselfeld zählt nur den API-Key', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    render(<App api={api} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Einstellungen' }));
    const dialog = screen.getByRole('dialog', { name: 'Einstellungen' });
    await waitFor(() => expect(within(dialog).getByTestId('auth-anthropic-key')).toHaveTextContent('Anthropic-API-Key: hinterlegt'));
    expect(within(dialog).getByTestId('auth-anthropic-login')).toHaveTextContent('Anthropic-Login (ant auth login): nicht gefunden');
    const keyRow = within(dialog).getByLabelText(/Anthropic-API-Key/).closest('.secret-field') as HTMLElement;
    expect(keyRow).toHaveTextContent('eingerichtet');
    expect(keyRow).not.toHaveTextContent('nicht eingerichtet');

    // Nur noch das Login-Profil: Director verfügbar, Schlüsselfeld „nicht eingerichtet“
    api.debug.setAnthropicProfile(true);
    await user.click(within(keyRow).getByRole('button', { name: 'Schlüssel entfernen' }));
    await waitFor(() => expect(within(dialog).getByTestId('auth-anthropic-key')).toHaveTextContent('Anthropic-API-Key: nicht hinterlegt'));
    expect(within(dialog).getByTestId('auth-anthropic-login')).toHaveTextContent('Anthropic-Login (ant auth login): gefunden');
    expect(within(dialog).getByTestId('auth-status')).toHaveTextContent('Aktiver Director: Anthropic');
    expect(keyRow).toHaveTextContent('nicht eingerichtet');
    expect(within(dialog).queryByText(/ant auth login“ ausführen/)).toBeNull();

    // Weder Key noch Login → Hinweis auf „ant auth login“
    api.debug.setAnthropicProfile(false);
    await act(() => api.setSecret('anthropic', null));
    await user.click(within(keyRow).getByRole('button', { name: 'Schlüssel entfernen' }));
    expect(await within(dialog).findByText(/im Terminal „ant auth login“ ausführen/)).toBeInTheDocument();
  });
});

describe('Vertrag B: Element-Referenzen mit Text und Tag', () => {
  const site: Ref = {
    kind: 'element',
    doc: 'site',
    page: '/',
    selector: 'main > h1',
    elementId: 'hero-title',
    tag: 'h1',
    text: 'Guten Morgen aus der Rösterei',
    source: { file: 'src/pages/Home.tsx', line: 7, column: 7 },
  };

  it('Chip-Beschriftung nutzt Tag und Text, wenn die Element-ID keinen Namen hat', () => {
    const ctx = { names: { el_title: 'Titel' } };
    expect(refChipLabel(site, ctx)).toBe('◳ / · h1 „Guten Morgen aus der Rösterei“');
    expect(refChipTitle(site, ctx).split('\n')).toEqual(['◳ / · h1 „Guten Morgen aus der Rösterei“', '<h1> „Guten Morgen aus der Rösterei“', 'main > h1', 'src/pages/Home.tsx:7:7']);
    // Bekannter Elementname hat Vorrang
    const deck: Ref = { kind: 'element', doc: 'deck', slideId: 's1', elementId: 'el_title', tag: 'text', text: 'Q4-Zahlen' };
    expect(refChipLabel(deck, ctx)).toBe(refLabel(deck, ctx));
    expect(refChipLabel(deck, ctx)).toBe('◳ s1 · Titel');
    // Ohne Text unverändert wie refLabel; andere Referenzen: Tooltip = Beschriftung
    const plain: Ref = { kind: 'element', doc: 'site', page: '/', selector: 'main h1' };
    expect(refChipLabel(plain, ctx)).toBe(refLabel(plain, ctx));
    expect(refChipTitle({ kind: 'time', frame: 30 }, ctx)).toBe(refLabel({ kind: 'time', frame: 30 }, ctx));
  });

  it('Pick aus der Vorschau: Chip zeigt Tag und (gekürzten) Text, der Tooltip den vollen Text', async () => {
    const studio = await setupStudio({ project: DEMO_WEB_PATH });
    renderStudio(<ComposerEditor onSubmit={() => undefined} />, studio);
    const text = 'Frisch gerösteter Kaffee aus der Nachbarschaft, jeden Morgen ab sieben';
    act(() =>
      studio.api.debug.emit({
        type: 'preview_pick',
        projectId: studio.store.getState().projectId!,
        ref: { kind: 'element', doc: 'site', page: '/karte', selector: 'main > p', elementId: 'menu-intro', tag: 'p', text },
      }),
    );
    const chip = screen.getByTestId('composer-editor').querySelector('.chip')!;
    expect(chip.querySelector('.chip-label')!.textContent).toMatch(/^◳ \/karte · p „Frisch gerösteter Kaffee aus der .*…“$/);
    expect(chip.getAttribute('title')).toContain(`„${text}“`);
    expect(studio.store.getState().announcement).toContain('„Frisch gerösteter');
  });

  it('Browser-Modus: Klick in der Demo-Website liefert Text und Tag in der Referenz', async () => {
    const api = new FakeStudioApi({ delayMs: 0 });
    const events: StudioEvent[] = [];
    api.onEvent((e) => events.push(e));
    const snap = await api.openProject(DEMO_WEB_PATH);
    await api.previewOpen(snap.manifest.id, { viewport: 'desktop' });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: PICK_MESSAGE, page: '/', selector: 'main > h1', tag: 'H1', text: '  Guten   Morgen ', bbox: { x: 1.4, y: 2, width: 300, height: 40 } },
      }),
    );
    expect(events.find((e) => e.type === 'preview_pick')).toMatchObject({
      type: 'preview_pick',
      projectId: snap.manifest.id,
      ref: { kind: 'element', doc: 'site', page: '/', selector: 'main > h1', tag: 'h1', text: 'Guten Morgen', bbox: { x: 1, y: 2, width: 300, height: 40 } },
    });
    api.dispose();
  });
});
