import { apiClient } from './client';
import { Advertisement, CreateAdPayload, ApprovedAd } from '@/types/ads';
import { InsertResult, DeleteResult, UpdateResult } from '@/types/api';

// Get all ads (admin only)
export const getAllAds = async (): Promise<Advertisement[]> => {
  const response = await apiClient.get<Advertisement[]>('/admin/ads');
  return response.data;
};

// Get accepted ads (public)
export const getAcceptedAds = async (): Promise<Advertisement[]> => {
  const response = await apiClient.get<Advertisement[]>('/seller/ads');
  return response.data;
};

// Get seller's ads
export const getSellerAds = async (email: string): Promise<Advertisement[]> => {
  const response = await apiClient.get<Advertisement[]>(`/seller/ads/${email}`);
  return response.data;
};

// Get approved ads (moved to approved collection)
export const getApprovedAds = async (): Promise<ApprovedAd[]> => {
  const response = await apiClient.get<ApprovedAd[]>('/approvedAds');
  return response.data;
};

// Create ad (seller only)
export const createAd = async (ad: CreateAdPayload): Promise<InsertResult> => {
  const response = await apiClient.post<InsertResult>('/seller/ads', ad);
  return response.data;
};

// Approve ad - move to approved collection (admin only)
export const approveAdToCollection = async (
  ad: Advertisement
): Promise<{ message: string }> => {
  const response = await apiClient.post<{ message: string }>(
    '/seller/ads/approve',
    ad
  );
  return response.data;
};

// Accept ad - change status (admin/token)
export const acceptAd = async (id: string): Promise<UpdateResult> => {
  const response = await apiClient.patch<UpdateResult>(
    `/seller/ads/accept/${id}`
  );
  return response.data;
};

// Reject ad - change status (admin/token)
export const rejectAd = async (id: string): Promise<UpdateResult> => {
  const response = await apiClient.patch<UpdateResult>(
    `/seller/ads/reject/${id}`
  );
  return response.data;
};

// Delete ad (seller)
export const deleteAd = async (id: string): Promise<DeleteResult> => {
  const response = await apiClient.delete<DeleteResult>(`/seller/ads/${id}`);
  return response.data;
};

// Delete approved ad
export const deleteApprovedAd = async (id: string): Promise<DeleteResult> => {
  const response = await apiClient.delete<DeleteResult>(`/approvedAds/${id}`);
  return response.data;
};
