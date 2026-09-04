import { Module } from '@nestjs/common';
import { BuyerOrdersController, SellerOrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  controllers: [BuyerOrdersController, SellerOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
