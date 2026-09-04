import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  CatalogueService,
  type CategoryNode,
  type ProductPage,
  type ProductSummary,
} from './catalogue.service.js';

/**
 * The buyer-facing catalogue, and the first PUBLIC read surface in the system.
 *
 * @Public() on every route, deliberately: a marketplace product page that
 * requires a login is not a marketplace product page. These are the entries
 * that grow the allowlist in route-coverage.e2e.test.ts, and each one is a read
 * of already-published data - migration 0008's `public_active_offers` policy
 * limits what an anonymous reader can see to ACTIVE offers, in the database
 * rather than in this class.
 */
@ApiTags('catalogue')
@Controller()
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Public()
  @Get('categories')
  async categories(): Promise<{ items: CategoryNode[] }> {
    return { items: await this.catalogue.categoryTree() };
  }

  @Public()
  @Get('categories/:slug/products')
  async browse(@Param('slug') slug: string): Promise<{ items: ProductSummary[] }> {
    return { items: await this.catalogue.productsInCategory(slug) };
  }

  @Public()
  @Get('products/:slug')
  async product(@Param('slug') slug: string): Promise<ProductPage> {
    return this.catalogue.productPage(slug);
  }
}
