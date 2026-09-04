import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequireCapability } from '../../common/decorators/capabilities.decorator.js';
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator.js';
import { ProductsService, type ProductMedia, type ProposedProduct } from './products.service.js';

const proposeProductSchema = z.object({
  categorySlug: z.string().min(1),
  slug: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lower-case words separated by single hyphens'),
  name: z.string().min(2).max(200).trim(),
  brand: z.string().min(1).max(120).trim().optional(),
  description: z.string().max(4000).trim().optional(),
  variants: z
    .array(
      z.object({
        sku: z.string().min(1).max(64).trim(),
        name: z.string().min(1).max(120).trim(),
      }),
    )
    // At least one variant, always. A listing hangs off a variant, so a product
    // with none is a catalogue entry nobody can ever offer.
    .min(1)
    .max(50),
  attributes: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        text: z.string().max(500).optional(),
        number: z.number().optional(),
        bool: z.boolean().optional(),
      }),
    )
    .max(50)
    .optional(),
});

const mediaSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  contentBase64: z.string().min(1),
  altText: z.string().max(300).optional(),
});

/**
 * The WRITE side of the catalogue, which is why it is a separate controller
 * from the @Public() read side. Nothing here is public, and the split means a
 * route added to CatalogueController cannot accidentally inherit a write.
 */
@ApiTags('catalogue')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /**
   * PRD 9.2: "propose a new product (admin-moderated)".
   *
   * Lands in PENDING_REVIEW, never ACTIVE. A seller who could publish a
   * catalogue entry directly could also publish a duplicate of an existing one
   * and take its buy box to themselves, which is the failure mode a shared
   * catalogue has and a per-seller one does not.
   */
  @Post()
  @RequireCapability('product:write')
  async propose(@Body() body: unknown): Promise<ProposedProduct> {
    return this.products.propose(parse(proposeProductSchema, body));
  }

  /**
   * Platform-admin only. Product media belongs to the shared catalogue entry,
   * not to any one seller, so a seller uploading it would be editing a page
   * their competitors also sell from.
   */
  @Post(':id/media')
  @PlatformAdmin()
  async addMedia(@Param('id') id: string, @Body() body: unknown): Promise<ProductMedia> {
    return this.products.addMedia(id, parse(mediaSchema, body));
  }
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
