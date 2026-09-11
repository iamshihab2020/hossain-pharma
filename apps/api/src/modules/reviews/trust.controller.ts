import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator.js';
import { parseAnswer, parseAsk, parseModerateReview, parseReviewPhoto } from './dto.js';
import { QuestionsService, type QuestionView } from './questions.service.js';
import { ReviewsService } from './reviews.service.js';
import { StorefrontService, type Storefront } from './storefront.service.js';

/**
 * The public trust surfaces: a product's Q&A, a seller's storefront, and the
 * bytes behind a review photo.
 *
 * All @Public(), all reading tables Phase 7 made platform-owned for exactly
 * this reader - somebody with no session who has chosen no seller. Each is
 * justified by name in `route-coverage.e2e.test.ts`, which fails until somebody
 * writes the reason down.
 */
@ApiTags('reviews')
@Public()
@Controller()
export class TrustController {
  constructor(
    private readonly questions: QuestionsService,
    private readonly reviews: ReviewsService,
    private readonly storefront: StorefrontService,
  ) {}

  @Get('products/:productId/questions')
  async forProduct(@Param('productId') productId: string): Promise<{ items: QuestionView[] }> {
    return { items: await this.questions.forProduct(productId) };
  }

  @Get('sellers/:slug')
  async seller(@Param('slug') slug: string): Promise<Storefront> {
    return this.storefront.bySlug(slug);
  }

  /**
   * A review photo's bytes.
   *
   * Streamed through the app rather than served from a URL the client builds,
   * because `storageKey` is opaque by the port's contract - nothing outside an
   * adapter may parse or join it - and because moderation has to bind here:
   * `ReviewsService.photo` refuses a photo whose review has been REMOVED, which
   * is the surface that would otherwise outlive the takedown.
   *
   * `immutable` because a photo never changes: the id is the content. A year is
   * the convention and costs nothing, since removing the review makes this
   * route 404 regardless of what a cache holds.
   */
  @Get('reviews/media/:id')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async photo(@Param('id') id: string, @Res() reply: FastifyReply): Promise<void> {
    const { bytes, contentType } = await this.reviews.photo(id);
    await reply.type(contentType).send(bytes);
  }
}

/**
 * Asking and answering, which need a session but no purchase.
 *
 * The whole difference between this and a review, in one controller boundary: a
 * question is what somebody asks BEFORE buying, so requiring proof of purchase
 * would leave it askable only by the people who no longer need to ask.
 */
@ApiTags('reviews')
@Controller()
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Post('questions')
  async ask(@Body() body: unknown): Promise<QuestionView> {
    return this.questions.ask(parseAsk(body));
  }

  @Post('questions/:id/answers')
  async answer(@Param('id') id: string, @Body() body: unknown): Promise<QuestionView> {
    return this.questions.answer(id, parseAnswer(body));
  }

  @Delete('questions/:id')
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.questions.removeQuestion(id);
    return { deleted: true };
  }
}

/** Helpful votes and photos, both on the buyer's own account. */
@ApiTags('reviews')
@Controller('me/reviews')
export class ReviewInteractionsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Press once to mark helpful, again to take it back. */
  @Post(':id/helpful')
  async helpful(@Param('id') id: string): Promise<{ helpfulCount: number; voted: boolean }> {
    return this.reviews.vote(id);
  }

  @Post(':id/photos')
  async addPhoto(@Param('id') id: string, @Body() body: unknown): Promise<{ id: string }> {
    const input = parseReviewPhoto(body);
    return this.reviews.addPhoto(id, {
      contentType: input.contentType,
      bytes: Buffer.from(input.contentBase64, 'base64'),
    });
  }
}

/** Moderating Q&A, alongside the review queue on the same admin prefix. */
@ApiTags('admin')
@PlatformAdmin()
@Controller('admin')
export class QuestionModerationController {
  constructor(private readonly questions: QuestionsService) {}

  @Get('questions')
  async queue(): Promise<{ items: QuestionView[] }> {
    return { items: await this.questions.flagged() };
  }

  @Post('questions/:id/moderate')
  async moderateQuestion(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ id: string; status: string }> {
    return this.questions.moderateQuestion(id, parseModerateReview(body));
  }

  @Post('answers/:id/moderate')
  async moderateAnswer(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ moderated: true }> {
    await this.questions.moderateAnswer(id, parseModerateReview(body));
    return { moderated: true };
  }
}
