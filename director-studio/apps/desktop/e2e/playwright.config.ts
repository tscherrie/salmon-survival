import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * E2E gegen den Renderer im Browser-Modus (Fake-Backend, kein Electron).
 * Startet den Vite-Dev-Server des Renderers auf einem festen Port.
 */
const PORT = Number(process.env.STUDIO_E2E_PORT ?? 5198);
const appDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    // Tracing injiziert Skripte in sandboxed srcdoc-iframes (Folien/Leinwand) → Konsolenfehler. Nur bei Bedarf.
    trace: process.env.STUDIO_E2E_TRACE ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.STUDIO_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    },
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite --config vite.renderer.config.ts --port ${PORT} --strictPort`,
    cwd: appDir,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { STUDIO_RENDERER_PORT: String(PORT) },
  },
});
