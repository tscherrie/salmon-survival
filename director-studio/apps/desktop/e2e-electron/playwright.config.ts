import { defineConfig } from '@playwright/test';

/** Smoke-Test der echten Electron-App (Main + Preload + Renderer-Build). Unter Linux mit xvfb-run starten. */
export default defineConfig({
  testDir: '.',
  // Die gepackte App prüft playwright.packaged.config.ts (npm run test:packaged).
  testIgnore: 'packaged.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
});
