import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/tests/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // PostgreSQL/MySQL integration runs share one database; run files one after another.
    fileParallelism: false,
  },
});
