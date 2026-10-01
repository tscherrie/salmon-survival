import { z } from 'zod';
import { rectSchema } from '@studio/core';

/**
 * Sicherheitsregeln des Hauptprozesses als reine Funktionen (ohne Electron, damit testbar):
 * externe Links, Navigationssperren, Netzwerk-/CSP-Regeln der Web-Vorschau, Nutzergesten und der
 * abgesicherte Pick-Kanal.
 */

// ───────────── Externe Links ─────────────

const MAX_EXTERNAL_URL_LENGTH = 4096;

/**
 * Prüft eine URL, bevor sie an `shell.openExternal` geht: nur `http:`/`https:` (keine `file:`, `smb:`,
 * `search-ms:`, `ms-officecmd:`, … – diese starten fremde Programme), mit Host, ohne eingebettete
 * Zugangsdaten. Liefert die normalisierte URL oder `null`.
 */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_EXTERNAL_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || url.username || url.password) return null;
  return url.href;
}

// ───────────── Nutzergesten ─────────────

/** Eingabetypen (Electron `InputEvent.type`), die als echte Nutzeraktion zählen. */
const GESTURE_INPUT_TYPES = new Set(['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'char', 'touchStart', 'touchEnd', 'gestureTap', 'pointerDown', 'pointerUp']);

/**
 * Merkt sich die letzte echte Nutzereingabe eines WebContents (Electron-Ereignis `input-event`).
 * `consume()` erlaubt genau eine Aktion pro Geste innerhalb des Zeitfensters – so kann eine Seite
 * ohne Klick keine externen Programme/Tabs öffnen und auch keine Schleife davon auslösen.
 */
export class GestureGate {
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly windowMs = 5000,
    private readonly now: () => number = Date.now,
  ) {}

  note(inputType: string): void {
    if (GESTURE_INPUT_TYPES.has(inputType)) this.last = this.now();
  }

  /** Gab es kürzlich eine Geste? Verbraucht sie dabei. */
  consume(): boolean {
    const ok = this.now() - this.last <= this.windowMs;
    if (ok) this.last = Number.NEGATIVE_INFINITY;
    return ok;
  }
}

// ───────────── Hauptfenster: Navigationssperre ─────────────

/**
 * Darf das Hauptfenster (Hauptframe) zu `target` navigieren? Erlaubt ist nur der App-Einstieg selbst:
 * im Dev-Modus derselbe http-Origin wie der Vite-Server, in Produktion genau dieselbe `file:`-Datei
 * (`index.html`; Query/Hash egal). `file:`-Origins sind in WHATWG-URLs immer `"null"` – ein
 * Origin-Vergleich würde deshalb jede lokale Datei durchlassen.
 */
export function isAppUrl(target: string, appUrl: string): boolean {
  let t: URL;
  let a: URL;
  try {
    t = new URL(target);
    a = new URL(appUrl);
  } catch {
    return false;
  }
  if (a.protocol === 'http:' || a.protocol === 'https:') return t.protocol === a.protocol && t.host === a.host;
  if (a.protocol === 'file:') return t.protocol === 'file:' && t.host === a.host && decodeURIComponent(t.pathname) === decodeURIComponent(a.pathname);
  return false;
}

/** Navigationen in Unterframes des Hauptfensters (die Bühnen nutzen `srcdoc`-iframes ohne Skripte). */
export function isAllowedAppSubframeUrl(target: string, appUrl: string): boolean {
  if (target === 'about:blank' || target === 'about:srcdoc') return true;
  try {
    const t = new URL(target);
    if (t.protocol === 'data:' || t.protocol === 'blob:') return true;
  } catch {
    return false;
  }
  return isAppUrl(target, appUrl);
}

// ───────────── Web-Vorschau: Netzwerk & CSP ─────────────

/**
 * Netzwerkregel der Vorschau-Partition (PLAN §6.1/§17: „ohne Netzwerk außer Projekt-Assets“). Erlaubt sind
 * nur der lokale Vorschau-Server (`http:` und Vites HMR-`ws:` auf genau diesem Host:Port), `data:`/`blob:`
 * und DevTools. Bewusst KEINE externen CDNs/Webfonts: Schriften und Bibliotheken gehören in den Site-Ordner
 * (Vite bündelt npm-Pakete lokal). So kann KI-Code weder Projektinhalte nach außen senden noch Tracker laden;
 * Weiterleitungen werden von Electron erneut geprüft und damit ebenfalls blockiert.
 */
export function isPreviewRequestAllowed(rawUrl: string, allowedHost: string | null): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'devtools:') return true;
  if (!allowedHost) return false;
  return (url.protocol === 'http:' || url.protocol === 'ws:') && url.host === allowedHost;
}

/** Darf ein Frame der Vorschau zu `target` navigieren (ohne Netzwerk-Sonderfälle)? */
export function isPreviewNavigationAllowed(target: string, allowedHost: string | null): boolean {
  if (target === 'about:blank' || target === 'about:srcdoc') return true;
  try {
    const url = new URL(target);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
    return !!allowedHost && url.protocol === 'http:' && url.host === allowedHost;
  } catch {
    return false;
  }
}

/**
 * Content-Security-Policy für alle Antworten der Vorschau-Partition (zusätzlich zur Netzwerkregel).
 * `'unsafe-inline'`/`'unsafe-eval'` braucht der Vite-Dev-Client (React-Refresh-Präambel, HMR).
 */
export function previewCsp(allowedHost: string): string {
  return [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ws://${allowedHost} data: blob:`,
    "worker-src 'self' blob:",
    "frame-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** Hängt die Vorschau-CSP an vorhandene Antwort-Header an (eigene CSP der Seite bleibt zusätzlich wirksam). */
export function withPreviewCsp(headers: Record<string, string[]> | undefined, allowedHost: string | null): Record<string, string[]> {
  const out: Record<string, string[]> = { ...(headers ?? {}) };
  // Ohne bekannten Server: alles sperren.
  const policy = allowedHost ? previewCsp(allowedHost) : "default-src 'none'";
  const key = Object.keys(out).find((k) => k.toLowerCase() === 'content-security-policy') ?? 'Content-Security-Policy';
  out[key] = [...(out[key] ?? []), policy];
  return out;
}

/**
 * Löst einen Seitenpfad der Site (z. B. `/about`, `/blog?p=2#x`) gegen die Vorschau-URL auf. Nur Pfade auf
 * demselben Server – absolute URLs, `//host`-Pfade und Backslashes werden abgelehnt.
 */
export function resolvePreviewPath(baseUrl: string, path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.length > 2048) {
    throw new Error(`Ungültiger Seitenpfad: ${String(path).slice(0, 80)}`);
  }
  const base = new URL(baseUrl);
  const target = new URL(path, base);
  if (target.origin !== base.origin) throw new Error(`Ungültiger Seitenpfad: ${path.slice(0, 80)}`);
  return target.href;
}

// ───────────── Pick-Kanal der Vorschau ─────────────

export const PICK_PREFIX = '__STUDIO_PICK__';
/** Eigene Welt für den Picker: Seiten-Skripte sehen dort weder Token noch Funktionen. */
export const PICKER_WORLD_ID = 1077;

const shortText = (max: number) => z.string().max(max);

export const pickPayloadSchema = z.object({
  selector: z.string().max(500),
  bbox: rectSchema,
  text: shortText(500).optional(),
  tag: shortText(64).optional(),
  dataSid: shortText(200).nullish(),
  dataSrc: shortText(500).nullish(),
  slideId: shortText(200).nullish(),
  sidPath: z.array(shortText(200)).max(50).optional(),
  page: shortText(2048).optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
});

export type PickPayload = z.infer<typeof pickPayloadSchema>;

/** Prüft eine Pick-Nutzlast (Form und Größen); `null` bei ungültigen Daten. */
export function validatePickPayload(value: unknown): PickPayload | null {
  const parsed = pickPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Liest eine Pick-Konsolenmeldung. Gültig ist nur `__STUDIO_PICK__<token>:<json>` mit dem Token der
 * Vorschau-Sitzung (der nur in der isolierten Picker-Welt existiert) und gültiger Nutzlast.
 */
export function parsePickMessage(message: unknown, token: string): PickPayload | null {
  if (typeof message !== 'string' || !token || message.length > 20000) return null;
  const prefix = `${PICK_PREFIX}${token}:`;
  if (!message.startsWith(prefix)) return null;
  try {
    return validatePickPayload(JSON.parse(message.slice(prefix.length)));
  } catch {
    return null;
  }
}

/**
 * Skript für die isolierte Picker-Welt: setzt den Melde-Kanal mit Token, ignoriert synthetische Klicks
 * (Seiten-Skripte könnten sonst per `dispatchEvent` Picks auslösen), lädt den Picker und schaltet ihn
 * passend zum Pick-Modus.
 */
export function pickerBootstrap(pickerScript: string, token: string, enabled: boolean): string {
  return `(function () {
  if (!window.__studioSecurePick) {
    var prefix = ${JSON.stringify(`${PICK_PREFIX}${token}:`)};
    Object.defineProperty(window, '__studioSecurePick', { value: true });
    window.__studioPickerReport = function (payload) {
      try { console.debug(prefix + JSON.stringify(payload)); } catch (e) { /* ignorieren */ }
    };
    window.addEventListener('click', function (ev) {
      if (!ev.isTrusted && window.__studioPicker && window.__studioPicker.isEnabled()) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    }, true);
  }
  ${pickerScript};
  if (window.__studioPicker) window.__studioPicker.${enabled ? 'enable' : 'disable'}();
})();
void 0;`;
}
