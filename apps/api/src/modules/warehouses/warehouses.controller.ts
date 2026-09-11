import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireCapability } from '../../common/decorators/capabilities.decorator.js';
import {
  WarehousesService,
  type WarehouseInput,
  type WarehouseView,
} from './warehouses.service.js';

/**
 * The seller's warehouses. PRD's logistics routes: `POST /seller/warehouses`.
 *
 * Capabilities, never role names (ADR 0013). `listing:write` is the right one:
 * a warehouse is where stock lives, and anyone trusted to change what is for
 * sale is trusted to say where it is kept. Minting a `warehouse:write`
 * capability would add a row to the matrix that nobody would ever grant
 * separately.
 */
@ApiTags('warehouses')
@Controller('seller/warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequireCapability('product:read')
  async list(): Promise<{ items: WarehouseView[] }> {
    return { items: await this.warehouses.list() };
  }

  @Get(':id')
  @RequireCapability('product:read')
  one(@Param('id') id: string): Promise<WarehouseView> {
    return this.warehouses.one(id);
  }

  @Post()
  @RequireCapability('product:write')
  create(@Body() body: WarehouseInput): Promise<WarehouseView> {
    return this.warehouses.create(body);
  }

  @Patch(':id')
  @RequireCapability('product:write')
  update(@Param('id') id: string, @Body() body: Partial<WarehouseInput>): Promise<WarehouseView> {
    return this.warehouses.update(id, body);
  }

  /** 204: there is nothing useful to return about a location that is gone. */
  @Delete(':id')
  @HttpCode(204)
  @RequireCapability('product:write')
  remove(@Param('id') id: string): Promise<void> {
    return this.warehouses.remove(id);
  }
}
