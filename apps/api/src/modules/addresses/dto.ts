import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * PRD 9.1: "Address book CRUD with pincode validation".
 *
 * `postcode` is required and validated as four digits because Phase 6 resolves
 * it to a delivery zone. Accepting anything now and tightening later means a
 * table full of addresses that cannot be shipped to, discovered two phases from
 * here.
 */
const addressSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  recipientName: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{6,20}$/, 'phone must be 6-20 digits, optionally with + - or spaces'),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(80),
  district: z.string().trim().min(1).max(80),
  postcode: z.string().trim().regex(/^[0-9]{4}$/, 'postcode must be four digits'),
  countryCode: z.string().trim().length(2).toUpperCase(),
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
});

const updateSchema = addressSchema.partial();

export type CreateAddressInput = z.infer<typeof addressSchema>;
/**
 * Inferred from the partial SCHEMA, not written as `Partial<CreateAddressInput>`.
 * With `exactOptionalPropertyTypes` on, the two are different types: the
 * hand-written one says a key may be absent, zod's says its value may be
 * undefined, and assigning between them is an error.
 */
export type UpdateAddressInput = z.infer<typeof updateSchema>;

export function parseCreateAddress(body: unknown): CreateAddressInput {
  return parse(addressSchema, body);
}

export function parseUpdateAddress(body: unknown): UpdateAddressInput {
  const updated = parse(updateSchema, body);
  if (Object.keys(updated).length === 0) {
    throw new BadRequestException('Provide at least one field to update');
  }
  return updated;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}
