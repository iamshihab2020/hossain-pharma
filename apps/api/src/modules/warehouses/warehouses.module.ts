import { Module } from '@nestjs/common';
import { WarehousesController } from './warehouses.controller.js';
import { WarehousesService } from './warehouses.service.js';

/**
 * No imports: a warehouse is the plainest tenant-scoped resource in the system.
 * It reads `warehouses` and summarises `inventory_items`, both through ordinary
 * RLS, and needs nothing from anyone else.
 */
@Module({
  controllers: [WarehousesController],
  providers: [WarehousesService],
  exports: [WarehousesService],
})
export class WarehousesModule {}
