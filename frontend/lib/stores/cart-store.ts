'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { CartItem, CartSummary, AddToCartPayload } from '@/types/cart';
import * as cartApi from '@/lib/api/cart';

interface CartState {
  items: CartItem[];
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;

  // Computed
  getCartSummary: () => CartSummary;
  getItemCount: () => number;

  // Local actions (optimistic updates)
  addItem: (item: AddToCartPayload) => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  setItems: (items: CartItem[]) => void;

  // API sync actions
  syncWithServer: (email: string) => Promise<void>;
  addToCartWithSync: (item: AddToCartPayload) => Promise<void>;
  updateQuantityWithSync: (id: string, quantity: number) => Promise<void>;
  removeFromCartWithSync: (id: string) => Promise<void>;
  clearCartWithSync: (email: string) => Promise<void>;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      isSyncing: false,
      error: null,

      getCartSummary: () => {
        return cartApi.calculateCartSummary(get().items);
      },

      getItemCount: () => {
        return get().items.reduce((count, item) => count + item.quantity, 0);
      },

      // Local actions for optimistic updates
      addItem: (item) => {
        const items = get().items;
        const existingIndex = items.findIndex(
          (i) => i.productId === item.productId
        );

        if (existingIndex >= 0) {
          // Update quantity if item exists
          const newItems = [...items];
          newItems[existingIndex] = {
            ...newItems[existingIndex],
            quantity: newItems[existingIndex].quantity + item.quantity,
          };
          set({ items: newItems });
        } else {
          // Add new item with temporary ID
          const newItem: CartItem = {
            ...item,
            _id: `temp-${Date.now()}`,
          };
          set({ items: [...items, newItem] });
        }
      },

      updateQuantity: (id, quantity) => {
        if (quantity <= 0) {
          get().removeItem(id);
          return;
        }
        set({
          items: get().items.map((item) =>
            item._id === id ? { ...item, quantity } : item
          ),
        });
      },

      removeItem: (id) => {
        set({ items: get().items.filter((item) => item._id !== id) });
      },

      clearCart: () => {
        set({ items: [] });
      },

      setItems: (items) => {
        set({ items });
      },

      // API sync actions
      syncWithServer: async (email) => {
        set({ isLoading: true, error: null });
        try {
          const items = await cartApi.getCart(email);
          set({ items, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to sync cart',
            isLoading: false,
          });
        }
      },

      addToCartWithSync: async (item) => {
        // Optimistic update
        get().addItem(item);
        set({ isSyncing: true, error: null });

        try {
          const result = await cartApi.addToCart(item);
          // Update the temporary ID with the real one
          const items = get().items.map((i) =>
            i.productId === item.productId && i._id.startsWith('temp-')
              ? { ...i, _id: result.insertedId }
              : i
          );
          set({ items, isSyncing: false });
        } catch (error) {
          // Revert optimistic update on error
          await get().syncWithServer(item.email);
          set({
            error: error instanceof Error ? error.message : 'Failed to add to cart',
            isSyncing: false,
          });
        }
      },

      updateQuantityWithSync: async (id, quantity) => {
        const originalItems = [...get().items];
        // Optimistic update
        get().updateQuantity(id, quantity);
        set({ isSyncing: true, error: null });

        try {
          await cartApi.updateCartItemQuantity(id, quantity);
          set({ isSyncing: false });
        } catch (error) {
          // Revert on error
          set({
            items: originalItems,
            error: error instanceof Error ? error.message : 'Failed to update quantity',
            isSyncing: false,
          });
        }
      },

      removeFromCartWithSync: async (id) => {
        const originalItems = [...get().items];
        // Optimistic update
        get().removeItem(id);
        set({ isSyncing: true, error: null });

        try {
          await cartApi.removeFromCart(id);
          set({ isSyncing: false });
        } catch (error) {
          // Revert on error
          set({
            items: originalItems,
            error: error instanceof Error ? error.message : 'Failed to remove item',
            isSyncing: false,
          });
        }
      },

      clearCartWithSync: async (email) => {
        const originalItems = [...get().items];
        // Optimistic update
        get().clearCart();
        set({ isSyncing: true, error: null });

        try {
          await cartApi.clearCart(email);
          set({ isSyncing: false });
        } catch (error) {
          // Revert on error
          set({
            items: originalItems,
            error: error instanceof Error ? error.message : 'Failed to clear cart',
            isSyncing: false,
          });
        }
      },
    }),
    {
      name: 'cart-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
      }),
    }
  )
);

// Selector hooks
export const useCartItems = () => useCartStore((state) => state.items);
export const useCartItemCount = () => useCartStore((state) => state.getItemCount());
export const useCartSummary = () => useCartStore((state) => state.getCartSummary());
export const useCartIsLoading = () => useCartStore((state) => state.isLoading);
