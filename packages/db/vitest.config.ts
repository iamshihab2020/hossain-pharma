import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testcontainers pulls and boots a real Postgres. RLS cannot be mocked
    // meaningfully (PRD 7.3), so these suites are worth the wall-clock.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: 'forks',
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
