import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Werkzeug-Steckplatz in der Bühnen-Leiste (DESIGN.md §7.5): Jede Bühne (Timeline, Folien, Ebenen, Seiten) legt
 * ihre Werkzeuge per Portal rechts in die gemeinsame 32-px-Leiste, statt eine eigene Werkzeugzeile zu öffnen.
 */
const StageToolsContext = createContext<HTMLElement | null>(null);
export const StageToolsProvider = StageToolsContext.Provider;

export function StageTools({ children }: { children: ReactNode }) {
  const target = useContext(StageToolsContext);
  return target ? createPortal(children, target) : null;
}
