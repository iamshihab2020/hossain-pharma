'use client'

import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Pill,
  Apple,
  Cross,
  Shield,
  Thermometer,
  Leaf,
  Sparkles,
  Droplet,
  type LucideIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { FadeIn } from '@/components/animations/fade-in'
import Link from 'next/link'
import { useState } from 'react'

// Category type with icon
interface Category {
  id: string;
  categoryName: string;
  categoryTag: string;
  icon: LucideIcon;
  color: string;
}

// Temporary mock data - replace with API call later
const categories: Category[] = [
  {
    id: '1',
    categoryName: 'Pain Relief',
    categoryTag: 'pain-relief',
    icon: Pill,
    color: 'text-red-500',
  },
  {
    id: '2',
    categoryName: 'Vitamins',
    categoryTag: 'vitamins',
    icon: Apple,
    color: 'text-orange-500',
  },
  {
    id: '3',
    categoryName: 'First Aid',
    categoryTag: 'first-aid',
    icon: Cross,
    color: 'text-red-600',
  },
  {
    id: '4',
    categoryName: 'Antibiotics',
    categoryTag: 'antibiotics',
    icon: Shield,
    color: 'text-blue-500',
  },
  {
    id: '5',
    categoryName: 'Cold & Flu',
    categoryTag: 'cold-flu',
    icon: Thermometer,
    color: 'text-cyan-500',
  },
  {
    id: '6',
    categoryName: 'Supplements',
    categoryTag: 'supplements',
    icon: Leaf,
    color: 'text-green-500',
  },
  {
    id: '7',
    categoryName: 'Skincare',
    categoryTag: 'skincare',
    icon: Sparkles,
    color: 'text-pink-500',
  },
  {
    id: '8',
    categoryName: 'Diabetes Care',
    categoryTag: 'diabetes',
    icon: Droplet,
    color: 'text-purple-500',
  },
]

export function Categories() {
  const [showAll, setShowAll] = useState(false)
  const displayedCategories = showAll ? categories : categories.slice(0, 4)

  return (
    <section className="py-16 w-full px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
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
          {displayedCategories.map((category, index) => {
            const IconComponent = category.icon;
            return (
              <FadeIn key={category.id} direction="up" delay={index * 0.1} duration={0.5}>
                <Card className="group hover:shadow-xl transition-all duration-300 border-2 hover:border-primary/50 overflow-hidden">
                  <CardContent className="p-6 flex flex-col items-center justify-center min-h-[200px]">
                    <div className="w-20 h-20 bg-gradient-to-br from-primary/10 to-primary/5 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                      <IconComponent className={`w-10 h-10 ${category.color}`} aria-hidden="true" />
                    </div>
                    <h3 className="text-lg font-semibold text-center">
                      {category.categoryName}
                    </h3>
                  </CardContent>
                  <CardFooter className="pt-0 pb-4 justify-center">
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
            );
          })}
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
      </div>
    </section>
  )
}
