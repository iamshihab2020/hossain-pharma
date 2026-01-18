import { apiClient } from './client';
import { AdminStats, OrderStats } from '@/types/api';

// Get admin dashboard stats
export const getAdminStats = async (): Promise<AdminStats> => {
  const response = await apiClient.get<AdminStats>('/admin-stats');
  return response.data;
};

// Get order statistics by category
export const getOrderStats = async (): Promise<OrderStats[]> => {
  const response = await apiClient.get<OrderStats[]>('/order-stats');
  return response.data;
};
