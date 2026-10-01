import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'fal',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 30000,
  },
});
