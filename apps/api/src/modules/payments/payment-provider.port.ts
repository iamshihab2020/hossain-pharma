import type { Money } from '@nexmarket/shared';

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

/**
 * The payment methods a buyer may choose at checkout.
 *
 * `cod` is cash on delivery, and it is a first-class method rather than a
 * fallback: it is how most of the primary market actually pays, and it is the
 * case that justifies the double-entry ledger existing at all (PRD 10.1 -
 * "COD is exactly why the ledger earns its place"). Money arrives days after
 * the order, sometimes partially, sometimes never.
 *
 * `stripe` is deliberately absent. The port is the seam and adding it is one
 * file plus one registration; building it now against an account that does not
 * exist would produce an adapter no test could exercise, which is the kind of
 * claim this repository is a reaction against.
 */
export const PAYMENT_METHODS = ['mock', 'cod'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type CreateIntentRequest = {
  readonly intentId: string;
  readonly amount: Money;
  readonly buyerUserId: string;
};

export type CreateIntentResult = {
  /** The gateway's own identifier, stored for reconciliation. */
  readonly providerRef: string;
  /**
   * Returned to the client to complete payment. Never persisted: it is a
   * credential, and the intent row is read by support staff.
   */
  readonly clientSecret: string | null;
  /**
   * The status the intent starts in.
   *
   * COD starts at COD_PENDING and no gateway is involved; a card method starts
   * at REQUIRES_PAYMENT and waits for a webhook. NOTHING here may return a
   * settled status - PRD 11 Phase 4 requires the webhook to be the only writer
   * of payment status, and an adapter that could return SUCCEEDED would make
   * that rule unenforceable by construction.
   */
  readonly initialStatus: 'REQUIRES_PAYMENT' | 'COD_PENDING';
};

export type WebhookEvent = {
  readonly providerEventId: string;
  readonly type: 'payment_succeeded' | 'payment_failed';
  readonly providerRef: string;
};

/**
 * PRD 10.1's `PaymentProvider` port.
 *
 * Two implementations ship in Phase 4 and both pass one shared contract suite,
 * which is what makes this a real seam rather than an interface with a single
 * implementation.
 */
export interface PaymentProvider {
  readonly method: PaymentMethod;
  createIntent(request: CreateIntentRequest): Promise<CreateIntentResult>;
  /**
   * Verifies and parses a delivered webhook.
   *
   * Returns null for anything it cannot authenticate. Throwing would let a
   * forged body be distinguished from a malformed one by timing and status
   * code; null is the same answer for both.
   *
   * Takes the RAW body, not a parsed object: a signature is over bytes, and
   * JSON.parse followed by JSON.stringify does not round-trip byte for byte.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent | null;
}
