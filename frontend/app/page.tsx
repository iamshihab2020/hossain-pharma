import { Navbar } from '@/components/layout/navbar'
import { Hero } from './../components/pages/home/hero';
import { Categories } from '@/components/pages/home/categories';
import { LatestProducts } from '@/components/pages/home/latest-products';
import { DiscountedProducts } from '@/components/pages/home/discounted-products';

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main className="flex flex-col gap-8 container mx-auto">
        <Hero />
        <Categories />
        <LatestProducts />
        <DiscountedProducts />
      </main>
    </>
  )
}
