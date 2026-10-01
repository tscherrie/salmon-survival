import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS, Toasts } from '../src/renderer/components/common/Toasts.tsx';
import { openBudgetPopover } from '../src/renderer/components/director/BudgetMeter.tsx';
import { DirectorPanel } from '../src/renderer/components/director/DirectorPanel.tsx';
import { resetTechDetailsCache, TECH_DETAILS_KEY, useTechDetails } from '../src/renderer/components/director/techDetails.ts';
import { SettingsDialog } from '../src/renderer/components/start/SettingsDialog.tsx';
import { Header } from '../src/renderer/components/workspace/Header.tsx';
import { COACH_KEY } from '../src/renderer/lib/coach.ts';
import { setContrastMode, setThemeMode } from '../src/renderer/lib/theme.ts';
import { DEMO_VIDEO_ID, DEMO_VIDEO_PATH, renderStudio, setupStudio } from './helpers.tsx';

/**
 * Verdrahtung über Komponentengrenzen hinweg (Integration der Teilaufgaben): Budget-Popover aus dem Director-Menü,
 * Stepper → Dock, Toasts nach §7.11 und die Gruppe „Darstellung“ der Einstellungen (§7.13).
 */

afterEach(() => {
  vi.useRealTimers();
  localStorage.removeItem(TECH_DETAILS_KEY);
  localStorage.removeItem(COACH_KEY);
  resetTechDetailsCache();
  setThemeMode('dark');
  setContrastMode('system');
});

describe('Kopfzeile', () => {
  it('„Kosten …“ im Director-Menü öffnet das Budget-Popover der Kopfzeile', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(<Header />, studio);
    expect(screen.queryByRole('dialog', { name: 'Budget' })).toBeNull();
    act(() => openBudgetPopover());
    const popover = screen.getByRole('dialog', { name: 'Budget' });
    // Aufschlüsselung nach Quelle (fal, Director, Sonstiges)
    expect(within(popover).getByText('Director')).toBeInTheDocument();
    expect(within(popover).getByText('Sonstiges')).toBeInTheDocument();
  });

  it('Klick auf den aktuellen Schritt im Stepper fokussiert die offene Entscheidung im Dock', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    renderStudio(
      <>
        <Header />
        <DirectorPanel />
      </>,
      studio,
    );
    await act(async () => {
      await studio.api.debug.proposeCheckpoint(DEMO_VIDEO_ID, 'cp_1_treatment', 12.5);
    });
    const steps = screen.getByRole('list', { name: 'Checkpoints' });
    await userEvent.setup().click(within(steps).getByRole('button', { name: /^Treatment/ }));
    const card = screen.getByRole('article', { name: 'Checkpoint zur Freigabe: Treatment' });
    await waitFor(() => expect(card).toContainElement(document.activeElement as HTMLElement));
  });
});

describe('Toasts (DESIGN.md §7.11)', () => {
  it('Hinweise verschwinden nach 4 s (Pause beim Hover), Fehler bleiben, höchstens drei, unten links im Arbeitsbereich', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    vi.useFakeTimers();
    renderStudio(<Toasts />, studio);
    expect(document.querySelector('.toasts')).toHaveClass('is-workspace');
    act(() => {
      studio.store.getState().toast('error', 'Fehler A');
      studio.store.getState().toast('info', 'Hinweis B');
    });
    const info = screen.getByText('Hinweis B').closest('.toast')!;
    // Hover pausiert die Standzeit
    fireEvent.mouseEnter(info);
    act(() => vi.advanceTimersByTime(TOAST_MS + 500));
    expect(screen.getByText('Hinweis B')).toBeInTheDocument();
    fireEvent.mouseLeave(info);
    act(() => vi.advanceTimersByTime(TOAST_MS + 500));
    expect(screen.queryByText('Hinweis B')).toBeNull();
    // Fehler bleiben, bis sie geschlossen werden
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('alert')).toHaveTextContent('Fehler A');
    // Höchstens drei: der älteste weicht
    act(() => {
      for (const text of ['C', 'D', 'E']) studio.store.getState().toast('success', text);
    });
    expect(studio.store.getState().toasts.map((t) => t.text)).toEqual(['C', 'D', 'E']);
    expect(document.querySelectorAll('.toast')).toHaveLength(3);
  });
});

describe('Einstellungen: Darstellung (DESIGN.md §7.13)', () => {
  it('Theme, erhöhter Kontrast, technische Details und „Hinweise zurücksetzen“ wirken sofort', async () => {
    const studio = await setupStudio({ project: DEMO_VIDEO_PATH });
    act(() => studio.store.getState().completeCoach('markerStrip'));
    expect(studio.store.getState().coach.markerStrip).toBe('done');
    let tech = false;
    function TechProbe() {
      tech = useTechDetails();
      return null;
    }
    renderStudio(
      <>
        <SettingsDialog onClose={() => undefined} />
        <TechProbe />
      </>,
      studio,
    );
    const user = userEvent.setup();
    await user.click(within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { name: 'Hell' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(within(screen.getByRole('group', { name: 'Erhöhter Kontrast' })).getByRole('button', { name: 'An' }));
    expect(document.documentElement.dataset.contrast).toBe('more');
    await user.click(screen.getByRole('switch', { name: 'Technische Details im Verlauf' }));
    expect(tech).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Hinweise zurücksetzen' }));
    expect(studio.store.getState().coach.markerStrip).toBe('open');
  });
});
