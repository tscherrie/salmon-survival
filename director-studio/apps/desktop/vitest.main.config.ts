import { defineConfig } from 'vitest/config';

/** Tests des Electron-Hauptprozesses (Node-Umgebung, ohne Electron-Laufzeit). */
export default defineConfig({
  test: {
    name: 'desktop-main',
    include: ['test-main/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
});
