'use client'

import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { FadeIn } from '@/components/animations/fade-in'
import { StaggerContainer, StaggerItem } from '@/components/animations/stagger-container'
import Link from 'next/link'
import { useState } from 'react'

// Temporary mock data - replace with API call later
const categories = [
  {
    id: '1',
    categoryName: 'Pain Relief',
    categoryImage: '/categories/pain-relief.png',
    categoryTag: 'pain-relief',
  },
  {
    id: '2',
    categoryName: 'Vitamins',
    categoryImage: '/categories/vitamins.png',
    categoryTag: 'vitamins',
  },
  {
    id: '3',
    categoryName: 'First Aid',
    categoryImage: '/categories/first-aid.png',
    categoryTag: 'first-aid',
  },
  {
    id: '4',
    categoryName: 'Antibiotics',
    categoryImage: '/categories/antibiotics.png',
    categoryTag: 'antibiotics',
  },
  {
    id: '5',
    categoryName: 'Cold & Flu',
    categoryImage: '/categories/cold-flu.png',
    categoryTag: 'cold-flu',
  },
  {
    id: '6',
    categoryName: 'Supplements',
    categoryImage: '/categories/supplements.png',
    categoryTag: 'supplements',
  },
  {
    id: '7',
    categoryName: 'Skincare',
    categoryImage: '/categories/skincare.png',
    categoryTag: 'skincare',
  },
  {
    id: '8',
    categoryName: 'Diabetes Care',
    categoryImage: '/categories/diabetes.png',
    categoryTag: 'diabetes',
  },
]

export function Categories() {
  const [showAll, setShowAll] = useState(false)
  const displayedCategories = showAll ? categories : categories.slice(0, 4)

  return (
    <section className="py-16 px-10 w-full">
        <FadeIn direction="up" duration={0.6}>
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
              Shop by <span className="text-primary">Category</span>
            </h2>
            <p className="text-muted-foreground text-lg">
              Browse our wide range of pharmaceutical categories
            </p>
          </div>
        </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {displayedCategories.map((category, index) => (
              <FadeIn key={category.id} direction="up" delay={index * 0.1} duration={0.5}>
                <Card className="group hover:shadow-xl transition-all duration-300 border-2 hover:border-primary/50 overflow-hidden">
                  <CardContent className="p-6 flex flex-col items-center justify-center min-h-[250px]">
                    {/* Placeholder for category image */}
                    <div className="w-32 h-32 bg-gradient-to-br from-primary/10 to-primary/5 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                      <div className="text-4xl text-primary">💊</div>
                    </div>
                    <h3 className="text-xl font-semibold text-center">
                      {category.categoryName}
                    </h3>
                  </CardContent>
                  <CardFooter className="pt-0 pb-6 justify-center">
                    <Link href={`/category/${category.categoryTag}`}>
                      <Button
                        variant="ghost"
                        className="group/btn"
                        size="sm"
                      >
                        See More
                        <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                      </Button>
                    </Link>
                  </CardFooter>
                </Card>
              </FadeIn>
            ))}
          </div>

        <div className="flex justify-center mt-8">
          <Button
            variant="outline"
            onClick={() => setShowAll(!showAll)}
            className="group"
          >
            {showAll ? (
              <>
                Show Less
                <ChevronUp className="ml-2 h-4 w-4 transition-transform group-hover:-translate-y-1" />
              </>
            ) : (
              <>
                Show More Categories
                <ChevronDown className="ml-2 h-4 w-4 transition-transform group-hover:translate-y-1" />
              </>
            )}
          </Button>
        </div>
    </section>
  )
}
