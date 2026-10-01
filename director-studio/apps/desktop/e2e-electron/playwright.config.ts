import { defineConfig } from '@playwright/test';

/** Smoke-Test der echten Electron-App (Main + Preload + Renderer-Build). Unter Linux mit xvfb-run starten. */
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
});
