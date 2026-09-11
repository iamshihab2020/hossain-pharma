import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../a11y/scan.js';
import { registerBuyer, signIn } from '../fixtures/actors.js';
import { reportCarrierEvent, signedCarrierPost, type CarrierEvent } from '../fixtures/carrier.js';

/**
 * PRD §4.3 S3, the logistics path: pincode serviceability → zone rate → slot
 * selection → multi-warehouse allocation → COD collect → reconcile.
 *
 * Every step here is one a person performs in a browser, which is what makes
 * this an E2E test rather than a slower copy of `logistics.e2e.test.ts`. The
 * arithmetic - chargeable weight, the rate band, which building gave up which
 * unit - is asserted there, to the gram and the minor unit. Repeating it
 * through a browser would buy a second thing to update and no new information.
 *
 * What only a browser can prove is the part that spans the two: that an
 * unserviceable postcode reaches the buyer as a sentence, that choosing a
 * window survives the round trip into an order, that a CASH order can be
 * fulfilled at all, and that the money a courier hands back reconciles on the
 * seller's own screen.
 *
 * The stock split this depends on is made in `scripts/reset-db.ts`: three Redmi
 * units in the default building, eleven in a second one. This journey buys
 * FOUR.
 */

const SELLER = { email: 'e2e-seller@example.test', password: 'nexmarket-demo' };
const SELLER_NAME = 'Bengal Tech';
const FIRST_WAREHOUSE = 'Bengal Tech · Elephant Road';
const SECOND_WAREHOUSE = 'Bengal Tech · Tongi';

/** More than the default building holds, so the order cannot be filled from
 *  one shelf. Phase 4 answered "sold out" to exactly this. */
const UNITS = 4;

const PRODUCT = '/p/redmi-note-14-5g';
const TRACKING = 'PT-E2E-COD-1';

test('a cash order crosses two warehouses, a courier, and the reconciliation screen', async ({
  page,
  request,
}) => {
  // --- 1. serviceability, before anyone has signed in or chosen a seller ----
  //
  // PRD 8.4 puts this on the PRODUCT PAGE, which is why the four geography
  // tables are platform-owned with no RLS: the reader here has no tenant and
  // no session, and a tenant-scoped zone table answers that reader with zero
  // rows. Checking it anonymously is checking that decision.
  await page.goto(PRODUCT);

  // A real, unseeded Bangladeshi postcode. The gaps in the seed are deliberate
  // so this branch has something to render.
  await checkPostcode(page, '5820');
  await expect(page.getByText('No courier covers 5820 yet.')).toBeVisible();

  // Dinajpur: a courier goes there but will not carry cash back, which is the
  // entire reason `delivery_zones.cod_allowed` is a column and not a constant.
  await page.getByRole('button', { name: /try another postcode/i }).click();
  await checkPostcode(page, '5400');
  await expect(page.getByText('Dinajpur')).toBeVisible();
  await expect(page.getByText('Card only, no cash on delivery')).toBeVisible();
  const remote = await deliveryPrice(page);

  await page.getByRole('button', { name: /change from 5400/i }).click();
  await checkPostcode(page, '1205');
  await expect(page.getByText('Dhanmondi, Dhaka')).toBeVisible();
  const metro = await deliveryPrice(page);

  // THE ZONE RATE, as a comparison rather than a number.
  //
  // Asserting "৳60" would assert the seed's rate card and the money formatter
  // at once, and both are already tested where they live. What is worth proving
  // from here is that the same parcel to a remote district costs MORE than to
  // the metro - which is the whole of what a zone rate is, and is false the
  // moment the lookup falls back to a flat rate.
  expect(remote, `remote ${String(remote)} should exceed metro ${String(metro)}`).toBeGreaterThan(
    metro,
  );

  // --- 2. four units, which no single building can fill --------------------
  const buyer = await registerBuyer(page, 'e2e-logistics');

  await page.goto(PRODUCT);
  await page.getByRole('radio').filter({ hasText: SELLER_NAME }).click();
  await page.getByRole('button', { name: /add to cart/i }).click();
  await expect(page.getByRole('button', { name: /added to cart/i })).toBeVisible();

  await page.goto('/cart');
  const increase = page.getByRole('button', { name: 'Increase quantity' });
  for (let quantity = 1; quantity < UNITS; quantity += 1) {
    await increase.click();
    // One click at a time, each waited for. The control posts a Server Action
    // per press; firing three without waiting races the revalidation and the
    // cart settles on whichever response happened to land last.
    await expect(page.getByText(String(quantity + 1), { exact: true }).first()).toBeVisible();
  }

  // --- 3. checkout: a window, and cash ------------------------------------
  await page.goto('/checkout');
  await fillDhakaAddress(page);

  // Windows exist for this route because the zone is domestic. An
  // international one renders a sentence instead, and the picker handling that
  // is `slots.test.ts`, not this.
  const windows = page.locator('label[for^="slot-"]');
  await expect(windows.first()).toBeVisible();
  await windows.first().click();

  // The clear-it link exists only once a window is chosen, so it is the
  // evidence that the click landed rather than scrolled.
  await expect(page.getByRole('button', { name: /clear the window/i })).toBeVisible();

  // THE SLOT PICKER, specifically. `sr-only` radios inside styled labels is
  // exactly the pattern that looks right and strands a keyboard user, and it
  // is only on screen once an address resolves to a domestic zone.
  await expectNoSeriousA11yViolations(page, 'checkout with a slot picker');

  // COD is the DEFAULT in a zone that allows it - PRD 10.1's point that cash is
  // how most of this market pays, not a fallback - so the button reads "Place
  // order" rather than "Pay and place order" without anything being clicked.
  const place = page.getByRole('button', { name: 'Place order', exact: true });
  await expect(place).toBeVisible();
  await place.click();
  await page.waitForURL(/\/orders\?placed=/, { timeout: 30_000 });

  // NO gateway callback, deliberately. Cash has not been handed over, so the
  // order sits at PENDING_PAYMENT - and everything after this is the assertion
  // that a seller can still fulfil it.
  await page.goto('/orders');
  const orderNumber = (await page.getByText(/NM-/).first().innerText()).trim();
  expect(orderNumber).toMatch(/^NM-/);
  await expect(page.getByText('Awaiting payment', { exact: true })).toBeVisible();

  // --- 4. the seller ships a cash order -----------------------------------
  await page.context().clearCookies();
  await signIn(page, SELLER);

  const before = await warehouseUnits(page);

  await page.goto('/seller/orders');
  await page.getByRole('link', { name: orderNumber }).click();

  // THE CLAIM PHASE 6 MADE. `order-state.ts` allows PENDING_PAYMENT →
  // ACCEPTED and knows nothing about payment methods, because shipping before
  // the money arrives is what cash on delivery MEANS. If this button is not
  // here, a cash order can never leave the building and the whole of COD is
  // decoration.
  // The CASH label, not the generic one. A seller pressing this is agreeing
  // to two things - fulfil it, and collect at the door - and the button says so.
  await page.getByRole('button', { name: /accept and collect cash/i }).click();
  await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible();

  await page.getByPlaceholder(/carrier/i).fill('Pathao');
  await page.getByPlaceholder(/tracking/i).fill(TRACKING);
  await page.getByRole('button', { name: /dispatch parcel/i }).click();
  await expect(page.getByRole('button', { name: /SHP-.* arrived/i })).toBeVisible();

  // --- 5. both buildings gave up units ------------------------------------
  //
  // Reservation moves `reserved`; only DISPATCH moves `on_hand`, and this page
  // shows on_hand. So a fall in BOTH rows is the visible form of one order
  // picked from two shelves - the thing Phase 4 could not do and
  // `order_item_allocations` exists to record.
  const after = await warehouseUnits(page);
  expect(after[FIRST_WAREHOUSE], `${FIRST_WAREHOUSE} should have shipped units`).toBeLessThan(
    before[FIRST_WAREHOUSE] ?? 0,
  );
  expect(after[SECOND_WAREHOUSE], `${SECOND_WAREHOUSE} should have shipped units`).toBeLessThan(
    before[SECOND_WAREHOUSE] ?? 0,
  );

  // --- 6. the courier reports in ------------------------------------------
  //
  // Through the webhook rather than the seller's "arrived" button, because the
  // two are different claims: the button is a seller asserting an outcome, and
  // this is the carrier's own network moving a parcel through states nobody in
  // the app can set. OUT_FOR_DELIVERY only ever arrives this way.
  await reportCarrierEvent(request, TRACKING, 'IN_TRANSIT');
  await reportCarrierEvent(request, TRACKING, 'OUT_FOR_DELIVERY');

  // A replay of a state the parcel has already passed. Carrier events are
  // idempotent by COMPARISON over a total order rather than by a unique index,
  // so this must be accepted and change nothing - a courier retrying is normal
  // traffic, and answering it with an error turns one delivery into a storm.
  await expectIgnored(request, TRACKING, 'IN_TRANSIT');

  await page.context().clearCookies();
  await signIn(page, buyer);
  await page.goto('/orders');
  await expect(page.getByText('Out for delivery', { exact: true })).toBeVisible();

  await reportCarrierEvent(request, TRACKING, 'DELIVERED');
  await page.goto('/orders');
  await expect(page.getByText('Delivered', { exact: true })).toBeVisible();

  // --- 7. the cash comes back, and the three figures agree ----------------
  await page.context().clearCookies();
  await signIn(page, SELLER);
  await page.goto('/seller/cod');

  // Only DELIVERED orders count as outstanding. An undelivered cash order is
  // not money a courier is holding, it is an undelivered order, and mixing the
  // two makes the number useless for the question the screen exists to answer.
  const row = page.getByRole('row').filter({ hasText: orderNumber });
  await expect(row).toBeVisible();

  // A dense console table of money, which is where a screen reader needs the
  // column headers to be doing their job.
  await expectNoSeriousA11yViolations(page, 'cash on delivery');

  const expected = await figure(page, 'Expected').innerText();
  await expect(figure(page, 'Outstanding')).toHaveText(expected);

  await row.getByRole('button', { name: 'Record' }).click();

  // Reconciled: everything expected has been collected, the outstanding figure
  // has gone to nothing, and the row has moved out of the waiting list.
  await expect(page.getByText(/nothing outstanding/i)).toBeVisible();
  await expect(figure(page, 'Collected')).toHaveText(expected);
  // Zero renders without decimals - `formatMoney` drops them when there are
  // none to show - so this matches both forms rather than pinning the one the
  // formatter happens to use today.
  await expect(figure(page, 'Outstanding')).toHaveText(/^৳0(\.00)?$/);
  await expect(page.getByText('Settled in full').first()).toBeVisible();
});

// ---- helpers ---------------------------------------------------------------

async function checkPostcode(page: Page, postcode: string): Promise<void> {
  await page.getByLabel('Delivery postcode').fill(postcode);
  await page.getByRole('button', { name: 'Check delivery' }).click();
}

/**
 * The delivery price out of the answered sentence, in minor units.
 *
 * The answer is a row of spans - area, window, price, and sometimes a cash
 * warning - rather than one string, so this reads the one ending in "delivery"
 * and takes its digits. Free delivery carries no digits and returns 0, which is
 * the right number for it.
 */
async function deliveryPrice(page: Page): Promise<number> {
  const text = await page.getByText(/delivery$/).first().innerText();
  const digits = text.replace(/\D/g, '');
  return digits === '' ? 0 : Number.parseInt(digits, 10);
}

/** Units on hand per warehouse, read off the seller's own table. */
async function warehouseUnits(page: Page): Promise<Record<string, number>> {
  await page.goto('/seller/warehouses');
  await expect(page.getByRole('heading', { name: 'Warehouses' })).toBeVisible();

  const units: Record<string, number> = {};
  for (const name of [FIRST_WAREHOUSE, SECOND_WAREHOUSE]) {
    const row = page.getByRole('row').filter({ hasText: name });
    const text = await row.getByRole('cell').last().innerText();
    units[name] = Number.parseInt(text.replace(/\D/g, ''), 10);
  }
  return units;
}

/** One of the three reconciliation numbers, found by the term beside it. */
function figure(page: Page, label: string): Locator {
  return page.getByRole('term').filter({ hasText: label }).locator('+ dd');
}

/**
 * An event the parcel has already passed, which must be accepted and ignored.
 *
 * Not `reportCarrierEvent`: that one asserts `applied: true`, and the whole
 * point here is that a replay is answered 200 and changes nothing.
 */
async function expectIgnored(
  request: APIRequestContext,
  trackingNumber: string,
  type: CarrierEvent,
): Promise<void> {
  const response = await signedCarrierPost(request, trackingNumber, type);

  expect(response.status(), 'a replay is normal carrier traffic, never an error').toBe(200);
  expect(JSON.parse(await response.text()) as { applied: boolean }).toMatchObject({
    applied: false,
  });
}

/**
 * The checkout address form, with Dhanmondi rather than the shared fixture's.
 *
 * `fixtures/actors.ts` waits for the place-order button under either name;
 * this journey wants the cash one specifically, and asserting that here rather
 * than widening the shared helper leaves the other two journeys alone.
 */
async function fillDhakaAddress(page: Page): Promise<void> {
  await page.getByLabel('Full name').fill('E2E Buyer');
  await page.getByLabel('Phone').fill('+8801700000000');
  await page.getByLabel('Address', { exact: true }).fill('12 Elephant Road');
  await page.getByLabel('City').fill('Dhaka');
  await page.getByLabel('District').fill('Dhaka');
  await page.getByLabel('Postcode').fill('1205');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByRole('button', { name: /place order/i })).toBeVisible();
}
