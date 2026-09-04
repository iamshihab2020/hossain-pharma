import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  controllers: [CatalogueController, ProductsController],
  providers: [CatalogueService, ProductsService],
  exports: [CatalogueService],
})
export class CatalogueModule {}
