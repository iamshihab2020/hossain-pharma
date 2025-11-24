'use client'

import { ShoppingCart, ChevronDown, ChevronUp } from 'lucide-react'
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
const allProducts = [
  {
    _id: '1',
    itemName: 'Paracetamol 500mg',
    pricePerPack: 12.99,
    company: 'PharmaCo',
    image: '/products/paracetamol.png',
    category: 'Pain Relief',
  },
  {
    _id: '2',
    itemName: 'Vitamin C 1000mg',
    pricePerPack: 18.50,
    company: 'VitaHealth',
    image: '/products/vitamin-c.png',
    category: 'Vitamins',
  },
  {
    _id: '3',
    itemName: 'Amoxicillin 250mg',
    pricePerPack: 24.99,
    company: 'MediCore',
    image: '/products/amoxicillin.png',
    category: 'Antibiotics',
  },
  {
    _id: '4',
    itemName: 'Ibuprofen 400mg',
    pricePerPack: 15.75,
    company: 'PharmaCo',
    image: '/products/ibuprofen.png',
    category: 'Pain Relief',
  },
  {
    _id: '5',
    itemName: 'Multivitamin Complex',
    pricePerPack: 29.99,
    company: 'VitaHealth',
    image: '/products/multivitamin.png',
    category: 'Vitamins',
  },
  {
    _id: '6',
    itemName: 'First Aid Kit',
    pricePerPack: 45.00,
    company: 'SafeCare',
    image: '/products/first-aid.png',
    category: 'First Aid',
  },
  {
    _id: '7',
    itemName: 'Aspirin 100mg',
    pricePerPack: 9.99,
    company: 'PharmaCo',
    image: '/products/aspirin.png',
    category: 'Pain Relief',
  },
  {
    _id: '8',
    itemName: 'Omega-3 Fish Oil',
    pricePerPack: 22.50,
    company: 'VitaHealth',
    image: '/products/omega3.png',
    category: 'Supplements',
  },
  {
    _id: '9',
    itemName: 'Antibiotic Cream',
    pricePerPack: 14.75,
    company: 'MediCore',
    image: '/products/cream.png',
    category: 'First Aid',
  },
  {
    _id: '10',
    itemName: 'Cough Syrup',
    pricePerPack: 11.99,
    company: 'PharmaCo',
    image: '/products/cough.png',
    category: 'Cold & Flu',
  },
]

export function LatestProducts() {
  const [showAll, setShowAll] = useState(false)
  const products = showAll ? allProducts : allProducts.slice(0, 6)
  const handleAddToCart = (product: typeof products[0]) => {
    // TODO: Implement add to cart functionality
    console.log('Adding to cart:', product)
  }

  return (
    <section className="py-16 bg-muted/20 px-4 sm:px-6 md:px-10 lg:px-16 xl:px-20 w-full">
        <FadeIn direction="up" duration={0.6}>
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
              Latest <span className="text-primary">Products</span>
            </h2>
            <p className="text-muted-foreground text-lg">
              Discover our newest medicines and healthcare products
            </p>
          </div>
        </FadeIn>

        <Carousel
          opts={{
            align: 'start',
            loop: true,
          }}
          className="w-full "
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
                        className="absolute top-3 right-3 bg-primary/90"
                      >
                        New
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
                          <p className="text-xs text-muted-foreground">Price</p>
                          <p className="text-lg font-bold text-primary">
                            ${product.pricePerPack.toFixed(2)}
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
                  className="group hover:shadow-xl transition-all duration-300 overflow-hidden h-full max-w-xs cursor-pointer border-2 border-dashed border-primary/50 hover:border-primary bg-primary/5 hover:bg-primary/10"
                  onClick={() => setShowAll(true)}
                >
                  <CardContent className="p-0">
                    <div className="relative aspect-square flex items-center justify-center">
                      <div className="text-center space-y-4">
                        <div className="mx-auto w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <ChevronDown className="h-10 w-10 text-primary" />
                        </div>
                        <div className="px-4">
                          <p className="font-bold text-lg text-primary">See More</p>
                          <p className="text-sm text-muted-foreground">
                            {allProducts.length - products.length} more products
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                </FadeIn>
              </CarouselItem>
            )}

            {/* Collapse Card */}
            {showAll && (
              <CarouselItem className="pl-4 md:pl-2 lg:pl-3 basis-[65%] sm:basis-[65%] md:basis-1/2 lg:basis-1/3 xl:basis-1/5">
                <FadeIn direction="up" delay={products.length * 0.1} duration={0.5}>
                <Card
                  className="group hover:shadow-xl transition-all duration-300 overflow-hidden h-full max-w-xs cursor-pointer border-2 border-dashed border-primary/50 hover:border-primary bg-primary/5 hover:bg-primary/10"
                  onClick={() => setShowAll(false)}
                >
                  <CardContent className="p-0">
                    <div className="relative aspect-square flex items-center justify-center">
                      <div className="text-center space-y-4">
                        <div className="mx-auto w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <ChevronUp className="h-10 w-10 text-primary" />
                        </div>
                        <div className="px-4">
                          <p className="font-bold text-lg text-primary">Show Less</p>
                          <p className="text-sm text-muted-foreground">
                            Collapse products
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
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
