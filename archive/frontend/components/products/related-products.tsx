'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ProductGrid } from './product-grid';
import { getProductsByCategory } from '@/lib/api/products';

interface RelatedProductsProps {
  categoryTag: string;
  currentProductId: string;
}

export function RelatedProducts({
  categoryTag,
  currentProductId,
}: RelatedProductsProps) {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', 'category', categoryTag],
    queryFn: () => getProductsByCategory(categoryTag),
  });

  // Filter out current product and limit to 4
  const relatedProducts = products
    .filter((p) => p._id !== currentProductId)
    .slice(0, 4);

  if (!isLoading && relatedProducts.length === 0) {
    return null;
  }

  return (
    <section className="mt-16">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">Related Products</h2>
        <Button variant="ghost" asChild>
          <Link href={`/shop?category=${categoryTag}`}>
            View All
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <ProductGrid
        products={relatedProducts}
        isLoading={isLoading}
        skeletonCount={4}
        columns={4}
      />
    </section>
  );
}
