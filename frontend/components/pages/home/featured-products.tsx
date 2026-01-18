'use client'

import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn } from '@/components/animations/fade-in'
import { ProductCardEnhanced } from '@/components/ui/product-card-enhanced'
import { getFeaturedProducts } from '@/lib/mock-data/products-enhanced'

export function FeaturedProducts() {
  const featuredProducts = getFeaturedProducts();

  return (
    <section className="py-16 w-full px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <FadeIn direction="up" duration={0.6}>
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-amber-500/10 px-4 py-2 rounded-full mb-4">
              <Star className="h-5 w-5 text-amber-500 fill-amber-500" aria-hidden="true" />
              <span className="text-sm font-semibold text-amber-600 dark:text-amber-500">Featured Products</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
              Top Rated <span className="text-primary">Products</span>
            </h2>
            <p className="text-muted-foreground text-lg">
              Handpicked products from our verified pharmacy partners
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
          {featuredProducts.map((product, index) => (
            <FadeIn key={product.id} direction="up" delay={index * 0.1} duration={0.5} className="h-full">
              <ProductCardEnhanced product={product} />
            </FadeIn>
          ))}
        </div>

        <FadeIn direction="up" delay={0.6} duration={0.5}>
          <div className="flex justify-center mt-10">
            <Button size="lg" variant="outline" className="group">
              View All Featured Products
              <Star className="ml-2 h-4 w-4 fill-amber-500 text-amber-500 transition-transform group-hover:scale-110" aria-hidden="true" />
            </Button>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
