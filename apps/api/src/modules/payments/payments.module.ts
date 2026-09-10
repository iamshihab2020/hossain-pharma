import { Global, Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { CodPaymentAdapter } from './cod.adapter.js';
import { MockPaymentAdapter } from './mock.adapter.js';
import { PAYMENT_PROVIDERS } from './payment-provider.port.js';
import { PaymentWebhookService } from './payment-webhook.service.js';
import { PaymentWebhookController } from './webhook.controller.js';

/**
 * The adapters are provided as ONE array under a single token, so checkout and
 * the webhook both resolve a provider by method rather than by injecting each
 * adapter class. Adding Stripe is a class plus one line here - which is the
 * property the port exists to have.
 */
@Global()
@Module({
  imports: [OrdersModule],
  controllers: [PaymentWebhookController],
  providers: [
    MockPaymentAdapter,
    CodPaymentAdapter,
    PaymentWebhookService,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (mock: MockPaymentAdapter, cod: CodPaymentAdapter) => [mock, cod],
      inject: [MockPaymentAdapter, CodPaymentAdapter],
    },
  ],
  exports: [PAYMENT_PROVIDERS, MockPaymentAdapter],
})
export class PaymentsModule {}
