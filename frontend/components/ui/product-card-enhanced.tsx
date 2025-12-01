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
  const lowestPriceVendor = product.vendorPricing.sort((a, b) => a.price - b.price)[0];

  return (
    <Card className="group overflow-hidden hover:shadow-xl transition-all">
      <div className="relative aspect-square overflow-hidden bg-muted">
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
          {product.isGenericAvailable && (
            <Badge variant="secondary" className="text-xs">
              Generic Available
            </Badge>
          )}
        </div>

        {/* Quick Actions */}
        <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="secondary" className="rounded-full" aria-label="Add to wishlist">
            <Heart className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="secondary" className="rounded-full" aria-label="Quick view">
            <Eye className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="p-4">
        <h3 className="font-semibold mb-1 line-clamp-1">{product.name}</h3>
        {product.genericName && (
          <p className="text-xs text-muted-foreground mb-2">{product.genericName}</p>
        )}

        {product.dosage && (
          <p className="text-xs text-muted-foreground mb-2">
            {product.dosage} • {product.form}
          </p>
        )}

        {/* Vendor Info */}
        {lowestPriceVendor && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" aria-hidden="true" />
            <span>{lowestPriceVendor.vendorName}</span>
            {lowestPriceVendor.isVerified && (
              <Badge variant="outline" className="text-xs px-1 py-0">Verified</Badge>
            )}
          </div>
        )}

        {/* Stock Status */}
        {lowestPriceVendor?.inStock ? (
          <Badge variant="outline" className="text-xs text-success border-success mb-2">
            In Stock • {lowestPriceVendor.deliveryTime}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-danger border-danger mb-2">
            Out of Stock
          </Badge>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-lg font-bold">${lowestPriceVendor?.price.toFixed(2)}</span>
          {lowestPriceVendor?.originalPrice && (
            <span className="text-sm text-muted-foreground line-through">
              ${lowestPriceVendor.originalPrice.toFixed(2)}
            </span>
          )}
          {product.vendorCount > 1 && (
            <span className="text-xs text-muted-foreground">
              from {product.vendorCount} vendors
            </span>
          )}
        </div>

        {/* Rating */}
        <div className="flex items-center gap-1 text-sm mb-3">
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

        <Button className="w-full" size="sm">
          <ShoppingCart className="w-4 h-4 mr-2" aria-hidden="true" />
          {product.vendorCount > 1 ? 'Compare & Add' : 'Add to Cart'}
        </Button>
      </div>
    </Card>
  );
}
