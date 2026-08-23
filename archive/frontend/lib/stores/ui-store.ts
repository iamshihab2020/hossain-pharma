'use client';

import { create } from 'zustand';

interface UIState {
  // Sidebar
  isSidebarOpen: boolean;
  isMobileSidebarOpen: boolean;

  // Modals
  isLoginModalOpen: boolean;
  isCartDrawerOpen: boolean;
  isSearchModalOpen: boolean;
  isPrescriptionModalOpen: boolean;
  isDrugInteractionModalOpen: boolean;

  // Quick view
  quickViewProductId: string | null;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;

  openLoginModal: () => void;
  closeLoginModal: () => void;

  openCartDrawer: () => void;
  closeCartDrawer: () => void;
  toggleCartDrawer: () => void;

  openSearchModal: () => void;
  closeSearchModal: () => void;

  openPrescriptionModal: () => void;
  closePrescriptionModal: () => void;

  openDrugInteractionModal: () => void;
  closeDrugInteractionModal: () => void;

  openQuickView: (productId: string) => void;
  closeQuickView: () => void;

  closeAllModals: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  // Initial state
  isSidebarOpen: true,
  isMobileSidebarOpen: false,
  isLoginModalOpen: false,
  isCartDrawerOpen: false,
  isSearchModalOpen: false,
  isPrescriptionModalOpen: false,
  isDrugInteractionModalOpen: false,
  quickViewProductId: null,

  // Sidebar actions
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  toggleMobileSidebar: () =>
    set((state) => ({ isMobileSidebarOpen: !state.isMobileSidebarOpen })),
  setMobileSidebarOpen: (open) => set({ isMobileSidebarOpen: open }),

  // Login modal
  openLoginModal: () => set({ isLoginModalOpen: true }),
  closeLoginModal: () => set({ isLoginModalOpen: false }),

  // Cart drawer
  openCartDrawer: () => set({ isCartDrawerOpen: true }),
  closeCartDrawer: () => set({ isCartDrawerOpen: false }),
  toggleCartDrawer: () =>
    set((state) => ({ isCartDrawerOpen: !state.isCartDrawerOpen })),

  // Search modal
  openSearchModal: () => set({ isSearchModalOpen: true }),
  closeSearchModal: () => set({ isSearchModalOpen: false }),

  // Prescription modal
  openPrescriptionModal: () => set({ isPrescriptionModalOpen: true }),
  closePrescriptionModal: () => set({ isPrescriptionModalOpen: false }),

  // Drug interaction modal
  openDrugInteractionModal: () => set({ isDrugInteractionModalOpen: true }),
  closeDrugInteractionModal: () => set({ isDrugInteractionModalOpen: false }),

  // Quick view
  openQuickView: (productId) => set({ quickViewProductId: productId }),
  closeQuickView: () => set({ quickViewProductId: null }),

  // Close all
  closeAllModals: () =>
    set({
      isLoginModalOpen: false,
      isCartDrawerOpen: false,
      isSearchModalOpen: false,
      isPrescriptionModalOpen: false,
      isDrugInteractionModalOpen: false,
      quickViewProductId: null,
    }),
}));

// Selector hooks
export const useSidebarOpen = () => useUIStore((state) => state.isSidebarOpen);
export const useMobileSidebarOpen = () =>
  useUIStore((state) => state.isMobileSidebarOpen);
export const useCartDrawerOpen = () =>
  useUIStore((state) => state.isCartDrawerOpen);
export const useQuickViewProductId = () =>
  useUIStore((state) => state.quickViewProductId);
