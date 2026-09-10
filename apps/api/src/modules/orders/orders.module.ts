import { Module } from '@nestjs/common';
import { OrderEventsService } from '../fulfilment/order-events.service.js';
import { BuyerOrdersController, SellerOrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  controllers: [BuyerOrdersController, SellerOrdersController],
  providers: [OrdersService, OrderEventsService],
  exports: [OrdersService, OrderEventsService],
})
export class OrdersModule {}
