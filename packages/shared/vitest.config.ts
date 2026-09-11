import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: [
        'src/money.ts',
        'src/capabilities.ts',
        'src/buy-box.ts',
        'src/ledger.ts',
        'src/pricing.ts',
        'src/order-state.ts',
        'src/fulfilment.ts',
        'src/logistics.ts',
        'src/allocation.ts',
        'src/reviews.ts',
      ],
      // PRD section 13: 100 percent on pricing, on the 5.3 capability matrix -
      // an authorisation table where a missed branch is a missed permission - and
      // on the 8.3 buy box, where a missed branch is the wrong seller getting the
      // sale and nobody noticing - and, from Phase 4, on the 10.1 ledger, where a
      // missed branch is money that does not add up.
      // Not negotiable downward -
      // if this fails, add the missing test rather than lowering the threshold.
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
