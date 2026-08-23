'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ShopHeader } from '@/components/shop/shop-header';
import { ShopFilters, FilterState, getDefaultFilters } from '@/components/shop/shop-filters';
import { SortOption } from '@/components/shop/sort-dropdown';
import { ProductGrid } from '@/components/products/product-grid';
import { Pagination, PaginationInfo } from '@/components/ui/pagination';
import { getAllProducts, filterProducts, sortProducts } from '@/lib/api/products';
import { getAllCategories } from '@/lib/api/categories';
import { BackendProduct } from '@/types/api';

const ITEMS_PER_PAGE = 12;

export default function ShopPage() {
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get('category');
  const searchQuery = searchParams.get('q');

  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [filters, setFilters] = useState<FilterState>(() => {
    const defaultFilters = getDefaultFilters();
    if (initialCategory) {
      return { ...defaultFilters, categories: [initialCategory] };
    }
    return defaultFilters;
  });
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch products
  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['products'],
    queryFn: getAllProducts,
  });

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getAllCategories,
  });

  // Calculate max price for filter
  const maxPrice = useMemo(() => {
    if (products.length === 0) return 1000;
    return Math.ceil(
      Math.max(...products.map((p) => p.discountPrice || p.price)) / 100
    ) * 100;
  }, [products]);

  // Apply filters and sorting
  const filteredProducts = useMemo(() => {
    let result = filterProducts(products, {
      category: filters.categories.length === 1 ? filters.categories[0] : undefined,
      minPrice: filters.priceRange[0],
      maxPrice: filters.priceRange[1],
      prescriptionRequired: filters.prescriptionRequired ?? undefined,
      searchQuery: searchQuery || undefined,
    });

    // Handle multiple categories
    if (filters.categories.length > 1) {
      result = result.filter((p) => filters.categories.includes(p.categoryTag));
    }

    return sortProducts(result, sortBy);
  }, [products, filters, sortBy, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, sortBy, searchQuery]);

  // Update filters when URL category changes
  useEffect(() => {
    if (initialCategory) {
      setFilters((prev) => ({ ...prev, categories: [initialCategory] }));
    }
  }, [initialCategory]);

  const getTitle = () => {
    if (searchQuery) {
      return `Search results for "${searchQuery}"`;
    }
    if (filters.categories.length === 1) {
      const category = categories.find(
        (c) => c.categoryTag === filters.categories[0]
      );
      return category?.name || 'Products';
    }
    return 'All Products';
  };

  return (
    <div className="container py-8">
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Filters sidebar */}
        <ShopFilters
          categories={categories}
          filters={filters}
          onFiltersChange={setFilters}
          maxPrice={maxPrice}
          className="w-64 shrink-0"
        />

        {/* Main content */}
        <div className="flex-1 space-y-6">
          {/* Header with mobile filter button */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <ShopHeader
              title={getTitle()}
              productCount={filteredProducts.length}
              sortBy={sortBy}
              onSortChange={setSortBy}
            />
            <div className="lg:hidden">
              <ShopFilters
                categories={categories}
                filters={filters}
                onFiltersChange={setFilters}
                maxPrice={maxPrice}
              />
            </div>
          </div>

          {/* Product grid */}
          <ProductGrid
            products={paginatedProducts}
            isLoading={productsLoading}
            skeletonCount={ITEMS_PER_PAGE}
            columns={3}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col items-center gap-4 pt-8 sm:flex-row sm:justify-between">
              <PaginationInfo
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={filteredProducts.length}
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
    </div>
  );
}
