import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StudioDocument } from '@studio/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetBrowser } from '../src/renderer/components/assets/AssetBrowser.tsx';
import { ComposerEditor } from '../src/renderer/components/composer/ComposerEditor.tsx';
import { Header } from '../src/renderer/components/workspace/Header.tsx';
import { assetUsage, assetUsageMap } from '../src/renderer/lib/assets.ts';
import { REF_MIME } from '../src/renderer/lib/dnd.ts';
import { LayoutProvider, type WorkspaceLayout } from '../src/renderer/lib/layout.ts';
import { DEMO_CANVAS_PATH, DEMO_DECK_PATH, DEMO_VIDEO_ID, DEMO_VIDEO_PATH, makeDataTransfer, renderStudio, setupStudio } from './helpers.tsx';

/** Alle sichtbaren Karten (über alle Gruppen; eingeklappte Gruppen rendern keine Karten). */
function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.assets [data-asset-id]')];
}

function titles(): string[] {
  return cards().map((c) => c.querySelector('.asset-title')?.textContent ?? '');
}

function card(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-asset-id="${id}"]`)!;
}

function count(): string {
  return document.querySelector('.assets-count')?.textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
});

describe('Asset-Leiste', () => {
  it('gruppiert nach Verwendung; Karten zeigen Meta (Modell · Preis), Verwendungsorte und den Daylight-Ring im Composer', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    expect(screen.getByRole('region', { name: 'Asset-Browser' })).toBeInTheDocument();
    expect(count()).toBe('18');
    // Gruppen mit Overline und Anzahl; „Verworfen“ ist standardmäßig eingeklappt
    const used = screen.getByRole('button', { name: /^In Verwendung/ });
    expect(used).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Ungenutzt/ })).toHaveAttribute('aria-expanded', 'true');
    const rejected = screen.getByRole('button', { name: /^Verworfen\s*1$/ });
    expect(rejected).toHaveAttribute('aria-expanded', 'false');
    expect(titles()).not.toContain('Testshot Regen');

    // Meta in der UI-Schrift, nur Zahlen in Mono; kein Status-Chip mehr
    const mira = card('ast_char_mira');
    expect(mira.querySelector('.asset-meta')).toHaveTextContent(/nano-banana-pro · \$0\.16/i);
    expect(mira.querySelector('.asset-meta .mono')).toHaveTextContent('$0.16');
    expect(mira.querySelector('.status-chip')).toBeNull();
    // Verwendungsorte als Etiketten auf dem Bild (Spur-IDs)
    expect(card('ast_sb_02').querySelector('.media-usage')).toHaveTextContent('V1');
    expect(card('ast_whoosh').querySelector('.media-usage')).toHaveTextContent('A3');
    expect(card('ast_whoosh').querySelector('.media-duration')).toBeInTheDocument();
    expect(mira.querySelector('.media-usage')).toBeNull();

    // Verworfen aufklappen: Meta „verworfen“, Bild gedimmt
    await userEvent.click(rejected);
    const regen = card('ast_clip_rejected');
    expect(regen).toHaveClass('is-rejected');
    expect(regen.querySelector('.asset-meta')).toHaveTextContent('verworfen');

    // Im Composer referenziert: Daylight-Ring (Klasse) und eigene Gruppe „Im Composer“, ohne Tag
    act(() => void studio.store.getState().insertRef({ kind: 'asset', assetId: 'ast_char_mira' }));
    expect(card('ast_char_mira')).toHaveClass('is-ref');
    const group = screen.getByRole('list', { name: 'Im Composer' });
    expect(within(group).getAllByRole('listitem').map((c) => c.dataset.assetId)).toEqual(['ast_char_mira']);
    expect(card('ast_char_mira')).not.toHaveTextContent('Composer');
  });

  it('Typ-Tabs (mit „Mehr“), Filter-Popover mit Status, Quelle, Modell und Sortierung, Pills und Volltext', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const user = userEvent.setup();

    // Typ-Tabs: nur vorhandene Typen; ein Typ zur Zeit, erneuter Klick zurück zu „Alle“
    const tabs = screen.getByRole('group', { name: 'Typ' });
    expect(within(tabs).getByRole('button', { name: 'Alle' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(tabs).getByRole('button', { name: 'Audio' }));
    expect(titles().sort()).toEqual(['Gesang (Stem)', 'Nachtfahrt (Demo-Mix)', 'Whoosh Tunnel']);
    expect(count()).toBe('3 von 18');
    await user.click(within(tabs).getByRole('button', { name: 'Audio' }));
    expect(count()).toBe('18');
    // Übrige Typen unter „Mehr“; der gewählte Typ steht dann im Knopf
    await user.click(within(tabs).getByRole('button', { name: /Mehr/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Code' }));
    expect(titles()).toEqual(['PaperRoto.tsx']);
    expect(within(tabs).getByRole('button', { name: /Code/ })).toHaveClass('is-on');
    await user.click(within(tabs).getByRole('button', { name: 'Alle' }));

    // Filter liegen im Popover; aktive Filter: Punkt am Knopf und entfernbare Pills unter den Tabs
    expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'rejected');
    expect(titles()).toEqual(['Testshot Regen']);
    expect(screen.getByRole('button', { name: 'Filter (aktiv)' }).querySelector('.assets-filter-dot')).not.toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'linked');
    expect(titles()).toEqual(['Label-Logo']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'all');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Quelle' }), 'director');
    expect(titles()).toEqual(['PaperRoto.tsx']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Modell' }), 'minimax/h3-max/text-to-video');
    expect(titles()).toEqual([]);
    expect(screen.getByText('Keine Assets für diese Filter.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull();
    // Pills: „Quelle: Director“ und „Modell: …“; × entfernt den Filter
    await user.click(screen.getByRole('button', { name: 'Quelle: Director entfernen' }));
    expect(titles()).toEqual(['Testshot Tunnelfahrt']);
    await user.click(screen.getByRole('button', { name: /^Modell: .* entfernen$/ }));
    expect(count()).toBe('18');
    expect(screen.getByRole('button', { name: 'Filter' }).querySelector('.assets-filter-dot')).toBeNull();

    await user.type(screen.getByRole('searchbox', { name: /Assets durchsuchen/ }), 'tunnel');
    await waitFor(() => expect(titles().sort()).toEqual(['Storyboard 03 – Tunnel', 'Testshot Tunnelfahrt', 'Whoosh Tunnel']));
    await user.clear(screen.getByRole('searchbox', { name: /Assets durchsuchen/ }));
    await user.type(screen.getByRole('searchbox', { name: /Assets durchsuchen/ }), 'xyz');
    expect(await screen.findByText('Keine Treffer für „xyz“')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(screen.getByRole('searchbox', { name: /Assets durchsuchen/ })).toHaveValue('');

    // Sortierung nach Kosten (ohne Gruppen, damit die Reihenfolge durchgeht); Gruppierung wird gespeichert
    await user.click(screen.getByRole('button', { name: 'Gruppieren' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Keine' }));
    expect(localStorage.getItem('director-studio.assets.groupBy')).toBe('none');
    expect(screen.queryByRole('button', { name: /^In Verwendung/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sortierung' }), 'cost');
    await waitFor(() => expect(titles()[0]).toBe('Testshot Tunnelfahrt'));
    expect(titles()[1]).toBe('Testshot Regen');
    expect(screen.getByText('Sortierung: Kosten')).toBeInTheDocument();

    // Gruppierung nach Typ: Gruppenköpfe je Typ
    await user.click(screen.getByRole('button', { name: 'Gruppieren' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Typ' }));
    expect(screen.getByRole('list', { name: 'Audio' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Schrift' })).toBeInTheDocument();
  });

  it('Ansicht: Raster oder Liste (gespeichert); Listenzeilen tragen die Verwendungsorte rechts', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const { unmount } = renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    expect(card('ast_sb_02')).toHaveClass('is-grid');
    await userEvent.click(screen.getByRole('button', { name: 'Als Liste zeigen' }));
    expect(card('ast_sb_02')).toHaveClass('is-list');
    expect(card('ast_sb_02').querySelector('.asset-usage-list')).toHaveTextContent('V1');
    expect(localStorage.getItem('director-studio.assets.view')).toBe('list');
    unmount();
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    expect(card('ast_sb_02')).toHaveClass('is-list');
    // Zurück zum Raster entspricht hier der Automatik → wieder „auto“
    await userEvent.click(screen.getByRole('button', { name: 'Als Raster zeigen' }));
    expect(card('ast_sb_02')).toHaveClass('is-grid');
    expect(localStorage.getItem('director-studio.assets.view')).toBe('auto');
  });

  it('Drag & Drop einer Karte in den Composer fügt einen Asset-Chip ein', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(
      <>
        <ComposerEditor onSubmit={() => undefined} />
        <AssetBrowser searchDelayMs={0} />
      </>,
      studio,
    );
    const dt = makeDataTransfer();
    fireEvent.dragStart(card('ast_char_mira'), { dataTransfer: dt });
    expect(dt.types).toContain(REF_MIME);
    const editor = screen.getByTestId('composer-editor');
    fireEvent.dragOver(editor, { dataTransfer: dt });
    fireEvent.drop(editor, { dataTransfer: dt });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'asset', assetId: 'ast_char_mira' } }]);
    // Asset-Chips: Thumb und Titel, keine Nummer (DESIGN.md §7.7.2)
    const chip = editor.querySelector('.chip')!;
    expect(chip.querySelector('.chip-label')).toHaveTextContent('Mira – Charakterblatt v3');
    expect(chip.querySelector('.n')).toBeNull();
    expect(card('ast_char_mira')).toHaveClass('is-ref');
  });

  it('Dateien vom Desktop in den Composer werden verknüpft (importFiles „link“) und als Chips eingefügt', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const importFiles = vi.spyOn(studio.api, 'importFiles');
    renderStudio(
      <>
        <ComposerEditor onSubmit={() => undefined} />
        <AssetBrowser searchDelayMs={0} />
      </>,
      studio,
    );
    const dt = makeDataTransfer([new File(['x'], 'Referenz Hafen.jpg', { type: 'image/jpeg' })]);
    fireEvent.drop(screen.getByTestId('composer-editor'), { dataTransfer: dt });
    await waitFor(() => expect(studio.store.getState().composer).toHaveLength(1));
    expect(importFiles).toHaveBeenCalledWith(DEMO_VIDEO_ID, ['Referenz Hafen.jpg'], 'link');
    expect(screen.getByTestId('composer-editor').querySelector('.chip .chip-label')).toHaveTextContent('Referenz Hafen');
    await waitFor(() => expect(count()).toBe('19'));
  });

  it('Dateien über dem Fenster: Overlay nur beim Ziehen; Ablage auf der Leiste verknüpft, ohne Chips zu setzen', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const importFiles = vi.spyOn(studio.api, 'importFiles');
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const region = screen.getByRole('region', { name: 'Asset-Browser' });
    expect(region.querySelector('.assets-drop')).toBeNull();
    // Fußzeile erklärt das Verknüpfen dauerhaft (32 px), die Drop-Fläche erscheint erst beim Ziehen
    expect(region.querySelector('.assets-foot')).toHaveTextContent('Dateien hierher ziehen – sie werden verknüpft, nicht hochgeladen.');

    const dt = makeDataTransfer([new File(['x'], 'Interview.wav', { type: 'audio/wav' })]);
    fireEvent.dragEnter(document.body, { dataTransfer: dt });
    expect(region.querySelector('.assets-drop')).toHaveTextContent('Loslassen zum Verknüpfen');
    fireEvent.dragOver(region, { dataTransfer: dt });
    expect(region.querySelector('.assets-drop')).toHaveClass('is-over');
    fireEvent.drop(region, { dataTransfer: dt });
    expect(region.querySelector('.assets-drop')).toBeNull();
    await waitFor(() => expect(importFiles).toHaveBeenCalledWith(DEMO_VIDEO_ID, ['Interview.wav'], 'link'));
    await waitFor(() => expect(count()).toBe('19'));
    expect(studio.store.getState().composer).toEqual([]);
    expect(studio.store.getState().toasts.at(-1)).toMatchObject({ kind: 'success' });

    // Ziehen abgebrochen (Fenster verlassen): Overlay verschwindet
    fireEvent.dragEnter(document.body, { dataTransfer: dt });
    expect(region.querySelector('.assets-drop')).not.toBeNull();
    fireEvent.dragLeave(document.body, { dataTransfer: dt });
    expect(region.querySelector('.assets-drop')).toBeNull();
  });

  it('Doppelklick und „In den Composer“ (mit Duplikatschutz), mod+Enter auf der Karte; Detailansicht mit Verwendungen, Herkunft und „Im Explorer zeigen“', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const reveal = vi.spyOn(studio.api, 'revealAsset');
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const user = userEvent.setup();
    const sb02 = card('ast_sb_02');
    await user.dblClick(sb02);
    expect(studio.store.getState().composer.filter((s) => s.type === 'ref')).toHaveLength(1);
    // Duplikatschutz gilt auch für Assets (DESIGN.md §9.3): nichts einfügen, stattdessen blitzen und ansagen
    await user.click(within(card('ast_sb_02')).getByRole('button', { name: 'In den Composer' }));
    expect(studio.store.getState().composer.filter((s) => s.type === 'ref')).toHaveLength(1);
    expect(studio.store.getState().flash?.key).toBe('asset:ast_sb_02');
    expect(studio.store.getState().announcement).toBe('Storyboard 02 – Mira ist bereits referenziert');
    // mod+Enter auf der fokussierten Karte (jsdom: kein Mac → Strg)
    within(card('ast_sb_01')).getByRole('button', { name: /Details/ }).focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(studio.store.getState().composer.filter((s) => s.type === 'ref')).toHaveLength(2);
    // Doppelklick hat die Detailansicht geöffnet und wieder geschlossen
    expect(screen.queryByRole('complementary')).toBeNull();

    await user.click(within(card('ast_sb_02')).getByRole('button', { name: /Storyboard 02 – Mira – Details/ }));
    expect(card('ast_sb_02')).toHaveClass('is-selected');
    const drawer = screen.getByRole('complementary', { name: 'Details: Storyboard 02 – Mira' });
    expect(drawer).toHaveTextContent('Mira am Steuer');
    expect(drawer).toHaveTextContent('fal-ai/nano-banana-pro');
    // Verwendungen: Spur V1 und „Im Composer referenziert“
    expect(drawer.querySelector('.asset-usages')).toHaveTextContent('Im Composer referenziert');
    expect(drawer.querySelector('.asset-usages')).toHaveTextContent('V1');
    // Eltern-Asset (Eingabe der Generierung) anklickbar – Herkunft kommt asynchron über api.getLineage
    await user.click(await within(drawer).findByRole('button', { name: /Mira – Charakterblatt v3/ }));
    const parentDrawer = screen.getByRole('complementary', { name: 'Details: Mira – Charakterblatt v3' });
    expect((await within(parentDrawer).findAllByRole('button', { name: /Storyboard 0\d/ })).length).toBe(6);
    expect(parentDrawer.querySelector('.asset-usages')).toBeNull();
    expect(parentDrawer).toHaveTextContent('Noch nicht im Dokument.');
    await user.click(within(parentDrawer).getByRole('button', { name: 'Im Explorer zeigen' }));
    expect(reveal).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'ast_char_mira');

    // Esc schließt und gibt den Fokus an die Karte zurück
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(within(card('ast_char_mira')).getByRole('button', { name: /Details/ })).toHaveFocus();
    // Klick daneben schließt ebenfalls
    await user.click(within(card('ast_sb_03')).getByRole('button', { name: /Details/ }));
    expect(screen.getByRole('complementary', { name: 'Details: Storyboard 03 – Tunnel' })).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('Fehlende Datei: Karte zeigt „Datei fehlt · Neu zuordnen“; der Klick startet das Neu-Zuordnen', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    studio.api.debug.setLinkedMissing(DEMO_VIDEO_ID, 'ast_logo');
    const relink = vi.spyOn(studio.store.getState(), 'relinkAsset');
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const logo = card('ast_logo');
    expect(logo).toHaveClass('is-missing');
    await userEvent.click(within(logo).getByRole('button', { name: 'Datei fehlt · Neu zuordnen' }));
    expect(relink).toHaveBeenCalledWith('ast_logo');
  });

  it('„+“-Menü: Dateien importieren bzw. verknüpfen; Live-Updates über asset-Ereignisse', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const importFiles = vi.spyOn(studio.api, 'importFiles');
    studio.api.debug.setNextFiles(['/Users/demo/Material/Skript.md']);
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Dateien hinzufügen' }));
    expect(screen.getByRole('menuitem', { name: 'Dateien verknüpfen …' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Dateien importieren …' }));
    await waitFor(() => expect(importFiles).toHaveBeenCalledWith(DEMO_VIDEO_ID, ['/Users/demo/Material/Skript.md'], 'import'));
    await waitFor(() => expect(count()).toBe('19'));
    act(() =>
      studio.api.debug.emit({
        type: 'asset',
        projectId: DEMO_VIDEO_ID,
        asset: { id: 'ast_live', kind: 'image', title: 'Live-Asset', tags: [], status: 'active', source: 'generated', createdAt: new Date().toISOString() },
      }),
    );
    expect(await screen.findByText('Live-Asset')).toBeInTheDocument();
  });

  it('Zeigen eines Asset-Chips macht die Karte sichtbar (Filter weg, Gruppe auf); Tastatur: Enter öffnet die Details mit Fokus, mod+K sucht', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const user = userEvent.setup();
    // Verworfenes Asset in eingeklappter Gruppe und zusätzlich ausgefiltert (Typ Audio)
    await user.click(within(screen.getByRole('group', { name: 'Typ' })).getByRole('button', { name: 'Audio' }));
    expect(document.querySelector('[data-asset-id="ast_clip_rejected"]')).toBeNull();
    act(() => studio.store.getState().revealRef({ kind: 'asset', assetId: 'ast_clip_rejected' }));
    await waitFor(() => expect(card('ast_clip_rejected')).toHaveClass('is-flash'));
    expect(within(screen.getByRole('group', { name: 'Typ' })).getByRole('button', { name: 'Alle' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Verworfen/ })).toHaveAttribute('aria-expanded', 'true');

    // Enter auf der Karte: Details öffnen und den Fokus hineinsetzen
    within(card('ast_sb_04')).getByRole('button', { name: /Details/ }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('complementary', { name: 'Details: Storyboard 04 – Lichter' })).toHaveFocus();

    // mod+K (jsdom: Strg) fokussiert die Suche
    await user.keyboard('{Escape}');
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('searchbox', { name: /Assets durchsuchen/ })).toHaveFocus();
  });

  it('Leerzustand ohne Assets', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    act(() => studio.store.setState({ assets: [] }));
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    expect(screen.getByText('Noch keine Assets')).toBeInTheDocument();
    expect(screen.getByText(/Der Director legt hier alles ab/)).toBeInTheDocument();
  });
});

describe('assetUsage (lib/assets.ts)', () => {
  it('Timeline: Spur-IDs der Clips (auch Asset-Referenzen in props), ohne Duplikate', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const doc = studio.store.getState().document;
    expect(assetUsage(doc, 'ast_sb_02')).toEqual(['V1']);
    expect(assetUsage(doc, 'ast_song')).toEqual(['A2']);
    expect(assetUsage(doc, 'ast_whoosh')).toEqual(['A3']);
    expect(assetUsage(doc, 'ast_char_mira')).toEqual([]);
    expect(assetUsage(null, 'ast_song')).toEqual([]);
  });

  it('Deck: F{n} für Folien mit Element oder Hintergrund', async () => {
    const studio = await setupStudio({ project: DEMO_DECK_PATH });
    const doc = studio.store.getState().document!;
    if (doc.kind !== 'deck') throw new Error('Deck erwartet');
    const n = doc.slides.findIndex((s) => s.elements.some((e) => e.assetId === 'ast_deck_hero')) + 1;
    expect(assetUsage(doc, 'ast_deck_hero')).toEqual([`F${n}`]);
    const withBackground = { ...doc, slides: doc.slides.map((s, i) => (i === 0 ? { ...s, background: { assetId: 'ast_deck_hero' } } : s)) } as StudioDocument;
    expect(assetUsage(withBackground, 'ast_deck_hero')).toEqual(['F1', `F${n}`]);
  });

  it('Leinwand: Ebenennamen; Site: Seitenpfade aus den Mockups', async () => {
    const studio = await setupStudio({ project: DEMO_CANVAS_PATH });
    expect(assetUsage(studio.store.getState().document, 'ast_poster_flowers')).toEqual(['Collage Blumen']);
    const site = {
      kind: 'site',
      pages: [
        { id: 'home', path: '/', title: 'Start', mockups: { desktop: 'ast_a', mobile: 'ast_b' } },
        { id: 'about', path: '/about', title: 'Über uns', mockups: { desktop: 'ast_a' } },
      ],
    } as unknown as StudioDocument;
    const map = assetUsageMap(site);
    expect(map.get('ast_a')).toEqual(['/', '/about']);
    expect(map.get('ast_b')).toEqual(['/']);
  });
});

/** Layout-Kontext mit fester Director-Breite (nur die Felder, die die Kopfzeile liest). */
function layoutWith(sideR: number): WorkspaceLayout {
  return { sideR, collapsed: { assets: false, director: false, stage: false }, setCollapsed: () => undefined } as unknown as WorkspaceLayout;
}

/** Breiten in jsdom vorgeben: je Klasse eine Breite (getBoundingClientRect, clientWidth, scrollWidth). */
function mockWidths(widthOf: (el: HTMLElement, prop: 'rect' | 'client' | 'scroll') => number | undefined) {
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = widthOf(this, 'rect') ?? 0;
    return { width, height: 0, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, toJSON: () => ({}) } as DOMRect;
  });
  const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return widthOf(this, 'client') ?? 0;
  });
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return widthOf(this, 'scroll') ?? 0;
  });
  return () => {
    rect.mockRestore();
    client.mockRestore();
    scroll.mockRestore();
  };
}

describe('Kopfzeile (DESIGN.md §7.2)', () => {
  it('Zonen: Projekte-Knopf mit Bildmarke, Titel und Kategorie als ruhiger Text; Stepper mit aria-current und neutraler Pill', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Header />, studio);
    const header = document.querySelector('.app-header')!;
    expect(header.querySelectorAll(':scope > .hdr-zone')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Projekte' }).querySelector('.brand-mark-svg')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Musikvideo „Nachtfahrt“');
    expect(header.querySelector('.badge-category')).toHaveTextContent('Video');
    // Das Phasen-Badge entfällt (die Phase steckt im Stepper)
    expect(header).not.toHaveTextContent('Planung');

    const steps = screen.getByRole('list', { name: 'Checkpoints' });
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveClass('is-current');
    // Kein Status ohne Lauf; „in Arbeit“, solange der Director läuft; „zur Freigabe“, wenn vorgelegt
    expect(items[0]!.querySelector('.step-pill')).toBeNull();
    act(() => studio.store.setState({ runState: 'running' }));
    expect(items[0]!.querySelector('.step-pill')).toHaveTextContent('in Arbeit');
    const [first, ...rest] = studio.store.getState().checkpoints;
    act(() => studio.store.setState({ runState: 'idle', checkpoints: [{ ...first!, status: 'approved' }, { ...rest[0]!, status: 'proposed' }, ...rest.slice(1)] }));
    const now = within(screen.getByRole('list', { name: 'Checkpoints' })).getAllByRole('listitem');
    expect(now[0]).toHaveClass('step-approved');
    expect(now[0]!.querySelector('.step-index svg')).not.toBeNull();
    expect(now[1]).toHaveAttribute('aria-current', 'step');
    expect(now[1]!.querySelector('.step-pill')).toHaveTextContent('zur Freigabe');
    expect(document.querySelectorAll('.step-approved')).toHaveLength(1);

    // Klick auf einen Schritt: ohne offene Entscheidung im Dock (hier kein Director gerendert) scrollt der Verlauf zur
    // Systemzeile dieses Checkpoints; der Schritt wird angesagt. Den Weg ins Dock deckt wiring.test.tsx ab.
    const line = document.createElement('p');
    line.dataset.sys = `cp-pinned:${rest[0]!.id}`;
    const scrolled = vi.fn();
    line.scrollIntoView = scrolled;
    document.body.appendChild(line);
    await userEvent.click(within(now[1]!).getByRole('button'));
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(studio.store.getState().announcement).toContain(rest[0]!.title);
    line.remove();

    await userEvent.click(screen.getByRole('button', { name: 'Projekte' }));
    expect(studio.store.getState().screen).toBe('start');
  });

  it('Budget-Knopf mit Meter und Betrag öffnet das Popover mit der Aufschlüsselung; Versionen „v2 · Ansicht“', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Header />, studio);
    const user = userEvent.setup();
    const budget = screen.getByRole('button', { name: /^Budget: \$\d+\.\d\d von \$\d+\.\d\d$/ });
    expect(budget.querySelector('.budget-bar')).not.toBeNull();
    expect(budget.querySelector('.hdr-budget-total')).toBeInTheDocument();
    await user.click(budget);
    const pop = screen.getByRole('dialog', { name: 'Budget' });
    expect(pop).toHaveTextContent('fal-Modelle');
    expect(pop).toHaveTextContent('verfügbar');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Budget' })).toBeNull();

    // Über 85 % des freigegebenen Budgets: Warnfarbe; darüber hinaus: Gefahr
    const b = studio.store.getState().budget!;
    act(() => studio.store.setState({ budget: { ...b, spentUsd: b.approvedUsd * 0.9, reservedUsd: 0 } }));
    expect(screen.getByRole('button', { name: /^Budget:/ })).toHaveClass('is-warn');
    act(() => studio.store.setState({ budget: { ...b, spentUsd: b.approvedUsd + 1, reservedUsd: 0 } }));
    expect(screen.getByRole('button', { name: /^Budget:/ })).toHaveClass('is-over');

    await user.click(screen.getByRole('button', { name: 'Versionen: v3' }));
    await user.click(screen.getByRole('button', { name: 'Ansehen v2' }));
    const old = await screen.findByRole('button', { name: 'Versionen: v2' });
    expect(old).toHaveClass('is-old');
    expect(old).toHaveTextContent('v2· Ansicht');
  });

  it('rechte Zone klappt unter 360 px Director-Breite stufenweise ein: Exportieren als Icon, ohne Balken, ohne Gesamtbetrag', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    // Natürliche Breite der Aktionen je Stufe (Stufe 0 … 3)
    const actionWidths = [430, 360, 290, 240];
    const restore = mockWidths((el, prop) => {
      if (prop === 'rect' && el.classList.contains('hdr-actions-in')) return actionWidths[Number(/hdr-l(\d)/.exec(el.className)?.[1] ?? 0)];
      return undefined;
    });
    try {
      const { unmount } = renderStudio(
        <LayoutProvider value={layoutWith(328)}>
          <Header />
        </LayoutProvider>,
        studio,
      );
      // 290 + 28 ≤ 328 → Stufe 2
      expect(document.querySelector('.hdr-actions-in')).toHaveClass('hdr-l2');
      const exportBtn = screen.getByRole('button', { name: 'Exportieren' });
      expect(exportBtn).toHaveClass('is-icon');
      expect(exportBtn).not.toHaveTextContent('Exportieren');
      const budget = screen.getByRole('button', { name: /^Budget:/ });
      expect(budget.querySelector('.budget-bar')).toBeNull();
      expect(budget.querySelector('.hdr-budget-total')).toBeInTheDocument();
      unmount();

      // Breiter Director (≥ 360 px): alles steht da, auch wenn die Zone dafür in die Mitte wächst
      renderStudio(
        <LayoutProvider value={layoutWith(368)}>
          <Header />
        </LayoutProvider>,
        studio,
      );
      expect(document.querySelector('.hdr-actions-in')).toHaveClass('hdr-l0');
      expect(screen.getByRole('button', { name: 'Exportieren' })).toHaveTextContent('Exportieren');
    } finally {
      restore();
    }
  });

  it('Stepper klappt stufenweise ein; das aktuelle Label bleibt sichtbar, ausgeblendete stehen im Tooltip', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const [first, ...rest] = studio.store.getState().checkpoints;
    act(() => studio.store.setState({ checkpoints: [{ ...first!, status: 'approved' }, ...rest] }));
    // Natürliche Breite der Liste je Stufe; die Zone ist 300 px breit
    const listWidths = [600, 480, 260, 150];
    const restore = mockWidths((el, prop) => {
      if (el.classList.contains('hdr-steps')) return 300;
      if (prop === 'scroll' && el.classList.contains('steps')) return listWidths[Number(/steps-l(\d)/.exec(el.className)?.[1] ?? 0)];
      return undefined;
    });
    try {
      renderStudio(<Header />, studio);
      const list = screen.getByRole('list', { name: 'Checkpoints' });
      expect(list).toHaveClass('steps-l2');
      const items = within(list).getAllByRole('listitem');
      // Erledigt und offen: Label nur noch für Screenreader; aktuell: sichtbar
      expect(items[0]!.querySelector('.step-title')).toHaveClass('sr-only');
      expect(items[2]!.querySelector('.step-title')).toHaveClass('sr-only');
      expect(items[1]!.querySelector('.step-title')).not.toHaveClass('sr-only');
      expect(items[1]).toHaveAttribute('aria-current', 'step');
      expect(items[0]).toHaveClass('is-compact');
      // Tooltip mit dem ausgeblendeten Label
      fireEvent.pointerEnter(within(items[0]!).getByRole('button'));
      expect(await screen.findByRole('tooltip')).toHaveTextContent(`${first!.title} · freigegeben`);
    } finally {
      restore();
    }
  });
});
