'use client';

import { VendorCard } from './vendor-card';
import { getFeaturedVendors } from '@/lib/mock-data/vendors';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

export function VendorShowcase() {
  const featuredVendors = getFeaturedVendors();

  return (
    <section className="py-16" aria-labelledby="featured-vendors-heading">
      <div className="container">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 id="featured-vendors-heading" className="text-3xl font-bold mb-2">
              Featured Pharmacies
            </h2>
            <p className="text-muted-foreground">
              Trusted and verified pharmacy partners near you
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/vendors">
              View All
              <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {featuredVendors.slice(0, 3).map((vendor) => (
            <VendorCard key={vendor.id} vendor={vendor} />
          ))}
        </div>
      </div>
    </section>
  );
}
