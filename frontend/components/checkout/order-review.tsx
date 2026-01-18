'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, Loader2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ShippingData } from './shipping-form';
import { CartSummary as CartSummaryType } from '@/types/cart';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useCartStore } from '@/lib/stores/cart-store';
import { createPayment, createInvoice } from '@/lib/api/payments';

interface OrderReviewProps {
  summary: CartSummaryType;
  shippingData: ShippingData;
  onBack: () => void;
  onSuccess: (transactionId: string) => void;
}

export function OrderReview({
  summary,
  shippingData,
  onBack,
  onSuccess,
}: OrderReviewProps) {
  const { user } = useAuthStore();
  const { items, clearCart } = useCartStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePlaceOrder = async () => {
    if (!user?.email) return;

    setIsLoading(true);
    setError(null);

    try {
      // Get payment intent ID from session storage
      const transactionId =
        sessionStorage.getItem('paymentIntentId') || `txn_${Date.now()}`;

      // Create payment record
      await createPayment({
        email: user.email,
        transactionId,
        price: summary.total,
        cartIds: items.map((item) => item._id),
        productsIds: items.map((item) => item.productId),
        productNames: items.map((item) => item.name),
        status: 'pending',
      });

      // Create invoice items
      await createInvoice(
        items.map((item) => ({
          email: user.email,
          productId: item.productId,
          productName: item.name,
          price: item.price,
          quantity: item.quantity,
          transactionId,
        }))
      );

      // Clear local cart
      clearCart();

      // Clear session storage
      sessionStorage.removeItem('paymentIntentId');

      // Trigger success callback
      onSuccess(transactionId);
    } catch (err) {
      console.error('Order creation failed:', err);
      setError('Failed to place order. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <h2 className="mb-6 text-xl font-semibold">Review Your Order</h2>

      {error && (
        <div className="mb-6 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Shipping address */}
        <div>
          <h3 className="mb-2 font-medium">Shipping Address</h3>
          <div className="rounded-lg border p-4 text-sm">
            <p className="font-medium">
              {shippingData.firstName} {shippingData.lastName}
            </p>
            <p className="text-muted-foreground">{shippingData.address}</p>
            <p className="text-muted-foreground">
              {shippingData.city}, {shippingData.state} {shippingData.zipCode}
            </p>
            <p className="text-muted-foreground">{shippingData.country}</p>
            <Separator className="my-2" />
            <p className="text-muted-foreground">{shippingData.email}</p>
            <p className="text-muted-foreground">{shippingData.phone}</p>
          </div>
        </div>

        {/* Order items */}
        <div>
          <h3 className="mb-2 font-medium">
            Order Items ({summary.itemCount})
          </h3>
          <div className="rounded-lg border divide-y">
            {items.map((item) => (
              <div key={item._id} className="flex gap-3 p-3">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                  <Image
                    src={item.image || '/placeholder-product.png'}
                    alt={item.name}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="flex-1">
                  <p className="font-medium line-clamp-1">{item.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Qty: {item.quantity}
                  </p>
                </div>
                <p className="font-medium">
                  ${(item.price * item.quantity).toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Order total */}
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>${summary.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Shipping</span>
            <span>
              {summary.shipping === 0 ? 'Free' : `$${summary.shipping.toFixed(2)}`}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tax</span>
            <span>${summary.tax.toFixed(2)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span className="text-lg">${summary.total.toFixed(2)}</span>
          </div>
        </div>

        {/* Payment confirmation */}
        <div className="flex items-center gap-2 rounded-lg bg-green-50 p-4 text-green-800 dark:bg-green-900/20 dark:text-green-300">
          <CheckCircle className="h-5 w-5" />
          <span>Payment has been authorized</span>
        </div>

        {/* Actions */}
        <div className="flex justify-between pt-4">
          <Button type="button" variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>

          <Button
            size="lg"
            onClick={handlePlaceOrder}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Placing Order...
              </>
            ) : (
              'Place Order'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
