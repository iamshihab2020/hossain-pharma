'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import { CheckoutForm } from '@/components/checkout/checkout-form';
import { OrderSuccess } from '@/components/checkout/order-success';
import { CartSummary } from '@/components/cart/cart-summary';
import { PageLoader } from '@/components/ui/loading-spinner';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useCartStore } from '@/lib/stores/cart-store';

export default function CheckoutPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { items, isLoading: cartLoading, syncWithServer, getCartSummary } = useCartStore();
  const [orderComplete, setOrderComplete] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?redirect=/checkout');
    }
  }, [authLoading, isAuthenticated, router]);

  // Sync cart on mount
  useEffect(() => {
    if (isAuthenticated && user?.email) {
      syncWithServer(user.email);
    }
  }, [isAuthenticated, user?.email, syncWithServer]);

  // Redirect if cart is empty (and not just completed an order)
  useEffect(() => {
    if (!cartLoading && items.length === 0 && !orderComplete) {
      router.push('/cart');
    }
  }, [cartLoading, items.length, orderComplete, router]);

  const handleOrderSuccess = (txnId: string) => {
    setTransactionId(txnId);
    setOrderComplete(true);
  };

  if (authLoading || cartLoading) {
    return <PageLoader text="Loading checkout..." />;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (orderComplete && transactionId) {
    return (
      <div className="container py-8">
        <OrderSuccess transactionId={transactionId} />
      </div>
    );
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
        <Link href="/cart" className="hover:text-foreground">
          Cart
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">Checkout</span>
      </nav>

      <h1 className="mb-8 text-3xl font-bold">Checkout</h1>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Checkout form */}
        <div className="lg:col-span-2">
          <CheckoutForm summary={summary} onSuccess={handleOrderSuccess} />
        </div>

        {/* Order summary */}
        <div className="lg:col-span-1">
          <div className="sticky top-20">
            <CartSummary summary={summary} />
          </div>
        </div>
      </div>
    </div>
  );
}
