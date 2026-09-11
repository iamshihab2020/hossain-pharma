import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testcontainers pulls and boots a real Postgres. RLS cannot be mocked
    // meaningfully (PRD 7.3), so these suites are worth the wall-clock.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: 'forks',

    /**
     * FOUR containers at a time, not nine.
     *
     * Nine of the files here start their own Postgres, and the default fork
     * count is one per core - twelve on this machine, so every one of them
     * booted at once. Memory is the binding constraint rather than CPU (8 GB
     * with Docker running), and the suite began failing a file at random under
     * a full `pnpm test` while passing every time on its own. A gate that
     * depends on what else is running is a gate people re-run instead of read.
     *
     * Four is measured, not guessed: it keeps the wall-clock within a few
     * seconds of unbounded when this package runs alone, and it is what stops
     * the whole repo's test run from over-committing the box.
     */
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      // PRD section 13: 100 percent on RLS. client.ts is excluded because it is
      // singleton wiring that reads DATABASE_URL at import; the logic it binds
      // is tenant-context.ts, which is covered here in full.
      include: ['src/tenant-context.ts', 'src/assert-driver.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
