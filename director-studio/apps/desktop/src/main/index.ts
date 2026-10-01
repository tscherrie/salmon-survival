import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StudioEvent } from '@studio/core';
import { PICKER_SCRIPT } from '@studio/render/browser';
import { ASSET_SCHEME, createAssetHandler } from './asset-protocol.ts';
import { StudioBackend } from './backend.ts';
import { channelFor, EVENT_CHANNEL, STUDIO_METHODS, type IpcErrorPayload } from './ipc-contract.ts';
import { PreviewController } from './preview.ts';

/**
 * Electron-Hauptprozess: Fenster, Sicherheitsrichtlinien, `studio-asset://`-Protokoll, IPC-Brücke zum
 * StudioBackend. Der Renderer hat keinen Node-Zugriff (contextIsolation + sandbox).
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const isSmokeTest = process.env.STUDIO_SMOKE_TEST === '1';

protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock() && !isSmokeTest) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let backend: StudioBackend | null = null;

function broadcast(event: StudioEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(EVENT_CHANNEL, event);
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    backgroundColor: '#111214',
    title: 'Director Studio',
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => {
    const current = mainWindow?.webContents.getURL();
    if (current && new URL(event.url).origin !== new URL(current).origin) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    // Mikrofon für Push-to-Talk erlauben, alles andere ablehnen.
    callback(permission === 'media');
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  const devUrl = process.env.STUDIO_RENDERER_URL;
  if (devUrl) await mainWindow.loadURL(devUrl);
  else await mainWindow.loadFile(join(here, '../renderer/index.html'));
}

function registerIpc(target: StudioBackend): void {
  for (const method of STUDIO_METHODS) {
    ipcMain.handle(channelFor(method), async (event, ...args: unknown[]) => {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        return { __studioError: true, name: 'SecurityError', message: 'Unbekannter Absender' } satisfies IpcErrorPayload;
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
  const preview = new PreviewController(
    () => mainWindow,
    PICKER_SCRIPT,
    (projectId, payload) => backend?.handlePreviewPick(projectId, payload),
    (projectId, state) => broadcast({ type: 'preview_state', projectId, ...state }),
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
      openExternal: (url) => shell.openExternal(url),
      showItemInFolder: (path) => shell.showItemInFolder(path),
    },
    preview,
    emit: broadcast,
  });
  protocol.handle(ASSET_SCHEME, createAssetHandler((projectId, assetId, variant) => backend!.resolveAssetFile(projectId, assetId, variant)));
  registerIpc(backend);
  Menu.setApplicationMenu(buildMenu());
  await createWindow();
  if (isSmokeTest) console.log('STUDIO_SMOKE_READY');
}

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || isSmokeTest) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('before-quit', () => {
  void backend?.shutdown();
});

void main().catch((error) => {
  console.error('Start fehlgeschlagen:', error);
  app.exit(1);
});
