'use client';

import { use, useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Home } from 'lucide-react';
import { ShopHeader } from '@/components/shop/shop-header';
import { SortOption } from '@/components/shop/sort-dropdown';
import { ProductGrid } from '@/components/products/product-grid';
import { Pagination, PaginationInfo } from '@/components/ui/pagination';
import { PageLoader } from '@/components/ui/loading-spinner';
import { getProductsByCategory, sortProducts } from '@/lib/api/products';
import { getCategoryByTag } from '@/lib/api/categories';

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
}

const ITEMS_PER_PAGE = 12;

export default function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = use(params);

  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch category info
  const { data: category, isLoading: categoryLoading } = useQuery({
    queryKey: ['category', slug],
    queryFn: () => getCategoryByTag(slug),
    enabled: !!slug,
  });

  // Fetch products in category
  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['products', 'category', slug],
    queryFn: () => getProductsByCategory(slug),
    enabled: !!slug,
  });

  // Sort products
  const sortedProducts = useMemo(() => {
    return sortProducts(products, sortBy);
  }, [products, sortBy]);

  // Pagination
  const totalPages = Math.ceil(sortedProducts.length / ITEMS_PER_PAGE);
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedProducts, currentPage]);

  // Reset page when sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [sortBy]);

  const isLoading = categoryLoading || productsLoading;

  if (isLoading) {
    return <PageLoader text="Loading category..." />;
  }

  const categoryName = category?.name || slug.replace(/-/g, ' ');

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
        <span className="text-foreground capitalize">{categoryName}</span>
      </nav>

      {/* Category header */}
      {category?.description && (
        <p className="mb-6 text-muted-foreground">{category.description}</p>
      )}

      <div className="space-y-6">
        {/* Header */}
        <ShopHeader
          title={categoryName}
          productCount={sortedProducts.length}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />

        {/* Product grid */}
        <ProductGrid
          products={paginatedProducts}
          isLoading={isLoading}
          skeletonCount={ITEMS_PER_PAGE}
          columns={4}
          emptyStateAction={() => window.location.href = '/shop'}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col items-center gap-4 pt-8 sm:flex-row sm:justify-between">
            <PaginationInfo
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={sortedProducts.length}
              itemsPerPage={ITEMS_PER_PAGE}
            />
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
