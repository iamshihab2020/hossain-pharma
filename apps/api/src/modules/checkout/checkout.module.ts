import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module.js';
import { CartModule } from '../cart/cart.module.js';
import { ListingsModule } from '../listings/listings.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import { QuoteService } from './quote.service.js';

@Module({
  imports: [AddressesModule, CartModule, ListingsModule, OrdersModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, QuoteService],
  exports: [QuoteService],
})
export class CheckoutModule {}
