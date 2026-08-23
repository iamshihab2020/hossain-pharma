import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
  // Vitest 4 transforms with oxc, which supports legacy decorators and
  // design-time metadata. HealthController uses constructor injection
  // specifically so the suite proves that metadata is being emitted; if it
  // stops, the health test fails to construct the controller and goes red.
});
