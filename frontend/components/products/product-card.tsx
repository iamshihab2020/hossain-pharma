'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ShoppingCart, Heart, Eye, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { BackendProduct } from '@/types/api';
import { useCartStore } from '@/lib/stores/cart-store';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useUIStore } from '@/lib/stores/ui-store';

interface ProductCardProps {
  product: BackendProduct;
  onClick?: () => void;
  className?: string;
}

export function ProductCard({ product, onClick, className }: ProductCardProps) {
  const { user, isAuthenticated } = useAuthStore();
  const { addToCartWithSync, addItem } = useCartStore();
  const { openLoginModal, openQuickView } = useUIStore();

  const hasDiscount = product.discountPrice && product.discountPrice < product.price;
  const displayPrice = product.discountPrice || product.price;
  const discountPercent = hasDiscount
    ? Math.round(((product.price - product.discountPrice!) / product.price) * 100)
    : 0;

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isAuthenticated || !user?.email) {
      openLoginModal();
      return;
    }

    const cartItem = {
      email: user.email,
      productId: product._id,
      name: product.name,
      image: product.image,
      price: displayPrice,
      quantity: 1,
      category: product.category,
      prescriptionRequired: product.prescriptionRequired,
    };

    try {
      await addToCartWithSync(cartItem);
    } catch {
      // Fallback to local add if API fails
      addItem(cartItem);
    }
  };

  const handleQuickView = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openQuickView(product._id);
  };

  return (
    <Card
      className={cn(
        'group overflow-hidden transition-all hover:shadow-lg',
        className
      )}
    >
      <Link href={`/shop/${product._id}`} onClick={onClick}>
        <div className="relative aspect-square overflow-hidden bg-muted">
          <Image
            src={product.image || '/placeholder-product.png'}
            alt={product.name}
            fill
            className="object-cover transition-transform group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />

          {/* Badges */}
          <div className="absolute left-2 top-2 flex flex-col gap-1">
            {hasDiscount && (
              <Badge variant="destructive" className="text-xs">
                -{discountPercent}%
              </Badge>
            )}
            {product.prescriptionRequired && (
              <Badge variant="secondary" className="text-xs">
                <FileText className="mr-1 h-3 w-3" />
                Rx
              </Badge>
            )}
          </div>

          {/* Quick actions */}
          <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8"
              onClick={handleQuickView}
            >
              <Eye className="h-4 w-4" />
              <span className="sr-only">Quick view</span>
            </Button>
            <Button size="icon" variant="secondary" className="h-8 w-8">
              <Heart className="h-4 w-4" />
              <span className="sr-only">Add to wishlist</span>
            </Button>
          </div>
        </div>

        <CardContent className="p-4">
          {/* Category */}
          <p className="text-xs text-muted-foreground mb-1">{product.category}</p>

          {/* Name */}
          <h3 className="font-medium line-clamp-2 min-h-[2.5rem] mb-2">
            {product.name}
          </h3>

          {/* Manufacturer */}
          <p className="text-xs text-muted-foreground mb-2">
            {product.manufacturer}
          </p>

          {/* Price */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg font-bold text-primary">
              ${displayPrice.toFixed(2)}
            </span>
            {hasDiscount && (
              <span className="text-sm text-muted-foreground line-through">
                ${product.price.toFixed(2)}
              </span>
            )}
          </div>

          {/* Add to cart button */}
          <Button
            className="w-full"
            size="sm"
            onClick={handleAddToCart}
            disabled={product.prescriptionRequired}
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            {product.prescriptionRequired ? 'Prescription Required' : 'Add to Cart'}
          </Button>
        </CardContent>
      </Link>
    </Card>
  );
}
