import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Each test file starts an embedded PostgreSQL; WASM start-up needs more than the default.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
