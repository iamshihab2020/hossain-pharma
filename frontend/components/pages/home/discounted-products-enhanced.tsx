'use client'

import { Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn } from '@/components/animations/fade-in'
import { ProductCardEnhanced } from '@/components/ui/product-card-enhanced'
import { getDiscountedProducts } from '@/lib/mock-data/products-enhanced'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'

export function DiscountedProductsEnhanced() {
  const discountedProducts = getDiscountedProducts();

  return (
    <section className="py-16 px-4 sm:px-6 md:px-10 lg:px-16 xl:px-20 w-full">
      <FadeIn direction="up" duration={0.6}>
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-danger/10 px-4 py-2 rounded-full mb-4">
            <Tag className="h-5 w-5 text-danger" aria-hidden="true" />
            <span className="text-sm font-semibold text-danger">Special Offers</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            Discounted <span className="text-danger">Products</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            Save big on quality medicines from multiple pharmacy partners
          </p>
        </div>
      </FadeIn>

      <div className="relative px-12">
        <Carousel
          opts={{
            align: 'start',
            loop: true,
          }}
          className="w-full"
        >
          <CarouselContent>
            {discountedProducts.map((product, index) => (
              <CarouselItem key={product.id} className="md:basis-1/2 lg:basis-1/4">
                <FadeIn direction="up" delay={index * 0.1} duration={0.5}>
                  <ProductCardEnhanced product={product} />
                </FadeIn>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-0" />
          <CarouselNext className="right-0" />
        </Carousel>
      </div>

      <FadeIn direction="up" delay={0.6} duration={0.5}>
        <div className="flex justify-center mt-10">
          <Button size="lg" variant="outline" className="group">
            View All Discounted Products
            <Tag className="ml-2 h-4 w-4 transition-transform group-hover:scale-110" aria-hidden="true" />
          </Button>
        </div>
      </FadeIn>
    </section>
  )
}
