'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ChevronRight, Home, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CartItem } from '@/components/cart/cart-item';
import { CartSummary } from '@/components/cart/cart-summary';
import { CartEmpty } from '@/components/cart/cart-empty';
import { PageLoader } from '@/components/ui/loading-spinner';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useCartStore } from '@/lib/stores/cart-store';

export default function CartPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuthStore();
  const {
    items,
    isLoading,
    isSyncing,
    syncWithServer,
    updateQuantityWithSync,
    removeFromCartWithSync,
    getCartSummary,
  } = useCartStore();

  // Sync cart with server when user is authenticated
  useEffect(() => {
    if (isAuthenticated && user?.email) {
      syncWithServer(user.email);
    }
  }, [isAuthenticated, user?.email, syncWithServer]);

  const handleQuantityChange = (id: string, quantity: number) => {
    updateQuantityWithSync(id, quantity);
  };

  const handleRemove = (id: string) => {
    removeFromCartWithSync(id);
  };

  if (authLoading || isLoading) {
    return <PageLoader text="Loading cart..." />;
  }

  const summary = getCartSummary();

  return (
    <div className="container py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          <Home className="h-4 w-4" />
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">Shopping Cart</span>
      </nav>

      <h1 className="mb-8 text-3xl font-bold">Shopping Cart</h1>

      {items.length === 0 ? (
        <CartEmpty />
      ) : (
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Cart items */}
          <div className="lg:col-span-2">
            <div className="rounded-lg border">
              <div className="divide-y">
                {items.map((item) => (
                  <div key={item._id} className="px-4">
                    <CartItem
                      item={item}
                      onQuantityChange={handleQuantityChange}
                      onRemove={handleRemove}
                      isUpdating={isSyncing}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Continue shopping */}
            <div className="mt-4">
              <Button variant="ghost" asChild>
                <Link href="/shop">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Continue Shopping
                </Link>
              </Button>
            </div>
          </div>

          {/* Cart summary */}
          <div className="lg:col-span-1">
            <div className="sticky top-20">
              <CartSummary summary={summary} isLoading={isSyncing} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
