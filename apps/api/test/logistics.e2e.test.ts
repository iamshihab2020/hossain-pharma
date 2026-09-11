import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { schema, upsertSearchDocument, withTenant } from '@nexmarket/db';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';
import { MockCarrierAdapter } from '../src/modules/shipping/mock-carrier.adapter.js';
import { MOCK_EVENT_INTERVAL_SECONDS } from '../src/modules/shipping/mock-carrier.adapter.js';

/**
 * PRD 11 Phase 6's four acceptance criteria, over HTTP:
 *
 *   1. Pincode determines serviceability, rate and slot availability.
 *   2. An order allocates across two warehouses and produces two shipments.
 *   3. COD delivered-but-uncollected shows correctly in `cod_receivable`.
 *   4. Mock tracking emits a full event timeline.
 *
 * Its own fixture, for the reason every other e2e file states: fulfilment moves
 * stock, and three files asserting against one mutable seed is how this suite
 * broke three times in Phase 3.
 *
 * ONE SELLER, TWO WAREHOUSES - the opposite emphasis from `fulfilment.e2e`,
 * which needs two sellers to show one fulfilling while the other waits. The
 * Phase 6 criterion is about one seller's stock sitting in two buildings, and a
 * second seller would add nothing to it.
 */
let app: NestFastifyApplication;
let carrier: MockCarrierAdapter;

const NS = `logistics-${randomUUID().slice(0, 8)}`;

type Fixture = {
  orgId: string;
  listingId: string;
  price: number;
  token: string;
  dhaka: string;
  chattogram: string;
};

let seller: Fixture;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  carrier = app.get(MockCarrierAdapter);

  await buildFixture();
}, 180_000);

afterAll(async () => {
  await app?.close();
});

// ------------------------------------------------------------------- criterion 1

describe('a pincode determines serviceability, rate and slots', () => {
  it('answers with a zone, an estimate and a rate for a covered postcode', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/serviceability?postcode=1205&weightGrams=420&dispatchDays=1',
    });
    expect(res.statusCode).toBe(200);

    const body = json<{
      serviceable: boolean;
      areaName: string;
      codAllowed: boolean;
      earliestDays: number;
      latestDays: number;
      shipping: { amount: number; currency: string };
    }>(res);

    expect(body.serviceable).toBe(true);
    expect(body.areaName).toBe('Dhanmondi, Dhaka');
    // Dispatch 1 + transit 1-2. Stored apart so a courier's bad week is never
    // attributed to the seller's SLA.
    expect(body.earliestDays).toBe(2);
    expect(body.latestDays).toBe(3);
    expect(body.shipping.amount).toBe(6_000);
  });

  it('says NO for a real postcode nothing serves, and it is a 200', async () => {
    // 5820 is Panchagarh: a genuine Bangladesh postcode that the seed
    // deliberately leaves uncovered. A 404 would say the endpoint found
    // nothing, when what it found is that no courier goes there.
    const res = await app.inject({ method: 'GET', url: '/serviceability?postcode=5820' });
    expect(res.statusCode).toBe(200);
    expect(json<{ serviceable: boolean }>(res).serviceable).toBe(false);
  });

  it('charges a heavier parcel a higher band, and refuses to quote over the ceiling', async () => {
    const light = await rate(420);
    const heavy = await rate(4_000);
    expect(heavy).toBeGreaterThan(light);

    const res = await app.inject({
      method: 'GET',
      url: '/serviceability?postcode=1205&weightGrams=25000',
    });
    const body = json<{ shipping: unknown; overWeightLimit: boolean }>(res);
    // A parcel over the heaviest band needs freight. Extrapolating the top band
    // would quote a piano at suitcase rates.
    expect(body.shipping).toBeNull();
    expect(body.overWeightLimit).toBe(true);
  });

  it('withdraws cash on delivery where no courier collects it', async () => {
    const metro = await app.inject({ method: 'GET', url: '/serviceability?postcode=1205' });
    const remote = await app.inject({ method: 'GET', url: '/serviceability?postcode=4700' });

    expect(json<{ codAllowed: boolean }>(metro).codAllowed).toBe(true);
    expect(json<{ codAllowed: boolean }>(remote).codAllowed).toBe(false);
  });

  it('offers slots where there is capacity and none across a customs border', async () => {
    const dhaka = await app.inject({ method: 'GET', url: '/delivery-slots?postcode=1205' });
    const dubai = await app.inject({
      method: 'GET',
      url: '/delivery-slots?postcode=00000&country=AE',
    });

    expect(json<{ slots: unknown[] }>(dhaka).slots.length).toBeGreaterThan(0);
    // Serviceable, but no scheduled windows: a delivery slot across a customs
    // border is a promise nobody can keep. Empty is the answer, not an error.
    expect(json<{ serviceable: boolean; slots: unknown[] }>(dubai)).toMatchObject({
      serviceable: true,
      slots: [],
    });
  });
});

// ------------------------------------------------------------------- criterion 2

describe('an order allocates across two warehouses', () => {
  it('plans two parcels when one building cannot fill the line', async () => {
    // Four units wanted, three in Dhaka. The rest has to come from Chattogram.
    const { orderId } = await paidOrder('split-plan', 4, await splittableListing('split-plan'));
    await accept(orderId);

    const res = await asSeller('GET', `/seller/orders/${orderId}/dispatch-plan`);
    expect(res.statusCode).toBe(200);

    const plan = json<{
      splits: boolean;
      allocations: { warehouseName: string; picks: { quantity: number }[] }[];
      unfulfilled: unknown[];
    }>(res);

    expect(plan.splits).toBe(true);
    expect(plan.allocations).toHaveLength(2);
    expect(plan.unfulfilled).toEqual([]);
    // Highest-priority warehouse first, and it gives everything it has.
    expect(plan.allocations[0]?.picks[0]?.quantity).toBe(3);
    expect(plan.allocations[1]?.picks[0]?.quantity).toBe(1);
  });

  it('PRODUCES TWO SHIPMENTS, one per warehouse', async () => {
    const { orderId } = await paidOrder('split-dispatch', 4, await splittableListing('split-dispatch'));
    await accept(orderId);

    const res = await asSeller('POST', `/seller/orders/${orderId}/dispatch`, {
      idempotencyKey: `${NS}-split-dispatch`,
    });
    expect(res.statusCode).toBe(200);

    const result = json<{
      shipments: { id: string; shipmentNumber: string }[];
      splits: boolean;
      warehouses: { name: string }[];
    }>(res);

    expect(result.splits).toBe(true);
    expect(result.shipments).toHaveLength(2);
    expect(new Set(result.shipments.map((s) => s.id)).size).toBe(2);

    // And the order is fully covered: two parcels, four units, nothing left.
    const detail = await asSeller('GET', `/seller/orders/${orderId}`);
    expect(json<{ status: string }>(detail).status).toBe('SHIPPED');
  });

  it('records which building each parcel left', async () => {
    const { orderId } = await paidOrder('split-origin', 4, await splittableListing('split-origin'));
    await accept(orderId);
    await asSeller('POST', `/seller/orders/${orderId}/dispatch`, {
      idempotencyKey: `${NS}-split-origin`,
    });

    const origins = await withTenant(
      { tenantId: null, userId: null, isAdmin: true },
      (tx) =>
        tx
          .select({ warehouseId: schema.shipments.warehouseId })
          .from(schema.shipments)
          .where(eq(schema.shipments.orderId, orderId)),
    );

    // Both set, and different. A packing slip prints this as a return address,
    // so a parcel with no origin is a parcel nobody can send back.
    expect(origins).toHaveLength(2);
    expect(origins.every((row) => row.warehouseId !== null)).toBe(true);
    expect(new Set(origins.map((row) => row.warehouseId)).size).toBe(2);
  });

  it('lets a seller pack ONE box by hand from two buildings', async () => {
    /**
     * The manual path, which is the only one with a console behind it.
     *
     * `autoDispatch` plans a parcel per warehouse and names each one, so it
     * never asks a single inventory row for more than it holds. A seller
     * pressing "dispatch parcel" names nothing, and Phase 6 left that path
     * requiring one row to cover the whole line - the identical shape of the
     * bug it had just fixed in RESERVATION. Four units held as three plus one
     * matched no row, and the console answered "that is more than this order
     * has left" about an order with four units left.
     *
     * Reserving across buildings while being unable to ship across them is
     * worse than never splitting at all: the order is taken and then cannot
     * move.
     */
    const { orderId } = await paidOrder('split-manual', 4, await splittableListing('split-manual'));
    await accept(orderId);

    const detail = await asSeller('GET', `/seller/orders/${orderId}`);
    const itemId = json<{ items: { id: string }[] }>(detail).items[0]?.id;
    if (itemId === undefined) throw new Error('fixture: no order item');

    const res = await asSeller('POST', `/seller/orders/${orderId}/shipments`, {
      items: [{ orderItemId: itemId, quantity: 4 }],
      idempotencyKey: `${NS}-split-manual`,
      carrierName: 'Pathao',
      trackingNumber: `${NS}-MANUAL-1`,
    });
    expect(res.statusCode).toBe(201);

    // ONE parcel, because the seller packed one box - the split is in where the
    // units came from, not in how many boxes left.
    const after = await asSeller('GET', `/seller/orders/${orderId}`);
    expect(json<{ status: string }>(after).status).toBe('SHIPPED');

    // And BOTH buildings gave up stock. A single row covering all four would
    // mean the allocator's split was ignored and some other order's
    // reservation was spent instead.
    const rows = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx
        .select({
          warehouseId: schema.orderItemAllocations.warehouseId,
          quantity: schema.orderItemAllocations.quantity,
        })
        .from(schema.orderItemAllocations)
        .where(eq(schema.orderItemAllocations.orderItemId, itemId)),
    );
    expect(rows).toHaveLength(2);
    // Every allocation spent, none left holding units that already shipped.
    expect(rows.every((row) => row.quantity === 0)).toBe(true);
  });

  it('is idempotent per PARCEL, so a retry creates none of them twice', async () => {
    const { orderId } = await paidOrder('split-retry', 4, await splittableListing('split-retry'));
    await accept(orderId);

    const key = `${NS}-split-retry`;
    const first = await asSeller('POST', `/seller/orders/${orderId}/dispatch`, {
      idempotencyKey: key,
    });
    const second = await asSeller('POST', `/seller/orders/${orderId}/dispatch`, {
      idempotencyKey: key,
    });

    expect(second.statusCode).toBe(200);
    const a = json<{ shipments: { id: string }[] }>(first).shipments.map((s) => s.id).sort();
    const b = json<{ shipments: { id: string }[] }>(second).shipments.map((s) => s.id).sort();

    // The SAME two parcels, not four. One key for the whole request would have
    // made the second parcel look like a duplicate of the first.
    expect(b).toEqual(a);

    const count = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.shipments)
        .where(eq(schema.shipments.orderId, orderId)),
    );
    expect(count[0]?.n).toBe(2);
  });
});

// ------------------------------------------------------------------- criterion 4

describe('mock tracking emits a full event timeline', () => {
  it('walks a parcel through every state and lands the order on DELIVERED', async () => {
    const { orderId } = await paidOrder('tracking', 1);
    await accept(orderId);

    const dispatched = await asSeller('POST', `/seller/orders/${orderId}/dispatch`, {
      idempotencyKey: `${NS}-tracking`,
      bookCarrier: true,
    });
    const shipment = json<{ shipments: { trackingNumber: string }[] }>(dispatched).shipments[0];
    const trackingNumber = shipment?.trackingNumber;
    expect(trackingNumber).toMatch(/^NM/);
    if (trackingNumber === undefined) throw new Error('no tracking number');

    /**
     * The adapter is asked what it WOULD have emitted by now, and "now" is a
     * parameter.
     *
     * Waiting two real minutes for the compressed schedule would make this the
     * slowest test in the suite for no extra information. The schedule is
     * derived from the tracking number, so a later `now` is exactly what a
     * later webhook would carry.
     */
    const later = new Date(Date.now() + MOCK_EVENT_INTERVAL_SECONDS * 4 * 1000);
    const events = carrier.eventsSoFar(trackingNumber, later);
    expect(events.map((e) => e.type)).toEqual([
      'DISPATCHED',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);

    // Now deliver it through the webhook the way a courier would.
    const applied = await carrierWebhook(trackingNumber);
    expect(applied.statusCode).toBe(200);
    expect(json<{ applied: boolean }>(applied).applied).toBe(true);

    const detail = await asSeller('GET', `/seller/orders/${orderId}`);
    const body = json<{ status: string; timeline: { type: string }[] }>(detail);
    expect(body.status).toBe('DELIVERED');

    // The FULL timeline, not just the last state. A parcel that jumps
    // DISPATCHED to DELIVERED loses the thing this feature exists to show.
    const types = body.timeline.map((entry) => entry.type);
    expect(types).toContain('SHIPMENT_IN_TRANSIT');
    expect(types).toContain('SHIPMENT_OUT_FOR_DELIVERY');
    expect(types).toContain('SHIPMENT_DELIVERED');
  });

  it('converges on replay rather than duplicating the timeline', async () => {
    const { orderId } = await paidOrder('tracking-replay', 1);
    await accept(orderId);
    const dispatched = await asSeller('POST', `/seller/orders/${orderId}/dispatch`, {
      idempotencyKey: `${NS}-tracking-replay`,
      bookCarrier: true,
    });
    const trackingNumber = json<{ shipments: { trackingNumber: string }[] }>(dispatched)
      .shipments[0]?.trackingNumber;
    if (trackingNumber === undefined) throw new Error('no tracking number');

    await carrierWebhook(trackingNumber);
    const second = await carrierWebhook(trackingNumber);

    // A carrier's retry is not an error and must not append a second history.
    // `order_events` has UPDATE and DELETE revoked, so a duplicate there is
    // permanent.
    expect(second.statusCode).toBe(200);
    expect(json<{ applied: boolean }>(second).applied).toBe(false);

    const detail = await asSeller('GET', `/seller/orders/${orderId}`);
    const delivered = json<{ timeline: { type: string }[] }>(detail).timeline.filter(
      (entry) => entry.type === 'SHIPMENT_DELIVERED',
    );
    expect(delivered).toHaveLength(1);
  });

  it("takes the carrier's word on a tracking number the mock never minted", async () => {
    /**
     * A seller types their own number into the console and hands the box to a
     * rider. That is every manually dispatched parcel, and the mock cannot date
     * one: its history is decoded from the number IT issued.
     *
     * Refusing those made the service contradict itself - it answered "no
     * events for that tracking number" about a parcel it finds by that very
     * number one line further down. When the carrier NAMES the state, the
     * reported state is the history; only the time-compressed fallback needs a
     * number the mock minted.
     */
    const { orderId } = await paidOrder('tracking-manual', 1);
    await accept(orderId);

    const detail = await asSeller('GET', `/seller/orders/${orderId}`);
    const itemId = json<{ items: { id: string }[] }>(detail).items[0]?.id;
    if (itemId === undefined) throw new Error('fixture: no order item');

    const trackingNumber = `PT-${NS}-MANUAL`;
    await asSeller('POST', `/seller/orders/${orderId}/shipments`, {
      items: [{ orderItemId: itemId, quantity: 1 }],
      idempotencyKey: `${NS}-tracking-manual`,
      carrierName: 'Pathao',
      trackingNumber,
    });
    // Nothing the mock can read: no NM prefix, no encoded booking time.
    expect(carrier.eventsSoFar(trackingNumber, new Date())).toEqual([]);

    const applied = await carrierWebhook(trackingNumber, 'OUT_FOR_DELIVERY');
    expect(applied.statusCode).toBe(200);
    expect(json<{ applied: boolean }>(applied).applied).toBe(true);

    const moved = await asSeller('GET', `/seller/orders/${orderId}`);
    const body = json<{ status: string; timeline: { type: string }[] }>(moved);
    expect(body.status).toBe('OUT_FOR_DELIVERY');

    // The states it passed through, not just the one reported. A parcel that
    // jumps straight there loses what the timeline exists to show.
    const types = body.timeline.map((entry) => entry.type);
    expect(types).toContain('SHIPMENT_IN_TRANSIT');
    expect(types).toContain('SHIPMENT_OUT_FOR_DELIVERY');

    // And it is still replay-safe: a state already passed changes nothing.
    const replay = await carrierWebhook(trackingNumber, 'IN_TRANSIT');
    expect(replay.statusCode).toBe(200);
    expect(json<{ applied: boolean }>(replay).applied).toBe(false);
  });

  it('refuses a forged signature, and answers 200 so no retry storm starts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/shipping/mock',
      headers: { 'content-type': 'application/json', 'x-carrier-signature': 'deadbeef' },
      payload: JSON.stringify({ trackingNumber: 'NMFORGED' }),
    });

    expect(res.statusCode).toBe(200);
    expect(json<{ applied: boolean; reason: string }>(res)).toMatchObject({
      applied: false,
      reason: 'invalid signature or payload',
    });
  });
});

// ------------------------------------------------------------------- criterion 3

describe('cash on delivery, collected and reconciled', () => {
  it('lets a seller ACCEPT a COD order that has not been paid for', async () => {
    // The Phase 5 gap. A COD order sits at PENDING_PAYMENT until the cash is
    // collected, collection happens at the door, and the parcel only reaches
    // the door if somebody ships it - so before Phase 6 a COD order could never
    // be accepted, shipped, delivered or collected.
    const { orderId } = await codOrder('cod-accept', 1);
    const res = await asSeller('POST', `/seller/orders/${orderId}/accept`);
    expect(res.statusCode).toBe(200);
    expect(json<{ status: string }>(res).status).toBe('ACCEPTED');
  });

  it('refuses to accept a CARD order that was never paid for', async () => {
    // The same edge must not become a way to ship a card order for free.
    const { orderId } = await unpaidCardOrder('cod-guard');
    const res = await asSeller('POST', `/seller/orders/${orderId}/accept`);
    expect(res.statusCode).toBe(409);
    expect(json<{ code: string }>(res).code).toBe('PAYMENT_NOT_SETTLED');
  });

  it('shows a delivered-but-uncollected order as outstanding', async () => {
    const { orderId, orderNumber } = await codOrder('cod-outstanding', 1);
    await deliverFully(orderId, 'cod-outstanding');

    const res = await asSeller('GET', '/seller/cod/outstanding');
    const rows = json<{ items: { orderNumber: string }[] }>(res).items;
    expect(rows.map((row) => row.orderNumber)).toContain(orderNumber);
  });

  it('clears COD_RECEIVABLE when the cash arrives', async () => {
    const { orderId, total } = await codOrder('cod-collect', 1);
    await deliverFully(orderId, 'cod-collect');

    const before = await codReceivableBalance();

    const res = await asSeller('POST', `/seller/orders/${orderId}/cod-collection`, {
      amountMinor: total,
      idempotencyKey: `${NS}-cod-collect`,
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ collected: { amount: number } }>(res).collected.amount).toBe(total);

    // The account that has been growing since Phase 4 finally goes down.
    const after = await codReceivableBalance();
    expect(after).toBe(before - total);
  });

  it('records a SHORT collection without writing off the gap', async () => {
    // A courier can come back with less than the whole amount, and that gap is
    // the entire content of the reconciliation dashboard's third column.
    const { orderId, total } = await codOrder('cod-short', 1);
    await deliverFully(orderId, 'cod-short');

    const short = total - 500;
    const res = await asSeller('POST', `/seller/orders/${orderId}/cod-collection`, {
      amountMinor: short,
      idempotencyKey: `${NS}-cod-short`,
    });

    expect(res.statusCode).toBe(200);
    expect(json<{ outstanding: { amount: number } }>(res).outstanding.amount).toBe(500);
  });

  it('refuses to collect twice for one bundle of cash', async () => {
    const { orderId, total } = await codOrder('cod-twice', 1);
    await deliverFully(orderId, 'cod-twice');

    const first = await asSeller('POST', `/seller/orders/${orderId}/cod-collection`, {
      amountMinor: total,
      idempotencyKey: `${NS}-cod-twice`,
    });
    expect(first.statusCode).toBe(200);

    const second = await asSeller('POST', `/seller/orders/${orderId}/cod-collection`, {
      amountMinor: total,
      idempotencyKey: `${NS}-cod-twice`,
    });
    expect(second.statusCode).toBe(409);
    expect(json<{ code: string }>(second).code).toBe('ALREADY_COLLECTED');
  });

  it('refuses to collect before the parcel has arrived', async () => {
    const { orderId, total } = await codOrder('cod-early', 1);
    await accept(orderId);

    const res = await asSeller('POST', `/seller/orders/${orderId}/cod-collection`, {
      amountMinor: total,
      idempotencyKey: `${NS}-cod-early`,
    });
    // Cash on delivery collected before delivery is not cash on delivery, and
    // an order collectable from a warehouse would let a seller clear their own
    // receivable by typing a number.
    expect(res.statusCode).toBe(409);
    expect(json<{ code: string }>(res).code).toBe('NOT_DELIVERED');
  });

  it('reconciles expected, collected and outstanding to the same rows', async () => {
    const res = await asSeller('GET', '/seller/cod');
    const body = json<{
      expected: { amount: number };
      collected: { amount: number };
      outstanding: { amount: number };
      rows: { expected: { amount: number }; collected: { amount: number } | null }[];
    }>(res);

    // The three columns must agree with each other on screen, whatever else is
    // true - a dashboard whose total does not equal its rows is worse than none.
    const rowExpected = body.rows.reduce((sum, row) => sum + row.expected.amount, 0);
    const rowCollected = body.rows.reduce((sum, row) => sum + (row.collected?.amount ?? 0), 0);

    expect(body.expected.amount).toBe(rowExpected);
    expect(body.collected.amount).toBe(rowCollected);
    expect(body.outstanding.amount).toBe(rowExpected - rowCollected);
  });
});

// --------------------------------------------------------------- reverse logistics

describe('return pickup scheduling', () => {
  it('books a collection window for a delivered order', async () => {
    const { orderId, buyer } = await paidOrder('return-book', 1);
    await accept(orderId);
    await deliverFully(orderId, 'return-book');

    const slotId = await firstSlot();
    const res = await app.inject({
      method: 'POST',
      url: `/me/orders/${orderId}/return-pickup`,
      headers: { authorization: `Bearer ${buyer.token}` },
      payload: { slotId },
    });

    expect(res.statusCode).toBe(201);
    expect(json<{ status: string }>(res).status).toBe('SCHEDULED');
  });

  it('refuses a second live collection for the same order', async () => {
    const { orderId, buyer } = await paidOrder('return-twice', 1);
    await accept(orderId);
    await deliverFully(orderId, 'return-twice');

    const slotId = await firstSlot();
    await bookReturn(orderId, buyer.token, slotId);
    const second = await bookReturn(orderId, buyer.token, await firstSlot());

    // Two vans at one doorstep. A partial unique index catches it, because a
    // prior SELECT cannot under concurrency.
    expect(second.statusCode).toBe(409);
    expect(json<{ code: string }>(second).code).toBe('PICKUP_ALREADY_BOOKED');
  });

  it('refuses a collection for an order that has not arrived', async () => {
    const { orderId, buyer } = await paidOrder('return-early', 1);
    await accept(orderId);

    const res = await bookReturn(orderId, buyer.token, await firstSlot());
    // Nothing can be returned that has not arrived. An order in transit that a
    // buyer no longer wants is a CANCELLATION, which is a different operation
    // with a different ledger consequence.
    expect(res.statusCode).toBe(409);
    expect(json<{ code: string }>(res).code).toBe('NOT_DELIVERED');
  });
});

// -------------------------------------------------------------------- helpers

async function buildFixture(): Promise<void> {
  let orgId = '';
  let listingId = '';
  let dhaka = '';
  let chattogram = '';
  const price = 12_000;

  await withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const [category] = await tx
      .insert(schema.categories)
      .values({ slug: `${NS}-goods`, name: 'Goods', path: `${NS.replace(/-/g, '_')}_goods` })
      .returning({ id: schema.categories.id });
    if (!category) throw new Error('fixture: category');

    const [product] = await tx
      .insert(schema.products)
      .values({
        slug: `${NS}-crate`,
        name: 'Logistics Crate',
        categoryId: category.id,
        status: 'ACTIVE',
      })
      .returning({ id: schema.products.id });
    if (!product) throw new Error('fixture: product');

    const [variant] = await tx
      .insert(schema.productVariants)
      .values({
        productId: product.id,
        sku: `${NS}-SKU`,
        name: 'Standard',
        // Measured, so the zone rate card applies rather than the flat fallback.
        weightGrams: 800,
        lengthMm: 250,
        widthMm: 200,
        heightMm: 120,
      })
      .returning({ id: schema.productVariants.id });
    if (!variant) throw new Error('fixture: variant');

    const [org] = await tx
      .insert(schema.organisations)
      .values({
        slug: `${NS}-seller`,
        legalName: 'Logistics Ltd',
        displayName: 'Logistics Ltd',
        status: 'ACTIVE',
        countryCode: 'BD',
        defaultCurrency: 'BDT',
      })
      .returning({ id: schema.organisations.id });
    if (!org) throw new Error('fixture: org');
    orgId = org.id;

    const [listing] = await tx
      .insert(schema.listings)
      .values({
        tenantId: org.id,
        variantId: variant.id,
        status: 'ACTIVE',
        priceAmount: price,
        priceCurrency: 'BDT',
        availableStock: 400,
      })
      .returning({ id: schema.listings.id });
    if (!listing) throw new Error('fixture: listing');
    listingId = listing.id;

    /**
     * TWO warehouses with a DELIBERATE stock split: three units in the
     * priority-0 building and plenty in the second.
     *
     * Three is what makes the split criterion real. A basket of four cannot be
     * filled from Dhaka alone, so the allocator has to reach for Chattogram -
     * and a fixture with deep stock everywhere would let one warehouse serve
     * every test and prove nothing.
     */
    const [first] = await tx
      .insert(schema.warehouses)
      .values({
        tenantId: org.id,
        name: `${NS} Dhaka`,
        pincode: '1207',
        priority: 0,
        isDefault: true,
      })
      .returning({ id: schema.warehouses.id });
    const [second] = await tx
      .insert(schema.warehouses)
      .values({
        tenantId: org.id,
        name: `${NS} Chattogram`,
        pincode: '4000',
        priority: 1,
        isPickupPoint: true,
      })
      .returning({ id: schema.warehouses.id });
    if (!first || !second) throw new Error('fixture: warehouses');
    dhaka = first.id;
    chattogram = second.id;

    await tx.insert(schema.inventoryItems).values([
      { tenantId: org.id, listingId: listing.id, warehouseId: first.id, onHand: 3 },
      { tenantId: org.id, listingId: listing.id, warehouseId: second.id, onHand: 397 },
    ]);

    await tx.execute(upsertSearchDocument(product.id));
  });

  const account = await register(`${NS}-seller@example.test`);
  await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
    tx.insert(schema.orgMembers).values({ tenantId: orgId, userId: account.id, role: 'OWNER' }),
  );

  seller = { orgId, listingId, price, token: account.token, dhaka, chattogram };
}

/**
 * A listing whose stock CANNOT be filled from one building: three units in the
 * priority-0 warehouse and plenty in the second.
 *
 * One per test, because reservation consumes it. The first version shared a
 * single listing across all four split tests, and the first test drained the
 * three Dhaka units - so every later order reserved entirely from Chattogram
 * and the split it was asserting quietly stopped happening. A shared mutable
 * fixture is what `fulfilment.e2e` warns about at the top of the file, and this
 * is the same mistake one level down.
 */
async function splittableListing(label: string): Promise<string> {
  let listingId = '';

  await withTenant({ tenantId: null, userId: null, isAdmin: true }, async (tx) => {
    const [product] = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.slug, `${NS}-crate`))
      .limit(1);
    if (!product) throw new Error('fixture: product missing');

    const [variant] = await tx
      .insert(schema.productVariants)
      .values({
        productId: product.id,
        sku: `${NS}-SKU-${label}`,
        name: `Split ${label}`,
        weightGrams: 800,
        lengthMm: 250,
        widthMm: 200,
        heightMm: 120,
      })
      .returning({ id: schema.productVariants.id });
    if (!variant) throw new Error('fixture: variant');

    const [listing] = await tx
      .insert(schema.listings)
      .values({
        tenantId: seller.orgId,
        variantId: variant.id,
        status: 'ACTIVE',
        priceAmount: seller.price,
        priceCurrency: 'BDT',
        availableStock: 103,
      })
      .returning({ id: schema.listings.id });
    if (!listing) throw new Error('fixture: listing');
    listingId = listing.id;

    await tx.insert(schema.inventoryItems).values([
      { tenantId: seller.orgId, listingId: listing.id, warehouseId: seller.dhaka, onHand: 3 },
      { tenantId: seller.orgId, listingId: listing.id, warehouseId: seller.chattogram, onHand: 100 },
    ]);
  });

  return listingId;
}

async function register(email: string): Promise<{ token: string; id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'logistics-password-1', displayName: 'Logistics' },
  });
  expect(res.statusCode).toBe(201);
  const body = json<{ accessToken: string; user: { id: string } }>(res);
  return { token: body.accessToken, id: body.user.id };
}

async function createAddress(token: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/me/addresses',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      recipientName: 'Logistics Buyer',
      phone: '+8801700000000',
      line1: '1 Test Road',
      city: 'Dhaka',
      district: 'Dhaka',
      // Dhanmondi: serviceable, COD allowed, and it has slots.
      postcode: '1205',
      countryCode: 'BD',
    },
  });
  expect(res.statusCode).toBe(201);
  return json<{ id: string }>(res).id;
}

type PlacedOrder = {
  orderId: string;
  orderNumber: string;
  total: number;
  buyer: { token: string; id: string };
};

async function place(
  label: string,
  quantity: number,
  method: 'mock' | 'cod',
  listingId: string = seller.listingId,
): Promise<PlacedOrder & { intentId: string }> {
  const buyer = await register(`${NS}-${label}@example.test`);
  const addressId = await createAddress(buyer.token);

  const added = await app.inject({
    method: 'POST',
    url: '/cart/items',
    headers: { authorization: `Bearer ${buyer.token}` },
    payload: { listingId, quantity },
  });
  expect(added.statusCode).toBe(201);

  const quoteRes = await app.inject({
    method: 'GET',
    url: `/checkout/quote?addressId=${addressId}`,
    headers: { authorization: `Bearer ${buyer.token}` },
  });
  expect(quoteRes.statusCode).toBe(200);
  const quote = json<{ total: { amount: number; currency: string } }>(quoteRes);

  const confirmed = await app.inject({
    method: 'POST',
    url: '/checkout/confirm',
    headers: { authorization: `Bearer ${buyer.token}` },
    payload: {
      addressId,
      paymentMethod: method,
      idempotencyKey: `${NS}-${label}`,
      expectedTotal: quote.total,
    },
  });
  expect(confirmed.statusCode).toBe(201);
  const body = json<{
    orders: { id: string; orderNumber: string; total: { amount: number } }[];
    paymentIntentId: string;
  }>(confirmed);

  const order = body.orders[0];
  if (order === undefined) throw new Error('no order placed');

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    total: order.total.amount,
    buyer,
    intentId: body.paymentIntentId,
  };
}

/** A card order, taken to PAID through the webhook the way a gateway would. */
async function paidOrder(
  label: string,
  quantity: number,
  listingId?: string,
): Promise<PlacedOrder> {
  const placed = await place(label, quantity, 'mock', listingId ?? seller.listingId);

  const mock = app.get(
    (await import('../src/modules/payments/mock.adapter.js')).MockPaymentAdapter,
  );
  const raw = JSON.stringify({
    id: `${NS}-evt-${label}`,
    type: 'payment_succeeded',
    providerRef: `mock_${placed.intentId}`,
  });
  const delivered = await app.inject({
    method: 'POST',
    url: '/webhooks/payment/mock',
    headers: { 'content-type': 'application/json', 'x-mock-signature': mock.sign(raw) },
    payload: raw,
  });
  expect(delivered.statusCode).toBe(200);

  return placed;
}

/** A COD order, which stays PENDING_PAYMENT until the cash is collected. */
function codOrder(label: string, quantity: number): Promise<PlacedOrder> {
  return place(label, quantity, 'cod');
}

/** A card order whose payment never arrived. */
function unpaidCardOrder(label: string): Promise<PlacedOrder> {
  return place(label, 1, 'mock');
}

async function accept(orderId: string): Promise<void> {
  const res = await asSeller('POST', `/seller/orders/${orderId}/accept`);
  expect(res.statusCode).toBe(200);
}

/** Accept, dispatch everything, and mark every parcel delivered. */
async function deliverFully(orderId: string, label: string): Promise<void> {
  const detail = await asSeller('GET', `/seller/orders/${orderId}`);
  if (json<{ status: string }>(detail).status !== 'ACCEPTED') await accept(orderId);

  const dispatched = await asSeller('POST', `/seller/orders/${orderId}/dispatch`, {
    idempotencyKey: `${NS}-${label}-dispatch`,
  });
  expect(dispatched.statusCode).toBe(200);

  for (const shipment of json<{ shipments: { id: string }[] }>(dispatched).shipments) {
    const res = await asSeller(
      'POST',
      `/seller/orders/${orderId}/shipments/${shipment.id}/delivered`,
    );
    expect(res.statusCode).toBe(200);
  }
}

async function rate(weightGrams: number): Promise<number> {
  const res = await app.inject({
    method: 'GET',
    url: `/serviceability?postcode=1205&weightGrams=${weightGrams}`,
  });
  return json<{ shipping: { amount: number } }>(res).shipping.amount;
}

async function firstSlot(): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/delivery-slots?postcode=1205' });
  const slot = json<{ slots: { id: string }[] }>(res).slots[0];
  if (slot === undefined) throw new Error('no delivery slots seeded');
  return slot.id;
}

function bookReturn(
  orderId: string,
  token: string,
  slotId: string,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: `/me/orders/${orderId}/return-pickup`,
    headers: { authorization: `Bearer ${token}` },
    payload: { slotId },
  });
}

/**
 * A carrier reporting an event, the way a real one would: the body NAMES what
 * happened.
 *
 * The first version sent only the tracking number and let the mock's
 * time-compressed schedule decide - which meant a webhook fired immediately
 * after booking reported nothing, because no time had passed. Waiting two real
 * minutes in a test to observe a demo feature is the wrong trade; naming the
 * event is also what a real integration does.
 */
function carrierWebhook(
  trackingNumber: string,
  type: 'DISPATCHED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' = 'DELIVERED',
): Promise<LightMyRequestResponse> {
  const raw = JSON.stringify({ trackingNumber, type });
  return app.inject({
    method: 'POST',
    url: '/webhooks/shipping/mock',
    headers: {
      'content-type': 'application/json',
      'x-carrier-signature': signCarrier(raw),
    },
    payload: raw,
  });
}

/**
 * Signed HERE rather than by asking the adapter to sign.
 *
 * A carrier signs and we verify; an adapter with a public `sign` method would
 * let a test pass while the verification path was broken, which is the whole
 * reason the payment mock signs its own webhooks too.
 */
function signCarrier(raw: string): string {
  const secret =
    process.env['SHIPPING_WEBHOOK_SECRET'] ?? 'nexmarket-dev-shipping-secret-change-me';
  return createHmac('sha256', secret).update(raw).digest('hex');
}

async function codReceivableBalance(): Promise<number> {
  const rows = await withTenant({ tenantId: null, userId: null, isAdmin: true }, (tx) =>
    tx.execute<{ balance: string }>(sql`
      SELECT COALESCE(SUM(e.amount), 0) AS balance
        FROM ledger_entries e
        JOIN ledger_accounts a ON a.id = e.account_id
       WHERE a.kind = 'COD_RECEIVABLE'
    `),
  );
  return Number.parseInt(rows.rows[0]?.balance ?? '0', 10);
}

function asSeller(
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${seller.token}`,
    'x-tenant-id': seller.orgId,
  };
  if (payload === undefined) return app.inject({ method, url, headers });

  headers['content-type'] = 'application/json';
  return app.inject({ method, url, headers, payload });
}

function json<T>(res: LightMyRequestResponse): T {
  return JSON.parse(res.body) as T;
}
