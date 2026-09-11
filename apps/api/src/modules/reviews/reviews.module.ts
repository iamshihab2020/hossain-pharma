import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module.js';
import { ReviewModerationController } from './moderation.controller.js';
import { QuestionsService } from './questions.service.js';
import { ReviewAggregateService } from './review-aggregate.service.js';
import {
  MyReviewsController,
  ProductReviewsController,
  ReviewReportsController,
} from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';
import { StorefrontService } from './storefront.service.js';
import {
  QuestionModerationController,
  QuestionsController,
  ReviewInteractionsController,
  TrustController,
} from './trust.controller.js';

/**
 * Everything Phase 7 added, in one module.
 *
 * Reviews, Q&A and storefronts share a module rather than splitting into three
 * because they share the decision: all of it is platform-owned, all of it is
 * read by an anonymous product-page visitor, and all of it moderates through
 * one status enum and one queue. Splitting them would put that one decision in
 * three places to drift.
 *
 * `StorageModule` because review photos go through the same `FileStorage` port
 * product media does - nothing here knows whether that is a disk or a bucket.
 *
 * Exports `ReviewsService` because the CATALOGUE needs it: the buy box has
 * ranked on `sellerRating` since Phase 2 and has been handed null ever since.
 */
@Module({
  imports: [StorageModule],
  controllers: [
    ProductReviewsController,
    MyReviewsController,
    ReviewReportsController,
    ReviewInteractionsController,
    ReviewModerationController,
    TrustController,
    QuestionsController,
    QuestionModerationController,
  ],
  providers: [ReviewsService, ReviewAggregateService, QuestionsService, StorefrontService],
  exports: [ReviewsService, ReviewAggregateService],
})
export class ReviewsModule {}
