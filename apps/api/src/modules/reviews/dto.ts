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

/**
 * A question, which needs no purchase and therefore no order line.
 *
 * The product is named DIRECTLY here, unlike a review - there is nothing to
 * derive it from, because the whole point is that the asker has not bought it.
 * That is the one place the two features diverge in their input and it is worth
 * seeing side by side.
 */
export const askSchema = z.object({
  productId: z.string().uuid(),
  body: z.string().trim().min(5).max(1_000),
});
export type AskInput = z.infer<typeof askSchema>;

export const answerSchema = z.object({
  body: z.string().trim().min(1).max(2_000),
});
export type AnswerInput = z.infer<typeof answerSchema>;

/**
 * A photo, as base64 - the same shape product media already uses.
 *
 * Not multipart. Fastify would need a separate parser registered for one route,
 * and the sizes here are a phone photo rather than a video; base64 costs a
 * third more bytes and saves a dependency and a second code path for reading a
 * body. Product media made this call in Phase 2 and there is no reason for
 * review photos to disagree with it.
 *
 * The content types are an allowlist rather than a check on the filename: a
 * `.png` that is really an HTML document is the oldest upload trick there is.
 */
export const reviewPhotoSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  contentBase64: z.string().min(1).max(8_000_000),
});
export type ReviewPhotoInput = z.infer<typeof reviewPhotoSchema>;

export function parseAsk(body: unknown): AskInput {
  return parse(askSchema, body);
}

export function parseAnswer(body: unknown): AnswerInput {
  return parse(answerSchema, body);
}

export function parseReviewPhoto(body: unknown): ReviewPhotoInput {
  return parse(reviewPhotoSchema, body);
}

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
