import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/money.ts', 'src/capabilities.ts', 'src/buy-box.ts'],
      // PRD section 13: 100 percent on pricing, on the 5.3 capability matrix -
      // an authorisation table where a missed branch is a missed permission - and
      // on the 8.3 buy box, where a missed branch is the wrong seller getting the
      // sale and nobody noticing.
      // Not negotiable downward -
      // if this fails, add the missing test rather than lowering the threshold.
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
