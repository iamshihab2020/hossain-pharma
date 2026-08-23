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
  },
  // Vitest 4 transforms with oxc, which supports legacy decorators and
  // design-time metadata. HealthController uses constructor injection
  // specifically so this suite proves that metadata is emitted; if it stops,
  // the controller fails to construct and these tests go red.
});
