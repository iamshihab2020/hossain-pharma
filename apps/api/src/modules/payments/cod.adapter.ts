import { Injectable } from '@nestjs/common';
import type {
  CreateIntentRequest,
  CreateIntentResult,
  PaymentProvider,
  WebhookEvent,
} from './payment-provider.port.js';

/**
 * Cash on delivery.
 *
 * No gateway, no redirect, no client secret. The order is placed, the goods
 * ship, and the money arrives when the courier hands over the parcel - which is
 * Phase 6, where collection and reconciliation live.
 *
 * Phase 4 therefore accrues rather than captures: the intent goes to
 * COD_PENDING and checkout posts against COD_RECEIVABLE, the account that
 * measures the gap between "delivered" and "collected". That gap is the reason
 * a double-entry ledger is worth its weight here (PRD 10.1) - with a single
 * balance column there would be nowhere truthful to put money that is owed,
 * partially paid, or never coming.
 *
 * `verifyWebhook` returns null always, and that is correct rather than
 * unfinished: nothing external can tell this adapter that cash was received.
 * Only a courier reconciliation can, and it will arrive through the Phase 6
 * shipping flow as a domain event, not as a payment webhook.
 */
@Injectable()
export class CodPaymentAdapter implements PaymentProvider {
  readonly method = 'cod' as const;

  async createIntent(request: CreateIntentRequest): Promise<CreateIntentResult> {
    return Promise.resolve({
      providerRef: `cod_${request.intentId}`,
      clientSecret: null,
      initialStatus: 'COD_PENDING',
    });
  }

  verifyWebhook(): WebhookEvent | null {
    return null;
  }
}
