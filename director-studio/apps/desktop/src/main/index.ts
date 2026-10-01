import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, screen, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StudioEvent } from '@studio/core';
import { PICKER_SCRIPT } from '@studio/render/browser';
import { prepareRuntimeDir, systemCheckText } from './app-env.ts';
import { ASSET_SCHEME, createAssetHandler } from './asset-protocol.ts';
import { StudioBackend } from './backend.ts';
import { extendGuiPath } from './ffmpeg.ts';
import { channelFor, EVENT_CHANNEL, GESTURE_METHODS, STUDIO_METHODS, type IpcErrorPayload } from './ipc-contract.ts';
import { buildMenuTemplate } from './menu.ts';
import { PreviewController } from './preview.ts';
import { GestureGate, isAllowedAppSubframeUrl, isAppUrl, safeExternalUrl } from './security.ts';

/**
 * Electron-Hauptprozess: Fenster, Sicherheitsrichtlinien, `studio-asset://`-Protokoll, IPC-Brücke zum
 * StudioBackend. Der Renderer hat keinen Node-Zugriff (contextIsolation + sandbox).
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const isSmokeTest = process.env.STUDIO_SMOKE_TEST === '1';
const rendererEntry = join(here, '../renderer/index.html');
const devUrl = process.env.STUDIO_RENDERER_URL;
/** Einstieg der App. Das Hauptfenster darf nichts anderes laden (Navigationssperre, IPC-Absenderprüfung). */
const appUrl = devUrl ?? pathToFileURL(rendererEntry).href;

const APP_NAME = 'Director Studio';
/** Fenstergrößen laut DESIGN.md §2.3 (empfohlenes Minimum 1180 × 720). */
const WINDOW = { width: 1600, height: 1000, minWidth: 1180, minHeight: 720 };

// Isolierter Datenordner (Tests, mehrere Profile).
if (process.env.STUDIO_USER_DATA) app.setPath('userData', process.env.STUDIO_USER_DATA);

// Aus Finder/Dock gestartet fehlen unter macOS die Homebrew-Ordner im PATH (ffmpeg, git …).
const guiPath = extendGuiPath(process.platform, process.env.PATH);
if (guiPath !== undefined) process.env.PATH = guiPath;

// Ausgelieferte App: beschreibbarer Arbeitsordner (Remotion lädt seine Headless-Shell relativ dazu).
if (app.isPackaged) {
  try {
    process.chdir(prepareRuntimeDir(app.getPath('userData')));
  } catch (error) {
    console.warn('Arbeitsordner konnte nicht vorbereitet werden:', error);
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

let mainWindow: BrowserWindow | null = null;
let backend: StudioBackend | null = null;
let preview: PreviewController | null = null;
/** Letzte echte Nutzereingabe im Hauptfenster: externe Links nur nach Klick/Taste. */
const mainGestures = new GestureGate(5000);

function broadcast(event: StudioEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(EVENT_CHANNEL, event);
}

/** Öffnet nur geprüfte http(s)-Links im System-Browser. */
async function openExternalSafely(raw: string): Promise<void> {
  const url = safeExternalUrl(raw);
  if (!url) throw new Error('Nur http(s)-Links können geöffnet werden');
  await shell.openExternal(url);
}

async function createWindow(): Promise<void> {
  // Auf kleineren Bildschirmen (z. B. 13-Zoll-MacBook) passt sich die Startgröße dem Arbeitsbereich an.
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.max(WINDOW.minWidth, Math.min(WINDOW.width, area.width)),
    height: Math.max(WINDOW.minHeight, Math.min(WINDOW.height, area.height)),
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    show: false,
    backgroundColor: '#111214',
    title: APP_NAME,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      navigateOnDragDrop: false,
      spellcheck: true,
    },
  });
  mainWindow = win;
  const wc = win.webContents;
  wc.on('input-event', (_event, input) => mainGestures.note(input.type));
  wc.setWindowOpenHandler(({ url }) => {
    if (mainGestures.consume()) void openExternalSafely(url).catch(() => undefined);
    return { action: 'deny' };
  });
  // Navigationssperre: Der Hauptframe bleibt auf dem App-Einstieg (in Produktion genau diese file://-Datei;
  // ein Origin-Vergleich hilft dort nicht, weil alle file:-URLs den Origin "null" haben). Unterframes
  // (srcdoc-Bühnen) dürfen nur about:/data:/blob: bzw. den App-Origin laden.
  const allowed = (url: string, isMainFrame: boolean) => (isMainFrame ? isAppUrl(url, appUrl) : isAllowedAppSubframeUrl(url, appUrl));
  wc.on('will-navigate', (event) => {
    if (!allowed(event.url, true)) event.preventDefault();
  });
  wc.on('will-frame-navigate', (event) => {
    if (!allowed(event.url, event.isMainFrame)) event.preventDefault();
  });
  wc.on('will-redirect', (event) => {
    if (!allowed(event.url, event.isMainFrame)) event.preventDefault();
  });
  wc.session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    // Nur das Mikrofon (Push-to-Talk) und nur für die App selbst; Kamera, Bildschirm usw. werden abgelehnt.
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    const audioOnly = permission === 'media' && mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
    callback(audioOnly && details.isMainFrame && isAppUrl(details.requestingUrl, appUrl));
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    // Vorschau-Views hängen am Fenster; ohne Fenster sollen keine KI-Seiten im Hintergrund weiterlaufen.
    preview?.closeAll();
  });
  win.once('ready-to-show', () => win.show());
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(rendererEntry);
}

/** Nur der App-Einstieg im Hauptframe des Hauptfensters darf das Backend aufrufen. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const win = mainWindow;
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  const frame = event.senderFrame;
  return !!frame && !frame.parent && isAppUrl(frame.url, appUrl);
}

function registerIpc(target: StudioBackend): void {
  for (const method of STUDIO_METHODS) {
    ipcMain.handle(channelFor(method), async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) {
        return { __studioError: true, name: 'SecurityError', message: 'Unbekannter Absender' } satisfies IpcErrorPayload;
      }
      if (GESTURE_METHODS.has(method) && !mainGestures.consume()) {
        return { __studioError: true, name: 'SecurityError', message: 'Links werden nur nach einem Klick geöffnet' } satisfies IpcErrorPayload;
      }
      try {
        const fn = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
        if (typeof fn !== 'function') throw new Error(`Methode ${method} nicht implementiert`);
        return await fn.apply(target, args);
      } catch (error) {
        const err = error as Error;
        return { __studioError: true, name: err.name || 'Error', message: err.message || String(err) } satisfies IpcErrorPayload;
      }
    });
  }
}

async function main(): Promise<void> {
  await app.whenReady();
  preview = new PreviewController(
    () => mainWindow,
    PICKER_SCRIPT,
    (projectId, payload) => backend?.handlePreviewPick(projectId, payload),
    (projectId, state) => broadcast({ type: 'preview_state', projectId, ...state }),
    (url) => void openExternalSafely(url).catch(() => undefined),
  );
  backend = new StudioBackend({
    appDataDir: app.getPath('userData'),
    documentsDir: app.getPath('documents'),
    tempDir: app.getPath('temp'),
    cipher: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (data) => safeStorage.decryptString(data),
    },
    dialogs: {
      chooseDirectory: async () => {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
          : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      chooseFiles: async () => {
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] })
          : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
        return result.canceled ? [] : result.filePaths;
      },
    },
    shell: {
      openExternal: (url) => openExternalSafely(url),
      showItemInFolder: (path) => shell.showItemInFolder(path),
    },
    preview,
    emit: broadcast,
    runtime: {
      // Mitgelieferte ffmpeg/ffprobe (extraResources, optional) und Chromium-Bereitstellung nur in der gepackten App.
      bundledFfmpegDir: app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : undefined,
      provisionChromium: app.isPackaged,
    },
  });
  protocol.handle(ASSET_SCHEME, createAssetHandler((projectId, assetId, variant) => backend!.resolveAssetFile(projectId, assetId, variant)));
  registerIpc(backend);
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion() });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        platform: process.platform,
        isDev: !app.isPackaged,
        appName: APP_NAME,
        actions: {
          openDataFolder: () => void shell.openPath(app.getPath('userData')),
          openProjectsFolder: () => void openProjectsFolder().catch((error) => console.error('Projektordner:', error)),
          showSystemCheck: () => void showSystemCheck().catch((error) => console.error('Systemprüfung:', error)),
        },
      }),
    ),
  );
  await createWindow();
  if (isSmokeTest) console.log('STUDIO_SMOKE_READY');
}

async function openProjectsFolder(): Promise<void> {
  if (!backend) return;
  const { projectsDir } = await backend.getSettings();
  await mkdir(projectsDir, { recursive: true });
  await shell.openPath(projectsDir);
}

/** Hilfe → Systemprüfung: gefundene Werkzeuge, Chromium und Datenordner. */
async function showSystemCheck(): Promise<void> {
  if (!backend) return;
  const text = systemCheckText({
    media: await backend.mediaToolsStatus(),
    chromium: process.env.STUDIO_CHROMIUM_PATH ?? null,
    provisionChromium: app.isPackaged,
    userData: app.getPath('userData'),
  });
  const options = { type: text.ok ? ('info' as const) : ('warning' as const), title: 'Systemprüfung', message: text.message, detail: text.detail, buttons: ['OK'] };
  if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options);
  else await dialog.showMessageBox(options);
}

function focusMainWindow(): void {
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else if (backend) {
    void createWindow().catch((error) => console.error('Fenster konnte nicht geöffnet werden:', error));
  }
}

// Nur eine Instanz je Datenordner: Eine zweite startet kein Backend, sondern holt das vorhandene Fenster nach vorn.
const gotLock = isSmokeTest || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => focusMainWindow());

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || isSmokeTest) app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && backend) void createWindow().catch((error) => console.error('Fenster konnte nicht geöffnet werden:', error));
  });

  // Geordnet herunterfahren (Dev-Server/Kindprozesse stoppen, Indizes schließen), erst dann beenden.
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting || !backend) return;
    event.preventDefault();
    quitting = true;
    const hardExit = setTimeout(() => app.exit(0), 10_000);
    void backend
      .shutdown()
      .catch((error: unknown) => console.error('Herunterfahren fehlgeschlagen:', error))
      .finally(() => {
        clearTimeout(hardExit);
        app.quit();
      });
  });

  void main().catch((error) => {
    console.error('Start fehlgeschlagen:', error);
    app.exit(1);
  });
}
