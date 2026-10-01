import type { StudioApi } from '@studio/core';

/**
 * Alle asynchronen StudioApi-Methoden, die per IPC (`ipcRenderer.invoke('studio:<name>', …)`) laufen.
 * `assetUrl` (synchron) und `onEvent` (Ereigniskanal) werden in der Preload-Schicht direkt umgesetzt.
 */
export const STUDIO_METHODS = [
  'getSettings',
  'updateSettings',
  'setSecret',
  'getAuthStatus',
  'listRecentProjects',
  'createProject',
  'openProject',
  'getSnapshot',
  'chooseDirectory',
  'chooseFiles',
  'sendMessage',
  'interrupt',
  'answerQuestion',
  'decideCheckpoint',
  'decideApproval',
  'setEffort',
  'listModels',
  'refreshModels',
  'setPicker',
  'importFiles',
  'searchAssets',
  'revealAsset',
  'getVersion',
  'restoreVersion',
  'transcribe',
  'assetPeaks',
  'previewOpen',
  'previewSetBounds',
  'previewSetPickMode',
  'previewOpenExternal',
  'exportProject',
  'openExternal',
] as const satisfies ReadonlyArray<Exclude<keyof StudioApi, 'assetUrl' | 'onEvent'>>;

export type StudioMethod = (typeof STUDIO_METHODS)[number];

export const EVENT_CHANNEL = 'studio:event';

export function channelFor(method: StudioMethod): string {
  return `studio:${method}`;
}

/** Fehler über IPC transportierbar machen (Electron serialisiert nur message). */
export interface IpcErrorPayload {
  __studioError: true;
  message: string;
  name: string;
}

export function isIpcError(value: unknown): value is IpcErrorPayload {
  return typeof value === 'object' && value !== null && (value as IpcErrorPayload).__studioError === true;
}
