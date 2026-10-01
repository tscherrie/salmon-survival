import type { StudioApi } from '@studio/core';
import { FakeStudioApi } from './fake/FakeStudioApi.ts';

declare global {
  interface Window {
    /** Von der Electron-Preload-Schicht per `contextBridge` bereitgestellt. */
    studio?: StudioApi;
    /** Im Browser-/Testmodus: Zugriff auf das Fake-Backend (Playwright, Konsole). */
    __studioFake?: FakeStudioApi;
  }
}

export type ApiMode = 'electron' | 'fake';

let fallback: FakeStudioApi | null = null;

/** Liefert `window.studio` (Electron) oder ein In-Memory-Fake für Browser-Dev, Tests und E2E. */
export function getStudioApi(): StudioApi {
  if (typeof window !== 'undefined' && window.studio) return window.studio;
  if (!fallback) {
    fallback = new FakeStudioApi();
    if (typeof window !== 'undefined') window.__studioFake = fallback;
  }
  return fallback;
}

export function apiModeOf(api: StudioApi): ApiMode {
  return api instanceof FakeStudioApi ? 'fake' : 'electron';
}
