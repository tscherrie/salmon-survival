import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'browser-media', include: ['test/**/*.test.ts'], testTimeout: 30000 } });
