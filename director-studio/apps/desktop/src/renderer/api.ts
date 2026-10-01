import type { StudioApi } from '@studio/core';
import type { FakeStudioApi } from './fake/FakeStudioApi.ts';

declare global {
  interface Window {
    /** Von der Electron-Preload-Schicht per `contextBridge` bereitgestellt. */
    studio?: StudioApi;
    /** Im Browser-/Testmodus: Zugriff auf das Fake-Backend (Playwright, Konsole). */
    __studioFake?: FakeStudioApi;
  }
}

export type ApiMode = 'electron' | 'fake' | 'native';

let fallback: Promise<StudioApi> | null = null;

/**
 * Liefert `window.studio` (Electron) oder – nur im Browser-Dev-Modus, in Tests und E2E – ein
 * In-Memory-Fake. Das Fake wird dynamisch geladen und landet so nicht im Electron-Startpfad.
 */
export function getStudioApi(): Promise<StudioApi> {
  if (typeof window !== 'undefined' && window.studio) return Promise.resolve(window.studio);
  fallback ??= import('./fake/FakeStudioApi.ts').then(({ FakeStudioApi }) => {
    // `?large=1` legt zusätzlich ein 5-Minuten-Stresstest-Projekt an (Performance der Timeline),
    // `?empty=1` startet ohne Demo-Projekte (Leerzustand des Startbildschirms).
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    const fake = new FakeStudioApi({ largeDemo: params.has('large'), ...(params.has('empty') ? { seed: false } : {}) });
    if (typeof window !== 'undefined') window.__studioFake = fake;
    return fake;
  });
  return fallback;
}

/** Fake-Backend erkennt man an seinem `debug`-Griff (kein `instanceof`, damit das Fake optional bleibt). */
export function apiModeOf(api: StudioApi): ApiMode {
  return (api as { isNative?: boolean }).isNative ? 'native' : (api as { isFake?: boolean }).isFake === true ? 'fake' : 'electron';
}
