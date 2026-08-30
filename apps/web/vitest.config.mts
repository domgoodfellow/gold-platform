import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // These tests talk to a real Postgres with real RLS. That is the point: an in-memory
    // fake cannot prove a policy, and a policy is what the milestone claims.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
  },
});
