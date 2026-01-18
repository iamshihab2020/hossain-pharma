import { apiClient } from './client';
import {
  Payment,
  CreatePaymentPayload,
  PaymentIntent,
  CreatePaymentIntentPayload,
  CreateInvoicePayload,
} from '@/types/order';
import { InsertResult, UpdateResult } from '@/types/api';

// Create Stripe payment intent
export const createPaymentIntent = async (
  price: number
): Promise<PaymentIntent> => {
  const response = await apiClient.post<PaymentIntent>(
    '/create-payment-intent',
    { price } as CreatePaymentIntentPayload
  );
  return response.data;
};

// Get user's payments/orders
export const getUserPayments = async (email: string): Promise<Payment[]> => {
  const response = await apiClient.get<Payment[]>(`/payments/${email}`);
  return response.data;
};

// Get all payments (public - no auth needed based on backend)
export const getAllPayments = async (): Promise<Payment[]> => {
  const response = await apiClient.get<Payment[]>('/payments');
  return response.data;
};

// Create payment record
export const createPayment = async (
  payment: CreatePaymentPayload
): Promise<{ paymentResult: InsertResult; deleteResult: { deletedCount: number } }> => {
  const response = await apiClient.post<{
    paymentResult: InsertResult;
    deleteResult: { deletedCount: number };
  }>('/payments', payment);
  return response.data;
};

// Accept payment (admin)
export const acceptPayment = async (id: string): Promise<UpdateResult> => {
  const response = await apiClient.patch<UpdateResult>(
    `/payments/accept/${id}`
  );
  return response.data;
};

// Reject payment (admin)
export const rejectPayment = async (id: string): Promise<UpdateResult> => {
  const response = await apiClient.patch<UpdateResult>(
    `/payments/reject/${id}`
  );
  return response.data;
};

// Create invoice
export const createInvoice = async (
  invoiceItems: CreateInvoicePayload[]
): Promise<InsertResult> => {
  const response = await apiClient.post<InsertResult>('/invoice', invoiceItems);
  return response.data;
};
