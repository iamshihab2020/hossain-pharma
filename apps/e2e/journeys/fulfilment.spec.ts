import { expect, test } from '@playwright/test';
import { fillAddress, registerBuyer, signIn } from '../fixtures/actors.js';
import { settlePayment } from '../fixtures/gateway.js';

/**
 * PRD §4.3 S2 continued: ship → deliver.
 *
 * And the half of Phase 5's acceptance criterion that is VISIBLE - a seller
 * fulfils their own order while the buyer's other two sit untouched. The
 * invisible half, that the two parcels' releases sum exactly to the order
 * total, is asserted in `apps/api/test/fulfilment.e2e.test.ts` to the minor
 * unit. Repeating arithmetic through a browser buys a second thing to update
 * and no new information.
 *
 * `e2e-seller@example.test` owns exactly ONE organisation, Bengal Tech, which
 * is what makes the console's acting-org resolution deterministic. See
 * `scripts/reset-db.ts`.
 */

const SELLER = { email: 'e2e-seller@example.test', password: 'nexmarket-demo' };
const SELLER_NAME = 'Bengal Tech';

test('a seller ships part of an order and the buyer watches it move', async ({
  page,
  request,
}) => {
  // --- a buyer places a basket that includes Bengal Tech --------------------
  const buyer = await registerBuyer(page, 'e2e-fulfil');

  await page.goto('/search?q=redmi');
  await page.getByRole('link', { name: /redmi/i }).first().click();

  const offers = page.getByRole('radio');
  await expect(offers.first()).toBeVisible();

  // Bengal Tech specifically, because that is the org the seller owns. Picking
  // by index would fulfil whichever seller happened to win the buy box today.
  await page.getByRole('radio').filter({ hasText: SELLER_NAME }).click();
  await page.getByRole('button', { name: /add to cart/i }).click();
  await expect(page.getByRole('button', { name: /added to cart/i })).toBeVisible();

  // Two more sellers, so "the others are untouched" is a claim with subjects.
  for (const index of [0, 1]) {
    const other = offers.filter({ hasNotText: SELLER_NAME }).nth(index);
    await other.click();
    await page.getByRole('button', { name: /add to cart/i }).click();
    await expect(page.getByRole('button', { name: /added to cart/i })).toBeVisible();
  }

  await page.goto('/checkout');
  await fillAddress(page);

  // CARD, not the cash-on-delivery default. A COD order stays PENDING_PAYMENT
  // until the cash is collected, and collection is Phase 6 - so a COD order
  // cannot be accepted today and this journey would have nothing to fulfil.
  await page.getByText('Card', { exact: true }).click();

  await page.getByRole('button', { name: /place order|pay and place order/i }).click();
  await page.waitForURL(/\/orders\?placed=/, { timeout: 30_000 });

  // The gateway calls back. Without this the orders sit at PENDING_PAYMENT and
  // no seller can accept them - the storefront cannot advance payment status,
  // by design.
  await settlePayment(request, buyer.email);

  // WHICH order, exactly.
  //
  // The buyer journey in the other file also places an order against Bengal
  // Tech, so the seller's queue holds more than one - and `.first()` picked
  // whichever sorted first, which is how this suite passed twice and then
  // failed. Reading the number here makes the rest of the journey name its
  // subject instead of guessing at it.
  await page.goto('/orders');
  const mine = page.getByRole('listitem').filter({ hasText: SELLER_NAME });
  const orderNumber = (await mine.getByText(/NM-/).innerText()).trim();
  expect(orderNumber).toMatch(/^NM-/);

  // --- the seller accepts, ships part of it, and delivers it ----------------
  await page.context().clearCookies();
  await signIn(page, SELLER);

  await page.goto('/seller/orders');
  await expect(page.getByRole('heading', { name: /orders to fulfil/i })).toBeVisible();
  await page.getByRole('link', { name: orderNumber }).click();

  await page.getByRole('button', { name: /accept this order/i }).click();
  await expect(page.getByText(/accepted/i).first()).toBeVisible();

  await page.getByPlaceholder(/carrier/i).fill('Pathao');
  await page.getByPlaceholder(/tracking/i).fill('PT-E2E-1');
  await page.getByRole('button', { name: /dispatch parcel/i }).click();

  // The parcel arrives, and the button naming it is the seller's confirmation
  // that the dispatch landed rather than silently failing.
  const delivered = page.getByRole('button', { name: /SHP-.* arrived/i });
  await expect(delivered).toBeVisible();
  await delivered.click();

  // --- the buyer sees it move, and only that one ---------------------------
  await page.context().clearCookies();
  await signIn(page, buyer);

  await page.goto('/orders');
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(3);

  // Exactly one order moved. The other two are still where the payment left
  // them - which is the Phase 5 acceptance criterion, seen from the buyer's
  // side rather than asserted against the database.
  await expect(page.getByText('Delivered', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Paid', { exact: true })).toHaveCount(2);

  // THE ORDER THAT SHIPPED, by name.
  //
  // `.first()` picked whichever of the buyer's three orders sorted first, and
  // only one of them was ever fulfilled - so two runs in three landed on an
  // untouched order and reported that the dispatch had not happened, while the
  // list beside it correctly read "Delivered".
  //
  // A fresh navigation rather than a click: going through Next's client router
  // can serve a payload for this route captured before the seller touched the
  // order, because the seller's actions revalidate /seller/orders and never the
  // buyer's /orders/[id].
  const href = await page
    .getByRole('listitem')
    .filter({ hasText: orderNumber })
    .getByRole('link')
    .getAttribute('href');
  expect(href, 'the fulfilled order should be in the buyer list').not.toBeNull();
  await page.goto(href ?? '/orders');
  await expect(page.getByRole('heading', { name: orderNumber })).toBeVisible();

  // The tracking number appears TWICE, and both are deliberate: on the parcel
  // card, where it is the most useful string on the page once a box is moving,
  // and in the timeline entry that records the dispatch. Asserting both is
  // stronger than picking one and is why this is not a `.first()`.
  await expect(page.getByText(/Dispatched with Pathao/i)).toBeVisible();
  await expect(page.getByText('PT-E2E-1', { exact: true })).toBeVisible();
  await expect(page.getByText('Tracking PT-E2E-1')).toBeVisible();
});
