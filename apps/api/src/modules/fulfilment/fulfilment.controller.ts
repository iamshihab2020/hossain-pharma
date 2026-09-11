import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiTags } from '@nestjs/swagger';
import { RequireCapability } from '../../common/decorators/capabilities.decorator.js';
import type { OrderDetailView } from '../orders/orders.service.js';
import {
  parseAutoDispatch,
  parseBuyerCancel,
  parseCodCollection,
  parseCreateShipment,
  parseReject,
  parseReturnPickup,
  parseSellerCancel,
} from './dto.js';
import { CodService, type CodCollectionView, type CodOutstandingRow } from './cod.service.js';
import { ReturnPickupService, type ReturnPickupView } from './return-pickup.service.js';
import {
  FulfilmentService,
  type AutoDispatchResult,
  type DispatchPlanView,
  type ShipmentView,
} from './fulfilment.service.js';

/**
 * The seller's fulfilment verbs.
 *
 * `order:write` rather than a role name (ADR 0013). Note what it is NOT: the
 * suspension withdrawal set is `product:write`, `settings:write`, `payout:write`
 * and `member:write`, and `order:write` is deliberately absent - PRD 6.6
 * requires a suspended seller to keep fulfilling orders they have already taken
 * money for.
 *
 * Every route is a VERB. Nothing here accepts a status to set: the status is a
 * consequence of what the verb did, computed from line coverage, and an
 * endpoint that took one would be a way to make the column disagree with the
 * parcels underneath it.
 */
@ApiTags('fulfilment')
@Controller('seller/orders/:id')
export class SellerFulfilmentController {
  constructor(
    private readonly fulfilment: FulfilmentService,
    private readonly cod: CodService,
  ) {}

  @Post('accept')
  @HttpCode(200)
  @RequireCapability('order:write')
  async accept(@Param('id') id: string): Promise<OrderDetailView> {
    return this.fulfilment.accept(id);
  }

  @Post('reject')
  @HttpCode(200)
  @RequireCapability('order:write')
  async reject(@Param('id') id: string, @Body() body: unknown): Promise<OrderDetailView> {
    return this.fulfilment.reject(id, parseReject(body).reason);
  }

  /**
   * 201 for a parcel that was created, 200 for a replayed idempotency key.
   *
   * The distinction is the point: a client that retries a dispatch it is not
   * sure landed must be able to tell "I made this" from "this already existed",
   * and both are successes.
   */
  @Post('shipments')
  @RequireCapability('order:write')
  async ship(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ShipmentView> {
    const result = await this.fulfilment.createShipment(id, parseCreateShipment(body));
    reply.status(result.created ? 201 : 200);
    return result.shipment;
  }

  @Post('shipments/:shipmentId/delivered')
  @HttpCode(200)
  @RequireCapability('order:write')
  async deliver(
    @Param('id') id: string,
    @Param('shipmentId') shipmentId: string,
  ): Promise<ShipmentView> {
    return this.fulfilment.markDelivered(id, shipmentId);
  }

  /**
   * What auto-dispatch WOULD do. A GET, because it changes nothing.
   *
   * The console renders this before offering the button, so a seller learns
   * that an order splits across two warehouses while they can still do
   * something about it.
   */
  @Get('dispatch-plan')
  @RequireCapability('order:read')
  async plan(@Param('id') id: string): Promise<DispatchPlanView> {
    return this.fulfilment.plan(id);
  }

  /**
   * Dispatch everything outstanding, as one parcel per warehouse.
   *
   * Always 200, never 201, unlike `shipments` above: this creates between one
   * and several parcels and a retry may create none of them, so there is no
   * single "created" to report in a status code. What was made is in the body.
   */
  @Post('dispatch')
  @HttpCode(200)
  @RequireCapability('order:write')
  async autoDispatch(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AutoDispatchResult> {
    return this.fulfilment.autoDispatch(id, parseAutoDispatch(body));
  }

  /** Line-level: omitting `items` cancels everything still outstanding. */
  @Post('cancel')
  @HttpCode(200)
  @RequireCapability('order:write')
  async cancel(@Param('id') id: string, @Body() body: unknown): Promise<OrderDetailView> {
    const input = parseSellerCancel(body);
    return this.fulfilment.cancelLinesForSeller(id, input.items, input.reason);
  }

  /**
   * Cash taken at the door.
   *
   * `payout:write` rather than `order:write`, and the difference matters: this
   * is the one fulfilment-shaped verb that moves money, and the FINANCE role
   * exists precisely so that reconciling cash is separable from packing boxes.
   * PRD 6.6's suspension set withdraws `payout:write`, so a suspended seller
   * keeps fulfilling orders they have taken money for but stops recording new
   * collections - which is the correct half to freeze.
   */
  @Post('cod-collection')
  @HttpCode(200)
  @RequireCapability('payout:write')
  async collectCod(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CodCollectionView> {
    return this.cod.collect(id, parseCodCollection(body));
  }
}

/**
 * The COD reconciliation dashboard's read side.
 *
 * A separate controller because it is not about ONE order - `seller/orders/:id`
 * would be the wrong path for a question about every order at once, and mounting
 * it there would make the id parameter a lie.
 */
@ApiTags('fulfilment')
@Controller('seller/cod')
export class SellerCodController {
  constructor(private readonly cod: CodService) {}

  @Get()
  @RequireCapability('payout:read')
  async summary(): Promise<Awaited<ReturnType<CodService['reconciliation']>>> {
    return this.cod.reconciliation();
  }

  @Get('outstanding')
  @RequireCapability('payout:read')
  async outstanding(): Promise<{ items: CodOutstandingRow[] }> {
    return { items: await this.cod.outstanding() };
  }

  @Get('collected')
  @RequireCapability('payout:read')
  async collected(): Promise<{ items: CodOutstandingRow[] }> {
    return { items: await this.cod.collected() };
  }
}

/**
 * The buyer's one fulfilment verb.
 *
 * No capability decorator: capabilities describe what a member may do inside an
 * organisation, and a buyer is not in one. What authorises this is `own_orders`
 * - the order is theirs or it does not exist.
 *
 * Whole-order only. Dropping one item of several is a return, which is Phase 8.
 */
@ApiTags('fulfilment')
@Controller('me/orders/:id')
export class BuyerFulfilmentController {
  constructor(
    private readonly fulfilment: FulfilmentService,
    private readonly pickups: ReturnPickupService,
  ) {}

  @Post('cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() body: unknown): Promise<OrderDetailView> {
    return this.fulfilment.cancelForBuyer(id, parseBuyerCancel(body).reason);
  }

  /**
   * Book a courier to collect a delivered order.
   *
   * PRD 11 Phase 6's reverse logistics, and only its logistics half: this books
   * a van. Whether the return is accepted, inspected or refunded is the RMA
   * workflow, which is Phase 8.
   */
  @Post('return-pickup')
  @HttpCode(201)
  async scheduleReturn(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReturnPickupView> {
    return this.pickups.schedule(id, parseReturnPickup(body).slotId);
  }

  @Get('return-pickups')
  async returnPickups(@Param('id') id: string): Promise<{ items: ReturnPickupView[] }> {
    return { items: await this.pickups.forOrder(id) };
  }
}
