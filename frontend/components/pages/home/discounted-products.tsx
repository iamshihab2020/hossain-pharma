'use client'

import { ShoppingCart, Percent, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { FadeIn } from '@/components/animations/fade-in'
import { Badge } from '@/components/ui/badge'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import { useState } from 'react'

// Temporary mock data - replace with API call later
const allDiscountedProducts = [
  {
    _id: '1',
    itemName: 'Paracetamol 500mg',
    pricePerPack: 12.99,
    originalPrice: 18.99,
    discountPercentage: 32,
    company: 'PharmaCo',
    image: '/products/paracetamol.png',
    category: 'Pain Relief',
  },
  {
    _id: '2',
    itemName: 'Vitamin D3 5000IU',
    pricePerPack: 15.99,
    originalPrice: 24.99,
    discountPercentage: 36,
    company: 'VitaHealth',
    image: '/products/vitamin-d.png',
    category: 'Vitamins',
  },
  {
    _id: '3',
    itemName: 'Omega-3 Fish Oil',
    pricePerPack: 19.99,
    originalPrice: 29.99,
    discountPercentage: 33,
    company: 'VitaHealth',
    image: '/products/omega3.png',
    category: 'Supplements',
  },
  {
    _id: '4',
    itemName: 'Blood Pressure Monitor',
    pricePerPack: 39.99,
    originalPrice: 59.99,
    discountPercentage: 33,
    company: 'MediCare',
    image: '/products/bp-monitor.png',
    category: 'Medical Devices',
  },
  {
    _id: '5',
    itemName: 'Multivitamin Complex',
    pricePerPack: 24.99,
    originalPrice: 34.99,
    discountPercentage: 29,
    company: 'VitaHealth',
    image: '/products/multivitamin.png',
    category: 'Vitamins',
  },
  {
    _id: '6',
    itemName: 'Glucometer Kit',
    pricePerPack: 29.99,
    originalPrice: 44.99,
    discountPercentage: 33,
    company: 'DiabCare',
    image: '/products/glucometer.png',
    category: 'Diabetes Care',
  },
  {
    _id: '7',
    itemName: 'Digital Thermometer',
    pricePerPack: 12.99,
    originalPrice: 19.99,
    discountPercentage: 35,
    company: 'HealthTech',
    image: '/products/thermometer.png',
    category: 'Medical Devices',
  },
  {
    _id: '8',
    itemName: 'Calcium + D3 Tablets',
    pricePerPack: 14.99,
    originalPrice: 21.99,
    discountPercentage: 32,
    company: 'VitaHealth',
    image: '/products/calcium.png',
    category: 'Supplements',
  },
]

export function DiscountedProducts() {
  const [showAll, setShowAll] = useState(false)
  const products = showAll ? allDiscountedProducts : allDiscountedProducts.slice(0, 6)

  const handleAddToCart = (product: typeof allDiscountedProducts[0]) => {
    // TODO: Implement add to cart functionality
    console.log('Adding to cart:', product)
  }

  return (
    <section className="py-16 px-4 sm:px-6 md:px-10 lg:px-16 xl:px-20 w-full bg-gradient-to-b from-primary/5 to-background">
      <FadeIn direction="up" duration={0.6}>
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-primary/10 px-4 py-2 rounded-full mb-4">
            <Percent className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-primary">Special Offers</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
            Discounted <span className="text-primary">Products</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            Save big on quality medicines and healthcare products
          </p>
        </div>
      </FadeIn>

      <Carousel
        opts={{
          align: 'start',
          loop: true,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-4 md:-ml-2 lg:-ml-3">
          {products.map((product, index) => (
            <CarouselItem key={product._id} className="pl-4 md:pl-2 lg:pl-3 basis-[65%] sm:basis-[65%] md:basis-1/2 lg:basis-1/3 xl:basis-1/5">
              <FadeIn direction="up" delay={index * 0.1} duration={0.5}>
                <Card className="group hover:shadow-xl transition-all duration-300 overflow-hidden h-full max-w-xs">
                  <CardContent className="p-0">
                    {/* Product Image Placeholder */}
                    <div className="relative aspect-square bg-gradient-to-br from-primary/5 to-primary/10 flex items-center justify-center overflow-hidden">
                      <div className="text-5xl">💊</div>
                      <Badge
                        className="absolute top-3 right-3 bg-red-500 hover:bg-red-600 text-white font-bold"
                      >
                        {product.discountPercentage}% OFF
                      </Badge>
                    </div>

                    {/* Product Details */}
                    <div className="p-3 space-y-1.5">
                      <h3 className="font-semibold text-base line-clamp-1">
                        {product.itemName}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {product.company}
                      </p>
                      <div className="flex items-center justify-between pt-1">
                        <div>
                          <p className="text-xs text-muted-foreground line-through">
                            ${product.originalPrice.toFixed(2)}
                          </p>
                          <p className="text-lg font-bold text-primary">
                            ${product.pricePerPack.toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-green-600">
                            Save ${(product.originalPrice - product.pricePerPack).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>

                  <CardFooter className="p-3 pt-0">
                    <Button
                      className="w-full group/btn"
                      size="sm"
                      onClick={() => handleAddToCart(product)}
                    >
                      <ShoppingCart className="mr-1.5 h-3.5 w-3.5" />
                      Add to Cart
                    </Button>
                  </CardFooter>
                </Card>
              </FadeIn>
            </CarouselItem>
          ))}

          {/* See More Card */}
          {!showAll && (
            <CarouselItem className="pl-4 md:pl-2 lg:pl-3 basis-[65%] sm:basis-[65%] md:basis-1/2 lg:basis-1/3 xl:basis-1/5">
              <FadeIn direction="up" delay={products.length * 0.1} duration={0.5}>
                <Card
                  className="group hover:shadow-xl transition-all duration-300 overflow-hidden h-full max-w-xs cursor-pointer bg-red-50/50 hover:bg-red-50 dark:bg-red-950/20 dark:hover:bg-red-950/30"
                  onClick={() => setShowAll(true)}
                >
                  <CardContent className="p-0">
                    <div className="relative aspect-square flex flex-col items-center justify-center">
                      <div className="text-center space-y-3">
                        <div className="mx-auto w-16 h-16 rounded-full bg-red-500/20 dark:bg-red-500/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Percent className="h-8 w-8 text-red-500" />
                        </div>
                        <div className="px-4">
                          <p className="font-bold text-base text-red-500">More Deals</p>
                          <p className="text-xs text-muted-foreground">
                            {allDiscountedProducts.length - products.length} more discounts
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="p-3 pt-0">
                    <div className="w-full h-9 flex items-center justify-center text-sm font-medium text-red-500">
                      Click to view
                    </div>
                  </CardFooter>
                </Card>
              </FadeIn>
            </CarouselItem>
          )}

          {/* Collapse Card */}
          {showAll && (
            <CarouselItem className="pl-4 md:pl-2 lg:pl-3 basis-[65%] sm:basis-[65%] md:basis-1/2 lg:basis-1/3 xl:basis-1/5">
              <FadeIn direction="up" delay={products.length * 0.1} duration={0.5}>
                <Card
                  className="group hover:shadow-xl transition-all duration-300 overflow-hidden h-full max-w-xs cursor-pointer bg-red-50/50 hover:bg-red-50 dark:bg-red-950/20 dark:hover:bg-red-950/30"
                  onClick={() => setShowAll(false)}
                >
                  <CardContent className="p-0">
                    <div className="relative aspect-square flex flex-col items-center justify-center">
                      <div className="text-center space-y-3">
                        <div className="mx-auto w-16 h-16 rounded-full bg-red-500/20 dark:bg-red-500/30 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <ChevronUp className="h-8 w-8 text-red-500" />
                        </div>
                        <div className="px-4">
                          <p className="font-bold text-base text-red-500">Show Less</p>
                          <p className="text-xs text-muted-foreground">
                            Collapse discounts
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="p-3 pt-0">
                    <div className="w-full h-9 flex items-center justify-center text-sm font-medium text-red-500">
                      Click to collapse
                    </div>
                  </CardFooter>
                </Card>
              </FadeIn>
            </CarouselItem>
          )}
        </CarouselContent>
        <CarouselPrevious className="hidden md:flex" />
        <CarouselNext className="hidden md:flex" />
      </Carousel>
    </section>
  )
}
