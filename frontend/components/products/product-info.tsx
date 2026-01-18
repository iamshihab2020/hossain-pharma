'use client';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  FileText,
  Building2,
  Package,
  Tag,
  AlertTriangle,
} from 'lucide-react';
import { BackendProduct } from '@/types/api';

interface ProductInfoProps {
  product: BackendProduct;
}

export function ProductInfo({ product }: ProductInfoProps) {
  const hasDiscount =
    product.discountPrice && product.discountPrice < product.price;
  const displayPrice = product.discountPrice || product.price;
  const discountPercent = hasDiscount
    ? Math.round(
        ((product.price - product.discountPrice!) / product.price) * 100
      )
    : 0;

  return (
    <div className="space-y-6">
      {/* Category & Badges */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{product.category}</Badge>
        {product.prescriptionRequired && (
          <Badge variant="secondary">
            <FileText className="mr-1 h-3 w-3" />
            Prescription Required
          </Badge>
        )}
        {hasDiscount && (
          <Badge variant="destructive">-{discountPercent}% OFF</Badge>
        )}
      </div>

      {/* Name */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          {product.name}
        </h1>
        {product.genericName && (
          <p className="mt-1 text-muted-foreground">
            Generic: {product.genericName}
          </p>
        )}
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold text-primary">
          ${displayPrice.toFixed(2)}
        </span>
        {hasDiscount && (
          <span className="text-xl text-muted-foreground line-through">
            ${product.price.toFixed(2)}
          </span>
        )}
      </div>

      <Separator />

      {/* Description */}
      <div>
        <h3 className="mb-2 font-semibold">Description</h3>
        <p className="text-muted-foreground">{product.description}</p>
      </div>

      <Separator />

      {/* Product details */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Manufacturer</p>
            <p className="font-medium">{product.manufacturer}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Tag className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Category</p>
            <p className="font-medium">{product.category}</p>
          </div>
        </div>

        {product.stock !== undefined && (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Package className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Stock</p>
              <p className="font-medium">
                {product.stock > 0 ? `${product.stock} available` : 'Out of stock'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Prescription warning */}
      {product.prescriptionRequired && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/50 dark:bg-yellow-900/20">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-500" />
            <div>
              <h4 className="font-medium text-yellow-800 dark:text-yellow-200">
                Prescription Required
              </h4>
              <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
                This medication requires a valid prescription from a licensed
                healthcare provider. Please upload your prescription during
                checkout or contact our pharmacy team.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
