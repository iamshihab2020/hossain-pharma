import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * A rejection reason is REQUIRED, not optional.
 *
 * A rejection rate without reasons tells Phase 7 nothing, and a buyer reading
 * "the seller could not fulfil this" with no explanation has been told less
 * than the seller knew. Optional here would mean most rejections carry none.
 */
const reasonSchema = z.string().trim().min(1).max(500);

const rejectSchema = z.object({ reason: reasonSchema });

export type RejectInput = z.infer<typeof rejectSchema>;

const shipmentLineSchema = z.object({
  orderItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

const createShipmentSchema = z.object({
  items: z.array(shipmentLineSchema).min(1).max(200),
  /**
   * Which building it leaves from. Optional, because Phase 5's callers do not
   * send one and a seller with a single warehouse should not have to.
   *
   * When absent, the stock comes from wherever the listing has reserved units,
   * exactly as it did in Phase 5. When present, the units must come from THAT
   * warehouse or the dispatch fails - a parcel labelled with an origin it did
   * not leave is worse than no label.
   */
  warehouseId: z.string().uuid().optional(),
  /** Nullable in the database: a seller may hand a parcel to a rider with neither. */
  carrierName: z.string().trim().min(1).max(120).optional(),
  trackingNumber: z.string().trim().min(1).max(120).optional(),
  /**
   * PRD 13, and the Phase 4 rule: idempotency is a unique constraint, never a
   * prior lookup. A retried dispatch that ships one parcel twice releases a
   * seller's payable twice.
   */
  idempotencyKey: z.string().min(8).max(200),
});

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

/**
 * Dispatch everything outstanding, letting the allocator decide the parcels.
 *
 * The idempotency key is per REQUEST, not per parcel: one auto-dispatch that
 * produces three parcels must be retryable as one thing. The service derives
 * each parcel's own key from it and the warehouse, so a retry finds all three
 * and creates none.
 */
const autoDispatchSchema = z.object({
  carrierName: z.string().trim().min(1).max(120).optional(),
  trackingNumber: z.string().trim().min(1).max(120).optional(),
  /** Book the mock carrier and let it emit tracking events. */
  bookCarrier: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(200),
});

export type AutoDispatchInput = z.infer<typeof autoDispatchSchema>;

const codCollectionSchema = z.object({
  amountMinor: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(200),
});

export type CodCollectionInput = z.infer<typeof codCollectionSchema>;

const returnPickupSchema = z.object({
  slotId: z.string().uuid(),
});

export type ReturnPickupInput = z.infer<typeof returnPickupSchema>;

const sellerCancelSchema = z.object({
  /** Omitted means every outstanding unit on the order. */
  items: z.array(shipmentLineSchema).min(1).max(200).optional(),
  reason: reasonSchema,
});

export type SellerCancelInput = z.infer<typeof sellerCancelSchema>;

const buyerCancelSchema = z.object({ reason: reasonSchema.optional() });

export type BuyerCancelInput = z.infer<typeof buyerCancelSchema>;

export const parseReject = (body: unknown): RejectInput => parse(rejectSchema, body);
export const parseCreateShipment = (body: unknown): CreateShipmentInput =>
  parse(createShipmentSchema, body);
export const parseAutoDispatch = (body: unknown): AutoDispatchInput =>
  parse(autoDispatchSchema, body);
export const parseCodCollection = (body: unknown): CodCollectionInput =>
  parse(codCollectionSchema, body);
export const parseReturnPickup = (body: unknown): ReturnPickupInput =>
  parse(returnPickupSchema, body);
export const parseSellerCancel = (body: unknown): SellerCancelInput =>
  parse(sellerCancelSchema, body);
export const parseBuyerCancel = (body: unknown): BuyerCancelInput =>
  parse(buyerCancelSchema, body ?? {});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}
