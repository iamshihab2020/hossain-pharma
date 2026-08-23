import { apiClient } from './client';
import {
  CartItem,
  AddToCartPayload,
  UpdateCartQuantityPayload,
} from '@/types/cart';
import { InsertResult, DeleteResult, UpdateResult } from '@/types/api';

// Get cart items for user
export const getCart = async (email: string): Promise<CartItem[]> => {
  const response = await apiClient.get<CartItem[]>('/cart', {
    params: { email },
  });
  return response.data;
};

// Add item to cart
export const addToCart = async (
  item: AddToCartPayload
): Promise<InsertResult> => {
  const response = await apiClient.post<InsertResult>('/cart', item);
  return response.data;
};

// Update cart item quantity
export const updateCartItemQuantity = async (
  id: string,
  quantity: number
): Promise<UpdateResult & { message: string }> => {
  const response = await apiClient.patch<UpdateResult & { message: string }>(
    `/cart/${id}`,
    { quantity } as UpdateCartQuantityPayload
  );
  return response.data;
};

// Remove item from cart
export const removeFromCart = async (id: string): Promise<DeleteResult> => {
  const response = await apiClient.delete<DeleteResult>(`/cart/${id}`);
  return response.data;
};

// Clear entire cart for user
export const clearCart = async (email: string): Promise<DeleteResult> => {
  const response = await apiClient.delete<DeleteResult>(`/cart/user/${email}`);
  return response.data;
};

// Calculate cart summary
export const calculateCartSummary = (items: CartItem[]) => {
  const subtotal = items.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );
  const taxRate = 0.05; // 5% tax
  const tax = subtotal * taxRate;
  const shippingThreshold = 50; // Free shipping over $50
  const shippingCost = 5.99;
  const shipping = subtotal >= shippingThreshold ? 0 : shippingCost;
  const total = subtotal + tax + shipping;
  const itemCount = items.reduce((count, item) => count + item.quantity, 0);

  return {
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    total: Math.round(total * 100) / 100,
    itemCount,
  };
};
