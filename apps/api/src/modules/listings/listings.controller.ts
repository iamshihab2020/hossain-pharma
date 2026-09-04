import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequireCapability } from '../../common/decorators/capabilities.decorator.js';
import { parseLimit, type Page } from '../../common/pagination.js';
import {
  createListingSchema,
  createWarehouseSchema,
  setInventorySchema,
  updateListingSchema,
} from './dto.js';
import type { ListingStatus } from './lifecycle.js';
import { ListingsService, type Listing, type Warehouse } from './listings.service.js';

const statusSchema = z.enum(['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'ARCHIVED']);

/**
 * The seller's side of the catalogue. Every route here is tenant-scoped by the
 * global interceptor and gated on a PRD 5.3 capability, never a role name.
 *
 * `product:write` rather than a new `listing:write`: PRD 5.3's matrix has one
 * Products column, and splitting it here would mean a capability that exists in
 * the code and not in the spec.
 */
@ApiTags('listings')
@Controller()
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Post('warehouses')
  @RequireCapability('settings:write')
  async createWarehouse(@Body() body: unknown): Promise<Warehouse> {
    return this.listings.createWarehouse(parse(createWarehouseSchema, body));
  }

  @Get('warehouses')
  @RequireCapability('settings:read')
  async warehouses(): Promise<{ items: Warehouse[] }> {
    return { items: await this.listings.listWarehouses() };
  }

  @Post('listings')
  @RequireCapability('product:write')
  async create(@Body() body: unknown): Promise<Listing> {
    return this.listings.create(parse(createListingSchema, body));
  }

  @Get('listings')
  @RequireCapability('product:read')
  async list(
    @Query('status') status: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<Page<Listing>> {
    return this.listings.list({
      ...(status === undefined || status === '' ? {} : { status: parseStatus(status) }),
      ...(cursor === undefined || cursor === '' ? {} : { cursor }),
      limit: parseLimit(limit),
    });
  }

  @Get('listings/:id')
  @RequireCapability('product:read')
  async get(@Param('id') id: string): Promise<Listing> {
    return this.listings.get(id);
  }

  @Patch('listings/:id')
  @RequireCapability('product:write')
  async update(@Param('id') id: string, @Body() body: unknown): Promise<Listing> {
    return this.listings.update(id, parse(updateListingSchema, body));
  }

  @Put('listings/:id/inventory')
  @RequireCapability('product:write')
  async setInventory(@Param('id') id: string, @Body() body: unknown): Promise<Listing> {
    // PUT, not PATCH: the body sets stock to an absolute figure, so a retry
    // after a timeout is harmless. A delta would double.
    return this.listings.setInventory(id, parse(setInventorySchema, body));
  }

  @Post('listings/:id/publish')
  @RequireCapability('product:write')
  async publish(@Param('id') id: string): Promise<Listing> {
    return this.listings.publish(id);
  }

  @Post('listings/:id/pause')
  @RequireCapability('product:write')
  async pause(@Param('id') id: string): Promise<Listing> {
    return this.listings.transition(id, 'PAUSED');
  }

  @Post('listings/:id/resume')
  @RequireCapability('product:write')
  async resume(@Param('id') id: string): Promise<Listing> {
    return this.listings.transition(id, 'ACTIVE');
  }

  @Post('listings/:id/archive')
  @RequireCapability('product:write')
  async archive(@Param('id') id: string): Promise<Listing> {
    return this.listings.transition(id, 'ARCHIVED');
  }
}

function parseStatus(raw: string): ListingStatus {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException(`Unknown status: ${raw}`);
  return parsed.data;
}

function parse<T>(schema: { safeParse: (v: unknown) => SafeParse<T> }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}

type SafeParse<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
