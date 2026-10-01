import { useEffect, useState } from 'react';

/** Farbschema: dunkel (Standard), hell oder System (`prefers-color-scheme`). Pro Gerät gespeichert. */
export type ThemeMode = 'dark' | 'light' | 'system';

const KEY = 'director-studio.theme';

export function readThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'dark' || value === 'light' || value === 'system') return value;
  } catch {
    // kein Speicher verfügbar
  }
  return 'dark';
}

export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
}

export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(readThemeMode);
  useEffect(() => {
    applyThemeMode(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // ignorieren
    }
  }, [mode]);
  return [mode, setMode];
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark';
}
