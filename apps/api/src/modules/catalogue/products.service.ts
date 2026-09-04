import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@nexmarket/db';
import { getRequestContext } from '../../common/request-context.js';
import { FILE_STORAGE, type FileStorage } from '../../common/storage/file-storage.port.js';
import { MAX_DOCUMENT_BYTES } from '../orgs/dto.js';

export type ProposedProduct = {
  id: string;
  slug: string;
  name: string;
  status: string;
  variants: { id: string; sku: string; name: string }[];
};

export type ProductMedia = {
  id: string;
  productId: string;
  contentType: string;
  originalFilename: string;
  altText: string | null;
  position: number;
};

type ProposeInput = {
  categorySlug: string;
  slug: string;
  name: string;
  brand?: string | undefined;
  description?: string | undefined;
  variants: { sku: string; name: string }[];
  attributes?:
    | { key: string; text?: string | undefined; number?: number | undefined; bool?: boolean | undefined }[]
    | undefined;
};

type MediaInput = {
  filename: string;
  contentType: string;
  contentBase64: string;
  altText?: string | undefined;
};

@Injectable()
export class ProductsService {
  constructor(@Inject(FILE_STORAGE) private readonly files: FileStorage) {}

  async propose(input: ProposeInput): Promise<ProposedProduct> {
    const ctx = getRequestContext();
    if (ctx.tenantId === null) {
      throw new BadRequestException('Select an organisation with the x-tenant-id header');
    }

    const categories = await ctx.tx
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.slug, input.categorySlug))
      .limit(1);
    const categoryId = categories[0]?.id;
    if (categoryId === undefined) throw new BadRequestException('No such category');

    const inserted = await ctx.tx
      .insert(schema.products)
      .values({
        categoryId,
        slug: input.slug,
        name: input.name,
        brand: input.brand ?? null,
        description: input.description ?? null,
        // Never ACTIVE from this path. See the controller comment.
        status: 'PENDING_REVIEW',
        // Records who asked for the entry, for the moderation queue. It is NOT
        // a tenant column and confers no ownership - the entry, once approved,
        // is shared with every competing seller.
        proposedBy: ctx.tenantId,
      })
      .onConflictDoNothing({ target: schema.products.slug })
      .returning({ id: schema.products.id, slug: schema.products.slug, name: schema.products.name, status: schema.products.status });
    const product = inserted[0];
    if (product === undefined) throw new ConflictException('That product slug is taken');

    const variants = await ctx.tx
      .insert(schema.productVariants)
      .values(
        input.variants.map((variant, index) => ({
          productId: product.id,
          sku: variant.sku,
          name: variant.name,
          position: index,
        })),
      )
      .onConflictDoNothing({ target: schema.productVariants.sku })
      .returning({ id: schema.productVariants.id, sku: schema.productVariants.sku, name: schema.productVariants.name });

    // SKUs are globally unique, so a clash means someone else's product already
    // claims it. Failing here rolls the whole proposal back rather than leaving
    // a product with fewer variants than were asked for.
    if (variants.length !== input.variants.length) {
      throw new ConflictException('One of those SKUs is already in use');
    }

    for (const attribute of input.attributes ?? []) {
      const set = [attribute.text, attribute.number, attribute.bool].filter(
        (v) => v !== undefined,
      );
      // Migration 0008 has a CHECK for this too. Rejecting it here turns a
      // constraint violation into a message that names the offending key.
      if (set.length !== 1) {
        throw new BadRequestException(
          `Attribute "${attribute.key}" must carry exactly one of text, number or bool`,
        );
      }
      await ctx.tx.insert(schema.productAttributes).values({
        productId: product.id,
        key: attribute.key,
        valueText: attribute.text ?? null,
        valueNumber: attribute.number ?? null,
        valueBool: attribute.bool ?? null,
      });
    }

    return { ...product, variants };
  }

  async addMedia(productId: string, input: MediaInput): Promise<ProductMedia> {
    const ctx = getRequestContext();

    const products = await ctx.tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    if (products[0] === undefined) throw new NotFoundException('No such product');

    const bytes = Buffer.from(input.contentBase64, 'base64');
    // Buffer.from ignores what it cannot decode rather than throwing, so
    // without this a garbage body stores an empty file and returns 201.
    if (bytes.length === 0) throw new BadRequestException('contentBase64 is not valid base64');
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException(`Media is limited to ${MAX_DOCUMENT_BYTES} bytes`);
    }

    // The key carries no part of the caller's filename - a user-supplied name
    // in a filesystem path is a traversal bug. The name survives as data below.
    const { storageKey } = await this.files.put(bytes, {
      tenantId: productId,
      contentType: input.contentType,
    });

    const existing = await ctx.tx
      .select({ id: schema.productMedia.id })
      .from(schema.productMedia)
      .where(eq(schema.productMedia.productId, productId));

    const inserted = await ctx.tx
      .insert(schema.productMedia)
      .values({
        productId,
        storageKey,
        contentType: input.contentType,
        originalFilename: input.filename,
        altText: input.altText ?? null,
        position: existing.length,
      })
      .returning();
    const media = inserted[0];
    if (media === undefined) throw new ConflictException('Media could not be stored');

    // storageKey is deliberately absent from the response: it is an opaque
    // handle owned by the port, and putting it on the wire invites a client to
    // build a URL out of it.
    return {
      id: media.id,
      productId: media.productId,
      contentType: media.contentType,
      originalFilename: media.originalFilename,
      altText: media.altText,
      position: media.position,
    };
  }
}
