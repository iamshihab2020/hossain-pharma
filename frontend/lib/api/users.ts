import { apiClient } from './client';
import { User } from '@/types/user';
import { UpdateResult, DeleteResult } from '@/types/api';

// Get all users (admin only)
export const getAllUsers = async (): Promise<User[]> => {
  const response = await apiClient.get<User[]>('/users');
  return response.data;
};

// Make user an admin
export const makeUserAdmin = async (id: string): Promise<UpdateResult> => {
  const response = await apiClient.patch<UpdateResult>(`/users/admin/${id}`);
  return response.data;
};

// Make user a seller
export const makeUserSeller = async (id: string): Promise<UpdateResult> => {
  const response = await apiClient.patch<UpdateResult>(`/users/seller/${id}`);
  return response.data;
};

// Demote user to regular user
export const demoteToUser = async (id: string): Promise<UpdateResult> => {
  const response = await apiClient.patch<UpdateResult>(`/users/user/${id}`);
  return response.data;
};

// Delete user
export const deleteUser = async (id: string): Promise<DeleteResult> => {
  const response = await apiClient.delete<DeleteResult>(`/users/${id}`);
  return response.data;
};
