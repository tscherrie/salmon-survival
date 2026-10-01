import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssetBrowser } from '../src/renderer/components/assets/AssetBrowser.tsx';
import { ComposerEditor } from '../src/renderer/components/composer/ComposerEditor.tsx';
import { REF_MIME } from '../src/renderer/lib/dnd.ts';
import { DEMO_VIDEO_ID, DEMO_VIDEO_PATH, makeDataTransfer, renderStudio, setupStudio } from './helpers.tsx';

function cards(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Asset-Browser' })).queryAllByRole('listitem');
}

function titles(): string[] {
  return cards().map((c) => c.querySelector('.asset-title')?.textContent ?? '');
}

describe('Asset-Browser', () => {
  it('zeigt Karten mit Typ, Modell, Kosten und Status', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    expect(screen.getByText('18 von 18')).toBeInTheDocument();
    const mira = cards().find((c) => c.textContent?.includes('Mira – Charakterblatt v3'))!;
    expect(mira).toHaveTextContent('Bild · character-sheet');
    expect(mira).toHaveTextContent('nano-banana-pro');
    expect(mira).toHaveTextContent('$0.16');
    expect(mira).toHaveTextContent('ungenutzt');
    const sb = cards().find((c) => c.textContent?.includes('Storyboard 03 – Tunnel'))!;
    expect(sb).toHaveTextContent('im Dokument');
    const logo = cards().find((c) => c.textContent?.includes('Label-Logo'))!;
    expect(logo).toHaveTextContent('im Dokument');
    expect(logo).toHaveTextContent('verknüpft');
    const rejected = cards().find((c) => c.textContent?.includes('Testshot Regen'))!;
    expect(rejected).toHaveTextContent('verworfen');
  });

  it('filtert nach Typ, Status, Quelle, Modell und Volltext; sortiert nach Kosten', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Audio' }));
    expect(titles().sort()).toEqual(['Gesang (Stem)', 'Nachtfahrt (Demo-Mix)', 'Whoosh Tunnel']);
    await user.click(screen.getByRole('button', { name: 'Audio' }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'rejected');
    expect(titles()).toEqual(['Testshot Regen']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'linked');
    expect(titles()).toEqual(['Label-Logo']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'all');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Quelle' }), 'director');
    expect(titles()).toEqual(['PaperRoto.tsx']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Quelle' }), 'all');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Modell' }), 'minimax/h3-max/text-to-video');
    expect(titles()).toEqual(['Testshot Tunnelfahrt']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Modell' }), 'all');

    await user.type(screen.getByRole('searchbox', { name: /Assets durchsuchen/ }), 'tunnel');
    await waitFor(() => expect(titles().sort()).toEqual(['Storyboard 03 – Tunnel', 'Testshot Tunnelfahrt', 'Whoosh Tunnel']));
    await user.clear(screen.getByRole('searchbox', { name: /Assets durchsuchen/ }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sortierung' }), 'cost');
    await waitFor(() => expect(titles()[0]).toBe('Testshot Tunnelfahrt'));
    expect(titles()[1]).toBe('Testshot Regen');
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
    const card = document.querySelector('[data-asset-id="ast_char_mira"]')!;
    const dt = makeDataTransfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(dt.types).toContain(REF_MIME);
    const editor = screen.getByTestId('composer-editor');
    fireEvent.dragOver(editor, { dataTransfer: dt });
    fireEvent.drop(editor, { dataTransfer: dt });
    expect(studio.store.getState().composer).toEqual([{ type: 'ref', ref: { kind: 'asset', assetId: 'ast_char_mira' } }]);
    expect(editor.querySelector('.chip')).toHaveTextContent('📎 Mira – Charakterblatt v3');
  });

  it('Dateien vom Desktop werden verknüpft (importFiles „link“) und als Chips eingefügt', async () => {
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
    expect(screen.getByTestId('composer-editor').querySelector('.chip')).toHaveTextContent('📎 Referenz Hafen');
    expect(await screen.findByText('19 von 19')).toBeInTheDocument();
  });

  it('Doppelklick und „In Composer“ fügen Chips ein; Drawer zeigt Herkunft und „Im Ordner zeigen“', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const reveal = vi.spyOn(studio.api, 'revealAsset');
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    const user = userEvent.setup();
    const card = document.querySelector<HTMLElement>('[data-asset-id="ast_sb_02"]')!;
    await user.dblClick(card);
    await user.click(within(card).getByRole('button', { name: 'In Composer' }));
    expect(studio.store.getState().composer.filter((s) => s.type === 'ref')).toHaveLength(2);

    await user.click(within(card).getByRole('button', { name: /Storyboard 02 – Mira – Details/ }));
    const drawer = screen.getByRole('complementary', { name: 'Details: Storyboard 02 – Mira' });
    expect(drawer).toHaveTextContent('Mira am Steuer');
    expect(drawer).toHaveTextContent('fal-ai/nano-banana-pro');
    // Eltern-Asset (Eingabe der Generierung) anklickbar
    await user.click(within(drawer).getByRole('button', { name: /Mira – Charakterblatt v3/ }));
    const parentDrawer = screen.getByRole('complementary', { name: 'Details: Mira – Charakterblatt v3' });
    expect(within(parentDrawer).getAllByRole('button', { name: /Storyboard 0\d/ }).length).toBe(6);
    await user.click(within(parentDrawer).getByRole('button', { name: /Im Ordner zeigen/ }));
    expect(reveal).toHaveBeenCalledWith(DEMO_VIDEO_ID, 'ast_char_mira');
  });

  it('Importknöpfe wählen Dateien und importieren sie; Live-Updates über asset-Ereignisse', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const importFiles = vi.spyOn(studio.api, 'importFiles');
    studio.api.debug.setNextFiles(['/Users/demo/Material/Skript.md']);
    renderStudio(<AssetBrowser searchDelayMs={0} />, studio);
    await userEvent.click(screen.getByRole('button', { name: 'Dateien importieren' }));
    await waitFor(() => expect(importFiles).toHaveBeenCalledWith(DEMO_VIDEO_ID, ['/Users/demo/Material/Skript.md'], 'import'));
    expect(await screen.findByText('19 von 19')).toBeInTheDocument();
    act(() =>
      studio.api.debug.emit({
        type: 'asset',
        projectId: DEMO_VIDEO_ID,
        asset: { id: 'ast_live', kind: 'image', title: 'Live-Asset', tags: [], status: 'active', source: 'generated', createdAt: new Date().toISOString() },
      }),
    );
    expect(await screen.findByText('Live-Asset')).toBeInTheDocument();
  });
});
