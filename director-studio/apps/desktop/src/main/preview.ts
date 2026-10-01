import { randomBytes } from 'node:crypto';
import { session as electronSession, shell, WebContentsView, type BrowserWindow } from 'electron';
import type { PreviewViewport, Rect } from '@studio/core';
import {
  GestureGate,
  isPreviewNavigationAllowed,
  isPreviewRequestAllowed,
  parsePickMessage,
  pickerBootstrap,
  PICKER_WORLD_ID,
  resolvePreviewPath,
  safeExternalUrl,
  withPreviewCsp,
  type PickPayload,
} from './security.ts';

export { PICK_PREFIX, type PickPayload } from './security.ts';

/**
 * Eingebettete Web-Vorschau (eigenes Chromium-WebContents) für Websites des Directors. Sie zeigt KI-Code,
 * der als nicht vertrauenswürdig gilt. Sicherheit:
 * - In-Memory-Partition je Projekt, kein Preload, keine Node-Integration, Sandbox, alle Berechtigungen und
 *   Downloads abgelehnt.
 * - Netzwerk nur zum lokalen Vorschau-Server (`webRequest.onBeforeRequest`, prüft auch Weiterleitungen)
 *   plus strikte CSP auf jeder Antwort (`onHeadersReceived`), siehe `isPreviewRequestAllowed`/`previewCsp`.
 * - Navigation (Haupt- und Unterframes, Weiterleitungen) nur innerhalb des Vorschau-Servers. Fremde Ziele
 *   gehen – nur `http(s)` und nur nach echter Nutzereingabe in der Vorschau – an den System-Browser.
 * - Element-Picks: Der Picker läuft in einer isolierten Welt und meldet über Konsolen-Nachrichten mit
 *   einem zufälligen Token je Vorschau. Angenommen werden nur Meldungen mit diesem Token, aus dem
 *   Hauptframe, bei aktivem Pick-Modus und mit gültiger Nutzlast – Seiten-Skripte können keine Picks
 *   vortäuschen.
 */

export const VIEWPORT_SIZES: Record<PreviewViewport, { width: number; height: number; mobile: boolean }> = {
  mobile: { width: 390, height: 844, mobile: true },
  tablet: { width: 820, height: 1180, mobile: true },
  desktop: { width: 1440, height: 900, mobile: false },
};

interface PreviewEntry {
  view: WebContentsView;
  /** Basis-URL des Vorschau-Servers. */
  url: string;
  /** Erlaubter Host:Port (Netzwerk/Navigation). */
  host: string;
  viewport: PreviewViewport;
  pickMode: boolean;
  /** Geheimnis des Pick-Kanals (nur Main-Prozess und isolierte Picker-Welt kennen es). */
  token: string;
  /** Letzte echte Nutzereingabe in der Vorschau (für externe Links). */
  gestures: GestureGate;
  /** Fenster, in dem die View hängt (nach macOS-Fenster-Neuaufbau neu einhängen). */
  attachedTo: BrowserWindow | null;
  /** Erst nach der ersten Seite gibt es eine Render-Ansicht; Geräte-Emulation davor bringt Electron zum Absturz (SIGSEGV). */
  rendered: boolean;
}

type PreviewState = { url: string | null; status: 'starting' | 'ready' | 'error'; error?: string };

/** Skaliert Renderer-CSS-Pixel (gezoomte Seite) in Fenster-DIPs für `WebContentsView.setBounds`. */
export function toWindowBounds(bounds: Rect, zoomFactor: number): Rect {
  const z = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  return {
    x: Math.round(bounds.x * z),
    y: Math.round(bounds.y * z),
    width: Math.round(bounds.width * z),
    height: Math.round(bounds.height * z),
  };
}

function isAbortError(error: unknown): boolean {
  const err = error as { code?: unknown; errno?: unknown } | null;
  return !!err && (err.code === 'ERR_ABORTED' || err.errno === -3);
}

export class PreviewController {
  private readonly entries = new Map<string, PreviewEntry>();
  /** Partitionen mit Download-Sperre (Ereignis-Listener nur einmal registrieren). */
  private readonly downloadBlocked = new Set<string>();

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly pickerScript: string,
    private readonly onPick: (projectId: string, payload: PickPayload) => void,
    private readonly onState: (projectId: string, state: PreviewState) => void,
    private readonly openUrlExternally: (url: string) => void = (url) => {
      void shell.openExternal(url).catch(() => undefined);
    },
  ) {}

  async open(projectId: string, url: string, viewport: PreviewViewport): Promise<void> {
    const host = new URL(url).host;
    let entry = this.entries.get(projectId);
    if (!entry) entry = this.createEntry(projectId, url, host, viewport);
    entry.url = url;
    entry.host = host;
    entry.viewport = viewport;
    this.attach(entry);
    this.onState(projectId, { url, status: 'starting' });
    this.applyViewport(entry);
    await this.load(entry, url);
  }

  /** Navigiert zu einem Seitenpfad der Site (z. B. `/about`); fremde Ziele werden abgelehnt. */
  async navigate(projectId: string, path: string): Promise<void> {
    const entry = this.entries.get(projectId);
    if (!entry) throw new Error('Die Web-Vorschau ist nicht geöffnet');
    const target = resolvePreviewPath(entry.url, path);
    this.onState(projectId, { url: target, status: 'starting' });
    await this.load(entry, target);
  }

  setBounds(projectId: string, bounds: Rect | null): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      entry.view.setVisible(false);
      return;
    }
    this.attach(entry);
    entry.view.setVisible(true);
    entry.view.setBounds(toWindowBounds(bounds, this.zoomFactor()));
    this.applyViewport(entry);
  }

  async setPickMode(projectId: string, enabled: boolean): Promise<void> {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    entry.pickMode = enabled;
    await this.injectPicker(entry);
  }

  /** Aktuell angezeigte Seite (nur URLs des Vorschau-Servers), sonst die Basis-URL; `null` ohne Vorschau. */
  currentUrl(projectId: string): string | null {
    const entry = this.entries.get(projectId);
    if (!entry) return null;
    const wc = entry.view.webContents;
    const current = wc.isDestroyed() ? '' : wc.getURL();
    return current.startsWith('http:') && isPreviewNavigationAllowed(current, entry.host) ? current : entry.url;
  }

  async screenshot(projectId: string): Promise<Buffer | null> {
    const entry = this.entries.get(projectId);
    if (!entry || entry.view.webContents.isDestroyed()) return null;
    const image = await entry.view.webContents.capturePage();
    return image.toPNG();
  }

  close(projectId: string): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    this.entries.delete(projectId);
    this.detach(entry);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  }

  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id);
  }

  // ───────────── intern ─────────────

  private createEntry(projectId: string, url: string, host: string, viewport: PreviewViewport): PreviewEntry {
    const partition = `preview-${projectId}`; // ohne "persist:" → nur im Speicher
    this.configureSession(projectId, partition);
    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        safeDialogs: true,
        devTools: true,
      },
    });
    const entry: PreviewEntry = { view, url, host, viewport, pickMode: false, token: randomBytes(24).toString('hex'), gestures: new GestureGate(3000), attachedTo: null, rendered: false };
    const wc = view.webContents;
    const current = () => this.entries.get(projectId) === entry;

    // Klicks im Pick-Modus wählen Elemente aus – sie zählen nicht als Freigabe für externe Links.
    wc.on('input-event', (_event, input) => {
      if (!entry.pickMode) entry.gestures.note(input.type);
    });
    wc.setWindowOpenHandler(({ url: target }) => {
      this.openFromPreview(entry, target);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event) => {
      if (isPreviewNavigationAllowed(event.url, entry.host)) return;
      event.preventDefault();
      this.openFromPreview(entry, event.url);
    });
    // Unterframes (Hauptframe: will-navigate) und serverseitige Weiterleitungen: fremde Ziele nur sperren.
    wc.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && !isPreviewNavigationAllowed(event.url, entry.host)) event.preventDefault();
    });
    wc.on('will-redirect', (event) => {
      if (!isPreviewNavigationAllowed(event.url, entry.host)) event.preventDefault();
    });
    wc.on('console-message', (event) => {
      if (!current() || !entry.pickMode) return;
      if (!event.frame || event.frame !== wc.mainFrame) return;
      const payload = parsePickMessage(event.message, entry.token);
      if (payload) this.onPick(projectId, payload);
    });
    wc.on('dom-ready', () => {
      entry.rendered = true;
      if (current()) this.applyViewport(entry);
    });
    wc.on('did-finish-load', () => {
      if (!current()) return;
      void this.injectPicker(entry);
      this.onState(projectId, { url: wc.getURL() || entry.url, status: 'ready' });
    });
    wc.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
      // Abbrüche (-3) entstehen bei jeder überholten Navigation; fehlschlagende iframes betreffen die Seite nicht.
      if (!current() || !isMainFrame || code === -3) return;
      this.onState(projectId, { url: validatedURL || entry.url, status: 'error', error: description });
    });
    wc.on('render-process-gone', (_event, details) => {
      if (!current() || details.reason === 'clean-exit') return;
      this.onState(projectId, { url: entry.url, status: 'error', error: `Vorschau-Prozess beendet (${details.reason})` });
    });
    this.entries.set(projectId, entry);
    return entry;
  }

  /** Session-Regeln der Vorschau-Partition (einmal je Partition; erneutes Setzen ersetzt die Handler). */
  private configureSession(projectId: string, partition: string): void {
    const ses = electronSession.fromPartition(partition);
    const allowedHost = () => this.entries.get(projectId)?.host ?? null;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    if (!this.downloadBlocked.has(partition)) {
      this.downloadBlocked.add(partition);
      ses.on('will-download', (event) => event.preventDefault());
    }
    ses.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !isPreviewRequestAllowed(details.url, allowedHost()) });
    });
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: withPreviewCsp(details.responseHeaders, allowedHost()) });
    });
  }

  private async load(entry: PreviewEntry, url: string): Promise<void> {
    try {
      await entry.view.webContents.loadURL(url);
    } catch (error) {
      // Eine neuere Navigation hat diese überholt (z. B. schneller Viewport-Wechsel) – kein Fehler.
      if (isAbortError(error)) return;
      throw error;
    }
  }

  private openFromPreview(entry: PreviewEntry, raw: string): void {
    const url = safeExternalUrl(raw);
    if (!url || ![...this.entries.values()].includes(entry)) return;
    // Nur nach echter Nutzereingabe (Klick/Taste) – sonst könnte die Seite in einer Schleife Tabs öffnen.
    if (!entry.gestures.consume()) return;
    this.openUrlExternally(url);
  }

  private attach(entry: PreviewEntry): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed() || entry.attachedTo === win) return;
    try {
      win.contentView.addChildView(entry.view);
      entry.attachedTo = win;
    } catch {
      entry.attachedTo = null;
    }
  }

  private detach(entry: PreviewEntry): void {
    const win = entry.attachedTo;
    entry.attachedTo = null;
    if (!win || win.isDestroyed()) return;
    try {
      win.contentView.removeChildView(entry.view);
    } catch {
      // Fenster wird gerade abgebaut
    }
  }

  private zoomFactor(): number {
    const win = this.getWindow();
    try {
      return win && !win.isDestroyed() ? win.webContents.getZoomFactor() : 1;
    } catch {
      return 1;
    }
  }

  private applyViewport(entry: PreviewEntry): void {
    if (!entry.rendered || entry.view.webContents.isDestroyed()) return;
    const size = VIEWPORT_SIZES[entry.viewport];
    const bounds = entry.view.getBounds();
    // Skaliert die Seite so, dass der gewählte Viewport in die sichtbare Fläche passt.
    const scale = bounds.width > 0 ? Math.min(1, bounds.width / size.width, bounds.height > 0 ? bounds.height / size.height : 1) : 1;
    entry.view.webContents.enableDeviceEmulation({
      screenPosition: size.mobile ? 'mobile' : 'desktop',
      screenSize: { width: size.width, height: size.height },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 0,
      viewSize: { width: size.width, height: size.height },
      scale,
    });
  }

  private async injectPicker(entry: PreviewEntry): Promise<void> {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) return;
    try {
      await wc.executeJavaScriptInIsolatedWorld(PICKER_WORLD_ID, [{ code: pickerBootstrap(this.pickerScript, entry.token, entry.pickMode) }]);
    } catch {
      // Seite noch nicht bereit – wird bei did-finish-load erneut versucht.
    }
  }
}
