import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator.js';
import { parseLimit, type Page } from '../../common/pagination.js';
import type { OrgStatus } from '../../common/guards/capability.guard.js';
import { AdminService, type QueueItem } from './admin.service.js';

const statusSchema = z.enum(['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'CLOSED']);
const reasonSchema = z.object({ reason: z.string().min(3).max(1000).trim() });

/**
 * PRD 9.3. Class-level @PlatformAdmin(), so a route added to this controller is
 * admin-only whether or not whoever added it remembered.
 *
 * No @RequireCapability anywhere: capabilities are organisation-scoped and the
 * approval queue is not inside any organisation. See the decorator's comment.
 */
@ApiTags('admin')
@PlatformAdmin()
@Controller('admin/orgs')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  async queue(
    @Query('status') status: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<Page<QueueItem>> {
    return this.admin.queue({
      ...(status === undefined || status === '' ? {} : { status: parseStatus(status) }),
      ...(cursor === undefined || cursor === '' ? {} : { cursor }),
      limit: parseLimit(limit),
    });
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string): Promise<QueueItem> {
    return this.admin.approve(id);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: unknown): Promise<QueueItem> {
    // A reason is required, not optional. A rejection with no reason gives the
    // seller nothing to fix and generates a support ticket instead of a resubmit.
    return this.admin.reject(id, parseReason(body));
  }

  @Post(':id/suspend')
  async suspend(@Param('id') id: string, @Body() body: unknown): Promise<QueueItem> {
    return this.admin.suspend(id, parseReason(body));
  }

  @Post(':id/reinstate')
  async reinstate(@Param('id') id: string): Promise<QueueItem> {
    return this.admin.reinstate(id);
  }
}

function parseStatus(raw: string): OrgStatus {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException(`Unknown status: ${raw}`);
  return parsed.data;
}

function parseReason(body: unknown): string {
  const parsed = reasonSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('A reason of at least 3 characters is required');
  return parsed.data.reason;
}
