'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Trash2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CartItem as CartItemType } from '@/types/cart';

interface CartItemProps {
  item: CartItemType;
  onQuantityChange: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  isUpdating?: boolean;
}

export function CartItem({
  item,
  onQuantityChange,
  onRemove,
  isUpdating,
}: CartItemProps) {
  const handleIncrement = () => {
    onQuantityChange(item._id, item.quantity + 1);
  };

  const handleDecrement = () => {
    if (item.quantity > 1) {
      onQuantityChange(item._id, item.quantity - 1);
    }
  };

  return (
    <div className="flex gap-4 py-4">
      {/* Product image */}
      <Link href={`/shop/${item.productId}`} className="shrink-0">
        <div className="relative h-24 w-24 overflow-hidden rounded-md border bg-muted">
          <Image
            src={item.image || '/placeholder-product.png'}
            alt={item.name}
            fill
            className="object-cover"
          />
        </div>
      </Link>

      {/* Product details */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              href={`/shop/${item.productId}`}
              className="font-medium hover:underline line-clamp-2"
            >
              {item.name}
            </Link>
            {item.category && (
              <p className="text-sm text-muted-foreground">{item.category}</p>
            )}
            {item.prescriptionRequired && (
              <Badge variant="secondary" className="mt-1">
                Prescription Required
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(item._id)}
            disabled={isUpdating}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Remove item</span>
          </Button>
        </div>

        <div className="mt-auto flex items-center justify-between pt-2">
          {/* Quantity controls */}
          <div className="flex items-center">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-r-none"
              onClick={handleDecrement}
              disabled={item.quantity <= 1 || isUpdating}
            >
              <Minus className="h-3 w-3" />
              <span className="sr-only">Decrease quantity</span>
            </Button>
            <div className="flex h-8 w-10 items-center justify-center border-y text-sm">
              {item.quantity}
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-l-none"
              onClick={handleIncrement}
              disabled={isUpdating}
            >
              <Plus className="h-3 w-3" />
              <span className="sr-only">Increase quantity</span>
            </Button>
          </div>

          {/* Price */}
          <div className="text-right">
            <p className="font-medium">
              ${(item.price * item.quantity).toFixed(2)}
            </p>
            {item.quantity > 1 && (
              <p className="text-xs text-muted-foreground">
                ${item.price.toFixed(2)} each
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
