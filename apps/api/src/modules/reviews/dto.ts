import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * A review's text is the one place on this marketplace where a stranger's words
 * reach every future buyer, so the bounds are deliberate rather than defensive
 * defaults: long enough to say why, short enough that nobody pastes a novel
 * into the product page.
 */
const bodySchema = z.string().trim().max(4_000);
const titleSchema = z.string().trim().max(160);

export const createReviewSchema = z.object({
  /** WHAT WAS BOUGHT, not what is being reviewed. The order line is the
   *  authorisation; the product is derived from it server-side, so a caller
   *  cannot review one thing on the strength of having bought another. */
  orderItemId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: titleSchema.optional(),
  body: bodySchema.optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

/**
 * An edit may change the stars, the title and the body - and nothing else.
 *
 * Not the order line and not the product: those are the identity of the review
 * and the proof behind it. A review that can be re-pointed at another product
 * is a verified-purchase badge for sale.
 */
export const updateReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    title: titleSchema.optional(),
    body: bodySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update',
  });
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

/**
 * Moderation, which is an ADMIN verb with a reason attached.
 *
 * `REMOVE` takes content off every surface; `RESTORE` puts it back; `FLAG`
 * marks it for a human without hiding it. The reason is required on all three
 * because Phase 11's audit log will want it and because a moderation queue
 * whose entries say only "removed" teaches the next moderator nothing.
 */
export const moderateReviewSchema = z.object({
  action: z.enum(['FLAG', 'REMOVE', 'RESTORE']),
  reason: z.string().trim().min(1).max(500),
});
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;

/** A buyer or a visitor reporting content. No reason code enum yet - Phase 7's
 *  auto-flagging will want categories, and inventing them before the rules that
 *  read them is how you get an enum nothing branches on. */
export const reportReviewSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReportReviewInput = z.infer<typeof reportReviewSchema>;

export function parseCreateReview(body: unknown): CreateReviewInput {
  return parse(createReviewSchema, body);
}

export function parseUpdateReview(body: unknown): UpdateReviewInput {
  return parse(updateReviewSchema, body);
}

export function parseModerateReview(body: unknown): ModerateReviewInput {
  return parse(moderateReviewSchema, body);
}

export function parseReportReview(body: unknown): ReportReviewInput {
  return parse(reportReviewSchema, body);
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
