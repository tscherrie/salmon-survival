import { useSyncExternalStore } from 'react';

/**
 * Schalter „Technische Details“ (DESIGN.md §7.6.1, §10): zeigt im Verlauf die Rohnamen der Werkzeuge. Gespeichert
 * unter `director-studio.director.techDetails` (alle Zugriffe in try/catch). Abonnierbar, damit ⋯-Menü und
 * Einstellungen denselben Wert zeigen.
 */
export const TECH_DETAILS_KEY = 'director-studio.director.techDetails';

const listeners = new Set<() => void>();
let cached: boolean | null = null;

function read(): boolean {
  if (cached !== null) return cached;
  try {
    cached = globalThis.localStorage?.getItem(TECH_DETAILS_KEY) === '1';
  } catch {
    cached = false;
  }
  return cached;
}

export function getTechDetails(): boolean {
  return read();
}

export function setTechDetails(on: boolean): void {
  cached = on;
  try {
    if (on) globalThis.localStorage?.setItem(TECH_DETAILS_KEY, '1');
    else globalThis.localStorage?.removeItem(TECH_DETAILS_KEY);
  } catch {
    // Speicher nicht verfügbar: der Wert gilt dann nur für diese Sitzung
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React-Hook: aktueller Schalterstand, rendert bei jeder Änderung neu. */
export function useTechDetails(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Nur für Tests: zwischengespeicherten Wert verwerfen (nach `localStorage.clear()`). */
export function resetTechDetailsCache(): void {
  cached = null;
}
