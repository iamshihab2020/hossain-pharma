import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadApiEnv } from '../../config/env.js';
import type {
  CreateIntentRequest,
  CreateIntentResult,
  PaymentProvider,
  WebhookEvent,
} from './payment-provider.port.js';

/**
 * A card gateway that succeeds or fails on cue.
 *
 * It is a MOCK, not a stub: it signs its webhooks with a real HMAC over the raw
 * body and verifies them in constant time, so the whole webhook path - the
 * signature check, the idempotency insert, the ledger posting - is exercised by
 * tests exactly as a live gateway would exercise it. PRD 14 R7: a mock that
 * skipped the signature would leave the one security-critical branch of the
 * integration untested until the day it went live.
 *
 * The only thing it does not do is take money.
 */
@Injectable()
export class MockPaymentAdapter implements PaymentProvider {
  readonly method = 'mock' as const;

  private readonly secret = loadApiEnv().PAYMENT_WEBHOOK_SECRET;

  async createIntent(request: CreateIntentRequest): Promise<CreateIntentResult> {
    return Promise.resolve({
      providerRef: `mock_${request.intentId}`,
      clientSecret: `mock_secret_${randomUUID()}`,
      // Never SUCCEEDED, however trivially this adapter could settle. The
      // webhook is the only writer of payment status.
      initialStatus: 'REQUIRES_PAYMENT',
    });
  }

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): WebhookEvent | null {
    const signature = headers['x-mock-signature'];
    if (signature === undefined) return null;
    if (!this.signatureMatches(rawBody, signature)) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const body = parsed as { id?: unknown; type?: unknown; providerRef?: unknown };
    if (typeof body.id !== 'string' || typeof body.providerRef !== 'string') return null;
    if (body.type !== 'payment_succeeded' && body.type !== 'payment_failed') return null;

    return { providerEventId: body.id, type: body.type, providerRef: body.providerRef };
  }

  /** Exposed so tests can sign a body the way a gateway would. */
  sign(rawBody: string): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }

  private signatureMatches(rawBody: string, provided: string): boolean {
    const expected = this.sign(rawBody);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    // Length must be compared first: timingSafeEqual throws on a mismatch, and
    // an exception is itself a timing signal.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
