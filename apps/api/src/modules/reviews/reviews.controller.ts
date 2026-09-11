import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { parseCreateReview, parseUpdateReview } from './dto.js';
import {
  ReviewsService,
  type RatingSummary,
  type ReviewablePurchase,
  type ReviewView,
} from './reviews.service.js';

/**
 * The public half: what a visitor reads on a product page.
 *
 * @Public() because this is the surface the whole ownership decision was made
 * for - PRD 9.5 puts the rating and its histogram on the product page, which an
 * anonymous shopper opens with no session and no tenant. A review behind a
 * login is a review nobody reads before deciding to buy.
 */
@ApiTags('reviews')
@Public()
@Controller('products/:productId/reviews')
export class ProductReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  async list(@Param('productId') productId: string): Promise<{ items: ReviewView[] }> {
    return { items: await this.reviews.forProduct(productId) };
  }

  @Get('summary')
  async summary(@Param('productId') productId: string): Promise<RatingSummary> {
    return this.reviews.summaryForProduct(productId);
  }
}

/**
 * The buyer's own reviews.
 *
 * No @Public() anywhere, so the global AuthGuard closes every route, and no
 * @RequireCapability either: capabilities are a SELLER concept (ADR 0013) and
 * writing a review is something a buyer does, who is not a tenant.
 */
@ApiTags('reviews')
@Controller('me/reviews')
export class MyReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** What I have bought, had delivered, and not yet reviewed. */
  @Get('pending')
  async pending(): Promise<{ items: ReviewablePurchase[] }> {
    return { items: await this.reviews.reviewable() };
  }

  @Post()
  async create(@Body() body: unknown): Promise<ReviewView> {
    return this.reviews.create(parseCreateReview(body));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown): Promise<ReviewView> {
    return this.reviews.update(id, parseUpdateReview(body));
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.reviews.remove(id);
    return { deleted: true };
  }
}

/**
 * Reporting, which is deliberately the ONE public write in this module.
 *
 * PRD 9.5 lists "report a product / review / seller" among the trust features,
 * and requiring an account to report abuse means the abuse stays up while the
 * person who noticed it registers. What makes this safe to leave open is that
 * it cannot destroy anything: a report FLAGS, it does not hide, and it moves
 * only a PUBLISHED review - so no volume of reports can undo a moderator, and
 * the worst a brigade achieves is putting a review in front of a human.
 */
@ApiTags('reviews')
@Public()
@Controller('reviews')
export class ReviewReportsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':id/report')
  async report(@Param('id') id: string): Promise<{ flagged: boolean }> {
    return this.reviews.report(id);
  }
}
