import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator.js';
import { parseModerateReview } from './dto.js';
import { ReviewsService, type ReviewView } from './reviews.service.js';

/**
 * PRD 9.6's content moderation queue, as far as Phase 7 needs it.
 *
 * Class-level @PlatformAdmin(), so a route added here is admin-only whether or
 * not whoever added it remembered - the same reasoning `AdminController` gives.
 * Moderation is not organisation-scoped and must never be: a seller able to
 * remove a review of their own product is the single worst failure mode this
 * feature has, and keeping the verb on a platform-admin controller is what makes
 * it structurally impossible rather than a rule somebody follows.
 */
@ApiTags('admin')
@PlatformAdmin()
@Controller('admin/reviews')
export class ReviewModerationController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Everything a human still has to look at. */
  @Get()
  async queue(): Promise<{ items: ReviewView[] }> {
    return { items: await this.reviews.flagged() };
  }

  @Post(':id/moderate')
  async moderate(@Param('id') id: string, @Body() body: unknown): Promise<ReviewView> {
    return this.reviews.moderate(id, parseModerateReview(body));
  }
}
