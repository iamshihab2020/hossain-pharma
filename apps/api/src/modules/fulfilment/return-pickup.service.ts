import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@nexmarket/db';
import { getRequestContext } from '../../common/request-context.js';
import { asTenantScope } from '../../common/tenant-scope.js';
import { OrderEventsService } from './order-events.service.js';
import { ServiceabilityService } from '../shipping/serviceability.service.js';
import { SlotsService } from '../shipping/slots.service.js';

export type ReturnPickupView = {
  id: string;
  orderId: string;
  orderNumber: string;
  status: 'SCHEDULED' | 'COLLECTED' | 'CANCELLED';
  slot: { id: string; date: string; startMinute: number; endMinute: number };
  createdAt: string;
};

/**
 * Reverse logistics: booking a courier to come and take it back.
 *
 * PRD 11 Phase 6 lists "reverse logistics (return pickup scheduling)" and this
 * is DELIBERATELY ONLY THE SCHEDULING. Reason codes, evidence photos, seller
 * inspection and the refund are the RMA workflow, which is Phase 8 and has
 * opinions this service must not pre-empt. What Phase 6 owns is the logistics
 * primitive underneath: a slot, an address, and a van.
 *
 * Booking one asserts nothing about whether the return will be ACCEPTED. That
 * is the honest shape - a buyer can book a collection and still lose the
 * dispute - and it is also why this posts nothing to the ledger.
 */
@Injectable()
export class ReturnPickupService {
  constructor(
    private readonly events: OrderEventsService,
    private readonly slots: SlotsService,
    private readonly serviceability: ServiceabilityService,
  ) {}

  /**
   * The buyer books a collection for one of their own orders.
   *
   * THE FIFTH TENANT-SCOPE ESCAPE, and `tenant-scope.ts` says to stop and ask
   * before adding one. The answer is the same as ADR 0019's for buyer
   * cancellation, which is the closest precedent: a BUYER - who is not a tenant
   * and carries no `app.tenant_id` - has to write a row to a tenant-owned table
   * belonging to exactly one seller, and the seller id comes from
   * `orders.tenant_id` read inside this transaction after `own_orders` has
   * already proved the order is the caller's. It is not tenant-scoped work
   * being done from the wrong place; there is no seller in the room.
   *
   * `return_pickups` also carries an INSERT policy for the buyer (migration
   * 0017), so the escape is belt and braces rather than the only control - but
   * the event log write goes to `order_events`, which has no buyer-insert
   * policy and never will, and that is what needs the scope.
   */
  async schedule(orderId: string, slotId: string): Promise<ReturnPickupView> {
    const { tx, userId } = getRequestContext();

    const [order] = await tx
      .select({
        id: schema.orders.id,
        tenantId: schema.orders.tenantId,
        buyerUserId: schema.orders.buyerUserId,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        shippingAddress: schema.orders.shippingAddress,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (order === undefined) throw new NotFoundException('No such order');

    /**
     * DELIVERED only.
     *
     * Nothing can be returned that has not arrived, and an order still in
     * transit that a buyer no longer wants is a CANCELLATION - a different
     * operation with a different ledger consequence, which Phase 5 already
     * built. Sending a van to collect a parcel the courier is still carrying is
     * the failure this refuses.
     */
    if (order.status !== 'DELIVERED') {
      throw new ConflictException({
        code: 'NOT_DELIVERED',
        message:
          order.status === 'CANCELLED'
            ? 'That order was cancelled. There is nothing to collect.'
            : 'You can book a return collection once the order has arrived.',
      });
    }

    const address = order.shippingAddress as { postcode?: string; countryCode?: string };
    const zone = await this.serviceability.resolve(
      tx,
      address.postcode ?? '',
      address.countryCode ?? 'BD',
    );
    if (zone === null) {
      throw new ConflictException({
        code: 'NOT_SERVICEABLE',
        message: 'No courier covers that address for collections.',
      });
    }
    if (!(await this.slots.belongsToZone(tx, slotId, zone.id))) {
      throw new ConflictException({
        code: 'SLOT_WRONG_ZONE',
        message: 'That collection window is not offered where the parcel was delivered.',
      });
    }

    return asTenantScope(tx, order.tenantId, async () => {
      /**
       * The slot is BOOKED BEFORE the row is inserted.
       *
       * If capacity has gone, this throws and nothing else has happened. The
       * other order - insert then book - would leave a pickup row pointing at a
       * window the courier cannot service, and the buyer would be told a van
       * was coming.
       */
      await this.slots.book(tx, slotId);

      const [created] = await tx
        .insert(schema.returnPickups)
        .values({
          tenantId: order.tenantId,
          orderId: order.id,
          buyerUserId: order.buyerUserId,
          slotId,
          pickupAddress: order.shippingAddress,
        })
        .returning({ id: schema.returnPickups.id, createdAt: schema.returnPickups.createdAt })
        .onConflictDoNothing();

      if (created === undefined) {
        /**
         * The partial unique index caught a second live pickup for this order.
         *
         * Releasing the slot we just took is not optional: without it a
         * duplicate request permanently consumes a unit of a courier's capacity
         * that no booking is using.
         */
        await this.slots.release(tx, slotId);
        throw new ConflictException({
          code: 'PICKUP_ALREADY_BOOKED',
          message: 'A collection is already booked for this order.',
        });
      }

      await this.events.record(tx, order, {
        type: 'RETURN_PICKUP_SCHEDULED',
        actor: 'BUYER',
        actorUserId: userId,
        payload: { pickupId: created.id, slotId },
      });

      const slot = await this.slotDetail(slotId);

      return {
        id: created.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: 'SCHEDULED' as const,
        slot,
        createdAt: created.createdAt.toISOString(),
      };
    });
  }

  /** The pickups on one order, for the buyer's order page and the seller's queue. */
  async forOrder(orderId: string): Promise<ReturnPickupView[]> {
    const { tx } = getRequestContext();

    const rows = await tx
      .select({
        id: schema.returnPickups.id,
        orderId: schema.returnPickups.orderId,
        status: schema.returnPickups.status,
        slotId: schema.returnPickups.slotId,
        createdAt: schema.returnPickups.createdAt,
        orderNumber: schema.orders.orderNumber,
        slotDate: schema.deliverySlots.slotDate,
        startMinute: schema.deliverySlots.startMinute,
        endMinute: schema.deliverySlots.endMinute,
      })
      .from(schema.returnPickups)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.returnPickups.orderId))
      .innerJoin(
        schema.deliverySlots,
        eq(schema.deliverySlots.id, schema.returnPickups.slotId),
      )
      .where(eq(schema.returnPickups.orderId, orderId));

    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      status: row.status,
      slot: {
        id: row.slotId,
        date: row.slotDate,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      },
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * The seller records that the courier came and took it.
   *
   * Still no ledger posting: the goods are moving, not the money. What happens
   * to the money depends on the inspection, which is Phase 8's.
   */
  async markCollected(pickupId: string): Promise<void> {
    const { tx } = getRequestContext();

    const updated = await tx
      .update(schema.returnPickups)
      .set({ status: 'COLLECTED', collectedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(schema.returnPickups.id, pickupId), eq(schema.returnPickups.status, 'SCHEDULED')),
      )
      .returning({ id: schema.returnPickups.id });

    if (updated.length === 0) {
      throw new NotFoundException('No scheduled collection with that id');
    }
  }

  private async slotDetail(
    slotId: string,
  ): Promise<{ id: string; date: string; startMinute: number; endMinute: number }> {
    const { tx } = getRequestContext();
    const [row] = await tx
      .select({
        id: schema.deliverySlots.id,
        slotDate: schema.deliverySlots.slotDate,
        startMinute: schema.deliverySlots.startMinute,
        endMinute: schema.deliverySlots.endMinute,
      })
      .from(schema.deliverySlots)
      .where(eq(schema.deliverySlots.id, slotId))
      .limit(1);

    if (row === undefined) throw new NotFoundException('No such delivery window');
    return {
      id: row.id,
      date: row.slotDate,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
    };
  }
}
