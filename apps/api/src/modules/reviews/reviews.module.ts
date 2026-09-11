import { Module } from '@nestjs/common';
import { ReviewModerationController } from './moderation.controller.js';
import { ReviewAggregateService } from './review-aggregate.service.js';
import {
  MyReviewsController,
  ProductReviewsController,
  ReviewReportsController,
} from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

/**
 * Exports `ReviewsService` because the CATALOGUE needs it: the buy box has
 * ranked on `sellerRating` since Phase 2 and has been handed null ever since.
 * Phase 7 is where that socket finally gets a value, and the wire runs from
 * here.
 */
@Module({
  controllers: [ProductReviewsController, MyReviewsController, ReviewReportsController, ReviewModerationController],
  providers: [ReviewsService, ReviewAggregateService],
  exports: [ReviewsService, ReviewAggregateService],
})
export class ReviewsModule {}
