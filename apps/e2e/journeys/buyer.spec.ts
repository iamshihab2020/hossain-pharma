import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../a11y/scan.js';
import { fillAddress, registerBuyer } from '../fixtures/actors.js';

/**
 * PRD §4.3 S2, as far as Phase 5 reaches:
 *
 *   browse → search → cart (3 sellers) → checkout → 3 orders
 *
 * The rest of S2 - ship and deliver - is `fulfilment.spec.ts`, and
 * review/return/refund are Phases 7 and 8 and are absent on purpose rather than
 * forgotten.
 *
 * THREE SELLERS is the clause that makes this a marketplace test. One seller
 * would satisfy the sentence while proving nothing about the split that is the
 * whole point of the product.
 *
 * What this does NOT do is re-assert arithmetic. `apps/api/test/checkout.e2e`
 * proves the ledger balances to the minor unit; repeating that through a
 * browser buys a second thing to update and no new information.
 */
test('a basket spanning three sellers becomes three orders', async ({ page }) => {
  await registerBuyer(page, 'e2e-buyer');

  // --- browse and search ---------------------------------------------------
  await page.goto('/search?q=redmi');
  const result = page.getByRole('link', { name: /redmi/i }).first();
  await expect(result).toBeVisible();
  await result.click();

  // --- the buy box ---------------------------------------------------------
  // The heading counts the competing sellers, and the footnote states the
  // basis. An estimate presented as a quote is the thing buyers never forgive,
  // so the page has to say which basis it used.
  await expect(page.getByRole('heading', { name: /sellers have this/i })).toBeVisible();
  // Anchored, because the page carries TWO sentences about ranking - the buy
  // box's own footnote and a separate explainer further down. An unanchored
  // match hits both and Playwright refuses to guess.
  await expect(page.getByText(/^Ranked by delivered price\./)).toBeVisible();

  // PRD S10, on the page that carries the most of this product's meaning: a
  // comparison table a screen reader has to be able to read as a comparison.
  await expectNoSeriousA11yViolations(page, 'product page');

  // Rows carry radio semantics: selecting one is what the Add button acts on.
  const offers = page.getByRole('radio');
  expect(await offers.count()).toBeGreaterThanOrEqual(3);

  // --- three different sellers into one cart -------------------------------
  for (let index = 0; index < 3; index += 1) {
    await offers.nth(index).click();
    await page.getByRole('button', { name: /add to cart/i }).click();
    // The button confirms in place; waiting for it is what keeps the next
    // click from landing before this add has been accepted.
    await expect(page.getByRole('button', { name: /added to cart/i })).toBeVisible();
  }

  await page.goto('/cart');
  await expect(page.getByText(/3 sellers/i)).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'cart');

  // --- checkout ------------------------------------------------------------
  await page.getByRole('link', { name: /checkout/i }).click();
  await expect(page).toHaveURL(/\/checkout/);

  await fillAddress(page);
  // AFTER the address is saved, so the scan sees the payment panel rather than
  // the form that precedes it - two different screens at one URL.
  await expectNoSeriousA11yViolations(page, 'checkout');

  await page.getByRole('button', { name: /place order|pay and place order/i }).click();

  // --- three orders --------------------------------------------------------
  // WAIT for the redirect rather than navigating over it. Checkout is a server
  // action, and a `goto('/orders')` fired straight after the click aborts it
  // mid-flight - which looks exactly like a checkout that silently did nothing:
  // an empty orders page and a cart that still holds three items.
  await page.waitForURL(/\/orders\?placed=/, { timeout: 30_000 });

  const orders = page.getByRole('listitem');
  await expect(orders).toHaveCount(3);

  // One payment, three orders, three DIFFERENT sellers - PRD 9.1's per-seller
  // order numbers.
  const numbers = await page.getByText(/NM-/).allTextContents();
  expect(new Set(numbers).size).toBe(3);
});
