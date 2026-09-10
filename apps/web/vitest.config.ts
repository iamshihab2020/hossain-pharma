import { defineConfig } from 'vitest/config';

/**
 * NODE environment, deliberately - no jsdom.
 *
 * `apps/web` renders server components, which a DOM testing library cannot
 * meaningfully drive, so this suite tests the pure view helpers in `lib/` and
 * the server actions' input parsing. Behaviour lives in the API's e2e suite,
 * against a real server. See `lib/order-timeline.test.ts` for the reasoning.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
});
