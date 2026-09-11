import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../a11y/scan.js';
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
  // Not buyer-facing, so outside S10's letter - included because the browser is
  // already here and a console nobody can operate by keyboard is still a
  // console somebody cannot do their job in.
  await expectNoSeriousA11yViolations(page, 'seller queue');
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
  await expectNoSeriousA11yViolations(page, 'order detail');
  await expect(page.getByText(/Dispatched with Pathao/i)).toBeVisible();
  await expect(page.getByText('PT-E2E-1', { exact: true })).toBeVisible();
  await expect(page.getByText('Tracking PT-E2E-1')).toBeVisible();

  // --- and the buyer reviews what arrived ----------------------------------
  //
  // PRD S2's `review` step, which this spec listed as "Phase 7, absent on
  // purpose rather than forgotten" until Phase 7 landed. It belongs HERE rather
  // than in a spec of its own for the reason the whole step exists: only a
  // DELIVERED purchase can be reviewed, and this is the only journey that
  // delivers one.
  await page.goto('/reviews');
  await expect(page.getByRole('heading', { name: /reviews to write/i })).toBeVisible();

  /**
   * EXACTLY ONE, out of three orders.
   *
   * The buyer placed three and only one was delivered, so this is the
   * verified-purchase rule seen from the outside: the other two are paid for
   * and still offer nothing to review. A page that listed all three would be
   * offering lines the server then refuses.
   */
  // The star fieldset's own legend, not `locator('form')` - the site header
  // carries a search form, so counting forms counted that too.
  const pending = page.getByText(/^How was /);
  await expect(pending).toHaveCount(1);
  await expect(page.getByText(orderNumber)).toBeVisible();

  await expectNoSeriousA11yViolations(page, 'reviews to write');

  // THE LABEL, not the input. The radio is `sr-only` and its star sits on top
  // of it, so a click aimed at the input is intercepted by the glyph - which is
  // also what would happen to a person aiming at the input, if anyone could see
  // it. Clicking the label is what a user actually does, and it is how the slot
  // picker is driven in the logistics journey for the same reason.
  await page.locator('label[for="star-4"]').click();
  await page.getByLabel(/headline/i).fill('Arrived quickly');
  await page.getByLabel(/other buyers/i).fill('Packed well and the tracking was accurate.');
  await page.getByRole('button', { name: /post review/i }).click();

  // The confirmation arrives via a REDIRECT, not via state in the form: a
  // Server Action refreshes the route it was called from and unmounts the form
  // with it, so a success flag set client-side never paints. Checkout carries
  // its confirmation the same way, in `/orders?placed=`.
  await expect(page).toHaveURL(/\/reviews\?posted=/);
  await expect(page.getByText(/review posted/i)).toBeVisible();

  // And it cannot be written twice - the line is gone from the list.
  await expect(page.getByText(/^How was /)).toHaveCount(0);
  await expect(page.getByText(/nothing waiting/i)).toBeVisible();

  // --- a stranger sees it on the product page ------------------------------
  //
  // SIGNED OUT, which is the whole reason `reviews`, `product_ratings` and
  // `seller_ratings` are platform-owned with no RLS: the reader a rating exists
  // for carries no session and has chosen no seller.
  await page.context().clearCookies();
  await page.goto('/search?q=redmi');
  await page.getByRole('link', { name: /redmi/i }).first().click();

  const reviews = page.getByRole('region', { name: /what buyers said/i });
  await expect(reviews.getByText('Arrived quickly')).toBeVisible();
  // The headline figure and the count, both visible text. The screen-reader
  // strings say "4.0 out of 5" for the average and "Rated 4 out of 5" for the
  // one review, which is the distinction a listener needs and the reason they
  // are worded apart.
  await expect(reviews.getByText('4.0', { exact: true })).toBeVisible();
  await expect(reviews.getByText('1 review')).toBeVisible();
  // Who sold it, on a page where several sellers offer the same product - the
  // fact that actually varies, unlike a verified badge every review carries.
  await expect(reviews.getByText(new RegExp(`bought from ${SELLER_NAME}`, 'i'))).toBeVisible();

  await expectNoSeriousA11yViolations(page, 'product page with reviews');
});
