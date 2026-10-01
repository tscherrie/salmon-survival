import { defineConfig } from '@playwright/test';

/**
 * Prüft die GEPACKTE App (vorher `npm run dist:dir`). Unter Linux mit xvfb-run starten:
 *   xvfb-run -a npm run test:packaged
 * Anderer Ort der App: STUDIO_PACKAGED_APP=/pfad/zum/Binary. Chromium für die Renderings: STUDIO_CHROMIUM_PATH
 * (sonst lädt die App Remotions Headless-Shell selbst herunter).
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'packaged.spec.ts',
  timeout: 600_000,
  workers: 1,
  reporter: [['list']],
});
