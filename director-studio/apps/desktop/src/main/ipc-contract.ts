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
  'getLineage',
  'relinkAsset',
  'getVersion',
  'restoreVersion',
  'transcribe',
  'assetPeaks',
  'previewOpen',
  'previewSetBounds',
  'previewSetPickMode',
  'previewOpenExternal',
  'previewNavigate',
  'exportProject',
  'openExternal',
] as const satisfies ReadonlyArray<Exclude<keyof StudioApi, LocalMethod>>;

export type StudioMethod = (typeof STUDIO_METHODS)[number];

/** Methoden, die die Preload-Schicht selbst umsetzt (kein IPC). */
type LocalMethod = 'assetUrl' | 'onEvent' | 'pathForFile';

/** Kompilierzeit-Prüfung: Jede StudioApi-Methode hat einen IPC-Kanal (sonst fehlt sie in `window.studio`). */
type MissingIpcMethods = Exclude<keyof StudioApi, StudioMethod | LocalMethod>;
export const IPC_COVERS_STUDIO_API: [MissingIpcMethods] extends [never] ? true : { missing: MissingIpcMethods } = true;

/** Methoden, die externe Programme öffnen: nur unmittelbar nach einer Nutzereingabe im Hauptfenster. */
export const GESTURE_METHODS: ReadonlySet<StudioMethod> = new Set<StudioMethod>(['openExternal', 'previewOpenExternal']);

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
