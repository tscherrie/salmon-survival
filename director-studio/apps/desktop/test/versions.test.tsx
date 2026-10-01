import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Stage } from '../src/renderer/components/stage/Stage.tsx';
import { Header } from '../src/renderer/components/workspace/Header.tsx';
import { DEMO_VIDEO_ID, DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';

describe('Versionen', () => {
  it('listet Versionen; „Ansehen“ zeigt eine ältere Version nur lesend', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const getVersion = vi.spyOn(studio.api, 'getVersion');
    const { container } = renderStudio(
      <>
        <Header />
        <Stage />
      </>,
      studio,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Versionen: v3' }));
    const list = screen.getByRole('list', { name: 'Versionen' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('v3');
    expect(rows[0]).toHaveTextContent('Storyboard-Entwurf als Animatic platziert');
    expect(rows[0]).toHaveTextContent('Director');
    expect(rows[2]).toHaveTextContent('Projekt angelegt');
    expect(rows[2]).toHaveTextContent('System');

    await user.click(within(list).getByRole('button', { name: 'Ansehen v2' }));
    await waitFor(() => expect(screen.getByText('Ältere Version v2 – nur Ansicht')).toBeInTheDocument());
    expect(getVersion).toHaveBeenCalledWith(DEMO_VIDEO_ID, 2);
    // v2 hat nur den Song – keine Storyboard-Clips
    expect(container.querySelector('[data-clip-id="c_sb01"]')).toBeNull();
    expect(container.querySelector('[data-clip-id="song"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Zur aktuellen Version' }));
    expect(container.querySelector('[data-clip-id="c_sb01"]')).not.toBeNull();
  });

  it('„Wiederherstellen“ fragt nach und legt eine neue Version an', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const restore = vi.spyOn(studio.api, 'restoreVersion');
    const { container } = renderStudio(
      <>
        <Header />
        <Stage />
      </>,
      studio,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Versionen: v3' }));
    await user.click(screen.getByRole('button', { name: 'Wiederherstellen v2' }));
    const dialog = screen.getByRole('dialog', { name: 'Version v2 wiederherstellen?' });
    expect(dialog).toHaveTextContent('neue Version als Kopie von v2');
    // Abbrechen ändert nichts
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(restore).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Versionen: v3' }));
    await user.click(screen.getByRole('button', { name: 'Wiederherstellen v2' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Version v2 wiederherstellen?' })).getByRole('button', { name: 'Wiederherstellen' }));
    expect(restore).toHaveBeenCalledWith(DEMO_VIDEO_ID, 2);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Versionen: v4' })).toBeInTheDocument());
    await waitFor(() => expect(container.querySelector('[data-clip-id="c_sb01"]')).toBeNull());
    const v4 = studio.store.getState().versions.find((v) => v.number === 4);
    expect(v4?.restoredFrom).toBe(2);
    expect(v4?.note).toBe('Wiederhergestellt aus v2');
  });

  it('Kopfzeile zeigt Titel, Kategorie, Checkpoints und Export', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    const exportProject = vi.spyOn(studio.api, 'exportProject');
    renderStudio(<Header />, studio);
    expect(screen.getByRole('heading', { name: 'Musikvideo „Nachtfahrt“' })).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Checkpoints' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(5);
    expect(within(steps).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Exportieren' }));
    await user.click(screen.getByRole('menuitem', { name: 'Video (MP4) · 9:16' }));
    expect(exportProject).toHaveBeenCalledWith(DEMO_VIDEO_ID, { target: 'mp4', format: '9:16' });
    await waitFor(() => expect(studio.store.getState().toasts.at(-1)?.text).toContain('-9x16.mp4'));
  });
});
