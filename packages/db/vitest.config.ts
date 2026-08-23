import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testcontainers pulls and boots a real Postgres. RLS cannot be mocked
    // meaningfully (PRD 7.3), so these suites are worth the wall-clock.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: 'forks',
  },
});
