import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'project',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 30000,
  },
});
