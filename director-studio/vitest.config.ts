import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/desktop/vitest.config.ts', 'apps/desktop/vitest.main.config.ts'],
  },
});
