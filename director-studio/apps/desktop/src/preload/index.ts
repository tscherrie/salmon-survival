import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { StudioApi, StudioEvent } from '@studio/core';
import { buildAssetUrl } from '../main/asset-protocol.ts';
import { channelFor, EVENT_CHANNEL, isIpcError, STUDIO_METHODS } from '../main/ipc-contract.ts';

/**
 * Preload (contextIsolation + sandbox): stellt `window.studio` als StudioApi bereit. Der Renderer bekommt
 * keinen Node-Zugriff und keine Keys – nur diese schmale, typisierte Oberfläche.
 */

const api: Record<string, unknown> = {};

for (const method of STUDIO_METHODS) {
  api[method] = async (...args: unknown[]) => {
    const result = await ipcRenderer.invoke(channelFor(method), ...args);
    if (isIpcError(result)) {
      const error = new Error(result.message);
      error.name = result.name;
      throw error;
    }
    return result;
  };
}

api.assetUrl = (projectId: string, assetId: string, variant?: 'original' | 'proxy' | 'thumb') => buildAssetUrl(projectId, assetId, variant);

api.onEvent = (listener: (event: StudioEvent) => void) => {
  const handler = (_: unknown, event: StudioEvent) => listener(event);
  ipcRenderer.on(EVENT_CHANNEL, handler);
  return () => {
    ipcRenderer.removeListener(EVENT_CHANNEL, handler);
  };
};

/** Pfad einer per Drag & Drop abgelegten Datei (Electron ≥ 32: `webUtils.getPathForFile`). */
api.pathForFile = (file: File) => webUtils.getPathForFile(file);

contextBridge.exposeInMainWorld('studio', api as unknown as StudioApi);
