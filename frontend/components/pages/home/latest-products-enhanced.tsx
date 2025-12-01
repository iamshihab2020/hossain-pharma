'use client'

import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FadeIn } from '@/components/animations/fade-in'
import { ProductCardEnhanced } from '@/components/ui/product-card-enhanced'
import { getLatestProducts } from '@/lib/mock-data/products-enhanced'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'

export function LatestProductsEnhanced() {
  const latestProducts = getLatestProducts();

  return (
    <section className="py-16 px-4 sm:px-6 md:px-10 lg:px-16 xl:px-20 w-full bg-gradient-to-b from-background to-muted/30">
      <FadeIn direction="up" duration={0.6}>
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-primary/10 px-4 py-2 rounded-full mb-4">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="text-sm font-semibold text-primary">Latest Arrivals</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            New <span className="text-primary">Medicines</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            Freshly stocked medicines from trusted pharmacy partners
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
            {latestProducts.map((product, index) => (
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
            View All New Arrivals
            <Sparkles className="ml-2 h-4 w-4 transition-transform group-hover:scale-110" aria-hidden="true" />
          </Button>
        </div>
      </FadeIn>
    </section>
  )
}
