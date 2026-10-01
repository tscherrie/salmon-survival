import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'render',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 30000,
  },
});
