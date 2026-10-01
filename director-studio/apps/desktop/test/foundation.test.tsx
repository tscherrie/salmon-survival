import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Kbd, ariaKeyShortcuts, formatShortcut } from '../src/renderer/components/common/Kbd.tsx';
import { Tooltip } from '../src/renderer/components/common/Tooltip.tsx';
import { applyContrastMode, applyThemeMode, readContrastMode, readThemeMode, setContrastMode, setThemeMode } from '../src/renderer/lib/theme.ts';

/** Fundament: Theme und Kontrast (§3.1, §10), Tastenkürzel (§4.4), Tooltip (§7.11). */

type Listener = () => void;

/** matchMedia-Attrappe mit schaltbaren Abfragen und Ereignissen. */
function mockMedia(initial: Record<string, boolean>) {
  const state = { ...initial };
  const listeners = new Map<string, Set<Listener>>();
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return !!state[query];
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, l: Listener) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(l);
    },
    removeEventListener: (_: string, l: Listener) => listeners.get(query)?.delete(l),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return {
    set(query: string, value: boolean) {
      state[query] = value;
      for (const l of listeners.get(query) ?? []) l();
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  setThemeMode('dark');
  setContrastMode('system');
});

describe('Theme und Kontrast (lib/theme.ts)', () => {
  it('setzt data-theme immer aufgelöst; „System“ folgt der Medienabfrage live', () => {
    const media = mockMedia({ '(prefers-color-scheme: light)': true });
    try {
      // Der Listener wird beim ersten Anwenden gebunden; deshalb erst hier, nach dem Mock
      applyThemeMode('system');
      const root = document.documentElement;
      expect(root.dataset.theme).toBe('light');
      expect(root.dataset.themeMode).toBe('system');
      media.set('(prefers-color-scheme: light)', false);
      expect(root.dataset.theme).toBe('dark');
      setThemeMode('light');
      expect(root.dataset.theme).toBe('light');
      expect(readThemeMode()).toBe('light');
      // Systemwechsel wirkt nicht auf eine feste Wahl
      media.set('(prefers-color-scheme: light)', false);
      expect(root.dataset.theme).toBe('light');
    } finally {
      media.restore();
    }
  });

  it('setzt data-contrast (more/normal) aus Einstellung oder System', () => {
    const media = mockMedia({ '(prefers-contrast: more)': true });
    try {
      applyContrastMode('system');
      expect(document.documentElement.dataset.contrast).toBe('more');
      setContrastMode('normal');
      expect(document.documentElement.dataset.contrast).toBe('normal');
      expect(readContrastMode()).toBe('normal');
      setContrastMode('more');
      expect(document.documentElement.dataset.contrast).toBe('more');
      expect(document.documentElement.dataset.contrastMode).toBe('more');
    } finally {
      media.restore();
    }
  });
});

describe('Tastenkürzel (Kbd.tsx)', () => {
  it('formatiert je Plattform: macOS mit Symbolen, sonst Text aus i18n', () => {
    expect(formatShortcut(['mod', 'Enter'], true)).toBe('⌘↵');
    expect(formatShortcut(['alt', 'Enter'], true)).toBe('⌥↵');
    expect(formatShortcut(['mod', 'Enter'], false)).toBe('Strg+Enter');
    expect(formatShortcut(['shift', 'Backspace'], false)).toBe('Umschalt+Rücktaste');
    expect(formatShortcut(['mod', '1'], false)).toBe('Strg+1');
    expect(ariaKeyShortcuts(['mod', '1'], true)).toBe('Meta+1');
    expect(ariaKeyShortcuts(['mod', '1'], false)).toBe('Control+1');
  });

  it('rendert Keycaps (dekorativ) plus Klartext für Screenreader', () => {
    const { container } = render(<Kbd keys={['mod', '2']} />);
    expect(container.querySelectorAll('kbd.kbd')).toHaveLength(2);
    expect(container.querySelector('.sr-only')).toHaveTextContent('Strg+2');
  });
});

describe('Tooltip', () => {
  it('erscheint nach 400 ms, beschreibt den Auslöser und schließt mit Esc', () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Assets ausblenden" keys={['mod', '1']}>
        <button type="button" aria-label="Assets ausblenden">
          x
        </button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Assets ausblenden' });
    fireEvent.pointerEnter(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Assets ausblenden');
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });
});
