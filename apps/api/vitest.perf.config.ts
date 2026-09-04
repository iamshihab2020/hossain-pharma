import { defineConfig } from 'vitest/config';

/**
 * The performance suite, on its own.
 *
 * Same Testcontainers Postgres, same application, but ONE file at a time and
 * nothing else running against the database. `fileParallelism: false` is the
 * whole point: a benchmark sharing a database with a functional suite measures
 * the contention, not the query.
 *
 * Run with `pnpm --filter @nexmarket/api perf`. CI runs it as its own job for
 * the same reason.
 */
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    include: ['test/**/*.perf.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
