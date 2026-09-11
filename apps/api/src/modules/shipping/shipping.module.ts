import { Global, Module, forwardRef } from '@nestjs/common';
import { FlatRateShippingAdapter } from './flat-rate.adapter.js';
import { MockCarrierAdapter } from './mock-carrier.adapter.js';
import { ServiceabilityController } from './serviceability.controller.js';
import { ServiceabilityService } from './serviceability.service.js';
import { ShippingWebhookController } from './shipping-webhook.controller.js';
import { SlotsController } from './slots.controller.js';
import { SlotsService } from './slots.service.js';
import { TrackingService } from './tracking.service.js';
import { ZoneRateShippingAdapter } from './zone-rate.adapter.js';
import { SHIPPING_PROVIDER } from './shipping-provider.port.js';
import { SHIPPING_QUOTE_PROVIDER } from './shipping-quote.port.js';
import { FulfilmentModule } from '../fulfilment/fulfilment.module.js';

/**
 * @Global so checkout can quote without importing this module, and so the
 * adapter swaps in exactly one place - which is what Phase 6 did, replacing the
 * flat rate with the zone rate card.
 *
 * FlatRateShippingAdapter stays REGISTERED, not deleted: the zone adapter
 * injects it and falls back to it for an unserviceable postcode, an unmeasured
 * variant, or a parcel over the rate card's ceiling. It is the floor rather
 * than the previous version.
 */
@Global()
@Module({
  /**
   * `forwardRef` because FulfilmentModule imports this one for the carrier
   * adapter (to book a parcel) and this one imports Fulfilment for the events
   * service (to record a carrier's report on the buyer's timeline). The cycle
   * is real rather than accidental - dispatch and tracking are two halves of
   * one story - and splitting a third module out to break it would separate the
   * event writer from the only two things that write events.
   */
  imports: [forwardRef(() => FulfilmentModule)],
  controllers: [ServiceabilityController, SlotsController, ShippingWebhookController],
  providers: [
    FlatRateShippingAdapter,
    ZoneRateShippingAdapter,
    MockCarrierAdapter,
    ServiceabilityService,
    SlotsService,
    TrackingService,
    { provide: SHIPPING_QUOTE_PROVIDER, useExisting: ZoneRateShippingAdapter },
    { provide: SHIPPING_PROVIDER, useExisting: MockCarrierAdapter },
  ],
  exports: [
    SHIPPING_QUOTE_PROVIDER,
    SHIPPING_PROVIDER,
    ServiceabilityService,
    SlotsService,
    MockCarrierAdapter,
  ],
})
export class ShippingModule {}
