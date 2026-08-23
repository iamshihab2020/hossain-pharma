'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Home } from 'lucide-react';
import { ProductGallery } from '@/components/products/product-gallery';
import { ProductInfo } from '@/components/products/product-info';
import { ProductActions } from '@/components/products/product-actions';
import { RelatedProducts } from '@/components/products/related-products';
import { PageLoader } from '@/components/ui/loading-spinner';
import { getProductById } from '@/lib/api/products';

interface ProductPageProps {
  params: Promise<{ id: string }>;
}

export default function ProductPage({ params }: ProductPageProps) {
  const { id } = use(params);

  const { data: product, isLoading, error } = useQuery({
    queryKey: ['product', id],
    queryFn: () => getProductById(id),
    enabled: !!id,
  });

  if (isLoading) {
    return <PageLoader text="Loading product..." />;
  }

  if (error || !product) {
    return (
      <div className="container py-16 text-center">
        <h1 className="text-2xl font-bold">Product Not Found</h1>
        <p className="mt-2 text-muted-foreground">
          The product you&apos;re looking for doesn&apos;t exist or has been
          removed.
        </p>
        <Link
          href="/shop"
          className="mt-4 inline-block text-primary hover:underline"
        >
          Browse all products
        </Link>
      </div>
    );
  }

  const images = product.images?.length
    ? product.images
    : [product.image];

  return (
    <div className="container py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          <Home className="h-4 w-4" />
        </Link>
        <ChevronRight className="h-4 w-4" />
        <Link href="/shop" className="hover:text-foreground">
          Shop
        </Link>
        <ChevronRight className="h-4 w-4" />
        <Link
          href={`/shop?category=${product.categoryTag}`}
          className="hover:text-foreground"
        >
          {product.category}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="line-clamp-1 text-foreground">{product.name}</span>
      </nav>

      {/* Product content */}
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        {/* Left: Gallery */}
        <ProductGallery images={images} productName={product.name} />

        {/* Right: Info and actions */}
        <div className="space-y-8">
          <ProductInfo product={product} />
          <ProductActions product={product} />
        </div>
      </div>

      {/* Related products */}
      <RelatedProducts
        categoryTag={product.categoryTag}
        currentProductId={product._id}
      />
    </div>
  );
}
