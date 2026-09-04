import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { CatalogueAdminController } from './catalogue-admin.controller.js';
import { CatalogueAdminService } from './catalogue-admin.service.js';

@Module({
  controllers: [AdminController, CatalogueAdminController],
  providers: [AdminService, CatalogueAdminService],
})
export class AdminModule {}
