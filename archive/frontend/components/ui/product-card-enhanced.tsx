'use client';

import { ShoppingCart, Heart, Eye, Star } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProductWithVendor } from '@/types/product';
import Image from 'next/image';

interface ProductCardEnhancedProps {
  product: ProductWithVendor;
}

export function ProductCardEnhanced({ product }: ProductCardEnhancedProps) {
  // Create a copy and sort with stable ordering (price first, then vendor name)
  const lowestPriceVendor = [...product.vendorPricing].sort((a, b) =>
    a.price - b.price || a.vendorName.localeCompare(b.vendorName)
  )[0];

  return (
    <Card className="group overflow-hidden hover:shadow-xl transition-all h-full flex flex-col">
      <div className="relative aspect-square overflow-hidden bg-muted flex-shrink-0">
        <Image
          src={product.image}
          alt={product.name}
          fill
          className="object-cover group-hover:scale-105 transition-transform"
        />

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {product.prescriptionRequired && (
            <Badge variant="destructive" className="text-xs">
              Rx Required
            </Badge>
          )}
          {product.isDiscounted && lowestPriceVendor.discount && lowestPriceVendor.discount > 0 && (
            <Badge className="bg-danger text-danger-foreground text-xs">
              {lowestPriceVendor.discount}% OFF
            </Badge>
          )}
        </div>

        {/* Quick Actions */}
        <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="secondary" className="rounded-full h-8 w-8" aria-label="Add to wishlist">
            <Heart className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="secondary" className="rounded-full h-8 w-8" aria-label="Quick view">
            <Eye className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 flex flex-col flex-grow">
        {/* Product Name - Fixed height */}
        <h3 className="font-semibold line-clamp-1 h-6">{product.name}</h3>

        {/* Dosage - Fixed height */}
        <p className="text-xs text-muted-foreground h-4 line-clamp-1">
          {product.dosage ? `${product.dosage} • ${product.form}` : '\u00A0'}
        </p>

        {/* Vendor Info - Fixed height */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground h-5 mt-2">
          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400 flex-shrink-0" aria-hidden="true" />
          <span className="truncate">{lowestPriceVendor?.vendorName || 'Vendor'}</span>
          {lowestPriceVendor?.isVerified && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 flex-shrink-0">Verified</Badge>
          )}
        </div>

        {/* Spacer to push price and button to bottom */}
        <div className="flex-grow min-h-2" />

        {/* Price */}
        <div className="flex items-baseline gap-2 mt-2">
          <span className="text-lg font-bold">${lowestPriceVendor?.price.toFixed(2)}</span>
          {lowestPriceVendor?.originalPrice && (
            <span className="text-sm text-muted-foreground line-through">
              ${lowestPriceVendor.originalPrice.toFixed(2)}
            </span>
          )}
        </div>

        {/* Rating */}
        <div className="flex items-center gap-1 text-sm mt-1 mb-3">
          <div className="flex">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`w-3 h-3 ${
                  i < Math.floor(product.averageRating)
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-muted'
                }`}
                aria-hidden="true"
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            ({product.totalReviews})
          </span>
        </div>

        <Button className="w-full mt-auto" size="sm">
          <ShoppingCart className="w-4 h-4 mr-2" aria-hidden="true" />
          Add to Cart
        </Button>
      </div>
    </Card>
  );
}
