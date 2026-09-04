import { Global, Module } from '@nestjs/common';
import { FlatRateShippingAdapter } from './flat-rate.adapter.js';
import { SHIPPING_QUOTE_PROVIDER } from './shipping-quote.port.js';

/**
 * @Global so checkout can quote without importing this module, and so Phase 6
 * swaps the adapter in exactly one place.
 */
@Global()
@Module({
  providers: [{ provide: SHIPPING_QUOTE_PROVIDER, useClass: FlatRateShippingAdapter }],
  exports: [SHIPPING_QUOTE_PROVIDER],
})
export class ShippingModule {}
