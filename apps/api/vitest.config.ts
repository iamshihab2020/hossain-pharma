import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Boots a real Postgres and sets DATABASE_URL before any test file is
    // imported. Required, not convenience: @nexmarket/db reads DATABASE_URL at
    // module load, so a beforeAll would run after the pool already exists.
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    /**
     * The performance suite is excluded from `pnpm test` and run by `pnpm perf`.
     *
     * Not because it is slow - it is - but because a BENCHMARK and a functional
     * suite cannot share one database concurrently and both mean anything.
     * Vitest runs test files in parallel, so a benchmark would be timing its own
     * queries against a Postgres that eleven other files are simultaneously
     * writing to, and its numbers would describe the harness rather than the
     * code. It failed exactly that way before it was split out.
     */
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.perf.test.ts'],
  },
  // Vitest 4 transforms with oxc, which supports legacy decorators and
  // design-time metadata. HealthController uses constructor injection
  // specifically so this suite proves that metadata is emitted; if it stops,
  // the controller fails to construct and these tests go red.
});
