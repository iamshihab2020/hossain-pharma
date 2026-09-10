import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { SellerFulfilmentController } from './fulfilment.controller.js';
import { FulfilmentService } from './fulfilment.service.js';
import { OrderEventsService } from './order-events.service.js';

/**
 * LedgerModule and SearchModule are @Global, so only the two that are not get
 * imported here. OrdersModule supplies the READ side - this module never
 * assembles an OrderView of its own, because two shapes for one order is how a
 * seller console and a buyer page start disagreeing.
 */
@Module({
  imports: [ListingsModule, OrdersModule],
  controllers: [SellerFulfilmentController],
  providers: [FulfilmentService, OrderEventsService],
  exports: [FulfilmentService, OrderEventsService],
})
export class FulfilmentModule {}
