import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { PAYMENT_METHODS } from '../payments/payment-provider.port.js';

/**
 * `expectedTotal` is REQUIRED and is a comparison, never an input.
 *
 * Making it optional would mean a client that omits it gets whatever the server
 * decides, which is the "silently charged more than the page said" failure. The
 * server recomputes regardless; this field only decides whether the answer
 * matches what the buyer was shown.
 */
const moneySchema = z.object({
  amount: z.number().int(),
  currency: z.string().length(3),
});

const confirmSchema = z.object({
  addressId: z.string().uuid(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  /**
   * The delivery window the buyer chose. OPTIONAL and staying that way: no
   * international zone has slots, because a scheduled window across a customs
   * border is a promise nobody can keep, so an order to Dubai has none and is
   * not broken.
   */
  deliverySlotId: z.string().uuid().optional(),
  /**
   * PRD 13: idempotency keys on all mutating endpoints. Supplied by the client
   * and unique in the database, so a double-submitted checkout returns the
   * original orders instead of placing a second set.
   */
  idempotencyKey: z.string().min(8).max(200),
  expectedTotal: moneySchema,
  /**
   * Only read when the cart contains a RESTRICTED item, and never stored - the
   * order keeps `age_verified_at`, a timestamp, not a birth date. PRD 13
   * minimises PII.
   */
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD')
    .optional(),
});

export type ConfirmInput = z.infer<typeof confirmSchema>;

export function parseConfirm(body: unknown): ConfirmInput {
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}

export function parseQuoteQuery(addressId: unknown): string {
  if (typeof addressId !== 'string' || addressId.length === 0) {
    throw new BadRequestException('addressId is required');
  }
  return addressId;
}
