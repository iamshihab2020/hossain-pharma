import { apiClient } from './client';
import { BackendProduct, InsertResult, DeleteResult } from '@/types/api';

// Get all products
export const getAllProducts = async (): Promise<BackendProduct[]> => {
  const response = await apiClient.get<BackendProduct[]>('/products');
  return response.data;
};

// Get products by category
export const getProductsByCategory = async (
  categoryTag: string
): Promise<BackendProduct[]> => {
  const response = await apiClient.get<BackendProduct[]>(
    `/products/category/${categoryTag}`
  );
  return response.data;
};

// Get single product by ID (filter from all products - no dedicated endpoint)
export const getProductById = async (
  id: string
): Promise<BackendProduct | null> => {
  const products = await getAllProducts();
  return products.find((p) => p._id === id) || null;
};

// Get seller's products
export const getSellerProducts = async (
  email: string
): Promise<BackendProduct[]> => {
  const response = await apiClient.get<BackendProduct[]>(
    `/products/seller/${email}`
  );
  return response.data;
};

// Create product (seller only)
export interface CreateProductPayload {
  name: string;
  genericName?: string;
  description: string;
  category: string;
  categoryTag: string;
  image: string;
  images?: string[];
  price: number;
  discountPrice?: number;
  prescriptionRequired: boolean;
  manufacturer: string;
  stock?: number;
  email: string; // seller email
}

export const createProduct = async (
  product: CreateProductPayload
): Promise<InsertResult> => {
  const response = await apiClient.post<InsertResult>('/products', product);
  return response.data;
};

// Delete product
export const deleteProduct = async (id: string): Promise<DeleteResult> => {
  const response = await apiClient.delete<DeleteResult>(`/products/${id}`);
  return response.data;
};

// Delete seller's product
export const deleteSellerProduct = async (id: string): Promise<DeleteResult> => {
  const response = await apiClient.delete<DeleteResult>(
    `/products/seller/${id}`
  );
  return response.data;
};

// Update product category (admin only)
export const updateProductCategory = async (
  id: string,
  category: string,
  categoryTag: string
): Promise<{ message: string }> => {
  const response = await apiClient.put<{ message: string }>(
    `/products/${id}/category`,
    { category, categoryTag }
  );
  return response.data;
};

// Client-side filtering helpers
export const filterProducts = (
  products: BackendProduct[],
  filters: {
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    prescriptionRequired?: boolean;
    searchQuery?: string;
  }
): BackendProduct[] => {
  return products.filter((product) => {
    // Category filter
    if (filters.category && product.categoryTag !== filters.category) {
      return false;
    }

    // Price filter
    const price = product.discountPrice || product.price;
    if (filters.minPrice !== undefined && price < filters.minPrice) {
      return false;
    }
    if (filters.maxPrice !== undefined && price > filters.maxPrice) {
      return false;
    }

    // Prescription filter
    if (
      filters.prescriptionRequired !== undefined &&
      product.prescriptionRequired !== filters.prescriptionRequired
    ) {
      return false;
    }

    // Search filter
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      const matchesName = product.name.toLowerCase().includes(query);
      const matchesDescription = product.description
        .toLowerCase()
        .includes(query);
      const matchesCategory = product.category.toLowerCase().includes(query);
      const matchesManufacturer = product.manufacturer
        .toLowerCase()
        .includes(query);

      if (
        !matchesName &&
        !matchesDescription &&
        !matchesCategory &&
        !matchesManufacturer
      ) {
        return false;
      }
    }

    return true;
  });
};

// Client-side sorting
export type SortOption = 'newest' | 'oldest' | 'price-low' | 'price-high' | 'name-asc' | 'name-desc';

export const sortProducts = (
  products: BackendProduct[],
  sortBy: SortOption
): BackendProduct[] => {
  const sorted = [...products];

  switch (sortBy) {
    case 'newest':
      return sorted.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    case 'oldest':
      return sorted.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    case 'price-low':
      return sorted.sort(
        (a, b) =>
          (a.discountPrice || a.price) - (b.discountPrice || b.price)
      );
    case 'price-high':
      return sorted.sort(
        (a, b) =>
          (b.discountPrice || b.price) - (a.discountPrice || a.price)
      );
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    default:
      return sorted;
  }
};
