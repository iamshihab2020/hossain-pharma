import { z } from 'zod';

/**
 * Money arrives as integer minor units and nothing else.
 *
 * `z.number().int()` rejects 38500.75 rather than rounding it, which is the
 * whole point: the legacy server did `parseInt(price * 100)` and truncated
 * silently. A caller who sends a decimal has misunderstood the unit, and
 * telling them so is cheaper than storing a number that is wrong by a paisa
 * and reconciling it in Phase 4's ledger.
 */
const minorUnits = z
  .number({ message: 'must be an integer number of minor units (paisa, cents)' })
  .int()
  .min(0);

export const createWarehouseSchema = z.object({
  name: z.string().min(2).max(120).trim(),
  // Not validated against a format: pincode shapes differ by country and PRD
  // 10.3 owns serviceability. A regex here would reject a valid address in the
  // second country the marketplace reaches.
  pincode: z.string().min(3).max(16).trim(),
  isDefault: z.boolean().optional(),
});

export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const createListingSchema = z.object({
  variantId: z.string().uuid(),
  priceAmount: minorUnits,
  priceCurrency: z.string().length(3).toUpperCase(),
  shippingAmount: minorUnits.optional(),
  dispatchDays: z.number().int().min(0).max(90).optional(),
  condition: z.enum(['NEW', 'REFURBISHED', 'USED']).optional(),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = z
  .object({
    priceAmount: minorUnits,
    // Nullable so a seller can END a sale, not only start one. Omitting the key
    // leaves it alone; sending null clears it. Those are different intentions
    // and an optional-only field cannot express the second.
    salePriceAmount: minorUnits.nullable(),
    shippingAmount: minorUnits,
    dispatchDays: z.number().int().min(0).max(90),
    condition: z.enum(['NEW', 'REFURBISHED', 'USED']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const setInventorySchema = z.object({
  warehouseId: z.string().uuid(),
  onHand: z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).optional(),
});

export type SetInventoryInput = z.infer<typeof setInventorySchema>;
