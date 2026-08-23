import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/money.ts'],
      // PRD section 13: 100 percent on pricing. Not negotiable downward -
      // if this fails, add the missing test rather than lowering the threshold.
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
