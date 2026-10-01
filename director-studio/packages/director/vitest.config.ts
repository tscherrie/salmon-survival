import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'director',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 30000,
  },
});
