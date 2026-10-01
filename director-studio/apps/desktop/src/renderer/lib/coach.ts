/**
 * Einmalige Hinweise (DESIGN.md §8.6, §10): Markerleiste, Zeigen im Monitor, Alt+Klick. Jeder Hinweis verschwindet
 * nach der ersten passenden Handlung für immer; „Hinweise zurücksetzen“ in den Einstellungen öffnet alle wieder.
 * Gespeichert unter `director-studio.coach`, alle Zugriffe in try/catch.
 */

export type CoachKey = 'markerStrip' | 'monitorPointing' | 'altReference';
export type CoachState = Record<CoachKey, 'open' | 'done'>;

export const COACH_KEY = 'director-studio.coach';

export function defaultCoach(): CoachState {
  return { markerStrip: 'open', monitorPointing: 'open', altReference: 'open' };
}

export function readCoach(): CoachState {
  const state = defaultCoach();
  try {
    const raw = localStorage.getItem(COACH_KEY);
    if (!raw) return state;
    const data = JSON.parse(raw) as Record<string, unknown>;
    for (const key of Object.keys(state) as CoachKey[]) if (data[key] === 'done') state[key] = 'done';
  } catch {
    // ignorieren: ohne Speicher erscheinen die Hinweise erneut
  }
  return state;
}

export function writeCoach(state: CoachState): void {
  try {
    localStorage.setItem(COACH_KEY, JSON.stringify(state));
  } catch {
    // ignorieren
  }
}
