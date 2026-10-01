import { useSyncExternalStore } from 'react';

/**
 * Darstellung (DESIGN.md §3.1, §7.13, §10): Farbschema dunkel (Standard), hell oder System und erhöhter Kontrast
 * (System, an, aus). Beides wird in JS aufgelöst: `data-theme` ist immer `dark` oder `light`, `data-contrast` immer
 * `more` oder `normal`; die gewählte Einstellung steht zusätzlich in `data-theme-mode` bzw. `data-contrast-mode`.
 * Bei „System“ folgen beide Attribute live den Medienabfragen. Pro Gerät gespeichert.
 */
export type ThemeMode = 'dark' | 'light' | 'system';
export type ContrastMode = 'system' | 'more' | 'normal';

const THEME_KEY = 'director-studio.theme';
const CONTRAST_KEY = 'director-studio.contrast';
const LIGHT_QUERY = '(prefers-color-scheme: light)';
const MORE_QUERY = '(prefers-contrast: more)';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    if (value && (allowed as readonly string[]).includes(value)) return value as T;
  } catch {
    // kein Speicher verfügbar
  }
  return fallback;
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignorieren
  }
}

function matches(query: string): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function readThemeMode(): ThemeMode {
  return read<ThemeMode>(THEME_KEY, ['dark', 'light', 'system'], 'dark');
}

export function readContrastMode(): ContrastMode {
  return read<ContrastMode>(CONTRAST_KEY, ['system', 'more', 'normal'], 'system');
}

/** Aufgelöstes Farbschema für einen Modus (System → aktuelle Medienabfrage). */
export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return matches(LIGHT_QUERY) ? 'light' : 'dark';
  return mode;
}

export function resolveContrast(mode: ContrastMode): 'more' | 'normal' {
  if (mode === 'system') return matches(MORE_QUERY) ? 'more' : 'normal';
  return mode;
}

// Aktuelle Einstellungen als kleiner, abonnierbarer Zustand (Kopfzeile, Einstellungen und Story bleiben synchron)
let themeMode: ThemeMode | null = null;
let contrastMode: ContrastMode | null = null;
const listeners = new Set<() => void>();
let mediaBound = false;

function notify(): void {
  for (const l of listeners) l();
}

/** Hört einmalig auf Systemänderungen; wirkt nur, solange der jeweilige Modus „System“ ist. */
function bindMedia(): void {
  if (mediaBound || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  mediaBound = true;
  const onChange = () => {
    if (themeMode === 'system') applyThemeMode('system');
    if (contrastMode === 'system') applyContrastMode('system');
  };
  try {
    window.matchMedia(LIGHT_QUERY).addEventListener?.('change', onChange);
    window.matchMedia(MORE_QUERY).addEventListener?.('change', onChange);
  } catch {
    // ältere Umgebungen ohne Ereignisse: dann eben ohne Live-Wechsel
  }
}

export function applyThemeMode(mode: ThemeMode): void {
  themeMode = mode;
  bindMedia();
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.theme = resolveTheme(mode);
    root.dataset.themeMode = mode;
  }
}

export function applyContrastMode(mode: ContrastMode): void {
  contrastMode = mode;
  bindMedia();
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.contrast = resolveContrast(mode);
    root.dataset.contrastMode = mode;
  }
}

export function setThemeMode(mode: ThemeMode): void {
  write(THEME_KEY, mode);
  applyThemeMode(mode);
  notify();
}

export function setContrastMode(mode: ContrastMode): void {
  write(CONTRAST_KEY, mode);
  applyContrastMode(mode);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const themeSnapshot = () => themeMode ?? readThemeMode();
const contrastSnapshot = () => contrastMode ?? readContrastMode();

export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  return [useSyncExternalStore(subscribe, themeSnapshot, themeSnapshot), setThemeMode];
}

export function useContrastMode(): [ContrastMode, (mode: ContrastMode) => void] {
  return [useSyncExternalStore(subscribe, contrastSnapshot, contrastSnapshot), setContrastMode];
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark';
}
