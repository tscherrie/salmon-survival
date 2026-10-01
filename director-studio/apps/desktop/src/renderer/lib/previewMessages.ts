/**
 * Nachrichten zwischen App und Web-Vorschau im Browser-Modus (iframe, `postMessage`).
 * Im Electron-Betrieb meldet der Main-Prozess Picks als `preview_pick`-Ereignis.
 */
export const PICK_MODE_MESSAGE = 'studio-pick-mode';
export const PICK_MESSAGE = 'studio-pick';

export interface PickMessage {
  type: typeof PICK_MESSAGE;
  page: string;
  selector: string;
  source?: string | undefined;
  text?: string | undefined;
  bbox: { x: number; y: number; width: number; height: number };
}
