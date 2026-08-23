'use client';

import { LucideIcon, Package, Search, ShoppingCart, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  variant?: 'default' | 'compact';
}

export function EmptyState({
  icon: Icon = Package,
  title,
  description,
  actionLabel,
  onAction,
  className,
  variant = 'default',
}: EmptyStateProps) {
  const isCompact = variant === 'compact';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        isCompact ? 'py-8' : 'py-16',
        className
      )}
    >
      <div
        className={cn(
          'rounded-full bg-muted flex items-center justify-center',
          isCompact ? 'h-12 w-12 mb-3' : 'h-16 w-16 mb-4'
        )}
      >
        <Icon
          className={cn(
            'text-muted-foreground',
            isCompact ? 'h-6 w-6' : 'h-8 w-8'
          )}
        />
      </div>

      <h3
        className={cn(
          'font-semibold text-foreground',
          isCompact ? 'text-base mb-1' : 'text-lg mb-2'
        )}
      >
        {title}
      </h3>

      {description && (
        <p
          className={cn(
            'text-muted-foreground max-w-sm',
            isCompact ? 'text-sm mb-3' : 'text-base mb-4'
          )}
        >
          {description}
        </p>
      )}

      {actionLabel && onAction && (
        <Button
          onClick={onAction}
          variant="default"
          size={isCompact ? 'sm' : 'default'}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

// Pre-configured empty states for common use cases
export function EmptyCartState({
  onAction,
  className,
}: {
  onAction?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      icon={ShoppingCart}
      title="Your cart is empty"
      description="Looks like you haven't added any items to your cart yet."
      actionLabel="Start Shopping"
      onAction={onAction}
      className={className}
    />
  );
}

export function NoResultsState({
  searchQuery,
  onClear,
  className,
}: {
  searchQuery?: string;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      icon={Search}
      title="No results found"
      description={
        searchQuery
          ? `We couldn't find any results for "${searchQuery}". Try different keywords.`
          : 'Try adjusting your search or filters to find what you\'re looking for.'
      }
      actionLabel={onClear ? 'Clear filters' : undefined}
      onAction={onClear}
      className={className}
    />
  );
}

export function NoOrdersState({
  onAction,
  className,
}: {
  onAction?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      icon={FileText}
      title="No orders yet"
      description="When you place your first order, it will appear here."
      actionLabel="Browse Products"
      onAction={onAction}
      className={className}
    />
  );
}

export function NoProductsState({
  onAction,
  className,
}: {
  onAction?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      icon={Package}
      title="No products found"
      description="There are no products in this category yet."
      actionLabel="View All Products"
      onAction={onAction}
      className={className}
    />
  );
}
