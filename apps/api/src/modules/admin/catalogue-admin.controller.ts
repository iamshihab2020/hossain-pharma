import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator.js';
import { parseLimit, type Page } from '../../common/pagination.js';
import {
  CatalogueAdminService,
  type ListingQueueItem,
  type ProductQueueItem,
  type ProductStatus,
} from './catalogue-admin.service.js';

const statusSchema = z.enum(['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED']);
const reasonSchema = z.object({ reason: z.string().min(3).max(1000).trim() });

/**
 * PRD 9.2 product moderation and the plan P-C restricted-listing queue.
 *
 * Class-level @PlatformAdmin(), so a route added here is admin-only whether or
 * not whoever added it remembered.
 */
@ApiTags('admin')
@PlatformAdmin()
@Controller('admin')
export class CatalogueAdminController {
  constructor(private readonly admin: CatalogueAdminService) {}

  @Get('products')
  async products(
    @Query('status') status: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<Page<ProductQueueItem>> {
    return this.admin.productQueue({
      ...(status === undefined || status === '' ? {} : { status: parseStatus(status) }),
      ...(cursor === undefined || cursor === '' ? {} : { cursor }),
      limit: parseLimit(limit),
    });
  }

  @Post('products/:id/approve')
  async approveProduct(@Param('id') id: string): Promise<ProductQueueItem> {
    return this.admin.approveProduct(id);
  }

  @Post('products/:id/reject')
  async rejectProduct(@Param('id') id: string, @Body() body: unknown): Promise<ProductQueueItem> {
    return this.admin.rejectProduct(id, parseReason(body));
  }

  @Get('listings')
  async listings(
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<Page<ListingQueueItem>> {
    return this.admin.listingQueue({
      ...(cursor === undefined || cursor === '' ? {} : { cursor }),
      limit: parseLimit(limit),
    });
  }

  @Post('listings/:id/approve')
  async approveListing(@Param('id') id: string): Promise<{ id: string; status: string }> {
    return this.admin.approveListing(id);
  }

  @Post('listings/:id/reject')
  async rejectListing(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ id: string; status: string }> {
    return this.admin.rejectListing(id, parseReason(body));
  }
}

function parseStatus(raw: string): ProductStatus {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException(`Unknown status: ${raw}`);
  return parsed.data;
}

function parseReason(body: unknown): string {
  const parsed = reasonSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException('A reason of at least 3 characters is required');
  }
  return parsed.data.reason;
}
