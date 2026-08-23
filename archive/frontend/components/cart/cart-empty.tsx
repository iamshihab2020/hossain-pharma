'use client';

import { useRouter } from 'next/navigation';
import { ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CartEmpty() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
        <ShoppingCart className="h-10 w-10 text-muted-foreground" />
      </div>

      <h2 className="text-xl font-semibold">Your cart is empty</h2>
      <p className="mt-2 text-muted-foreground max-w-sm">
        Looks like you haven&apos;t added any items to your cart yet. Start
        shopping to fill it up!
      </p>

      <Button className="mt-6" onClick={() => router.push('/shop')}>
        Start Shopping
      </Button>
    </div>
  );
}
