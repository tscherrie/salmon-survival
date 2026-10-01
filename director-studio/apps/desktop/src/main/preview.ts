import { BrowserWindow, session as electronSession, shell, WebContentsView } from 'electron';
import type { PreviewViewport, Rect } from '@studio/core';

/**
 * Eingebettete Web-Vorschau (eigenes Chromium-WebContents) für Websites des Directors.
 * Sicherheit: In-Memory-Partition je Projekt, kein Preload, keine Node-Integration, Sandbox, keine Popups,
 * Navigation nur innerhalb des lokalen Vorschau-Servers. Element-Picks kommen über Konsolen-Nachrichten.
 */

export const VIEWPORT_SIZES: Record<PreviewViewport, { width: number; height: number; mobile: boolean }> = {
  mobile: { width: 390, height: 844, mobile: true },
  tablet: { width: 820, height: 1180, mobile: true },
  desktop: { width: 1440, height: 900, mobile: false },
};

export const PICK_PREFIX = '__STUDIO_PICK__';

export interface PickPayload {
  selector: string;
  bbox: Rect;
  text?: string;
  tag?: string;
  dataSid?: string | null;
  dataSrc?: string | null;
  page?: string;
}

interface PreviewEntry {
  view: WebContentsView;
  url: string;
  viewport: PreviewViewport;
  pickMode: boolean;
}

export class PreviewController {
  private readonly entries = new Map<string, PreviewEntry>();

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly pickerScript: string,
    private readonly onPick: (projectId: string, payload: PickPayload) => void,
    private readonly onState: (projectId: string, state: { url: string | null; status: 'starting' | 'ready' | 'error'; error?: string }) => void,
  ) {}

  async open(projectId: string, url: string, viewport: PreviewViewport): Promise<void> {
    let entry = this.entries.get(projectId);
    if (!entry) {
      const partition = `preview-${projectId}`; // ohne "persist:" → nur im Speicher
      const ses = electronSession.fromPartition(partition);
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      const view = new WebContentsView({
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: true,
        },
      });
      const origin = new URL(url).origin;
      view.webContents.setWindowOpenHandler(({ url: target }) => {
        void shell.openExternal(target);
        return { action: 'deny' };
      });
      view.webContents.on('will-navigate', (event) => {
        if (new URL(event.url).origin !== origin) {
          event.preventDefault();
          void shell.openExternal(event.url);
        }
      });
      view.webContents.on('console-message', (details) => {
        const message = details.message;
        if (typeof message === 'string' && message.startsWith(PICK_PREFIX)) {
          try {
            this.onPick(projectId, JSON.parse(message.slice(PICK_PREFIX.length)) as PickPayload);
          } catch {
            // ungültige Nachricht ignorieren
          }
        }
      });
      view.webContents.on('did-finish-load', () => {
        void this.injectPicker(projectId);
        this.onState(projectId, { url: this.entries.get(projectId)?.url ?? url, status: 'ready' });
      });
      view.webContents.on('did-fail-load', (_e, code, description) => {
        if (code !== -3) this.onState(projectId, { url, status: 'error', error: description });
      });
      entry = { view, url, viewport, pickMode: false };
      this.entries.set(projectId, entry);
      this.getWindow()?.contentView.addChildView(view);
    }
    entry.url = url;
    entry.viewport = viewport;
    this.onState(projectId, { url, status: 'starting' });
    this.applyViewport(entry);
    await entry.view.webContents.loadURL(url);
  }

  setBounds(projectId: string, bounds: Rect | null): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      entry.view.setVisible(false);
      return;
    }
    entry.view.setVisible(true);
    entry.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
    this.applyViewport(entry);
  }

  async setPickMode(projectId: string, enabled: boolean): Promise<void> {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    entry.pickMode = enabled;
    await this.injectPicker(projectId);
  }

  openExternal(projectId: string): void {
    const entry = this.entries.get(projectId);
    if (entry) void shell.openExternal(entry.url);
  }

  async screenshot(projectId: string): Promise<Buffer | null> {
    const entry = this.entries.get(projectId);
    if (!entry) return null;
    const image = await entry.view.webContents.capturePage();
    return image.toPNG();
  }

  close(projectId: string): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    this.getWindow()?.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    this.entries.delete(projectId);
  }

  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id);
  }

  private applyViewport(entry: PreviewEntry): void {
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

  private async injectPicker(projectId: string): Promise<void> {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    const wc = entry.view.webContents;
    try {
      await wc.executeJavaScript(`${this.pickerScript};void 0;`);
      await wc.executeJavaScript(entry.pickMode ? 'window.__studioPicker && window.__studioPicker.enable();' : 'window.__studioPicker && window.__studioPicker.disable();');
    } catch {
      // Seite noch nicht bereit – wird bei did-finish-load erneut versucht.
    }
  }
}
