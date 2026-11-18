import { defineConfig } from 'vitest/config';

// Climate and conversion tests run real simulations on small grids: a few seconds
// each on a loaded or slow machine (GitHub runners have 2 cores). Vitest's default
// 5 s timeout made them fail intermittently.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
