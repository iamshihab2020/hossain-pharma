import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { CodService } from './cod.service.js';
import {
  BuyerFulfilmentController,
  SellerCodController,
  SellerFulfilmentController,
} from './fulfilment.controller.js';
import { FulfilmentService } from './fulfilment.service.js';
import { OrderEventsService } from './order-events.service.js';
import { ReturnPickupService } from './return-pickup.service.js';

/**
 * LedgerModule and SearchModule are @Global, so only the two that are not get
 * imported here. OrdersModule supplies the READ side - this module never
 * assembles an OrderView of its own, because two shapes for one order is how a
 * seller console and a buyer page start disagreeing.
 */
@Module({
  imports: [ListingsModule, OrdersModule],
  controllers: [SellerFulfilmentController, SellerCodController, BuyerFulfilmentController],
  providers: [FulfilmentService, CodService, ReturnPickupService, OrderEventsService],
  /**
   * OrderEventsService is exported because the payment webhook and the carrier
   * webhook both write to the buyer's timeline, and there is exactly one writer
   * of `order_events` on purpose - the table has UPDATE and DELETE revoked, so
   * a second writer could not correct the first one's mistakes anyway.
   */
  exports: [FulfilmentService, CodService, ReturnPickupService, OrderEventsService],
})
export class FulfilmentModule {}
