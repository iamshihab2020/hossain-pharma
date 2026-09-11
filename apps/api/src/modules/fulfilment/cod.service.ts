import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { schema } from '@nexmarket/db';
import { codCollectionEntries, money } from '@nexmarket/shared';
import { getRequestContext } from '../../common/request-context.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OrderEventsService } from './order-events.service.js';

export type CodCollectionView = {
  orderId: string;
  orderNumber: string;
  expected: { amount: number; currency: string };
  collected: { amount: number; currency: string };
  outstanding: { amount: number; currency: string };
  collectedAt: string;
};

export type CodReconciliation = {
  currency: string;
  expected: { amount: number; currency: string };
  collected: { amount: number; currency: string };
  outstanding: { amount: number; currency: string };
  rows: CodOutstandingRow[];
};

export type CodOutstandingRow = {
  orderId: string;
  orderNumber: string;
  status: string;
  expected: { amount: number; currency: string };
  collected: { amount: number; currency: string } | null;
  deliveredAt: string | null;
};

/**
 * Cash on delivery, collected and reconciled.
 *
 * PRD 10.1 names this as the reason the ledger earns its place: "money arrives
 * days after the order, sometimes partially, sometimes never. A `cod_receivable`
 * account tracks the gap between delivered and collected, and the
 * reconciliation dashboard reads straight off it."
 *
 * This closes the hole Phase 4 opened deliberately and Phase 5 could not fill:
 * COD_ACCRUAL debited COD_RECEIVABLE at placement and nothing ever credited it
 * back, so every COD order the system had ever taken sat in that account
 * forever.
 */
@Injectable()
export class CodService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly events: OrderEventsService,
  ) {}

  /**
   * Records cash taken at the door.
   *
   * DELIVERY IS THE PRECONDITION, and it is not bureaucracy: cash on delivery
   * collected before delivery is not cash on delivery, and an order that could
   * be marked collected while still in a warehouse would let a seller clear
   * their own receivable by typing a number.
   */
  async collect(
    orderId: string,
    input: { amountMinor: number; idempotencyKey: string },
  ): Promise<CodCollectionView> {
    const { tx, userId } = getRequestContext();

    const [order] = await tx
      .select({
        id: schema.orders.id,
        tenantId: schema.orders.tenantId,
        buyerUserId: schema.orders.buyerUserId,
        paymentIntentId: schema.orders.paymentIntentId,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        totalAmount: schema.orders.totalAmount,
        currency: schema.orders.currency,
        codCollectedAt: schema.orders.codCollectedAt,
        provider: schema.paymentIntents.provider,
      })
      .from(schema.orders)
      .innerJoin(
        schema.paymentIntents,
        eq(schema.paymentIntents.id, schema.orders.paymentIntentId),
      )
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    // A 404, not a 403: under RLS an order that is not yours does not exist.
    if (order === undefined) throw new NotFoundException('No such order');

    if (order.provider !== 'cod') {
      throw new ConflictException({
        code: 'NOT_A_COD_ORDER',
        message: 'That order was paid by card. There is no cash to collect.',
      });
    }
    if (order.status !== 'DELIVERED') {
      throw new ConflictException({
        code: 'NOT_DELIVERED',
        message: 'Cash is collected at the door. Mark the order delivered first.',
      });
    }

    if (input.amountMinor <= 0) {
      throw new BadRequestException('A collection must be a positive amount');
    }
    if (input.amountMinor > order.totalAmount) {
      throw new BadRequestException(
        'A collection cannot exceed what the buyer owes for this order',
      );
    }

    /**
     * Idempotent by CONDITIONAL UPDATE, which is this codebase's rule for
     * anything that moves money: check and write in one statement so two
     * concurrent submissions cannot both pass.
     *
     * `codCollectedAt IS NULL` in the WHERE is the guard. A courier's handheld
     * that retries, or a seller who double-clicks, updates zero rows the second
     * time and posts nothing - rather than crediting COD_RECEIVABLE twice for
     * one bundle of cash.
     */
    const collectedAt = new Date();
    const updated = await tx
      .update(schema.orders)
      .set({
        codCollectedAt: collectedAt,
        codCollectedAmount: input.amountMinor,
        updatedAt: collectedAt,
      })
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.codCollectedAt)))
      .returning({ id: schema.orders.id });

    if (updated.length === 0) {
      throw new ConflictException({
        code: 'ALREADY_COLLECTED',
        message: 'Cash for this order has already been recorded as collected.',
      });
    }

    const collected = money(input.amountMinor, order.currency);
    await this.ledger.post(tx, {
      paymentIntentId: order.paymentIntentId,
      kind: 'COD_COLLECTION',
      entries: codCollectionEntries(collected),
    });

    await this.events.record(tx, order, {
      type: 'COD_COLLECTED',
      actor: 'SELLER',
      actorUserId: userId,
      payload: {
        amountMinor: input.amountMinor,
        currency: order.currency,
        /**
         * The SHORTFALL is recorded on the event, not just derivable from it.
         * "Collected 2000 of 2400" is what a dispute six months from now needs
         * to read without recomputing an order total that may have been
         * partially cancelled since.
         */
        expectedMinor: order.totalAmount,
        shortfallMinor: order.totalAmount - input.amountMinor,
        idempotencyKey: input.idempotencyKey,
      },
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      expected: money(order.totalAmount, order.currency),
      collected,
      outstanding: money(order.totalAmount - input.amountMinor, order.currency),
      collectedAt: collectedAt.toISOString(),
    };
  }

  /**
   * The reconciliation view: collected against expected, and what is still out
   * there.
   *
   * TENANT-SCOPED by RLS, so a seller sees their own cash and nobody else's -
   * which is the whole reason this can be an ordinary read rather than needing
   * an escape. The platform-wide version is Phase 11's admin dashboard and
   * reads the same rows with `app.is_admin`.
   *
   * Counts only DELIVERED orders. An undelivered COD order is not outstanding
   * cash, it is an undelivered order, and mixing the two makes the number
   * useless for the thing it exists to answer: how much are couriers holding.
   */
  async reconciliation(): Promise<CodReconciliation> {
    const { tx } = getRequestContext();

    const rows = await tx
      .select({
        orderId: schema.orders.id,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        totalAmount: schema.orders.totalAmount,
        currency: schema.orders.currency,
        codCollectedAmount: schema.orders.codCollectedAmount,
        codCollectedAt: schema.orders.codCollectedAt,
      })
      .from(schema.orders)
      .innerJoin(
        schema.paymentIntents,
        eq(schema.paymentIntents.id, schema.orders.paymentIntentId),
      )
      .where(
        and(
          eq(schema.paymentIntents.provider, 'cod'),
          eq(schema.orders.status, 'DELIVERED'),
        ),
      )
      .orderBy(sql`${schema.orders.codCollectedAt} NULLS FIRST`, schema.orders.orderNumber);

    const currency = rows[0]?.currency ?? 'BDT';
    let expected = 0;
    let collected = 0;

    const view: CodOutstandingRow[] = rows.map((row) => {
      expected += row.totalAmount;
      collected += row.codCollectedAmount ?? 0;
      return {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        status: row.status,
        expected: money(row.totalAmount, row.currency),
        collected:
          row.codCollectedAmount === null
            ? null
            : money(row.codCollectedAmount, row.currency),
        deliveredAt: row.codCollectedAt?.toISOString() ?? null,
      };
    });

    return {
      currency,
      expected: money(expected, currency),
      collected: money(collected, currency),
      /**
       * Expected minus collected, computed from the same rows rather than read
       * off the ledger. The ledger is the source of truth for the BALANCE; this
       * is the per-order breakdown, and computing them from one query keeps the
       * three columns arithmetically consistent with each other on screen. A
       * test asserts the total agrees with COD_RECEIVABLE.
       */
      outstanding: money(expected - collected, currency),
      rows: view,
    };
  }

  /** Orders whose cash is still with a courier. The console's default filter. */
  async outstanding(): Promise<CodOutstandingRow[]> {
    const { tx } = getRequestContext();

    const rows = await tx
      .select({
        orderId: schema.orders.id,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        totalAmount: schema.orders.totalAmount,
        currency: schema.orders.currency,
      })
      .from(schema.orders)
      .innerJoin(
        schema.paymentIntents,
        eq(schema.paymentIntents.id, schema.orders.paymentIntentId),
      )
      .where(
        and(
          eq(schema.paymentIntents.provider, 'cod'),
          eq(schema.orders.status, 'DELIVERED'),
          isNull(schema.orders.codCollectedAt),
        ),
      )
      .orderBy(schema.orders.orderNumber);

    return rows.map((row) => ({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      status: row.status,
      expected: money(row.totalAmount, row.currency),
      collected: null,
      deliveredAt: null,
    }));
  }

  /** Collected orders, for the console's second tab. */
  async collected(): Promise<CodOutstandingRow[]> {
    const { tx } = getRequestContext();

    const rows = await tx
      .select({
        orderId: schema.orders.id,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        totalAmount: schema.orders.totalAmount,
        currency: schema.orders.currency,
        codCollectedAmount: schema.orders.codCollectedAmount,
        codCollectedAt: schema.orders.codCollectedAt,
      })
      .from(schema.orders)
      .innerJoin(
        schema.paymentIntents,
        eq(schema.paymentIntents.id, schema.orders.paymentIntentId),
      )
      .where(
        and(
          eq(schema.paymentIntents.provider, 'cod'),
          isNotNull(schema.orders.codCollectedAt),
        ),
      )
      .orderBy(schema.orders.orderNumber);

    return rows.map((row) => ({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      status: row.status,
      expected: money(row.totalAmount, row.currency),
      collected:
        row.codCollectedAmount === null ? null : money(row.codCollectedAmount, row.currency),
      deliveredAt: row.codCollectedAt?.toISOString() ?? null,
    }));
  }
}
