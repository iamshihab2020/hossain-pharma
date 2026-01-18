'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Heart, Minus, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useCartStore } from '@/lib/stores/cart-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { BackendProduct } from '@/types/api';

interface ProductActionsProps {
  product: BackendProduct;
}

export function ProductActions({ product }: ProductActionsProps) {
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const { addToCartWithSync, isSyncing } = useCartStore();
  const { openLoginModal } = useUIStore();
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);

  const displayPrice = product.discountPrice || product.price;
  const isOutOfStock = product.stock !== undefined && product.stock <= 0;

  const incrementQuantity = () => {
    if (product.stock === undefined || quantity < product.stock) {
      setQuantity((prev) => prev + 1);
    }
  };

  const decrementQuantity = () => {
    if (quantity > 1) {
      setQuantity((prev) => prev - 1);
    }
  };

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    if (!isNaN(value) && value >= 1) {
      if (product.stock === undefined || value <= product.stock) {
        setQuantity(value);
      } else {
        setQuantity(product.stock);
      }
    }
  };

  const handleAddToCart = async () => {
    if (!isAuthenticated || !user?.email) {
      openLoginModal();
      return;
    }

    setIsAdding(true);
    try {
      await addToCartWithSync({
        email: user.email,
        productId: product._id,
        name: product.name,
        image: product.image,
        price: displayPrice,
        quantity,
        category: product.category,
        prescriptionRequired: product.prescriptionRequired,
      });
      // Show success feedback
    } catch (error) {
      console.error('Failed to add to cart:', error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleBuyNow = async () => {
    if (!isAuthenticated || !user?.email) {
      openLoginModal();
      return;
    }

    setIsAdding(true);
    try {
      await addToCartWithSync({
        email: user.email,
        productId: product._id,
        name: product.name,
        image: product.image,
        price: displayPrice,
        quantity,
        category: product.category,
        prescriptionRequired: product.prescriptionRequired,
      });
      router.push('/checkout');
    } catch (error) {
      console.error('Failed to add to cart:', error);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Quantity selector */}
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">Quantity</span>
        <div className="flex items-center">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-r-none"
            onClick={decrementQuantity}
            disabled={quantity <= 1 || isOutOfStock}
          >
            <Minus className="h-4 w-4" />
            <span className="sr-only">Decrease quantity</span>
          </Button>
          <Input
            type="number"
            min={1}
            max={product.stock}
            value={quantity}
            onChange={handleQuantityChange}
            className="h-9 w-16 rounded-none border-x-0 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            disabled={isOutOfStock}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-l-none"
            onClick={incrementQuantity}
            disabled={
              isOutOfStock ||
              (product.stock !== undefined && quantity >= product.stock)
            }
          >
            <Plus className="h-4 w-4" />
            <span className="sr-only">Increase quantity</span>
          </Button>
        </div>
        {product.stock !== undefined && (
          <span className="text-sm text-muted-foreground">
            {product.stock} available
          </span>
        )}
      </div>

      {/* Total */}
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-muted-foreground">Total:</span>
        <span className="text-xl font-bold">
          ${(displayPrice * quantity).toFixed(2)}
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="flex-1"
          size="lg"
          onClick={handleAddToCart}
          disabled={
            product.prescriptionRequired ||
            isOutOfStock ||
            isAdding ||
            isSyncing
          }
        >
          {isAdding || isSyncing ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <ShoppingCart className="mr-2 h-5 w-5" />
          )}
          {product.prescriptionRequired
            ? 'Prescription Required'
            : isOutOfStock
            ? 'Out of Stock'
            : 'Add to Cart'}
        </Button>

        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={handleBuyNow}
          disabled={
            product.prescriptionRequired ||
            isOutOfStock ||
            isAdding ||
            isSyncing
          }
        >
          Buy Now
        </Button>

        <Button variant="outline" size="icon" className="h-12 w-12 shrink-0">
          <Heart className="h-5 w-5" />
          <span className="sr-only">Add to wishlist</span>
        </Button>
      </div>
    </div>
  );
}
