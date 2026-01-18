'use client';

import { useRouter } from 'next/navigation';
import { ShoppingCart, Truck, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { CartSummary as CartSummaryType } from '@/types/cart';

interface CartSummaryProps {
  summary: CartSummaryType;
  isLoading?: boolean;
}

export function CartSummary({ summary, isLoading }: CartSummaryProps) {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { openLoginModal } = useUIStore();

  const handleCheckout = () => {
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    router.push('/checkout');
  };

  const freeShippingThreshold = 50;
  const amountToFreeShipping = Math.max(0, freeShippingThreshold - summary.subtotal);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Order Summary
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Subtotal */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            Subtotal ({summary.itemCount} {summary.itemCount === 1 ? 'item' : 'items'})
          </span>
          <span>${summary.subtotal.toFixed(2)}</span>
        </div>

        {/* Shipping */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Shipping</span>
          <span>
            {summary.shipping === 0 ? (
              <span className="text-green-600">Free</span>
            ) : (
              `$${summary.shipping.toFixed(2)}`
            )}
          </span>
        </div>

        {/* Tax */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Estimated Tax</span>
          <span>${summary.tax.toFixed(2)}</span>
        </div>

        <Separator />

        {/* Total */}
        <div className="flex justify-between font-medium">
          <span>Total</span>
          <span className="text-lg">${summary.total.toFixed(2)}</span>
        </div>

        {/* Free shipping progress */}
        {summary.shipping > 0 && (
          <div className="rounded-lg bg-muted p-3">
            <div className="flex items-start gap-2 text-sm">
              <Truck className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <p>
                  Add <span className="font-medium">${amountToFreeShipping.toFixed(2)}</span>{' '}
                  more for free shipping
                </p>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted-foreground/20">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(100, (summary.subtotal / freeShippingThreshold) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex-col gap-3">
        <Button
          className="w-full"
          size="lg"
          onClick={handleCheckout}
          disabled={summary.itemCount === 0 || isLoading}
        >
          Proceed to Checkout
        </Button>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3 w-3" />
          <span>Taxes calculated at checkout</span>
        </div>
      </CardFooter>
    </Card>
  );
}
