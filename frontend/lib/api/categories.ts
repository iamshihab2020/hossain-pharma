import { apiClient } from './client';
import { Category, CreateCategoryPayload } from '@/types/category';
import { InsertResult, DeleteResult } from '@/types/api';

// Get all categories
export const getAllCategories = async (): Promise<Category[]> => {
  const response = await apiClient.get<Category[]>('/category');
  return response.data;
};

// Get single category by tag (filter from all - no dedicated endpoint)
export const getCategoryByTag = async (
  categoryTag: string
): Promise<Category | null> => {
  const categories = await getAllCategories();
  return categories.find((c) => c.categoryTag === categoryTag) || null;
};

// Create category (admin only)
export const createCategory = async (
  category: CreateCategoryPayload
): Promise<InsertResult> => {
  const response = await apiClient.post<InsertResult>('/category', category);
  return response.data;
};

// Delete category (admin only)
export const deleteCategory = async (
  id: string
): Promise<DeleteResult & { message: string }> => {
  const response = await apiClient.delete<DeleteResult & { message: string }>(
    `/category/${id}`
  );
  return response.data;
};
