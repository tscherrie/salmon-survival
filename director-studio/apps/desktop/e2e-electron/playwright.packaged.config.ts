import { defineConfig } from '@playwright/test';

/**
 * Prüft die GEPACKTE App (vorher `npm run dist:test` = dist.mjs --dir --test-fuses: Playwright steuert Electron über
 * die Inspektor-Argumente, die die ausgelieferte App per Fuse abschaltet). Unter Linux mit xvfb-run starten:
 *   xvfb-run -a npm run test:packaged
 * Anderer Ort der App: STUDIO_PACKAGED_APP=/pfad/zum/Binary. Chromium: Die App stellt Remotions Headless-Shell selbst
 * bereit; ohne Netz legt der Test STUDIO_TEST_HEADLESS_SHELL (Standard: Playwrights Headless-Shell) in Remotions
 * Cache, mit STUDIO_PACKAGED_DOWNLOAD=1 lädt die App sie wirklich herunter.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'packaged.spec.ts',
  timeout: 600_000,
  workers: 1,
  reporter: [['list']],
});
